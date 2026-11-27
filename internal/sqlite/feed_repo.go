package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"reader/internal/domain"
)

const (
	feedBaseColumns = `id, url, title, site_url, icon_url, folder_id, reader_mode, sort_order`
	// The trailing three columns are the feed's refresh aggregates, stored in feed_schedule.
	feedColumns    = feedBaseColumns + `, last_success_at, consecutive_failures, last_error`
	feedFrom       = `feed JOIN feed_schedule ON feed_schedule.feed_id = feed.id`
	listFeedsQuery = `SELECT ` + feedColumns + ` FROM ` + feedFrom + ` ORDER BY title ASC, id ASC`
	getFeedQuery   = `SELECT ` + feedColumns + ` FROM ` + feedFrom + ` WHERE id = ?`
	// A new feed has no refresh history, so the joined aggregates are constants.
	createFeedQuery = `INSERT INTO feed (id, url, title, folder_id, reader_mode, sort_order) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (url) DO NOTHING RETURNING ` + feedBaseColumns + `, NULL, 0, NULL`
	insertFeedScheduleQuery  = `INSERT INTO feed_schedule (feed_id, next_refresh_at) VALUES (?, ?)`
	loadFolderIDsByNameQuery = `SELECT id, name FROM folder WHERE name IN (SELECT value FROM json_each(?))`
	requestRefreshQuery      = `UPDATE feed_schedule SET next_refresh_at = ? WHERE feed_id = ? AND next_refresh_at > ?`
	// Claiming picks the oldest due feed without a running attempt and records the
	// attempt in one statement; next_refresh_at stays until the attempt finishes.
	claimDueRefreshQuery = `INSERT INTO feed_refresh (id, feed_id, status, started_at)
		SELECT ?, feed_id, ?, ? FROM feed_schedule
		WHERE next_refresh_at <= ?
			AND NOT EXISTS (SELECT 1 FROM feed_refresh WHERE feed_refresh.feed_id = feed_schedule.feed_id AND feed_refresh.status = ?)
		ORDER BY next_refresh_at, feed_id LIMIT 1
		RETURNING feed_id`
	finishFeedRefreshQuery      = `UPDATE feed_refresh SET status = ?, error = ?, finished_at = ? WHERE id = ? AND feed_id = ? AND status = ?`
	releaseFeedRefreshQuery     = `DELETE FROM feed_refresh WHERE id = ? AND feed_id = ? AND status = ?`
	interruptFeedRefreshesQuery = `UPDATE feed_refresh SET status = ?, error = ?, finished_at = ? WHERE status = ? RETURNING feed_id`
	succeedFeedScheduleQuery    = `UPDATE feed_schedule SET next_refresh_at = ?, last_success_at = ?, consecutive_failures = 0, last_error = NULL WHERE feed_id = ?`
	failFeedScheduleQuery       = `UPDATE feed_schedule SET next_refresh_at = ?, consecutive_failures = consecutive_failures + 1, last_error = ? WHERE feed_id = ?`
	pruneFeedRefreshQuery       = `DELETE FROM feed_refresh WHERE feed_id = ? AND status <> ?
		AND id NOT IN (SELECT id FROM feed_refresh WHERE feed_id = ? AND status <> ? ORDER BY id DESC LIMIT ?)`
	feedRefreshLimit        = 10
	interruptedRefreshError = "interrupted"
)

type FeedRepo struct {
	read  *sql.DB
	write *sql.DB
}

type opmlImporter struct {
	ctx       context.Context
	tx        *sql.Tx
	now       time.Time
	folderIDs map[string]string
	result    domain.OPMLImportResult
}

