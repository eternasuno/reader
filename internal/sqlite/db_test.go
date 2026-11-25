package sqlite

import (
	"context"
	"errors"

	"database/sql"
	modernsqlite "modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"testing"
	"testing/fstest"
	"time"

	"reader/internal/domain"
)

var (
	_ domain.FolderRepository     = (*FolderRepo)(nil)
	_ domain.FeedRepository       = (*FeedRepo)(nil)
	_ domain.FeedItemRepository   = (*FeedItemRepo)(nil)
	_ domain.SavedPageRepository  = (*SavedPageRepo)(nil)
	_ domain.SettingRepository    = (*SettingRepo)(nil)
	_ domain.KindleSendRepository = (*KindleSendRepo)(nil)
)

func TestOpenMigratesDatabase(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "nested", "state", "reader.db")
	ctx := context.Background()

	store, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}

	if _, err := os.Stat(dbPath); err != nil {
		t.Fatalf("stat database file: %v", err)
	}

	if got := store.WriteDB().Stats().MaxOpenConnections; got != 1 {
		t.Fatalf("write pool max open connections = %d, want 1", got)
	}

	if got := store.ReadDB().Stats().MaxOpenConnections; got != readPoolConnections {
		t.Fatalf("read pool max open connections = %d, want %d", got, readPoolConnections)
	}

	for _, db := range []*sql.DB{store.WriteDB(), store.ReadDB()} {
		var journalMode string
		if err := db.QueryRowContext(ctx, `PRAGMA journal_mode`).Scan(&journalMode); err != nil {
			t.Fatalf("read journal mode: %v", err)
		}

		if journalMode != "wal" {
			t.Fatalf("journal mode = %q, want wal", journalMode)
		}
	}

	for _, table := range []string{"folder", "feed", "feed_item", "saved_page", "setting", "kindle_send", "kindle_send_book"} {
		var name string
		err := store.ReadDB().
			QueryRowContext(ctx, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, table).
			Scan(&name)
		if err != nil {
			t.Fatalf("table %q is missing: %v", table, err)
		}
	}

	settings, err := store.Settings().Get(ctx)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}

	if settings.Retention != 100 || settings.Provider != domain.ProviderDirect {
		t.Fatalf("default settings = %+v, want retention 100 and provider direct", settings)
	}

	if settings.SMTP != nil || settings.Kindle != nil || settings.JinaKey != nil || settings.BrowserEndpoint != nil {
		t.Fatalf("default settings carry unexpected optional values: %+v", settings)
	}

	if err := store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	reopened, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}

	defer reopened.Close()

	reloaded, err := reopened.Settings().Get(ctx)
	if err != nil {
		t.Fatalf("get settings after reopen: %v", err)
	}

	if reloaded.Retention != 100 || reloaded.Provider != domain.ProviderDirect {
		t.Fatalf("settings after reopen = %+v, want retention 100 and provider direct", reloaded)
	}
}

func TestWithTxRollsBackOnPanic(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "reader.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}

	defer store.Close()

	const panicValue = "transaction panic"
	func() {
		defer func() {
			if got := recover(); got != panicValue {
				t.Fatalf("panic = %v, want %q", got, panicValue)
			}
		}()

		_ = withTx(ctx, store.WriteDB(), func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, `INSERT INTO folder (id, name) VALUES (?, ?)`, "partial", "partial"); err != nil {
				t.Fatalf("insert partial folder: %v", err)
			}

			panic(panicValue)
		})
	}()

	writeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	if _, err := store.WriteDB().ExecContext(writeCtx, `INSERT INTO folder (id, name) VALUES (?, ?)`, "complete", "complete"); err != nil {
		t.Fatalf("write after panic: %v", err)
	}

	var count int
	if err := store.WriteDB().QueryRowContext(writeCtx, `SELECT COUNT(*) FROM folder WHERE id = ?`, "partial").Scan(&count); err != nil {
		t.Fatalf("query partial folder: %v", err)
	}

	if count != 0 {
		t.Fatalf("partial folder count = %d, want 0", count)
	}
}

