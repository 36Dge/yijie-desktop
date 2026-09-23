-- FEAT-155 3A: durable foundations only. No executable scheduled producer.
CREATE TABLE chat_scheduled_grants (
  grant_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
  plan_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL CHECK(plan_revision>0),
  authorization_revision INTEGER NOT NULL CHECK(authorization_revision>0),
  definition_digest TEXT NOT NULL CHECK(length(definition_digest)=64),
  workspace_source TEXT NOT NULL CHECK(workspace_source IN ('user_project','managed_schedule')),
  workspace_id TEXT NOT NULL,
  max_runs INTEGER NOT NULL CHECK(max_runs BETWEEN 1 AND 2147483647),
  occupied_runs INTEGER NOT NULL DEFAULT 0 CHECK(occupied_runs BETWEEN 0 AND max_runs),
  expires_at INTEGER NOT NULL CHECK(expires_at BETWEEN 0 AND 253402300799),
  UNIQUE(owner_user_id,tenant_id,request_id),
  UNIQUE(grant_id,owner_user_id,tenant_id),
  FOREIGN KEY(plan_id,owner_user_id,tenant_id)
    REFERENCES chat_scheduled_plans(plan_id,owner_user_id,tenant_id) ON DELETE RESTRICT
);
CREATE TABLE chat_scheduled_runs (
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
  workspace_source TEXT NOT NULL CHECK(workspace_source IN ('user_project','managed_schedule')),
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
-- One app-wide reservation. No lease timeout can release an unknown execution.
CREATE TABLE chat_scheduled_reservation (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  run_id TEXT NOT NULL UNIQUE REFERENCES chat_scheduled_runs(run_id) ON DELETE RESTRICT
);
-- Tag the original outbox; never create another queue. All marked rows are
-- withheld by the 3A reader, including when opened in CompatibleReader mode.
ALTER TABLE chat_outbox ADD COLUMN scheduled_run_id TEXT REFERENCES chat_scheduled_runs(run_id) ON DELETE RESTRICT;
CREATE INDEX chat_outbox_scheduled_run_idx ON chat_outbox(scheduled_run_id);