func (r *FeedRepo) List(ctx context.Context) ([]domain.Feed, error) {
	feeds, err := queryFeeds(ctx, r.read)
	if err != nil {
		return nil, domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	return feeds, nil
}

func (r *FeedRepo) ExportOPML(ctx context.Context) ([]domain.OPMLExportFolder, []domain.Feed, error) {
	tx, err := r.read.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, nil, domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	defer func() { _ = tx.Rollback() }()

	folders, err := queryFolders(ctx, tx)
	if err != nil {
		return nil, nil, domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	feeds, err := queryFeeds(ctx, tx)
	if err != nil {
		return nil, nil, domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	exportFolders, topFeeds := groupOPMLFeeds(folders, feeds)

	return exportFolders, topFeeds, nil
}

func queryFeeds(ctx context.Context, querier rowsQuerier) ([]domain.Feed, error) {
	rows, err := querier.QueryContext(ctx, listFeedsQuery)
	if err != nil {
		return nil, err
	}

	defer closeRows(rows)

	feeds := []domain.Feed{}
	for rows.Next() {
		feed, err := scanFeed(rows)
		if err != nil {
			return nil, err
		}

		feeds = append(feeds, feed)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return feeds, nil
}

func groupOPMLFeeds(folders []domain.Folder, feeds []domain.Feed) ([]domain.OPMLExportFolder, []domain.Feed) {
	grouped := make(map[string][]domain.Feed, len(folders))
	topFeeds := make([]domain.Feed, 0, len(feeds))
	for _, feed := range feeds {
		if feed.FolderID == nil {
			topFeeds = append(topFeeds, feed)
			continue
		}

		grouped[*feed.FolderID] = append(grouped[*feed.FolderID], feed)
	}

	exportFolders := make([]domain.OPMLExportFolder, 0, len(folders))
	for _, folder := range folders {
		exportFolders = append(exportFolders, domain.OPMLExportFolder{Name: folder.Name, Feeds: grouped[folder.ID]})
	}

	return exportFolders, topFeeds
}

func (r *FeedRepo) GetByID(ctx context.Context, id string) (*domain.Feed, error) {
	feed, err := scanFeed(r.read.QueryRowContext(ctx, getFeedQuery, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}

	if err != nil {
		return nil, domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	return &feed, nil
}

// Create inserts the feed and its schedule, due at now, in one transaction.
func (r *FeedRepo) Create(ctx context.Context, feed domain.Feed, now time.Time) (domain.Feed, error) {
	var created domain.Feed
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		var err error
		created, err = scanFeed(tx.QueryRowContext(
			ctx,
			createFeedQuery,
			feed.ID,
			feed.URL.Raw(),
			feed.Title,
			optionalString(feed.FolderID),
			string(feed.ReaderMode),
			string(feed.Order),
		))
		if err != nil {
			return err
		}

		if err := insertFeedSchedule(ctx, tx, created.ID, now); err != nil {
			return err
		}

		return checkCurrentFeedItemBudget(ctx, tx)
	})
	if err != nil {
		return domain.Feed{}, mapCreateFeedError(err, feed.URL)
	}

	return created, nil
}

func insertFeedSchedule(ctx context.Context, tx *sql.Tx, feedID string, now time.Time) error {
	_, err := tx.ExecContext(ctx, insertFeedScheduleQuery, feedID, timeToMillis(now))

	return err
}

func mapCreateFeedError(err error, url domain.NormalizedURL) error {
	if errors.Is(err, sql.ErrNoRows) {
		return domain.NewConflictURL(domain.ErrFeedAlreadyExists, url.RedactedString())
	}

	if isForeignKeyViolation(err) {
		return domain.NewError(domain.ErrFolderNotFound, nil)
	}

	return wrapRepositoryError(err, domain.ErrFeedRepositoryError)
}

func checkCurrentFeedItemBudget(ctx context.Context, tx *sql.Tx) error {
	retention, err := loadRetention(ctx, tx)
	if err != nil {
		return err
	}

	return checkFeedItemBudget(ctx, tx, retention)
}

func checkFeedItemBudget(ctx context.Context, tx *sql.Tx, retention int) error {
	counts, err := storedCountsPerFeed(ctx, tx)
	if err != nil {
		return err
	}

	if domain.ExceedsFeedItemBudget(counts, retention) {
		return domain.NewError(domain.ErrFeedItemBudgetExceeded, nil)
	}

	return nil
}

func storedCountsPerFeed(ctx context.Context, tx *sql.Tx) ([]int, error) {
	rows, err := tx.QueryContext(ctx, `SELECT (SELECT COUNT(*) FROM feed_item WHERE feed_item.feed_id = feed.id) FROM feed`)
	if err != nil {
		return nil, err
	}

	defer closeRows(rows)

	counts := []int{}
	for rows.Next() {
		var count int
		if err := rows.Scan(&count); err != nil {
			return nil, err
		}

		counts = append(counts, count)
	}

	return counts, rows.Err()
}

func (r *FeedRepo) Delete(ctx context.Context, id string) error {
	if _, err := r.write.ExecContext(ctx, `DELETE FROM feed WHERE id = ?`, id); err != nil {
		return domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	return nil
}

func (r *FeedRepo) UpdateReaderMode(ctx context.Context, id string, mode domain.ReaderMode) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE feed SET reader_mode = ? WHERE id = ?`, string(mode), id); err != nil {
		return domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	return nil
}

func (r *FeedRepo) UpdateOrder(ctx context.Context, id string, order domain.SortOrder) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE feed SET sort_order = ? WHERE id = ?`, string(order), id); err != nil {
		return domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	return nil
}

func (r *FeedRepo) MoveToFolder(ctx context.Context, id string, folderID *string) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE feed SET folder_id = ? WHERE id = ?`, optionalString(folderID), id); err != nil {
		if isForeignKeyViolation(err) {
			return domain.NewError(domain.ErrFolderNotFound, nil)
		}

		return domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	return nil
}

// RequestRefresh makes the feed due at now unless it is already due, and ignores a
// missing feed. A running attempt overwrites next_refresh_at when it finishes.
func (r *FeedRepo) RequestRefresh(ctx context.Context, feedID string, now time.Time) error {
	if _, err := r.write.ExecContext(ctx, requestRefreshQuery, timeToMillis(now), feedID, timeToMillis(now)); err != nil {
		return domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	return nil
}

// ClaimDueRefresh records a running attempt for the oldest due feed that has none,
// and returns nil when no feed is due.
func (r *FeedRepo) ClaimDueRefresh(ctx context.Context, attemptID string, now time.Time) (*domain.Feed, error) {
	var claimed *domain.Feed
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		var err error
		claimed, err = claimDueRefreshInTx(ctx, tx, attemptID, now)

		return err
	})
	if err != nil {
		return nil, wrapRepositoryError(err, domain.ErrFeedRepositoryError)
	}

	return claimed, nil
}

func claimDueRefreshInTx(ctx context.Context, tx *sql.Tx, attemptID string, now time.Time) (*domain.Feed, error) {
	var feedID string
	err := tx.QueryRowContext(
		ctx,
		claimDueRefreshQuery,
		attemptID,
		string(domain.FeedRefreshRunning),
		timeToMillis(now),
		timeToMillis(now),
		string(domain.FeedRefreshRunning),
	).Scan(&feedID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}

	if err != nil {
		return nil, err
	}

	feed, err := scanFeed(tx.QueryRowContext(ctx, getFeedQuery, feedID))
	if err != nil {
		return nil, err
	}

	return &feed, nil
}

// SucceedRefresh finishes the running attempt, applies the sync, and schedules the
// next refresh. It writes nothing when the attempt is not running (feed deleted or
// outcome already recorded).
func (r *FeedRepo) SucceedRefresh(ctx context.Context, attemptID string, feedID string, meta domain.FeedSyncMeta, entries []domain.ParsedFeedEntry, finishedAt, nextRefreshAt time.Time) error {
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		finished, err := finishFeedRefresh(ctx, tx, attemptID, feedID, domain.FeedRefreshSucceeded, nil, finishedAt)
		if err != nil || !finished {
			return err
		}

		if err := applyFeedSync(ctx, tx, feedID, meta, entries); err != nil {
			return err
		}

		_, err = tx.ExecContext(ctx, succeedFeedScheduleQuery, timeToMillis(nextRefreshAt), timeToMillis(finishedAt), feedID)
		if err != nil {
			return err
		}

		return pruneFeedRefresh(ctx, tx, feedID)
	})
	if err != nil {
		return wrapRepositoryError(err, domain.ErrFeedRepositoryError)
	}

	return nil
}

// FailRefresh finishes the running attempt as failed, counts the failure, and
// schedules the next refresh. It writes nothing when the attempt is not running.
func (r *FeedRepo) FailRefresh(ctx context.Context, attemptID string, feedID string, errSummary string, finishedAt, nextRefreshAt time.Time) error {
	summary := domain.SanitizeErrorText(errSummary)
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		finished, err := finishFeedRefresh(ctx, tx, attemptID, feedID, domain.FeedRefreshFailed, &summary, finishedAt)
		if err != nil || !finished {
			return err
		}

		_, err = tx.ExecContext(ctx, failFeedScheduleQuery, timeToMillis(nextRefreshAt), summary, feedID)
		if err != nil {
			return err
		}

		return pruneFeedRefresh(ctx, tx, feedID)
	})
	if err != nil {
		return wrapRepositoryError(err, domain.ErrFeedRepositoryError)
	}

	return nil
}

// ReleaseRefresh drops the running attempt without an outcome, so the feed stays
// due and its aggregates are unchanged.
func (r *FeedRepo) ReleaseRefresh(ctx context.Context, attemptID string, feedID string) error {
	if _, err := r.write.ExecContext(ctx, releaseFeedRefreshQuery, attemptID, feedID, string(domain.FeedRefreshRunning)); err != nil {
		return domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	return nil
}

// RecoverRunningRefreshes marks attempts left running by a previous process as
// failed. The feed schedule is untouched, so those feeds stay due.
func (r *FeedRepo) RecoverRunningRefreshes(ctx context.Context, now time.Time) error {
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		feedIDs, err := interruptRunningRefreshes(ctx, tx, now)
		if err != nil {
			return err
		}

		for _, feedID := range feedIDs {
			if err := pruneFeedRefresh(ctx, tx, feedID); err != nil {
				return err
			}
		}

		return nil
	})
	if err != nil {
		return wrapRepositoryError(err, domain.ErrFeedRepositoryError)
	}

	return nil
}

func interruptRunningRefreshes(ctx context.Context, tx *sql.Tx, now time.Time) ([]string, error) {
	rows, err := tx.QueryContext(
		ctx,
		interruptFeedRefreshesQuery,
		string(domain.FeedRefreshFailed),
		interruptedRefreshError,
		timeToMillis(now),
		string(domain.FeedRefreshRunning),
	)
	if err != nil {
		return nil, err
	}

	defer closeRows(rows)

	feedIDs := []string{}
	for rows.Next() {
		var feedID string
		if err := rows.Scan(&feedID); err != nil {
			return nil, err
		}

		feedIDs = append(feedIDs, feedID)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return feedIDs, nil
}

// finishFeedRefresh reports whether the attempt was still running; false means
// the feed was deleted or the outcome was already recorded.
func finishFeedRefresh(ctx context.Context, tx *sql.Tx, attemptID string, feedID string, status domain.FeedRefreshStatus, errSummary *string, finishedAt time.Time) (bool, error) {
	result, err := tx.ExecContext(
		ctx,
		finishFeedRefreshQuery,
		string(status),
		optionalString(errSummary),
		timeToMillis(finishedAt),
		attemptID,
		feedID,
		string(domain.FeedRefreshRunning),
	)
	if err != nil {
		return false, err
	}

	affected, err := result.RowsAffected()

	return affected > 0, err
}

func pruneFeedRefresh(ctx context.Context, tx *sql.Tx, feedID string) error {
	running := string(domain.FeedRefreshRunning)
	_, err := tx.ExecContext(ctx, pruneFeedRefreshQuery, feedID, running, feedID, running, feedRefreshLimit)

	return err
}

func applyFeedSync(ctx context.Context, tx *sql.Tx, feedID string, meta domain.FeedSyncMeta, entries []domain.ParsedFeedEntry) error {
	retention, err := loadRetention(ctx, tx)
	if err != nil {
		return err
	}

	storedRefs, err := listStoredRefsByFeed(ctx, tx, feedID)
	if err != nil {
		return err
	}

	newItems, deleteIDs := domain.PlanFeedSync(feedID, entries, storedRefs, retention, domain.NewID)
	if err := updateFeedSyncMeta(ctx, tx, feedID, meta); err != nil {
		return err
	}

	if err := insertSyncItems(ctx, tx, feedID, newItems); err != nil {
		return err
	}

	return deleteSyncItems(ctx, tx, feedID, deleteIDs)
}

func updateFeedSyncMeta(ctx context.Context, tx *sql.Tx, feedID string, meta domain.FeedSyncMeta) error {
	_, err := tx.ExecContext(
		ctx,
		`UPDATE feed SET title = ?, site_url = ?, icon_url = ? WHERE id = ?`,
		meta.Title,
		optionalString(meta.SiteURL),
		optionalString(meta.IconURL),
		feedID,
	)

	return err
}

func insertSyncItems(ctx context.Context, tx *sql.Tx, feedID string, items []domain.FeedItem) error {
	for _, item := range items {
		_, err := tx.ExecContext(
			ctx,
			`INSERT INTO feed_item (id, feed_id, url, title, description, content, extracted_content, published_at, read) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (feed_id, url) DO NOTHING`,
			item.ID,
			feedID,
			item.URL.Raw(),
			item.Title,
			optionalString(item.Description),
			optionalString(item.Content),
			optionalString(item.ExtractedContent),
			optionalTime(item.PublishedAt),
			boolInt(item.Read),
		)
		if err != nil {
			return err
		}
	}

	return nil
}

func deleteSyncItems(ctx context.Context, tx *sql.Tx, feedID string, deleteIDs []string) error {
	if len(deleteIDs) == 0 {
		return nil
	}

	payload, err := encodeIDs(deleteIDs)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `DELETE FROM feed_item WHERE feed_id = ? AND id IN (SELECT value FROM json_each(?))`, feedID, payload)

	return err
}

// ImportOPML inserts the new feeds, each with a schedule due at now, in one transaction.
func (r *FeedRepo) ImportOPML(ctx context.Context, doc domain.OPMLDocument, now time.Time) (domain.OPMLImportResult, error) {
	importer := &opmlImporter{ctx: ctx, now: now, result: domain.OPMLImportResult{SkippedFeeds: doc.SkippedInvalid}}
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		if err := importer.run(tx, doc); err != nil {
			return err
		}

		return checkCurrentFeedItemBudget(ctx, tx)
	})
	if err != nil {
		return domain.OPMLImportResult{}, wrapRepositoryError(err, domain.ErrFeedRepositoryError)
	}

	return importer.result, nil
}

func scanFeed(row interface{ Scan(...any) error }) (domain.Feed, error) {
	var (
		id           string
		rawURL       string
		title        string
		siteURL      sql.NullString
		iconURL      sql.NullString
		folderID     sql.NullString
		readerMode   string
		sortOrder    string
		updatedAt    sql.NullInt64
		failureCount int64
		lastError    sql.NullString
	)

	err := row.Scan(&id, &rawURL, &title, &siteURL, &iconURL, &folderID, &readerMode, &sortOrder, &updatedAt, &failureCount, &lastError)
	if err != nil {
		return domain.Feed{}, err
	}

	parsedURL, err := domain.ParseNormalizedURL(rawURL, domain.ErrFeedUrlInvalid)
	if err != nil {
		return domain.Feed{}, errors.New("invalid stored feed url")
	}

	return domain.Feed{
		ID:           id,
		URL:          parsedURL,
		Title:        title,
		SiteURL:      optionalText(siteURL),
		IconURL:      optionalText(iconURL),
		FolderID:     optionalText(folderID),
		UpdatedAt:    optionalMillis(updatedAt),
		FailureCount: int(failureCount),
		LastError:    optionalText(lastError),
		ReaderMode:   domain.ReaderMode(readerMode),
		Order:        domain.SortOrder(sortOrder),
	}, nil
}

func (i *opmlImporter) run(tx *sql.Tx, doc domain.OPMLDocument) error {
	folderIDs, err := loadFolderIDs(i.ctx, tx, doc.Folders)
	if err != nil {
		return err
	}

	i.tx = tx
	i.folderIDs = folderIDs

	for _, name := range doc.Folders {
		if _, err := i.ensureFolder(name); err != nil {
			return err
		}
	}

	for _, input := range doc.Feeds {
		if err := i.importFeed(input); err != nil {
			return err
		}
	}

	return nil
}

func loadFolderIDs(ctx context.Context, tx *sql.Tx, names []string) (map[string]string, error) {
	if len(names) == 0 {
		return map[string]string{}, nil
	}

	payload, err := encodeIDs(names)
	if err != nil {
		return nil, err
	}

	rows, err := tx.QueryContext(ctx, loadFolderIDsByNameQuery, payload)
	if err != nil {
		return nil, err
	}

	defer closeRows(rows)

	folderIDs := make(map[string]string, len(names))
	for rows.Next() {
		var id string
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}

		folderIDs[name] = id
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return folderIDs, nil
}

func (i *opmlImporter) ensureFolder(name string) (string, error) {
	if id, ok := i.folderIDs[name]; ok {
		return id, nil
	}

	id := domain.NewID()
	if _, err := i.tx.ExecContext(i.ctx, `INSERT INTO folder (id, name) VALUES (?, ?)`, id, name); err != nil {
		return "", err
	}

	i.folderIDs[name] = id
	i.result.CreatedFolders++

	return id, nil
}

func (i *opmlImporter) resolveFeedFolder(folderName *string) (*string, error) {
	if folderName == nil {
		return nil, nil
	}

	id, err := i.ensureFolder(*folderName)
	if err != nil {
		return nil, err
	}

	return &id, nil
}

func (i *opmlImporter) importFeed(input domain.OPMLFeedInput) error {
	folderID, err := i.resolveFeedFolder(input.FolderName)
	if err != nil {
		return err
	}

	id := domain.NewID()
	result, err := i.tx.ExecContext(
		i.ctx,
		`INSERT INTO feed (id, url, title, folder_id, reader_mode, sort_order) VALUES (?, ?, ?, ?, 'default', 'newest') ON CONFLICT (url) DO NOTHING`,
		id,
		input.URL.Raw(),
		input.Title,
		optionalString(folderID),
	)
	if err != nil {
		return err
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}

	if affected == 0 {
		i.result.SkippedFeeds++

		return nil
	}

	i.result.ImportedFeeds++

	return insertFeedSchedule(i.ctx, i.tx, id, i.now)
}
