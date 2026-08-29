-- FEAT-136 adds an additive private DB migration for the semantic v5 wire.
-- Existing v4 rows retain source_schema_version=4 while the v5 path writes 5
-- explicitly. No wire payload or unredacted producer value is stored.
ALTER TABLE chat_observed_events_v4 ADD COLUMN source_schema_version INTEGER NOT NULL DEFAULT 4
  CHECK (source_schema_version IN (4, 5));

ALTER TABLE chat_timeline_items_v4 ADD COLUMN source_schema_version INTEGER NOT NULL DEFAULT 4
  CHECK (source_schema_version IN (4, 5));

CREATE TABLE chat_command_items_v5 (
  turn_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'declined', 'incomplete')),
  started_source_event_id TEXT NOT NULL CHECK (length(started_source_event_id) = 36),
  started_source_sequence INTEGER NOT NULL CHECK (started_source_sequence >= 1),
  started_source_occurred_at TEXT NOT NULL CHECK (length(started_source_occurred_at) BETWEEN 1 AND 64),
  last_source_event_id TEXT NOT NULL CHECK (length(last_source_event_id) = 36),
  last_source_sequence INTEGER NOT NULL CHECK (last_source_sequence >= started_source_sequence),
  last_source_occurred_at TEXT NOT NULL CHECK (length(last_source_occurred_at) BETWEEN 1 AND 64),
  command_summary TEXT NOT NULL,
  command_summary_bytes INTEGER NOT NULL CHECK (command_summary_bytes BETWEEN 0 AND 4096),
  command_summary_truncated INTEGER NOT NULL CHECK (command_summary_truncated IN (0, 1)),
  command_summary_truncation_reason TEXT CHECK (
    command_summary_truncation_reason IS NULL
    OR command_summary_truncation_reason IN ('utf8_byte_limit', 'upstream_truncated')
  ),
  cwd_kind TEXT NOT NULL CHECK (cwd_kind IN ('workspace_root', 'workspace_relative', 'redacted')),
  live_output TEXT,
  live_output_bytes INTEGER CHECK (live_output_bytes IS NULL OR live_output_bytes BETWEEN 0 AND 262144),
  live_output_truncated INTEGER CHECK (live_output_truncated IS NULL OR live_output_truncated IN (0, 1)),
  live_output_truncation_reason TEXT CHECK (
    live_output_truncation_reason IS NULL
    OR live_output_truncation_reason IN ('utf8_byte_limit', 'upstream_truncated')
  ),
  output_retention TEXT CHECK (output_retention IS NULL OR output_retention IN ('complete', 'head_tail', 'unavailable')),
  output_text TEXT,
  output_head TEXT,
  output_tail TEXT,
  output_reason TEXT CHECK (output_reason IS NULL OR output_reason = 'not_available'),
  output_truncated INTEGER CHECK (output_truncated IS NULL OR output_truncated IN (0, 1)),
  output_truncation_reason TEXT CHECK (
    output_truncation_reason IS NULL
    OR output_truncation_reason IN ('utf8_byte_limit', 'upstream_truncated')
  ),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  exit_code INTEGER CHECK (exit_code IS NULL OR exit_code BETWEEN -2147483648 AND 2147483647),
  error_code TEXT CHECK (error_code IS NULL OR error_code IN (
    'command_failed', 'command_declined', 'projection_limit_exceeded',
    'projection_redaction_failed', 'protocol_error'
  )),
  error_summary TEXT,
  PRIMARY KEY (turn_id, item_id),
  FOREIGN KEY (turn_id, item_id)
    REFERENCES chat_timeline_items_v4(turn_id, item_id) ON DELETE CASCADE,
  CHECK ((command_summary_truncated = 0 AND command_summary_truncation_reason IS NULL)
      OR (command_summary_truncated = 1 AND command_summary_truncation_reason IS NOT NULL)),
  CHECK ((live_output IS NULL AND live_output_bytes IS NULL AND live_output_truncated IS NULL
          AND live_output_truncation_reason IS NULL)
      OR (live_output IS NOT NULL AND live_output_bytes IS NOT NULL AND live_output_truncated IS NOT NULL
          AND ((live_output_truncated = 0 AND live_output_truncation_reason IS NULL)
            OR (live_output_truncated = 1 AND live_output_truncation_reason IS NOT NULL)))),
  CHECK ((output_retention IS NULL AND output_text IS NULL AND output_head IS NULL AND output_tail IS NULL
          AND output_reason IS NULL AND output_truncated IS NULL AND output_truncation_reason IS NULL)
      OR (output_retention = 'complete' AND output_text IS NOT NULL AND output_head IS NULL AND output_tail IS NULL
          AND output_reason IS NULL AND output_truncated = 0 AND output_truncation_reason IS NULL)
      OR (output_retention = 'head_tail' AND output_text IS NULL AND output_head IS NOT NULL AND output_tail IS NOT NULL
          AND output_reason IS NULL AND output_truncated = 1)
      OR (output_retention = 'unavailable' AND output_text IS NULL AND output_head IS NULL AND output_tail IS NULL
          AND output_reason IS NOT NULL AND output_truncated = 0 AND output_truncation_reason IS NULL)),
  CHECK ((output_truncated = 0 AND output_truncation_reason IS NULL)
      OR (output_truncated = 1 AND output_truncation_reason IS NOT NULL)
      OR output_truncated IS NULL),
  CHECK ((error_code IS NULL AND error_summary IS NULL)
      OR (error_code IS NOT NULL AND error_summary IS NOT NULL)),
  CHECK ((status = 'running' AND output_retention IS NULL AND duration_ms IS NULL AND exit_code IS NULL AND error_code IS NULL)
      OR (status = 'completed' AND output_retention IS NOT NULL AND error_code IS NULL)
      OR (status = 'failed' AND output_retention IS NOT NULL AND error_code IN (
        'command_failed', 'projection_limit_exceeded', 'projection_redaction_failed', 'protocol_error'
      ))
      OR (status = 'declined' AND output_retention IS NOT NULL AND error_code = 'command_declined')
      OR status = 'incomplete')
);

