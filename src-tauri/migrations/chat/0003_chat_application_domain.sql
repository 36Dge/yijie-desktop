CREATE UNIQUE INDEX chat_messages_turn_role_unique_idx
  ON chat_messages(turn_id, role)
  WHERE turn_id IS NOT NULL;

CREATE INDEX chat_outbox_ready_idx
  ON chat_outbox(state, next_attempt_at, operation_id);
