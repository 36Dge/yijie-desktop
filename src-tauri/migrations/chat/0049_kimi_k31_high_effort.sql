-- Expand the allowed K3.1 profiles. The migration transaction copies the original
-- identifiers, revisions, fingerprints and receipt bytes without reinterpreting them.

CREATE TABLE chat_model_selections_high (
 session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
 profile_id TEXT NOT NULL CHECK(profile_id IN ('kimi-k3-max-v1','kimi-k3-1-pro-max-v1','kimi-k3-1-pro-high-v1','minimax-m3-high-v1')),
 revision INTEGER NOT NULL CHECK(revision >= 0),
 state TEXT NOT NULL CHECK(state IN ('ready','switching','unknown')),
 operation_id TEXT,
 requested_profile_id TEXT,
 expected_revision INTEGER
);
INSERT INTO chat_model_selections_high (session_id,profile_id,revision,state,operation_id,requested_profile_id,expected_revision)
 SELECT session_id,profile_id,revision,state,operation_id,requested_profile_id,expected_revision FROM chat_model_selections;
DROP TABLE chat_model_selections;
ALTER TABLE chat_model_selections_high RENAME TO chat_model_selections;

CREATE TABLE chat_operation_models_high (
 operation_id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
 profile_id TEXT NOT NULL CHECK(profile_id IN ('kimi-k3-max-v1','kimi-k3-1-pro-max-v1','kimi-k3-1-pro-high-v1','minimax-m3-high-v1')),
 revision INTEGER NOT NULL CHECK(revision >= 0)
);
INSERT INTO chat_operation_models_high (operation_id,session_id,profile_id,revision)
 SELECT operation_id,session_id,profile_id,revision FROM chat_operation_models;
DROP TABLE chat_operation_models;
ALTER TABLE chat_operation_models_high RENAME TO chat_operation_models;

CREATE TABLE chat_plan_models_high (
 plan_id TEXT PRIMARY KEY REFERENCES chat_scheduled_plans(plan_id) ON DELETE CASCADE,
 profile_id TEXT NOT NULL CHECK(profile_id IN ('kimi-k3-max-v1','kimi-k3-1-pro-max-v1','kimi-k3-1-pro-high-v1','minimax-m3-high-v1'))
);
INSERT INTO chat_plan_models_high (plan_id,profile_id)
 SELECT plan_id,profile_id FROM chat_plan_models;
DROP TABLE chat_plan_models;
ALTER TABLE chat_plan_models_high RENAME TO chat_plan_models;

CREATE TABLE chat_model_operations_v2_high (
 operation_id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
 format_version INTEGER NOT NULL CHECK(format_version = 2),
 host_session_id TEXT NOT NULL,
 runtime_thread_id TEXT NOT NULL,
 previous_profile_id TEXT NOT NULL CHECK(previous_profile_id IN ('kimi-k3-max-v1','kimi-k3-1-pro-max-v1','kimi-k3-1-pro-high-v1','minimax-m3-high-v1')),
 target_profile_id TEXT NOT NULL CHECK(target_profile_id IN ('kimi-k3-1-pro-max-v1','kimi-k3-1-pro-high-v1','minimax-m3-high-v1')),
 expected_revision INTEGER NOT NULL CHECK(expected_revision >= 0 AND expected_revision < 9007199254740991),
 phase TEXT NOT NULL CHECK(phase IN ('prepared','dispatched','unknown','committed')),
 receipt_json TEXT,
 CHECK((phase='committed' AND receipt_json IS NOT NULL) OR (phase!='committed' AND receipt_json IS NULL))
);
INSERT INTO chat_model_operations_v2_high (operation_id,session_id,format_version,host_session_id,runtime_thread_id,previous_profile_id,target_profile_id,expected_revision,phase,receipt_json)
 SELECT operation_id,session_id,format_version,host_session_id,runtime_thread_id,previous_profile_id,target_profile_id,expected_revision,phase,receipt_json FROM chat_model_operations_v2;
DROP TABLE chat_model_operations_v2;
ALTER TABLE chat_model_operations_v2_high RENAME TO chat_model_operations_v2;

CREATE UNIQUE INDEX chat_model_operations_v2_pending_session
 ON chat_model_operations_v2(session_id) WHERE phase!='committed';

CREATE TABLE chat_delivery_proofs_high (
 operation_id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
 turn_id TEXT NOT NULL UNIQUE REFERENCES chat_turns(id) ON DELETE CASCADE,
 create_operation_id TEXT UNIQUE,
 format_version INTEGER NOT NULL CHECK(format_version=1),
 family TEXT NOT NULL CHECK(family IN ('ordinary','market','expert')),
 profile_id TEXT NOT NULL CHECK(profile_id IN ('kimi-k3-max-v1','kimi-k3-1-pro-max-v1','kimi-k3-1-pro-high-v1','minimax-m3-high-v1')),
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
INSERT INTO chat_delivery_proofs_high (operation_id,session_id,turn_id,create_operation_id,format_version,family,profile_id,model_revision,initial_host,initial_thread,bound_host,bound_thread,fingerprint,phase,claim_count,public_attempts,create_attempts,turn_attempts,created_at,receipt_json)
 SELECT operation_id,session_id,turn_id,create_operation_id,format_version,family,profile_id,model_revision,initial_host,initial_thread,bound_host,bound_thread,fingerprint,phase,claim_count,public_attempts,create_attempts,turn_attempts,created_at,receipt_json FROM chat_delivery_proofs;
DROP TABLE chat_delivery_proofs;
ALTER TABLE chat_delivery_proofs_high RENAME TO chat_delivery_proofs;
