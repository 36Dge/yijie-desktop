-- New submissions only. Existing frozen selections and HMACs are immutable.
CREATE TABLE chat_builtin_web_selection_origins (
 submission_operation_id TEXT PRIMARY KEY REFERENCES chat_market_submissions(submission_operation_id) ON DELETE RESTRICT,
 normalization_version INTEGER NOT NULL CHECK(normalization_version=1),
 original_selection_json TEXT NOT NULL CHECK(json_valid(original_selection_json))
);
