-- Preserve every existing provider receipt and credential binding. Ordinary
-- suspension is distinct from irreversible credential removal.
CREATE TABLE chat_connector_provider_operations_next (
  operation_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('auth','probe','forget','suspend')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  observation_json TEXT CHECK(observation_json IS NULL OR json_valid(observation_json)),
  browser_opened INTEGER NOT NULL DEFAULT 0 CHECK(browser_opened IN (0,1)),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
  PRIMARY KEY(owner_user_id,tenant_id,operation_id),
  FOREIGN KEY(owner_user_id,tenant_id,operation_id)
    REFERENCES chat_connector_operations(owner_user_id,tenant_id,operation_id) ON DELETE RESTRICT
);
INSERT INTO chat_connector_provider_operations_next SELECT * FROM chat_connector_provider_operations;
DROP TABLE chat_connector_provider_operations;
ALTER TABLE chat_connector_provider_operations_next RENAME TO chat_connector_provider_operations;
CREATE INDEX chat_connector_provider_installation ON chat_connector_provider_operations(owner_user_id,tenant_id,installation_id,created_at);
