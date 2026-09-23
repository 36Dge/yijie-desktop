//! Native execution service. Explicit candidate triggers reuse the original outbox.
use super::execution_generated::{
    ExecutionErrorCode as Error, GrantConfirmation, GrantState, GrantView, RunView,
    RunViewPermissionMode, ScheduleCapability, WorkspaceReference, WorkspaceSource,
};
use super::generated::{PlanState, PlanView, TargetMode, TargetState};
use super::{execution_guard as guard, store::read_plan};
use crate::chat::{
    authorization::{ChatAction, ChatAuthorizationManager},
    database::{ChatRepository, ChatScope},
    worker::DatabaseWorker,
};
use crate::native_auth::NativeAuthRuntime;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Not a wire token and not deserializable. Only current native authority creates
/// this value. The service obtains a new value per call, never binds a UI context.
pub(crate) struct ScheduleAuthority {
    owner: String,
    tenant: String,
    pub(super) revision: i64,
    issued_at: i64,
    expires_at: i64,
    capabilities: Vec<ScheduleCapability>,
}
impl ScheduleAuthority {
    pub(crate) fn local(now: i64) -> Result<Self, Error> {
        use crate::local_profile::*;
        if !(0..=253402300559).contains(&now) {
            return Err(Error::ScopeDenied);
        }
        let base = demo_fast_capabilities();
        let has = |name: &str| base.iter().any(|c| c == name);
        let mut capabilities = Vec::new();
        if has("schedule.read") && has("task.read") {
            capabilities.push(ScheduleCapability::ScheduleRead);
            if has("task.create") {
                capabilities.push(ScheduleCapability::ScheduleManage);
            }
            if has("task.create") && has("workspace.use") {
                capabilities.push(ScheduleCapability::ScheduleRun);
            }
        }
        Ok(Self {
            owner: DEMO_FAST_OWNER_USER_ID.into(),
            tenant: DEMO_FAST_TENANT_ID.into(),
            revision: DEMO_FAST_AUTHORIZATION_REVISION as i64,
            issued_at: now,
            expires_at: now + 240,
            capabilities,
        })
    }
    pub(super) fn limit_to_ui(&mut self, deadline: i64) -> i64 {
        self.expires_at = self.expires_at.min(deadline);
        self.expires_at
    }
    pub(in crate::chat) fn require(
        &self,
        scope: &ChatScope,
        capability: ScheduleCapability,
        now: i64,
    ) -> Result<(), Error> {
        if self.owner != scope.owner_user_id
            || self.tenant != scope.tenant_id
            || self.revision < 1
            || now < self.issued_at
            || now >= self.expires_at
            || !self.capabilities.contains(&capability)
        {
            return Err(Error::ScopeDenied);
        }
        Ok(())
    }
}
pub(super) fn now() -> Result<i64, Error> {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| Error::StorageUnavailable)?
        .as_secs();
    i64::try_from(seconds).map_err(|_| Error::StorageUnavailable)
}
fn id(value: &str) -> Result<(), Error> {
    let uuid = Uuid::parse_str(value).map_err(|_| Error::InvalidInput)?;
    if uuid.is_nil() || uuid.to_string() != value {
        return Err(Error::InvalidInput);
    }
    Ok(())
}
fn encode<T: Serialize>(value: &T) -> Result<String, Error> {
    serde_json::to_string(value).map_err(|_| Error::StorageUnavailable)
}
fn digest(bytes: &str) -> String {
    format!("{:x}", Sha256::digest(bytes.as_bytes()))
}
fn word<T: Serialize>(value: &T) -> Result<String, Error> {
    serde_json::to_value(value)
        .map_err(|_| Error::StorageUnavailable)?
        .as_str()
        .map(str::to_owned)
        .ok_or(Error::StorageUnavailable)
}
fn read<T: serde::de::DeserializeOwned>(s: String) -> Result<T, Error> {
    serde_json::from_str(&s).map_err(|_| Error::FormatUnsupported)
}
fn enum_value<T: serde::de::DeserializeOwned>(s: String) -> Result<T, Error> {
    serde_json::from_value(serde_json::Value::String(s)).map_err(|_| Error::FormatUnsupported)
}
pub(super) fn plan_error(error: super::generated::ScheduleErrorCode) -> Error {
    use super::generated::ScheduleErrorCode as P;
    match error {
        P::InvalidInput => Error::InvalidInput,
        P::TargetUnavailable => Error::TargetUnavailable,
        P::NotFound => Error::NotFound,
        P::RevisionConflict => Error::RevisionConflict,
        P::RequestConflict => Error::RequestConflict,
        P::StorageDisabled => Error::StorageDisabled,
        P::RuleVersionUnsupported => Error::FormatUnsupported,
        P::ExecutionNotReady => Error::ExecutionNotReady,
        P::StorageUnavailable | P::TimeQueryExhausted => Error::StorageUnavailable,
    }
}
pub(super) fn plan(db: &Connection, scope: &ChatScope, id: &str) -> Result<PlanView, Error> {
    read_plan(db, scope, id).map_err(|e| match e {
        super::generated::ScheduleErrorCode::NotFound => Error::NotFound,
        super::generated::ScheduleErrorCode::RuleVersionUnsupported => Error::FormatUnsupported,
        _ => Error::StorageUnavailable,
    })
}
fn workspace(
    db: &Connection,
    scope: &ChatScope,
    p: &PlanView,
) -> Result<WorkspaceReference, Error> {
    if p.target_state == TargetState::Missing {
        return Err(Error::TargetUnavailable);
    }
    if let Some(chat) = &p.definition.target.conversation_id {
        let found:Option<(String,String)>=db.query_row(
            "SELECT s.project_id,COALESCE(t.mode,'ask') FROM chat_sessions s
             JOIN chat_projects p ON p.id=s.project_id AND p.owner_user_id=s.owner_user_id AND p.tenant_id=s.tenant_id
             LEFT JOIN chat_task_permissions t ON t.session_id=s.id
             WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3 AND p.removed_at IS NULL
               AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id)",
            params![chat,scope.owner_user_id,scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?)))
            .optional().map_err(|_|Error::StorageUnavailable)?;
        let (project, mode) = found.ok_or(Error::TargetUnavailable)?;
        if mode != "ask" {
            return Err(Error::PermissionDenied);
        }
        id(&project)?;
        return super::workspace::reference(db, scope, &project)
            .map_err(|_| Error::TargetUnavailable);
    }
    if p.definition.target.mode == TargetMode::ExistingChat {
        return Err(Error::TargetUnavailable);
    }
    // This is a policy reference, not a prepared directory or user bookmark.
    Ok(WorkspaceReference {
        source: WorkspaceSource::ManagedSchedule,
        resource_id: p.plan_id.clone(),
    })
}
fn definition_digest(p: &PlanView, w: &WorkspaceReference) -> Result<String, Error> {
    Ok(digest(&encode(&(
        p.revision,
        p.schedule_epoch,
        &p.definition,
        w,
    ))?))
}
pub(super) fn grant(
    db: &Connection,
    scope: &ChatScope,
    grant_id: &str,
    now: i64,
) -> Result<GrantView, Error> {
    id(grant_id)?;
    type GrantRow = (String, i64, i64, String, String, String, i64, i64, i64);
    let raw:Option<GrantRow>=db.query_row(
        "SELECT plan_id,plan_revision,authorization_revision,definition_digest,workspace_source,workspace_id,max_runs,occupied_runs,expires_at
         FROM chat_scheduled_grants WHERE grant_id=?1 AND owner_user_id=?2 AND tenant_id=?3",
        params![grant_id,scope.owner_user_id,scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?)))
        .optional().map_err(|_|Error::StorageUnavailable)?;
    let (pid, rev, auth, digest, source, wid, max, occupied, expires) =
        raw.ok_or(Error::NotFound)?;
    let p = plan(db, scope, &pid)?;
    let state = if p.state == PlanState::Deleted
        || p.revision != rev
        || (!single::is_single(db, scope, grant_id)?
            && p.authorization_ref.as_deref() != Some(grant_id))
    {
        GrantState::Stale
    } else if now >= expires {
        GrantState::Expired
    } else if occupied >= max {
        GrantState::Exhausted
    } else {
        GrantState::Active
    };
    Ok(GrantView {
        grant_id: grant_id.into(),
        plan_id: pid,
        plan_revision: rev,
        authorization_revision: auth,
        definition_digest: digest,
        workspace: WorkspaceReference {
            source: enum_value(source)?,
            resource_id: wid,
        },
        max_runs: max,
        occupied_runs: occupied,
        expires_at: expires,
        state,
    })
}
fn validate_grant(
    db: &Connection,
    scope: &ChatScope,
    a: &ScheduleAuthority,
    grant_id: &str,
    revision: i64,
    now: i64,
) -> Result<(GrantView, PlanView), Error> {
    a.require(scope, ScheduleCapability::ScheduleRun, now)?;
    let g = grant(db, scope, grant_id, now).map_err(|e| {
        if e == Error::NotFound {
            Error::GrantMissing
        } else {
            e
        }
    })?;
    if g.plan_revision != revision {
        return Err(Error::RevisionConflict);
    }
    if g.authorization_revision != a.revision {
        return Err(Error::GrantStale);
    }
    match g.state {
        GrantState::Expired => return Err(Error::GrantExpired),
        GrantState::Exhausted => return Err(Error::GrantExhausted),
        GrantState::Stale => return Err(Error::GrantStale),
        GrantState::Active => {}
    }
    let p = plan(db, scope, &g.plan_id)?;
    let w = workspace(db, scope, &p)?;
    if definition_digest(&p, &w)? != g.definition_digest || w != g.workspace {
        return Err(Error::GrantStale);
    }
    Ok((g, p))
}
impl ChatRepository {
    fn execution_storage(&self, write: bool) -> Result<(), Error> {
        if !guard::present(&self.connection).map_err(|_| Error::StorageUnavailable)?
            || (write && !self.schedule_execution_writes_enabled)
        {
            return Err(Error::StorageDisabled);
        }
        Ok(())
    }
    pub(in crate::chat::schedules) fn confirm_schedule_grant(
        &mut self,
        a: &ScheduleAuthority,
        request: GrantConfirmation,
        now: i64,
    ) -> Result<GrantView, Error> {
        a.require(&self.scope, ScheduleCapability::ScheduleManage, now)?;
        self.execution_storage(true)?;
        id(&request.request_id)?;
        id(&request.plan_id)?;
        if request.expected_revision < 1
            || !(1..=2147483647).contains(&request.max_runs)
            || !(0..=253402300799).contains(&request.expires_at)
            || request.expires_at <= now
        {
            return Err(Error::InvalidInput);
        }
        let hash = digest(&encode(&request)?);
        let deadline = self.schedule_ui_deadline;
        let scope = self.scope.clone();
        let tx = self
            .connection
            .transaction()
            .map_err(|_| Error::StorageUnavailable)?;
        let prior:Option<(String,String)>=tx.query_row("SELECT grant_id,request_digest FROM chat_scheduled_grants WHERE owner_user_id=?1 AND tenant_id=?2 AND request_id=?3",params![scope.owner_user_id,scope.tenant_id,request.request_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|_|Error::StorageUnavailable)?;
        if let Some((gid, old)) = prior {
            if old != hash {
                return Err(Error::RequestConflict);
            }
            return grant(&tx, &scope, &gid, now); // replay never refreshes/rebinds authority
        }
        let p = plan(&tx, &scope, &request.plan_id)?;
        if p.state == PlanState::Deleted {
            return Err(Error::NotFound);
        }
        if p.revision != request.expected_revision {
            return Err(Error::RevisionConflict);
        }
        if triggers::present(&tx)? && p.state == PlanState::Enabled {
            return Err(Error::RequestConflict); // A grant-only confirmation cannot silently renew automatic execution.
        }
        if guard::held(&tx).map_err(|_| Error::StorageUnavailable)? {
            return Err(Error::ReservationBusy);
        }
        let w = workspace(&tx, &scope, &p)?;
        let gid = Uuid::now_v7().to_string();
        tx.execute("INSERT INTO chat_scheduled_grants(grant_id,owner_user_id,tenant_id,request_id,request_digest,plan_id,plan_revision,authorization_revision,definition_digest,workspace_source,workspace_id,max_runs,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",params![gid,scope.owner_user_id,scope.tenant_id,request.request_id,hash,p.plan_id,p.revision,a.revision,definition_digest(&p,&w)?,word(&w.source)?,w.resource_id,request.max_runs,request.expires_at]).map_err(|_|Error::StorageUnavailable)?;
        tx.execute("UPDATE chat_scheduled_plans SET authorization_ref=?1,authorization_expires_at=?2 WHERE plan_id=?3 AND owner_user_id=?4 AND tenant_id=?5 AND revision=?6",params![gid,request.expires_at,p.plan_id,scope.owner_user_id,scope.tenant_id,p.revision]).map_err(|_|Error::StorageUnavailable)?;
        let view = grant(&tx, &scope, &gid, now)?;
        super::ipc::commit_deadline(deadline)?;
        tx.commit().map_err(|_| Error::StorageUnavailable)?;
        Ok(view) // deliberately leaves the plan paused
    }
    fn read_scheduled_run(
        &self,
        a: &ScheduleAuthority,
        run_id: &str,
        now: i64,
    ) -> Result<RunView, Error> {
        a.require(&self.scope, ScheduleCapability::ScheduleRead, now)?;
        self.execution_storage(false)?;
        read_run(&self.connection, &self.scope, run_id)
    }
}
pub(super) fn read_run(db: &Connection, scope: &ChatScope, run_id: &str) -> Result<RunView, Error> {
    let run = read_run_base(db, scope, run_id)?;
    triggers::validate_facts(db, scope, &run)?;
    Ok(run)
}
fn read_run_base(db: &Connection, scope: &ChatScope, run_id: &str) -> Result<RunView, Error> {
    id(run_id)?;
    let row:Option<(i64,String,String)>=db.query_row(
        "SELECT format_version,snapshot_json,snapshot_digest FROM chat_scheduled_runs WHERE run_id=?1 AND owner_user_id=?2 AND tenant_id=?3",
        params![run_id,scope.owner_user_id,scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|_|Error::StorageUnavailable)?;
    let (version, json, hash) = row.ok_or(Error::NotFound)?;
    if version != 1 {
        return Err(Error::FormatUnsupported);
    }
    if digest(&json) != hash {
        return Err(Error::StorageUnavailable);
    }
    let snapshot: PlanView = read(json)?;
    let result=db.query_row("SELECT plan_id,plan_revision,schedule_epoch,request_id,operation_id,trigger_source,original_run_id,logical_slot,grant_id,workspace_source,workspace_id,delivery_state,native_outcome,needs_attention FROM chat_scheduled_runs WHERE run_id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![run_id,scope.owner_user_id,scope.tenant_id],|r|{
        Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,Option<String>>(7)?,r.get::<_,String>(8)?,r.get::<_,String>(9)?,r.get::<_,String>(10)?,r.get::<_,String>(11)?,r.get::<_,String>(12)?,r.get::<_,bool>(13)?))
    }).map_err(|_|Error::StorageUnavailable)?;
    if snapshot.plan_id != result.0
        || snapshot.revision != result.1
        || snapshot.schedule_epoch != result.2
    {
        return Err(Error::StorageUnavailable);
    }
    Ok(RunView {
        run_id: run_id.into(),
        plan_id: result.0,
        plan_revision: result.1,
        schedule_epoch: result.2,
        request_id: result.3,
        operation_id: result.4,
        trigger: enum_value(result.5)?,
        original_run_id: result.6,
        logical_slot: result.7,
        grant_id: result.8,
        snapshot_digest: hash,
        workspace: WorkspaceReference {
            source: enum_value(result.9)?,
            resource_id: result.10,
        },
        permission_mode: RunViewPermissionMode::Ask,
        delivery_state: enum_value(result.11)?,
        native_outcome: enum_value(result.12)?,
        needs_attention: result.13,
    })
}

