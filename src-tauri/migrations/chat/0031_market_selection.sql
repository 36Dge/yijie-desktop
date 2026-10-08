-- FEAT-157 immutable Native submission authority, distinct from execution facts.
-- A new conversation reserves its first turn operation before materializing
-- that outbox. Therefore operation aliases must NOT reference chat_outbox.
CREATE TABLE chat_market_submissions (
  submission_operation_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  local_turn_id TEXT NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE,
  turn_operation_id TEXT NOT NULL UNIQUE,
  format_version INTEGER NOT NULL CHECK(format_version=1),
  request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  display_json TEXT NOT NULL CHECK(json_valid(display_json)),
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
  created_at INTEGER NOT NULL CHECK(created_at>=0)
);
CREATE TABLE chat_market_operation_refs (
  operation_id TEXT PRIMARY KEY,
  submission_operation_id TEXT NOT NULL
    REFERENCES chat_market_submissions(submission_operation_id) ON DELETE CASCADE
);
CREATE INDEX chat_market_session ON chat_market_submissions(session_id,local_turn_id);
