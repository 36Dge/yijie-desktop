//! Fixed-purpose source ledger over the original chat, facts and outbox.
use super::{
    execution,
    execution_generated::ExecutionErrorCode as E,
    generated::{PlanView, SavePlanRequest},
    ipc_generated::{self as wire, IpcErrorCode as Error, PrivateErrorCode as P},
    store, workspace,
};
use crate::chat::{
    database::{ChatRepository, ChatScope, ConversationEnqueueContext, DraftContentBlock},
    error::ChatError,
    native_conversation_generated::NativeNotification,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;
fn sql<T>(r: rusqlite::Result<T>) -> Result<T, Error> {
    r.map_err(|_| E::StorageUnavailable.into())
}
fn hash(v: &impl serde::Serialize) -> Result<String, Error> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(v).map_err(|_| E::StorageUnavailable)?)
    ))
}
pub(super) fn chat(e: ChatError) -> Error {
    match e {
        ChatError::ConversationConflict => E::ReservationBusy.into(),
        ChatError::NotFound | ChatError::ProjectUnavailable => E::TargetUnavailable.into(),
        ChatError::InvalidInput => E::InvalidInput.into(),
        _ => E::StorageUnavailable.into(),
    }
}
pub(crate) fn present(db: &Connection) -> Result<bool, ChatError> {
    db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
        .map(|v| v >= 22)
        .map_err(|_| ChatError::DatabaseUnavailable)
}
pub(crate) fn is_draft(
    db: &Connection,
    scope: &ChatScope,
    conversation: &str,
) -> Result<bool, ChatError> {
    if !present(db)? {
        return Ok(false);
    };
    db.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_draft_sessions WHERE conversation_id=?1 AND owner_user_id=?2 AND tenant_id=?3)",params![conversation,scope.owner_user_id,scope.tenant_id],|r|r.get(0)).map_err(|_|ChatError::DatabaseUnavailable)
}
pub(crate) fn guard_conversation(
    db: &Connection,
    scope: &ChatScope,
    conversation: &str,
    draft: bool,
) -> Result<(), ChatError> {
    if is_draft(db, scope, conversation)? != draft {
        return Err(ChatError::ConversationConflict);
    };
    Ok(())
}
impl ChatRepository {
    pub(crate) fn session_purpose(
        &self,
        id: Uuid,
    ) -> Result<crate::chat::session_purpose_generated::SessionPurposeView, ChatError> {
        use crate::chat::session_purpose_generated::{SessionPurpose, SessionPurposeView};
        self.session_summary(id)?;
        let mut purpose = SessionPurpose::Ordinary;
        if present(&self.connection)? {
            let row: Option<(String, String, i64, i64, i64)> = self.connection.query_row(
                "SELECT owner_user_id,tenant_id,format_version,schema_version,policy_version FROM chat_scheduled_draft_sessions WHERE conversation_id=?1",
                [id.to_string()], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)),
            ).optional().map_err(|_| ChatError::DatabaseUnavailable)?;
            if let Some((owner, tenant, format, schema, policy)) = row {
                if owner != self.scope.owner_user_id
                    || tenant != self.scope.tenant_id
                    || (format, schema, policy) != (1, 1, 1)
                {
                    return Err(ChatError::ConversationConflict);
                }
                purpose = SessionPurpose::ScheduledPlanDraft;
            }
        }
        Ok(SessionPurposeView {
            session_id: id,
            purpose,
        })
    }

    pub(super) fn read_draft_submission_receipt(&self, request: &str) -> Result<Value, Error> {
        self.draft_storage(false)?;
        let id: Option<String> = sql(self.connection.query_row(
            "SELECT source_id FROM chat_scheduled_draft_sources WHERE owner_user_id=?1 AND tenant_id=?2 AND request_id=?3",
            params![self.scope.owner_user_id,self.scope.tenant_id,request], |r| r.get(0),
        ).optional())?;
        let Some(id) = id else {
            return Ok(json!({"observation":"not_observed"}));
        };
        let source = source(&self.connection, &self.scope, &id)?;
        if source.deleted {
            let mut result = json!({"observation":"source_deleted","source_id":id});
            if let Some(plan) = source.plan {
                result["plan_id"] = json!(plan);
            }
            return Ok(result);
        }
        Ok(json!({"observation":"observed","receipt":receipt(&self.connection,&self.scope,&id)?}))
    }

    fn draft_storage(&self, write: bool) -> Result<(), Error> {
        if !present(&self.connection).map_err(chat)? {
            return Err(P::DraftUnavailable.into());
        };
        if write && !self.schedule_draft_writes_enabled {
            return Err(P::StorageReadOnly.into());
        };
        Ok(())
    }
    pub(super) fn submit_draft(
        &mut self,
        input: wire::DraftSubmit,
        request: &str,
        n: i64,
        revision: i64,
    ) -> Result<wire::DraftReceipt, Error> {
        self.draft_storage(true)?;
        if input.text.trim().is_empty() || revision < 1 {
            return Err(E::InvalidInput.into());
        }
        let request_uuid = Uuid::parse_str(request).map_err(|_| E::InvalidInput)?;
        let digest = hash(&input)?;
        let old:Option<(String,String)>=sql(self.connection.query_row("SELECT source_id,request_digest FROM chat_scheduled_draft_sources WHERE owner_user_id=?1 AND tenant_id=?2 AND request_id=?3",params![self.scope.owner_user_id,self.scope.tenant_id,request],|r|Ok((r.get(0)?,r.get(1)?))).optional())?;
        if let Some((id, prior)) = old {
            if prior != digest {
                return Err(E::RequestConflict.into());
            };
            return receipt(&self.connection, &self.scope, &id);
        }
        let scope = self.scope.clone();
        let deadline = self.schedule_ui_deadline;
        let resource = workspace::resource_id(&scope, request, Some("scheduled-draft-v1"));
        let directory = if input.conversation_id.is_none() {
            Some(
                workspace::managed_path(
                    self.database_path.parent().ok_or(E::StorageUnavailable)?,
                    &scope,
                    &resource,
                    true,
                )
                .map_err(chat)?,
            )
        } else {
            None
        };
        let tx = sql(self.connection.transaction())?;
        let blocks = [DraftContentBlock::Text(input.text.clone())];
        let context = ConversationEnqueueContext {
            scope: &scope,
            now: n,
            scheduled: None,
            draft: true,
        };
        let (conversation, turn, operation, create) = if let Some(id) = input.conversation_id {
            guard_conversation(&tx, &scope, &id, true).map_err(chat)?;
            let turn = ChatRepository::enqueue_turn_in_transaction(
                &tx,
                context,
                Uuid::parse_str(&id).map_err(|_| E::InvalidInput)?,
                &blocks,
                request_uuid,
            )
            .map_err(chat)?;
            (id, turn.to_string(), request.to_owned(), None)
        } else {
            let directory = directory.ok_or(E::StorageUnavailable)?;
            if crate::chat::database::validate_project_path(&directory).map_err(chat)? != directory
            {
                return Err(E::TargetUnavailable.into());
            }
            let path_hash = format!(
                "{:x}",
                Sha256::digest(directory.as_os_str().as_encoded_bytes())
            );
            sql(tx.execute("INSERT OR IGNORE INTO chat_projects(id,owner_user_id,tenant_id,safe_name,canonical_hash,bookmark_ref,last_used_at,workspace_source,managed_resource_id) VALUES(?1,?2,?3,'计划草案受管目录',?4,NULL,?5,'managed_schedule',?1)",params![resource,scope.owner_user_id,scope.tenant_id,path_hash,n]))?;
            let p = ChatRepository::create_session_and_enqueue_in_transaction(
                &tx,
                context,
                Uuid::parse_str(&resource).map_err(|_| E::InvalidInput)?,
                &blocks,
                request_uuid,
                revision as u64,
            )
            .map_err(chat)?;
            sql(tx.execute(
                "INSERT INTO chat_scheduled_draft_sessions VALUES(?1,?2,?3,?4,1,1,1)",
                params![
                    p.session_id.to_string(),
                    scope.owner_user_id,
                    scope.tenant_id,
                    resource
                ],
            ))?;
            (
                p.session_id.to_string(),
                p.turn_id.to_string(),
                p.turn_operation_id.to_string(),
                Some(request.to_owned()),
            )
        };
        let source = Uuid::now_v7().to_string();
        sql(tx.execute("INSERT INTO chat_scheduled_draft_sources(source_id,owner_user_id,tenant_id,request_id,request_digest,conversation_id,local_turn_id,operation_id,create_operation_id,format_version) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,1)",params![source,scope.owner_user_id,scope.tenant_id,request,digest,conversation,turn,operation,create]))?;
        super::ipc::commit_deadline(deadline)?;
        let reply = receipt(&tx, &scope, &source)?;
        sql(tx.commit())?;
        Ok(reply)
    }
    pub(super) fn preview_draft(&self, id: &str, n: i64) -> Result<Value, Error> {
        self.draft_storage(false)?;
        preview(&self.connection, &self.scope, id, n)
    }
    pub(super) fn confirm_draft(
        &mut self,
        input: wire::DraftConfirmation,
        request: &str,
        n: i64,
    ) -> Result<PlanView, Error> {
        self.confirm_draft_with_activation(input, request, n, None)
    }
    pub(super) fn confirm_draft_with_activation(
        &mut self,
        input: wire::DraftConfirmation,
        request: &str,
        n: i64,
        authority: Option<&super::ScheduleAuthority>,
    ) -> Result<PlanView, Error> {
        self.draft_storage(true)?;
        self.schedule_writable().map_err(execution::plan_error)?;
        let definition =
            store::normalized_definition(input.definition).map_err(execution::plan_error)?;
        let digest = hash(&(&input.source_id, &input.source_digest, &definition))?;
        let scope = self.scope.clone();
        let deadline = self.schedule_ui_deadline;
        let tx = sql(self.connection.transaction())?;
        let prior:Option<(String,String)>=sql(tx.query_row("SELECT source_id,confirmation_digest FROM chat_scheduled_draft_confirm_requests WHERE owner_user_id=?1 AND tenant_id=?2 AND request_id=?3",params![scope.owner_user_id,scope.tenant_id,request],|r|Ok((r.get(0)?,r.get(1)?))).optional())?;
        if prior.is_some_and(|(id, d)| id != input.source_id || d != digest) {
            return Err(E::RequestConflict.into());
        }
        let source = source(&tx, &scope, &input.source_id)?;
        let plan = if let Some(pid) = source.plan {
            if source.digest.as_deref() != Some(&input.source_digest)
                || source.confirmation.as_deref() != Some(&digest)
            {
                return Err(E::RequestConflict.into());
            }
            store::read_plan(&tx, &scope, &pid).map_err(execution::plan_error)?
        } else {
            if source.deleted {
                return Err(P::DraftSourceDeleted.into());
            }
            let p = preview(&tx, &scope, &input.source_id, n)?;
            if p["status"] != "candidate" {
                return Err(P::DraftNotCandidate.into());
            }
            if p["source_digest"].as_str() != Some(&input.source_digest) {
                return Err(P::DraftSourceInvalid.into());
            }
            let mut p = store::save_in_transaction(
                &tx,
                &scope,
                SavePlanRequest {
                    request_id: input.source_id.clone(),
                    plan_id: None,
                    expected_revision: None,
                    definition,
                },
                n,
            )
            .map_err(execution::plan_error)?;
            if let Some(authority) = authority {
                super::triggers::activate_default(&tx, &scope, authority, &mut p, n)?;
            }
            sql(tx.execute("UPDATE chat_scheduled_draft_sources SET source_digest=?1,confirmation_digest=?2,plan_id=?3 WHERE source_id=?4 AND plan_id IS NULL",params![input.source_digest,digest,p.plan_id,input.source_id]))?;
            p
        };
        sql(tx.execute(
            "INSERT OR IGNORE INTO chat_scheduled_draft_confirm_requests VALUES(?1,?2,?3,?4,?5)",
            params![
                scope.owner_user_id,
                scope.tenant_id,
                request,
                input.source_id,
                digest
            ],
        ))?;
        super::ipc::commit_deadline(deadline)?;
        sql(tx.commit())?;
        Ok(plan)
    }
}
struct Source {
    conversation: Option<String>,
    turn: Option<String>,
    operation: String,
    deleted: bool,
    plan: Option<String>,
    digest: Option<String>,
    confirmation: Option<String>,
}
fn source(db: &Connection, scope: &ChatScope, id: &str) -> Result<Source, Error> {
    let value:Option<(Source,i64)>=sql(db.query_row("SELECT conversation_id,local_turn_id,operation_id,source_deleted,plan_id,source_digest,confirmation_digest,format_version FROM chat_scheduled_draft_sources WHERE source_id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![id,scope.owner_user_id,scope.tenant_id],|r|Ok((Source{conversation:r.get(0)?,turn:r.get(1)?,operation:r.get(2)?,deleted:r.get(3)?,plan:r.get(4)?,digest:r.get(5)?,confirmation:r.get(6)?},r.get(7)?))).optional())?;
    let (s, v) = value.ok_or(E::NotFound)?;
    if v != 1 {
        return Err(E::FormatUnsupported.into());
    };
    Ok(s)
}
pub(super) fn receipt(
    db: &Connection,
    scope: &ChatScope,
    id: &str,
) -> Result<wire::DraftReceipt, Error> {
    let s = source(db, scope, id)?;
    if s.deleted {
        return Err(P::DraftSourceDeleted.into());
    };
    Ok(wire::DraftReceipt {
        source_id: id.into(),
        conversation_id: s.conversation.ok_or(P::DraftSourceInvalid)?,
        local_turn_id: s.turn.ok_or(P::DraftSourceInvalid)?,
        operation_id: s.operation,
        status: "accepted".into(),
    })
}
fn preview(db: &Connection, scope: &ChatScope, id: &str, n: i64) -> Result<Value, Error> {
    let s = source(db, scope, id)?;
    if let Some(p) = s.plan {
        return Ok(json!({"source_id":id,"status":"confirmed","plan_id":p}));
    };
    if s.deleted {
        return Err(P::DraftSourceDeleted.into());
    }
    let unavailable = || json!({"source_id":id,"status":"unavailable"});
    let (Some(conversation), Some(turn)) = (s.conversation, s.turn) else {
        return Ok(unavailable());
    };
    let binding:Option<(String,String)>=sql(db.query_row("SELECT b.runtime_thread_id,b.runtime_turn_id FROM chat_native_bindings b JOIN chat_sessions s ON s.id=b.session_id JOIN chat_turns t ON t.id=b.turn_id AND t.session_id=s.id JOIN chat_scheduled_draft_sessions d ON d.conversation_id=s.id WHERE b.session_id=?1 AND b.turn_id=?2 AND t.operation_id=?3 AND s.owner_user_id=?4 AND s.tenant_id=?5 AND d.owner_user_id=s.owner_user_id AND d.tenant_id=s.tenant_id AND d.format_version=1 AND d.schema_version=1 AND d.policy_version=1 AND s.runtime_thread_id=b.runtime_thread_id AND t.runtime_turn_id=b.runtime_turn_id AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs x WHERE x.session_id=s.id)",params![conversation,turn,s.operation,scope.owner_user_id,scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?))).optional())?;
    let Some((thread, native_turn)) = binding else {
        return Ok(unavailable());
    };
    // Read complete native assistant/terminal facts, independently of display truncation.
    // Providers may omit phase: a unique complete schema-valid response can still
    // be a draft, but its original phase is never promoted to final_answer.
    let mut q=sql(db.prepare("SELECT fact_json,format_version FROM chat_native_facts WHERE turn_id=?1 AND (method='turn/completed' OR (method='item/completed' AND json_extract(fact_json,'$.item.type')='agentMessage')) ORDER BY event_id LIMIT 65"))?;
    let facts = sql(sql(q.query_map([&turn], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    }))?
    .collect::<rusqlite::Result<Vec<_>>>())?;
    if facts.len() > 64 {
        return Ok(unavailable());
    }
    let unknown: bool = sql(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM chat_native_facts WHERE turn_id=?1 AND format_version!=2)",
        [&turn],
        |r| r.get(0),
    ))?;
    if unknown {
        return Ok(unavailable());
    }
    let mut completed = false;
    let mut final_item = None;
    for (raw, format) in facts {
        if format != 2 {
            return Ok(unavailable());
        }
        let fact: NativeNotification =
            serde_json::from_str(&raw).map_err(|_| P::DraftSourceInvalid)?;
        if fact.source != "runtime_notification"
            || fact.thread_id != thread
            || fact.turn_id.as_deref() != Some(&native_turn)
        {
            return Ok(unavailable());
        }
        match fact.method.as_str() {
            "turn/completed" => {
                let Some(t) = fact.turn else {
                    return Ok(unavailable());
                };
                if t.id != native_turn
                    || t.status.as_deref() != Some("completed")
                    || t.error.is_some()
                    || t.error_code.is_some()
                {
                    return Ok(unavailable());
                };
                completed = true
            }
            "item/completed" => {
                let Some(item) = fact.item else {
                    return Ok(unavailable());
                };
                if fact.availability != "available"
                    || item.kind != "agentMessage"
                    || item.availability != "available"
                    || fact.item_id.as_deref() != Some(&item.id)
                    || item.text.is_none()
                {
                    return Ok(unavailable());
                };
                match item.phase.as_deref() {
                    Some("commentary") => continue,
                    Some("final_answer") | None => {}
                    Some(_) => return Ok(unavailable()),
                }
                if final_item.as_ref().is_some_and(|p| p != &item) {
                    return Ok(unavailable());
                };
                final_item = Some(item)
            }
            _ => return Ok(unavailable()),
        }
    }
    if !completed {
        return Ok(unavailable());
    };
    let Some(item) = final_item else {
        return Ok(unavailable());
    };
    let text = item.text.as_deref().ok_or(P::DraftSourceInvalid)?;
    if text.len() > 65536 {
        return Ok(unavailable());
    }
    let output: Value = serde_json::from_str(text).map_err(|_| P::DraftSourceInvalid)?;
    if !super::ipc::validation::valid("draft_Output", &output) {
        return Err(P::DraftSourceInvalid.into());
    }
    if output["kind"] == "candidate" {
        let rule = serde_json::from_value(output["schedule"].clone())
            .map_err(|_| P::DraftSourceInvalid)?;
        super::time::preview(&rule, n, n).map_err(execution::plan_error)?;
        if output["name"].as_str().is_none_or(|s| s.trim().is_empty())
            || output["content"]
                .as_str()
                .is_none_or(|s| s.trim().is_empty())
        {
            return Err(P::DraftSourceInvalid.into());
        }
    }
    let digest = hash(&(id, &s.operation, &thread, &native_turn, &item))?;
    Ok(json!({"source_id":id,"status":output["kind"],"source_digest":digest,"output":output}))
}

