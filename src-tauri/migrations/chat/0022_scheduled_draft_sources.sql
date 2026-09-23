-- FEAT-155 B2: source identity and confirmation only; original chat retains body/outbox.
CREATE TABLE chat_scheduled_draft_sessions (
 conversation_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
 owner_user_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL,
 format_version INTEGER NOT NULL CHECK(format_version=1),
 schema_version INTEGER NOT NULL CHECK(schema_version=1),
 policy_version INTEGER NOT NULL CHECK(policy_version=1)
);
CREATE TABLE chat_scheduled_draft_sources (
 source_id TEXT PRIMARY KEY,
 owner_user_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
 request_id TEXT NOT NULL, request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
 conversation_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
 local_turn_id TEXT REFERENCES chat_turns(id) ON DELETE SET NULL,
 operation_id TEXT NOT NULL, create_operation_id TEXT,
 create_attempted INTEGER NOT NULL DEFAULT 0 CHECK(create_attempted IN (0,1)),
 turn_attempted INTEGER NOT NULL DEFAULT 0 CHECK(turn_attempted IN (0,1)),
 format_version INTEGER NOT NULL CHECK(format_version=1),
 source_deleted INTEGER NOT NULL DEFAULT 0 CHECK(source_deleted IN (0,1)),
 source_digest TEXT CHECK(length(source_digest)=64),
 confirmation_digest TEXT CHECK(length(confirmation_digest)=64),
 plan_id TEXT REFERENCES chat_scheduled_plans(plan_id) ON DELETE RESTRICT,
 UNIQUE(owner_user_id,tenant_id,request_id),
 UNIQUE(owner_user_id,tenant_id,operation_id),
 UNIQUE(local_turn_id),
 CHECK((plan_id IS NULL)=(source_digest IS NULL)),
 CHECK((plan_id IS NULL)=(confirmation_digest IS NULL))
);
CREATE TABLE chat_scheduled_draft_confirm_requests (
 owner_user_id TEXT NOT NULL, tenant_id TEXT NOT NULL, request_id TEXT NOT NULL,
 source_id TEXT NOT NULL REFERENCES chat_scheduled_draft_sources(source_id) ON DELETE RESTRICT,
 confirmation_digest TEXT NOT NULL CHECK(length(confirmation_digest)=64),
 PRIMARY KEY(owner_user_id,tenant_id,request_id)
);
CREATE TRIGGER chat_scheduled_draft_source_deleted BEFORE DELETE ON chat_sessions
 BEGIN UPDATE chat_scheduled_draft_sources SET source_deleted=1,conversation_id=NULL,local_turn_id=NULL WHERE conversation_id=OLD.id; END;
