package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Bernabass/chess-detective/services/api/internal/lichess"
	"github.com/Bernabass/chess-detective/services/api/internal/store/sqlcdb"
)

// Sign in with Lichess (SPEC §10.6; every detail checked against Lichess, DECISIONS 2026-10-29).
//
//	Start:    a one-time state and PKCE verifier, stored for StateTTL with the guest and
//	          return_to; the browser gets the state in a cookie and goes to Lichess.
//	Complete: the state must match the cookie and a stored, unexpired row (used once); the
//	          code is exchanged, the account read and the token revoked at once (never stored
//	          or logged); the account is found by its Lichess id only, never by username.

// StateTTL is how long a Lichess sign-in may take.
const StateTTL = 10 * time.Minute

// Why a Lichess sign-in failed. The browser is sent to /login?lichess=<Reason()>.
var (
	ErrLichessCancelled = errors.New("lichess sign-in was cancelled")
	ErrLichessState     = errors.New("lichess sign-in state is missing, mismatched, used or expired")
	ErrLichessFailed    = errors.New("lichess sign-in failed")
)

// LichessReason is the short reason shown on the sign-in page for a failed Lichess sign-in.
func LichessReason(err error) string {
	switch {
	case errors.Is(err, ErrLichessCancelled):
		return "cancelled"
	case errors.Is(err, ErrLichessState):
		return "expired"
	default:
		return "failed"
	}
}

// SafeReturnTo keeps a path on this site ("/daily/3"); anything else (an absolute URL, "//host",
// a backslash, control characters) becomes "/daily". No open redirect.
func SafeReturnTo(path string) string {
	if path == "" || len(path) > 512 || !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") ||
		strings.ContainsAny(path, "\\") || strings.ContainsFunc(path, func(r rune) bool { return r < 0x20 || r == 0x7f }) {
		return "/daily"
	}
	return path
}

// StartLichess begins a sign-in: it returns Lichess's authorization URL and the state, which
// the caller must also give the browser (the rg_oauth cookie) to bind the flow to it.
func (s *Service) StartLichess(ctx context.Context, current *Session, returnTo string) (authorizeURL, state string, err error) {
	if s.Lichess == nil {
		return "", "", fmt.Errorf("%w: not configured", ErrLichessFailed)
	}
	state, err = lichess.NewSecret()
	if err != nil {
		return "", "", err //nolint:wrapcheck // already wrapped
	}
	verifier, err := lichess.NewSecret()
	if err != nil {
		return "", "", err //nolint:wrapcheck // already wrapped
	}
	var guest *int64
	if current != nil {
		acct, err := s.AccountOf(ctx, current.PlayerID)
		if err != nil {
			return "", "", err
		}
		if acct.Guest {
			id := current.PlayerID
			guest = &id
		}
	}
	if err := s.Store.Queries().InsertOAuthState(ctx, sqlcdb.InsertOAuthStateParams{
		StateHash:    HashToken(state),
		CodeVerifier: verifier,
		PlayerID:     guest,
		ReturnTo:     SafeReturnTo(returnTo),
		ExpiresAt:    s.Clock.Now().Add(StateTTL),
	}); err != nil {
		return "", "", fmt.Errorf("saving sign-in state: %w", err)
	}
	return s.Lichess.AuthorizeURL(s.LichessCallback, state, lichess.Challenge(verifier)), state, nil
}

// LichessCallback is what Lichess sent back, and the state cookie this browser holds.
type LichessCallback struct {
	Code, State, Error string
	CookieState        string
}

// CompleteLichess finishes a sign-in: it returns the account, its new session and where to go.
func (s *Service) CompleteLichess(ctx context.Context, current *Session, cb LichessCallback) (Account, Session, string, error) {
	if s.Lichess == nil {
		return Account{}, Session{}, "", fmt.Errorf("%w: not configured", ErrLichessFailed)
	}
	// This browser started this flow (login CSRF), and the state is known, unexpired and unused.
	if cb.State == "" || cb.CookieState == "" || subtle.ConstantTimeCompare([]byte(cb.State), []byte(cb.CookieState)) != 1 {
		return Account{}, Session{}, "", fmt.Errorf("%w: doesn't match this browser", ErrLichessState)
	}
	row, err := s.Store.Queries().TakeOAuthState(ctx, HashToken(cb.State))
	if errors.Is(err, pgx.ErrNoRows) {
		return Account{}, Session{}, "", fmt.Errorf("%w: unknown or already used", ErrLichessState)
	}
	if err != nil {
		return Account{}, Session{}, "", fmt.Errorf("loading sign-in state: %w", err)
	}
	if !s.Clock.Now().Before(row.ExpiresAt) {
		return Account{}, Session{}, "", fmt.Errorf("%w: expired", ErrLichessState)
	}
	if cb.Error != "" {
		if cb.Error == "access_denied" {
			return Account{}, Session{}, "", ErrLichessCancelled
		}
		return Account{}, Session{}, "", fmt.Errorf("%w: lichess answered %q", ErrLichessFailed, truncate(cb.Error, 40))
	}
	if cb.Code == "" {
		return Account{}, Session{}, "", fmt.Errorf("%w: no code", ErrLichessFailed)
	}

	who, err := s.lichessAccount(ctx, cb.Code, row.CodeVerifier)
	if err != nil {
		return Account{}, Session{}, "", err
	}

	var acct Account
	var sess Session
	err = s.Store.InTx(ctx, func(q *sqlcdb.Queries) error {
		var err error
		acct, err = s.lichessUser(ctx, q, who)
		if err != nil {
			return err
		}
		sess, err = s.signInMerging(ctx, q, current, row.PlayerID, acct.PlayerID)
		return err
	})
	if err != nil {
		return Account{}, Session{}, "", err //nolint:wrapcheck // InTx wraps
	}
	return acct, sess, row.ReturnTo, nil
}