func TestApplyMigrationsRollsBackFailedFile(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "migration-rollback.db")

	db, err := sql.Open("sqlite", sqliteDSN(dbPath, true))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}

	db.SetMaxOpenConns(1)
	defer func() { _ = db.Close() }()

	fsys := fstest.MapFS{
		"001_ok.sql": &fstest.MapFile{
			Data: []byte("-- +goose Up\nCREATE TABLE ok_table (id TEXT PRIMARY KEY) STRICT;\n"),
		},
		"002_bad.sql": &fstest.MapFile{
			Data: []byte(`-- +goose Up
				CREATE TABLE partial_table (id TEXT PRIMARY KEY) STRICT;
				INSERT INTO partial_table (id) VALUES ('one');
				INSERT INTO missing_table (id) VALUES ('boom');
			`),
		},
	}

	if err := applyMigrationsFromFS(ctx, db, fsys); err == nil {
		t.Fatal("expected failing migration to return an error")
	}

	var partialCount int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'partial_table'`).Scan(&partialCount); err != nil {
		t.Fatalf("check partial_table: %v", err)
	}

	if partialCount != 0 {
		t.Fatalf("partial_table count = %d, want 0 after rollback", partialCount)
	}

	var okCount int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'ok_table'`).Scan(&okCount); err != nil {
		t.Fatalf("check ok_table: %v", err)
	}

	if okCount != 1 {
		t.Fatalf("ok_table count = %d, want 1 from prior committed migration", okCount)
	}

	requireGooseVersions(t, db, 0, 1)
}

func TestOpenUpgradesDeployedDatabaseAndIsIdempotent(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "deployed.db")

	rawDB, err := sql.Open("sqlite", sqliteDSN(dbPath, true))
	if err != nil {
		t.Fatalf("open raw db: %v", err)
	}

	if _, err := rawDB.ExecContext(ctx, deployedSchemaSQL); err != nil {
		_ = rawDB.Close()
		t.Fatalf("exec deployed schema: %v", err)
	}

	if _, err := rawDB.ExecContext(ctx, `
		INSERT INTO folder (id, name) VALUES ('folder-1', 'Tech');
		INSERT INTO feed (id, url, title, folder_id) VALUES ('feed-1', 'https://example.com/feed.xml', 'Example Feed', 'folder-1');
		INSERT INTO feed_item (id, feed_id, url, title) VALUES ('item-1', 'feed-1', 'https://example.com/post-1', 'Post 1');
		INSERT INTO saved_page (id, url, title, content) VALUES ('page-1', 'https://example.com/saved-1', 'Saved 1', '<p>hello</p>');
	`); err != nil {
		_ = rawDB.Close()
		t.Fatalf("seed deployed rows: %v", err)
	}

	if err := rawDB.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	store, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("open deployed store: %v", err)
	}

	requireFeedIconURLColumn(t, store.ReadDB())
	requireGooseVersions(t, store.ReadDB(), 0, 1, 2)

	folders, err := store.Folders().List(ctx)
	if err != nil {
		_ = store.Close()
		t.Fatalf("list folders: %v", err)
	}
	if len(folders) != 1 || folders[0].ID != "folder-1" || folders[0].Name != "Tech" {
		_ = store.Close()
		t.Fatalf("folders = %+v, want folder-1/Tech", folders)
	}

	feeds, err := store.Feeds().List(ctx)
	if err != nil {
		_ = store.Close()
		t.Fatalf("list feeds: %v", err)
	}
	if len(feeds) != 1 || feeds[0].ID != "feed-1" || feeds[0].IconURL != nil {
		_ = store.Close()
		t.Fatalf("feeds = %+v, want feed-1 with nil IconURL", feeds)
	}

	item, err := store.FeedItems().GetByID(ctx, "item-1")
	if err != nil {
		_ = store.Close()
		t.Fatalf("get feed item: %v", err)
	}
	if item.Title != "Post 1" {
		_ = store.Close()
		t.Fatalf("feed item title = %q, want Post 1", item.Title)
	}

	page, err := store.SavedPages().GetByID(ctx, "page-1")
	if err != nil {
		_ = store.Close()
		t.Fatalf("get saved page: %v", err)
	}
	if page.Title != "Saved 1" || page.Content != "<p>hello</p>" {
		_ = store.Close()
		t.Fatalf("saved page = %+v, want Saved 1", page)
	}

	if err := store.Close(); err != nil {
		t.Fatalf("close upgraded store: %v", err)
	}

	reopened, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("reopen upgraded store: %v", err)
	}
	defer reopened.Close()

	requireFeedIconURLColumn(t, reopened.ReadDB())
	requireGooseVersions(t, reopened.ReadDB(), 0, 1, 2)
}

