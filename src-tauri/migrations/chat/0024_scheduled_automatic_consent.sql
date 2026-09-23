-- Explicit finite background consent. Historical enable receipts remain NULL.
-- Unknown future consent versions remain readable but never authorize dispatch.
ALTER TABLE chat_scheduled_enable_receipts ADD COLUMN automatic_consent_version INTEGER
  CHECK(automatic_consent_version IS NULL OR automatic_consent_version > 0);
