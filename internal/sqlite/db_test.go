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

	defer func() { _ = db.Close() }()

	fsys := fstest.MapFS{
		"migrations/001_ok.sql": &fstest.MapFile{
			Data: []byte(`CREATE TABLE ok_table (id TEXT PRIMARY KEY) STRICT;`),
		},
		"migrations/002_bad.sql": &fstest.MapFile{
			Data: []byte(`
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
}

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
