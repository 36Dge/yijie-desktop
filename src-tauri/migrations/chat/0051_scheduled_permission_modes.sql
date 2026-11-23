-- Every earlier grant and run was limited to ask. Preserve that authority when
-- upgrading, including pending deliveries. New grants freeze the effective mode.
ALTER TABLE chat_scheduled_grants ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'ask'
  CHECK(permission_mode IN ('ask','auto','full'));
-- The previous column admitted only the literal 'ask'. Recreate that constant
-- losslessly under the new three-value constraint in the migration transaction.
ALTER TABLE chat_scheduled_runs DROP COLUMN permission_mode;
ALTER TABLE chat_scheduled_runs ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'ask'
  CHECK(permission_mode IN ('ask','auto','full'));
