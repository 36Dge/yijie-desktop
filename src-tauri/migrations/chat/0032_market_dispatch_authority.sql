-- A persisted submission must retain the authority revision under which its
-- local intent was accepted. Legacy SQL31 rows stay readable but revision 0
-- cannot acquire a new Host execution grant.
ALTER TABLE chat_market_submissions ADD COLUMN authorization_revision INTEGER NOT NULL DEFAULT 0 CHECK(authorization_revision >= 0);

ALTER TABLE chat_market_submissions ADD COLUMN native_process_epoch TEXT;
ALTER TABLE chat_market_submissions ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'ask' CHECK(permission_mode IN ('ask','auto','full'));

-- No active grant, bearer or provider credential is persisted here.
CREATE TABLE chat_market_dispatch (
  submission_operation_id TEXT PRIMARY KEY NOT NULL REFERENCES chat_market_submissions(submission_operation_id) ON DELETE CASCADE,
  format_version INTEGER NOT NULL CHECK(format_version = 1),
  state TEXT NOT NULL CHECK(state IN ('pending','inflight','uncertain','accepted','blocked')),
  host_instance_id TEXT,
  receipt_json TEXT CHECK(receipt_json IS NULL OR json_valid(receipt_json)),
  issue_code TEXT,
  updated_at INTEGER NOT NULL CHECK(updated_at >= 0)
);
