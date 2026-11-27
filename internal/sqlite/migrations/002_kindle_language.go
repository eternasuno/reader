package migrations

import (
	"context"
	"database/sql"
)

const kindleLanguageSchema = `ALTER TABLE setting ADD COLUMN kindle_language TEXT NOT NULL DEFAULT 'zh';`

func kindleLanguageUp(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, kindleLanguageSchema)

	return err
}
