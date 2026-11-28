package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"reader/internal/domain"
)

const (
	feedItemsByIDsQuery   = `SELECT ` + feedItemColumns + ` FROM feed_item JOIN (SELECT key, value FROM json_each(?)) AS requested ON feed_item.id = requested.value ORDER BY requested.key`
	feedItemColumns       = `id, feed_id, url, title, description, content, extracted_content, published_at, read`
	unreadCountsQuery     = `SELECT feed_id, COUNT(*) FROM feed_item WHERE read = 0 AND id <= ? GROUP BY feed_id`
	markAllItemsReadQuery = `UPDATE feed_item SET read = 1 WHERE read = 0 AND id <= ?`
	markFeedReadQuery     = `UPDATE feed_item SET read = 1 WHERE feed_id = ? AND read = 0 AND id <= ?`
	markFolderReadQuery   = `UPDATE feed_item SET read = 1 WHERE read = 0 AND feed_item.id <= ? AND feed_id IN (SELECT id FROM feed WHERE folder_id = ?)`
)

type FeedItemRepo struct {
	read  *sql.DB
	write *sql.DB
}

func (r *FeedItemRepo) SnapshotAll(ctx context.Context, params domain.SnapshotParams) ([]domain.FeedItemGroup, error) {
	query, args := groupedFeedItemSnapshotQuery(nil, params)

	return r.snapshot(ctx, query, args...)
}

func (r *FeedItemRepo) SnapshotByFolder(ctx context.Context, folderID string, params domain.SnapshotParams) ([]domain.FeedItemGroup, error) {
	query, args := groupedFeedItemSnapshotQuery(&folderID, params)

	return r.snapshot(ctx, query, args...)
}

func (r *FeedItemRepo) SnapshotByFeed(ctx context.Context, feedID string, order domain.SortOrder, params domain.SnapshotParams) ([]domain.FeedItemGroup, error) {
	query := singleFeedItemSnapshotQuery(order, params.Unread)

	return r.snapshot(ctx, query, feedID, params.Boundary, domain.ListSnapshotLimit+1)
}

func groupedFeedItemSnapshotQuery(folderID *string, params domain.SnapshotParams) (string, []any) {
	query := `SELECT fi.id, fi.feed_id FROM feed_item fi JOIN feed f ON f.id = fi.feed_id WHERE fi.id <= ?`
	args := []any{params.Boundary}
	if folderID != nil {
		query += ` AND f.folder_id = ?`
		args = append(args, *folderID)
	}

	if params.Unread {
		query += ` AND fi.read = 0`
	}

	query += ` ORDER BY f.title ASC, f.id ASC, CASE WHEN f.sort_order = ? THEN fi.id END ASC, fi.id DESC LIMIT ?`

	return query, append(args, string(domain.SortOrderOldest), domain.ListSnapshotLimit+1)
}

func singleFeedItemSnapshotQuery(order domain.SortOrder, unread bool) string {
	query := `SELECT id, feed_id FROM feed_item WHERE feed_id = ? AND id <= ?`
	if unread {
		query += ` AND read = 0`
	}

	direction := ` DESC`
	if order == domain.SortOrderOldest {
		direction = ` ASC`
	}

	return query + ` ORDER BY id` + direction + ` LIMIT ?`
}

