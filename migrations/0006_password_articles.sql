ALTER TABLE articles ADD COLUMN access_password TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS article_password_attempts (
  visitor_hash TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_article_password_attempts_updated_at
  ON article_password_attempts (updated_at);
