package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

const initSchema = `
CREATE TABLE folder (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
) STRICT;

CREATE INDEX folder_name_id ON folder (name, id);

CREATE TABLE feed (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  site_url TEXT,
  icon_url TEXT,
  folder_id TEXT REFERENCES folder(id) ON DELETE SET NULL,
  reader_mode TEXT NOT NULL DEFAULT 'default',
  sort_order TEXT NOT NULL DEFAULT 'newest'
) STRICT;

CREATE INDEX feed_folder ON feed (folder_id);
CREATE INDEX feed_title ON feed (title, id);

CREATE TABLE feed_item (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feed(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT,
  extracted_content TEXT,
  published_at INTEGER,
  read INTEGER NOT NULL DEFAULT 0,
  UNIQUE (feed_id, url)
) STRICT;

CREATE INDEX feed_item_read_id ON feed_item (read, id);
CREATE INDEX feed_item_feed_read_id ON feed_item (feed_id, read, id);
CREATE INDEX feed_item_feed_id_url ON feed_item (feed_id, id, url);

CREATE TABLE saved_page (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  published_at INTEGER,
  read INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX saved_page_read_id ON saved_page (read, id);

CREATE TABLE feed_refresh (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feed(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL
) STRICT;

CREATE INDEX feed_refresh_feed_id_id ON feed_refresh (feed_id, id);

CREATE TABLE setting (
  id INTEGER PRIMARY KEY,
  retention INTEGER NOT NULL DEFAULT 100,
  provider TEXT NOT NULL DEFAULT 'direct',
  jina_key TEXT,
  browser_endpoint TEXT,
  sender_email TEXT,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_security TEXT,
  smtp_user TEXT,
  smtp_password TEXT,
  kindle_email TEXT,
  timezone TEXT,
  send_hour INTEGER,
  send_minute INTEGER,
  schedule_updated_at INTEGER
) STRICT;

INSERT INTO setting (id) VALUES (1);

CREATE TABLE kindle_send (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  article_count INTEGER NOT NULL DEFAULT 0,
  book_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
) STRICT;

CREATE TABLE kindle_send_book (
  send_id TEXT NOT NULL REFERENCES kindle_send(id) ON DELETE CASCADE,
  book_index INTEGER NOT NULL,
  PRIMARY KEY (send_id, book_index)
) STRICT;
`

func All() []*goose.Migration {
	return []*goose.Migration{
		goose.NewGoMigration(1, &goose.GoFunc{RunTx: initUp}, nil),
	}
}

func initUp(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, initSchema)

	return err
}
