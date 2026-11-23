package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"reader/internal/domain"
)

const (
	feedItemColumns   = `id, feed_id, url, title, description, content, extracted_content, published_at, read`
	unreadCountsQuery = `SELECT feed_id, COUNT(*) FROM feed_item WHERE read = 0 GROUP BY feed_id HAVING COUNT(*) > 0`
)

type FeedItemRepo struct {
	read  *sql.DB
	write *sql.DB
}

type StoredFeedItemRef struct {
	ID  string
	URL domain.NormalizedURL
}

func (r *FeedItemRepo) ListAll(ctx context.Context, params domain.PageParams) (domain.PageResult[domain.FeedItem], error) {
	return r.list(ctx, listAllQuery(params))
}

func (r *FeedItemRepo) ListByFeed(ctx context.Context, feedID string, params domain.PageParams) (domain.PageResult[domain.FeedItem], error) {
	return r.list(ctx, listByFeedQuery(feedID, params))
}

func (r *FeedItemRepo) ListByFolder(ctx context.Context, folderID string, params domain.PageParams) (domain.PageResult[domain.FeedItem], error) {
	return r.list(ctx, listByFolderQuery(folderID, params))
}

func (r *FeedItemRepo) ListByFeedForRetention(ctx context.Context, feedID string) ([]domain.FeedItem, error) {
	rows, err := r.read.QueryContext(ctx, `SELECT `+feedItemColumns+` FROM feed_item WHERE feed_id = ? ORDER BY id DESC`, feedID)
	if err != nil {
		return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	defer closeRows(rows)

	items := []domain.FeedItem{}
	for rows.Next() {
		item, err := scanFeedItem(rows)
		if err != nil {
			return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
		}

		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return items, nil
}

func (r *FeedItemRepo) ListStoredRefsByFeed(ctx context.Context, feedID string) ([]StoredFeedItemRef, error) {
	rows, err := r.read.QueryContext(ctx, `SELECT id, url FROM feed_item WHERE feed_id = ? ORDER BY id DESC`, feedID)
	if err != nil {
		return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	defer closeRows(rows)

	refs := []StoredFeedItemRef{}
	for rows.Next() {
		var id string
		var rawURL string
		if err := rows.Scan(&id, &rawURL); err != nil {
			return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
		}

		refs = append(refs, StoredFeedItemRef{ID: id, URL: domain.NormalizedURLFromStored(rawURL)})
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

func (r *FeedItemRepo) UnreadCounts(ctx context.Context) ([]domain.FeedUnreadCount, error) {
	rows, err := r.read.QueryContext(ctx, unreadCountsQuery)
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
	if len(ids) == 0 {
		return nil
	}

	payload, err := encodeIDs(ids)
	if err != nil {
		return domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	_, err = r.write.ExecContext(ctx, `UPDATE feed_item SET read = 1 WHERE read = 0 AND id IN (SELECT value FROM json_each(?))`, payload)
	if err != nil {
		return domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return nil
}

func (r *FeedItemRepo) MarkAllRead(ctx context.Context) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE feed_item SET read = 1 WHERE read = 0`); err != nil {
		return domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return nil
}

func (r *FeedItemRepo) MarkFeedRead(ctx context.Context, feedID string) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE feed_item SET read = 1 WHERE feed_id = ? AND read = 0`, feedID); err != nil {
		return domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return nil
}

func (r *FeedItemRepo) MarkFolderRead(ctx context.Context, folderID string) error {
	_, err := r.write.ExecContext(ctx, `UPDATE feed_item SET read = 1 WHERE read = 0 AND feed_id IN (SELECT id FROM feed WHERE folder_id = ?)`, folderID)
	if err != nil {
		return domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return nil
}

func (r *FeedItemRepo) SaveExtractedContent(ctx context.Context, id string, content string) (*domain.FeedItem, error) {
	item, err := scanFeedItem(r.write.QueryRowContext(
		ctx,
		`UPDATE feed_item SET extracted_content = ? WHERE id = ? RETURNING `+feedItemColumns,
		content,
		id,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, domain.NewError(domain.ErrFeedItemNotFound, nil)
	}

	if err != nil {
		return nil, domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return &item, nil
}

type feedItemQuerySpec struct {
	source string
	join   string
	where  []string
	order  string
	args   []any
	limit  int
}

type feedItemQuery struct {
	query string
	args  []any
	limit int
}

func buildFeedItemsQuery(spec feedItemQuerySpec) feedItemQuery {
	columns := feedItemColumns
	if spec.join != "" {
		columns = qualifyColumns(spec.source, feedItemColumns)
	}

	query := `SELECT ` + columns + ` FROM ` + spec.source
	if spec.join != "" {
		query += ` ` + spec.join
	}

	if len(spec.where) > 0 {
		query += ` WHERE ` + strings.Join(spec.where, ` AND `)
	}

	query += ` ORDER BY ` + spec.order + ` LIMIT ?`

	return feedItemQuery{query: query, args: append(spec.args, spec.limit+1), limit: spec.limit}
}

func qualifyColumns(table string, columns string) string {
	parts := strings.Split(columns, `, `)
	for i, part := range parts {
		parts[i] = table + "." + part
	}

	return strings.Join(parts, `, `)
}

// pageDirection returns the keyset cursor comparison and ORDER BY direction.
func pageDirection(order domain.SortOrder) (string, string) {
	if order == domain.SortOrderOldest {
		return `>`, `ASC`
	}

	return `<`, `DESC`
}

func listAllQuery(params domain.PageParams) feedItemQuery {
	where := []string{}
	args := []any{}
	if params.Unread {
		where = append(where, `read = 0`)
	}

	comparison, order := pageDirection(params.Order)
	if params.Cursor != nil {
		where = append(where, `id `+comparison+` ?`)
		args = append(args, *params.Cursor)
	}

	return buildFeedItemsQuery(feedItemQuerySpec{
		source: `feed_item`,
		where:  where,
		order:  `id ` + order,
		args:   args,
		limit:  params.Limit,
	})
}

func listByFeedQuery(feedID string, params domain.PageParams) feedItemQuery {
	where := []string{`feed_id = ?`}
	args := []any{feedID}
	if params.Unread {
		where = append(where, `read = 0`)
	}

	comparison, order := pageDirection(params.Order)
	if params.Cursor != nil {
		where = append(where, `id `+comparison+` ?`)
		args = append(args, *params.Cursor)
	}

	return buildFeedItemsQuery(feedItemQuerySpec{
		source: `feed_item`,
		where:  where,
		order:  `id ` + order,
		args:   args,
		limit:  params.Limit,
	})
}

func listByFolderQuery(folderID string, params domain.PageParams) feedItemQuery {
	where := []string{`feed.folder_id = ?`}
	args := []any{folderID}
	if params.Unread {
		where = append(where, `feed_item.read = 0`)
	}

	comparison, order := pageDirection(params.Order)
	if params.Cursor != nil {
		where = append(where, `feed_item.id `+comparison+` ?`)
		args = append(args, *params.Cursor)
	}

	return buildFeedItemsQuery(feedItemQuerySpec{
		source: `feed_item`,
		join:   `JOIN feed ON feed_item.feed_id = feed.id`,
		where:  where,
		order:  `feed_item.id ` + order,
		args:   args,
		limit:  params.Limit,
	})
}

func (r *FeedItemRepo) list(ctx context.Context, query feedItemQuery) (domain.PageResult[domain.FeedItem], error) {
	rows, err := r.read.QueryContext(ctx, query.query, query.args...)
	if err != nil {
		return domain.PageResult[domain.FeedItem]{}, domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	defer closeRows(rows)

	items := []domain.FeedItem{}
	for rows.Next() {
		item, err := scanFeedItem(rows)
		if err != nil {
			return domain.PageResult[domain.FeedItem]{}, domain.NewError(domain.ErrFeedItemRepositoryError, err)
		}

		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return domain.PageResult[domain.FeedItem]{}, domain.NewError(domain.ErrFeedItemRepositoryError, err)
	}

	return paginateFeedItems(items, query.limit), nil
}

func scanFeedItem(row interface{ Scan(...any) error }) (domain.FeedItem, error) {
	var (
		id               string
		feedID           string
		rawURL           string
		title            string
		description      sql.NullString
		content          sql.NullString
		extractedContent sql.NullString
		publishedAt      sql.NullInt64
		read             int64
	)

	err := row.Scan(&id, &feedID, &rawURL, &title, &description, &content, &extractedContent, &publishedAt, &read)
	if err != nil {
		return domain.FeedItem{}, err
	}

	return domain.FeedItem{
		ID:               id,
		FeedID:           feedID,
		URL:              domain.NormalizedURLFromStored(rawURL),
		Title:            title,
		Description:      optionalText(description),
		Content:          optionalText(content),
		ExtractedContent: optionalText(extractedContent),
		PublishedAt:      optionalMillis(publishedAt),
		Read:             intBool(read),
	}, nil
}

func paginateFeedItems(items []domain.FeedItem, limit int) domain.PageResult[domain.FeedItem] {
	result := domain.PageResult[domain.FeedItem]{Items: items}
	if result.Items == nil {
		result.Items = []domain.FeedItem{}
	}

	if len(items) <= limit {
		return result
	}

	trimmed := items[:limit]
	cursor := trimmed[len(trimmed)-1].ID
	result.Items = trimmed
	result.Cursor = &cursor

	return result
}
