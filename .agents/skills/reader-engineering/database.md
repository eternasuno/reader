---
name: reader-database
description: Conditional file of the reader-engineering skill. Read when touching SQLite: the two database files, @reader/sqlite, the reader migration, schema, queries, paging, indexes or the repository adapters.
---

# Database

The product's data is SQLite, and `@reader/sqlite` is the adapter for the business repository ports. It owns the connections, the reader migration, the repository implementations and the cross-owner feed listing the scheduler reads; `./testing` exports the in-memory database Layers. Better Auth's integration, the migration orchestration (the server's `db:migrate` entry in `apps/reader`) and the refresh loop stay in the app: the store imports `@reader/business` and never the app, and the app's HTTP handlers reach a database only through the Layers the server provides. Port contracts (CM-PORT), paging (CM-PAGE) and uniqueness (CM-ID-6) are rules of `reader-spec`; this file says how SQLite satisfies them and what it refuses to do.

## Files and connections

- The reader data lives in `<DATA_DIR>/reader.db` and Better Auth's data in `<DATA_DIR>/auth.db`. `DATA_DIR` defaults to `.data` relative to the process working directory and is created if missing.
- Keep the two files separate: two connections to one file contend for SQLite's single write lock, and with synchronous `node:sqlite` a waiting writer blocks the event loop while the lock holder may need it to commit; Better Auth's dialect also opens a deferred `BEGIN`, which fails at once with `SQLITE_BUSY` on upgrade. Owner ids in `reader.db` are plain strings, so the split loses no constraint.
- At server startup, open the files only; do not generate or apply schema at runtime. Apply both Better Auth's migrations and the reader migration through `pnpm db:migrate` — the server's migrate entry, which runs Better Auth's migrations against `auth.db` and `migrateReader` from `@reader/sqlite` against `reader.db` — once during deployment, before the service starts.
- The reader store uses `@effect/sql-sqlite-node` over Node's built-in `node:sqlite`, so no native module is installed: one connection, WAL, `BEGIN IMMEDIATE` for writable transactions and a 5 s busy timeout (library defaults). The store's client Layer turns on `PRAGMA foreign_keys = ON` for that connection; SQLite defaults it off per connection, so the pragma must be set where the connection is made.
- Tables are `STRICT`; dates are INTEGER epoch milliseconds and booleans are 0/1 with a `CHECK (read IN (0, 1))`.
- `decodeRows` drops NULL columns before schema decoding, so an absent optional column decodes as none and the HTTP JSON omits the field instead of sending `null`, which the browser's schemas reject.
- Each repository maps every failure through `failWith`: it logs the original cause with `Effect.logError` and fails with the port error. Both the cause and the port error's message stay server-side — HTTP sends the contract's error tag and nothing else, and the wording the user reads is the web client's (SKILL.md API conventions) — so the message is a debugging aid and the log is the only place it is read. The log is also where secrets must stay out: a decode failure of a `setting` row is logged without its details, because schema issues print the raw value and the Jina key and the browser endpoint must never be logged.

## Concurrency, ownership and cascades

- Correctness does not come from an application-level lock; the `ReaderStoreConcurrency` semaphore of the earlier design is gone. SQLite allows one writer at a time with serializable transactions.
- Foreign keys `(owner, feed_id) -> feed (owner, id)` and `(owner, folder_id) -> folder (owner, id)` with `ON DELETE CASCADE` make removing a feed remove its items and removing a folder remove its feeds and their items, and they reject cross-owner references. Every table that is a foreign-key target therefore carries `UNIQUE (owner, id)`: the primary key is not addressable by a composite foreign key. `feed_item` and `saved_page` are not targets, so their primary key is enough.
- Ownership is enforced twice: the write or read carries `owner` in its `WHERE` (CM-OWN-2), and the cascade foreign keys make a cross-owner reference impossible rather than merely unread.

## Writes

- Each `create` row is one `INSERT ... SELECT ... WHERE <parent exists> ON CONFLICT DO NOTHING RETURNING id`, or `INSERT ... VALUES ... ON CONFLICT DO NOTHING RETURNING id` without a parent, repeated per row inside one transaction (CM-PORT-3, CM-PORT-6): duplicates by id or unique key are skipped, never overwritten, and concurrent creates of one key leave one row. The returned ids are the rows actually created.
- Guarded writes (`moveToFolder`, `rename`, `setExtractedContent`) are one `UPDATE ... WHERE <guard>`, with `RETURNING id` where the port must report whether a row changed (CM-PORT-5). Do not turn either form back into a check-then-write sequence: the read and the write would be two statements, and another writer can commit between them.
- `setting` is keyed by `owner` and every write method is one `INSERT ... ON CONFLICT (owner) DO UPDATE`.

## SQL fragments and binding

- Every interpolated value in an `sql` template is a bound parameter, strings included: `${name}` becomes a placeholder and its value is bound, never spliced into the text. SQL text comes from the template's literal parts and, where a fragment really is text, from `sql('column')` — the same `sql` called with a plain string, which escapes an identifier — a nested `sql\`...\`` fragment, or an explicit `sql.literal` / `sql.unsafe` fragment such as the shared `SELECT` list. A value is therefore safe to interpolate anywhere, and no fragment may be assembled by concatenating values.
- Id lists go through `inList`, which binds the whole list as one JSON parameter read with `json_each`: `sql.in` binds one parameter per element and fails past SQLite's variable limit, and the ports take unbounded lists.
- Effect concatenates template fragments without whitespace, so an optional clause fragment must start with a space (``sql` AND read = 0` ``); one that does not start with a space silently glues itself to the previous token.

## Lists and paging

- Lists use database-side keyset paging on `id` descending, always scoped by owner (CM-OWN), filtered by `unread` in both lists and, for feed items, by `feedId` (one feed) or by the feeds whose `folderId` is the folder (one folder). The cursor is the `id` of the last returned row and the next page is the rows with a smaller id.
- `publishedAt` is display-only and belongs in no `ORDER BY`, keyset clause or index: it is optional, comes from outside, and does not order arrivals.
- Keep the keyset clause builder in one place (the store's `page` fragment: unread clause, cursor clause, `ORDER BY id DESC LIMIT ?`) so the three list queries cannot drift apart.

## Indexes and constraints

- Indexes: feed `(owner, folder_id)`, `(owner, title, id)`; feed_item `(owner, id)`, `(owner, feed_id, id)`, `(owner, read, id)`; saved_page `(owner, id)`, `(owner, read, id)`.
- Choose them from the target queries and verify each with `EXPLAIN QUERY PLAN`; re-check with the real store SQL after changing paging or indexes, because existing measurements do not carry over. Include `owner` in every owner-scoped index and `feed` in feed-scoped ones.
- Unique constraints are `(owner, url)` on `feed`, `(feed_id, url)` on `feed_item`, `(owner, url)` on `saved_page` and `(owner, name)` on `folder`; names compare exactly as stored, so they are case-sensitive. The duplicate rules and the errors they produce live in `reader-spec` (CM-ID-6, CM-PORT-6).

## Schema

The reader migration `0001_reader` creates exactly these tables, columns, constraints and indexes. This is the one place a field list belongs: the schema is rewritten from this section. Every table is `STRICT`; `id` and `owner` are TEXT, dates are INTEGER epoch milliseconds, and booleans are INTEGER 0/1.

**folder** — a named group of one owner's feeds, one level deep.

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | TEXT | primary key |
| `owner` | TEXT | NOT NULL |
| `name` | TEXT | NOT NULL |
| | | `UNIQUE (owner, name)`, `UNIQUE (owner, id)` |

No index beyond the unique constraints: `UNIQUE (owner, name)` also serves the folder list's `ORDER BY name`, and folders are not paged (CM-PAGE).

**feed** — one owner's subscription to one source address.

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | TEXT | primary key |
| `owner` | TEXT | NOT NULL |
| `url` | TEXT | NOT NULL, the normalized URL (CM-URL) |
| `title` | TEXT | NOT NULL, the title previewed at subscribe time |
| `folder_id` | TEXT | nullable; absent means top level |
| `updated_at` | INTEGER | nullable epoch ms of the last successful sync (`Feed.updatedAt`) |
| | | `UNIQUE (owner, url)`, `UNIQUE (owner, id)` |
| | | `FOREIGN KEY (owner, folder_id) REFERENCES folder (owner, id) ON DELETE CASCADE` |

Indexes: `feed_owner_folder (owner, folder_id)` for the folder scope's feed lookup, `feed_owner_title (owner, title, id)` for the sidebar's title order. Feeds are not paged.

**feed_item** — one stored entry of a feed.

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | TEXT | primary key |
| `owner` | TEXT | NOT NULL |
| `feed_id` | TEXT | NOT NULL |
| `url` | TEXT | NOT NULL |
| `title` | TEXT | NOT NULL |
| `description` | TEXT | nullable, sanitized HTML (CM-ART-4) |
| `content` | TEXT | nullable, sanitized HTML from the source (CM-ART-4) |
| `extracted_content` | TEXT | nullable, sanitized HTML extracted from the page |
| `published_at` | INTEGER | nullable epoch ms; display only |
| `read` | INTEGER | NOT NULL, `CHECK (read IN (0, 1))` |
| | | `UNIQUE (feed_id, url)` |
| | | `FOREIGN KEY (owner, feed_id) REFERENCES feed (owner, id) ON DELETE CASCADE` |

Indexes: `feed_item_owner_id (owner, id)`, `feed_item_owner_feed_id (owner, feed_id, id)`, `feed_item_owner_read_id (owner, read, id)`. There is no `(owner, id)` unique constraint because the primary key covers it and nothing references a feed item.

**saved_page** — one page in the read-later list.

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | TEXT | primary key |
| `owner` | TEXT | NOT NULL |
| `url` | TEXT | NOT NULL |
| `title` | TEXT | NOT NULL |
| `description` | TEXT | nullable, sanitized HTML |
| `content` | TEXT | NOT NULL, sanitized HTML |
| `published_at` | INTEGER | nullable epoch ms; display only |
| `read` | INTEGER | NOT NULL, `CHECK (read IN (0, 1))` |
| | | `UNIQUE (owner, url)` |

Indexes: `saved_page_owner_id (owner, id)`, `saved_page_owner_read_id (owner, read, id)`. Like `feed_item`, it is not a foreign-key target, so its primary key is its only unique constraint on `id`.

`content` is NOT NULL here and nullable on `feed_item`: adding a link stores the extracted article or fails, while a feed item may arrive with no text and gain content later through extraction or saving.

**setting** — one row per owner, created by its first write.

| Column | Type | Constraints |
| --- | --- | --- |
| `owner` | TEXT | primary key |
| `retention` | INTEGER | nullable; absent means no retention choice was made |
| `provider` | TEXT | nullable; the chosen page fetcher |
| `jina_key` | TEXT | nullable, secret, never returned or logged |
| `browser_endpoint` | TEXT | nullable, secret, never returned or logged |
| | | no index, no unique constraint, no foreign key |

## Development phase

The project is in development: do not write data migrations or compatibility paths for stored data. When the schema changes, edit migration `0001_reader` in place, delete the database files in `DATA_DIR` (`.data/reader.db`, `.data/auth.db`) and run `pnpm db:migrate` again. Tests never run `db:migrate`: they apply the migrations to `:memory:` databases through `@reader/sqlite/testing`.

## Performance trap

`node:sqlite` is synchronous, so one write blocks the event loop while it runs. The refresh benchmark in `packages/sqlite/test/bench/` (200 feeds x 100 items arriving at once) measured a refresh round of 1.2 s regular and 1.9 s heavy against 37 s and 82 s on the previous store, and "mark as read" about 1 ms against about 130 ms, but the loop stalled up to roughly 1.2 s during a round because each unbounded refresh fiber runs one synchronous write per loop turn; explicit yields did not help. Add no concurrency limit until running the application shows it is needed (`AGENTS.md`); the loop stall is the symptom to watch for.

## Unstable APIs

`effect/sql` and `@effect/sql-sqlite-node` are unstable APIs; the root `tsconfig.json` allowlists them (`allowedUnstableApis`). Using another unstable export fails `pnpm typecheck` until it is allowlisted there.
