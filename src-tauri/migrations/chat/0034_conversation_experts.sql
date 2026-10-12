-- FEAT-158: additive local product state. The canonical writer remains disabled
-- until the expert consumer is qualified. No old message/outbox is rewritten.
CREATE TABLE chat_expert_bindings (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version = 1),
  binding_revision INTEGER NOT NULL CHECK(binding_revision >= 0 AND binding_revision <= 9007199254740991),
  expert_ref_json TEXT CHECK(expert_ref_json IS NULL OR (json_valid(expert_ref_json) AND length(expert_ref_json) <= 4096)),
  display_json TEXT CHECK(display_json IS NULL OR (json_valid(display_json) AND length(display_json) <= 2048)),
  state TEXT NOT NULL CHECK(state IN ('none','ready','applying','unknown','unavailable')),
  operation_id TEXT,
  updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
  CHECK((expert_ref_json IS NULL) = (display_json IS NULL))
);

-- This journal stores requested and observed binding changes separately. An
-- unknown native apply never overwrites the last confirmed effective binding.
CREATE TABLE chat_expert_binding_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version = 1),
  intent_digest TEXT NOT NULL CHECK(length(intent_digest) = 64),
  expected_binding_revision INTEGER NOT NULL CHECK(expected_binding_revision >= 0),
  requested_ref_json TEXT CHECK(requested_ref_json IS NULL OR (json_valid(requested_ref_json) AND length(requested_ref_json) <= 4096)),
  requested_display_json TEXT CHECK(requested_display_json IS NULL OR (json_valid(requested_display_json) AND length(requested_display_json) <= 2048)),
  apply_payload_json TEXT CHECK(apply_payload_json IS NULL OR json_valid(apply_payload_json)),
  receipt_json TEXT CHECK(receipt_json IS NULL OR json_valid(receipt_json)),
  state TEXT NOT NULL CHECK(state IN ('pending','succeeded','rejected','unknown')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  CHECK((requested_ref_json IS NULL) = (requested_display_json IS NULL))
);
CREATE INDEX chat_expert_binding_operations_session ON chat_expert_binding_operations(session_id,state);

-- Keyed to the already-owned market submission, not a second delivery queue.
-- Snapshot and display are frozen in the message/outbox transaction. Explicit
-- ordinary snapshots remain in this family after an expert is removed.
CREATE TABLE chat_expert_submissions (
  submission_operation_id TEXT PRIMARY KEY NOT NULL REFERENCES chat_market_submissions(submission_operation_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version = 1),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND length(snapshot_json) <= 8192),
  display_json TEXT CHECK(display_json IS NULL OR (json_valid(display_json) AND length(display_json) <= 2048))
);
CREATE INDEX chat_expert_submissions_session ON chat_expert_submissions(session_id);
