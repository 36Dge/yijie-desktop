-- Native resource intent journal. This is not another installer or delivery queue.
-- The complete first private request is retained; subsequent calls only query it.
CREATE TABLE chat_expert_resource_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version = 1),
  expert_id TEXT NOT NULL,
  expert_version TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('prepare','remove')),
  intent_digest TEXT NOT NULL CHECK(length(intent_digest) = 64),
  catalog_revision TEXT NOT NULL CHECK(length(catalog_revision) = 64),
  request_json TEXT NOT NULL CHECK(json_valid(request_json) AND length(request_json) <= 8192),
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json) AND length(receipt_json) <= 4096),
  state TEXT NOT NULL CHECK(state IN ('pending','succeeded','rejected','unknown')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
);
CREATE INDEX chat_expert_resource_operations_scope ON chat_expert_resource_operations(owner_user_id,tenant_id,updated_at);
-- Every version shares the managed installation root. Unknown work in any local
-- scope excludes a new operation against the same expert, including an upgrade.
CREATE UNIQUE INDEX chat_expert_resource_operations_unsettled ON chat_expert_resource_operations(expert_id) WHERE state IN ('pending','unknown');

-- Upgrade only the prior expert candidate's typed binding receipt projection.
-- The presence of its expert binding journal proves this is the managed family,
-- including a rejected first apply whose effective binding is still null/rev 0.
UPDATE chat_expert_binding_operations
SET receipt_json=json_set(receipt_json,'$.binding.managed',json('true'))
WHERE format_version=1 AND receipt_json IS NOT NULL
  AND json_valid(receipt_json) AND json_type(receipt_json,'$.binding')='object'
  AND json_type(receipt_json,'$.operation')='object'
  AND json_type(receipt_json,'$.binding.managed') IS NULL;
