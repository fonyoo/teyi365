ALTER TABLE articles ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE article_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  ip_address TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT 'unknown',
  os_name TEXT NOT NULL DEFAULT 'unknown',
  browser_name TEXT NOT NULL DEFAULT 'unknown',
  viewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE article_view_visitors (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  visitor_hash TEXT NOT NULL,
  last_counted_at TEXT NOT NULL,
  PRIMARY KEY (article_id, visitor_hash)
);

CREATE INDEX idx_article_views_article_viewed_at
  ON article_views (article_id, viewed_at DESC);
CREATE INDEX idx_article_views_visitor_article_viewed_at
  ON article_views (visitor_hash, article_id, viewed_at DESC);
CREATE INDEX idx_article_views_ip_viewed_at
  ON article_views (ip_address, viewed_at DESC);
CREATE INDEX idx_article_views_viewed_at
  ON article_views (viewed_at DESC);