/// Only the later combined run/conversation/outbox transaction may call this.
/// There is intentionally no production service entry that commits a reservation
/// alone, no occurrence claim here, and no timeout/user-confirmation release API.
#[allow(dead_code)]
pub(super) fn reserve_in_transaction(
    tx: &Transaction<'_>,
    scope: &ChatScope,
    a: &ScheduleAuthority,
    grant_id: &str,
    revision: i64,
    request_id: &str,
    now: i64,
) -> Result<RunView, Error> {
    reserve_trigger(
        tx,
        scope,
        a,
        grant_id,
        revision,
        request_id,
        &Trigger::Manual,
        now,
    )
}
#[allow(clippy::too_many_arguments)]
fn reserve_trigger(
    tx: &Transaction<'_>,
    scope: &ChatScope,
    a: &ScheduleAuthority,
    grant_id: &str,
    revision: i64,
    request_id: &str,
    trigger: &Trigger,
    now: i64,
) -> Result<RunView, Error> {
    a.require(scope, ScheduleCapability::ScheduleRun, now)?;
    id(request_id)?;
    let hash = trigger.hash(grant_id, revision, request_id)?;
    let old:Option<(String,String)>=tx.query_row("SELECT run_id,request_digest FROM chat_scheduled_runs WHERE owner_user_id=?1 AND tenant_id=?2 AND request_id=?3",params![scope.owner_user_id,scope.tenant_id,request_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|_|Error::StorageUnavailable)?;
    if let Some((run, previous)) = old {
        if previous != hash {
            return Err(Error::RequestConflict);
        }
        return read_run(tx, scope, &run);
    }
    let (g, p) = validate_grant(tx, scope, a, grant_id, revision, now)?;
    if !single::matches_trigger(tx, scope, grant_id, trigger)? {
        return Err(Error::PermissionDenied);
    }
    if guard::held(tx).map_err(|_| Error::StorageUnavailable)?
        || guard::foreground_busy(tx).map_err(|_| Error::StorageUnavailable)?
    {
        return Err(Error::ReservationBusy);
    }
    let run = Uuid::now_v7().to_string();
    let operation = Uuid::now_v7().to_string();
    let snapshot = encode(&p)?;
    tx.execute("INSERT INTO chat_scheduled_runs(run_id,owner_user_id,tenant_id,format_version,plan_id,plan_revision,schedule_epoch,request_id,request_digest,operation_id,trigger_source,original_run_id,logical_slot,grant_id,snapshot_json,snapshot_digest,workspace_source,workspace_id,permission_mode,delivery_state,native_outcome,needs_attention) VALUES(?1,?2,?3,1,?4,?5,?6,?7,?8,?9,?15,?16,?17,?10,?11,?12,?13,?14,'ask','reserved','unobserved',0)",params![run,scope.owner_user_id,scope.tenant_id,p.plan_id,p.revision,p.schedule_epoch,request_id,hash,operation,grant_id,snapshot,digest(&snapshot),word(&g.workspace.source)?,g.workspace.resource_id,trigger.word(),trigger.original(),trigger.slot()]).map_err(|_|Error::StorageUnavailable)?;
    tx.execute(
        "INSERT INTO chat_scheduled_reservation(singleton,run_id) VALUES(1,?1)",
        [&run],
    )
    .map_err(|_| Error::ReservationBusy)?;
    let changed=tx.execute("UPDATE chat_scheduled_grants SET occupied_runs=occupied_runs+1 WHERE grant_id=?1 AND occupied_runs<max_runs",[grant_id]).map_err(|_|Error::StorageUnavailable)?;
    if changed != 1 {
        return Err(Error::GrantExhausted);
    }
    read_run_base(tx, scope, &run)
}

#[derive(Clone)]
pub struct ScheduleExecutionService {
    worker: DatabaseWorker,
    authority: NativeAuthRuntime,
    ui_authorization: ChatAuthorizationManager,
}
impl ScheduleExecutionService {
    pub fn new(
        worker: DatabaseWorker,
        authority: NativeAuthRuntime,
        ui_authorization: ChatAuthorizationManager,
    ) -> Self {
        Self {
            worker,
            authority,
            ui_authorization,
        }
    }
    async fn manage<R: Send + 'static>(
        &self,
        context_id: Uuid,
        job: impl FnOnce(&mut ChatRepository, i64) -> Result<R, Error> + Send + 'static,
    ) -> Result<R, Error> {
        let a = self.authority.schedule_authority(now()?)?;
        let ui = self.ui_authorization.clone();
        let result = self
            .worker
            .call(move |repo| {
                Ok((|| {
                    let timestamp = now()?;
                    ui.authorize(context_id, ChatAction::SubmitTurn, timestamp)
                        .map_err(|_| Error::ScopeDenied)?;
                    a.require(&repo.scope, ScheduleCapability::ScheduleManage, timestamp)?;
                    repo.execution_storage(true)?;
                    job(repo, timestamp)
                })())
            })
            .await
            .map_err(|_| Error::StorageUnavailable)?;
        if result.is_ok() {
            self.worker.schedule_changed.notify_one();
        }
        result
    }
    pub async fn save_plan(
        &self,
        context_id: Uuid,
        request: super::generated::SavePlanRequest,
    ) -> Result<PlanView, Error> {
        self.manage(context_id, move |repo, timestamp| {
            repo.save_schedule(request, timestamp).map_err(plan_error)
        })
        .await
    }
    pub async fn pause_plan(
        &self,
        context_id: Uuid,
        plan_id: String,
        revision: i64,
    ) -> Result<PlanView, Error> {
        self.manage(context_id, move |repo, _| {
            repo.pause_schedule(&plan_id, revision).map_err(plan_error)
        })
        .await
    }
    pub async fn delete_plan(
        &self,
        context_id: Uuid,
        plan_id: String,
        revision: i64,
    ) -> Result<PlanView, Error> {
        self.manage(context_id, move |repo, _| {
            repo.delete_schedule(&plan_id, revision).map_err(plan_error)
        })
        .await
    }
    /// Native-only local cancellation; no renderer endpoint is registered.
    pub async fn cancel_unsent(&self, run_id: String) -> Result<(), Error> {
        let a = self.authority.schedule_authority(now()?)?;
        self.worker
            .call(move |r| {
                r.cancel_unsent_schedule(
                    &a,
                    &run_id,
                    now().map_err(|_| crate::chat::error::ChatError::DatabaseUnavailable)?,
                )
            })
            .await
            .map_err(|_| Error::ExecutionNotReady)
    }
    pub async fn list_plans(&self) -> Result<Vec<PlanView>, Error> {
        let a = self.authority.schedule_authority(now()?)?;
        self.worker
            .call(move |repo| {
                Ok((|| {
                    a.require(&repo.scope, ScheduleCapability::ScheduleRead, now()?)?;
                    repo.list_schedules().map_err(plan_error)
                })())
            })
            .await
            .map_err(|_| Error::StorageUnavailable)?
    }
    pub async fn confirm_grant(
        &self,
        context_id: Uuid,
        request: GrantConfirmation,
    ) -> Result<GrantView, Error> {
        // User confirmation is still a current UI action; this does not bind or refresh it.
        self.ui_authorization
            .authorize(context_id, ChatAction::SubmitTurn, now()?)
            .map_err(|_| Error::ScopeDenied)?;
        let a = self.authority.schedule_authority(now()?)?;
        let ui = self.ui_authorization.clone();
        self.worker
            .call(move |repo| {
                Ok((|| {
                    let timestamp = now()?;
                    ui.authorize(context_id, ChatAction::SubmitTurn, timestamp)
                        .map_err(|_| Error::ScopeDenied)?;
                    repo.confirm_schedule_grant(&a, request, timestamp)
                })())
            })
            .await
            .map_err(|_| Error::StorageUnavailable)?
    }
    pub async fn read_grant(&self, grant_id: String) -> Result<GrantView, Error> {
        let a = self.authority.schedule_authority(now()?)?;
        self.worker
            .call(move |repo| {
                Ok((|| {
                    let timestamp = now()?;
                    a.require(&repo.scope, ScheduleCapability::ScheduleRead, timestamp)?;
                    repo.execution_storage(false)?;
                    grant(&repo.connection, &repo.scope, &grant_id, timestamp)
                })())
            })
            .await
            .map_err(|_| Error::StorageUnavailable)?
    }
    pub async fn read_run(&self, run_id: String) -> Result<RunView, Error> {
        let a = self.authority.schedule_authority(now()?)?;
        self.worker
            .call(move |repo| Ok((|| repo.read_scheduled_run(&a, &run_id, now()?))()))
            .await
            .map_err(|_| Error::StorageUnavailable)?
    }
    /// No accepted receipt, outbox or reservation is created by this preflight.
    pub async fn check_run(&self, grant_id: String, revision: i64) -> Result<(), Error> {
        let a = self.authority.schedule_authority(now()?)?;
        self.worker
            .call(move |repo| {
                Ok((|| {
                    repo.execution_storage(false)?;
                    validate_grant(
                        &repo.connection,
                        &repo.scope,
                        &a,
                        &grant_id,
                        revision,
                        now()?,
                    )?;
                    if guard::held(&repo.connection).map_err(|_| Error::StorageUnavailable)?
                        || guard::foreground_busy(&repo.connection)
                            .map_err(|_| Error::StorageUnavailable)?
                    {
                        return Err(Error::ReservationBusy);
                    }
                    Err(Error::ExecutionNotReady) // 3B lifetime/Host/approval/outbound gates are absent.
                })())
            })
            .await
            .map_err(|_| Error::StorageUnavailable)?
    }
}

pub(crate) mod dispatch;
mod preparation;
pub(crate) mod single;
pub(crate) mod triggers;
use triggers::Trigger;
pub use triggers::{EnableReceipt, RerunConfirmation, RerunPreview};
#[cfg(test)]
mod tests;