pub(crate) fn ordinary_outbox_predicate(db: &Connection, alias: &str) -> Result<String, ChatError> {
    Ok(if present(db)? {
        format!("({alias}.kind='interrupt_turn' OR NOT EXISTS(SELECT 1 FROM chat_scheduled_draft_sessions d WHERE d.conversation_id={alias}.session_id))")
    } else {
        "1=1".into()
    })
}
pub(crate) fn eligible_operation(
    db: &Connection,
    scope: &ChatScope,
    authority: Option<&super::ScheduleAuthority>,
    n: i64,
    native: &super::draft_runtime::NativeState,
) -> Result<Option<Uuid>, ChatError> {
    if !present(db)? || super::execution_guard::held(db)? {
        return Ok(None);
    };
    let Some(a) = authority else { return Ok(None) };
    a.require(
        scope,
        super::execution_generated::ScheduleCapability::ScheduleRun,
        n,
    )
    .map_err(|_| ChatError::ScopeDenied)?;
    let mut query=db.prepare("SELECT o.operation_id FROM chat_outbox o JOIN chat_scheduled_draft_sources x ON x.operation_id=o.operation_id OR x.create_operation_id=o.operation_id JOIN chat_scheduled_draft_sessions d ON d.conversation_id=o.session_id JOIN chat_sessions s ON s.id=o.session_id JOIN chat_turns t ON t.id=x.local_turn_id AND t.session_id=s.id WHERE x.owner_user_id=?1 AND x.tenant_id=?2 AND s.owner_user_id=x.owner_user_id AND s.tenant_id=x.tenant_id AND d.owner_user_id=x.owner_user_id AND d.tenant_id=x.tenant_id AND x.format_version=1 AND d.format_version=1 AND d.schema_version=1 AND d.policy_version=1 AND x.source_deleted=0 AND o.payload_version=2 AND o.state IN ('pending','inflight') AND t.status='queued' AND t.runtime_turn_id IS NULL AND COALESCE(t.submission_status,'queued')='queued' AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs j WHERE j.session_id=s.id) AND ((o.kind='create_session' AND x.create_attempted=0 AND s.agent_session_id IS NULL) OR (o.kind='start_turn' AND x.turn_attempted=0 AND s.agent_session_id IS NOT NULL)) AND o.operation_id=?3 LIMIT 1").map_err(|_|ChatError::DatabaseUnavailable)?;
    let mut actions: Vec<_> = native.actions.keys().collect();
    actions.sort();
    for operation in actions.into_iter().take(256) {
        if !native.allows(scope, a, n, operation) {
            continue;
        }
        let id: Option<String> = query
            .query_row(
                params![scope.owner_user_id, scope.tenant_id, operation],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if let Some(id) = id {
            return Uuid::parse_str(&id)
                .map(Some)
                .map_err(|_| ChatError::DatabaseUnavailable);
        }
    }
    Ok(None)
}
#[derive(Clone)]
pub(crate) struct DraftDispatch {
    pub workspace: String,
}
impl ChatRepository {
    pub(crate) fn draft_dispatch_context(
        &self,
        operation: Uuid,
    ) -> Result<Option<DraftDispatch>, ChatError> {
        if !present(&self.connection)? {
            return Ok(None);
        }
        self.connection.query_row("SELECT d.workspace_id FROM chat_scheduled_draft_sources x JOIN chat_scheduled_draft_sessions d ON d.conversation_id=x.conversation_id WHERE (x.operation_id=?1 OR x.create_operation_id=?1) AND x.owner_user_id=?2 AND x.tenant_id=?3 AND x.format_version=1 AND x.source_deleted=0 AND d.format_version=1 AND d.schema_version=1 AND d.policy_version=1",params![operation.to_string(),self.scope.owner_user_id,self.scope.tenant_id],|r|Ok(DraftDispatch{workspace:r.get(0)?})).optional().map_err(|_|ChatError::DatabaseUnavailable)
    }
    pub(crate) fn guard_draft_dispatch(&self, operation: Uuid) -> Result<bool, ChatError> {
        if self.draft_dispatch_context(operation)?.is_none() {
            if present(&self.connection)? {
                let blocked:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_outbox o JOIN chat_scheduled_draft_sessions d ON d.conversation_id=o.session_id WHERE o.operation_id=?1 AND o.kind!='interrupt_turn')",[operation.to_string()],|r|r.get(0)).map_err(|_|ChatError::DatabaseUnavailable)?;
                if blocked {
                    return Err(ChatError::ConversationConflict);
                }
            }
            return Ok(false);
        }
        let n = execution::now().map_err(|_| ChatError::DatabaseUnavailable)?;
        let a = self
            .schedule_draft_dispatch_authority
            .as_ref()
            .ok_or(ChatError::ScopeDenied)?
            .schedule_authority(n)
            .map_err(|_| ChatError::ScopeDenied)?;
        if eligible_operation(
            &self.connection,
            &self.scope,
            Some(&a),
            n,
            &self.draft_runtime,
        )? != Some(operation)
        {
            return Err(ChatError::ConversationConflict);
        }
        let claimed:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_outbox WHERE operation_id=?1 AND state='inflight')",[operation.to_string()],|r|r.get(0)).map_err(|_|ChatError::DatabaseUnavailable)?;
        if !claimed {
            return Err(ChatError::ConversationConflict);
        };
        Ok(true)
    }
    pub(crate) fn mark_draft_attempt(&mut self, operation: Uuid) -> Result<(), ChatError> {
        if !self.guard_draft_dispatch(operation)? {
            return Err(ChatError::ConversationConflict);
        }
        let changed=self.connection.execute("UPDATE chat_scheduled_draft_sources SET create_attempted=CASE WHEN create_operation_id=?1 THEN 1 ELSE create_attempted END,turn_attempted=CASE WHEN operation_id=?1 THEN 1 ELSE turn_attempted END WHERE (operation_id=?1 OR create_operation_id=?1) AND owner_user_id=?2 AND tenant_id=?3",params![operation.to_string(),self.scope.owner_user_id,self.scope.tenant_id]).map_err(|_|ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::ConversationConflict);
        };
        Ok(())
    }
}

pub(crate) fn valid_wire(name: &str, value: &Value) -> bool {
    super::ipc::validation::valid_draft(name, value)
}
impl ChatRepository {
    pub(crate) fn draft_conversation(&self, conversation: Uuid) -> Result<bool, ChatError> {
        is_draft(&self.connection, &self.scope, &conversation.to_string())
    }
}