func (r *FeedItemRepo) snapshot(ctx context.Context, query string, args ...any) ([]domain.FeedItemGroup, error) {
	rows, err := r.read.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	defer closeRows(rows)

	groups := []domain.FeedItemGroup{}
	count := 0
	for rows.Next() {
		if count == domain.ListSnapshotLimit {
			return nil, domain.NewError(domain.ErrFeedItemRepositoryError, errors.New("snapshot exceeds limit"))
		}

		var id, feedID string
		if err := rows.Scan(&id, &feedID); err != nil {
			return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
		}

		if len(groups) == 0 || groups[len(groups)-1].FeedID != feedID {
			groups = append(groups, domain.FeedItemGroup{FeedID: feedID})
		}

		group := &groups[len(groups)-1]
		group.IDs = append(group.IDs, id)
		count++
	}

	if err := rows.Err(); err != nil {
		return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return groups, nil
}

func (r *FeedItemRepo) GetByIDs(ctx context.Context, ids []string) ([]domain.FeedItem, error) {
	return getByIDs(ctx, r.read, feedItemsByIDsQuery, ids, scanFeedItem, domain.ErrFeedItemRepositoryError)
}

const listStoredRefsByFeedQuery = `SELECT id, url FROM feed_item WHERE feed_id = ? ORDER BY id DESC`

func listStoredRefsByFeed(ctx context.Context, querier rowsQuerier, feedID string) ([]domain.StoredRef, error) {
	rows, err := querier.QueryContext(ctx, listStoredRefsByFeedQuery, feedID)
	if err != nil {
		return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	defer closeRows(rows)

	refs := []domain.StoredRef{}
	for rows.Next() {
		var id string
		var rawURL string
		if err := rows.Scan(&id, &rawURL); err != nil {
			return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
		}

		parsedURL, err := domain.ParseNormalizedURL(rawURL, domain.ErrFeedUrlInvalid)
		if err != nil {
			return nil, domain.NewError(domain.ErrFeedItemRepositoryError, errors.New("invalid stored feed item url"))
		}

		refs = append(refs, domain.StoredRef{ID: id, URL: parsedURL})
	}

	if err := rows.Err(); err != nil {
		return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return refs, nil
}

func (r *FeedItemRepo) GetByID(ctx context.Context, id string) (*domain.FeedItem, error) {
	item, err := scanFeedItem(r.read.QueryRowContext(ctx, `SELECT `+feedItemColumns+` FROM feed_item WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}

	if err != nil {
		return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return &item, nil
}

func (r *FeedItemRepo) UnreadCounts(ctx context.Context, boundary string) ([]domain.FeedUnreadCount, error) {
	rows, err := r.read.QueryContext(ctx, unreadCountsQuery, boundary)
	if err != nil {
		return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	defer closeRows(rows)

	counts := []domain.FeedUnreadCount{}
	for rows.Next() {
		var feedID string
		var unread int64
		if err := rows.Scan(&feedID, &unread); err != nil {
			return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
		}

		counts = append(counts, domain.FeedUnreadCount{FeedID: feedID, Count: int(unread)})
	}

	if err := rows.Err(); err != nil {
		return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return counts, nil
}

func (r *FeedItemRepo) SetRead(ctx context.Context, id string, read bool) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE feed_item SET read = ? WHERE id = ?`, boolInt(read), id); err != nil {
		return domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return nil
}

func (r *FeedItemRepo) MarkIDsRead(ctx context.Context, ids []string) error {
	if err := markIDsRead(ctx, r.write, markFeedItemsReadQuery, ids); err != nil {
		return domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return nil
}

func (r *FeedItemRepo) MarkAllRead(ctx context.Context, boundary string) error {
	if _, err := r.write.ExecContext(ctx, markAllItemsReadQuery, boundary); err != nil {
		return domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return nil
}

func (r *FeedItemRepo) MarkFeedRead(ctx context.Context, feedID string, boundary string) error {
	if _, err := r.write.ExecContext(ctx, markFeedReadQuery, feedID, boundary); err != nil {
		return domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return nil
}

func (r *FeedItemRepo) MarkFolderRead(ctx context.Context, folderID string, boundary string) error {
	_, err := r.write.ExecContext(ctx, markFolderReadQuery, boundary, folderID)
	if err != nil {
		return domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return nil
}

func (r *FeedItemRepo) SaveExtractedContentIfEmpty(ctx context.Context, id string, content string) (*domain.FeedItem, bool, error) {
	var (
		result domain.FeedItem
		wrote  bool
	)

	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		var txErr error
		result, wrote, txErr = saveExtractedContentIfEmptyInTx(ctx, tx, id, content)

		return txErr
	})
	if err != nil {
		return nil, false, wrapRepositoryError(err, domain.ErrFeedItemRepositoryError)
	}

	return &result, wrote, nil
}

func saveExtractedContentIfEmptyInTx(ctx context.Context, tx *sql.Tx, id string, content string) (domain.FeedItem, bool, error) {
	existing, err := scanFeedItem(tx.QueryRowContext(ctx, `SELECT `+feedItemColumns+` FROM feed_item WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.FeedItem{}, false, domain.NewError(domain.ErrFeedItemNotFound, nil)
	}

	if err != nil {
		return domain.FeedItem{}, false, err
	}

	if existing.ExtractedContent != nil {
		return existing, false, nil
	}

	updated, err := scanFeedItem(tx.QueryRowContext(
		ctx,
		`UPDATE feed_item SET extracted_content = ? WHERE id = ? RETURNING `+feedItemColumns,
		content,
		id,
	))
	if err != nil {
		return domain.FeedItem{}, false, err
	}

	return updated, true, nil
}

func qualifyColumns(table string, columns string) string {
	parts := strings.Split(columns, `, `)
	for i, part := range parts {
		parts[i] = table + "." + part
	}

	return strings.Join(parts, `, `)
}

type feedItemRow struct {
	id               string
	feedID           string
	rawURL           string
	title            string
	description      sql.NullString
	content          sql.NullString
	extractedContent sql.NullString
	publishedAt      sql.NullInt64
	read             int64
}

func (r *feedItemRow) dest() []any {
	return []any{&r.id, &r.feedID, &r.rawURL, &r.title, &r.description, &r.content, &r.extractedContent, &r.publishedAt, &r.read}
}

func (r *feedItemRow) toDomain() (domain.FeedItem, error) {
	parsedURL, err := domain.ParseNormalizedURL(r.rawURL, domain.ErrFeedUrlInvalid)
	if err != nil {
		return domain.FeedItem{}, errors.New("invalid stored feed item url")
	}

	return domain.FeedItem{
		ID:               r.id,
		FeedID:           r.feedID,
		URL:              parsedURL,
		Title:            r.title,
		Description:      optionalText(r.description),
		Content:          optionalText(r.content),
		ExtractedContent: optionalText(r.extractedContent),
		PublishedAt:      optionalMillis(r.publishedAt),
		Read:             intBool(r.read),
	}, nil
}

func scanFeedItem(row interface{ Scan(...any) error }) (domain.FeedItem, error) {
	var raw feedItemRow
	if err := row.Scan(raw.dest()...); err != nil {
		return domain.FeedItem{}, err
	}

	return raw.toDomain()
}
