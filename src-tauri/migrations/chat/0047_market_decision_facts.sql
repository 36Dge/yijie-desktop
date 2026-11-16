-- Read-only evidence in the existing encrypted conversation database. No grant,
-- capability, credential, retry, dispatch, actionable flag or raw arguments.
CREATE TABLE chat_market_decision_facts (
    decision_id TEXT NOT NULL CHECK(length(decision_id) = 36),
    fact_kind TEXT NOT NULL CHECK(fact_kind IN ('requested','acknowledged','unconfirmed')),
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    local_turn_id TEXT NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE,
    observed_at_unix_ms INTEGER NOT NULL CHECK(observed_at_unix_ms >= 0),
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND length(CAST(fact_json AS BLOB)) <= 4096),
    PRIMARY KEY(decision_id, fact_kind)
);
CREATE INDEX chat_market_decision_facts_turn
    ON chat_market_decision_facts(session_id, local_turn_id, observed_at_unix_ms);
