// Package store owns the database: the connection pool, sqlc queries and migrations.
package store

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/Bernabass/chess-detective/services/api/db"
	"github.com/Bernabass/chess-detective/services/api/internal/store/sqlcdb"
)

// Store wraps the connection pool and the generated queries.
type Store struct {
	pool *pgxpool.Pool
	q    *sqlcdb.Queries
}

// Open creates a connection pool. It doesn't connect yet, so the API can start
// (and report "db: error" on /api/health) while the database is down.
func Open(ctx context.Context, databaseURL string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parsing DATABASE_URL: %w", err)
	}
	// Timestamps come back in UTC, like the rest of the API, not in the server's local zone.
	cfg.AfterConnect = func(_ context.Context, conn *pgx.Conn) error {
		conn.TypeMap().RegisterType(&pgtype.Type{
			Name: "timestamptz", OID: pgtype.TimestamptzOID,
			Codec: &pgtype.TimestamptzCodec{ScanLocation: time.UTC},
		})
		return nil
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("creating connection pool: %w", err)
	}
	return &Store{pool: pool, q: sqlcdb.New(pool)}, nil
}

// Queries runs queries outside a transaction.
func (s *Store) Queries() *sqlcdb.Queries {
	return s.q
}

// InTx runs fn in one transaction, committed if fn returns nil and rolled back otherwise.
func (s *Store) InTx(ctx context.Context, fn func(q *sqlcdb.Queries) error) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		return fn(s.q.WithTx(tx))
	})
	if err != nil {
		return fmt.Errorf("transaction: %w", err)
	}
	return nil
}

// Close releases every connection.
func (s *Store) Close() {
	s.pool.Close()
}

// Ping runs a trivial query, so it proves the database answers queries, not just accepts connections.
func (s *Store) Ping(ctx context.Context) error {
	if _, err := s.q.Ping(ctx); err != nil {
		return fmt.Errorf("pinging database: %w", err)
	}
	return nil
}

// Migrate applies every pending migration embedded in the binary.
func Migrate(ctx context.Context, databaseURL string, logger *slog.Logger) error {
	provider, sqlDB, err := migrationProvider(databaseURL)
	if err != nil {
		return err
	}
	defer func() { _ = sqlDB.Close() }()
	results, err := provider.Up(ctx)
	if err != nil {
		return fmt.Errorf("applying migrations: %w", err)
	}
	for _, r := range results {
		logger.InfoContext(ctx, "migration applied",
			"version", r.Source.Version, "file", r.Source.Path, "duration", r.Duration)
	}
	version, err := provider.GetDBVersion(ctx)
	if err != nil {
		return fmt.Errorf("reading schema version: %w", err)
	}
	logger.InfoContext(ctx, "database is up to date", "applied", len(results), "version", version)
	return nil
}

// PendingMigrations lists the embedded migrations the database hasn't applied yet, oldest first
// ("00003_lichess_username.sql"). It changes nothing; serve refuses to start while any are pending.
func PendingMigrations(ctx context.Context, databaseURL string) ([]string, error) {
	provider, sqlDB, err := migrationProvider(databaseURL)
	if err != nil {
		return nil, err
	}
	defer func() { _ = sqlDB.Close() }()
	// A database never migrated has no goose table yet (looked up the way goose does), and then
	// everything is pending.
	var tracked bool
	if err := sqlDB.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM pg_tables
		WHERE schemaname = current_schema() AND tablename = 'goose_db_version')`).Scan(&tracked); err != nil {
		return nil, fmt.Errorf("checking for the migrations table: %w", err)
	}
	var pending []string
	if !tracked {
		for _, src := range provider.ListSources() {
			pending = append(pending, src.Path)
		}
		return pending, nil
	}
	statuses, err := provider.Status(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading migration status: %w", err)
	}
	for _, st := range statuses {
		if st.State == goose.StatePending {
			pending = append(pending, st.Source.Path)
		}
	}
	return pending, nil
}

// migrationProvider connects to databaseURL with goose over the embedded migrations. The caller
// closes the *sql.DB.
func migrationProvider(databaseURL string) (*goose.Provider, *sql.DB, error) {
	connCfg, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return nil, nil, fmt.Errorf("parsing DATABASE_URL: %w", err)
	}
	if connCfg.ConnectTimeout == 0 {
		// Don't hang forever on a host that silently drops packets.
		connCfg.ConnectTimeout = 10 * time.Second
	}
	migrations, err := fs.Sub(db.Migrations, "migrations")
	if err != nil {
		return nil, nil, fmt.Errorf("loading embedded migrations: %w", err)
	}
	sqlDB := stdlib.OpenDB(*connCfg)
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations)
	if err != nil {
		_ = sqlDB.Close()
		return nil, nil, fmt.Errorf("creating migration provider: %w", err)
	}
	return provider, sqlDB, nil
}
