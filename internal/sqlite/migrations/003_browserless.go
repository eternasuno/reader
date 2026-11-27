package migrations

import (
	"context"
	"database/sql"
)

const browserlessSchema = `
ALTER TABLE setting DROP COLUMN provider;
ALTER TABLE setting DROP COLUMN jina_key;
ALTER TABLE setting DROP COLUMN browser_endpoint;
ALTER TABLE setting ADD COLUMN browserless_url TEXT;
ALTER TABLE setting ADD COLUMN browserless_token TEXT;
ALTER TABLE setting ADD COLUMN browserless_residential_proxy INTEGER NOT NULL DEFAULT 0;
`

func browserlessUp(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, browserlessSchema)

	return err
}
