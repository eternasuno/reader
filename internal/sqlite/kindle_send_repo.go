package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"reader/internal/domain"
)

const (
	kindleSendColumns = `id, trigger, status, article_count, book_count, error, started_at, finished_at`
	kindleSendLimit   = 20
	// Keeps the newest kindleSendLimit completed rows; running rows are never deleted.
	pruneKindleSends = `DELETE FROM kindle_send WHERE status != 'running'
		AND id NOT IN (SELECT id FROM kindle_send WHERE status != 'running' ORDER BY started_at DESC, id DESC LIMIT ?)`
)

type KindleSendRepo struct {
	read  *sql.DB
	write *sql.DB
}

func (r *KindleSendRepo) RecoverRunningOnStartup(ctx context.Context, now time.Time) error {
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(
			ctx,
			`UPDATE kindle_send SET status = 'failed', error = ?, finished_at = ? WHERE status = 'running'`,
			"server restarted while send was in progress",
			timeToMillis(now),
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

func (r *KindleSendRepo) ClaimManualSend(ctx context.Context, sendID string, now time.Time) (domain.ClaimedKindleSend, error) {
	var claimed domain.ClaimedKindleSend
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		var txErr error
		claimed, txErr = claimManualSendInTx(ctx, tx, sendID, now.UTC())

		return txErr
	})
	if err != nil {
		return domain.ClaimedKindleSend{}, wrapRepositoryError(err, domain.ErrSettingRepositoryError)
	}

	return claimed, nil
}

// ClaimDueSend claims the scheduled send once the stored next_send_at has
// passed, then advances it to the next future occurrence, so occurrences missed
// while the process was down collapse into one catch-up send. A busy local slot
// or a running send leaves the schedule due and writes nothing, so it fires on
// a later tick.
func (r *KindleSendRepo) ClaimDueSend(ctx context.Context, sendID string, now time.Time, slotBusy bool) (domain.ClaimedKindleSend, error) {
	var claimed domain.ClaimedKindleSend
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		var txErr error
		claimed, txErr = claimDueSendInTx(ctx, tx, sendID, now.UTC(), slotBusy)

		return txErr
	})
	if err != nil {
		return domain.ClaimedKindleSend{}, wrapRepositoryError(err, domain.ErrSettingRepositoryError)
	}

	return claimed, nil
}

func claimManualSendInTx(ctx context.Context, tx *sql.Tx, sendID string, now time.Time) (domain.ClaimedKindleSend, error) {
	settings, err := loadSettingsInTx(ctx, tx)
	if err != nil {
		return domain.ClaimedKindleSend{}, err
	}

	if settings.SMTP == nil || settings.Kindle == nil {
		return domain.ClaimedKindleSend{}, domain.NewError(domain.ErrKindleNotConfigured, nil)
	}

	running, err := hasRunningKindleSendInTx(ctx, tx)
	if err != nil {
		return domain.ClaimedKindleSend{}, err
	}

	if running {
		return domain.ClaimedKindleSend{}, domain.NewError(domain.ErrKindleSendInProgress, nil)
	}

	return startKindleSendInTx(ctx, tx, settings, sendID, domain.KindleTriggerManual, now)
}

func claimDueSendInTx(ctx context.Context, tx *sql.Tx, sendID string, now time.Time, slotBusy bool) (domain.ClaimedKindleSend, error) {
	settings, err := loadSettingsInTx(ctx, tx)
	if err != nil || !scheduledSendDue(settings, now) {
		return domain.ClaimedKindleSend{}, err
	}

	running, err := hasRunningKindleSendInTx(ctx, tx)
	if err != nil || running || slotBusy {
		return domain.ClaimedKindleSend{}, err
	}

	schedule := *settings.Kindle.Schedule
	loc, err := domain.LoadKindleLocation(schedule.Timezone)
	if err != nil {
		return domain.ClaimedKindleSend{}, err
	}

	claimed, err := startKindleSendInTx(ctx, tx, settings, sendID, domain.KindleTriggerScheduled, now)
	if err != nil {
		return domain.ClaimedKindleSend{}, err
	}

	nextSendAt := timeToMillis(domain.NextKindleOccurrence(schedule, loc, now))
	if _, err := tx.ExecContext(ctx, `UPDATE kindle_schedule SET next_send_at = ? WHERE setting_id = 1`, nextSendAt); err != nil {
		return domain.ClaimedKindleSend{}, err
	}

	claimed.ScheduleLocation = loc
	claimed.ScheduledFor = domain.LatestKindleOccurrence(schedule, loc, now)

	return claimed, nil
}

