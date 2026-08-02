CREATE TABLE chat_schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  applied_at INTEGER NOT NULL
);

CREATE TABLE chat_projects (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  safe_name TEXT NOT NULL CHECK (length(safe_name) BETWEEN 1 AND 255),
  canonical_hash TEXT NOT NULL CHECK (length(canonical_hash) = 64),
  bookmark_ref BLOB NOT NULL CHECK (length(bookmark_ref) BETWEEN 1 AND 1048576),
  pinned_at INTEGER,
  last_used_at INTEGER NOT NULL,
  removed_at INTEGER,
  UNIQUE (owner_user_id, tenant_id, canonical_hash),
  UNIQUE (id, owner_user_id, tenant_id)
);

CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 255),
  title_source TEXT NOT NULL CHECK (title_source IN ('fallback', 'model', 'user')),
  title_job_status TEXT NOT NULL CHECK (title_job_status IN ('not_started', 'pending', 'completed', 'failed', 'cancelled')),
  pinned_at INTEGER,
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  agent_session_id TEXT UNIQUE,
  runtime_thread_id TEXT UNIQUE,
  FOREIGN KEY (project_id, owner_user_id, tenant_id)
    REFERENCES chat_projects(id, owner_user_id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  turn_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'failed')),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  created_at INTEGER NOT NULL,
  UNIQUE (session_id, ordinal)
);

CREATE TABLE chat_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL UNIQUE,
  runtime_turn_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'streaming', 'stopping', 'completed', 'interrupted', 'failed')),
  terminal_at INTEGER
);

CREATE TABLE chat_event_cursors (
  session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
  stream_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  event_id TEXT NOT NULL
);

CREATE TABLE chat_outbox (
  operation_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('create_session', 'start_turn', 'interrupt_turn', 'generate_title', 'delete_session')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'inflight', 'done', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 16),
  next_attempt_at INTEGER,
  payload_version INTEGER NOT NULL CHECK (payload_version >= 1),
  encrypted_payload BLOB NOT NULL
);

CREATE TABLE chat_deletion_jobs (
  operation_id TEXT PRIMARY KEY,
  keyed_session_hash TEXT NOT NULL CHECK (length(keyed_session_hash) = 64),
  encrypted_retry_ids BLOB NOT NULL,
  desktop_state TEXT NOT NULL,
  host_state TEXT NOT NULL,
  runtime_state TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  lease_expires_at INTEGER NOT NULL
);

CREATE TABLE chat_deletion_receipts (
  operation_id TEXT PRIMARY KEY,
  keyed_session_hash TEXT NOT NULL CHECK (length(keyed_session_hash) = 64),
  desktop_state TEXT NOT NULL,
  host_state TEXT NOT NULL,
  runtime_state TEXT NOT NULL,
  outcome TEXT NOT NULL,
  outcome_code TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1)
);

CREATE INDEX chat_projects_scope_sort_idx
  ON chat_projects(owner_user_id, tenant_id, pinned_at DESC, last_used_at DESC, id DESC);
CREATE INDEX chat_sessions_scope_sort_idx
  ON chat_sessions(owner_user_id, tenant_id, pinned_at DESC, last_activity_at DESC, id DESC);
CREATE INDEX chat_messages_session_ordinal_idx ON chat_messages(session_id, ordinal DESC);
CREATE INDEX chat_turns_session_idx ON chat_turns(session_id, id);
CREATE UNIQUE INDEX chat_turns_one_active_idx
  ON chat_turns(session_id) WHERE status IN ('queued', 'streaming', 'stopping');
