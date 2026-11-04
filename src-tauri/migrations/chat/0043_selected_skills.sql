-- Explicit user selections only. Skill bodies and native paths remain Runtime-owned.
CREATE TABLE chat_message_skill_selections (
  message_id TEXT NOT NULL,
  block_ordinal INTEGER NOT NULL CHECK (block_ordinal BETWEEN 0 AND 15),
  skill_ordinal INTEGER NOT NULL CHECK (skill_ordinal BETWEEN 0 AND 255),
  skill_id TEXT NOT NULL CHECK (length(skill_id) BETWEEN 1 AND 256),
  skill_version TEXT NOT NULL CHECK (length(skill_version) BETWEEN 1 AND 64),
  PRIMARY KEY (message_id, block_ordinal, skill_ordinal),
  UNIQUE (message_id, skill_id),
  FOREIGN KEY (message_id, block_ordinal)
    REFERENCES chat_message_content_blocks(message_id, block_ordinal) ON DELETE CASCADE
);
