//! Read-only Host recovery over existing draft source/outbox identities.
use super::{draft_generated as wire, drafts, ipc_generated as ipc};
use crate::chat::{
    database::ChatRepository, error::ChatError, host_bridge::HostBridge, lifecycle::Lifecycle,
    worker::DatabaseWorker,
};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

fn db(_: rusqlite::Error) -> ChatError {
    ChatError::DatabaseUnavailable
}
fn identity(row: &rusqlite::Row<'_>, i: usize) -> rusqlite::Result<Uuid> {
    let raw: String = row.get(i)?;
    Uuid::parse_str(&raw)
        .ok()
        .filter(|id| !id.is_nil() && id.to_string() == raw)
        .ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                i,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "invalid stored identity",
                )),
            )
        })
}
fn optional_identity(row: &rusqlite::Row<'_>, i: usize) -> rusqlite::Result<Option<Uuid>> {
    if row.get::<_, Option<String>>(i)?.is_none() {
        Ok(None)
    } else {
        identity(row, i).map(Some)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Context {
    pub source: String,
    pub conversation: Uuid,
    pub local_turn: Uuid,
    pub operation: Uuid,
    pub create: Option<Uuid>,
    pub create_attempted: bool,
    pub turn_attempted: bool,
    pub workspace: String,
    pub task: Option<Uuid>,
    pub session: Option<Uuid>,
    pub thread: Option<Uuid>,
}
impl ChatRepository {
    pub(crate) fn draft_source_context(&self, source: &str) -> Result<Context, ChatError> {
        if !drafts::present(&self.connection)? {
            return Err(ChatError::NotFound);
        }
        self.connection.query_row("SELECT x.source_id,x.conversation_id,x.local_turn_id,x.operation_id,x.create_operation_id,x.create_attempted,x.turn_attempted,d.workspace_id,b.public_task_id,s.agent_session_id,s.runtime_thread_id
        FROM chat_scheduled_draft_sources x JOIN chat_scheduled_draft_sessions d ON d.conversation_id=x.conversation_id JOIN chat_sessions s ON s.id=x.conversation_id JOIN chat_turns t ON t.id=x.local_turn_id AND t.session_id=s.id AND t.operation_id=x.operation_id LEFT JOIN chat_public_task_bindings b ON b.session_id=s.id AND b.state='bound'
        WHERE x.source_id=?1 AND x.owner_user_id=?2 AND x.tenant_id=?3 AND s.owner_user_id=x.owner_user_id AND s.tenant_id=x.tenant_id AND d.owner_user_id=x.owner_user_id AND d.tenant_id=x.tenant_id AND x.source_deleted=0 AND x.format_version=1 AND d.format_version=1 AND d.schema_version=1 AND d.policy_version=1 AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs j WHERE j.session_id=s.id)",params![source,self.scope.owner_user_id,self.scope.tenant_id],|r|Ok(Context{source:r.get(0)?,conversation:identity(r,1)?,local_turn:identity(r,2)?,operation:identity(r,3)?,create:optional_identity(r,4)?,create_attempted:r.get(5)?,turn_attempted:r.get(6)?,workspace:r.get(7)?,task:optional_identity(r,8)?,session:optional_identity(r,9)?,thread:optional_identity(r,10)?})).optional().map_err(db)?.ok_or(ChatError::NotFound)
    }
    pub(crate) fn draft_context_for_operation(
        &self,
        operation: Uuid,
    ) -> Result<Option<Context>, ChatError> {
        if !drafts::present(&self.connection)? {
            return Ok(None);
        }
        let id:Option<String>=self.connection.query_row("SELECT source_id FROM chat_scheduled_draft_sources WHERE (operation_id=?1 OR create_operation_id=?1) AND owner_user_id=?2 AND tenant_id=?3 AND source_deleted=0",params![operation.to_string(),self.scope.owner_user_id,self.scope.tenant_id],|r|r.get(0)).optional().map_err(db)?;
        id.map(|id| self.draft_source_context(&id)).transpose()
    }
    pub(crate) fn next_draft_recovery(&mut self) -> Result<Option<Context>, ChatError> {
        if !self.schedule_draft_writes_enabled || self.draft_runtime.lifecycle.is_none() {
            return Ok(None);
        }
        let id:Option<String>=self.connection.query_row("SELECT source_id FROM chat_scheduled_draft_sources WHERE owner_user_id=?1 AND tenant_id=?2 AND source_deleted=0 AND format_version=1 AND (create_attempted=1 OR turn_attempted=1) AND EXISTS(SELECT 1 FROM chat_turns t WHERE t.id=chat_scheduled_draft_sources.local_turn_id AND (t.status IN ('queued','streaming','stopping') OR (t.status='failed' AND t.runtime_turn_id IS NULL))) AND source_id>?3 ORDER BY source_id LIMIT 1",params![self.scope.owner_user_id,self.scope.tenant_id,self.draft_runtime.cursor.as_deref().unwrap_or("")],|r|r.get(0)).optional().map_err(db)?;
        self.draft_runtime.cursor = id.clone();
        id.map(|id| self.draft_source_context(&id)).transpose()
    }
    pub(crate) fn apply_draft_mapping(
        &mut self,
        expected: &Context,
        m: &wire::RecoveryMapping,
        nonce: &str,
        epoch: u64,
    ) -> Result<Context, ChatError> {
        if !self.schedule_draft_writes_enabled {
            return Err(ChatError::OrchestrationUnavailable);
        }
        self.schedule_draft_dispatch_authority
            .as_ref()
            .ok_or(ChatError::ScopeDenied)?
            .schedule_authority(super::dispatch::timestamp()?)
            .map_err(|_| ChatError::ScopeDenied)?
            .require(
                &self.scope,
                super::execution_generated::ScheduleCapability::ScheduleRead,
                super::dispatch::timestamp()?,
            )
            .map_err(|_| ChatError::ScopeDenied)?;
        let current = self.draft_source_context(&expected.source)?;
        if current != *expected
            || m.task_id
                != current
                    .task
                    .ok_or(ChatError::ConversationConflict)?
                    .to_string()
            || m.workspace_id != current.workspace
            || m.responding_host_instance_id.as_deref() != Some(nonce)
            || m.schema_version != 1
            || m.policy_version != 1
            || m.purpose != "scheduled_plan_draft"
        {
            return Err(ChatError::ConversationConflict);
        }
        self.draft_host_observed(nonce.to_owned(), epoch)?;
        if m.mapping_state != wire::RecoveryMappingMappingState::Bound {
            return Ok(current);
        }
        let session =
            Uuid::parse_str(&m.agent_session_id).map_err(|_| ChatError::ConversationConflict)?;
        let thread = Uuid::parse_str(
            m.codex_thread_id
                .as_deref()
                .ok_or(ChatError::ConversationConflict)?,
        )
        .map_err(|_| ChatError::ConversationConflict)?;
        if session.is_nil() || thread.is_nil() {
            return Err(ChatError::ConversationConflict);
        }
        if current.session.is_some_and(|id| id != session)
            || current.thread.is_some_and(|id| id != thread)
        {
            return Err(ChatError::ConversationConflict);
        }
        if current.session.is_none() || current.thread.is_none() {
            if !current.create_attempted {
                return Err(ChatError::ConversationConflict);
            }
            let tx = self.connection.transaction().map_err(db)?;
            ChatRepository::bind_host_session_parts(
                &tx,
                &self.scope,
                [
                    current.create.ok_or(ChatError::ConversationConflict)?,
                    current.task.ok_or(ChatError::ConversationConflict)?,
                    session,
                    thread,
                ],
                super::dispatch::timestamp()?,
                true,
                false,
            )?;
            tx.commit().map_err(db)?;
        }
        self.draft_runtime
            .verified_sources
            .insert(current.source.clone(), (nonce.into(), epoch));
        self.draft_source_context(&current.source)
    }
    pub(crate) fn apply_draft_operation(
        &mut self,
        c: &Context,
        o: &super::recovery_generated::TurnOperationResult,
        nonce: &str,
        epoch: u64,
    ) -> Result<(), ChatError> {
        if self.draft_runtime.verified_sources.get(&c.source) != Some(&(nonce.into(), epoch))
            || self.draft_source_context(&c.source)? != *c
            || !c.turn_attempted
            || o.agent_session_id
                != c.session
                    .ok_or(ChatError::ConversationConflict)?
                    .to_string()
            || o.operation_id != c.operation.to_string()
            || o.responding_host_instance_id.as_deref() != Some(nonce)
        {
            return Err(ChatError::ConversationConflict);
        }
        self.draft_host_observed(nonce.into(), epoch)?;
        if o.state != super::recovery_generated::OperationState::Accepted {
            return Ok(());
        }
        let turn = Uuid::parse_str(
            o.turn_id
                .as_deref()
                .ok_or(ChatError::ConversationConflict)?,
        )
        .map_err(|_| ChatError::ConversationConflict)?;
        if turn.is_nil() {
            return Err(ChatError::ConversationConflict);
        }
        let binding:Option<(String,String)>=self.connection.query_row("SELECT runtime_thread_id,runtime_turn_id FROM chat_native_bindings WHERE session_id=?1 AND turn_id=?2",params![c.conversation.to_string(),c.local_turn.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db)?;
        if let Some((thread, prior)) = binding {
            if Some(thread) != c.thread.map(|id| id.to_string()) || prior != turn.to_string() {
                return Err(ChatError::ConversationConflict);
            }
        } else {
            self.bind_started_turn_recovered(c.operation, turn, None, true)?;
        }
        self.draft_runtime
            .observations
            .insert((c.conversation, c.local_turn), (nonce.into(), epoch));
        Ok(())
    }
    pub(crate) fn recovered_draft_observation(
        &self,
        conversation: Uuid,
        turn: Uuid,
        nonce: &str,
        epoch: u64,
    ) -> Result<bool, ChatError> {
        if self.draft_runtime.observations.get(&(conversation, turn))
            != Some(&(nonce.into(), epoch))
            || self
                .draft_runtime
                .lifecycle
                .as_ref()
                .is_none_or(|l| l.epoch() != epoch)
        {
            return Ok(false);
        }
        self.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_draft_sources x JOIN chat_native_bindings b ON b.turn_id=x.local_turn_id AND b.session_id=x.conversation_id JOIN chat_sessions s ON s.id=x.conversation_id JOIN chat_turns t ON t.id=x.local_turn_id AND t.operation_id=x.operation_id WHERE x.conversation_id=?1 AND x.local_turn_id=?2 AND x.owner_user_id=?3 AND x.tenant_id=?4 AND x.source_deleted=0 AND x.format_version=1 AND x.turn_attempted=1 AND s.runtime_thread_id=b.runtime_thread_id AND t.runtime_turn_id=b.runtime_turn_id)",params![conversation.to_string(),turn.to_string(),self.scope.owner_user_id,self.scope.tenant_id],|r|r.get(0)).map_err(db)
    }
    pub(crate) fn continue_draft_source(
        &mut self,
        source: &str,
    ) -> Result<ipc::DraftReceipt, ChatError> {
        let c = self.draft_source_context(source)?;
        if c.turn_attempted {
            let known:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_native_bindings WHERE session_id=?1 AND turn_id=?2)",params![c.conversation.to_string(),c.local_turn.to_string()],|r|r.get(0)).map_err(db)?;
            return if known {
                drafts::receipt(&self.connection, &self.scope, source)
                    .map_err(|_| ChatError::ConversationConflict)
            } else {
                Err(ChatError::ConversationConflict)
            };
        }
        let host = self
            .draft_runtime
            .host
            .as_ref()
            .ok_or(ChatError::OrchestrationUnavailable)?;
        if self.draft_runtime.verified_sources.get(source) != Some(host) {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let tx = self.connection.transaction().map_err(db)?;
        // Explicit action may re-queue only a durably never-attempted local
        // failure. It never changes native history or an uncertain operation.
        tx.execute("UPDATE chat_outbox SET state='pending',next_attempt_at=NULL WHERE operation_id=?1 AND state='failed'",[c.operation.to_string()]).map_err(db)?;
        tx.execute("UPDATE chat_turns SET status='queued',submission_status='queued' WHERE id=?1 AND status='failed' AND runtime_turn_id IS NULL",[c.local_turn.to_string()]).map_err(db)?;
        if let Some(create) = c.create {
            ChatRepository::bind_host_session_parts(
                &tx,
                &self.scope,
                [
                    create,
                    c.task.ok_or(ChatError::ConversationConflict)?,
                    c.session.ok_or(ChatError::ConversationConflict)?,
                    c.thread.ok_or(ChatError::ConversationConflict)?,
                ],
                super::dispatch::timestamp()?,
                true,
                true,
            )?;
        }
        super::ipc::commit_deadline(self.schedule_ui_deadline)
            .map_err(|_| ChatError::ScopeDenied)?;
        tx.commit().map_err(db)?;
        drafts::receipt(&self.connection, &self.scope, source)
            .map_err(|_| ChatError::ConversationConflict)
    }
}

pub(crate) async fn recover_source(
    database: &DatabaseWorker,
    host: &HostBridge,
    lifecycle: &Lifecycle,
    c: Context,
) -> Result<(), ChatError> {
    let epoch = lifecycle.epoch();
    let nonce = host.instance_nonce().to_owned();
    let id = c.source.clone();
    let conversation = c.conversation;
    let turn = c.local_turn;
    database
        .call(move |r| {
            r.draft_runtime.verified_sources.remove(&id);
            r.draft_runtime.observations.remove(&(conversation, turn));
            Ok(())
        })
        .await?;
    let Some(task) = c.task else {
        return Err(ChatError::OrchestrationUnavailable);
    };
    let mapping = host
        .draft_mapping(task)
        .await
        .map_err(|_| ChatError::OrchestrationUnavailable)?;
    if lifecycle.epoch() != epoch {
        return Err(ChatError::OrchestrationUnavailable);
    }
    let Some(mapping) = mapping else {
        return Err(ChatError::OrchestrationUnavailable);
    };
    let peer = nonce.clone();
    let current = database
        .call(move |r| r.apply_draft_mapping(&c, &mapping, &peer, epoch))
        .await?;
    if current.turn_attempted {
        if let Some(session) = current.session {
            if let Some(operation) = host
                .schedule_turn_operation(session, current.operation)
                .await
                .map_err(|_| ChatError::OrchestrationUnavailable)?
            {
                if lifecycle.epoch() != epoch {
                    return Err(ChatError::OrchestrationUnavailable);
                }
                database
                    .call(move |r| r.apply_draft_operation(&current, &operation, &nonce, epoch))
                    .await?;
            }
        }
    }
    Ok(())
}
