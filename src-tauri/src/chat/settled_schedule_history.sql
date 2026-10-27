-- FEAT-164 private maintenance admission, not a quota refund or execution grant.
-- Normal terminal release retains consumed quota; normal target deletion retains
-- the original run/recovery proof and marks the binding target_deleted.
WITH settled AS (
  SELECT r.run_id, r.grant_id, e.refunded
  FROM chat_scheduled_runs r
  JOIN chat_scheduled_grants g ON g.grant_id = r.grant_id
  JOIN chat_scheduled_recovery e ON e.run_id = r.run_id
  JOIN chat_scheduled_run_bindings b ON b.run_id = r.run_id
  WHERE r.format_version = 1 AND e.format_version = 1
    AND r.owner_user_id = g.owner_user_id AND r.tenant_id = g.tenant_id
    AND r.plan_id = g.plan_id AND r.plan_revision = g.plan_revision
    AND r.needs_attention = 0
    AND NOT EXISTS (SELECT 1 FROM chat_scheduled_reservation v WHERE v.run_id = r.run_id)
    AND (
      (e.refunded = 0 AND e.release_kind = 'native_terminal'
       AND length(e.release_reference) > 0
       AND r.delivery_state = 'terminal'
       AND r.native_outcome IN ('completed', 'failed', 'interrupted')
       AND e.turn_attempt = 'attempted'
       AND (
         (b.target_deleted = 1 AND b.conversation_id IS NULL)
         OR (b.target_deleted = 0 AND EXISTS (
           SELECT 1 FROM chat_turns t
           JOIN chat_sessions s ON s.id = t.session_id
           JOIN chat_native_bindings n ON n.turn_id = t.id AND n.session_id = t.session_id
           JOIN chat_native_views v ON v.turn_id = t.id AND v.session_id = t.session_id
           WHERE t.id = b.local_turn_id AND t.session_id = b.conversation_id
             AND t.operation_id = r.operation_id
             AND s.owner_user_id = r.owner_user_id AND s.tenant_id = r.tenant_id
             AND t.scheduled_quiescent = 1 AND t.runtime_turn_id = e.release_reference
             AND n.runtime_turn_id = t.runtime_turn_id AND n.runtime_thread_id = s.runtime_thread_id
             AND v.format_version BETWEEN 1 AND 5 AND json_valid(v.view_json)
             AND json_extract(v.view_json, '$.status') = r.native_outcome
         ))
       ))
      OR
      (e.refunded = 1 AND e.release_kind = 'never_sent_cancel'
       AND e.release_reference = r.run_id
       AND r.delivery_state = 'cancelled' AND r.native_outcome = 'unobserved'
       AND e.create_attempt IN ('never', 'not_required') AND e.turn_attempt = 'never'
       AND (
         (b.target_deleted = 1 AND b.conversation_id IS NULL)
         OR (b.target_deleted = 0 AND EXISTS (
           SELECT 1 FROM chat_turns t JOIN chat_sessions s ON s.id = t.session_id
           WHERE t.id = b.local_turn_id AND t.session_id = b.conversation_id
             AND t.operation_id = r.operation_id AND t.runtime_turn_id IS NULL
             AND t.submission_status = 'cancelled' AND t.scheduled_quiescent = 1
             AND s.owner_user_id = r.owner_user_id AND s.tenant_id = r.tenant_id
         ))
       ))
    )
)
SELECT (
  EXISTS (
    SELECT 1 FROM chat_scheduled_grants g
    WHERE g.occupied_runs < 0 OR g.occupied_runs > g.max_runs OR g.max_runs < 1
       OR g.occupied_runs != (SELECT count(*) FROM settled s WHERE s.grant_id = g.grant_id AND s.refunded = 0)
       OR (SELECT count(*) FROM chat_scheduled_runs r WHERE r.grant_id = g.grant_id)
          != (SELECT count(*) FROM settled s WHERE s.grant_id = g.grant_id)
  )
  OR EXISTS (
    SELECT 1 FROM chat_scheduled_runs r
    WHERE NOT EXISTS (SELECT 1 FROM chat_scheduled_grants g WHERE g.grant_id = r.grant_id)
  )
) AS unsettled_grant_history;
