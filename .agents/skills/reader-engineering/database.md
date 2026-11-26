---
name: reader-database
description: Conditional file of reader-engineering. Read when modifying SQLite connections, migrations, schema, indexes, paging queries, or repository implementations.
---

# Database (`internal/sqlite`)

Single SQLite database file (`<DATA_DIR>/reader.db`) using `modernc.org/sqlite`. Because this is a single-user, single-instance deployment, no separate auth database is needed.

## Connection, Pragmas & Startup Migration

- **File permissions**: `Open` creates the data directory (`0700` only when it creates the directory; an existing, possibly shared directory keeps its mode and the Docker image provides `0700`) and pre-creates the database file (`0600`) before opening pools or enabling WAL, and enforces `0600` on existing database, `-wal`, and `-shm` files on startup so stored secrets (SMTP password, Jina key, browser endpoint) are never group- or world-readable.
- **Per-connection pragmas**: SQLite `foreign_keys`, `busy_timeout`, and `synchronous` are connection-scoped. Configure them on **every** pooled connection via repeated modernc DSN `_pragma` parameters (`?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)`) or a driver connection init hook — never by executing `PRAGMA` once on `*sql.DB`.
- **WAL & pools**: open the write pool (`SetMaxOpenConns(1)` with `_txlock=immediate` for `BEGIN IMMEDIATE`) first, execute `PRAGMA journal_mode = WAL`, then open the read pool (`MaxOpenConns > 1`). Note `SetMaxOpenConns(1)` serializes writes **within this Go process** only; concurrent external processes or multiple containers against the same file will still hit `SQLITE_BUSY` and are unsupported.
- **Single-instance lock**: on Unix, `cmd/reader` acquires a non-blocking exclusive `flock` on `<DATA_DIR>/lantern.lock` (`0600`) before opening SQLite or cleaning the EPUB spool directory, holding it until after workers stop and the store closes.
- **Startup migration**: goose **Go** migrations only, in package `internal/sqlite/migrations` (one file per version, e.g. `001_init.go`, collected by `All()` for `goose.WithGoMigrations`; no SQL files). They run through a `goose.Provider` on the write pool, tracked in `goose_db_version`, one transaction per migration (`RunTx`), before HTTP servers or workers start. Each migration is self-contained: DDL/DML as string constants and `database/sql` only, never importing `internal/domain` or repository code, so an applied migration cannot change meaning when application code does. Never edit an applied migration and preserve existing data; a schema change adds the next version. After migrating, `Open` runs `PRAGMA optimize` once on the write pool.

## Schema & Indexes

Single-user schema removes `owner` columns and composite `(owner, id)` constraints. Version 1 (`001_init.go`) is the whole schema; every table is `STRICT`.

- **Structure only**: the database enforces structure — column types, `PRIMARY KEY`, `FOREIGN KEY` + `ON DELETE`, `UNIQUE` where dedupe or `ON CONFLICT` needs it, `NOT NULL`, and `DEFAULT`s. No `CHECK` constraints, triggers, or partial unique indexes. All business rules live in Go and are validated on the write path in `internal/domain` (repositories trust validated input): enums (`provider`, `reader_mode`, `sort_order`, `smtp_security`, send `trigger`/`status`, refresh `status`), ranges (`retention >= 1`, schedule hour/minute), cross-field groups (SMTP fields, schedule fields set together), nonblank values, and a single running send.
- **Entities vs runtime data**: entity tables hold only entity fields; runtime/task data (refresh attempts, send history) lives in its own tables. Store raw facts and derive presentation values (feed `updatedAt` / `failureCount` / `lastError`, Kindle `nextSendAt`) in queries or Go.

Tables:

- **`folder`**: `(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE)`. Index: `folder_name_id (name, id)`.
- **`feed`**: `(id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, site_url TEXT, icon_url TEXT, folder_id TEXT REFERENCES folder(id) ON DELETE SET NULL, reader_mode TEXT NOT NULL DEFAULT 'default', sort_order TEXT NOT NULL DEFAULT 'newest')`.
  - Note `ON DELETE SET NULL` ensures deleting a folder moves feeds to the top level (`FD-FOLDER-4`) atomically at the DB layer.
  - `site_url` and `icon_url` are the feed's own site link and image (`FD-PARSE-6`), replaced on each successful refresh. The feed row carries no refresh state.
  - Indexes: `feed_folder (folder_id)`, `feed_title (title, id)`.
