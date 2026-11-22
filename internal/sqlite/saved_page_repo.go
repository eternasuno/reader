package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"reader/internal/domain"
)

const savedPageColumns = `id, url, title, description, content, published_at, read`

type SavedPageRepo struct {
	read  *sql.DB
	write *sql.DB
}

func (r *SavedPageRepo) List(ctx context.Context, params domain.PageParams) (domain.PageResult[domain.SavedPage], error) {
	query, args := listSavedPagesQuery(params)

	rows, err := r.read.QueryContext(ctx, query, args...)
	if err != nil {
		return domain.PageResult[domain.SavedPage]{}, domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	defer closeRows(rows)

	pages := []domain.SavedPage{}
	for rows.Next() {
		page, err := scanSavedPage(rows)
		if err != nil {
			return domain.PageResult[domain.SavedPage]{}, domain.NewError(domain.ErrSavedPageRepositoryError, err)
		}

		pages = append(pages, page)
	}

	if err := rows.Err(); err != nil {
		return domain.PageResult[domain.SavedPage]{}, domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	return paginateSavedPages(pages, params.Limit), nil
}

func (r *SavedPageRepo) UnreadCount(ctx context.Context) (int, error) {
	var unread int64
	if err := r.read.QueryRowContext(ctx, `SELECT COUNT(*) FROM saved_page WHERE read = 0`).Scan(&unread); err != nil {
		return 0, domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	return int(unread), nil
}

func (r *SavedPageRepo) GetByID(ctx context.Context, id string) (*domain.SavedPage, error) {
	page, err := scanSavedPage(r.read.QueryRowContext(ctx, `SELECT `+savedPageColumns+` FROM saved_page WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}

	if err != nil {
		return nil, domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	return &page, nil
}

func (r *SavedPageRepo) GetByURL(ctx context.Context, url domain.NormalizedURL) (*domain.SavedPage, error) {
	page, err := scanSavedPage(r.read.QueryRowContext(ctx, `SELECT `+savedPageColumns+` FROM saved_page WHERE url = ?`, url.Raw()))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}

	if err != nil {
		return nil, domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	return &page, nil
}

func (r *SavedPageRepo) Create(ctx context.Context, page domain.SavedPage) (domain.SavedPage, error) {
	created, err := scanSavedPage(r.write.QueryRowContext(
		ctx,
		`INSERT INTO saved_page (id, url, title, description, content, published_at, read) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (url) DO NOTHING RETURNING `+savedPageColumns,
		page.ID,
		page.URL.Raw(),
		page.Title,
		optionalString(page.Description),
		page.Content,
		optionalTime(page.PublishedAt),
		boolInt(page.Read),
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.SavedPage{}, domain.NewConflictURL(domain.ErrSavedPageAlreadyExists, page.URL.RedactedString())
	}

	if err != nil {
		return domain.SavedPage{}, domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	return created, nil
}

func (r *SavedPageRepo) SetRead(ctx context.Context, id string, read bool) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE saved_page SET read = ? WHERE id = ?`, boolInt(read), id); err != nil {
		return domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	return nil
}

func (r *SavedPageRepo) MarkIDsRead(ctx context.Context, ids []string) error {
	if len(ids) == 0 {
		return nil
	}

	payload, err := encodeIDs(ids)
	if err != nil {
		return domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	_, err = r.write.ExecContext(ctx, `UPDATE saved_page SET read = 1 WHERE read = 0 AND id IN (SELECT value FROM json_each(?))`, payload)
	if err != nil {
		return domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	return nil
}

func (r *SavedPageRepo) MarkAllRead(ctx context.Context) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE saved_page SET read = 1 WHERE read = 0`); err != nil {
		return domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	return nil
}

func (r *SavedPageRepo) Delete(ctx context.Context, id string) error {
	if _, err := r.write.ExecContext(ctx, `DELETE FROM saved_page WHERE id = ?`, id); err != nil {
		return domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	return nil
}

func listSavedPagesQuery(params domain.PageParams) (string, []any) {
	query := `SELECT ` + savedPageColumns + ` FROM saved_page`
	where := []string{}
	args := []any{}
	if params.Unread {
		where = append(where, `read = 0`)
	}

	if params.Cursor != nil {
		where = append(where, `id < ?`)
		args = append(args, *params.Cursor)
	}

	if len(where) > 0 {
		query += ` WHERE ` + strings.Join(where, ` AND `)
	}

	query += ` ORDER BY id DESC LIMIT ?`

	return query, append(args, params.Limit+1)
}

func scanSavedPage(row interface{ Scan(...any) error }) (domain.SavedPage, error) {
	var (
		id          string
		rawURL      string
		title       string
		description sql.NullString
		content     string
		publishedAt sql.NullInt64
		read        int64
	)

	err := row.Scan(&id, &rawURL, &title, &description, &content, &publishedAt, &read)
	if err != nil {
		return domain.SavedPage{}, err
	}

	return domain.SavedPage{
		ID:          id,
		URL:         domain.NormalizedURLFromStored(rawURL),
		Title:       title,
		Description: optionalText(description),
		Content:     content,
		PublishedAt: optionalMillis(publishedAt),
		Read:        intBool(read),
	}, nil
}

func paginateSavedPages(pages []domain.SavedPage, limit int) domain.PageResult[domain.SavedPage] {
	result := domain.PageResult[domain.SavedPage]{Items: pages}
	if result.Items == nil {
		result.Items = []domain.SavedPage{}
	}

	if len(pages) <= limit {
		return result
	}

	trimmed := pages[:limit]
	cursor := trimmed[len(trimmed)-1].ID
	result.Items = trimmed
	result.Cursor = &cursor

	return result
}
