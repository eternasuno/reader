package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"reader/internal/domain"
)

const (
	readPoolConnections     = 4
	sqliteConstraint        = 19
	foreignKeyFailed        = "FOREIGN KEY constraint failed"
	uniqueFailedPrefix      = "UNIQUE constraint failed: "
	dataDirMode             = 0o700
	dbFileMode              = 0o600
	markSavedPagesReadQuery = `UPDATE saved_page SET read = 1 WHERE read = 0 AND id IN (SELECT value FROM json_each(?))`
	markFeedItemsReadQuery  = `UPDATE feed_item SET read = 1 WHERE read = 0 AND id IN (SELECT value FROM json_each(?))`
)

type Store struct {
	writeDB     *sql.DB
	readDB      *sql.DB
	folders     *FolderRepo
	feeds       *FeedRepo
	feedItems   *FeedItemRepo
	savedPages  *SavedPageRepo
	settings    *SettingRepo
	kindleSends *KindleSendRepo
}

func Open(ctx context.Context, dbPath string) (*Store, error) {
	absPath, err := filepath.Abs(dbPath)
	if err != nil {
		return nil, fmt.Errorf("resolve database path: %w", err)
	}

	if err := ensureDatabasePermissions(absPath); err != nil {
		return nil, err
	}

	writeDB, err := sql.Open("sqlite", sqliteDSN(absPath, true))
	if err != nil {
		return nil, fmt.Errorf("open write pool: %w", err)
	}

	writeDB.SetMaxOpenConns(1)
	writeDB.SetMaxIdleConns(1)

	store, err := initialize(ctx, absPath, writeDB)
	if err != nil {
		_ = writeDB.Close()

		return nil, err
	}

	return store, nil
}

func initialize(ctx context.Context, dbPath string, writeDB *sql.DB) (*Store, error) {
	if _, err := writeDB.ExecContext(ctx, `PRAGMA journal_mode = WAL`); err != nil {
		return nil, fmt.Errorf("enable write-ahead logging: %w", err)
	}

	if err := tightenSidecarPermissions(dbPath); err != nil {
		return nil, err
	}

	if err := applyMigrations(ctx, writeDB); err != nil {
		return nil, err
	}

	readDB, err := sql.Open("sqlite", sqliteDSN(dbPath, false))
	if err != nil {
		return nil, fmt.Errorf("open read pool: %w", err)
	}

	readDB.SetMaxOpenConns(readPoolConnections)

	if err := readDB.PingContext(ctx); err != nil {
		_ = readDB.Close()

		return nil, fmt.Errorf("ping read pool: %w", err)
	}

	store := &Store{writeDB: writeDB, readDB: readDB}
	store.folders = &FolderRepo{read: readDB, write: writeDB}
	store.feeds = &FeedRepo{read: readDB, write: writeDB}
	store.feedItems = &FeedItemRepo{read: readDB, write: writeDB}
	store.savedPages = &SavedPageRepo{read: readDB, write: writeDB}
	store.settings = &SettingRepo{read: readDB, write: writeDB}
	store.kindleSends = &KindleSendRepo{read: readDB, write: writeDB}

	return store, nil
}

func sqliteDSN(dbPath string, txLockImmediate bool) string {
	query := "_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)"
	if txLockImmediate {
		query = "_txlock=immediate&" + query
	}

	slashPath := filepath.ToSlash(dbPath)
	if !strings.HasPrefix(slashPath, "/") {
		slashPath = "/" + slashPath
	}

	uri := url.URL{
		Scheme:   "file",
		Path:     slashPath,
		RawQuery: query,
	}

	return uri.String()
}

func (s *Store) Close() error {
	return errors.Join(s.readDB.Close(), s.writeDB.Close())
}

func (s *Store) WriteDB() *sql.DB {
	return s.writeDB
}

func (s *Store) ReadDB() *sql.DB {
	return s.readDB
}

func (s *Store) Folders() *FolderRepo {
	return s.folders
}

func (s *Store) Feeds() *FeedRepo {
	return s.feeds
}

func (s *Store) FeedItems() *FeedItemRepo {
	return s.feedItems
}

func (s *Store) SavedPages() *SavedPageRepo {
	return s.savedPages
}

func (s *Store) Settings() *SettingRepo {
	return s.settings
}

func (s *Store) KindleSends() *KindleSendRepo {
	return s.kindleSends
}

func ensureDatabasePermissions(absPath string) error {
	dataDir := filepath.Dir(absPath)
	if err := os.MkdirAll(dataDir, dataDirMode); err != nil {
		return fmt.Errorf("create database directory: %w", err)
	}

	//nolint:gosec // absPath is the caller-configured SQLite database file path.
	file, err := os.OpenFile(absPath, os.O_CREATE|os.O_RDONLY, dbFileMode)
	if err != nil {
		return fmt.Errorf("create database file: %w", err)
	}

	if err := file.Close(); err != nil {
		return fmt.Errorf("close database file: %w", err)
	}

	if err := os.Chmod(absPath, dbFileMode); err != nil {
		return fmt.Errorf("chmod database file: %w", err)
	}

	return tightenSidecarPermissions(absPath)
}

func tightenSidecarPermissions(absPath string) error {
	for _, suffix := range []string{"-wal", "-shm"} {
		sidecar := absPath + suffix
		if err := os.Chmod(sidecar, dbFileMode); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("chmod database sidecar %s: %w", filepath.Base(sidecar), err)
		}
	}

	return nil
}

type rowsQuerier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func withTx(ctx context.Context, db *sql.DB, apply func(tx *sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}

	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	if err := apply(tx); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	committed = true

	return nil
}

func wrapRepositoryError(err error, code domain.ErrorCode) error {
	var domainErr *domain.DomainError
	if errors.As(err, &domainErr) {
		return domainErr
	}

	return domain.NewError(code, err)
}

func isConstraintViolation(err error, detail string) bool {
	var sqliteErr interface{ Code() int }
	if !errors.As(err, &sqliteErr) {
		return false
	}

	if sqliteErr.Code()&0xff != sqliteConstraint {
		return false
	}

	return strings.Contains(err.Error(), detail)
}

func isUniqueViolation(err error, columns string) bool {
	return isConstraintViolation(err, uniqueFailedPrefix+columns)
}

func isForeignKeyViolation(err error) bool {
	return isConstraintViolation(err, foreignKeyFailed)
}

func timeToMillis(value time.Time) int64 {
	return value.UTC().UnixMilli()
}

func millisToTime(value int64) time.Time {
	return time.UnixMilli(value).UTC()
}

func optionalMillis(value sql.NullInt64) *time.Time {
	if !value.Valid {
		return nil
	}

	converted := millisToTime(value.Int64)

	return &converted
}

func optionalTime(value *time.Time) any {
	if value == nil {
		return nil
	}

	return timeToMillis(*value)
}

func optionalText(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}

	text := value.String

	return &text
}

func optionalString(value *string) any {
	if value == nil {
		return nil
	}

	return *value
}

func boolInt(value bool) int {
	if value {
		return 1
	}

	return 0
}

func intBool(value int64) bool {
	return value != 0
}

func encodeIDs(ids []string) (string, error) {
	payload, err := json.Marshal(ids)
	if err != nil {
		return "", err
	}

	return string(payload), nil
}

func markIDsRead(ctx context.Context, exec execer, query string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}

	payload, err := encodeIDs(ids)
	if err != nil {
		return err
	}

	_, err = exec.ExecContext(ctx, query, payload)

	return err
}

func closeRows(rows *sql.Rows) {
	_ = rows.Close()
}
