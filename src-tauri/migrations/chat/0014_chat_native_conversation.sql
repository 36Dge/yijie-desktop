-- Existing rows are not promoted: old projections are not native provenance.
CREATE TABLE chat_native_views (
  turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('native_observed','native_rebuilt')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  view_json TEXT NOT NULL CHECK (length(CAST(view_json AS BLOB)) <= 4194304)
);
CREATE INDEX chat_native_views_session ON chat_native_views(session_id);
CREATE TABLE chat_native_facts (
  turn_id TEXT NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  method TEXT NOT NULL,
  fact_json TEXT NOT NULL CHECK (length(CAST(fact_json AS BLOB)) <= 1048576),
  PRIMARY KEY (turn_id,event_id)
);

-- A binding is registered only after the new native submission receives a Runtime ID.
-- Existing runtime IDs in legacy rows alone do not qualify as provenance.
CREATE TABLE chat_native_bindings (
  turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  runtime_thread_id TEXT NOT NULL,
  runtime_turn_id TEXT NOT NULL,
  host_instance_nonce TEXT
);

ALTER TABLE chat_turns ADD COLUMN submission_status TEXT
  CHECK (submission_status IN ('queued','submitted','failed','uncertain','cancelled'));
-- Only newly inserted local requests receive submission metadata. Legacy rows stay NULL.
CREATE TRIGGER chat_native_local_submission AFTER INSERT ON chat_turns
WHEN NEW.runtime_turn_id IS NULL
BEGIN
  UPDATE chat_turns SET submission_status='queued' WHERE id=NEW.id;
END;
DROP INDEX chat_turns_one_active_idx;
CREATE UNIQUE INDEX chat_turns_one_active_idx ON chat_turns(session_id)
WHERE status IN ('streaming','stopping') OR
  (status='queued' AND COALESCE(submission_status,'queued') NOT IN ('failed','cancelled'));
