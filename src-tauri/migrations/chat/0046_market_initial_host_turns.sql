-- An explicit new turn after proven pre-dispatch rejection may be the first
-- Host turn in an existing local chat. Old readers must not dispatch this as a
-- bound continuation. Original failed messages/receipts are never rewritten.
CREATE TABLE chat_market_initial_host_turns (
    operation_id TEXT PRIMARY KEY REFERENCES chat_market_submissions(submission_operation_id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    format_version INTEGER NOT NULL CHECK(format_version = 1),
    local_model_revision INTEGER NOT NULL CHECK(local_model_revision = 1)
);