CREATE TABLE chat_command_cwd_segments_v5 (
  turn_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 127),
  segment TEXT NOT NULL,
  byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 255),
  PRIMARY KEY (turn_id, item_id, ordinal),
  FOREIGN KEY (turn_id, item_id)
    REFERENCES chat_command_items_v5(turn_id, item_id) ON DELETE CASCADE
);

CREATE TABLE chat_tool_items_v5 (
  turn_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed', 'declined', 'incomplete')),
  started_source_event_id TEXT NOT NULL CHECK (length(started_source_event_id) = 36),
  started_source_sequence INTEGER NOT NULL CHECK (started_source_sequence >= 1),
  started_source_occurred_at TEXT NOT NULL CHECK (length(started_source_occurred_at) BETWEEN 1 AND 64),
  last_source_event_id TEXT NOT NULL CHECK (length(last_source_event_id) = 36),
  last_source_sequence INTEGER NOT NULL CHECK (last_source_sequence >= started_source_sequence),
  last_source_occurred_at TEXT NOT NULL CHECK (length(last_source_occurred_at) BETWEEN 1 AND 64),
  identity_resolution TEXT NOT NULL CHECK (identity_resolution IN ('known', 'unknown')),
  server_name TEXT NOT NULL CHECK (length(server_name) BETWEEN 1 AND 256),
  tool_name TEXT NOT NULL CHECK (length(tool_name) BETWEEN 1 AND 256),
  arguments_summary TEXT NOT NULL,
  arguments_summary_bytes INTEGER NOT NULL CHECK (arguments_summary_bytes BETWEEN 0 AND 8192),
  arguments_summary_truncated INTEGER NOT NULL CHECK (arguments_summary_truncated IN (0, 1)),
  arguments_summary_truncation_reason TEXT CHECK (
    arguments_summary_truncation_reason IS NULL
    OR arguments_summary_truncation_reason IN ('utf8_byte_limit', 'upstream_truncated')
  ),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  result_summary TEXT,
  result_summary_bytes INTEGER CHECK (result_summary_bytes IS NULL OR result_summary_bytes BETWEEN 0 AND 65536),
  result_summary_truncated INTEGER CHECK (result_summary_truncated IS NULL OR result_summary_truncated IN (0, 1)),
  result_summary_truncation_reason TEXT CHECK (
    result_summary_truncation_reason IS NULL
    OR result_summary_truncation_reason IN ('utf8_byte_limit', 'upstream_truncated')
  ),
  error_code TEXT CHECK (error_code IS NULL OR error_code IN (
    'tool_failed', 'tool_declined', 'unknown_tool', 'projection_limit_exceeded',
    'projection_redaction_failed', 'protocol_error'
  )),
  error_summary TEXT,
  PRIMARY KEY (turn_id, item_id),
  FOREIGN KEY (turn_id, item_id)
    REFERENCES chat_timeline_items_v4(turn_id, item_id) ON DELETE CASCADE,
  CHECK ((identity_resolution = 'unknown' AND server_name = 'unknown' AND tool_name = 'unknown')
      OR identity_resolution = 'known'),
  CHECK ((arguments_summary_truncated = 0 AND arguments_summary_truncation_reason IS NULL)
      OR (arguments_summary_truncated = 1 AND arguments_summary_truncation_reason IS NOT NULL)),
  CHECK ((result_summary IS NULL AND result_summary_bytes IS NULL AND result_summary_truncated IS NULL
          AND result_summary_truncation_reason IS NULL)
      OR (result_summary IS NOT NULL AND result_summary_bytes IS NOT NULL AND result_summary_truncated IS NOT NULL
          AND ((result_summary_truncated = 0 AND result_summary_truncation_reason IS NULL)
            OR (result_summary_truncated = 1 AND result_summary_truncation_reason IS NOT NULL)))),
  CHECK ((error_code IS NULL AND error_summary IS NULL)
      OR (error_code IS NOT NULL AND error_summary IS NOT NULL)),
  CHECK ((status = 'in_progress' AND duration_ms IS NULL AND result_summary IS NULL AND error_code IS NULL)
      OR (status = 'completed' AND result_summary IS NOT NULL AND error_code IS NULL)
      OR (status = 'failed' AND error_code IN (
        'tool_failed', 'unknown_tool', 'projection_limit_exceeded',
        'projection_redaction_failed', 'protocol_error'
      ))
      OR (status = 'declined' AND result_summary IS NULL AND error_code = 'tool_declined')
      OR status = 'incomplete')
);

