CREATE TABLE chat_attachments (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'image')),
  safe_name TEXT NOT NULL CHECK (length(safe_name) BETWEEN 1 AND 255),
  media_type TEXT NOT NULL CHECK (length(media_type) BETWEEN 3 AND 127),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  state TEXT NOT NULL CHECK (state IN ('ready', 'bound', 'expired')),
  imported_at INTEGER NOT NULL CHECK (imported_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at = imported_at + 604800),
  content_blob BLOB,
  message_id TEXT REFERENCES chat_messages(id) ON DELETE CASCADE,
  UNIQUE (id, owner_user_id, tenant_id),
  CHECK (
    (state = 'ready' AND content_blob IS NOT NULL AND message_id IS NULL)
    OR (state = 'bound' AND content_blob IS NOT NULL AND message_id IS NOT NULL)
    OR (state = 'expired' AND content_blob IS NULL AND message_id IS NOT NULL)
  )
);

CREATE TABLE chat_attachment_chunks (
  attachment_id TEXT NOT NULL REFERENCES chat_attachments(id) ON DELETE CASCADE,
  chunk_ordinal INTEGER NOT NULL CHECK (chunk_ordinal BETWEEN 0 AND 127),
  content TEXT NOT NULL CHECK (length(CAST(content AS BLOB)) BETWEEN 1 AND 16384),
  byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 16384),
  PRIMARY KEY (attachment_id, chunk_ordinal),
  CHECK (byte_count = length(CAST(content AS BLOB)))
);

CREATE TABLE chat_message_content_blocks (
  message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  block_ordinal INTEGER NOT NULL CHECK (block_ordinal BETWEEN 0 AND 15),
  block_type TEXT NOT NULL CHECK (block_type IN ('text', 'file', 'image')),
  text_content TEXT,
  attachment_id TEXT REFERENCES chat_attachments(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, block_ordinal),
  UNIQUE (attachment_id),
  CHECK (
    (block_type = 'text' AND text_content IS NOT NULL
      AND length(CAST(text_content AS BLOB)) BETWEEN 1 AND 1048576
      AND attachment_id IS NULL)
    OR (block_type IN ('file', 'image') AND text_content IS NULL AND attachment_id IS NOT NULL)
  )
);

CREATE INDEX chat_attachments_scope_state_expiry_idx
  ON chat_attachments(owner_user_id, tenant_id, state, expires_at, id);
CREATE INDEX chat_attachments_message_idx ON chat_attachments(message_id, id);
CREATE INDEX chat_attachment_chunks_attachment_idx
  ON chat_attachment_chunks(attachment_id, chunk_ordinal);
