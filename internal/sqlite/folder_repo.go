package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"reader/internal/domain"
)

type FolderRepo struct {
	read  *sql.DB
	write *sql.DB
}

func (r *FolderRepo) List(ctx context.Context) ([]domain.Folder, error) {
	rows, err := r.read.QueryContext(ctx, `SELECT id, name FROM folder ORDER BY name ASC, id ASC`)
	if err != nil {
		return nil, domain.NewError(domain.ErrFolderRepositoryError, err)
	}

	defer rows.Close()

	folders := []domain.Folder{}
	for rows.Next() {
		folder := domain.Folder{}
		if err := rows.Scan(&folder.ID, &folder.Name); err != nil {
			return nil, domain.NewError(domain.ErrFolderRepositoryError, err)
		}

		folders = append(folders, folder)
	}

	if err := rows.Err(); err != nil {
		return nil, domain.NewError(domain.ErrFolderRepositoryError, err)
	}

	return folders, nil
}

func (r *FolderRepo) GetByID(ctx context.Context, id string) (*domain.Folder, error) {
	folder := domain.Folder{}
	err := r.read.QueryRowContext(ctx, `SELECT id, name FROM folder WHERE id = ?`, id).Scan(&folder.ID, &folder.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}

	if err != nil {
		return nil, domain.NewError(domain.ErrFolderRepositoryError, err)
	}

	return &folder, nil
}

func (r *FolderRepo) Create(ctx context.Context, id string, name string) (domain.Folder, error) {
	trimmed, err := domain.ValidateFolderName(name)
	if err != nil {
		return domain.Folder{}, err
	}

	folder := domain.Folder{}
	err = r.write.
		QueryRowContext(ctx, `INSERT INTO folder (id, name) VALUES (?, ?) ON CONFLICT (name) DO NOTHING RETURNING id, name`, id, trimmed).
		Scan(&folder.ID, &folder.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Folder{}, domain.NewError(domain.ErrFolderAlreadyExists, nil)
	}

	if err != nil {
		return domain.Folder{}, domain.NewError(domain.ErrFolderRepositoryError, err)
	}

	return folder, nil
}

func (r *FolderRepo) Rename(ctx context.Context, id string, name string) error {
	trimmed, err := domain.ValidateFolderName(name)
	if err != nil {
		return err
	}

	current, err := r.GetByID(ctx, id)
	if err != nil {
		return err
	}

	if current == nil {
		return domain.NewError(domain.ErrFolderNotFound, nil)
	}

	if current.Name == trimmed {
		return nil
	}

	_, err = r.write.ExecContext(ctx, `UPDATE folder SET name = ? WHERE id = ?`, trimmed, id)
	if err != nil {
		if isUniqueViolation(err, "folder.name") {
			return domain.NewError(domain.ErrFolderAlreadyExists, nil)
		}

		return domain.NewError(domain.ErrFolderRepositoryError, err)
	}

	return nil
}

func (r *FolderRepo) Delete(ctx context.Context, id string) error {
	if _, err := r.write.ExecContext(ctx, `DELETE FROM folder WHERE id = ?`, id); err != nil {
		return domain.NewError(domain.ErrFolderRepositoryError, err)
	}

	return nil
}
