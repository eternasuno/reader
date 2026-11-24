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
	unreadCountsQuery = `SELECT feed_id, COUNT(*) FROM feed_item WHERE read = 0 GROUP BY feed_id`
)

type FeedItemRepo struct {
	read  *sql.DB
	write *sql.DB
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

func (r *FeedItemRepo) ListStoredRefsByFeed(ctx context.Context, feedID string) ([]domain.StoredRef, error) {
	rows, err := r.read.QueryContext(ctx, `SELECT id, url FROM feed_item WHERE feed_id = ? ORDER BY id DESC`, feedID)
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

		parsedURL, err := domain.ParseStoredNormalizedURL(rawURL)
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
	if err := markIDsRead(ctx, r.write, markFeedItemsReadQuery, ids); err != nil {
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

	if existing.ExtractedContent != nil && strings.TrimSpace(*existing.ExtractedContent) != "" {
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

type feedItemQuery struct {
	query string
	args  []any
	limit int
}

func qualifyColumns(table string, columns string) string {
	parts := strings.Split(columns, `, `)
	for i, part := range parts {
		parts[i] = table + "." + part
	}

	return strings.Join(parts, `, `)
}

func listAllQuery(params domain.PageParams) feedItemQuery {
	where, tail, args := appendKeysetClauses(unqualifiedKeysetColumns, nil, nil, params)

	return feedItemQuery{
		query: `SELECT ` + feedItemColumns + ` FROM feed_item` + where + tail,
		args:  args,
		limit: params.Limit,
	}
}

func listByFeedQuery(feedID string, params domain.PageParams) feedItemQuery {
	where, tail, args := appendKeysetClauses(unqualifiedKeysetColumns, []string{`feed_id = ?`}, []any{feedID}, params)

	return feedItemQuery{
		query: `SELECT ` + feedItemColumns + ` FROM feed_item` + where + tail,
		args:  args,
		limit: params.Limit,
	}
}

func listByFolderQuery(folderID string, params domain.PageParams) feedItemQuery {
	columns := qualifyColumns(`feed_item`, feedItemColumns)
	where, tail, args := appendKeysetClauses(feedItemKeysetColumns, []string{`feed.folder_id = ?`}, []any{folderID}, params)

	return feedItemQuery{
		query: `SELECT ` + columns + ` FROM feed_item JOIN feed ON feed_item.feed_id = feed.id` + where + tail,
		args:  args,
		limit: params.Limit,
	}
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

	return finalizeKeysetPage(items, query.limit, func(item domain.FeedItem) string { return item.ID }), nil
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
	parsedURL, err := domain.ParseStoredNormalizedURL(r.rawURL)
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
