package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"reader/internal/domain"
)

const (
	// The trailing three columns derive updated_at, failure_count, and last_error
	// from feed_refresh (see feed_refresh_feed_id_id); a feed holds no refresh state.
	feedColumns = `id, url, title, site_url, icon_url, folder_id, reader_mode, sort_order,
		(SELECT finished_at FROM feed_refresh WHERE feed_id = feed.id AND status = 'succeeded' ORDER BY id DESC LIMIT 1),
		(SELECT COUNT(*) FROM feed_refresh WHERE feed_id = feed.id AND status = 'failed'
			AND id > COALESCE((SELECT MAX(id) FROM feed_refresh WHERE feed_id = feed.id AND status = 'succeeded'), '')),
		(SELECT CASE WHEN status = 'failed' THEN error END FROM feed_refresh WHERE feed_id = feed.id ORDER BY id DESC LIMIT 1)`
	listFeedsQuery           = `SELECT ` + feedColumns + ` FROM feed ORDER BY title ASC, id ASC`
	getFeedQuery             = `SELECT ` + feedColumns + ` FROM feed WHERE id = ?`
	loadFolderIDsByNameQuery = `SELECT id, name FROM folder WHERE name IN (SELECT value FROM json_each(?))`
	insertFeedRefreshQuery   = `INSERT INTO feed_refresh (id, feed_id, status, error, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)`
	// Pruning keeps the newest feedRefreshLimit rows and the newest succeeded row,
	// which alone carries the feed's updated_at once enough failures follow it.
	pruneFeedRefreshQuery = `DELETE FROM feed_refresh WHERE feed_id = ?
		AND id NOT IN (SELECT id FROM feed_refresh WHERE feed_id = ? ORDER BY id DESC LIMIT ?)
		AND id NOT IN (SELECT id FROM feed_refresh WHERE feed_id = ? AND status = ? ORDER BY id DESC LIMIT 1)`
	feedRefreshLimit = 10
)

type FeedRepo struct {
	read  *sql.DB
	write *sql.DB
}

type opmlImporter struct {
	ctx        context.Context
	tx         *sql.Tx
	folderIDs  map[string]string
	result     domain.OPMLImportResult
	createdIDs []string
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

func (r *FeedRepo) Create(ctx context.Context, feed domain.Feed) (domain.Feed, error) {
	created, err := scanFeed(r.write.QueryRowContext(
		ctx,
		`INSERT INTO feed (id, url, title, folder_id, reader_mode, sort_order) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (url) DO NOTHING RETURNING `+feedColumns,
		feed.ID,
		feed.URL.Raw(),
		feed.Title,
		optionalString(feed.FolderID),
		string(feed.ReaderMode),
		string(feed.Order),
	))
	if err != nil {
		return domain.Feed{}, mapCreateFeedError(err, feed.URL)
	}

	return created, nil
}

func mapCreateFeedError(err error, url domain.NormalizedURL) error {
	if errors.Is(err, sql.ErrNoRows) {
		return domain.NewConflictURL(domain.ErrFeedAlreadyExists, url.RedactedString())
	}

	if isForeignKeyViolation(err) {
		return domain.NewError(domain.ErrFolderNotFound, nil)
	}

	return domain.NewError(domain.ErrFeedRepositoryError, err)
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

// RecordRefreshFailure is a no-op when the feed was deleted while its refresh ran.
func (r *FeedRepo) RecordRefreshFailure(ctx context.Context, feedID string, errSummary string, startedAt, finishedAt time.Time) error {
	summary := domain.SanitizeErrorText(errSummary)
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		return recordFeedRefresh(ctx, tx, feedID, domain.FeedRefreshFailed, &summary, startedAt, finishedAt)
	})
	if err != nil && !isForeignKeyViolation(err) {
		return domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	return nil
}

// ApplySync is a no-op when the feed was deleted while its refresh ran.
func (r *FeedRepo) ApplySync(ctx context.Context, feedID string, meta domain.FeedSyncMeta, startedAt, finishedAt time.Time, newItems []domain.FeedItem, deleteIDs []string) error {
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		found, err := updateFeedSyncMeta(ctx, tx, feedID, meta)
		if err != nil || !found {
			return err
		}

		if err := insertSyncItems(ctx, tx, feedID, newItems); err != nil {
			return err
		}

		if err := deleteSyncItems(ctx, tx, feedID, deleteIDs); err != nil {
			return err
		}

		return recordFeedRefresh(ctx, tx, feedID, domain.FeedRefreshSucceeded, nil, startedAt, finishedAt)
	})
	if err != nil {
		return wrapRepositoryError(err, domain.ErrFeedRepositoryError)
	}

	return nil
}

func updateFeedSyncMeta(ctx context.Context, tx *sql.Tx, feedID string, meta domain.FeedSyncMeta) (bool, error) {
	result, err := tx.ExecContext(
		ctx,
		`UPDATE feed SET title = ?, site_url = ?, icon_url = ? WHERE id = ?`,
		meta.Title,
		optionalString(meta.SiteURL),
		optionalString(meta.IconURL),
		feedID,
	)
	if err != nil {
		return false, err
	}

	affected, err := result.RowsAffected()

	return affected > 0, err
}

func recordFeedRefresh(ctx context.Context, tx *sql.Tx, feedID string, status domain.FeedRefreshStatus, errSummary *string, startedAt, finishedAt time.Time) error {
	_, err := tx.ExecContext(
		ctx,
		insertFeedRefreshQuery,
		domain.NewID(),
		feedID,
		string(status),
		optionalString(errSummary),
		timeToMillis(startedAt),
		timeToMillis(finishedAt),
	)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, pruneFeedRefreshQuery, feedID, feedID, feedRefreshLimit, feedID, string(domain.FeedRefreshSucceeded))

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

func (r *FeedRepo) ImportOPML(ctx context.Context, doc domain.OPMLDocument) (domain.OPMLImportResult, []string, error) {
	importer := &opmlImporter{ctx: ctx, result: domain.OPMLImportResult{SkippedFeeds: doc.SkippedInvalid}, createdIDs: []string{}}
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		return importer.run(tx, doc)
	})
	if err != nil {
		return domain.OPMLImportResult{}, nil, wrapRepositoryError(err, domain.ErrFeedRepositoryError)
	}

	return importer.result, importer.createdIDs, nil
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

	i.recordCreatedFeed(id)

	return nil
}

func (i *opmlImporter) recordCreatedFeed(id string) {
	i.result.ImportedFeeds++
	i.createdIDs = append(i.createdIDs, id)
}