- **`feed_item`**: `(id TEXT PRIMARY KEY, feed_id TEXT NOT NULL REFERENCES feed(id) ON DELETE CASCADE, url TEXT NOT NULL, title TEXT NOT NULL, description TEXT, content TEXT, extracted_content TEXT, published_at INTEGER, read INTEGER NOT NULL DEFAULT 0, UNIQUE (feed_id, url))`.
  - Indexes (verify every list variant, including `folder` queries, with `EXPLAIN QUERY PLAN`):
    - `(id)` PK covers `全部订阅` (`unread = false`)
    - `feed_item_read_id (read, id)` covers `全部订阅` (`unread = true`) and `unreadCounts` (`WHERE read = 0 AND id <= ? GROUP BY feed_id`: an index range scan plus a temp b-tree for the grouping)
    - `feed_item_feed_read_id (feed_id, read, id)` covers filtered single-feed unread lists
    - `feed_item_feed_id_url (feed_id, id, url)` covers unfiltered single-feed `ORDER BY id DESC|ASC` and the feed retention inventory
    - No standalone `(feed_id)` index (the two `feed_id` indexes above prefix it) and no `(read, feed_id, id)` index (it cannot cover `id <= boundary`); add an index only when `EXPLAIN QUERY PLAN` shows a plan regressing to a `SCAN`.
- **`saved_page`**: `(id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT, content TEXT NOT NULL, published_at INTEGER, read INTEGER NOT NULL DEFAULT 0)`.
  - Index: `saved_page_read_id (read, id)`.
- **`feed_refresh`**: `(id TEXT PRIMARY KEY, feed_id TEXT NOT NULL REFERENCES feed(id) ON DELETE CASCADE, status TEXT NOT NULL, error TEXT, started_at INTEGER NOT NULL, finished_at INTEGER NOT NULL)`. Index: `feed_refresh_feed_id_id (feed_id, id)`.
  - One row per finished external refresh attempt (`status` `succeeded` | `failed` from domain constants, `error` = sanitized summary on failures), written with the sync in `ApplySync` or alone in `RecordRefreshFailure`, and pruned in the same transaction to the newest `10` rows per feed plus the newest success when it falls outside them (`FD-SCHED-3`). Database errors and cancellation write nothing.
  - `FeedRepository.List` / `GetByID` derive `UpdatedAt` (newest success `finished_at`), `FailureCount` (failed rows newer than the newest success), and `LastError` (newest row's `error` when it failed) in SQL.
- **`setting`**: singleton row (`id INTEGER PRIMARY KEY`, `id = 1` seeded by the migration) storing `retention` (default `100`), `provider` (default `'direct'`), `jina_key`, `browser_endpoint`, SMTP fields (`sender_email`, `smtp_host`, `smtp_port`, `smtp_security`, `smtp_user`, `smtp_password`), `kindle_email`, and the schedule columns `send_hour`, `send_minute`, `timezone` (IANA name), `schedule_updated_at`.
  - The four schedule columns are all `NULL` while scheduled sending is off and all set while it is on (enforced in Go). `schedule_updated_at` is set to now when the schedule is enabled or its hour/minute/timezone changes, and left unchanged otherwise (`KD-SCHED-1`). No next send time is stored.
- **`kindle_send`**: `(id TEXT PRIMARY KEY, trigger TEXT NOT NULL, status TEXT NOT NULL, article_count INTEGER NOT NULL DEFAULT 0, book_count INTEGER NOT NULL DEFAULT 0, error TEXT, started_at INTEGER NOT NULL, finished_at INTEGER)`; `trigger` (`manual` | `scheduled`) and `status` (`running` | `succeeded` | `failed`) come from domain constants.
  - Pruned to the latest `20` completed rows (never deleting `running` rows) and always keeping the newest `scheduled` row, which is the scheduler's anchor, after inserting/completing a run (`KD-LOG-1`). On startup, any leftover `running` rows are marked `failed` before starting HTTP/schedulers.
- **`kindle_send_book`**: `(send_id TEXT NOT NULL REFERENCES kindle_send(id) ON DELETE CASCADE, book_index INTEGER NOT NULL, PRIMARY KEY (send_id, book_index))`.
  - Records accepted book receipts idempotently per `(send_id, book_index)` so bounded DB-write retries never double-count counters or re-mark articles; rows cascade-delete when `kindle_send` is pruned.

## Query Rules

- **Dates & booleans**: store timestamps as `INTEGER` epoch milliseconds; booleans as `0`/`1`.
- **Keyset paging**: `WHERE id < ?` (`DESC`) or `WHERE id > ?` (`ASC` for `oldest`), `ORDER BY id DESC|ASC LIMIT ?` (fetching `limit + 1` rows to compute `cursor`). `published_at` is never in `ORDER BY` or indexes.
- **Boundary snapshots**: list, unread-count, and read-all queries bind `id <= boundary` (the request's or minted `boundary`) alongside any keyset cursor predicate. `TestQueryPlansUseIndexes` (`internal/sqlite/db_test.go`) covers these queries with `EXPLAIN QUERY PLAN`; new paged or bulk queries must follow the same binding.
- **Unbounded ID lists**: pass ID slices via `json_each(?)` rather than building dynamic `IN (?, ?, ...)` placeholders to avoid SQLite parameter limits.
- **Atomic writes**: use `INSERT ... ON CONFLICT DO NOTHING RETURNING id` and `UPDATE ... RETURNING id` instead of check-then-write sequences.
