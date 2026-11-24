package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"reader/internal/domain"
)

const feedColumns = `id, url, title, folder_id, updated_at, failure_count, last_error, reader_mode, sort_order`

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
	rows, err := querier.QueryContext(ctx, `SELECT `+feedColumns+` FROM feed ORDER BY title ASC, id ASC`)
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
	feed, err := scanFeed(r.read.QueryRowContext(ctx, `SELECT `+feedColumns+` FROM feed WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}

	if err != nil {
		return nil, domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	return &feed, nil
}

func (r *FeedRepo) Create(ctx context.Context, feed domain.Feed) (domain.Feed, error) {
	readerMode, order := feedDefaults(feed)

	if err := ensureFolderExists(ctx, r.read, feed.FolderID); err != nil {
		return domain.Feed{}, err
	}

	created, err := scanFeed(r.write.QueryRowContext(
		ctx,
		`INSERT INTO feed (id, url, title, folder_id, reader_mode, sort_order) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (url) DO NOTHING RETURNING `+feedColumns,
		feed.ID,
		feed.URL.Raw(),
		feed.Title,
		optionalString(feed.FolderID),
		string(readerMode),
		string(order),
	))
	if err != nil {
		return domain.Feed{}, mapCreateFeedError(err, feed.URL)
	}

	return created, nil
}

func feedDefaults(feed domain.Feed) (domain.ReaderMode, domain.SortOrder) {
	readerMode := feed.ReaderMode
	if readerMode == "" {
		readerMode = domain.ReaderModeDefault
	}

	order := feed.Order
	if order == "" {
		order = domain.SortOrderNewest
	}

	return readerMode, order
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
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		if err := ensureFolderExists(ctx, tx, folderID); err != nil {
			return err
		}

		return updateFeedFolder(ctx, tx, id, folderID)
	})
	if err != nil {
		return wrapRepositoryError(err, domain.ErrFeedRepositoryError)
	}

	return nil
}

func updateFeedFolder(ctx context.Context, tx *sql.Tx, id string, folderID *string) error {
	if _, err := tx.ExecContext(ctx, `UPDATE feed SET folder_id = ? WHERE id = ?`, optionalString(folderID), id); err != nil {
		if isForeignKeyViolation(err) {
			return domain.NewError(domain.ErrFolderNotFound, nil)
		}

		return domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	return nil
}

func (r *FeedRepo) RecordRefreshFailure(ctx context.Context, id string, errSummary string) error {
	_, err := r.write.ExecContext(
		ctx,
		`UPDATE feed SET failure_count = failure_count + 1, last_error = ? WHERE id = ?`,
		domain.SanitizeErrorText(errSummary),
		id,
	)
	if err != nil {
		return domain.NewError(domain.ErrFeedRepositoryError, err)
	}

	return nil
}

func (r *FeedRepo) ApplySync(ctx context.Context, feedID string, newTitle string, updatedAt time.Time, newItems []domain.FeedItem, deleteIDs []string) error {
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		if err := updateFeedSyncMeta(ctx, tx, feedID, newTitle, updatedAt); err != nil {
			return err
		}

		if err := insertSyncItems(ctx, tx, feedID, newItems); err != nil {
			return err
		}

		return deleteSyncItems(ctx, tx, feedID, deleteIDs)
	})
	if err != nil {
		return wrapRepositoryError(err, domain.ErrFeedRepositoryError)
	}

	return nil
}

func updateFeedSyncMeta(ctx context.Context, tx *sql.Tx, feedID string, newTitle string, updatedAt time.Time) error {
	_, err := tx.ExecContext(
		ctx,
		`UPDATE feed SET title = ?, updated_at = ?, failure_count = 0, last_error = NULL WHERE id = ?`,
		newTitle,
		timeToMillis(updatedAt),
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
		folderID     sql.NullString
		updatedAt    sql.NullInt64
		failureCount int64
		lastError    sql.NullString
		readerMode   string
		sortOrder    string
	)

	err := row.Scan(&id, &rawURL, &title, &folderID, &updatedAt, &failureCount, &lastError, &readerMode, &sortOrder)
	if err != nil {
		return domain.Feed{}, err
	}

	parsedURL, err := domain.ParseStoredNormalizedURL(rawURL)
	if err != nil {
		return domain.Feed{}, errors.New("invalid stored feed url")
	}

	return domain.Feed{
		ID:           id,
		URL:          parsedURL,
		Title:        title,
		FolderID:     optionalText(folderID),
		UpdatedAt:    optionalMillis(updatedAt),
		FailureCount: int(failureCount),
		LastError:    optionalText(lastError),
		ReaderMode:   domain.ReaderMode(readerMode),
		Order:        domain.SortOrder(sortOrder),
	}, nil
}

func (i *opmlImporter) run(tx *sql.Tx, doc domain.OPMLDocument) error {
	folderIDs, err := loadFolderIDs(i.ctx, tx)
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

func loadFolderIDs(ctx context.Context, tx *sql.Tx) (map[string]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id, name FROM folder`)
	if err != nil {
		return nil, err
	}

	defer closeRows(rows)

	folderIDs := map[string]string{}
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

func (i *opmlImporter) ensureFolder(rawName string) (string, error) {
	name, err := domain.ValidateFolderName(rawName)
	if err != nil {
		return "", err
	}

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

type rowQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func ensureFolderExists(ctx context.Context, db rowQuerier, folderID *string) error {
	if folderID == nil {
		return nil
	}

	exists, err := folderExists(ctx, db, *folderID)
	if err != nil {
		return err
	}

	if !exists {
		return domain.NewError(domain.ErrFolderNotFound, nil)
	}

	return nil
}

func folderExists(ctx context.Context, db rowQuerier, id string) (bool, error) {
	var found int
	err := db.QueryRowContext(ctx, `SELECT 1 FROM folder WHERE id = ?`, id).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}

	if err != nil {
		return false, domain.NewError(domain.ErrFolderRepositoryError, err)
	}

	return true, nil
}
