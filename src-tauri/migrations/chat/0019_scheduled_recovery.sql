-- Evidence is separate from historical result. Old rows have unknown send facts.
CREATE TABLE chat_scheduled_recovery (
  run_id TEXT PRIMARY KEY REFERENCES chat_scheduled_runs(run_id) ON DELETE RESTRICT,
  format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version=1),
  create_attempt TEXT NOT NULL DEFAULT 'unknown' CHECK(create_attempt IN ('unknown','never','attempted','not_required')),
  turn_attempt TEXT NOT NULL DEFAULT 'unknown' CHECK(turn_attempt IN ('unknown','never','attempted')),
  create_host_instance TEXT,
  original_host_instance TEXT,
  recovered_binding INTEGER NOT NULL DEFAULT 0 CHECK(recovered_binding IN (0,1)),
  release_kind TEXT CHECK(release_kind IN ('native_terminal','generation_stopped','never_sent_cancel')),
  release_reference TEXT,
  refunded INTEGER NOT NULL DEFAULT 0 CHECK(refunded IN (0,1)),
  CHECK((release_kind IS NULL)=(release_reference IS NULL)),
  CHECK(refunded=0 OR release_kind='never_sent_cancel')
);
INSERT INTO chat_scheduled_recovery(run_id) SELECT run_id FROM chat_scheduled_runs;
ALTER TABLE chat_turns ADD COLUMN scheduled_quiescent INTEGER NOT NULL DEFAULT 0 CHECK(scheduled_quiescent IN (0,1));
DROP INDEX chat_turns_one_active_idx;
CREATE UNIQUE INDEX chat_turns_one_active_idx ON chat_turns(session_id)
 WHERE scheduled_quiescent=0 AND (status IN ('streaming','stopping') OR
 (status='queued' AND COALESCE(submission_status,'queued') NOT IN ('failed','cancelled')));
-- Only an exact scheduled binding with immutable release proof may be projected.
CREATE TRIGGER chat_scheduled_quiescent_proof BEFORE UPDATE OF scheduled_quiescent ON chat_turns
 WHEN NEW.scheduled_quiescent=1 AND NOT EXISTS (
 SELECT 1 FROM chat_scheduled_run_bindings b JOIN chat_scheduled_runs r ON r.run_id=b.run_id
 JOIN chat_scheduled_recovery e ON e.run_id=r.run_id
 WHERE b.local_turn_id=NEW.id AND b.conversation_id=NEW.session_id
 AND r.operation_id=NEW.operation_id AND r.format_version=1 AND e.format_version=1 AND e.release_kind IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'scheduled release proof required'); END;
CREATE TRIGGER chat_scheduled_quiescent_insert BEFORE INSERT ON chat_turns
 WHEN NEW.scheduled_quiescent!=0 BEGIN SELECT RAISE(ABORT,'new turn must occupy'); END;
CREATE TRIGGER chat_scheduled_release_immutable BEFORE UPDATE ON chat_scheduled_recovery
 WHEN OLD.release_kind IS NOT NULL BEGIN SELECT RAISE(ABORT,'release proof is immutable'); END;
CREATE TRIGGER chat_scheduled_release_retained BEFORE DELETE ON chat_scheduled_recovery
 WHEN OLD.release_kind IS NOT NULL BEGIN SELECT RAISE(ABORT,'release proof is retained'); END;

-- Written only after the owned Host and its Runtime have normally exited.
CREATE TABLE chat_scheduled_stopped_generations (
 host_instance TEXT PRIMARY KEY,
 format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version=1)
);
