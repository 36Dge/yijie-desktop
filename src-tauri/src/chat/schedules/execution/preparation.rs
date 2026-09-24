//! 3B-1: local manual preparation, never an execution/accepted receipt.
use super::*;
use crate::chat::schedules::workspace as directories;
use crate::chat::{
    database::{ConversationEnqueueContext, DraftContentBlock, ScheduledEnqueue},
    error::ChatError,
};
use std::path::PathBuf;

struct Target {
    project: String,
    conversation: Option<String>,
    directory: PathBuf,
    managed_resource: Option<String>,
}
fn chat_error(e: ChatError) -> Error {
    match e {
        ChatError::InvalidInput => Error::InvalidInput,
        ChatError::ProjectUnavailable | ChatError::NotFound => Error::TargetUnavailable,
        ChatError::ConversationConflict => Error::ReservationBusy,
        _ => Error::StorageUnavailable,
    }
}
fn existing_run(
    db: &Connection,
    scope: &ChatScope,
    grant: &str,
    revision: i64,
    request: &str,
    trigger: &Trigger,
) -> Result<Option<RunView>, Error> {
    id(grant)?;
    id(request)?;
    if revision < 1 {
        return Err(Error::InvalidInput);
    }
    let expected = trigger.hash(grant, revision, request)?;
    let old:Option<(String,String)>=db.query_row("SELECT run_id,request_digest FROM chat_scheduled_runs WHERE owner_user_id=?1 AND tenant_id=?2 AND request_id=?3",params![scope.owner_user_id,scope.tenant_id,request],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|_|Error::StorageUnavailable)?;
    let Some((run, hash)) = old else {
        return Ok(None);
    };
    if hash != expected {
        return Err(Error::RequestConflict);
    }
    let bound: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM chat_scheduled_run_bindings WHERE run_id=?1)",
            [&run],
            |r| r.get(0),
        )
        .map_err(|_| Error::StorageUnavailable)?;
    if !bound {
        return Err(Error::ExecutionNotReady);
    } // Never fill an old partial foundation reservation.
    read_run(db, scope, &run).map(Some)
}
// A local placeholder whose first create was provably never attempted is not
// an established dedicated Runtime chat. A newly confirmed run gets a new
// create operation; old cancelled history/outbox remains immutable and blocked.
fn dedicated_target(
    db: &rusqlite::Connection,
    scope: &crate::chat::database::ChatScope,
    plan: &str,
) -> Result<Option<Option<String>>, Error> {
    let binding: Option<Option<String>> = db.query_row("SELECT conversation_id FROM chat_scheduled_target_bindings WHERE plan_id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![plan,scope.owner_user_id,scope.tenant_id],|r|r.get(0)).optional().map_err(|_|Error::StorageUnavailable)?;
    if let Some(Some(chat)) = &binding {
        if super::super::recovery::present(db).map_err(chat_error)? {
            let reusable: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM chat_sessions s JOIN chat_public_task_bindings p ON p.session_id=s.id JOIN chat_outbox o ON o.operation_id=p.create_operation_id JOIN chat_scheduled_run_bindings b ON b.create_operation_id=o.operation_id AND b.conversation_id=s.id JOIN chat_scheduled_runs r ON r.run_id=b.run_id JOIN chat_scheduled_recovery e ON e.run_id=r.run_id WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3 AND s.agent_session_id IS NULL AND s.runtime_thread_id IS NULL AND p.state='pending' AND p.attempt_count=0 AND o.attempt_count=0 AND o.state IN ('pending','failed') AND r.plan_id=?4 AND r.format_version=1 AND r.delivery_state='cancelled' AND e.format_version=1 AND e.release_kind='never_sent_cancel' AND e.refunded=1 AND e.create_attempt='never' AND e.turn_attempt='never' AND NOT EXISTS(SELECT 1 FROM chat_scheduled_run_bindings other WHERE other.conversation_id=s.id AND other.run_id!=r.run_id) AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id))",params![chat,scope.owner_user_id,scope.tenant_id,plan],|r|r.get(0)).map_err(|_|Error::StorageUnavailable)?;
            if reusable {
                return Ok(None);
            }
        }
    }
    Ok(binding)
}
impl ChatRepository {
    fn preparation_storage(&self) -> Result<(), Error> {
        self.execution_storage(true)?;
        if !self.schedule_preparation_enabled
            || !directories::present(&self.connection).map_err(chat_error)?
        {
            return Err(Error::StorageDisabled);
        }
        Ok(())
    }
    fn prepare_target(&self, p: &PlanView, request: &str) -> Result<Target, Error> {
        let conversation = match p.definition.target.mode {
            TargetMode::ExistingChat => Some(
                p.definition
                    .target
                    .conversation_id
                    .clone()
                    .ok_or(Error::TargetUnavailable)?,
            ),
            TargetMode::DedicatedChat => {
                let binding = dedicated_target(&self.connection, &self.scope, &p.plan_id)?;
                match binding {
                    Some(None) => return Err(Error::TargetUnavailable),
                    Some(Some(id)) => Some(id),
                    None => None,
                }
            }
            TargetMode::NewChatEachRun => None,
        };
        if let Some(chat) = conversation {
            let (project,mode):(String,String)=self.connection.query_row("SELECT s.project_id,COALESCE(t.mode,'ask') FROM chat_sessions s JOIN chat_projects p ON p.id=s.project_id LEFT JOIN chat_task_permissions t ON t.session_id=s.id WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3 AND p.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id)",params![chat,self.scope.owner_user_id,self.scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|_|Error::StorageUnavailable)?.ok_or(Error::TargetUnavailable)?;
            if mode != "ask" {
                return Err(Error::PermissionDenied);
            }
            let directory = self
                .resolve_schedule_project(&project)
                .map_err(chat_error)?;
            return Ok(Target {
                project,
                conversation: Some(chat),
                directory,
                managed_resource: None,
            });
        }
        let resource = directories::resource_id(
            &self.scope,
            &p.plan_id,
            (p.definition.target.mode == TargetMode::NewChatEachRun).then_some(request),
        );
        let directory = directories::managed_path(
            self.database_path
                .parent()
                .ok_or(Error::StorageUnavailable)?,
            &self.scope,
            &resource,
            true,
        )
        .map_err(chat_error)?;
        Ok(Target {
            project: resource.clone(),
            conversation: None,
            directory,
            managed_resource: Some(resource),
        })
    }
    fn prepare_manual_local(
        &mut self,
        a: &ScheduleAuthority,
        grant_id: &str,
        revision: i64,
        request: &str,
        timestamp: i64,
    ) -> Result<RunView, Error> {
        self.prepare_trigger_local(a, grant_id, revision, request, &Trigger::Manual, timestamp)
    }
    #[allow(clippy::too_many_arguments)]
    pub(in crate::chat::schedules) fn prepare_trigger_local(
        &mut self,
        a: &ScheduleAuthority,
        grant_id: &str,
        revision: i64,
        request: &str,
        trigger: &Trigger,
        timestamp: i64,
    ) -> Result<RunView, Error> {
        a.require(&self.scope, ScheduleCapability::ScheduleRun, timestamp)?;
        self.preparation_storage()?;
        // Replay precedes grant exhaustion/expiry, own reservation and directory I/O.
        if let Some(prior) = existing_run(
            &self.connection,
            &self.scope,
            grant_id,
            revision,
            request,
            trigger,
        )? {
            return Ok(prior);
        }
        let (_, p) = validate_grant(
            &self.connection,
            &self.scope,
            a,
            grant_id,
            revision,
            timestamp,
        )?;
        if guard::held(&self.connection).map_err(chat_error)?
            || guard::foreground_busy(&self.connection).map_err(chat_error)?
        {
            return Err(Error::ReservationBusy);
        }
        triggers::validate_trigger(
            &self.connection,
            &self.scope,
            &p,
            trigger,
            self.schedule_trigger_lifecycle.as_ref(),
            timestamp,
        )?;
        let target = self.prepare_target(&p, request)?;
        self.commit_trigger_preparation(
            a,
            grant_id,
            revision,
            request,
            &target,
            trigger,
            timestamp.max(now()?),
        )
    }
    #[cfg(test)]
    fn commit_manual_preparation(
        &mut self,
        a: &ScheduleAuthority,
        grant_id: &str,
        revision: i64,
        request: &str,
        target: &Target,
        timestamp: i64,
    ) -> Result<RunView, Error> {
        self.commit_trigger_preparation(
            a,
            grant_id,
            revision,
            request,
            target,
            &Trigger::Manual,
            timestamp,
        )
    }
    #[allow(clippy::too_many_arguments)]
    fn commit_trigger_preparation(
        &mut self,
        a: &ScheduleAuthority,
        grant_id: &str,
        revision: i64,
        request: &str,
        target: &Target,
        trigger: &Trigger,
        timestamp: i64,
    ) -> Result<RunView, Error> {
        self.preparation_storage()?;
        let deadline = self.schedule_ui_deadline;
        let scope = self.scope.clone();
        let tx = self
            .connection
            .transaction()
            .map_err(|_| Error::StorageUnavailable)?;
        a.require(&scope, ScheduleCapability::ScheduleRun, timestamp)?;
        if let Some(prior) = existing_run(&tx, &scope, grant_id, revision, request, trigger)? {
            return Ok(prior);
        }
        let (_, p) = validate_grant(&tx, &scope, a, grant_id, revision, timestamp)?;
        triggers::validate_trigger(
            &tx,
            &scope,
            &p,
            trigger,
            self.schedule_trigger_lifecycle.as_ref(),
            timestamp,
        )?;
        let expected_chat = match p.definition.target.mode {
            TargetMode::ExistingChat => p.definition.target.conversation_id.clone(),
            TargetMode::NewChatEachRun => None,
            TargetMode::DedicatedChat => dedicated_target(&tx, &scope, &p.plan_id)?.flatten(),
        };
        if expected_chat != target.conversation {
            return Err(Error::TargetUnavailable);
        }
        // The directory remains a native prepared resource, not SQL-atomic I/O.
        if crate::chat::database::validate_project_path(&target.directory).map_err(chat_error)?
            != target.directory
        {
            return Err(Error::TargetUnavailable);
        }
        if let Some(chat) = &target.conversation {
            let matches:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_sessions s JOIN chat_projects p ON p.id=s.project_id LEFT JOIN chat_task_permissions t ON t.session_id=s.id WHERE s.id=?1 AND s.project_id=?2 AND s.owner_user_id=?3 AND s.tenant_id=?4 AND p.removed_at IS NULL AND COALESCE(t.mode,'ask')='ask' AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id))",params![chat,target.project,scope.owner_user_id,scope.tenant_id],|r|r.get(0)).map_err(|_|Error::StorageUnavailable)?;
            if !matches {
                return Err(Error::TargetUnavailable);
            }
        }
        let path_hash = format!(
            "{:x}",
            Sha256::digest(target.directory.as_os_str().as_encoded_bytes())
        );
        if target.conversation.is_some() {
            let matches:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_projects WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND canonical_hash=?4 AND removed_at IS NULL)",params![target.project,scope.owner_user_id,scope.tenant_id,path_hash],|r|r.get(0)).map_err(|_|Error::StorageUnavailable)?;
            if !matches {
                return Err(Error::TargetUnavailable);
            }
        }
        if let Some(resource) = &target.managed_resource {
            let hash = format!(
                "{:x}",
                Sha256::digest(target.directory.as_os_str().as_encoded_bytes())
            );
            tx.execute("INSERT INTO chat_projects(id,owner_user_id,tenant_id,safe_name,canonical_hash,bookmark_ref,last_used_at,workspace_source,managed_resource_id) VALUES(?1,?2,?3,'定时任务工作目录',?4,NULL,?5,'managed_schedule',?6) ON CONFLICT(id) DO NOTHING",params![target.project,scope.owner_user_id,scope.tenant_id,hash,timestamp,resource]).map_err(|_|Error::StorageUnavailable)?;
            let matches:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_projects WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND workspace_source='managed_schedule' AND managed_resource_id=?4 AND canonical_hash=?5 AND removed_at IS NULL)",params![target.project,scope.owner_user_id,scope.tenant_id,resource,hash],|r|r.get(0)).map_err(|_|Error::StorageUnavailable)?;
            if !matches {
                return Err(Error::TargetUnavailable);
            }
        }
        let run = reserve_trigger(
            &tx, &scope, a, grant_id, revision, request, trigger, timestamp,
        )?;
        let operation = Uuid::parse_str(&run.operation_id).map_err(|_| Error::FormatUnsupported)?;
        let blocks = [DraftContentBlock::Text(p.definition.content.clone())];
        let context = ConversationEnqueueContext {
            scope: &scope,
            now: timestamp,
            draft: false,
            scheduled: Some(ScheduledEnqueue {
                run_id: &run.run_id,
                operation_id: operation,
            }),
        };
        let (chat, turn, create) = if let Some(chat) = &target.conversation {
            let chat_id = Uuid::parse_str(chat).map_err(|_| Error::FormatUnsupported)?;
            let turn = ChatRepository::enqueue_turn_in_transaction(
                &tx, context, chat_id, &blocks, operation,
            )
            .map_err(chat_error)?;
            (chat.clone(), turn.to_string(), None)
        } else {
            let create = Uuid::now_v7();
            let pending = ChatRepository::create_session_and_enqueue_in_transaction(
                &tx,
                context,
                Uuid::parse_str(&target.project).map_err(|_| Error::FormatUnsupported)?,
                &blocks,
                create,
                a.revision as u64,
            )
            .map_err(chat_error)?;
            if p.definition.target.mode == TargetMode::DedicatedChat {
                tx.execute("INSERT INTO chat_scheduled_target_bindings(plan_id,owner_user_id,tenant_id,conversation_id,project_id) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(plan_id) DO UPDATE SET conversation_id=excluded.conversation_id,project_id=excluded.project_id",params![p.plan_id,scope.owner_user_id,scope.tenant_id,pending.session_id.to_string(),target.project]).map_err(|_|Error::StorageUnavailable)?;
            }
            (
                pending.session_id.to_string(),
                pending.turn_id.to_string(),
                Some(create.to_string()),
            )
        };
        tx.execute("INSERT INTO chat_scheduled_run_bindings(run_id,conversation_id,project_id,create_operation_id,local_turn_id) VALUES(?1,?2,?3,?4,?5)",params![run.run_id,chat,target.project,create,turn]).map_err(|_|Error::StorageUnavailable)?;
        super::super::recovery::initialize(&tx, &run.run_id, create.as_deref())
            .map_err(|_| Error::StorageUnavailable)?;
        triggers::record_trigger(&tx, &scope, &run, &p, trigger, timestamp)?;
        crate::chat::schedules::ipc::commit_deadline(deadline)?;
        tx.commit().map_err(|_| Error::StorageUnavailable)?;
        Ok(run)
    }
}
impl ScheduleExecutionService {
    /// Native local-candidate preparation only; never registered as a command.
    /// It returns persisted reserved facts, not an accepted/dispatch receipt.
    pub async fn prepare_manual(
        &self,
        grant_id: String,
        revision: i64,
        request_id: String,
    ) -> Result<RunView, Error> {
        let authority = self.authority.clone();
        self.worker
            .call(move |repo| {
                Ok((|| {
                    let timestamp = now()?;
                    let a = authority.schedule_authority(timestamp)?;
                    repo.prepare_manual_local(&a, &grant_id, revision, &request_id, timestamp)
                })())
            })
            .await
            .map_err(|_| Error::StorageUnavailable)?
    }
}

#[cfg(test)]
mod tests;
