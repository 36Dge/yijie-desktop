ALTER TABLE chat_turns ADD COLUMN terminal_code TEXT
  CHECK (terminal_code IS NULL OR length(terminal_code) BETWEEN 1 AND 128);

CREATE TABLE chat_projection_counters_v4 (
  session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
  last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0)
);

-- This counter is processing provenance only. It deliberately associates thread-scoped Host
-- warnings with the active local Turn without changing their semantic scope or assigning a Host
-- turn_id. The bounded count survives Desktop restarts and is updated with the observed fact.
CREATE TABLE chat_turn_projection_counters_v4 (
  turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
  observed_event_count INTEGER NOT NULL CHECK (observed_event_count >= 0),
  observed_event_bytes INTEGER NOT NULL CHECK (observed_event_bytes >= 0)
);

CREATE TABLE chat_observed_events_v4 (
  event_id TEXT PRIMARY KEY CHECK (length(event_id) = 36),
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES chat_turns(id) ON DELETE CASCADE,
  stream_id TEXT NOT NULL CHECK (length(stream_id) = 36),
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  durable_sequence INTEGER NOT NULL CHECK (durable_sequence >= 1),
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 128),
  source_occurred_at TEXT NOT NULL CHECK (length(source_occurred_at) BETWEEN 1 AND 64),
  observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0),
  UNIQUE (session_id, stream_id, sequence),
  UNIQUE (session_id, durable_sequence)
);

CREATE TABLE chat_timeline_items_v4 (
  turn_id TEXT NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 256),
  item_ordinal INTEGER NOT NULL CHECK (item_ordinal BETWEEN 1 AND 512),
  item_type TEXT NOT NULL CHECK (length(item_type) BETWEEN 1 AND 256),
  phase TEXT CHECK (phase IS NULL OR phase IN ('commentary', 'final_answer')),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'incomplete')),
  text TEXT NOT NULL,
  reasoning_status TEXT CHECK (
    reasoning_status IS NULL OR reasoning_status IN ('complete', 'incomplete', 'unavailable')
  ),
  reasoning_reason_code TEXT CHECK (
    reasoning_reason_code IS NULL OR length(reasoning_reason_code) BETWEEN 1 AND 128
  ),
  reasoning_finalized_at_ms INTEGER CHECK (
    reasoning_finalized_at_ms IS NULL OR reasoning_finalized_at_ms >= started_at_ms
  ),
  started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
  completed_at_ms INTEGER CHECK (completed_at_ms IS NULL OR completed_at_ms >= started_at_ms),
  source_event_id TEXT NOT NULL CHECK (length(source_event_id) = 36),
  source_sequence INTEGER NOT NULL CHECK (source_sequence >= 1),
  source_occurred_at TEXT NOT NULL CHECK (length(source_occurred_at) BETWEEN 1 AND 64),
  PRIMARY KEY (turn_id, item_id),
  UNIQUE (turn_id, item_ordinal),
  CHECK ((item_type = 'agentMessage') OR phase IS NULL),
  CHECK ((reasoning_status IS NULL AND reasoning_reason_code IS NULL)
      OR (reasoning_status = 'complete' AND reasoning_reason_code IS NULL)
      OR (reasoning_status IN ('incomplete', 'unavailable') AND reasoning_reason_code IS NOT NULL)),
  CHECK ((reasoning_status IS NULL AND reasoning_finalized_at_ms IS NULL)
      OR (reasoning_status IS NOT NULL AND reasoning_finalized_at_ms IS NOT NULL))
);

CREATE TABLE chat_timeline_reasoning_parts_v4 (
  turn_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  content_index INTEGER NOT NULL CHECK (content_index BETWEEN 0 AND 7),
  text TEXT NOT NULL,
  byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 65536),
  PRIMARY KEY (turn_id, item_id, content_index),
  FOREIGN KEY (turn_id, item_id)
    REFERENCES chat_timeline_items_v4(turn_id, item_id) ON DELETE CASCADE
);

CREATE TABLE chat_turn_plans_v4 (
  turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL CHECK (length(source_event_id) = 36),
  source_sequence INTEGER NOT NULL CHECK (source_sequence >= 1),
  source_occurred_at TEXT NOT NULL CHECK (length(source_occurred_at) BETWEEN 1 AND 64),
  explanation TEXT,
  observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0)
);

CREATE TABLE chat_turn_plan_steps_v4 (
  turn_id TEXT NOT NULL REFERENCES chat_turn_plans_v4(turn_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 127),
  step TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed')),
  PRIMARY KEY (turn_id, ordinal)
);

CREATE TABLE chat_timeline_notices_v4 (
  source_event_id TEXT PRIMARY KEY CHECK (length(source_event_id) = 36),
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES chat_turns(id) ON DELETE CASCADE,
  source_sequence INTEGER NOT NULL CHECK (source_sequence >= 1),
  source_occurred_at TEXT NOT NULL CHECK (length(source_occurred_at) BETWEEN 1 AND 64),
  scope TEXT NOT NULL CHECK (scope IN ('session', 'turn')),
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'error')),
  code TEXT CHECK (code IS NULL OR length(code) BETWEEN 1 AND 128),
  will_retry INTEGER NOT NULL CHECK (will_retry IN (0, 1)),
  observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0),
  CHECK ((scope = 'session' AND severity = 'warning' AND turn_id IS NULL AND will_retry = 0)
      OR (scope = 'turn' AND severity = 'error' AND turn_id IS NOT NULL))
);

CREATE TABLE chat_turn_terminals_v4 (
  turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL CHECK (length(source_event_id) = 36),
  source_sequence INTEGER NOT NULL CHECK (source_sequence >= 1),
  source_occurred_at TEXT NOT NULL CHECK (length(source_occurred_at) BETWEEN 1 AND 64),
  status TEXT NOT NULL CHECK (status IN ('completed', 'interrupted', 'failed')),
  code TEXT CHECK (code IS NULL OR length(code) BETWEEN 1 AND 128),
  observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0)
);

CREATE INDEX chat_observed_events_v4_session_sequence_idx
  ON chat_observed_events_v4(session_id, stream_id, sequence);
CREATE INDEX chat_observed_events_v4_session_durable_sequence_idx
  ON chat_observed_events_v4(session_id, durable_sequence);
CREATE INDEX chat_timeline_notices_v4_session_idx
  ON chat_timeline_notices_v4(session_id, scope, source_sequence);
