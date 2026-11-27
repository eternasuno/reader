package migrations

import (
	"context"
	"database/sql"
	"fmt"
)

const snapshotMigrationLimit = 10000

func snapshotLimitsUp(ctx context.Context, tx *sql.Tx) error {
	for _, table := range []string{"feed_item", "saved_page"} {
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+table).Scan(&count); err != nil {
			return fmt.Errorf("count %s rows for snapshot migration: %w", table, err)
		}

		if count > snapshotMigrationLimit {
			return fmt.Errorf("%s has %d rows, exceeding the snapshot limit of %d", table, count, snapshotMigrationLimit)
		}
	}

	return nil
}
