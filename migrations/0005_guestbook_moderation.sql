ALTER TABLE guestbook_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved'));

CREATE INDEX IF NOT EXISTS idx_guestbook_messages_status_parent_created_at ON guestbook_messages (status, parent_id, created_at);
