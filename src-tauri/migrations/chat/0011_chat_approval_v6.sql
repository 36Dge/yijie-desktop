-- FEAT-137 stores only the Host-projected safe approval lifecycle. The table
-- deliberately has no actionable bit and no Runtime request, command, cwd,
-- reason, permission, network, amendment, secret, or raw-wire column.
CREATE TABLE chat_turn_stream_versions_v6 (
  turn_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 6),
  FOREIGN KEY (turn_id) REFERENCES chat_turns(id) ON DELETE CASCADE
);

CREATE TABLE chat_approval_items_v6 (
  approval_request_id TEXT PRIMARY KEY CHECK (length(approval_request_id) = 36),
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'resolved')),
  revision INTEGER NOT NULL CHECK (revision IN (1, 2)),
  requested_at TEXT NOT NULL CHECK (length(requested_at) BETWEEN 20 AND 64),
  expires_at TEXT NOT NULL CHECK (length(expires_at) BETWEEN 20 AND 64),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN (
    'accepted_once', 'cancelled_current_turn', 'expired', 'resolved_elsewhere'
  )),
  decision_id TEXT CHECK (decision_id IS NULL OR length(decision_id) = 36),
  decision TEXT CHECK (decision IS NULL OR decision IN ('accept_once', 'cancel_current_turn')),
  resolved_at TEXT CHECK (resolved_at IS NULL OR length(resolved_at) BETWEEN 20 AND 64),
  source_event_id TEXT NOT NULL UNIQUE CHECK (length(source_event_id) = 36),
  source_sequence INTEGER NOT NULL CHECK (source_sequence >= 1),
  source_occurred_at TEXT NOT NULL CHECK (length(source_occurred_at) BETWEEN 20 AND 64),
  durable_sequence INTEGER NOT NULL CHECK (durable_sequence >= 1),
  FOREIGN KEY (turn_id, item_id)
    REFERENCES chat_timeline_items_v4(turn_id, item_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
  CHECK ((status = 'pending' AND revision = 1 AND outcome IS NULL
          AND decision_id IS NULL AND decision IS NULL AND resolved_at IS NULL)
      OR (status = 'resolved' AND revision = 2 AND outcome IS NOT NULL AND resolved_at IS NOT NULL)),
  CHECK ((outcome = 'accepted_once' AND decision_id IS NOT NULL AND decision = 'accept_once')
      OR (outcome = 'cancelled_current_turn' AND decision_id IS NOT NULL AND decision = 'cancel_current_turn')
      OR (outcome IN ('expired', 'resolved_elsewhere') AND decision_id IS NULL AND decision IS NULL)
      OR outcome IS NULL)
);

CREATE UNIQUE INDEX chat_approval_items_v6_one_pending_per_session
  ON chat_approval_items_v6(session_id) WHERE status = 'pending';

CREATE INDEX chat_approval_items_v6_history
  ON chat_approval_items_v6(session_id, durable_sequence, approval_request_id);
