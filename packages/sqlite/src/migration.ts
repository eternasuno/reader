import { SqliteMigrator } from '@effect/sql-sqlite-node';
import { Effect } from 'effect';
import { Migrator, SqlClient } from 'effect/sql';

/**
 * Migration `0001_reader` (database.md, Schema). Every table is STRICT; dates
 * are epoch milliseconds and booleans 0/1. `UNIQUE (owner, id)` exists on the
 * foreign-key targets because a composite foreign key cannot address a
 * primary key.
 */
const READER_SCHEMA = [
  `CREATE TABLE folder (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    UNIQUE (owner, name),
    UNIQUE (owner, id)
  ) STRICT`,
  `CREATE TABLE feed (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    folder_id TEXT,
    updated_at INTEGER,
    UNIQUE (owner, url),
    UNIQUE (owner, id),
    FOREIGN KEY (owner, folder_id) REFERENCES folder (owner, id) ON DELETE CASCADE
  ) STRICT`,
  'CREATE INDEX feed_owner_folder ON feed (owner, folder_id)',
  'CREATE INDEX feed_owner_title ON feed (owner, title, id)',
  `CREATE TABLE feed_item (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    feed_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    content TEXT,
    extracted_content TEXT,
    published_at INTEGER,
    read INTEGER NOT NULL CHECK (read IN (0, 1)),
    UNIQUE (feed_id, url),
    FOREIGN KEY (owner, feed_id) REFERENCES feed (owner, id) ON DELETE CASCADE
  ) STRICT`,
  'CREATE INDEX feed_item_owner_id ON feed_item (owner, id)',
  'CREATE INDEX feed_item_owner_feed_id ON feed_item (owner, feed_id, id)',
  'CREATE INDEX feed_item_owner_read_id ON feed_item (owner, read, id)',
  `CREATE TABLE saved_page (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    published_at INTEGER,
    read INTEGER NOT NULL CHECK (read IN (0, 1)),
    UNIQUE (owner, url)
  ) STRICT`,
  'CREATE INDEX saved_page_owner_id ON saved_page (owner, id)',
  'CREATE INDEX saved_page_owner_read_id ON saved_page (owner, read, id)',
  `CREATE TABLE setting (
    owner TEXT PRIMARY KEY,
    retention INTEGER,
    provider TEXT,
    jina_key TEXT,
    browser_endpoint TEXT
  ) STRICT`,
];

const createReaderTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* Effect.forEach(READER_SCHEMA, (statement) => sql.unsafe(statement), {
    discard: true,
  });
});

const readerMigrations = Migrator.fromRecord({
  '0001_reader': createReaderTables,
});

/** Applies the reader migration to the current `SqlClient` (`pnpm db:migrate`). */
export const migrateReader = SqliteMigrator.run({ loader: readerMigrations });

/** Applies the reader migration when the layer is built; tests use it on `:memory:`. */
export const readerMigrationLayer = SqliteMigrator.layer({
  loader: readerMigrations,
});