func TestOpenHandlesBranchCreatedDatabaseWithIconURL(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "branch.db")

	rawDB, err := sql.Open("sqlite", sqliteDSN(dbPath, true))
	if err != nil {
		t.Fatalf("open raw db: %v", err)
	}

	branchSchema := strings.Replace(
		deployedSchemaSQL,
		"  last_error TEXT,\n",
		"  last_error TEXT,\n  icon_url TEXT,\n",
		1,
	)
	if branchSchema == deployedSchemaSQL {
		_ = rawDB.Close()
		t.Fatal("failed to construct branch schema")
	}

	if _, err := rawDB.ExecContext(ctx, branchSchema); err != nil {
		_ = rawDB.Close()
		t.Fatalf("exec branch schema: %v", err)
	}

	if err := rawDB.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	store, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("open branch store: %v", err)
	}
	defer store.Close()

	requireFeedIconURLColumn(t, store.ReadDB())
	requireGooseVersions(t, store.ReadDB(), 0, 1, 2)
}

func TestOpenFailsAndRollsBackWhenInitMigrationFails(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "broken.db")

	rawDB, err := sql.Open("sqlite", sqliteDSN(dbPath, true))
	if err != nil {
		t.Fatalf("open raw db: %v", err)
	}

	if _, err := rawDB.ExecContext(ctx, `CREATE TABLE feed (id TEXT PRIMARY KEY) STRICT`); err != nil {
		_ = rawDB.Close()
		t.Fatalf("create conflicting feed table: %v", err)
	}

	if err := rawDB.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	store, err := Open(ctx, dbPath)
	if err == nil {
		_ = store.Close()
		t.Fatal("expected Open to fail when migration 1 fails")
	}
	if store != nil {
		t.Fatalf("store = %v, want nil on migration failure", store)
	}
	if !strings.Contains(err.Error(), "apply migrations") {
		t.Fatalf("error = %v, want migration error", err)
	}

	checkDB, err := sql.Open("sqlite", sqliteDSN(dbPath, true))
	if err != nil {
		t.Fatalf("reopen raw db: %v", err)
	}
	defer func() { _ = checkDB.Close() }()

	var folderCount int
	if err := checkDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'folder'`).Scan(&folderCount); err != nil {
		t.Fatalf("check folder table: %v", err)
	}
	if folderCount != 0 {
		t.Fatalf("folder table count = %d, want 0 after rollback", folderCount)
	}

	requireGooseVersions(t, checkDB, 0)
}

func TestOpenFreshDatabaseRunsAllMigrations(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "fresh.db"))
	if err != nil {
		t.Fatalf("open fresh store: %v", err)
	}
	defer store.Close()

	requireFeedIconURLColumn(t, store.ReadDB())
	requireGooseVersions(t, store.ReadDB(), 0, 1, 2)
}

func requireFeedIconURLColumn(t *testing.T, db *sql.DB) {
	t.Helper()

	var count int
	if err := db.QueryRowContext(
		context.Background(),
		`SELECT COUNT(*) FROM pragma_table_info('feed') WHERE name = 'icon_url'`,
	).Scan(&count); err != nil {
		t.Fatalf("query pragma_table_info(feed): %v", err)
	}

	if count != 1 {
		t.Fatalf("feed.icon_url column count = %d, want 1", count)
	}
}

func requireGooseVersions(t *testing.T, db *sql.DB, want ...int64) {
	t.Helper()

	rows, err := db.QueryContext(
		context.Background(),
		`SELECT version_id, is_applied FROM goose_db_version ORDER BY id`,
	)
	if err != nil {
		t.Fatalf("query goose_db_version: %v", err)
	}
	defer rows.Close()

	var got []int64
	for rows.Next() {
		var version int64
		var applied bool
		if err := rows.Scan(&version, &applied); err != nil {
			t.Fatalf("scan goose_db_version: %v", err)
		}
		if !applied {
			t.Fatalf("goose version %d has is_applied = false", version)
		}
		got = append(got, version)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate goose_db_version: %v", err)
	}

	if !slices.Equal(got, want) {
		t.Fatalf("goose versions = %v, want %v", got, want)
	}
}

const deployedSchemaSQL = `
CREATE TABLE IF NOT EXISTS folder (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
) STRICT;

