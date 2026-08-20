CREATE TABLE chat_output_artifacts (
  artifact_id TEXT PRIMARY KEY CHECK (length(artifact_id) = 36),
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'file', 'report')),
  provenance TEXT NOT NULL CHECK (provenance IN ('synthetic', 'provider', 'tool')),
  state TEXT NOT NULL CHECK (state IN (
    'announced', 'generating', 'processing', 'transferring',
    'ready', 'failed', 'cancelled', 'expired'
  )),
  progress_stage TEXT CHECK (
    progress_stage IS NULL OR progress_stage IN ('generating', 'processing', 'finalizing')
  ),
  progress_percent REAL CHECK (
    progress_percent IS NULL OR progress_percent BETWEEN 0.0 AND 100.0
  ),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 11),
  display_name TEXT CHECK (
    display_name IS NULL OR length(display_name) BETWEEN 1 AND 255
  ),
  media_type TEXT,
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size BETWEEN 1 AND 67108864),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  content_blob BLOB,
  poster_media_type TEXT,
  poster_byte_size INTEGER CHECK (
    poster_byte_size IS NULL OR poster_byte_size BETWEEN 1 AND 20971520
  ),
  poster_sha256 TEXT CHECK (poster_sha256 IS NULL OR length(poster_sha256) = 64),
  poster_blob BLOB,
  local_committed_at INTEGER,
  expires_at INTEGER,
  ack_id TEXT UNIQUE,
  ack_state TEXT CHECK (ack_state IS NULL OR ack_state IN ('pending', 'acknowledged')),
  acknowledged_at INTEGER,
  error_code TEXT,
  retryable INTEGER CHECK (retryable IS NULL OR retryable IN (0, 1)),
  UNIQUE (turn_id, ordinal),
  UNIQUE (artifact_id, owner_user_id, tenant_id),
  CHECK (
    (state IN ('announced', 'generating', 'processing')
      AND media_type IS NULL AND byte_size IS NULL AND sha256 IS NULL
      AND content_blob IS NULL AND local_committed_at IS NULL AND expires_at IS NULL
      AND ack_id IS NULL AND ack_state IS NULL AND error_code IS NULL AND retryable IS NULL)
    OR
    (state = 'transferring'
      AND media_type IS NOT NULL AND byte_size IS NOT NULL AND sha256 IS NOT NULL
      AND content_blob IS NULL AND local_committed_at IS NULL AND expires_at IS NULL
      AND ack_id IS NULL AND ack_state IS NULL AND error_code IS NULL AND retryable IS NULL)
    OR
    (state = 'ready'
      AND media_type IS NOT NULL AND byte_size IS NOT NULL AND sha256 IS NOT NULL
      AND content_blob IS NOT NULL AND length(content_blob) = byte_size
      AND local_committed_at IS NOT NULL
      AND expires_at = local_committed_at + 604800
      AND ack_id IS NOT NULL AND ack_state IS NOT NULL
      AND progress_stage IS NULL AND progress_percent IS NULL
      AND error_code IS NULL AND retryable IS NULL)
    OR
    (state = 'expired'
      AND media_type IS NOT NULL AND byte_size IS NOT NULL AND sha256 IS NOT NULL
      AND content_blob IS NULL AND poster_blob IS NULL
      AND local_committed_at IS NOT NULL AND expires_at IS NOT NULL
      AND ack_id IS NOT NULL AND ack_state IS NOT NULL
      AND progress_stage IS NULL AND progress_percent IS NULL
      AND error_code IS NULL AND retryable IS NULL)
    OR
    (state IN ('failed', 'cancelled')
      AND content_blob IS NULL AND poster_blob IS NULL
      AND local_committed_at IS NULL AND expires_at IS NULL
      AND ack_id IS NULL AND ack_state IS NULL
      AND progress_stage IS NULL AND progress_percent IS NULL
      AND error_code IS NOT NULL AND retryable IS NOT NULL)
  ),
  CHECK (
    (state = 'announced' AND progress_stage IS NULL AND progress_percent IS NULL)
    OR state IN ('generating', 'processing', 'transferring', 'ready', 'failed', 'cancelled', 'expired')
  ),
  CHECK (
    progress_stage IS NULL
    OR (state IN ('generating', 'transferring') AND progress_stage = 'generating')
    OR (state IN ('processing', 'transferring') AND progress_stage IN ('processing', 'finalizing'))
  ),
  CHECK (
    (poster_blob IS NULL AND poster_media_type IS NULL
      AND poster_byte_size IS NULL AND poster_sha256 IS NULL)
    OR
    (kind = 'video'
      AND poster_media_type IN ('image/png', 'image/jpeg', 'image/webp')
      AND poster_byte_size IS NOT NULL AND poster_sha256 IS NOT NULL
      AND (
        (state = 'ready' AND poster_blob IS NOT NULL
          AND length(poster_blob) = poster_byte_size)
        OR (state = 'expired' AND poster_blob IS NULL)
      ))
  )
);

CREATE TABLE chat_artifact_cleanup_receipts (
  artifact_id TEXT PRIMARY KEY REFERENCES chat_output_artifacts(artifact_id) ON DELETE CASCADE,
  outcome_code TEXT NOT NULL CHECK (outcome_code = 'retention_expired'),
  completed_at INTEGER NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1)
);

CREATE INDEX chat_output_artifacts_scope_history_idx
  ON chat_output_artifacts(owner_user_id, tenant_id, session_id, turn_id, ordinal);
CREATE INDEX chat_output_artifacts_expiry_idx
  ON chat_output_artifacts(owner_user_id, tenant_id, state, expires_at, artifact_id);
