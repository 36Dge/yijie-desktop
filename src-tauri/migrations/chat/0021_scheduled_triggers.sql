-- FEAT-155 3C-2 private candidate. Ordinary startup remains schema 15.
ALTER TABLE chat_scheduled_plans ADD COLUMN future_hold TEXT
  CHECK(future_hold IN ('unknown','budget','authorization','target','permission','resource'));
CREATE INDEX chat_scheduled_due_idx ON chat_scheduled_plans(owner_user_id,tenant_id,next_at,plan_id)
  WHERE state NOT IN ('deleted','completed') AND next_at IS NOT NULL;
ALTER TABLE chat_scheduled_occurrences RENAME TO chat_scheduled_occurrences_v20;
CREATE TABLE chat_scheduled_occurrences (
  owner_user_id TEXT NOT NULL, tenant_id TEXT NOT NULL, plan_id TEXT NOT NULL,
  schedule_epoch INTEGER NOT NULL CHECK(schedule_epoch>0),
  logical_slot TEXT NOT NULL CHECK(length(logical_slot)=16),
  scheduled_at INTEGER NOT NULL CHECK(scheduled_at>=0),
  disposition TEXT NOT NULL CHECK(disposition IN ('planned','skipped_paused','missed_offline','clock_discontinuity','cancelled','consumed','missed_late','busy','target_unavailable','permission_denied','resource_unavailable','unauthorized')),
  missed_through INTEGER CHECK(missed_through>=scheduled_at),
  run_id TEXT UNIQUE REFERENCES chat_scheduled_runs(run_id) ON DELETE RESTRICT,
  PRIMARY KEY(owner_user_id,tenant_id,plan_id,schedule_epoch,logical_slot),
  FOREIGN KEY(plan_id,owner_user_id,tenant_id) REFERENCES chat_scheduled_plans(plan_id,owner_user_id,tenant_id) ON DELETE RESTRICT
);
INSERT INTO chat_scheduled_occurrences(owner_user_id,tenant_id,plan_id,schedule_epoch,logical_slot,scheduled_at,disposition,missed_through)
 SELECT owner_user_id,tenant_id,plan_id,schedule_epoch,logical_slot,scheduled_at,disposition,missed_through FROM chat_scheduled_occurrences_v20;
DROP TABLE chat_scheduled_occurrences_v20;
CREATE TABLE chat_scheduled_enable_receipts (
  grant_id TEXT PRIMARY KEY REFERENCES chat_scheduled_grants(grant_id) ON DELETE RESTRICT,
  format_version INTEGER NOT NULL CHECK(format_version=1)
);
-- Manual v1 hashes remain byte-for-byte unchanged. Only new trigger types have this record.
CREATE TABLE chat_scheduled_trigger_facts (
  run_id TEXT PRIMARY KEY REFERENCES chat_scheduled_runs(run_id) ON DELETE RESTRICT,
  format_version INTEGER NOT NULL CHECK(format_version>0),
  trigger_source TEXT NOT NULL CHECK(trigger_source IN ('automatic','rerun')),
  confirmation_json TEXT CHECK(json_valid(confirmation_json)),
  process_generation TEXT,
  lifecycle_epoch INTEGER CHECK(lifecycle_epoch>0),
  continuous_from INTEGER,
  scheduled_at INTEGER,
  send_until INTEGER,
  send_closed_reason TEXT CHECK(send_closed_reason IN ('busy','missed_late','missed_offline','unauthorized')),
  CHECK((trigger_source='rerun')=(confirmation_json IS NOT NULL)),
  CHECK((trigger_source='automatic')=(process_generation IS NOT NULL)),
  CHECK(trigger_source!='automatic' OR (lifecycle_epoch IS NOT NULL AND continuous_from IS NOT NULL AND scheduled_at>continuous_from AND send_until=scheduled_at+60))
);