CREATE INDEX IF NOT EXISTS folder_name_id ON folder (name, id);

CREATE TABLE IF NOT EXISTS feed (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  folder_id TEXT REFERENCES folder(id) ON DELETE SET NULL,
  updated_at INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  reader_mode TEXT NOT NULL DEFAULT 'default' CHECK (reader_mode IN ('default', 'extracted', 'embedded')),
  sort_order TEXT NOT NULL DEFAULT 'newest' CHECK (sort_order IN ('newest', 'oldest'))
) STRICT;

CREATE INDEX IF NOT EXISTS feed_folder ON feed (folder_id);
CREATE INDEX IF NOT EXISTS feed_title ON feed (title, id);

CREATE TABLE IF NOT EXISTS feed_item (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feed(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT,
  extracted_content TEXT,
  published_at INTEGER,
  read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)),
  UNIQUE (feed_id, url)
) STRICT;

CREATE INDEX IF NOT EXISTS feed_item_read_id ON feed_item (read, id);
CREATE INDEX IF NOT EXISTS feed_item_read_feed_id ON feed_item (read, feed_id);
CREATE INDEX IF NOT EXISTS feed_item_feed_id ON feed_item (feed_id, id);
CREATE INDEX IF NOT EXISTS feed_item_feed_id_url ON feed_item (feed_id, id, url);
CREATE INDEX IF NOT EXISTS feed_item_feed_read_id ON feed_item (feed_id, read, id);

CREATE TABLE IF NOT EXISTS saved_page (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  published_at INTEGER,
  read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1))
) STRICT;

CREATE INDEX IF NOT EXISTS saved_page_read_id ON saved_page (read, id);

CREATE TABLE IF NOT EXISTS setting (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  retention INTEGER NOT NULL DEFAULT 100 CHECK (retention >= 1),
  provider TEXT NOT NULL DEFAULT 'direct' CHECK (provider IN ('direct', 'jina', 'browser')),
  jina_key TEXT,
  browser_endpoint TEXT,
  kindle_email TEXT,
  sender_email TEXT,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_security TEXT CHECK (smtp_security IS NULL OR smtp_security IN ('tls', 'starttls')),
  smtp_user TEXT,
  smtp_password TEXT,
  send_time TEXT,
  next_send_at INTEGER
) STRICT;

