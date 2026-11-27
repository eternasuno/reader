package migrations

import (
	"context"
	"database/sql"
	"fmt"
)

const feedItemMigrationBudget = 10000

func feedItemBudgetUp(ctx context.Context, tx *sql.Tx) error {
	var retention int64
	if err := tx.QueryRowContext(ctx, `SELECT retention FROM setting WHERE id = 1`).Scan(&retention); err != nil {
		return fmt.Errorf("read retention for feed item budget migration: %w", err)
	}

	if retention < 1 || retention > feedItemMigrationBudget {
		return fmt.Errorf("retention %d is outside 1..%d", retention, feedItemMigrationBudget)
	}

	// Each feed may hold max(stored items, retention): feeds above retention only shrink on
	// their next refresh while the others fill up to retention.
	var potential int64
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(MAX(stored, ?)), 0) FROM (
		SELECT (SELECT COUNT(*) FROM feed_item WHERE feed_item.feed_id = feed.id) AS stored FROM feed
	)`, retention).Scan(&potential); err != nil {
		return fmt.Errorf("read stored item counts for feed item budget migration: %w", err)
	}

	if potential > feedItemMigrationBudget {
		return fmt.Errorf("feeds may hold %d items with retention %d, exceeding the feed item budget of %d", potential, retention, feedItemMigrationBudget)
	}

	return nil
}
