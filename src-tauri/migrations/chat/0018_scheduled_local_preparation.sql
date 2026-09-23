-- FEAT-155 3B-1. Canonical runner uses the documented transactional table
-- replacement procedure and checks foreign keys before commit and after reopen.
CREATE TABLE chat_projects_v18 (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  safe_name TEXT NOT NULL CHECK (length(safe_name) BETWEEN 1 AND 255),
  canonical_hash TEXT NOT NULL CHECK (length(canonical_hash) = 64),
  bookmark_ref BLOB,
  pinned_at INTEGER,
  last_used_at INTEGER NOT NULL,
  removed_at INTEGER,
  workspace_source TEXT NOT NULL DEFAULT 'user_project'
    CHECK (workspace_source IN ('user_project','managed_schedule')),
  managed_resource_id TEXT,
  CHECK ((workspace_source='user_project' AND bookmark_ref IS NOT NULL
            AND length(bookmark_ref) BETWEEN 1 AND 1048576 AND managed_resource_id IS NULL)
      OR (workspace_source='managed_schedule' AND bookmark_ref IS NULL
            AND managed_resource_id IS NOT NULL AND length(managed_resource_id)=36 AND pinned_at IS NULL)),
  UNIQUE (owner_user_id, tenant_id, canonical_hash),
  UNIQUE (id, owner_user_id, tenant_id),
  UNIQUE (owner_user_id, tenant_id, managed_resource_id)
);
INSERT INTO chat_projects_v18(id,owner_user_id,tenant_id,safe_name,canonical_hash,bookmark_ref,pinned_at,last_used_at,removed_at)
  SELECT id,owner_user_id,tenant_id,safe_name,canonical_hash,bookmark_ref,pinned_at,last_used_at,removed_at FROM chat_projects;
DROP TABLE chat_projects;
ALTER TABLE chat_projects_v18 RENAME TO chat_projects;
CREATE INDEX chat_projects_scope_sort_idx
  ON chat_projects(owner_user_id,tenant_id,pinned_at DESC,last_used_at DESC,id DESC);

-- A native binding is not part of the user definition or grant digest.
CREATE TABLE chat_scheduled_target_bindings (
  plan_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  conversation_id TEXT,
  project_id TEXT NOT NULL,
  FOREIGN KEY(plan_id,owner_user_id,tenant_id)
    REFERENCES chat_scheduled_plans(plan_id,owner_user_id,tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY(conversation_id,owner_user_id,tenant_id)
    REFERENCES chat_sessions(id,owner_user_id,tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id,owner_user_id,tenant_id)
    REFERENCES chat_projects(id,owner_user_id,tenant_id) ON DELETE RESTRICT
);
-- Keep only IDs/tombstones here, never a second chat body or dispatch queue.
CREATE TABLE chat_scheduled_run_bindings (
  run_id TEXT PRIMARY KEY REFERENCES chat_scheduled_runs(run_id) ON DELETE RESTRICT,
  conversation_id TEXT,
  project_id TEXT NOT NULL REFERENCES chat_projects(id) ON DELETE RESTRICT,
  create_operation_id TEXT,
  local_turn_id TEXT NOT NULL,
  target_deleted INTEGER NOT NULL DEFAULT 0 CHECK(target_deleted IN (0,1))
);
