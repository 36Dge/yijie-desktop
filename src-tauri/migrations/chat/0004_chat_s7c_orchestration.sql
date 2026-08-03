ALTER TABLE chat_deletion_jobs ADD COLUMN session_id TEXT;
ALTER TABLE chat_deletion_jobs ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_deletion_jobs ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_deletion_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0
  CHECK (attempt_count BETWEEN 0 AND 16);
ALTER TABLE chat_deletion_jobs ADD COLUMN outcome_code TEXT NOT NULL DEFAULT 'pending'
  CHECK (length(outcome_code) BETWEEN 1 AND 128);
ALTER TABLE chat_deletion_jobs ADD COLUMN last_error_code TEXT
  CHECK (last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 128);

UPDATE chat_deletion_jobs
SET desktop_state = 'incomplete',
    host_state = 'incomplete',
    runtime_state = 'incomplete',
    outcome_code = 'legacy_unrecoverable',
    last_error_code = 'legacy_job_missing_session_id'
WHERE session_id IS NULL;

CREATE UNIQUE INDEX chat_deletion_jobs_session_idx
  ON chat_deletion_jobs(session_id) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX chat_deletion_jobs_hash_idx
  ON chat_deletion_jobs(keyed_session_hash);
CREATE INDEX chat_deletion_jobs_ready_idx
  ON chat_deletion_jobs(next_attempt_at, lease_expires_at, operation_id);
CREATE INDEX chat_deletion_receipts_expiry_idx
  ON chat_deletion_receipts(expires_at, operation_id);
