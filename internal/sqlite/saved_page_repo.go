package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"reader/internal/domain"
)

const (
	savedPagesByIDsQuery       = `SELECT ` + savedPageColumns + ` FROM saved_page JOIN (SELECT key, value FROM json_each(?)) AS requested ON saved_page.id = requested.value ORDER BY requested.key`
	savedPageColumns           = `id, url, title, description, content, published_at, read`
	savedPageUnreadCountQuery  = `SELECT COUNT(*) FROM saved_page WHERE read = 0 AND id <= ?`
	markAllSavedPagesReadQuery = `UPDATE saved_page SET read = 1 WHERE read = 0 AND id <= ?`
)

type SavedPageRepo struct {
	read  *sql.DB
	write *sql.DB
}

func (r *SavedPageRepo) Snapshot(ctx context.Context, params domain.SnapshotParams) ([]string, error) {
	query, args := savedPageSnapshotQuery(params)
	rows, err := r.read.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	defer closeRows(rows)

	ids := []string{}
	for rows.Next() {
		if len(ids) == domain.ListSnapshotLimit {
			return nil, domain.NewError(domain.ErrSavedPageRepositoryError, errors.New("snapshot exceeds limit"))
		}

		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, domain.NewError(domain.ErrSavedPageRepositoryError, err)
		}

		ids = append(ids, id)
	}

	if err := rows.Err(); err != nil {
		return nil, domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	return ids, nil
}

func savedPageSnapshotQuery(params domain.SnapshotParams) (string, []any) {
	query, args := appendUnreadFilter(`SELECT id FROM saved_page WHERE id <= ?`, []any{params.Boundary}, params)

	return query + ` ORDER BY id DESC LIMIT ?`, append(args, domain.ListSnapshotLimit+1)
}

func (r *SavedPageRepo) GetByIDs(ctx context.Context, ids []string) ([]domain.SavedPage, error) {
	return getByIDs(ctx, r.read, savedPagesByIDsQuery, ids, scanSavedPage, domain.ErrSavedPageRepositoryError)
}

func (r *SavedPageRepo) UnreadCount(ctx context.Context, boundary string) (int, error) {
	var unread int64
	if err := r.read.QueryRowContext(ctx, savedPageUnreadCountQuery, boundary).Scan(&unread); err != nil {
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

func (r *SavedPageRepo) GetIDByURL(ctx context.Context, url domain.NormalizedURL) (string, bool, error) {
	var id string
	err := r.read.QueryRowContext(ctx, `SELECT id FROM saved_page WHERE url = ?`, url.Raw()).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}

	if err != nil {
		return "", false, domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	return id, true, nil
}

func (r *SavedPageRepo) Create(ctx context.Context, page domain.SavedPage) (domain.SavedPage, error) {
	var created domain.SavedPage
	err := withTx(ctx, r.write, func(tx *sql.Tx) error {
		row, insertErr := scanSavedPage(tx.QueryRowContext(
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
		if insertErr == nil {
			created = row

			return enforceSavedPageLimit(ctx, tx)
		}

		if !errors.Is(insertErr, sql.ErrNoRows) {
			return insertErr
		}

		var existingID string
		lookupErr := tx.QueryRowContext(ctx, `SELECT id FROM saved_page WHERE url = ?`, page.URL.Raw()).Scan(&existingID)
		if lookupErr != nil && !errors.Is(lookupErr, sql.ErrNoRows) {
			return lookupErr
		}

		return domain.NewSavedPageConflict(existingID, page.URL.RedactedString())
	})
	if err != nil {
		return domain.SavedPage{}, wrapRepositoryError(err, domain.ErrSavedPageRepositoryError)
	}

	return created, nil
}

func enforceSavedPageLimit(ctx context.Context, tx *sql.Tx) error {
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM saved_page`).Scan(&count); err != nil {
		return err
	}

	if count > domain.SavedPageLimit {
		return domain.NewError(domain.ErrSavedPageLimitExceeded, nil)
	}

	return nil
}

func (r *SavedPageRepo) SetRead(ctx context.Context, id string, read bool) error {
	if _, err := r.write.ExecContext(ctx, `UPDATE saved_page SET read = ? WHERE id = ?`, boolInt(read), id); err != nil {
		return domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	return nil
}

func (r *SavedPageRepo) MarkIDsRead(ctx context.Context, ids []string) error {
	if err := markIDsRead(ctx, r.write, markSavedPagesReadQuery, ids); err != nil {
		return domain.NewError(domain.ErrSavedPageRepositoryError, err)
	}

	return nil
}

func (r *SavedPageRepo) MarkAllRead(ctx context.Context, boundary string) error {
	if _, err := r.write.ExecContext(ctx, markAllSavedPagesReadQuery, boundary); err != nil {
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

	parsedURL, err := domain.ParseNormalizedURL(rawURL, domain.ErrFeedUrlInvalid)
	if err != nil {
		return domain.SavedPage{}, errors.New("invalid stored saved page url")
	}

	return domain.SavedPage{
		ID:          id,
		URL:         parsedURL,
		Title:       title,
		Description: optionalText(description),
		Content:     content,
		PublishedAt: optionalMillis(publishedAt),
		Read:        intBool(read),
	}, nil
}
