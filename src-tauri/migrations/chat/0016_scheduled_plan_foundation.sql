-- FEAT-155: no run, execution grant, or second outbox is created here.
CREATE UNIQUE INDEX chat_sessions_scoped_identity_idx
  ON chat_sessions(id, owner_user_id, tenant_id);

CREATE TABLE chat_scheduled_plans (
  plan_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  schedule_epoch INTEGER NOT NULL CHECK (schedule_epoch > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 10000),
  rule_json TEXT NOT NULL CHECK (json_valid(rule_json)),
  rule_version INTEGER NOT NULL CHECK (rule_version = 1),
  tzdb_version TEXT NOT NULL,
  target_mode TEXT NOT NULL CHECK (target_mode IN ('dedicated_chat','new_chat_each_run','existing_chat')),
  conversation_id TEXT,
  target_state TEXT NOT NULL CHECK (target_state IN ('ready','unbound','missing')),
  state TEXT NOT NULL CHECK (state IN ('paused','enabled','completed','deleted')),
  effective_from INTEGER NOT NULL CHECK (effective_from >= 0),
  next_at INTEGER CHECK (next_at >= effective_from),
  cursor_at INTEGER NOT NULL CHECK (cursor_at >= effective_from),
  authorization_ref TEXT,
  authorization_expires_at INTEGER,
  CHECK ((authorization_ref IS NULL) = (authorization_expires_at IS NULL)),
  CHECK (target_state != 'ready' OR conversation_id IS NOT NULL),
  CHECK (target_state != 'missing' OR conversation_id IS NULL),
  CHECK (target_mode != 'new_chat_each_run' OR conversation_id IS NULL),
  UNIQUE (plan_id, owner_user_id, tenant_id),
  FOREIGN KEY (conversation_id, owner_user_id, tenant_id)
    REFERENCES chat_sessions(id, owner_user_id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX chat_scheduled_plans_scope_idx ON chat_scheduled_plans(owner_user_id,tenant_id,plan_id);

CREATE TABLE chat_scheduled_requests (
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
  plan_id TEXT NOT NULL,
  PRIMARY KEY (owner_user_id, tenant_id, request_id),
  FOREIGN KEY (plan_id,owner_user_id,tenant_id)
    REFERENCES chat_scheduled_plans(plan_id,owner_user_id,tenant_id) ON DELETE RESTRICT
);

CREATE TABLE chat_scheduled_occurrences (
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  schedule_epoch INTEGER NOT NULL CHECK (schedule_epoch > 0),
  logical_slot TEXT NOT NULL CHECK (length(logical_slot) = 16),
  scheduled_at INTEGER NOT NULL CHECK (scheduled_at >= 0),
  disposition TEXT NOT NULL CHECK (disposition IN ('planned','skipped_paused','missed_offline','clock_discontinuity','cancelled')),
  missed_through INTEGER CHECK (missed_through >= scheduled_at),
  PRIMARY KEY (owner_user_id,tenant_id,plan_id,schedule_epoch,logical_slot),
  FOREIGN KEY (plan_id,owner_user_id,tenant_id)
    REFERENCES chat_scheduled_plans(plan_id,owner_user_id,tenant_id) ON DELETE RESTRICT
);