CREATE TABLE chat_tool_progress_v5 (
  turn_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  progress_index INTEGER NOT NULL CHECK (progress_index BETWEEN 0 AND 31),
  source_event_id TEXT NOT NULL UNIQUE CHECK (length(source_event_id) = 36),
  source_sequence INTEGER NOT NULL CHECK (source_sequence >= 1),
  source_occurred_at TEXT NOT NULL CHECK (length(source_occurred_at) BETWEEN 1 AND 64),
  summary TEXT NOT NULL,
  summary_bytes INTEGER NOT NULL CHECK (summary_bytes BETWEEN 0 AND 4096),
  summary_truncated INTEGER NOT NULL CHECK (summary_truncated IN (0, 1)),
  summary_truncation_reason TEXT CHECK (
    summary_truncation_reason IS NULL
    OR summary_truncation_reason IN ('utf8_byte_limit', 'upstream_truncated')
  ),
  PRIMARY KEY (turn_id, item_id, progress_index),
  FOREIGN KEY (turn_id, item_id)
    REFERENCES chat_tool_items_v5(turn_id, item_id) ON DELETE CASCADE,
  CHECK ((summary_truncated = 0 AND summary_truncation_reason IS NULL)
      OR (summary_truncated = 1 AND summary_truncation_reason IS NOT NULL))
);

CREATE INDEX chat_observed_events_v5_schema_idx
  ON chat_observed_events_v4(session_id, source_schema_version, durable_sequence);
