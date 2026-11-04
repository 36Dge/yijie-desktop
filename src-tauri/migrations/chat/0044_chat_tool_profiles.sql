-- Immutable product choice only. Runtime owns actual tool generation.
-- Existing sessions have no row and retain their original full configuration.
CREATE TABLE chat_session_tool_profiles (
  session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
  tool_profile TEXT NOT NULL CHECK (tool_profile = 'light')
);
