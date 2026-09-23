-- Native clock cache and bounded read work only. Never execution authority.
-- Existing runs are not backfilled by migration.
CREATE TABLE chat_scheduled_timing (
  run_id TEXT PRIMARY KEY REFERENCES chat_scheduled_runs(run_id) ON DELETE RESTRICT,
  format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version > 0),
  fact_json TEXT,
  conflicts INTEGER NOT NULL DEFAULT 0 CHECK(conflicts BETWEEN 0 AND 7),
  request_revision INTEGER NOT NULL DEFAULT 1 CHECK(request_revision > 0),
  pending INTEGER NOT NULL DEFAULT 1 CHECK(pending IN (0,1)),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  next_read_after INTEGER NOT NULL DEFAULT 0,
  diagnostic TEXT CHECK(diagnostic IN ('history_unavailable','field_invalid','source_conflict','identity_mismatch'))
);
CREATE INDEX chat_scheduled_timing_pending ON chat_scheduled_timing(pending,next_read_after,run_id);
CREATE INDEX chat_scheduled_runs_timing_scope ON chat_scheduled_runs(owner_user_id,tenant_id,run_id);
CREATE TRIGGER chat_scheduled_timing_bound AFTER INSERT ON chat_native_bindings BEGIN
  INSERT OR IGNORE INTO chat_scheduled_timing(run_id)
    SELECT run_id FROM chat_scheduled_run_bindings WHERE local_turn_id=NEW.turn_id AND conversation_id=NEW.session_id AND target_deleted=0;
END;
CREATE TRIGGER chat_scheduled_timing_ended AFTER UPDATE OF native_outcome ON chat_scheduled_runs
WHEN NEW.native_outcome IN ('completed','failed','interrupted') AND NEW.native_outcome IS NOT OLD.native_outcome BEGIN
  INSERT INTO chat_scheduled_timing(run_id) VALUES(NEW.run_id)
    ON CONFLICT(run_id) DO UPDATE SET pending=1,attempts=0,next_read_after=0,request_revision=request_revision+1
    WHERE format_version=1;
END;
