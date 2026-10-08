-- Native durable provider intent. These generated payloads contain identifiers
-- and authority expiry only; OAuth URLs and provider secrets are never stored.
CREATE TABLE chat_connector_provider_operations (
  operation_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('auth','probe','forget')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  observation_json TEXT CHECK(observation_json IS NULL OR json_valid(observation_json)),
  browser_opened INTEGER NOT NULL DEFAULT 0 CHECK(browser_opened IN (0,1)),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
  PRIMARY KEY(owner_user_id,tenant_id,operation_id),
  FOREIGN KEY(owner_user_id,tenant_id,operation_id)
    REFERENCES chat_connector_operations(owner_user_id,tenant_id,operation_id) ON DELETE RESTRICT
);
CREATE INDEX chat_connector_provider_installation ON chat_connector_provider_operations(owner_user_id,tenant_id,installation_id,created_at);
