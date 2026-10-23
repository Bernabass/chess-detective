package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/Bernabass/chess-detective/services/api/internal/clock"
	"github.com/Bernabass/chess-detective/services/api/internal/daily"
	"github.com/Bernabass/chess-detective/services/api/internal/store"
	"github.com/Bernabass/chess-detective/services/api/internal/store/sqlcdb"
)

// Domain errors; internal/httpapi maps them to HTTP statuses.
var (
	ErrUsernameTaken  = errors.New("that username is taken")
	ErrBadCredentials = errors.New("wrong username or password")
)

// Session is a session the caller holds. Token is set only when the session was just created
// (the cookie must be written); Expires tells the cookie when to expire.
type Session struct {
	PlayerID  int64
	TokenHash []byte
	Token     string
	Expires   time.Time
}

// Account is who a player is.
type Account struct {
	PlayerID int64
	Guest    bool
	Username string // empty for guests
}

// Service manages sessions, guests and accounts.
type Service struct {
	Store *store.Store
	Clock clock.Clock
}

// Resolve looks up a session token. It returns ok=false for an unknown or expired token. When
// the sliding expiry was extended (at most once per TouchInterval), refreshed is true and the
// cookie should be rewritten with the new expiry.
func (s *Service) Resolve(ctx context.Context, token string) (sess Session, refreshed, ok bool, err error) {
	if token == "" {
		return Session{}, false, false, nil
	}
	now := s.Clock.Now()
	hash := HashToken(token)
	q := s.Store.Queries()
	row, err := q.GetSession(ctx, sqlcdb.GetSessionParams{TokenHash: hash, Now: now})
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, false, false, nil
	}
	if err != nil {
		return Session{}, false, false, fmt.Errorf("loading session: %w", err)
	}
	sess = Session{PlayerID: row.PlayerID, TokenHash: hash, Expires: row.ExpiresAt}
	if now.Sub(row.LastSeenAt) >= TouchInterval {
		sess.Expires = now.Add(SessionTTL)
		if err := q.TouchSession(ctx, sqlcdb.TouchSessionParams{TokenHash: hash, Now: now, ExpiresAt: sess.Expires}); err != nil {
			return Session{}, false, false, fmt.Errorf("extending session: %w", err)
		}
		refreshed = true
	}
	return sess, refreshed, true, nil
}

// NewGuest creates a guest player and a session for it.
func (s *Service) NewGuest(ctx context.Context) (Session, error) {
	var out Session
	err := s.Store.InTx(ctx, func(q *sqlcdb.Queries) error {
		id, err := q.CreatePlayer(ctx, sqlcdb.CreatePlayerParams{CreatedAt: s.Clock.Now()})
		if err != nil {
			return fmt.Errorf("creating guest: %w", err)
		}
		out, err = s.createSession(ctx, q, id)
		return err
	})
	return out, err //nolint:wrapcheck // InTx wraps
}

func (s *Service) createSession(ctx context.Context, q *sqlcdb.Queries, playerID int64) (Session, error) {
	token, hash := NewToken()
	now := s.Clock.Now()
	expires := now.Add(SessionTTL)
	if err := q.CreateSession(ctx, sqlcdb.CreateSessionParams{TokenHash: hash, PlayerID: playerID, Now: now, ExpiresAt: expires}); err != nil {
		return Session{}, fmt.Errorf("creating session: %w", err)
	}
	return Session{PlayerID: playerID, TokenHash: hash, Token: token, Expires: expires}, nil
}

// AccountOf tells who a player is.
func (s *Service) AccountOf(ctx context.Context, playerID int64) (Account, error) {
	p, err := s.Store.Queries().GetPlayer(ctx, playerID)
	if err != nil {
		return Account{}, fmt.Errorf("loading player: %w", err)
	}
	a := Account{PlayerID: p.ID, Guest: p.UserID == nil}
	if p.Username != nil {
		a.Username = *p.Username
	}
	return a, nil
}

