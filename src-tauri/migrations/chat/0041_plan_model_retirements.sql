-- FEAT-164 private, append-only proof of the native domain retirement transaction.
-- Data updates belong to schedules::model_retirement, never to model-ID rewriting.
CREATE TABLE chat_plan_model_retirements (
 plan_id TEXT PRIMARY KEY REFERENCES chat_scheduled_plans(plan_id) ON DELETE RESTRICT,
 owner_user_id TEXT NOT NULL,
 tenant_id TEXT NOT NULL,
 format_version INTEGER NOT NULL CHECK(format_version=1),
 retired_profile TEXT NOT NULL CHECK(retired_profile='kimi-k3-max-v1'),
 previous_revision INTEGER NOT NULL CHECK(previous_revision>0),
 retired_revision INTEGER NOT NULL CHECK(retired_revision=previous_revision+1),
 previous_state TEXT NOT NULL CHECK(previous_state IN ('paused','enabled')),
 previous_authorization_ref TEXT,
 retired_at INTEGER NOT NULL CHECK(retired_at>=0)
);
