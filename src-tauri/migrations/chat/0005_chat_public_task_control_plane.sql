CREATE TABLE chat_public_task_bindings (
  session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
  client_reference_id TEXT NOT NULL UNIQUE,
  create_operation_id TEXT NOT NULL UNIQUE,
  public_task_id TEXT UNIQUE,
  host_operation_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('pending', 'inflight', 'bound', 'blocked_auth', 'retry_wait', 'denied', 'failed')
  ),
  authorization_revision INTEGER NOT NULL CHECK (authorization_revision > 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 16),
  lease_expires_at INTEGER,
  next_attempt_at INTEGER,
  last_error_code TEXT CHECK (
    last_error_code IS NULL OR last_error_code IN (
      'chat_unauthenticated',
      'chat_capability_denied',
      'chat_temporarily_unavailable',
      'chat_conflict',
      'chat_protocol_error'
    )
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  bound_at INTEGER,
  CHECK (host_operation_id = create_operation_id),
  CHECK ((state = 'bound') = (public_task_id IS NOT NULL)),
  CHECK ((state = 'inflight') = (lease_expires_at IS NOT NULL)),
  CHECK ((state = 'retry_wait') = (next_attempt_at IS NOT NULL)),
  CHECK ((state IN ('blocked_auth', 'retry_wait', 'denied', 'failed')) = (last_error_code IS NOT NULL))
);

CREATE INDEX chat_public_task_bindings_ready_idx
  ON chat_public_task_bindings(state, next_attempt_at, lease_expires_at, create_operation_id);

-- Historical sessions have no authoritative Public Tasks identity. Keep their
-- history readable, but project a stable terminal control-plane failure and
-- never synthesize or replay a remote create. Session UUIDs are content-free
-- and provide collision-free local placeholders for the closed v5 columns.
INSERT INTO chat_public_task_bindings(
  session_id, client_reference_id, create_operation_id, host_operation_id,
  state, authorization_revision, attempt_count, last_error_code,
  created_at, updated_at
)
SELECT id, id, id, id, 'failed', 1, 0, 'chat_protocol_error',
       created_at, last_activity_at
FROM chat_sessions;

-- Pre-v5 create intents did not have a Public Tasks authority binding. They must
-- never be replayed through the new main chain under guessed identity/revision.
UPDATE chat_outbox
SET state = 'failed', next_attempt_at = NULL
WHERE kind = 'create_session' AND state IN ('pending', 'inflight');
