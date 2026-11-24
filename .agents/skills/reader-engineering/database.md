---
name: reader-database
description: Conditional file of reader-engineering. Read when modifying SQLite connections, embedded migrations, schema, indexes, paging queries, or repository implementations.
---

# Database (`internal/sqlite`)

Single SQLite database file (`<DATA_DIR>/reader.db`) using `modernc.org/sqlite`. Because this is a single-user, single-instance deployment, no separate auth database is needed.

## Connection, Pragmas & Startup Migration

- **File permissions**: `Open` creates the data directory (`0700` only when it creates the directory; an existing, possibly shared directory keeps its mode and the Docker image provides `0700`) and pre-creates the database file (`0600`) before opening pools or enabling WAL, and enforces `0600` on existing database, `-wal`, and `-shm` files on startup so stored secrets (SMTP password, Jina key, browser endpoint) are never group- or world-readable.
- **Per-connection pragmas**: SQLite `foreign_keys`, `busy_timeout`, and `synchronous` are connection-scoped. Configure them on **every** pooled connection via repeated modernc DSN `_pragma` parameters (`?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)`) or a driver connection init hook — never by executing `PRAGMA` once on `*sql.DB`.
- **WAL & pools**: open the write pool (`SetMaxOpenConns(1)` with `_txlock=immediate` for `BEGIN IMMEDIATE`) first, execute `PRAGMA journal_mode = WAL`, then open the read pool (`MaxOpenConns > 1`). Note `SetMaxOpenConns(1)` serializes writes **within this Go process** only; concurrent external processes or multiple containers against the same file will still hit `SQLITE_BUSY` and are unsupported.
- **Startup migration**: SQL migrations live in `internal/sqlite/migrations/*.sql` embedded via `//go:embed` and execute idempotently on startup before HTTP servers or workers start. During active development, backward-compatible data migrations are not maintained — delete `reader.db` and restart to rebuild from scratch when schema changes.

## Schema & Indexes

Single-user schema removes `owner` columns and composite `(owner, id)` constraints:

- **`folder`**: `(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE) STRICT`.
- **`feed`**: `(id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, folder_id TEXT REFERENCES folder(id) ON DELETE SET NULL, updated_at INTEGER, failure_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, reader_mode TEXT NOT NULL DEFAULT 'default', sort_order TEXT NOT NULL DEFAULT 'newest') STRICT`.
  - Note `ON DELETE SET NULL` ensures deleting a folder moves feeds to the top level (`FD-FOLDER-4`) atomically at the DB layer.
  - `failure_count` and `last_error` track consecutive refresh failures (`FD-SCHED-3`), reset on any successful refresh.
  - Indexes: `feed_folder (folder_id)`, `feed_title (title, id)`.
- **`feed_item`**: `(id TEXT PRIMARY KEY, feed_id TEXT NOT NULL REFERENCES feed(id) ON DELETE CASCADE, url TEXT NOT NULL, title TEXT NOT NULL, description TEXT, content TEXT, extracted_content TEXT, published_at INTEGER, read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)), UNIQUE (feed_id, url)) STRICT`.
  - Indexes (verify every list variant, including `folder` queries, with `EXPLAIN QUERY PLAN`):
    - `(id)` PK covers `全部订阅` (`unread = false`)
    - `(read, id)` covers `全部订阅` (`unread = true`) and fast unread filtering
    - `(feed_id, id)` covers unfiltered single-feed `ORDER BY id DESC|ASC` and feed retention inventory
    - `(feed_id, read, id)` covers filtered single-feed unread lists and `unreadCounts` (`WHERE read = 0 GROUP BY feed_id`)
- **`saved_page`**: `(id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT, content TEXT NOT NULL, published_at INTEGER, read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1))) STRICT`.
  - Index: `(read, id)`.
- **`setting`**: singleton row (`id INTEGER PRIMARY KEY CHECK (id = 1)`) storing `retention`, `provider`, `jina_key`, `browser_endpoint`, Kindle SMTP fields, and `next_send_at`.
- **`kindle_send`**: `(id TEXT PRIMARY KEY, trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')), status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')), article_count INTEGER NOT NULL DEFAULT 0, book_count INTEGER NOT NULL DEFAULT 0, error TEXT, started_at INTEGER NOT NULL, finished_at INTEGER) STRICT`.
  - Pruned to the latest `20` rows after inserting/completing a run (`KD-LOG-1`). On startup, any leftover `running` rows are marked `failed` before starting HTTP/schedulers.

## Query Rules

- **Dates & booleans**: store timestamps as `INTEGER` epoch milliseconds; booleans as `0`/`1`.
- **Keyset paging**: `WHERE id < ?` (`DESC`) or `WHERE id > ?` (`ASC` for `oldest`), `ORDER BY id DESC|ASC LIMIT ?` (fetching `limit + 1` rows to compute `cursor`). `published_at` is never in `ORDER BY` or indexes.
- **Unbounded ID lists**: pass ID slices via `json_each(?)` rather than building dynamic `IN (?, ?, ...)` placeholders to avoid SQLite parameter limits.
- **Atomic writes**: use `INSERT ... ON CONFLICT DO NOTHING RETURNING id` and `UPDATE ... RETURNING id` instead of check-then-write sequences.
