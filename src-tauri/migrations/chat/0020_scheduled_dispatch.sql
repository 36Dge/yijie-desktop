-- Native content-free dispatch diagnostics, separate from public-task binding
-- and from Runtime outcomes. No activation flag or additional execution queue.
ALTER TABLE chat_scheduled_recovery ADD COLUMN create_error_code TEXT
 CHECK(create_error_code IS NULL OR length(create_error_code) BETWEEN 1 AND 128);
ALTER TABLE chat_scheduled_recovery ADD COLUMN turn_error_code TEXT
 CHECK(turn_error_code IS NULL OR length(turn_error_code) BETWEEN 1 AND 128);
-- Only the v20 native candidate claim transaction writes this. Older claim
-- counters alone cannot establish that every side effect uses native admission.
ALTER TABLE chat_scheduled_recovery ADD COLUMN native_claim INTEGER NOT NULL DEFAULT 0
 CHECK(native_claim IN (0,1));
