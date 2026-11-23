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

	defer closeRows(rows)

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

type claimKindleSendParams struct {
	sendID   string
	trigger  domain.KindleTrigger
	now      time.Time
	loc      *time.Location
	slotBusy bool
}

func (r *KindleSendRepo) ClaimManualSend(ctx context.Context, sendID string, now time.Time) (domain.ClaimedKindleSend, error) {
	return r.claimSend(ctx, claimKindleSendParams{
		sendID:  sendID,
		trigger: domain.KindleTriggerManual,
		now:     now.UTC(),
	})
}

func (r *KindleSendRepo) ClaimDueSend(ctx context.Context, sendID string, now time.Time, loc *time.Location, slotBusy bool) (domain.ClaimedKindleSend, error) {
	location := loc
	if location == nil {
		location = time.Local
	}

	return r.claimSend(ctx, claimKindleSendParams{
		sendID:   sendID,
		trigger:  domain.KindleTriggerScheduled,
		now:      now.UTC(),
		loc:      location,
		slotBusy: slotBusy,
	})
}

func (r *KindleSendRepo) claimSend(ctx context.Context, params claimKindleSendParams) (domain.ClaimedKindleSend, error) {
	id := params.sendID
	if id == "" {
		id = domain.NewID()
	}

	var claimed domain.ClaimedKindleSend
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		var txErr error
		claimed, txErr = claimSendInTx(ctx, tx, id, params)

		return txErr
	})
	if err != nil {
		return domain.ClaimedKindleSend{}, wrapRepositoryError(err, domain.ErrSettingRepositoryError)
	}

	return claimed, nil
}

func claimSendInTx(ctx context.Context, tx *sql.Tx, sendID string, params claimKindleSendParams) (domain.ClaimedKindleSend, error) {
	row, err := scanSettingsRow(tx.QueryRowContext(ctx, `SELECT `+settingColumns+` FROM setting WHERE id = 1`))
	if err != nil {
		return domain.ClaimedKindleSend{}, err
	}

	settings := settingsFromRow(row)
	ready, err := prepareSendClaimInTx(ctx, tx, settings, params)
	if err != nil || !ready {
		return domain.ClaimedKindleSend{}, err
	}

	running, err := hasRunningKindleSendInTx(ctx, tx)
	if err != nil {
		return domain.ClaimedKindleSend{}, err
	}

	if params.slotBusy || running {
		if params.trigger == domain.KindleTriggerManual {
			return domain.ClaimedKindleSend{}, domain.NewError(domain.ErrKindleSendInProgress, nil)
		}

		// Scheduled runs advance next_send_at (done above) and skip when active or
		// the local worker slot is still occupied per KD-SCHED-1.
		return domain.ClaimedKindleSend{}, nil
	}

	created := domain.KindleSendRecord{
		ID:        sendID,
		Trigger:   params.trigger,
		Status:    domain.KindleStatusRunning,
		StartedAt: params.now,
	}
	if err := insertRunningKindleSendInTx(ctx, tx, created); err != nil {
		return domain.ClaimedKindleSend{}, err
	}

	return domain.ClaimedKindleSend{
		Claimed:  true,
		Record:   created,
		Delivery: domain.CloneKindleDelivery(*settings.SMTP, settings.Kindle.KindleEmail),
	}, nil
}

func prepareSendClaimInTx(ctx context.Context, tx *sql.Tx, settings domain.Settings, params claimKindleSendParams) (bool, error) {
	usable := domain.IsKindleDeliveryUsable(settings)
	if params.trigger == domain.KindleTriggerManual {
		if !usable {
			return false, domain.NewError(domain.ErrKindleNotConfigured, nil)
		}

		return true, nil
	}

	if !usable || settings.Kindle.SendTime == nil || settings.Kindle.NextSendAt == nil {
		return false, nil
	}

	if settings.Kindle.NextSendAt.After(params.now) {
		return false, nil
	}

	nextSendAt, err := domain.ComputeNextSendAt(*settings.Kindle.SendTime, params.now, params.loc)
	if err != nil {
		return false, err
	}

	if _, err := tx.ExecContext(ctx, `UPDATE setting SET next_send_at = ? WHERE id = 1`, timeToMillis(nextSendAt)); err != nil {
		return false, err
	}

	return true, nil
}

func hasRunningKindleSendInTx(ctx context.Context, tx *sql.Tx) (bool, error) {
	var running int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM kindle_send WHERE status = 'running'`).Scan(&running); err != nil {
		return false, err
	}

	return running > 0, nil
}

func insertRunningKindleSendInTx(ctx context.Context, tx *sql.Tx, created domain.KindleSendRecord) error {
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

	_, err = tx.ExecContext(ctx, pruneKindleSends, kindleSendLimit)

	return err
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
		if err := incrementKindleSendBookInTx(ctx, tx, sendID, articleDelta); err != nil {
			return err
		}

		if err := markSavedPagesReadInTx(ctx, tx, savedPageIDs); err != nil {
			return err
		}

		return markFeedItemsReadInTx(ctx, tx, feedItemIDs)
	})
	if err != nil {
		return wrapRepositoryError(err, domain.ErrSettingRepositoryError)
	}

	return nil
}

func incrementKindleSendBookInTx(ctx context.Context, tx *sql.Tx, sendID string, articleDelta int) error {
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

	return nil
}

func markSavedPagesReadInTx(ctx context.Context, tx *sql.Tx, ids []string) error {
	return markTableReadInTx(ctx, tx, `UPDATE saved_page SET read = 1 WHERE id IN (SELECT value FROM json_each(?))`, ids)
}

func markFeedItemsReadInTx(ctx context.Context, tx *sql.Tx, ids []string) error {
	return markTableReadInTx(ctx, tx, `UPDATE feed_item SET read = 1 WHERE id IN (SELECT value FROM json_each(?))`, ids)
}

func markTableReadInTx(ctx context.Context, tx *sql.Tx, query string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}

	payload, err := encodeIDs(ids)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, query, payload)

	return err
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

	defer closeRows(rows)

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

	defer closeRows(rows)

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

	defer closeRows(rows)

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
