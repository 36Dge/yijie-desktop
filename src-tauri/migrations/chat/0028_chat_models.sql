-- FEAT-156 additive tables. Never infer a historic turn's model or rewrite an old outbox.
CREATE TABLE chat_model_selections (
 session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
 profile_id TEXT NOT NULL CHECK(profile_id IN ('kimi-k3-max-v1','minimax-m3-high-v1')),
 revision INTEGER NOT NULL CHECK(revision >= 0),
 state TEXT NOT NULL CHECK(state IN ('ready','switching','unknown')),
 operation_id TEXT,
 requested_profile_id TEXT,
 expected_revision INTEGER
);
CREATE TABLE chat_operation_models (
 -- First-turn operation is reserved before its outbox is materialized at Host bind.
 operation_id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
 profile_id TEXT NOT NULL CHECK(profile_id IN ('kimi-k3-max-v1','minimax-m3-high-v1')),
 revision INTEGER NOT NULL CHECK(revision >= 0)
);
CREATE TABLE chat_plan_models (
 plan_id TEXT PRIMARY KEY REFERENCES chat_scheduled_plans(plan_id) ON DELETE CASCADE,
 profile_id TEXT NOT NULL CHECK(profile_id IN ('kimi-k3-max-v1','minimax-m3-high-v1'))
);
