-- FEAT-164 private Native delivery proof. No historical rows are backfilled.
CREATE TABLE chat_delivery_proofs (
 operation_id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
 turn_id TEXT NOT NULL UNIQUE REFERENCES chat_turns(id) ON DELETE CASCADE,
 create_operation_id TEXT UNIQUE,
 format_version INTEGER NOT NULL CHECK(format_version=1),
 family TEXT NOT NULL CHECK(family IN ('ordinary','market','expert')),
 profile_id TEXT NOT NULL CHECK(profile_id IN ('kimi-k3-max-v1','kimi-k3-1-pro-max-v1','minimax-m3-high-v1')),
 model_revision INTEGER NOT NULL CHECK(model_revision>=0),
 initial_host TEXT,
 initial_thread TEXT,
 bound_host TEXT,
 bound_thread TEXT,
 fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
 phase TEXT NOT NULL CHECK(phase IN ('prepared','claimed','dispatched','cancelled')),
 claim_count INTEGER NOT NULL DEFAULT 0 CHECK(claim_count>=0),
 public_attempts INTEGER NOT NULL DEFAULT 0 CHECK(public_attempts>=0),
 create_attempts INTEGER NOT NULL DEFAULT 0 CHECK(create_attempts>=0),
 turn_attempts INTEGER NOT NULL DEFAULT 0 CHECK(turn_attempts>=0),
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 receipt_json TEXT,
 CHECK((phase='cancelled' AND receipt_json IS NOT NULL AND public_attempts=0 AND create_attempts=0 AND turn_attempts=0) OR (phase!='cancelled' AND receipt_json IS NULL))
);
