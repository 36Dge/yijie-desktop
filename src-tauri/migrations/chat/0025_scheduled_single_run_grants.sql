-- FEAT-155 4C-3: explicit purpose only; quota remains in the original grant.
CREATE TABLE chat_scheduled_single_run_grants (
  grant_id TEXT PRIMARY KEY REFERENCES chat_scheduled_grants(grant_id) ON DELETE RESTRICT,
  format_version INTEGER NOT NULL CHECK(format_version > 0),
  trigger_source TEXT NOT NULL CHECK(trigger_source IN ('manual','rerun')),
  original_run_id TEXT REFERENCES chat_scheduled_runs(run_id) ON DELETE RESTRICT,
  CHECK ((trigger_source='rerun')=(original_run_id IS NOT NULL))
);
