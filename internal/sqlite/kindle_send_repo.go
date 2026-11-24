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
	pruneKindleSends  = `DELETE FROM kindle_send WHERE status != 'running' AND id NOT IN (SELECT id FROM kindle_send WHERE status != 'running' ORDER BY started_at DESC, id DESC LIMIT ?)`
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

func (r *KindleSendRepo) RecordBookAccepted(ctx context.Context, sendID string, bookIndex int, savedPageIDs []string, feedItemIDs []string, articleDelta int) error {
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		inserted, err := recordKindleSendBookInTx(ctx, tx, sendID, bookIndex)
		if err != nil {
			return err
		}

		if !inserted {
			return nil
		}

		if err := incrementKindleSendBookInTx(ctx, tx, sendID, articleDelta); err != nil {
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

func recordKindleSendBookInTx(ctx context.Context, tx *sql.Tx, sendID string, bookIndex int) (bool, error) {
	if err := requireRunningKindleSendInTx(ctx, tx, sendID); err != nil {
		return false, err
	}

	result, err := tx.ExecContext(
		ctx,
		`INSERT OR IGNORE INTO kindle_send_book (send_id, book_index) VALUES (?, ?)`,
		sendID,
		bookIndex,
	)
	if err != nil {
		return false, err
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}

	return affected > 0, nil
}

func requireRunningKindleSendInTx(ctx context.Context, tx *sql.Tx, sendID string) error {
	var exists int
	err := tx.QueryRowContext(ctx, `SELECT 1 FROM kindle_send WHERE id = ? AND status = 'running'`, sendID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("kindle send %s is not running", sendID)
	}

	return err
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

	return requireSingleKindleSendRow(result, sendID, "is not running")
}

func requireSingleKindleSendRow(result sql.Result, sendID string, reason string) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}

	if affected != 1 {
		return fmt.Errorf("kindle send %s %s", sendID, reason)
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
