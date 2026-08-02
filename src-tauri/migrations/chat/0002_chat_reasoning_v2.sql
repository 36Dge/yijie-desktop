ALTER TABLE chat_turns ADD COLUMN reasoning_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (reasoning_status IN ('pending', 'complete', 'incomplete', 'unavailable'));
ALTER TABLE chat_turns ADD COLUMN reasoning_reason_code TEXT;

CREATE TABLE chat_reasoning_items (
  turn_id TEXT NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  item_ordinal INTEGER NOT NULL CHECK (item_ordinal BETWEEN 0 AND 7),
  status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'unavailable')),
  reason_code TEXT,
  total_bytes INTEGER NOT NULL CHECK (total_bytes BETWEEN 0 AND 131072),
  finalized_at_ms INTEGER NOT NULL,
  PRIMARY KEY (turn_id, item_id),
  UNIQUE (turn_id, item_ordinal),
  CHECK ((status = 'complete' AND reason_code IS NULL AND total_bytes > 0)
      OR (status = 'incomplete' AND reason_code IS NOT NULL AND total_bytes > 0)
      OR (status = 'unavailable' AND reason_code IS NOT NULL AND total_bytes = 0))
);

CREATE TABLE chat_reasoning_parts (
  turn_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  content_index INTEGER NOT NULL CHECK (content_index BETWEEN 0 AND 7),
  text TEXT NOT NULL,
  byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 65536),
  PRIMARY KEY (turn_id, item_id, content_index),
  FOREIGN KEY (turn_id, item_id)
    REFERENCES chat_reasoning_items(turn_id, item_id) ON DELETE CASCADE
);
