-- FEAT-156: admit the existing SQL27 managed_chat workspace in grant/run references.
-- Preserve every historical value, digest, relationship and proof trigger.
DROP TRIGGER chat_scheduled_quiescent_proof;
DROP TRIGGER chat_scheduled_timing_ended;
CREATE TABLE chat_scheduled_grants_v29 (
  grant_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
  plan_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL CHECK(plan_revision>0),
  authorization_revision INTEGER NOT NULL CHECK(authorization_revision>0),
  definition_digest TEXT NOT NULL CHECK(length(definition_digest)=64),
  workspace_source TEXT NOT NULL CHECK(workspace_source IN ('user_project','managed_schedule','managed_chat')),
  workspace_id TEXT NOT NULL,
  max_runs INTEGER NOT NULL CHECK(max_runs BETWEEN 1 AND 2147483647),
  occupied_runs INTEGER NOT NULL DEFAULT 0 CHECK(occupied_runs BETWEEN 0 AND max_runs),
  expires_at INTEGER NOT NULL CHECK(expires_at BETWEEN 0 AND 253402300799),
  UNIQUE(owner_user_id,tenant_id,request_id),
  UNIQUE(grant_id,owner_user_id,tenant_id),
  FOREIGN KEY(plan_id,owner_user_id,tenant_id)
    REFERENCES chat_scheduled_plans(plan_id,owner_user_id,tenant_id) ON DELETE RESTRICT
);
INSERT INTO chat_scheduled_grants_v29 SELECT * FROM chat_scheduled_grants;
DROP TABLE chat_scheduled_grants;
ALTER TABLE chat_scheduled_grants_v29 RENAME TO chat_scheduled_grants;
CREATE TABLE chat_scheduled_runs_v29 (
  run_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  format_version INTEGER NOT NULL CHECK(format_version>0),
  plan_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL CHECK(plan_revision>0),
  schedule_epoch INTEGER NOT NULL CHECK(schedule_epoch>0),
  request_id TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
  operation_id TEXT NOT NULL UNIQUE,
  trigger_source TEXT NOT NULL CHECK(trigger_source IN ('automatic','manual','rerun')),
  original_run_id TEXT REFERENCES chat_scheduled_runs(run_id) ON DELETE RESTRICT,
  logical_slot TEXT,
  grant_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  snapshot_digest TEXT NOT NULL CHECK(length(snapshot_digest)=64),
  workspace_source TEXT NOT NULL CHECK(workspace_source IN ('user_project','managed_schedule','managed_chat')),
  workspace_id TEXT NOT NULL,
  permission_mode TEXT NOT NULL CHECK(permission_mode='ask'),
  delivery_state TEXT NOT NULL CHECK(delivery_state IN ('reserved','sending','accepted','uncertain','terminal','cancelled')),
  native_outcome TEXT NOT NULL CHECK(native_outcome IN ('unobserved','completed','failed','interrupted')),
  needs_attention INTEGER NOT NULL CHECK(needs_attention IN (0,1)),
  CHECK ((trigger_source='automatic')=(logical_slot IS NOT NULL)),
  CHECK ((trigger_source='rerun')=(original_run_id IS NOT NULL)),
  UNIQUE(owner_user_id,tenant_id,request_id),
  UNIQUE(owner_user_id,tenant_id,plan_id,schedule_epoch,logical_slot),
  FOREIGN KEY(plan_id,owner_user_id,tenant_id)
    REFERENCES chat_scheduled_plans(plan_id,owner_user_id,tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY(grant_id,owner_user_id,tenant_id)
    REFERENCES chat_scheduled_grants(grant_id,owner_user_id,tenant_id) ON DELETE RESTRICT
);
INSERT INTO chat_scheduled_runs_v29 SELECT * FROM chat_scheduled_runs;
DROP TABLE chat_scheduled_runs;
ALTER TABLE chat_scheduled_runs_v29 RENAME TO chat_scheduled_runs;
CREATE INDEX chat_scheduled_runs_timing_scope ON chat_scheduled_runs(owner_user_id,tenant_id,run_id);
CREATE TRIGGER chat_scheduled_quiescent_proof BEFORE UPDATE OF scheduled_quiescent ON chat_turns
 WHEN NEW.scheduled_quiescent=1 AND NOT EXISTS (
 SELECT 1 FROM chat_scheduled_run_bindings b JOIN chat_scheduled_runs r ON r.run_id=b.run_id
 JOIN chat_scheduled_recovery e ON e.run_id=r.run_id
 WHERE b.local_turn_id=NEW.id AND b.conversation_id=NEW.session_id
 AND r.operation_id=NEW.operation_id AND r.format_version=1 AND e.format_version=1 AND e.release_kind IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'scheduled release proof required'); END;
CREATE TRIGGER chat_scheduled_timing_ended AFTER UPDATE OF native_outcome ON chat_scheduled_runs
WHEN NEW.native_outcome IN ('completed','failed','interrupted') AND NEW.native_outcome IS NOT OLD.native_outcome BEGIN
  INSERT INTO chat_scheduled_timing(run_id) VALUES(NEW.run_id)
    ON CONFLICT(run_id) DO UPDATE SET pending=1,attempts=0,next_read_after=0,request_revision=request_revision+1
    WHERE format_version=1;
END;
