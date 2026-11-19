package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"time"

	"reader/internal/domain"
)

const (
	kindleSendColumns = `id, trigger, status, article_count, book_count, error, started_at, finished_at`
	kindleSendLimit   = 20
	pruneKindleSends  = `DELETE FROM kindle_send WHERE id NOT IN (SELECT id FROM kindle_send ORDER BY started_at DESC, id DESC LIMIT ?)`
)

type KindleSendRepo struct {
	read  *sql.DB
	write *sql.DB
}

func (r *KindleSendRepo) RecoverRunningOnStartup(ctx context.Context, now time.Time) error {
	_, err := r.write.ExecContext(
		ctx,
		`UPDATE kindle_send SET status = 'failed', error = ?, finished_at = ? WHERE status = 'running'`,
		"server restarted while send was in progress",
		timeToMillis(now),
	)
	if err != nil {
		return domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return nil
}

func (r *KindleSendRepo) ListRecent(ctx context.Context) ([]domain.KindleSendRecord, error) {
	rows, err := r.read.QueryContext(
		ctx,
		`SELECT `+kindleSendColumns+` FROM kindle_send ORDER BY started_at DESC, id DESC LIMIT ?`,
		kindleSendLimit,
	)
	if err != nil {
		return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	defer rows.Close()

	records := []domain.KindleSendRecord{}
	for rows.Next() {
		record, err := scanKindleSend(rows)
		if err != nil {
			return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
		}

		records = append(records, record)
	}

	if err := rows.Err(); err != nil {
		return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return records, nil
}

func (r *KindleSendRepo) CreateRunning(ctx context.Context, record domain.KindleSendRecord) (domain.KindleSendRecord, error) {
	created := record
	created.Status = domain.KindleStatusRunning

	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		var running int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM kindle_send WHERE status = 'running'`).Scan(&running); err != nil {
			return err
		}

		if running > 0 {
			return domain.NewError(domain.ErrKindleSendInProgress, nil)
		}

		_, err := tx.ExecContext(
			ctx,
			`INSERT INTO kindle_send (id, trigger, status, article_count, book_count, error, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			created.ID,
			string(created.Trigger),
			string(domain.KindleStatusRunning),
			created.ArticleCount,
			created.BookCount,
			optionalString(created.Error),
			timeToMillis(created.StartedAt),
			optionalTime(created.FinishedAt),
		)
		if err != nil {
			return err
		}

		if _, err := tx.ExecContext(ctx, pruneKindleSends, kindleSendLimit); err != nil {
			return err
		}

		return nil
	})
	if err != nil {
		return domain.KindleSendRecord{}, wrapRepositoryError(err, domain.ErrSettingRepositoryError)
	}

	return created, nil
}

func (r *KindleSendRepo) ListUnreadForKindle(ctx context.Context) ([]domain.SavedPage, []domain.Feed, map[string][]domain.FeedItem, error) {
	savedPages, err := r.listUnreadSavedPages(ctx)
	if err != nil {
		return nil, nil, nil, err
	}

	feeds, err := r.listFeedsWithUnread(ctx)
	if err != nil {
		return nil, nil, nil, err
	}

	items := make(map[string][]domain.FeedItem, len(feeds))
	for _, feed := range feeds {
		feedItems, err := r.listUnreadFeedItems(ctx, feed)
		if err != nil {
			return nil, nil, nil, err
		}

		items[feed.ID] = feedItems
	}

	return savedPages, feeds, items, nil
}

func (r *KindleSendRepo) RecordBookAccepted(ctx context.Context, sendID string, savedPageIDs []string, feedItemIDs []string, articleDelta int) error {
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(
			ctx,
			`UPDATE kindle_send SET article_count = article_count + ?, book_count = book_count + 1 WHERE id = ? AND status = 'running'`,
			articleDelta,
			sendID,
		)
		if err != nil {
			return err
		}

		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}

		if affected != 1 {
			return fmt.Errorf("kindle send %s is not running", sendID)
		}

		if len(savedPageIDs) > 0 {
			payload, err := encodeIDs(savedPageIDs)
			if err != nil {
				return err
			}

			if _, err := tx.ExecContext(ctx, `UPDATE saved_page SET read = 1 WHERE id IN (SELECT value FROM json_each(?))`, payload); err != nil {
				return err
			}
		}

		if len(feedItemIDs) > 0 {
			payload, err := encodeIDs(feedItemIDs)
			if err != nil {
				return err
			}

			if _, err := tx.ExecContext(ctx, `UPDATE feed_item SET read = 1 WHERE id IN (SELECT value FROM json_each(?))`, payload); err != nil {
				return err
			}
		}

		return nil
	})
	if err != nil {
		return wrapRepositoryError(err, domain.ErrSettingRepositoryError)
	}

	return nil
}

