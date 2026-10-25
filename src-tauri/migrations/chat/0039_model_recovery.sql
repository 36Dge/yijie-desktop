-- FEAT-164: private Native v2 model intent. Never infer or backfill an old intent.
CREATE TABLE chat_model_operations_v2 (
 operation_id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
 format_version INTEGER NOT NULL CHECK(format_version = 2),
 host_session_id TEXT NOT NULL,
 runtime_thread_id TEXT NOT NULL,
 previous_profile_id TEXT NOT NULL CHECK(previous_profile_id IN ('kimi-k3-max-v1','kimi-k3-1-pro-max-v1','minimax-m3-high-v1')),
 target_profile_id TEXT NOT NULL CHECK(target_profile_id IN ('kimi-k3-1-pro-max-v1','minimax-m3-high-v1')),
 expected_revision INTEGER NOT NULL CHECK(expected_revision >= 0 AND expected_revision < 9007199254740991),
 phase TEXT NOT NULL CHECK(phase IN ('prepared','dispatched','unknown','committed')),
 receipt_json TEXT,
 CHECK((phase='committed' AND receipt_json IS NOT NULL) OR (phase!='committed' AND receipt_json IS NULL))
);
CREATE UNIQUE INDEX chat_model_operations_v2_pending_session
 ON chat_model_operations_v2(session_id) WHERE phase!='committed';
