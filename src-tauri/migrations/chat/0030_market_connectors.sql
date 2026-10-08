-- FEAT-157 local product authority. This store never contains provider secrets.
-- Generation/revision survive uninstall; reinstall cannot revive a stale selection.
CREATE TABLE chat_connector_installations (
  installation_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  format_version INTEGER NOT NULL CHECK(format_version=1),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),
  catalog_revision INTEGER NOT NULL CHECK(catalog_revision BETWEEN 1 AND 9007199254740991),
  installed INTEGER NOT NULL CHECK(installed IN (0,1)),
  desired_enabled INTEGER NOT NULL CHECK(desired_enabled IN (0,1)),
  credential_ref TEXT,
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
  CHECK(installed=1 OR desired_enabled=0),
  UNIQUE(owner_user_id,tenant_id,service_id),
  UNIQUE(installation_id,owner_user_id,tenant_id)
);
CREATE TABLE chat_connector_operations (
  operation_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
  format_version INTEGER NOT NULL CHECK(format_version=1),
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  PRIMARY KEY(owner_user_id,tenant_id,operation_id),
  FOREIGN KEY(installation_id,owner_user_id,tenant_id)
    REFERENCES chat_connector_installations(installation_id,owner_user_id,tenant_id)
    ON DELETE RESTRICT
);
CREATE INDEX chat_connector_scope ON chat_connector_installations(owner_user_id,tenant_id,installed,service_id);
