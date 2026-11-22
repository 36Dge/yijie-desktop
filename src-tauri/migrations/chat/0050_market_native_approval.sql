-- Freeze the negotiated profile on acceptance. Earlier outbox rows keep legacy semantics.
ALTER TABLE chat_market_submissions ADD COLUMN native_approval_version INTEGER
    CHECK (native_approval_version IS NULL OR native_approval_version = 1);
