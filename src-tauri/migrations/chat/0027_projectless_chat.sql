-- App-owned ordinary-chat workspaces. Existing project identities remain unchanged.
CREATE TABLE chat_projects_v27 (
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
    CHECK (workspace_source IN ('user_project','managed_schedule','managed_chat')),
  managed_resource_id TEXT,
  CHECK ((workspace_source='user_project' AND bookmark_ref IS NOT NULL
            AND length(bookmark_ref) BETWEEN 1 AND 1048576 AND managed_resource_id IS NULL)
      OR (workspace_source IN ('managed_schedule','managed_chat') AND bookmark_ref IS NULL
            AND managed_resource_id IS NOT NULL AND length(managed_resource_id)=36 AND pinned_at IS NULL)),
  UNIQUE (owner_user_id, tenant_id, canonical_hash),
  UNIQUE (id, owner_user_id, tenant_id),
  UNIQUE (owner_user_id, tenant_id, managed_resource_id)
);
INSERT INTO chat_projects_v27 SELECT * FROM chat_projects;
DROP TABLE chat_projects;
ALTER TABLE chat_projects_v27 RENAME TO chat_projects;
CREATE INDEX chat_projects_scope_sort_idx
  ON chat_projects(owner_user_id,tenant_id,pinned_at DESC,last_used_at DESC,id DESC);