func (r *KindleSendRepo) CompleteSend(ctx context.Context, sendID string, status domain.KindleStatus, errSummary *string, finishedAt time.Time) error {
	summary := errSummary
	if summary != nil {
		sanitized := domain.SanitizeErrorText(*summary)
		summary = &sanitized
	}

	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(
			ctx,
			`UPDATE kindle_send SET status = ?, error = ?, finished_at = ? WHERE id = ?`,
			string(status),
			optionalString(summary),
			timeToMillis(finishedAt),
			sendID,
		)
		if err != nil {
			return err
		}

		_, err = tx.ExecContext(ctx, pruneKindleSends, kindleSendLimit)

		return err
	})
	if err != nil {
		return wrapRepositoryError(err, domain.ErrSettingRepositoryError)
	}

	return nil
}

func (r *KindleSendRepo) listUnreadSavedPages(ctx context.Context) ([]domain.SavedPage, error) {
	rows, err := r.read.QueryContext(ctx, `SELECT `+savedPageColumns+` FROM saved_page WHERE read = 0 ORDER BY id ASC`)
	if err != nil {
		return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	defer rows.Close()

	pages := []domain.SavedPage{}
	for rows.Next() {
		page, err := scanSavedPage(rows)
		if err != nil {
			return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
		}

		pages = append(pages, page)
	}

	if err := rows.Err(); err != nil {
		return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return pages, nil
}

func (r *KindleSendRepo) listFeedsWithUnread(ctx context.Context) ([]domain.Feed, error) {
	rows, err := r.read.QueryContext(
		ctx,
		`SELECT `+feedColumns+` FROM feed WHERE EXISTS (SELECT 1 FROM feed_item WHERE feed_item.feed_id = feed.id AND feed_item.read = 0) ORDER BY title ASC, id ASC`,
	)
	if err != nil {
		return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	defer rows.Close()

	feeds := []domain.Feed{}
	for rows.Next() {
		feed, err := scanFeed(rows)
		if err != nil {
			return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
		}

		feeds = append(feeds, feed)
	}

	if err := rows.Err(); err != nil {
		return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return feeds, nil
}

func (r *KindleSendRepo) listUnreadFeedItems(ctx context.Context, feed domain.Feed) ([]domain.FeedItem, error) {
	direction := `DESC`
	if feed.Order == domain.SortOrderOldest {
		direction = `ASC`
	}

	rows, err := r.read.QueryContext(ctx, `SELECT `+feedItemColumns+` FROM feed_item WHERE feed_id = ? AND read = 0 ORDER BY id `+direction, feed.ID)
	if err != nil {
		return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	defer rows.Close()

	items := []domain.FeedItem{}
	for rows.Next() {
		item, err := scanFeedItem(rows)
		if err != nil {
			return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
		}

		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return items, nil
}

func scanKindleSend(row interface{ Scan(...any) error }) (domain.KindleSendRecord, error) {
	var (
		id           string
		trigger      string
		status       string
		articleCount int64
		bookCount    int64
		errSummary   sql.NullString
		startedAt    int64
		finishedAt   sql.NullInt64
	)

	err := row.Scan(&id, &trigger, &status, &articleCount, &bookCount, &errSummary, &startedAt, &finishedAt)
	if err != nil {
		return domain.KindleSendRecord{}, err
	}

	return domain.KindleSendRecord{
		ID:           id,
		Trigger:      domain.KindleTrigger(trigger),
		Status:       domain.KindleStatus(status),
		ArticleCount: int(articleCount),
		BookCount:    int(bookCount),
		Error:        optionalText(errSummary),
		StartedAt:    millisToTime(startedAt),
		FinishedAt:   optionalMillis(finishedAt),
	}, nil
}
