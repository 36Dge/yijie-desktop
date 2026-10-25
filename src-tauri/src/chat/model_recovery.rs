//! Native model operations bind original intent before any Host configuration.
//! Old pending rows have no v2 proof and are never backfilled or replayed as v2.
use super::{
    database::ChatRepository,
    error::ChatError,
    models::{ModelIntent, ModelState},
    models_generated as wire,
};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub(crate) struct ModelRecovery {
    pub session: Uuid,
    pub host: Uuid,
    pub thread: String,
    pub previous: String,
    pub request: wire::SelectRequest,
    pub phase: String,
}
fn db_error(_: rusqlite::Error) -> ChatError {
    ChatError::DatabaseUnavailable
}
fn conflict() -> ChatError {
    ChatError::ConversationConflict
}
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RecoveryAction {
    FirstSend,
    Reapply,
    ReadCommitted,
}
pub(crate) fn recovery_action(
    proof: &ModelRecovery,
    receipt: Option<&wire::ModelOperationReceipt>,
) -> Result<RecoveryAction, ChatError> {
    if let Some(receipt) = receipt {
        super::host_bridge::models::validate_operation_receipt(receipt, proof.host, &proof.request)
            .map_err(|_| conflict())?;
        return match receipt.state {
            wire::ModelOperationState::Committed => Ok(RecoveryAction::ReadCommitted),
            wire::ModelOperationState::Prepared
            | wire::ModelOperationState::Applying
            | wire::ModelOperationState::Unknown
                if proof.phase != "committed" =>
            {
                Ok(RecoveryAction::Reapply)
            }
            _ => Err(conflict()),
        };
    }
    if proof.phase == "prepared" {
        Ok(RecoveryAction::FirstSend)
    } else {
        Err(conflict())
    }
}
pub(super) fn present(db: &Connection) -> Result<bool, ChatError> {
    db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='chat_model_operations_v2' AND type='table')",[],|r|r.get(0)).map_err(db_error)
}

fn idle(
    db: &Connection,
    scope: &super::database::ChatScope,
    session: Uuid,
) -> Result<(), ChatError> {
    super::schedules::execution_guard::foreground(db)?;
    // v2 model selection is not legacy business dispatch. Settled market and
    // expert histories keep their frozen payloads while a new model operation
    // selects the same thread's future configuration. Missing/unfinished
    // delivery evidence must still block both intent creation and dispatch.
    let cancelled_market = if super::delivery::present(db)? {
        "d.state='blocked' AND COALESCE(d.issue_code,'')='cancelled_never_sent' AND EXISTS(SELECT 1 FROM chat_delivery_proofs p WHERE p.operation_id=m.turn_operation_id AND p.session_id=m.session_id AND p.turn_id=m.local_turn_id AND p.format_version=1 AND p.family IN ('market','expert') AND p.phase='cancelled' AND p.receipt_json IS NOT NULL AND p.public_attempts=0 AND p.create_attempts=0 AND p.turn_attempts=0)"
    } else {
        "0"
    };
    let market_unsettled: bool = db.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM chat_market_submissions m LEFT JOIN chat_market_dispatch d ON d.submission_operation_id=m.submission_operation_id WHERE m.session_id=?1 AND (m.format_version!=1 OR d.format_version IS NULL OR d.format_version!=1 OR (d.state!='accepted' AND NOT ({cancelled_market}))))"),
        [session.to_string()], |r| r.get(0),
    ).map_err(db_error)?;
    if market_unsettled {
        return Err(conflict());
    }
    if super::schedules::drafts::is_draft(db, scope, &session.to_string())? {
        return Err(conflict());
    }
    super::experts::store::require_settled(db, &session.to_string()).map_err(|_| conflict())?;
    let cancelled = if super::delivery::present(db)? {
        "AND NOT (t.submission_status='cancelled' AND EXISTS(SELECT 1 FROM chat_delivery_proofs dp WHERE dp.operation_id=t.operation_id AND dp.session_id=t.session_id AND dp.turn_id=t.id AND dp.phase='cancelled' AND dp.receipt_json IS NOT NULL))"
    } else {
        ""
    };
    let ok:bool=db.query_row(&format!("SELECT EXISTS(SELECT 1 FROM chat_sessions s JOIN chat_projects p ON p.id=s.project_id AND p.owner_user_id=s.owner_user_id AND p.tenant_id=s.tenant_id WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3 AND s.agent_session_id IS NOT NULL AND s.runtime_thread_id IS NOT NULL AND p.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs j WHERE j.session_id=s.id) AND NOT EXISTS(SELECT 1 FROM chat_outbox o WHERE o.session_id=s.id AND o.state IN ('pending','inflight')) AND NOT EXISTS(SELECT 1 FROM chat_turns t WHERE t.session_id=s.id AND t.status IN ('queued','streaming','stopping') {cancelled}))"),params![session.to_string(),scope.owner_user_id,scope.tenant_id],|r|r.get(0)).map_err(db_error)?;
    if !ok {
        return Err(conflict());
    }
    Ok(())
}

