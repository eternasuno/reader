package sqlite

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"reader/internal/domain"
)

const (
	defaultRetention    = 100
	readPoolConnections = 4
	sqliteConstraint    = 19
	foreignKeyFailed    = "FOREIGN KEY constraint failed"
	uniqueFailedPrefix  = "UNIQUE constraint failed: "
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

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
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}

	writeDB, err := sql.Open("sqlite", writeDSN(dbPath))
	if err != nil {
		return nil, fmt.Errorf("open write pool: %w", err)
	}

	writeDB.SetMaxOpenConns(1)
	writeDB.SetMaxIdleConns(1)

	store, err := initialize(ctx, dbPath, writeDB)
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

	if err := applyMigrations(ctx, writeDB); err != nil {
		return nil, err
	}

	_, err := writeDB.ExecContext(
		ctx,
		`INSERT INTO setting (id, retention, provider) VALUES (1, ?, ?) ON CONFLICT (id) DO NOTHING`,
		defaultRetention,
		string(domain.ProviderDirect),
	)
	if err != nil {
		return nil, fmt.Errorf("initialize settings: %w", err)
	}

	readDB, err := sql.Open("sqlite", readDSN(dbPath))
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

func writeDSN(dbPath string) string {
	return "file:" + dbPath + "?_txlock=immediate&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)"
}

func readDSN(dbPath string) string {
	return "file:" + dbPath + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)"
}

func applyMigrations(ctx context.Context, db *sql.DB) error {
	names, err := fs.Glob(migrationFiles, "migrations/*.sql")
	if err != nil {
		return fmt.Errorf("list migrations: %w", err)
	}

	sort.Strings(names)

	for _, name := range names {
		payload, err := migrationFiles.ReadFile(name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", filepath.Base(name), err)
		}

		if _, err := db.ExecContext(ctx, string(payload)); err != nil {
			return fmt.Errorf("apply migration %s: %w", filepath.Base(name), err)
		}
	}

	return nil
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

func (s *Store) ImportOPML(ctx context.Context, doc domain.OPMLDocument) (domain.OPMLImportResult, []domain.Feed, error) {
	return importOPML(ctx, s.writeDB, doc)
}

func withTx(ctx context.Context, db *sql.DB, apply func(tx *sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}

	if err := apply(tx); err != nil {
		_ = tx.Rollback()

		return err
	}

	if err := tx.Commit(); err != nil {
		_ = tx.Rollback()

		return err
	}

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
