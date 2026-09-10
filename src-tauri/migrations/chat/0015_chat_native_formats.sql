-- FEAT-144 forward format protection. Existing JSON remains unchanged.
-- Older binaries reject database user_version 15 before reading new payloads.
ALTER TABLE chat_native_facts ADD COLUMN format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version > 0);
ALTER TABLE chat_native_views ADD COLUMN format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version > 0);
