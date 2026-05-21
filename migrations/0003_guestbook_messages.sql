CREATE TABLE IF NOT EXISTS guestbook_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES guestbook_messages(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  author_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_guestbook_messages_parent_created_at ON guestbook_messages (parent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_guestbook_messages_author_created_at ON guestbook_messages (author_hash, created_at DESC);