INSERT INTO setting (id, retention, provider) VALUES (1, 100, 'direct') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS kindle_send (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  article_count INTEGER NOT NULL DEFAULT 0,
  book_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS kindle_send_book (
  send_id TEXT NOT NULL REFERENCES kindle_send(id) ON DELETE CASCADE,
  book_index INTEGER NOT NULL,
  PRIMARY KEY (send_id, book_index)
) STRICT;
`

func TestOpenResolvesRelativePaths(t *testing.T) {
	cases := []struct {
		name     string
		relative string
		topLevel string
		absolute bool
	}{
		{name: "absolute special characters", relative: filepath.Join("data?query=1#frag%20", "reader.db"), topLevel: "data?query=1#frag%20", absolute: true},
		{name: "default data dir", relative: filepath.Join(".data", "reader.db"), topLevel: ".data"},
		{name: "bare file name", relative: "reader.db", topLevel: "reader.db"},
		{name: "dot prefixed", relative: filepath.Join(".", "nested", "reader.db"), topLevel: "nested"},
		{name: "query fragment and percent", relative: filepath.Join("data?query=1#frag%20%2F", "reader.db"), topLevel: "data?query=1#frag%20%2F"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			workDir := t.TempDir()
			t.Chdir(workDir)

			ctx := context.Background()

			path := tc.relative
			if tc.absolute {
				path = filepath.Join(workDir, path)
			}

			store, err := Open(ctx, path)
			if err != nil {
				t.Fatalf("open store with relative path %q: %v", tc.relative, err)
			}

			folder, err := store.Folders().Create(ctx, domain.NewID(), "Relative")
			if err != nil {
				_ = store.Close()
				t.Fatalf("create folder: %v", err)
			}

			if err := store.Close(); err != nil {
				t.Fatalf("close store: %v", err)
			}

			if _, err := os.Stat(filepath.Join(workDir, tc.relative)); err != nil {
				t.Fatalf("database file is not at the relative path: %v", err)
			}

			entries, err := os.ReadDir(workDir)
			if err != nil {
				t.Fatalf("read work dir: %v", err)
			}

			if len(entries) != 1 || entries[0].Name() != tc.topLevel {
				t.Fatalf("work dir entries = %v, want only %q", entries, tc.topLevel)
			}

			reopened, err := Open(ctx, path)
			if err != nil {
				t.Fatalf("reopen store: %v", err)
			}

			defer reopened.Close()

			folders, err := reopened.Folders().List(ctx)
			if err != nil {
				t.Fatalf("list folders after reopen: %v", err)
			}

			if !slices.Contains(folders, folder) {
				t.Fatalf("folders after reopen = %+v, want %+v", folders, folder)
			}
		})
	}
}

func TestOpenEnforcesDataAtRestPermissions(t *testing.T) {
	cases := []struct {
		name  string
		umask int
	}{
		{name: "umask 022", umask: 0o022},
		{name: "umask 0", umask: 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			oldMask := syscall.Umask(tc.umask)
			t.Cleanup(func() {
				syscall.Umask(oldMask)
			})

			dataDir := filepath.Join(t.TempDir(), "data")
			dbPath := filepath.Join(dataDir, "reader.db")
			ctx := context.Background()

			store, err := Open(ctx, dbPath)
			if err != nil {
				t.Fatalf("open store: %v", err)
			}
			defer store.Close()

			requireFileMode(t, dataDir, 0o700)
			requireFileMode(t, dbPath, 0o600)

			if err := store.Settings().UpdateJinaKey(ctx, "secret-key"); err != nil {
				t.Fatalf("write setting in WAL mode: %v", err)
			}

			requireFileMode(t, dbPath+"-wal", 0o600)
			requireFileMode(t, dbPath+"-shm", 0o600)
		})
	}
}

func TestOpenTightensExistingFilesButLeavesSharedDirectory(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), "existing")
	dbPath := filepath.Join(dataDir, "reader.db")
	ctx := context.Background()

	initial, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("open initial store: %v", err)
	}

	if err := initial.Close(); err != nil {
		t.Fatalf("close initial store: %v", err)
	}

	if err := os.Chmod(dataDir, 0o755); err != nil {
		t.Fatalf("loosen data dir mode: %v", err)
	}

	if err := os.Chmod(dbPath, 0o644); err != nil {
		t.Fatalf("loosen db file mode: %v", err)
	}

	reopenedNoSidecars, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("reopen store without sidecars: %v", err)
	}

	requireFileMode(t, dataDir, 0o755)
	requireFileMode(t, dbPath, 0o600)

	if err := reopenedNoSidecars.Close(); err != nil {
		t.Fatalf("close reopened store: %v", err)
	}

	if err := os.Chmod(dataDir, 0o755); err != nil {
		t.Fatalf("loosen data dir mode: %v", err)
	}

	if err := os.Chmod(dbPath, 0o644); err != nil {
		t.Fatalf("loosen db file mode: %v", err)
	}

	for _, suffix := range []string{"-wal", "-shm"} {
		sidecar := dbPath + suffix
		if err := os.WriteFile(sidecar, nil, 0o644); err != nil {
			t.Fatalf("create loose sidecar %s: %v", suffix, err)
		}

		if err := os.Chmod(sidecar, 0o644); err != nil {
			t.Fatalf("loosen sidecar %s: %v", suffix, err)
		}
	}

	reopenedWithSidecars, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("reopen store with loose sidecars: %v", err)
	}
	defer reopenedWithSidecars.Close()

	requireFileMode(t, dataDir, 0o755)
	requireFileMode(t, dbPath, 0o600)
	requireFileMode(t, dbPath+"-wal", 0o600)
	requireFileMode(t, dbPath+"-shm", 0o600)
}

func TestPragmasApplyToEveryPooledConnection(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	var writeEnabled int
	if err := store.WriteDB().QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&writeEnabled); err != nil {
		t.Fatalf("read write pool foreign keys: %v", err)
	}

	if writeEnabled != 1 {
		t.Fatalf("write pool foreign_keys = %d, want 1", writeEnabled)
	}

	connections := make([]*sql.Conn, 0, readPoolConnections)
	for i := 0; i < readPoolConnections; i++ {
		conn, err := store.ReadDB().Conn(ctx)
		if err != nil {
			t.Fatalf("acquire reader %d: %v", i, err)
		}
		connections = append(connections, conn)
		defer conn.Close()
	}

	for i, conn := range connections {
		for _, pragma := range []struct {
			name string
			want int
		}{
			{"foreign_keys", 1}, {"busy_timeout", 5000}, {"synchronous", 1},
		} {
			var got int
			if err := conn.QueryRowContext(ctx, "PRAGMA "+pragma.name).Scan(&got); err != nil {
				t.Fatalf("reader %d %s: %v", i, pragma.name, err)
			}
			if got != pragma.want {
				t.Fatalf("reader %d %s = %d, want %d", i, pragma.name, got, pragma.want)
			}
		}
	}

	_, err := store.WriteDB().ExecContext(
		ctx,
		`INSERT INTO feed (id, url, title, folder_id) VALUES (?, ?, ?, ?)`,
		domain.NewID(),
		"https://example.com/orphan.xml",
		"orphan",
		"missing-folder",
	)
	var sqliteErr *modernsqlite.Error
	if !errors.As(err, &sqliteErr) || sqliteErr.Code() != sqlite3.SQLITE_CONSTRAINT_FOREIGNKEY {
		t.Fatalf("foreign key violation = %v, want SQLITE_CONSTRAINT_FOREIGNKEY", err)
	}
}

func TestQueryPlansUseIndexes(t *testing.T) {
	store := newTestStore(t)
	cursor := domain.NewID()

	tests := []struct {
		name           string
		query          string
		args           []any
		index          string
		allowTempBTree bool
	}{
		{
			name:  "list all newest",
			query: listAllQuery(domain.PageParams{Limit: 30}).query,
			args:  listAllQuery(domain.PageParams{Limit: 30}).args,
		},
		{
			name:  "list all with cursor",
			query: listAllQuery(domain.PageParams{Limit: 30, Cursor: &cursor}).query,
			args:  listAllQuery(domain.PageParams{Limit: 30, Cursor: &cursor}).args,
		},
		{
			name:  "list all unread",
			query: listAllQuery(domain.PageParams{Limit: 30, Unread: true}).query,
			args:  listAllQuery(domain.PageParams{Limit: 30, Unread: true}).args,
			index: "feed_item_read_id",
		},
		{
			name:  "list all oldest with cursor",
			query: listAllQuery(domain.PageParams{Limit: 30, Order: domain.SortOrderOldest, Cursor: &cursor}).query,
			args:  listAllQuery(domain.PageParams{Limit: 30, Order: domain.SortOrderOldest, Cursor: &cursor}).args,
		},
		{
			name:  "list all unread with cursor",
			query: listAllQuery(domain.PageParams{Limit: 30, Unread: true, Cursor: &cursor}).query,
			args:  listAllQuery(domain.PageParams{Limit: 30, Unread: true, Cursor: &cursor}).args,
			index: "feed_item_read_id",
		},
		{
			name:  "list feed newest",
			query: listByFeedQuery("feed", domain.PageParams{Limit: 30}).query,
			args:  listByFeedQuery("feed", domain.PageParams{Limit: 30}).args,
			index: "feed_item_feed_id",
		},
		{
			name:  "list feed oldest",
			query: listByFeedQuery("feed", domain.PageParams{Limit: 30, Order: domain.SortOrderOldest}).query,
			args:  listByFeedQuery("feed", domain.PageParams{Limit: 30, Order: domain.SortOrderOldest}).args,
			index: "feed_item_feed_id",
		},
		{
			name:  "list feed unread",
			query: listByFeedQuery("feed", domain.PageParams{Limit: 30, Unread: true}).query,
			args:  listByFeedQuery("feed", domain.PageParams{Limit: 30, Unread: true}).args,
			index: "feed_item_feed_read_id",
		},
		{
			name:  "list feed unread with cursor",
			query: listByFeedQuery("feed", domain.PageParams{Limit: 30, Unread: true, Cursor: &cursor}).query,
			args:  listByFeedQuery("feed", domain.PageParams{Limit: 30, Unread: true, Cursor: &cursor}).args,
			index: "feed_item_feed_read_id",
		},
		{
			name:           "list folder",
			query:          listByFolderQuery("folder", domain.PageParams{Limit: 30}).query,
			args:           listByFolderQuery("folder", domain.PageParams{Limit: 30}).args,
			index:          "feed_item_feed_id",
			allowTempBTree: true,
		},
		{
			name:           "list folder oldest",
			query:          listByFolderQuery("folder", domain.PageParams{Limit: 30, Order: domain.SortOrderOldest}).query,
			args:           listByFolderQuery("folder", domain.PageParams{Limit: 30, Order: domain.SortOrderOldest}).args,
			index:          "feed_item_feed_id",
			allowTempBTree: true,
		},
		{
			name:  "list folder unread with cursor",
			query: listByFolderQuery("folder", domain.PageParams{Limit: 30, Unread: true, Cursor: &cursor}).query,
			args:  listByFolderQuery("folder", domain.PageParams{Limit: 30, Unread: true, Cursor: &cursor}).args,
			index: "feed_item_read_id",
		},
	}

	for _, test := range tests {
		details := queryPlan(t, store, test.query, test.args...)
		requireIndexedPlan(t, test.name, details, test.index, test.allowTempBTree)
	}

	unreadDetails := queryPlan(t, store, unreadCountsQuery)
	requireIndexedPlan(t, "unread counts", unreadDetails, "feed_item_read_feed_id", false)

	for _, params := range []domain.PageParams{{Limit: 30}, {Limit: 30, Unread: true}, {Limit: 30, Unread: true, Cursor: &cursor}, {Limit: 30, Order: domain.SortOrderOldest, Cursor: &cursor}, {Limit: 30, Unread: true, Order: domain.SortOrderOldest}} {
		query, args := listSavedPagesQuery(params)
		requireIndexedPlan(t, "list saved pages", queryPlan(t, store, query, args...), "", false)
	}

	storedRefsPlan := queryPlan(t, store, `SELECT id, url FROM feed_item WHERE feed_id = ? ORDER BY id DESC`, "feed")
	requireIndexedPlan(t, "list stored refs by feed", storedRefsPlan, "feed_item_feed_id_url", false)
	if !slices.ContainsFunc(storedRefsPlan, func(detail string) bool {
		return strings.Contains(detail, "USING COVERING INDEX feed_item_feed_id_url")
	}) {
		t.Fatalf("stored refs plan is not a covering index:\n%s", strings.Join(storedRefsPlan, "\n"))
	}

	opmlFolderPlan := queryPlan(t, store, loadFolderIDsByNameQuery, `["Tech"]`)
	requireIndexedPlan(t, "opml folder lookup", opmlFolderPlan, "", false)
	if slices.ContainsFunc(opmlFolderPlan, func(detail string) bool {
		return strings.Contains(detail, "SCAN folder")
	}) {
		t.Fatalf("opml folder lookup scans folder table:\n%s", strings.Join(opmlFolderPlan, "\n"))
	}
}
