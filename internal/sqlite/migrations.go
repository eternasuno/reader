package sqlite

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"

	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

func applyMigrations(ctx context.Context, db *sql.DB) error {
	fsys, err := fs.Sub(migrationFiles, "migrations")
	if err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}

	return applyMigrationsFromFS(ctx, db, fsys, migrationAddFeedIconURL())
}

func applyMigrationsFromFS(ctx context.Context, db *sql.DB, fsys fs.FS, goMigrations ...*goose.Migration) error {
	provider, err := newMigrationProvider(db, fsys, goMigrations...)
	if err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}

	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}

	return nil
}

func newMigrationProvider(db *sql.DB, fsys fs.FS, goMigrations ...*goose.Migration) (*goose.Provider, error) {
	opts := []goose.ProviderOption{
		goose.WithDisableGlobalRegistry(true),
		goose.WithLogger(goose.NopLogger()),
	}
	if len(goMigrations) > 0 {
		opts = append(opts, goose.WithGoMigrations(goMigrations...))
	}

	return goose.NewProvider(goose.DialectSQLite3, db, fsys, opts...)
}

func migrationAddFeedIconURL() *goose.Migration {
	return goose.NewGoMigration(2, &goose.GoFunc{RunTx: addFeedIconURL}, nil)
}

func addFeedIconURL(ctx context.Context, tx *sql.Tx) error {
	var count int
	if err := tx.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM pragma_table_info('feed') WHERE name = 'icon_url'`,
	).Scan(&count); err != nil {
		return fmt.Errorf("check feed.icon_url column: %w", err)
	}

	if count > 0 {
		return nil
	}

	if _, err := tx.ExecContext(ctx, `ALTER TABLE feed ADD COLUMN icon_url TEXT`); err != nil {
		return fmt.Errorf("add feed.icon_url column: %w", err)
	}

	return nil
}