// scheduledSendDue reports whether delivery is configured and the stored
// schedule row's next send time has arrived.
func scheduledSendDue(settings domain.Settings, now time.Time) bool {
	if settings.SMTP == nil || settings.Kindle == nil || settings.Kindle.Schedule == nil || settings.Kindle.NextSendAt == nil {
		return false
	}

	return !settings.Kindle.NextSendAt.After(now)
}

func loadSettingsInTx(ctx context.Context, tx *sql.Tx) (domain.Settings, error) {
	row, err := loadSettingsRow(ctx, tx)
	if err != nil {
		return domain.Settings{}, err
	}

	return settingsFromRow(row)
}

func hasRunningKindleSendInTx(ctx context.Context, tx *sql.Tx) (bool, error) {
	var running int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM kindle_send WHERE status = 'running'`).Scan(&running); err != nil {
		return false, err
	}

	return running > 0, nil
}

func startKindleSendInTx(ctx context.Context, tx *sql.Tx, settings domain.Settings, sendID string, trigger domain.KindleTrigger, now time.Time) (domain.ClaimedKindleSend, error) {
	created := domain.KindleSendRecord{
		ID:        sendID,
		Trigger:   trigger,
		Status:    domain.KindleStatusRunning,
		StartedAt: now,
	}
	if err := insertRunningKindleSendInTx(ctx, tx, created); err != nil {
		return domain.ClaimedKindleSend{}, err
	}

	return domain.ClaimedKindleSend{
		Claimed: true,
		Record:  created,
		Delivery: domain.KindleDelivery{
			SMTP:        *settings.SMTP,
			KindleEmail: settings.Kindle.KindleEmail,
		},
	}, nil
}

func insertRunningKindleSendInTx(ctx context.Context, tx *sql.Tx, created domain.KindleSendRecord) error {
	_, err := tx.ExecContext(
		ctx,
		`INSERT INTO kindle_send (id, trigger, status, article_count, book_count, error, started_at, finished_at) VALUES (?, ?, ?, 0, 0, NULL, ?, NULL)`,
		created.ID,
		string(created.Trigger),
		string(domain.KindleStatusRunning),
		timeToMillis(created.StartedAt),
	)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, pruneKindleSends, kindleSendLimit)

	return err
}

func (r *KindleSendRepo) ListUnreadForKindle(ctx context.Context) ([]domain.KindleArticleRef, error) {
	tx, err := r.read.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	defer func() { _ = tx.Rollback() }()

	refs, err := listUnreadSavedPageRefs(ctx, tx)
	if err != nil {
		return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	refs, err = appendUnreadFeedItemRefs(ctx, tx, refs)
	if err != nil {
		return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	if err := tx.Commit(); err != nil {
		return nil, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return refs, nil
}

func (r *KindleSendRepo) GetKindleArticle(ctx context.Context, ref domain.KindleArticleRef) (*domain.SavedPage, *domain.Feed, *domain.FeedItem, error) {
	if ref.IsSavedPage {
		return r.getSavedPageForKindle(ctx, ref.ID)
	}

	return r.getFeedItemForKindle(ctx, ref.ID)
}

func (r *KindleSendRepo) getSavedPageForKindle(ctx context.Context, id string) (*domain.SavedPage, *domain.Feed, *domain.FeedItem, error) {
	page, err := scanSavedPage(r.read.QueryRowContext(ctx, `SELECT `+savedPageColumns+` FROM saved_page WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, nil, nil
	}

	if err != nil {
		return nil, nil, nil, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	return &page, nil, nil, nil
}

func (r *KindleSendRepo) getFeedItemForKindle(ctx context.Context, id string) (*domain.SavedPage, *domain.Feed, *domain.FeedItem, error) {
	var (
		raw        feedItemRow
		feedTitle  string
		readerMode string
	)

	query := `SELECT ` + qualifyColumns(`fi`, feedItemColumns) + `, f.title, f.reader_mode FROM feed_item fi JOIN feed f ON f.id = fi.feed_id WHERE fi.id = ?`
	dest := append(raw.dest(), &feedTitle, &readerMode)
	err := r.read.QueryRowContext(ctx, query, id).Scan(dest...)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, nil, nil
	}

	if err != nil {
		return nil, nil, nil, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	item, err := raw.toDomain()
	if err != nil {
		return nil, nil, nil, domain.NewError(domain.ErrSettingRepositoryError, err)
	}

	feed := domain.Feed{
		ID:         item.FeedID,
		Title:      feedTitle,
		ReaderMode: domain.ReaderMode(readerMode),
	}

	return nil, &feed, &item, nil
}

