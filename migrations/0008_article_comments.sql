ALTER TABLE guestbook_messages ADD COLUMN article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_guestbook_messages_article_parent_created_at
  ON guestbook_messages (article_id, parent_id, created_at);