// Register creates an account and signs the caller in: their guest attempts move to it and
// the session is rotated (SPEC §10.6). current is the caller's session, if any.
func (s *Service) Register(ctx context.Context, current *Session, username, password string) (Account, Session, error) {
	hash, err := HashPassword(password)
	if err != nil {
		return Account{}, Session{}, err
	}
	var acct Account
	var sess Session
	err = s.Store.InTx(ctx, func(q *sqlcdb.Queries) error {
		user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{Username: username, PasswordHash: &hash, CreatedAt: s.Clock.Now()})
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
			return ErrUsernameTaken
		}
		if err != nil {
			return fmt.Errorf("creating user: %w", err)
		}
		playerID, err := q.CreatePlayer(ctx, sqlcdb.CreatePlayerParams{UserID: &user.ID, CreatedAt: s.Clock.Now()})
		if err != nil {
			return fmt.Errorf("creating player: %w", err)
		}
		acct = Account{PlayerID: playerID, Username: user.Username}
		sess, err = s.signIn(ctx, q, current, playerID)
		return err
	})
	return acct, sess, err //nolint:wrapcheck // domain errors pass through unchanged
}

// Login checks the password and signs the caller in, with the same merge and rotation.
func (s *Service) Login(ctx context.Context, current *Session, username, password string) (Account, Session, error) {
	user, err := s.Store.Queries().GetUserByUsername(ctx, username)
	if errors.Is(err, pgx.ErrNoRows) {
		_, _ = VerifyPassword(password, dummyHash) // same time as a real check
		return Account{}, Session{}, ErrBadCredentials
	}
	if err != nil {
		return Account{}, Session{}, fmt.Errorf("loading user: %w", err)
	}
	if user.PasswordHash == nil { // a Lichess-only account
		_, _ = VerifyPassword(password, dummyHash)
		return Account{}, Session{}, ErrBadCredentials
	}
	ok, err := VerifyPassword(password, *user.PasswordHash)
	if err != nil {
		return Account{}, Session{}, fmt.Errorf("checking password: %w", err)
	}
	if !ok {
		return Account{}, Session{}, ErrBadCredentials
	}
	var sess Session
	err = s.Store.InTx(ctx, func(q *sqlcdb.Queries) error {
		var err error
		sess, err = s.signIn(ctx, q, current, user.PlayerID)
		return err
	})
	return Account{PlayerID: user.PlayerID, Username: user.Username}, sess, err //nolint:wrapcheck // InTx wraps
}

// signIn merges the caller's guest player into the account's (SPEC §10.6: their attempts at
// puzzles the account hasn't played move over; the rest go with the guest), recomputes the
// account's stats, drops the old session and creates a new one.
func (s *Service) signIn(ctx context.Context, q *sqlcdb.Queries, current *Session, accountPlayer int64) (Session, error) {
	if current != nil {
		p, err := q.GetPlayer(ctx, current.PlayerID)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
		case err != nil:
			return Session{}, fmt.Errorf("loading current player: %w", err)
		case p.UserID == nil && p.ID != accountPlayer:
			if _, err := q.MoveGuestAttempts(ctx, sqlcdb.MoveGuestAttemptsParams{
				UserPlayerID: accountPlayer, GuestPlayerID: p.ID,
			}); err != nil {
				return Session{}, fmt.Errorf("moving guest attempts: %w", err)
			}
			// Deletes the guest's remaining attempts, its stats and its sessions (the current one too).
			if err := q.DeletePlayer(ctx, p.ID); err != nil {
				return Session{}, fmt.Errorf("deleting guest: %w", err)
			}
		}
		if err := q.DeleteSession(ctx, current.TokenHash); err != nil {
			return Session{}, fmt.Errorf("rotating session: %w", err)
		}
	}
	if err := daily.RecomputeStats(ctx, q, accountPlayer); err != nil {
		return Session{}, err //nolint:wrapcheck // already wrapped
	}
	return s.createSession(ctx, q, accountPlayer)
}

// Logout deletes the session.
func (s *Service) Logout(ctx context.Context, current *Session) error {
	if current == nil {
		return nil
	}
	if err := s.Store.Queries().DeleteSession(ctx, current.TokenHash); err != nil {
		return fmt.Errorf("deleting session: %w", err)
	}
	return nil
}