// lichessAccount exchanges the code, reads who signed in, and revokes the token whatever happens
// (it lives only in this function: never stored, never logged).
func (s *Service) lichessAccount(ctx context.Context, code, verifier string) (lichess.Account, error) {
	token, err := s.Lichess.Exchange(ctx, code, verifier, s.LichessCallback)
	if err != nil {
		return lichess.Account{}, fmt.Errorf("%w: %w", ErrLichessFailed, err)
	}
	who, accountErr := s.Lichess.Account(ctx, token)
	// Revoke even if the request was cancelled meanwhile: a fresh, short context.
	revokeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := s.Lichess.Revoke(revokeCtx, token); err != nil && s.Logger != nil {
		s.Logger.WarnContext(ctx, "revoking the Lichess token failed", "err", err)
	}
	if accountErr != nil {
		return lichess.Account{}, fmt.Errorf("%w: %w", ErrLichessFailed, accountErr)
	}
	return who, nil
}

// lichessUser finds the account with this Lichess id (only that: never a username match, which
// would hand someone else's account over), or creates one under the first free username.
func (s *Service) lichessUser(ctx context.Context, q *sqlcdb.Queries, who lichess.Account) (Account, error) {
	found, err := q.GetUserByLichessID(ctx, &who.ID)
	if err == nil {
		if err := q.SetLichessUsername(ctx, sqlcdb.SetLichessUsernameParams{ID: found.ID, LichessUsername: &who.Username}); err != nil {
			return Account{}, fmt.Errorf("updating the Lichess name: %w", err)
		}
		return Account{PlayerID: found.PlayerID, Username: found.Username}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Account{}, fmt.Errorf("finding the Lichess user: %w", err)
	}
	names := usernameCandidates(who.Username, maxUsernameTries)
	for range randomUsernameTries {
		// Someone who registers name, name-2 … can't lock this Lichess user out.
		name, err := randomUsername(who.Username)
		if err != nil {
			return Account{}, err
		}
		names = append(names, name)
	}
	for _, name := range names {
		created, err := q.CreateLichessUser(ctx, sqlcdb.CreateLichessUserParams{
			Username: name, LichessUserID: &who.ID, LichessUsername: &who.Username, CreatedAt: s.Clock.Now(),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			// Taken: by another account (never touched), or by this Lichess account itself,
			// created a moment ago by a simultaneous sign-in; then that's the account.
			found, err := q.GetUserByLichessID(ctx, &who.ID)
			if err == nil {
				return Account{PlayerID: found.PlayerID, Username: found.Username}, nil
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return Account{}, fmt.Errorf("finding the Lichess user: %w", err)
			}
			continue
		}
		if err != nil {
			return Account{}, fmt.Errorf("creating the Lichess user: %w", err)
		}
		player, err := q.CreatePlayer(ctx, sqlcdb.CreatePlayerParams{UserID: &created.ID, CreatedAt: s.Clock.Now()})
		if err != nil {
			return Account{}, fmt.Errorf("creating the player: %w", err)
		}
		return Account{PlayerID: player, Username: created.Username}, nil
	}
	return Account{}, fmt.Errorf("%w: no free username for %q", ErrLichessFailed, who.Username)
}

const (
	maxUsernameTries    = 20 // name, name-2 … name-20
	randomUsernameTries = 10 // then name-<6 random digits>
)

// randomUsername is the Lichess name (cleaned up like usernameCandidates) with 6 random digits.
func randomUsername(lichessName string) (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("reading randomness: %w", err)
	}
	suffix := fmt.Sprintf("-%06d", n.Int64())
	return truncate(cleanName(lichessName), 20-len(suffix)) + suffix, nil
}

// cleanName keeps the characters a username may have ([A-Za-z0-9_-]), or says "player".
func cleanName(name string) string {
	base := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			return r
		}
		return -1
	}, name)
	if base == "" {
		return "player"
	}
	return base
}

// usernameCandidates are the names to try for a new Lichess user: the Lichess name itself if
// it's a valid username (3-20 of [A-Za-z0-9_-]), then name-2, name-3, … shortened to fit 20.
func usernameCandidates(lichessName string, n int) []string {
	base := cleanName(lichessName)
	out := make([]string, 0, n)
	if len(base) >= 3 && len(base) <= 20 {
		out = append(out, base)
	}
	for i := 2; len(out) < n; i++ {
		suffix := "-" + strconv.Itoa(i)
		out = append(out, truncate(base, 20-len(suffix))+suffix)
	}
	return out
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
