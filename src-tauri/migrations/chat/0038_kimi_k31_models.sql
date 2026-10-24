-- FEAT-164 expand identity constraints only. Preserve historical values, nullable
-- selection intent, original operation identities and all parent relationships.
CREATE TABLE chat_model_selections_k31 (
 session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
 profile_id TEXT NOT NULL CHECK(profile_id IN ('kimi-k3-max-v1','kimi-k3-1-pro-max-v1','minimax-m3-high-v1')),
 revision INTEGER NOT NULL CHECK(revision >= 0),
 state TEXT NOT NULL CHECK(state IN ('ready','switching','unknown')),
 operation_id TEXT,
 requested_profile_id TEXT,
 expected_revision INTEGER
);
INSERT INTO chat_model_selections_k31 SELECT session_id,profile_id,revision,state,operation_id,requested_profile_id,expected_revision FROM chat_model_selections;
CREATE TABLE chat_operation_models_k31 (
 operation_id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
 profile_id TEXT NOT NULL CHECK(profile_id IN ('kimi-k3-max-v1','kimi-k3-1-pro-max-v1','minimax-m3-high-v1')),
 revision INTEGER NOT NULL CHECK(revision >= 0)
);
INSERT INTO chat_operation_models_k31 SELECT operation_id,session_id,profile_id,revision FROM chat_operation_models;
CREATE TABLE chat_plan_models_k31 (
 plan_id TEXT PRIMARY KEY REFERENCES chat_scheduled_plans(plan_id) ON DELETE CASCADE,
 profile_id TEXT NOT NULL CHECK(profile_id IN ('kimi-k3-max-v1','kimi-k3-1-pro-max-v1','minimax-m3-high-v1'))
);
INSERT INTO chat_plan_models_k31 SELECT plan_id,profile_id FROM chat_plan_models;
DROP TABLE chat_model_selections;
DROP TABLE chat_operation_models;
DROP TABLE chat_plan_models;
ALTER TABLE chat_model_selections_k31 RENAME TO chat_model_selections;
ALTER TABLE chat_operation_models_k31 RENAME TO chat_operation_models;
ALTER TABLE chat_plan_models_k31 RENAME TO chat_plan_models;