impl ChatRepository {
    pub(crate) fn model_recovery(
        &self,
        session: Uuid,
        op: Uuid,
    ) -> Result<Option<ModelRecovery>, ChatError> {
        let current_host = self.agent_session_id_for_session_optional_model(session)?;
        if !present(&self.connection)? {
            return Ok(None);
        }
        let row:Option<(String,String,String,String,i64,String,i64)>=self.connection.query_row("SELECT host_session_id,runtime_thread_id,previous_profile_id,target_profile_id,expected_revision,phase,format_version FROM chat_model_operations_v2 WHERE session_id=?1 AND operation_id=?2",params![session.to_string(),op.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional().map_err(db_error)?;
        let Some((host, thread, previous, target, revision, phase, version)) = row else {
            return Ok(None);
        };
        let current_thread: Option<String> = self
            .connection
            .query_row(
                "SELECT runtime_thread_id FROM chat_sessions WHERE id=?1",
                [session.to_string()],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        if current_host.map(|v| v.to_string()).as_deref() != Some(host.as_str())
            || current_thread.as_deref() != Some(thread.as_str())
        {
            return Err(conflict());
        }
        let profile =
            serde_json::from_value::<wire::ActiveProfileId>(serde_json::Value::String(target))
                .map_err(|_| conflict())?;
        if version != 2
            || !(0..9007199254740991).contains(&revision)
            || !matches!(
                phase.as_str(),
                "prepared" | "dispatched" | "unknown" | "committed"
            )
        {
            return Err(conflict());
        }
        let recovery = ModelRecovery {
            session,
            host: Uuid::parse_str(&host).map_err(|_| conflict())?,
            thread,
            previous,
            request: wire::SelectRequest {
                schema_version: 2,
                operation_id: op.to_string(),
                profile_id: profile,
                expected_revision: revision,
            },
            phase,
        };
        if recovery.host.is_nil() || recovery.host.to_string() != host || recovery.thread.is_empty()
        {
            return Err(conflict());
        }
        if recovery.phase == "committed" {
            let raw: String = self
                .connection
                .query_row(
                    "SELECT receipt_json FROM chat_model_operations_v2 WHERE operation_id=?1",
                    [op.to_string()],
                    |r| r.get(0),
                )
                .map_err(db_error)?;
            if raw.len() > 4096 {
                return Err(conflict());
            }
            let receipt: wire::ModelOperationReceipt =
                serde_json::from_str(&raw).map_err(|_| conflict())?;
            super::host_bridge::models::validate_operation_receipt(
                &receipt,
                recovery.host,
                &recovery.request,
            )
            .map_err(|_| conflict())?;
            if receipt.state != wire::ModelOperationState::Committed {
                return Err(conflict());
            }
        }
        Ok(Some(recovery))
    }
    pub(crate) fn begin_model_recovery_intent(
        &mut self,
        session: Uuid,
        intent: ModelIntent,
        op: Uuid,
    ) -> Result<ModelRecovery, ChatError> {
        // The authorized application enforces candidate/environment capability;
        // this candidate-only repository writer additionally requires SQL39.
        if !present(&self.connection)? {
            return Err(ChatError::OrchestrationUnavailable);
        }
        if op.is_nil()
            || session.is_nil()
            || !(0..9007199254740991).contains(&intent.expected_revision)
            || !super::models::executable_profile(super::models::profile_id(intent.profile_id))
        {
            return Err(ChatError::InvalidInput);
        }
        if self.model_recovery(session, op)?.is_some() {
            return Err(conflict());
        }
        let tx = self.connection.transaction().map_err(db_error)?;
        idle(&tx, &self.scope, session)?;
        let row:Option<(String,String,String,i64,String)>=tx.query_row("SELECT s.agent_session_id,s.runtime_thread_id,m.profile_id,m.revision,m.state FROM chat_sessions s JOIN chat_model_selections m ON m.session_id=s.id WHERE s.id=?1",[session.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(db_error)?;
        let (host, thread, previous, revision, state) = row.ok_or_else(conflict)?;
        if revision != intent.expected_revision || state != "ready" {
            return Err(conflict());
        }
        if thread.is_empty()
            || !Uuid::parse_str(&host).is_ok_and(|id| !id.is_nil() && id.to_string() == host)
        {
            return Err(conflict());
        }
        tx.execute("INSERT INTO chat_model_operations_v2(operation_id,session_id,format_version,host_session_id,runtime_thread_id,previous_profile_id,target_profile_id,expected_revision,phase) VALUES(?1,?2,2,?3,?4,?5,?6,?7,'prepared')",params![op.to_string(),session.to_string(),host,thread,previous,super::models::profile_id(intent.profile_id),revision]).map_err(db_error)?;
        tx.execute("UPDATE chat_model_selections SET state='switching',operation_id=?2,requested_profile_id=?3,expected_revision=?4 WHERE session_id=?1",params![session.to_string(),op.to_string(),super::models::profile_id(intent.profile_id),revision]).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        self.model_recovery(session, op)?.ok_or_else(conflict)
    }
    pub(crate) fn mark_model_recovery_dispatched(
        &mut self,
        op: ModelRecovery,
    ) -> Result<(), ChatError> {
        let tx = self.connection.transaction().map_err(db_error)?;
        idle(&tx, &self.scope, op.session)?;
        let bound:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_model_operations_v2 o JOIN chat_sessions s ON s.id=o.session_id JOIN chat_model_selections m ON m.session_id=o.session_id WHERE o.operation_id=?1 AND o.session_id=?2 AND s.agent_session_id=o.host_session_id AND s.runtime_thread_id=o.runtime_thread_id AND o.host_session_id=?3 AND o.runtime_thread_id=?4 AND o.previous_profile_id=?5 AND o.target_profile_id=?6 AND o.expected_revision=?7 AND m.profile_id=o.previous_profile_id AND m.revision=o.expected_revision AND m.operation_id=o.operation_id AND m.requested_profile_id=o.target_profile_id AND m.expected_revision=o.expected_revision AND m.state IN ('switching','unknown') AND o.phase!='committed')",params![op.request.operation_id,op.session.to_string(),op.host.to_string(),op.thread,op.previous,super::models::profile_id(op.request.profile_id),op.request.expected_revision],|r|r.get(0)).map_err(db_error)?;
        if !bound {
            return Err(conflict());
        }
        tx.execute(
            "UPDATE chat_model_operations_v2 SET phase='dispatched' WHERE operation_id=?1",
            [op.request.operation_id],
        )
        .map_err(db_error)?;
        tx.commit().map_err(db_error)
    }
    pub(crate) fn model_recovery_unknown(
        &mut self,
        session: Uuid,
        op: Uuid,
    ) -> Result<(), ChatError> {
        self.agent_session_id_for_session_optional_model(session)?;
        let tx = self.connection.transaction().map_err(db_error)?;
        tx.execute("UPDATE chat_model_operations_v2 SET phase=CASE WHEN phase IN ('prepared','committed') THEN phase ELSE 'unknown' END WHERE session_id=?1 AND operation_id=?2",params![session.to_string(),op.to_string()]).map_err(db_error)?;
        tx.execute("UPDATE chat_model_selections SET state='unknown' WHERE session_id=?1 AND operation_id=?2",params![session.to_string(),op.to_string()]).map_err(db_error)?;
        tx.commit().map_err(db_error)
    }
    pub(crate) fn observe_model_recovery(
        &mut self,
        session: Uuid,
        op: Uuid,
        receipt: wire::ModelOperationReceipt,
    ) -> Result<(), ChatError> {
        let intent = self.model_recovery(session, op)?.ok_or_else(conflict)?;
        super::host_bridge::models::validate_operation_receipt(
            &receipt,
            intent.host,
            &intent.request,
        )
        .map_err(|_| conflict())?;
        if receipt.state != wire::ModelOperationState::Committed {
            return Err(conflict());
        }
        let text = serde_json::to_string(&receipt).map_err(|_| conflict())?;
        let changed=self.connection.execute("UPDATE chat_model_operations_v2 SET phase='committed',receipt_json=?3 WHERE session_id=?1 AND operation_id=?2 AND (receipt_json IS NULL OR receipt_json=?3)",params![session.to_string(),op.to_string(),text]).map_err(db_error)?;
        if changed != 1 {
            return Err(conflict());
        }
        Ok(())
    }
    pub(crate) fn sync_model_selection_v2(
        &mut self,
        session: Uuid,
        value: wire::Selection,
    ) -> Result<ModelState, ChatError> {
        let host = self
            .agent_session_id_for_session_optional_model(session)?
            .ok_or_else(conflict)?;
        super::host_bridge::models::validate_selection(value.clone(), host)
            .map_err(|_| conflict())?;
        let local = self.model_state(session)?;
        if value.revision < local.revision {
            return Ok(local);
        }
        if let Some(pending) = &local.pending {
            let op = Uuid::parse_str(&pending.operation_id).map_err(|_| conflict())?;
            let proof = self.model_recovery(session, op)?.ok_or_else(conflict)?;
            if proof.phase != "committed" || value.revision <= proof.request.expected_revision {
                return Err(conflict());
            }
            if value.revision == proof.request.expected_revision + 1
                && (value.profile_id != Some(proof.request.profile_id.into())
                    || (value.state == wire::SelectionState::Ready
                        && value.operation_id.as_deref()
                            != Some(proof.request.operation_id.as_str())))
            {
                return Err(conflict());
            }
        }
        let Some(profile) = value.profile_id else {
            return Err(conflict());
        };
        // An equal-revision observation cannot replace identity or release an
        // unresolved operation. Only the matching immutable receipt can do so.
        if value.revision == local.revision
            && local
                .profile_id
                .as_deref()
                .is_some_and(|p| p != super::models::profile_id(profile))
        {
            return Err(conflict());
        }
        let state = match value.state {
            wire::SelectionState::Ready => "ready",
            wire::SelectionState::Switching => "switching",
            wire::SelectionState::Unknown => "unknown",
        };
        self.connection.execute("INSERT INTO chat_model_selections(session_id,profile_id,revision,state,operation_id) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(session_id) DO UPDATE SET profile_id=excluded.profile_id,revision=excluded.revision,state=excluded.state,operation_id=excluded.operation_id,requested_profile_id=NULL,expected_revision=NULL WHERE excluded.revision>=chat_model_selections.revision",params![session.to_string(),super::models::profile_id(profile),value.revision,state,value.operation_id]).map_err(db_error)?;
        self.model_state(session)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::{
        database::ChatScope,
        keychain::{DatabaseKey, ReceiptKey},
        migrations,
    };
    struct Fixture {
        root: std::path::PathBuf,
        repo: ChatRepository,
        session: Uuid,
        host: Uuid,
        scope: ChatScope,
    }
    fn fixture() -> Fixture {
        let root = std::env::temp_dir().join(format!("feat164-native-model-{}", Uuid::now_v7()));
        std::fs::create_dir(&root).unwrap();
        let scope = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
        let mut repo = ChatRepository::open(
            &root.join("chat"),
            &DatabaseKey::from_bytes([164; 32]),
            ReceiptKey::from_bytes([165; 32]),
            scope.clone(),
        )
        .unwrap();
        migrations::migrate_to_target(&mut repo.connection, 38).unwrap();
        let session = Uuid::now_v7();
        let host = Uuid::now_v7();
        let project = Uuid::now_v7();
        repo.connection.execute("INSERT INTO chat_projects(id,owner_user_id,tenant_id,safe_name,canonical_hash,bookmark_ref,last_used_at) VALUES(?1,?2,?3,'Synthetic model history',?4,X'01',1)",params![project.to_string(),scope.owner_user_id,scope.tenant_id,"a".repeat(64)]).unwrap();
        repo.connection.execute("INSERT INTO chat_sessions(id,owner_user_id,tenant_id,project_id,title,title_source,title_job_status,created_at,last_activity_at,agent_session_id,runtime_thread_id) VALUES(?1,?2,?3,?4,'Synthetic history','user','completed',1,1,?5,'native-thread')",params![session.to_string(),scope.owner_user_id,scope.tenant_id,project.to_string(),host.to_string()]).unwrap();
        repo.connection.execute("INSERT INTO chat_model_selections(session_id,profile_id,revision,state) VALUES(?1,'kimi-k3-max-v1',7,'ready')",[session.to_string()]).unwrap();
        repo.connection.execute("INSERT INTO chat_messages(id,session_id,role,content,status,ordinal,created_at) VALUES('message',?1,'assistant','Original synthetic answer','committed',0,1)",[session.to_string()]).unwrap();
        migrations::migrate_to_target(&mut repo.connection, 39).unwrap();
        Fixture {
            root,
            repo,
            session,
            host,
            scope,
        }
    }
    fn intent() -> ModelIntent {
        ModelIntent {
            profile_id: wire::ProfileId::KimiK31ProMaxV1,
            expected_revision: 7,
        }
    }
    fn receipt(p: &ModelRecovery, state: wire::ModelOperationState) -> wire::ModelOperationReceipt {
        wire::ModelOperationReceipt {
            schema_version: 2,
            agent_session_id: p.host.to_string(),
            operation_id: p.request.operation_id.clone(),
            state,
            request: wire::OperationRequestSnapshot {
                schema_version: 2,
                operation_id: p.request.operation_id.clone(),
                expected_revision: p.request.expected_revision,
                profile_id: p.request.profile_id.into(),
            },
            result: if state == wire::ModelOperationState::Committed {
                Some(wire::SelectionResultSnapshot {
                    schema_version: 2,
                    agent_session_id: p.host.to_string(),
                    operation_id: Some(p.request.operation_id.clone()),
                    profile_id: Some(p.request.profile_id.into()),
                    revision: p.request.expected_revision + 1,
                    state: wire::SelectionState::Ready,
                    availability: Some(wire::SelectionAvailability::Ready),
                })
            } else {
                None
            },
        }
    }
    fn current(p: &ModelRecovery, revision: i64, profile: wire::ProfileId) -> wire::Selection {
        wire::Selection {
            schema_version: 2,
            agent_session_id: p.host.to_string(),
            operation_id: Some(p.request.operation_id.clone()),
            profile_id: Some(profile),
            revision,
            state: wire::SelectionState::Ready,
            availability: wire::SelectionAvailability::Ready,
        }
    }
    fn close(f: Fixture) {
        drop(f.repo);
        std::fs::remove_dir_all(f.root).unwrap();
    }
    #[test]
    fn feat164_native_settled_expert_model_selection_is_not_legacy_dispatch() {
        let mut f = fixture();
        // A normal settled managed binding; no existing request is rewritten.
        f.repo.connection.execute("INSERT INTO chat_expert_bindings(session_id,binding_revision,state,updated_at) VALUES(?1,0,'none',1)",[f.session.to_string()]).unwrap();
        let p = f
            .repo
            .begin_model_recovery_intent(f.session, intent(), Uuid::now_v7())
            .unwrap();
        f.repo.mark_model_recovery_dispatched(p).unwrap();
        let count: i64 = f
            .repo
            .connection
            .query_row(
                "SELECT count(*) FROM chat_expert_bindings WHERE session_id=?1 AND state='none'",
                [f.session.to_string()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        close(f);
    }
    #[test]
    fn feat164_native_market_model_selection_requires_settled_delivery_twice() {
        for state in [
            "accepted",
            "pending",
            "inflight",
            "uncertain",
            "blocked",
            "missing",
            "cancelled",
            "cancelled_unmarked",
        ] {
            let mut f = fixture();
            migrations::migrate_to_target(&mut f.repo.connection, 40).unwrap();
            let turn = Uuid::now_v7().to_string();
            let operation = Uuid::now_v7().to_string();
            let submission = Uuid::now_v7().to_string();
            f.repo.connection.execute("INSERT INTO chat_turns(id,session_id,operation_id,status) VALUES(?1,?2,?3,'completed')",params![turn,f.session.to_string(),operation]).unwrap();
            f.repo.connection.execute("INSERT INTO chat_market_submissions(submission_operation_id,session_id,local_turn_id,turn_operation_id,format_version,request_digest,snapshot_json,display_json,receipt_json,created_at) VALUES(?1,?2,?3,?4,1,?5,'{}','[]','{}',1)",params![submission,f.session.to_string(),turn,operation,"a".repeat(64)]).unwrap();
            if state != "missing" {
                f.repo.connection.execute("INSERT INTO chat_market_dispatch(submission_operation_id,format_version,state,updated_at) VALUES(?1,1,?2,1)",params![submission,if state.starts_with("cancelled") {"blocked"} else {state}]).unwrap();
            }
            if state.starts_with("cancelled") {
                let receipt = super::super::delivery::CancelReceipt {
                    schema_version: 1,
                    operation_id: operation.clone(),
                    session_id: f.session.to_string(),
                    turn_id: turn.clone(),
                    outcome: "cancelled_never_sent".into(),
                    cancelled_at: 1,
                };
                f.repo.connection.execute("INSERT INTO chat_delivery_proofs(operation_id,session_id,turn_id,format_version,family,profile_id,model_revision,fingerprint,phase,created_at,receipt_json) VALUES(?1,?2,?3,1,'market','kimi-k3-max-v1',7,?4,'cancelled',1,?5)",params![operation,f.session.to_string(),turn,"a".repeat(64),serde_json::to_string(&receipt).unwrap()]).unwrap();
                if state == "cancelled" {
                    f.repo.connection.execute("UPDATE chat_market_dispatch SET issue_code='cancelled_never_sent' WHERE submission_operation_id=?1",[&submission]).unwrap();
                }
            }
            let before: String=f.repo.connection.query_row("SELECT snapshot_json || request_digest || receipt_json FROM chat_market_submissions WHERE submission_operation_id=?1",[&submission],|r|r.get(0)).unwrap();
            let result = f
                .repo
                .begin_model_recovery_intent(f.session, intent(), Uuid::now_v7());
            if matches!(state, "accepted" | "cancelled") {
                let proof = result.unwrap();
                f.repo
                    .mark_model_recovery_dispatched(proof.clone())
                    .unwrap();
                // A new normal in-flight delivery is a blocker even after intent.
                f.repo.connection.execute("UPDATE chat_market_dispatch SET state='inflight' WHERE submission_operation_id=?1",[&submission]).unwrap();
                assert!(f.repo.mark_model_recovery_dispatched(proof).is_err());
            } else {
                assert!(result.is_err(), "{state}");
            }
            let after: String=f.repo.connection.query_row("SELECT snapshot_json || request_digest || receipt_json FROM chat_market_submissions WHERE submission_operation_id=?1",[&submission],|r|r.get(0)).unwrap();
            assert_eq!(before, after);
            close(f);
        }
    }
    #[test]
    fn feat164_native_intent_survives_normal_reopen_and_404_never_proves_unsent() {
        let mut f = fixture();
        let op = Uuid::now_v7();
        let p = f
            .repo
            .begin_model_recovery_intent(f.session, intent(), op)
            .unwrap();
        assert_eq!(
            recovery_action(&p, None).unwrap(),
            RecoveryAction::FirstSend
        );
        assert!(f
            .repo
            .begin_model_recovery_intent(f.session, intent(), op)
            .is_err());
        assert_eq!(
            f.repo
                .model_state(f.session)
                .unwrap()
                .pending
                .unwrap()
                .recovery_available,
            Some(true)
        );
        f.repo.mark_model_recovery_dispatched(p).unwrap();
        f.repo.model_recovery_unknown(f.session, op).unwrap();
        drop(f.repo);
        f.repo = ChatRepository::open(
            &f.root.join("chat"),
            &DatabaseKey::from_bytes([164; 32]),
            ReceiptKey::from_bytes([165; 32]),
            f.scope.clone(),
        )
        .unwrap();
        let p = f.repo.model_recovery(f.session, op).unwrap().unwrap();
        assert_eq!(p.phase, "unknown");
        assert!(recovery_action(&p, None).is_err());
        let known = receipt(&p, wire::ModelOperationState::Unknown);
        assert_eq!(
            recovery_action(&p, Some(&known)).unwrap(),
            RecoveryAction::Reapply
        );
        f.repo.mark_model_recovery_dispatched(p.clone()).unwrap();
        let done = receipt(&p, wire::ModelOperationState::Committed);
        f.repo
            .observe_model_recovery(f.session, op, done.clone())
            .unwrap();
        assert_eq!(
            recovery_action(&p, Some(&done)).unwrap(),
            RecoveryAction::ReadCommitted
        );
        // Original receipt does not overwrite a later current selection.
        let latest = f
            .repo
            .sync_model_selection_v2(f.session, current(&p, 9, wire::ProfileId::MinimaxM3HighV1))
            .unwrap();
        assert_eq!(latest.revision, 9);
        assert!(latest.pending.is_none());
        let stale = f
            .repo
            .sync_model_selection_v2(f.session, current(&p, 8, wire::ProfileId::KimiK31ProMaxV1))
            .unwrap();
        assert_eq!(stale.revision, 9);
        let original: String = f
            .repo
            .connection
            .query_row(
                "SELECT receipt_json FROM chat_model_operations_v2 WHERE operation_id=?1",
                [op.to_string()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<wire::ModelOperationReceipt>(&original).unwrap(),
            done
        );
        assert_eq!(
            f.repo
                .connection
                .query_row(
                    "SELECT content FROM chat_messages WHERE id='message'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "Original synthetic answer"
        );
        close(f);
    }
    #[test]
    fn feat164_native_old_pending_is_readable_but_not_a_v2_intent() {
        let mut f = fixture();
        let op = Uuid::now_v7();
        f.repo.connection.execute("UPDATE chat_model_selections SET state='unknown',operation_id=?2,requested_profile_id='minimax-m3-high-v1',expected_revision=7 WHERE session_id=?1",params![f.session.to_string(),op.to_string()]).unwrap();
        assert!(f.repo.model_recovery(f.session, op).unwrap().is_none());
        assert_eq!(
            f.repo
                .model_state(f.session)
                .unwrap()
                .pending
                .unwrap()
                .recovery_available,
            Some(false)
        );
        assert!(f
            .repo
            .begin_model_recovery_intent(f.session, intent(), Uuid::now_v7())
            .is_err());
        let value = wire::Selection {
            schema_version: 2,
            agent_session_id: f.host.to_string(),
            operation_id: Some(op.to_string()),
            profile_id: Some(wire::ProfileId::MinimaxM3HighV1),
            revision: 8,
            state: wire::SelectionState::Ready,
            availability: wire::SelectionAvailability::Ready,
        };
        assert!(f.repo.sync_model_selection_v2(f.session, value).is_err());
        assert_eq!(f.repo.model_state(f.session).unwrap().revision, 7);
        close(f);
    }
    #[test]
    fn feat164_native_recovery_rechecks_binding_work_and_receipt() {
        for case in [
            "outbox",
            "turn",
            "thread",
            "scope",
            "changed_binding",
            "expert",
            "draft",
            "wrong_receipt",
            "unproved_current",
        ] {
            let mut f = fixture();
            let op = Uuid::now_v7();
            let p = f
                .repo
                .begin_model_recovery_intent(f.session, intent(), op)
                .unwrap();
            match case {
                "outbox" => {
                    f.repo.connection.execute("INSERT INTO chat_outbox(operation_id,session_id,kind,state,attempt_count,payload_version,encrypted_payload) VALUES('other',?1,'start_turn','pending',0,1,X'01')",[f.session.to_string()]).unwrap();
                    assert!(f.repo.mark_model_recovery_dispatched(p).is_err());
                }
                "turn" => {
                    f.repo.connection.execute("INSERT INTO chat_turns(id,session_id,operation_id,status) VALUES('other',?1,'other','queued')",[f.session.to_string()]).unwrap();
                    assert!(f.repo.mark_model_recovery_dispatched(p).is_err());
                }
                "thread" => {
                    let mut different = p;
                    different.thread = "another-thread".into();
                    assert!(f.repo.mark_model_recovery_dispatched(different).is_err());
                }
                "scope" => {
                    f.repo.scope =
                        ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string())
                            .unwrap();
                    assert!(f.repo.model_recovery(f.session, op).is_err());
                    assert!(f.repo.mark_model_recovery_dispatched(p).is_err());
                }
                "changed_binding" => {
                    f.repo.connection.execute("UPDATE chat_sessions SET runtime_thread_id='replacement-thread' WHERE id=?1",[f.session.to_string()]).unwrap();
                    assert!(f.repo.model_recovery(f.session, op).is_err());
                    assert!(f.repo.mark_model_recovery_dispatched(p).is_err());
                }
                "expert" => {
                    f.repo.connection.execute("INSERT INTO chat_expert_bindings(session_id,binding_revision,state,updated_at) VALUES(?1,0,'unknown',1)",[f.session.to_string()]).unwrap();
                    assert!(f.repo.mark_model_recovery_dispatched(p).is_err());
                }
                "draft" => {
                    f.repo.connection.execute("INSERT INTO chat_scheduled_draft_sessions VALUES(?1,?2,?3,'ordinary-workspace',1,1,1)",params![f.session.to_string(),f.scope.owner_user_id,f.scope.tenant_id]).unwrap();
                    assert!(f.repo.mark_model_recovery_dispatched(p).is_err());
                }
                "wrong_receipt" => {
                    let mut different = receipt(&p, wire::ModelOperationState::Committed);
                    different.request.profile_id = wire::ProfileId::MinimaxM3HighV1;
                    assert!(f
                        .repo
                        .observe_model_recovery(f.session, op, different)
                        .is_err());
                }
                "unproved_current" => {
                    assert!(f
                        .repo
                        .sync_model_selection_v2(
                            f.session,
                            current(&p, 8, wire::ProfileId::KimiK31ProMaxV1)
                        )
                        .is_err());
                    f.repo
                        .observe_model_recovery(
                            f.session,
                            op,
                            receipt(&p, wire::ModelOperationState::Committed),
                        )
                        .unwrap();
                    assert!(f
                        .repo
                        .sync_model_selection_v2(
                            f.session,
                            current(&p, 8, wire::ProfileId::MinimaxM3HighV1)
                        )
                        .is_err());
                }
                _ => unreachable!(),
            }
            close(f);
        }
    }
}
