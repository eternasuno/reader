package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/pressly/goose/v3"

	"reader/internal/sqlite/migrations"
)

func applyMigrations(ctx context.Context, db *sql.DB) error {
	return applyGoMigrations(ctx, db, migrations.All()...)
}

func applyGoMigrations(ctx context.Context, db *sql.DB, goMigrations ...*goose.Migration) error {
	provider, err := goose.NewProvider(
		goose.DialectSQLite3,
		db,
		nil,
		goose.WithDisableGlobalRegistry(true),
		goose.WithLogger(goose.NopLogger()),
		goose.WithGoMigrations(goMigrations...),
	)
	if err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}

	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}

	return nil
}
