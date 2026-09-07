CREATE TABLE chat_permission_preferences (
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  draft_mode TEXT NOT NULL DEFAULT 'ask' CHECK (draft_mode IN ('ask','auto','full')),
  full_access_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (full_access_confirmed IN (0,1)),
  PRIMARY KEY (owner_user_id, tenant_id)
);

CREATE TABLE chat_task_permissions (
  session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('ask','auto','full'))
);
