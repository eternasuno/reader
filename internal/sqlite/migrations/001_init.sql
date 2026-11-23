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
