package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/pressly/goose/v3"
	modernsqlite "modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"

	"reader/internal/domain"
	"reader/internal/sqlite/migrations"
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

	for _, table := range []string{"folder", "feed", "feed_item", "saved_page", "feed_schedule", "feed_refresh", "setting", "kindle_schedule", "kindle_send"} {
		var name string
		err := store.ReadDB().
			QueryRowContext(ctx, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, table).
			Scan(&name)
		if err != nil {
			t.Fatalf("table %q is missing: %v", table, err)
		}
	}

	if got := tableCount(t, store.ReadDB(), "kindle_send_book"); got != 0 {
		t.Fatalf("kindle_send_book tables = %d, want none", got)
	}

	settings, err := store.Settings().Get(ctx)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}

	if settings.Retention != 100 {
		t.Fatalf("default settings = %+v, want retention 100", settings)
	}

	if settings.SMTP != nil || settings.Kindle != nil || settings.Browserless != nil {
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

	if reloaded.Retention != 100 {
		t.Fatalf("settings after reopen = %+v, want retention 100", reloaded)
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

func createOKTable(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `CREATE TABLE ok_table (id TEXT PRIMARY KEY) STRICT`)

	return err
}

func failAfterPartialWrite(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(
		ctx,
		`CREATE TABLE partial_table (id TEXT PRIMARY KEY) STRICT;
		INSERT INTO partial_table (id) VALUES ('one');
		INSERT INTO missing_table (id) VALUES ('boom');`,
	)

	return err
}

func tableCount(t *testing.T, db *sql.DB, name string) int {
	t.Helper()

	var count int
	if err := db.QueryRowContext(context.Background(), `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name).Scan(&count); err != nil {
		t.Fatalf("count table %s: %v", name, err)
	}

	return count
}

func TestApplyGoMigrationsRollsBackFailedMigration(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "migration-rollback.db")

	db, err := sql.Open("sqlite", sqliteDSN(dbPath, true))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}

	db.SetMaxOpenConns(1)
	defer func() { _ = db.Close() }()

	err = applyGoMigrations(
		ctx,
		db,
		goose.NewGoMigration(1, &goose.GoFunc{RunTx: createOKTable}, nil),
		goose.NewGoMigration(2, &goose.GoFunc{RunTx: failAfterPartialWrite}, nil),
	)
	if err == nil {
		t.Fatal("expected failing migration to return an error")
	}

	if got := tableCount(t, db, "partial_table"); got != 0 {
		t.Fatalf("partial_table count = %d, want 0 after rollback", got)
	}

	if got := tableCount(t, db, "ok_table"); got != 1 {
		t.Fatalf("ok_table count = %d, want 1 from prior committed migration", got)
	}

	requireGooseVersions(t, db, 0, 1)
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

func TestKindleLanguageMigrationDefaultsExistingSettingsToChinese(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "v1.db")

	v1, err := sql.Open("sqlite", sqliteDSN(dbPath, true))
	if err != nil {
		t.Fatalf("open v1 db: %v", err)
	}

	v1.SetMaxOpenConns(1)
	if err := applyGoMigrations(ctx, v1, migrations.All()[0]); err != nil {
		t.Fatalf("apply v1 migration: %v", err)
	}

	_, err = v1.ExecContext(ctx, `UPDATE setting SET sender_email = 'reader@example.com', smtp_host = 'smtp.example.com', smtp_port = 465, smtp_security = 'tls', kindle_email = 'reader@kindle.com' WHERE id = 1`)
	if err != nil {
		t.Fatalf("seed v1 settings: %v", err)
	}

	if err := v1.Close(); err != nil {
		t.Fatalf("close v1 db: %v", err)
	}

	store, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("open migrated store: %v", err)
	}
	defer store.Close()

	settings, err := store.Settings().Get(ctx)
	if err != nil {
		t.Fatalf("get migrated settings: %v", err)
	}

	if settings.Kindle == nil || settings.Kindle.KindleEmail != "reader@kindle.com" || settings.Kindle.Language != domain.KindleLanguageChinese {
		t.Fatalf("migrated kindle settings = %+v, want reader@kindle.com in zh", settings.Kindle)
	}
}

func requireBrowserlessColumns(t *testing.T, db *sql.DB) {
	t.Helper()

	removed := queryStrings(t, db, `SELECT name FROM pragma_table_info('setting') WHERE name IN ('provider', 'jina_key', 'browser_endpoint')`)
	if len(removed) != 0 {
		t.Fatalf("setting columns %v still exist, want them dropped", removed)
	}

	want := []string{"browserless_residential_proxy:1:0", "browserless_token:0:", "browserless_url:0:"}
	query := `SELECT name || ':' || "notnull" || ':' || COALESCE(dflt_value, '') FROM pragma_table_info('setting') WHERE name LIKE 'browserless_%' ORDER BY name`
	if got := queryStrings(t, db, query); !slices.Equal(got, want) {
		t.Fatalf("browserless columns = %v, want %v", got, want)
	}
}

func TestBrowserlessMigrationDropsExtractorColumnsAndKeepsOtherSettings(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "v2.db")

	v2, err := sql.Open("sqlite", sqliteDSN(dbPath, true))
	if err != nil {
		t.Fatalf("open v2 db: %v", err)
	}

	v2.SetMaxOpenConns(1)
	if err := applyGoMigrations(ctx, v2, migrations.All()[:2]...); err != nil {
		t.Fatalf("apply v1 and v2 migrations: %v", err)
	}

	seed := `UPDATE setting SET retention = 250, provider = 'browser', jina_key = 'jina-secret', browser_endpoint = 'wss://browser.internal:3000',
		sender_email = 'sender@example.com', smtp_host = 'smtp.example.com', smtp_port = 465, smtp_security = 'tls', smtp_user = 'smtp-user', smtp_password = 'smtp-password',
		kindle_email = 'reader@kindle.com', kindle_language = 'en', send_hour = 8, send_minute = 30, timezone = 'UTC' WHERE id = 1`
	if _, err := v2.ExecContext(ctx, seed); err != nil {
		t.Fatalf("seed v2 settings: %v", err)
	}

	if _, err := v2.ExecContext(ctx, `INSERT INTO kindle_schedule (id, setting_id, next_send_at) VALUES ('schedule-1', 1, 1717230600000)`); err != nil {
		t.Fatalf("seed v2 kindle schedule: %v", err)
	}

	if err := v2.Close(); err != nil {
		t.Fatalf("close v2 db: %v", err)
	}

	store, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("open migrated store: %v", err)
	}
	defer store.Close()

	requireGooseVersions(t, store.ReadDB(), 0, 1, 2, 3, 4, 5)
	requireBrowserlessColumns(t, store.ReadDB())

	settings, err := store.Settings().Get(ctx)
	if err != nil {
		t.Fatalf("get migrated settings: %v", err)
	}

	requireMigratedV2Settings(t, settings)
}

func requireMigratedV2Settings(t *testing.T, settings domain.Settings) {
	t.Helper()

	if settings.Retention != 250 || settings.Browserless != nil {
		t.Fatalf("migrated settings = %+v, want retention 250 and no browserless", settings)
	}

	wantSMTP := domain.SMTPSettings{SenderEmail: "sender@example.com", Host: "smtp.example.com", Port: 465, Security: domain.SMTPSecurityTLS, User: ptr("smtp-user"), Password: ptr("smtp-password")}
	if settings.SMTP == nil {
		t.Fatal("migrated smtp settings are missing")
	}

	assertSMTPSettings(t, *settings.SMTP, wantSMTP)

	wantKindle := domain.KindleSettings{KindleEmail: "reader@kindle.com", Schedule: &domain.KindleSchedule{Hour: 8, Minute: 30, Timezone: "UTC"}}
	if settings.Kindle == nil {
		t.Fatal("migrated kindle settings are missing")
	}

	assertKindleSettings(t, *settings.Kindle, wantKindle)

	if settings.Kindle.Language != domain.KindleLanguageEnglish {
		t.Fatalf("migrated kindle language = %q, want en", settings.Kindle.Language)
	}

	if settings.Kindle.NextSendAt == nil || settings.Kindle.NextSendAt.UnixMilli() != 1717230600000 {
		t.Fatalf("migrated next send at = %v, want 1717230600000 ms preserved", settings.Kindle.NextSendAt)
	}
}

func TestSnapshotLimitMigration(t *testing.T) {
	for _, test := range []struct {
		name      string
		feedItems int
		saved     int
		overflow  string
	}{
		{name: "small database", feedItems: 2, saved: 3},
		{name: "feed item overflow", feedItems: 10001, saved: 3, overflow: "feed_item"},
		{name: "saved page overflow", feedItems: 2, saved: 10001, overflow: "saved_page"},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			db, err := sql.Open("sqlite", sqliteDSN(filepath.Join(t.TempDir(), "v3.db"), true))
			if err != nil {
				t.Fatalf("open v3 db: %v", err)
			}
			defer db.Close()

			if err := applyGoMigrations(ctx, db, migrations.All()[:3]...); err != nil {
				t.Fatalf("apply v1 through v3: %v", err)
			}

			if _, err := db.ExecContext(ctx, `INSERT INTO feed (id, url, title) VALUES ('feed', 'https://example.com/feed', 'Feed')`); err != nil {
				t.Fatalf("seed feed: %v", err)
			}

			seedFeedItemRows(t, db, "feed", test.feedItems)
			seedSavedPageRows(t, db, test.saved)

			err = applyGoMigrations(ctx, db, migrations.All()[:4]...)
			if test.overflow == "" {
				if err != nil {
					t.Fatalf("apply v4: %v", err)
				}

				requireGooseVersions(t, db, 0, 1, 2, 3, 4)
			} else {
				want := test.overflow + " has 10001 rows, exceeding the snapshot limit of 10000"
				if err == nil || !strings.Contains(err.Error(), want) {
					t.Fatalf("apply v4 = %v, want %q", err, want)
				}

				requireGooseVersions(t, db, 0, 1, 2, 3)
			}

			requireSnapshotRowCount(t, db, "feed_item", test.feedItems)
			requireSnapshotRowCount(t, db, "saved_page", test.saved)
		})
	}
}

func TestFeedItemBudgetMigration(t *testing.T) {
	for _, test := range []struct {
		name      string
		stored    []int
		retention int
		wantError string
	}{
		{name: "small database", stored: []int{1, 1}, retention: 2},
		{name: "at capacity", stored: []int{1, 1}, retention: 5000},
		{name: "budget exceeded", stored: []int{1, 1}, retention: 5001, wantError: "feeds may hold 10002 items with retention 5001, exceeding the feed item budget of 10000"},
		{name: "excess stored items at capacity", stored: []int{9998, 0}, retention: 2},
		{name: "excess stored items let other feeds overflow", stored: []int{9999, 0}, retention: 2, wantError: "feeds may hold 10001 items with retention 2, exceeding the feed item budget of 10000"},
		{name: "retention exceeded", retention: 10001, wantError: "retention 10001 is outside 1..10000"},
		{name: "zero retention", retention: 0, wantError: "retention 0 is outside 1..10000"},
		{name: "negative retention", retention: -1, wantError: "retention -1 is outside 1..10000"},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			db, err := sql.Open("sqlite", sqliteDSN(filepath.Join(t.TempDir(), "v4.db"), true))
			if err != nil {
				t.Fatalf("open v4 db: %v", err)
			}
			defer db.Close()

			if err := applyGoMigrations(ctx, db, migrations.All()[:4]...); err != nil {
				t.Fatalf("apply v1 through v4: %v", err)
			}

			seedBudgetMigrationFeeds(ctx, t, db, test.stored)

			if _, err := db.ExecContext(ctx, `UPDATE setting SET retention = ? WHERE id = 1`, test.retention); err != nil {
				t.Fatalf("seed retention: %v", err)
			}

			err = applyGoMigrations(ctx, db, migrations.All()...)
			if test.wantError == "" {
				if err != nil {
					t.Fatalf("apply v5: %v", err)
				}

				requireGooseVersions(t, db, 0, 1, 2, 3, 4, 5)
			} else {
				if err == nil || !strings.Contains(err.Error(), test.wantError) {
					t.Fatalf("apply v5 = %v, want %q", err, test.wantError)
				}

				requireGooseVersions(t, db, 0, 1, 2, 3, 4)
			}

			total := 0
			for _, n := range test.stored {
				total += n
			}

			requireSnapshotRowCount(t, db, "feed", len(test.stored))
			requireSnapshotRowCount(t, db, "feed_item", total)

			var retention int
			if err := db.QueryRowContext(ctx, `SELECT retention FROM setting WHERE id = 1`).Scan(&retention); err != nil || retention != test.retention {
				t.Fatalf("retention after migration = %d, err %v, want %d", retention, err, test.retention)
			}
		})
	}
}

func requireSnapshotRowCount(t *testing.T, db *sql.DB, table string, want int) {
	t.Helper()

	var count int
	if err := db.QueryRowContext(context.Background(), `SELECT COUNT(*) FROM `+table).Scan(&count); err != nil || count != want {
		t.Fatalf("%s row count = %d, err %v, want %d", table, count, err, want)
	}
}

func seedFeedItemRows(t *testing.T, db *sql.DB, feedID string, count int) {
	t.Helper()

	_, err := db.ExecContext(context.Background(), `
		WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
		INSERT INTO feed_item (id, feed_id, url, title)
		SELECT printf('01950000-0000-7000-8000-%012x', n), ?, 'https://example.com/item/' || n, 'Item' FROM seq`, count, feedID)
	if err != nil {
		t.Fatalf("seed feed items: %v", err)
	}
}

func seedSavedPageRows(t *testing.T, db *sql.DB, count int) {
	t.Helper()

	_, err := db.ExecContext(context.Background(), `
		WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
		INSERT INTO saved_page (id, url, title, content)
		SELECT printf('01950000-0000-7000-8000-%012x', n), 'https://example.com/page/' || n, 'Page', 'Body' FROM seq`, count)
	if err != nil {
		t.Fatalf("seed saved pages: %v", err)
	}
}

func TestOpenFreshDatabaseRunsAllMigrations(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "fresh.db"))
	if err != nil {
		t.Fatalf("open fresh store: %v", err)
	}
	defer store.Close()

	requireGooseVersions(t, store.ReadDB(), 0, 1, 2, 3, 4, 5)

	wantTables := []string{"feed", "feed_item", "feed_refresh", "feed_schedule", "folder", "kindle_schedule", "kindle_send", "saved_page", "setting"}
	if got := queryStrings(t, store.ReadDB(), `SELECT name FROM pragma_table_list WHERE schema = 'main' AND strict = 1 AND name NOT LIKE 'sqlite_%' ORDER BY name`); !slices.Equal(got, wantTables) {
		t.Fatalf("strict tables = %v, want %v", got, wantTables)
	}

	if got := queryStrings(t, store.ReadDB(), `SELECT name FROM sqlite_master WHERE type = 'trigger' OR sql LIKE '%CHECK%'`); len(got) != 0 {
		t.Fatalf("schema objects with triggers or CHECK constraints = %v, want none", got)
	}

	if got := queryStrings(t, store.ReadDB(), `SELECT id || ':' || COALESCE(timezone, 'none') FROM setting`); !slices.Equal(got, []string{"1:none"}) {
		t.Fatalf("seeded setting rows = %v, want the single row without a timezone", got)
	}

	if got := queryStrings(t, store.ReadDB(), `SELECT name FROM pragma_table_info('setting') WHERE name = 'schedule_updated_at'`); len(got) != 0 {
		t.Fatalf("setting columns = %v, want no schedule_updated_at", got)
	}

	requireBrowserlessColumns(t, store.ReadDB())

	if got := queryStrings(t, store.ReadDB(), `SELECT name FROM pragma_table_info('feed_refresh') WHERE name = 'finished_at' AND "notnull" = 0`); !slices.Equal(got, []string{"finished_at"}) {
		t.Fatalf("nullable feed_refresh columns = %v, want finished_at", got)
	}

	if got := queryStrings(t, store.ReadDB(), `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('feed_schedule_next', 'kindle_schedule_setting') ORDER BY name`); !slices.Equal(got, []string{"feed_schedule_next", "kindle_schedule_setting"}) {
		t.Fatalf("schedule indexes = %v, want feed_schedule_next and kindle_schedule_setting", got)
	}
}

func queryStrings(t *testing.T, db *sql.DB, query string, args ...any) []string {
	t.Helper()

	rows, err := db.QueryContext(context.Background(), query, args...)
	if err != nil {
		t.Fatalf("query %q: %v", query, err)
	}
	defer rows.Close()

	values := []string{}
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			t.Fatalf("scan %q: %v", query, err)
		}

		values = append(values, value)
	}

	if err := rows.Err(); err != nil {
		t.Fatalf("iterate %q: %v", query, err)
	}

	return values
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

			if err := store.Settings().UpdateBrowserless(ctx, domain.BrowserlessSettings{URL: "https://browserless.example.com", Token: ptr("secret-token")}); err != nil {
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
	boundary := fixedTestID(20)
	checkSnapshotQueryPlans(t, store, boundary)

	statementPlans := []struct {
		name                string
		query               string
		args                []any
		index               string
		allowTempBTree      bool
		keyedRefreshLookups bool
	}{
		{name: "unread counts", query: unreadCountsQuery, args: []any{boundary}, index: "feed_item_read_id", allowTempBTree: true},
		{name: "saved page unread count", query: savedPageUnreadCountQuery, args: []any{boundary}, index: "saved_page_read_id"},
		{name: "mark all feed items read", query: markAllItemsReadQuery, args: []any{boundary}, index: "feed_item_read_id"},
		{name: "mark feed read", query: markFeedReadQuery, args: []any{"feed", boundary}, index: "feed_item_feed_read_id"},
		{name: "mark folder read", query: markFolderReadQuery, args: []any{boundary, "folder"}, index: "feed_item_feed_read_id"},
		{name: "mark all saved pages read", query: markAllSavedPagesReadQuery, args: []any{boundary}, index: "saved_page_read_id"},
		{name: "prune feed refresh history", query: pruneFeedRefreshQuery, args: []any{"feed", string(domain.FeedRefreshRunning), "feed", string(domain.FeedRefreshRunning), feedRefreshLimit}, index: "feed_refresh_feed_id_id", keyedRefreshLookups: true},
		{name: "claim due feed refresh", query: claimDueRefreshQuery, args: []any{"attempt", string(domain.FeedRefreshRunning), 1, 1, string(domain.FeedRefreshRunning)}, index: "feed_schedule_next", keyedRefreshLookups: true},
	}
	for _, test := range statementPlans {
		plan := queryPlan(t, store, test.query, test.args...)
		requireIndexedPlan(t, test.name, plan, test.index, test.allowTempBTree)

		if test.keyedRefreshLookups {
			requireRefreshLookupsIndexed(t, test.name, plan)
		}
	}

	for _, test := range []struct {
		name  string
		query string
		args  []any
	}{
		{name: "list feeds with refresh state", query: listFeedsQuery},
		{name: "get feed with refresh state", query: getFeedQuery, args: []any{"feed"}},
	} {
		plan := queryPlan(t, store, test.query, test.args...)
		requireIndexedPlan(t, test.name, plan, "", false)
		requireFeedScheduleJoinedByKey(t, test.name, plan)
		requireNoRefreshHistoryAccess(t, test.name, plan)
	}

	storedRefsPlan := queryPlan(t, store, listStoredRefsByFeedQuery, "feed")
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

func checkSnapshotQueryPlans(t *testing.T, store *Store, boundary string) {
	t.Helper()

	folder := "folder"
	for _, unread := range []bool{false, true} {
		allItemIndex := "sqlite_autoindex_feed_item_1"
		folderFeedIndex, folderItemIndex := "feed_folder", "feed_item_feed_id_url"
		if unread {
			allItemIndex = "feed_item_read_id"
			folderFeedIndex, folderItemIndex = "sqlite_autoindex_feed_1", "feed_item_read_id"
		}

		params := domain.SnapshotParams{Boundary: boundary, Unread: unread}
		query, args := groupedFeedItemSnapshotQuery(nil, params)
		allPlan := queryPlan(t, store, query, args...)
		requireIndexedPlan(t, "snapshot all", allPlan, allItemIndex, true)
		requireIndexedPlan(t, "snapshot all", allPlan, "sqlite_autoindex_feed_1", true)
		query, args = groupedFeedItemSnapshotQuery(&folder, params)
		folderPlan := queryPlan(t, store, query, args...)
		requireIndexedPlan(t, "snapshot folder", folderPlan, folderItemIndex, true)
		requireIndexedPlan(t, "snapshot folder", folderPlan, folderFeedIndex, true)

		feedIndex, savedIndex := "feed_item_feed_id_url", "sqlite_autoindex_saved_page_1"
		if unread {
			feedIndex, savedIndex = "feed_item_feed_read_id", "saved_page_read_id"
		}

		for _, order := range []domain.SortOrder{domain.SortOrderNewest, domain.SortOrderOldest} {
			query, args := singleFeedItemSnapshotQuery("feed", order, params)
			plan := queryPlan(t, store, query, args...)
			requireIndexedPlan(t, "snapshot feed", plan, feedIndex, false)
		}

		query, args = savedPageSnapshotQuery(params)
		savedPlan := queryPlan(t, store, query, args...)
		requireIndexedPlan(t, "snapshot saved pages", savedPlan, savedIndex, false)
	}

	checkKeepSnapshotQueryPlans(t, store, boundary)

	for _, test := range []struct{ table, query string }{
		{table: "feed_item", query: feedItemsByIDsQuery},
		{table: "saved_page", query: savedPagesByIDsQuery},
	} {
		plan := queryPlan(t, store, test.query, `["one","two"]`)
		index := "sqlite_autoindex_" + test.table + "_1"
		requireIndexedPlan(t, test.table+" by ids", plan, index, true)
		if !slices.ContainsFunc(plan, func(detail string) bool {
			return strings.HasPrefix(detail, "SEARCH "+test.table+" ") && planUsesIndex([]string{detail}, index)
		}) {
			t.Fatalf("%s batch plan does not look up rows by primary key: %v", test.table, plan)
		}
	}
}

// checkKeepSnapshotQueryPlans: `(read = 0 OR id = ?)` unions the unread index with a primary-key
// lookup; a single feed stays on its per-feed index.
func checkKeepSnapshotQueryPlans(t *testing.T, store *Store, boundary string) {
	t.Helper()

	folder := "folder"
	params := domain.SnapshotParams{Boundary: boundary, Unread: true, Keep: domain.NewID()}
	for name, query := range map[string]func() (string, []any){
		"keep snapshot all":    func() (string, []any) { return groupedFeedItemSnapshotQuery(nil, params) },
		"keep snapshot folder": func() (string, []any) { return groupedFeedItemSnapshotQuery(&folder, params) },
	} {
		sql, args := query()
		plan := queryPlan(t, store, sql, args...)
		requireIndexedPlan(t, name, plan, "feed_item_read_id", true)
		requireIndexedPlan(t, name, plan, "sqlite_autoindex_feed_item_1", true)
	}

	sql, args := singleFeedItemSnapshotQuery("feed", domain.SortOrderNewest, params)
	requireIndexedPlan(t, "keep snapshot feed", queryPlan(t, store, sql, args...), "feed_item_feed_id_url", false)

	sql, args = savedPageSnapshotQuery(params)
	savedPlan := queryPlan(t, store, sql, args...)
	requireIndexedPlan(t, "keep snapshot saved pages", savedPlan, "saved_page_read_id", true)
	requireIndexedPlan(t, "keep snapshot saved pages", savedPlan, "sqlite_autoindex_saved_page_1", true)
}

func TestRetentionPruneUsesIndexes(t *testing.T) {
	store := newTestStore(t)
	plan := queryPlan(t, store, pruneFeedItemsQuery, 2)
	if !slices.ContainsFunc(plan, func(detail string) bool {
		return strings.HasPrefix(detail, "SCAN feed_item USING COVERING INDEX feed_item_feed_")
	}) {
		t.Fatalf("ranking does not scan a covering per-feed index:\n%s", strings.Join(plan, "\n"))
	}

	if !slices.ContainsFunc(plan, func(detail string) bool {
		return strings.HasPrefix(detail, "SEARCH feed_item USING ") && strings.HasSuffix(detail, "(id=?)")
	}) {
		t.Fatalf("deletion does not use keyed item lookups:\n%s", strings.Join(plan, "\n"))
	}
}

func TestPlanUsesIndexMatchesWholeIndexName(t *testing.T) {
	longer := []string{"SEARCH feed_item USING INDEX feed_item_feed_id_url (feed_id=? AND id<?)"}
	covering := []string{"SEARCH feed_item USING COVERING INDEX feed_item_feed_id (feed_id=?)"}

	if planUsesIndex(longer, "feed_item_feed_id") {
		t.Fatal("feed_item_feed_id matched feed_item_feed_id_url")
	}

	if !planUsesIndex(longer, "feed_item_feed_id_url") {
		t.Fatal("feed_item_feed_id_url did not match itself")
	}

	if !planUsesIndex(covering, "feed_item_feed_id") {
		t.Fatal("covering index line did not match its own name")
	}
}

func seedBudgetMigrationFeeds(ctx context.Context, t *testing.T, db *sql.DB, stored []int) {
	t.Helper()

	next := uint64(1)
	for _, n := range stored {
		feedID := domain.NewID()
		if _, err := db.ExecContext(ctx, `INSERT INTO feed (id, url, title) VALUES (?, ?, 'Feed')`, feedID, "https://example.com/"+feedID); err != nil {
			t.Fatalf("seed feed: %v", err)
		}

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatalf("begin seed: %v", err)
		}

		for range n {
			if _, err := tx.ExecContext(ctx, `INSERT INTO feed_item (id, feed_id, url, title) VALUES (?, ?, ?, 'Item')`, fixedTestID(next), feedID, fmt.Sprintf("https://example.com/item/%d", next)); err != nil {
				t.Fatalf("seed feed item: %v", err)
			}

			next++
		}

		if err := tx.Commit(); err != nil {
			t.Fatalf("commit seed: %v", err)
		}
	}
}
