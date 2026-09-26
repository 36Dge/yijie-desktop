//! Recover user-requested deletion without equating cancellation or a missing
//! Host mapping with confirmed Runtime cleanup.
use super::*;

// A cancelled attempted submission can be handed to the existing Host cleanup
// endpoint only with its original bound identity and no remaining dispatch.
// Host atomically excludes active/unconfirmed turns and confirms thread deletion.
pub(super) const CANCELLED_HOST_CLEANUP_TURN: &str = "(
    t.submission_status='cancelled' AND t.runtime_turn_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM chat_native_bindings n WHERE n.turn_id=t.id)
    AND EXISTS(SELECT 1 FROM chat_sessions s
      JOIN chat_public_task_bindings b ON b.session_id=s.id AND b.state='bound'
      WHERE s.id=t.session_id AND s.agent_session_id IS NOT NULL
        AND s.runtime_thread_id IS NOT NULL)
    AND EXISTS(SELECT 1 FROM chat_outbox o WHERE o.session_id=t.session_id
      AND o.operation_id=t.operation_id AND o.kind='start_turn'
      AND o.state='failed' AND o.attempt_count>0 AND o.payload_version IN (1,2)
      AND CASE WHEN json_valid(CAST(o.encrypted_payload AS TEXT))
        THEN json_extract(CAST(o.encrypted_payload AS TEXT),'$.turn_id')=t.id ELSE 0 END)
    AND NOT EXISTS(SELECT 1 FROM chat_outbox o WHERE o.session_id=t.session_id
      AND o.state IN ('pending','inflight'))
)";

impl ChatRepository {
    /// Called only after the authenticated, nonce-checked cleanup endpoint
    /// returns its typed session_not_found response. Other failures never enter
    /// this path. The receipt explicitly retains unconfirmed remote surfaces.
    pub(crate) fn complete_missing_host_deletion(
        &mut self,
        operation_id: Uuid,
        agent_session_id: Uuid,
        now: i64,
    ) -> Result<DeletionStatus, ChatError> {
        validate_non_nil(operation_id)?;
        validate_non_nil(agent_session_id)?;
        if now < 0 {
            return Err(ChatError::InvalidInput);
        }
        let (keyed_hash, payload): (String, Vec<u8>) = self
            .connection
            .query_row(
                "SELECT keyed_session_hash, encrypted_retry_ids FROM chat_deletion_jobs
             WHERE operation_id=?1 AND outcome_code='pending'",
                [operation_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .ok_or(ChatError::NotFound)?;
        let retry: DeletionRetryIdsV1 = decode_payload(&payload)?;
        if retry.agent_session_id != Some(agent_session_id)
            || keyed_hash
                != scoped_session_hash(
                    &self.receipt_key,
                    &self.scope.owner_user_id,
                    &self.scope.tenant_id,
                    retry.session_id,
                )
        {
            return Err(ChatError::ConversationConflict);
        }

        // Missing Host identity cannot settle an uncertain or active local turn.
        let blocked: bool = self
            .connection
            .query_row(
                &super::super::schedules::recovery::coordination_sql(
                    &self.connection,
                    &format!(
                        "SELECT EXISTS(SELECT 1 FROM chat_turns t WHERE t.session_id=?1
                   AND (t.status IN ('streaming','stopping')
                     OR (t.status='queued' AND NOT COALESCE({CANCELLED_UNSTARTED_TURN},0))))
                 OR EXISTS(SELECT 1 FROM chat_outbox WHERE session_id=?1
                   AND state IN ('pending','inflight'))"
                    ),
                )?,
                [retry.session_id.to_string()],
                |row| row.get(0),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if blocked {
            return Err(ChatError::ConversationConflict);
        }

        self.connection.execute(
            "UPDATE chat_deletion_jobs SET last_error_code='host_session_not_found',
               host_state=CASE WHEN host_state='complete' THEN host_state ELSE 'incomplete' END,
               runtime_state=CASE WHEN runtime_state='complete' THEN runtime_state ELSE 'incomplete' END
             WHERE operation_id=?1", [operation_id.to_string()],
        ).map_err(|_| ChatError::DatabaseUnavailable)?;
        let exists: bool = self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM chat_sessions WHERE id=?1
               AND owner_user_id=?2 AND tenant_id=?3)",
                params![
                    retry.session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| row.get(0),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if exists {
            self.delete_session_local(&retry.session_id.to_string())?;
        } else {
            self.checkpoint_after_delete()?;
        }
        self.connection
            .execute(
                "UPDATE chat_deletion_jobs SET desktop_state='complete', updated_at=?2
             WHERE operation_id=?1",
                params![operation_id.to_string(), now],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        self.write_deletion_receipt(operation_id, now, true)
    }
}