// RecordBookAccepted uses the running send's book_count as a sequence guard:
// the next expected book advances the counters and marks its articles read, a
// replayed earlier book changes nothing, and a skipped book is an error.
func (r *KindleSendRepo) RecordBookAccepted(ctx context.Context, sendID string, bookIndex int, savedPageIDs []string, feedItemIDs []string, articleDelta int) error {
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		advanced, err := advanceKindleSendBookInTx(ctx, tx, sendID, bookIndex, articleDelta)
		if err != nil || !advanced {
			return err
		}

		if err := markIDsRead(ctx, tx, markSavedPagesReadQuery, savedPageIDs); err != nil {
			return err
		}

		return markIDsRead(ctx, tx, markFeedItemsReadQuery, feedItemIDs)
	})
	if err != nil {
		return wrapRepositoryError(err, domain.ErrSettingRepositoryError)
	}

	return nil
}

// advanceKindleSendBookInTx records bookIndex on the running send and reports
// whether it was the next expected book; a replayed earlier book is not an
// error and writes nothing.
func advanceKindleSendBookInTx(ctx context.Context, tx *sql.Tx, sendID string, bookIndex int, articleDelta int) (bool, error) {
	var bookCount int
	err := tx.QueryRowContext(ctx, `SELECT book_count FROM kindle_send WHERE id = ? AND status = 'running'`, sendID).Scan(&bookCount)
	if errors.Is(err, sql.ErrNoRows) {
		return false, fmt.Errorf("kindle send %s is not running: %w", sendID, domain.ErrKindleSendNotFound)
	}

	if err != nil {
		return false, err
	}

	if bookCount > bookIndex {
		return false, nil
	}

	if bookCount < bookIndex {
		return false, fmt.Errorf("kindle send %s accepted book %d after only %d books", sendID, bookIndex, bookCount)
	}

	_, err = tx.ExecContext(
		ctx,
		`UPDATE kindle_send SET article_count = article_count + ?, book_count = ? WHERE id = ?`,
		articleDelta,
		bookIndex+1,
		sendID,
	)
	if err != nil {
		return false, err
	}

	return true, nil
}

func (r *KindleSendRepo) CompleteSend(ctx context.Context, sendID string, status domain.KindleStatus, errSummary *string, finishedAt time.Time) error {
	summary := errSummary
	if summary != nil {
		sanitized := domain.SanitizeErrorText(*summary)
		summary = &sanitized
	}

	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(
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

		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}

		if affected == 0 {
			return domain.ErrKindleSendNotFound
		}

		_, err = tx.ExecContext(ctx, pruneKindleSends, kindleSendLimit)

		return err
	})
	if err != nil {
		return wrapRepositoryError(err, domain.ErrSettingRepositoryError)
	}

	return nil
}

func listUnreadSavedPageRefs(ctx context.Context, tx *sql.Tx) ([]domain.KindleArticleRef, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM saved_page WHERE read = 0 ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}

	defer closeRows(rows)

	refs := []domain.KindleArticleRef{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}

		refs = append(refs, domain.KindleArticleRef{ID: id, IsSavedPage: true})
	}

	return refs, rows.Err()
}

func appendUnreadFeedItemRefs(ctx context.Context, tx *sql.Tx, refs []domain.KindleArticleRef) ([]domain.KindleArticleRef, error) {
	rows, err := tx.QueryContext(
		ctx,
		`SELECT fi.id
		 FROM feed_item fi
		 JOIN feed f ON f.id = fi.feed_id
		 WHERE fi.read = 0
		 ORDER BY f.title ASC, f.id ASC,
		   CASE WHEN f.sort_order = ? THEN fi.id END ASC,
		   CASE WHEN f.sort_order != ? THEN fi.id END DESC`,
		string(domain.SortOrderOldest),
		string(domain.SortOrderOldest),
	)
	if err != nil {
		return nil, err
	}

	defer closeRows(rows)

	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}

		refs = append(refs, domain.KindleArticleRef{ID: id})
	}

	return refs, rows.Err()
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
