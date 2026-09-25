//! Private native trigger semantics; no renderer/wire API and no second queue.
use super::super::{store, time};
use super::*;
use crate::chat::lifecycle::{ContinuityTicket, Lifecycle};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct RerunConfirmation {
    pub original_run_id: String,
    pub original_snapshot_digest: String,
    pub plan_id: String,
    pub revision: i64,
    pub definition_digest: String,
    pub grant_id: String,
}
#[derive(Clone, Debug)]
pub struct RerunPreview {
    pub confirmation: RerunConfirmation,
    pub original: super::super::generated::PlanDefinition,
    pub current: super::super::generated::PlanDefinition,
}
#[derive(Clone, Debug)]
pub struct EnableReceipt {
    pub plan: PlanView,
    pub grant: GrantView,
    pub future_hold: Option<String>,
    pub automatic_consent: bool,
}
#[derive(Clone, Debug, Serialize)]
pub(in crate::chat::schedules) struct AutomaticSlot {
    pub plan: String,
    pub revision: i64,
    pub epoch: i64,
    pub slot: String,
    pub at: i64,
    pub ticket: ContinuityTicket,
}
#[derive(Clone, Debug)]
pub(in crate::chat::schedules) enum Trigger {
    Manual,
    Automatic(AutomaticSlot),
    Rerun(RerunConfirmation),
}
impl Trigger {
    pub(super) fn word(&self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Automatic(_) => "automatic",
            Self::Rerun(_) => "rerun",
        }
    }
    pub(super) fn original(&self) -> Option<&str> {
        if let Self::Rerun(c) = self {
            Some(&c.original_run_id)
        } else {
            None
        }
    }
    pub(super) fn slot(&self) -> Option<&str> {
        if let Self::Automatic(c) = self {
            Some(&c.slot)
        } else {
            None
        }
    }
    pub(super) fn hash(&self, grant: &str, revision: i64, request: &str) -> Result<String, Error> {
        // Keep the v17-v20 manual receipt interpretation unchanged.
        let value = match self {
            Self::Manual => encode(&(grant, revision, request))?,
            Self::Automatic(c) => encode(&(
                "automatic/1",
                grant,
                revision,
                request,
                &c.plan,
                c.epoch,
                &c.slot,
                c.at,
            ))?,
            Self::Rerun(c) => encode(&("rerun/1", grant, revision, request, c))?,
        };
        Ok(digest(&value))
    }
}
pub(crate) fn present(db: &Connection) -> Result<bool, Error> {
    Ok(db
        .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
        .map_err(|_| Error::StorageUnavailable)?
        >= crate::chat::migrations::SCHEDULE_TRIGGER_SCHEMA_VERSION)
}
fn hold(db: &Connection, scope: &ChatScope, plan: &str) -> Result<Option<String>, Error> {
    db.query_row("SELECT future_hold FROM chat_scheduled_plans WHERE plan_id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![plan,scope.owner_user_id,scope.tenant_id],|r|r.get(0)).map_err(|_|Error::StorageUnavailable)
}
pub(crate) fn hold_unknown(
    db: &Connection,
    run: &str,
) -> Result<(), crate::chat::error::ChatError> {
    if present(db).map_err(|_| crate::chat::error::ChatError::DatabaseUnavailable)? {
        db.execute("UPDATE chat_scheduled_plans SET future_hold='unknown' WHERE plan_id=(SELECT r.plan_id FROM chat_scheduled_runs r JOIN chat_scheduled_recovery e ON e.run_id=r.run_id WHERE r.run_id=?1 AND r.plan_revision=chat_scheduled_plans.revision AND (e.create_attempt IN ('attempted','unknown') OR e.turn_attempt IN ('attempted','unknown')))",[run]).map_err(|_|crate::chat::error::ChatError::DatabaseUnavailable)?;
    }
    Ok(())
}
pub(in crate::chat::schedules) fn rerun_preview(
    db: &Connection,
    scope: &ChatScope,
    original: &str,
) -> Result<RerunPreview, Error> {
    if !present(db)? {
        return Err(Error::StorageDisabled);
    }
    let run = read_run(db, scope, original)?;
    let p = plan(db, scope, &run.plan_id)?;
    if p.state == PlanState::Deleted {
        return Err(Error::NotFound);
    }
    let snapshot: String = db
        .query_row(
            "SELECT snapshot_json FROM chat_scheduled_runs WHERE run_id=?1",
            [original],
            |r| r.get(0),
        )
        .map_err(|_| Error::StorageUnavailable)?;
    let old: PlanView = read(snapshot)?;
    Ok(RerunPreview {
        confirmation: RerunConfirmation {
            original_run_id: original.into(),
            original_snapshot_digest: run.snapshot_digest,
            plan_id: p.plan_id,
            revision: p.revision,
            definition_digest: digest(&encode(&p.definition)?),
            grant_id: p.authorization_ref.ok_or(Error::GrantMissing)?,
        },
        original: old.definition,
        current: p.definition,
    })
}
pub(super) fn validate_trigger(
    db: &Connection,
    scope: &ChatScope,
    p: &PlanView,
    trigger: &Trigger,
    lifecycle: Option<&Lifecycle>,
    now: i64,
) -> Result<(), Error> {
    match trigger {
        Trigger::Manual => Ok(()),
        Trigger::Rerun(c) => {
            let matches = if super::single::is_single(db, scope, &c.grant_id)? {
                super::single::matches_trigger(db, scope, &c.grant_id, trigger)?
                    && super::single::review(db, scope, &c.original_run_id)?.confirmation
                        == super::single::review_from_confirmation(c)
            } else {
                rerun_preview(db, scope, &c.original_run_id)?.confirmation == *c
            };
            if !matches || c.plan_id != p.plan_id {
                return Err(Error::RevisionConflict);
            }
            Ok(())
        }
        Trigger::Automatic(c) => {
            if super::super::automatic::present(db)?
                && !p
                    .authorization_ref
                    .as_ref()
                    .map(|g| super::super::automatic::consent(db, g))
                    .transpose()?
                    .unwrap_or(false)
            {
                return Err(Error::GrantMissing);
            }
            if !present(db)? {
                return Err(Error::StorageDisabled);
            }
            lifecycle
                .ok_or(Error::ExecutionNotReady)?
                .validate_ticket(&c.ticket, c.at, now)
                .map_err(|_| Error::ExecutionNotReady)?;
            if p.state != PlanState::Enabled
                || hold(db, scope, &p.plan_id)?.is_some()
                || p.plan_id != c.plan
                || p.revision != c.revision
                || p.schedule_epoch != c.epoch
                || p.next_at != Some(c.at)
            {
                return Err(Error::RevisionConflict);
            }
            let exists:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_occurrences WHERE owner_user_id=?1 AND tenant_id=?2 AND plan_id=?3 AND schedule_epoch=?4 AND logical_slot=?5 AND scheduled_at=?6 AND disposition='planned' AND run_id IS NULL)",params![scope.owner_user_id,scope.tenant_id,c.plan,c.epoch,c.slot,c.at],|r|r.get(0)).map_err(|_|Error::StorageUnavailable)?;
            if !exists {
                return Err(Error::RequestConflict);
            }
            Ok(())
        }
    }
}
pub(super) fn record_trigger(
    tx: &Transaction<'_>,
    scope: &ChatScope,
    run: &RunView,
    p: &PlanView,
    trigger: &Trigger,
    now: i64,
) -> Result<(), Error> {
    match trigger {
        Trigger::Manual => {}
        Trigger::Rerun(c) => {
            tx.execute("INSERT INTO chat_scheduled_trigger_facts(run_id,format_version,trigger_source,confirmation_json) VALUES(?1,1,'rerun',?2)",params![run.run_id,encode(c)?]).map_err(|_|Error::StorageUnavailable)?;
        }
        Trigger::Automatic(c) => {
            tx.execute("INSERT INTO chat_scheduled_trigger_facts(run_id,format_version,trigger_source,process_generation,lifecycle_epoch,continuous_from,scheduled_at,send_until) VALUES(?1,1,'automatic',?2,?3,?4,?5,?6)",params![run.run_id,c.ticket.process,i64::try_from(c.ticket.epoch).map_err(|_|Error::FormatUnsupported)?,c.ticket.since,c.at,c.at+60]).map_err(|_|Error::StorageUnavailable)?;
            let n=tx.execute("UPDATE chat_scheduled_occurrences SET disposition='consumed',run_id=?1 WHERE owner_user_id=?2 AND tenant_id=?3 AND plan_id=?4 AND schedule_epoch=?5 AND logical_slot=?6 AND disposition='planned' AND run_id IS NULL",params![run.run_id,scope.owner_user_id,scope.tenant_id,p.plan_id,p.schedule_epoch,c.slot]).map_err(|_|Error::StorageUnavailable)?;
            if n != 1 {
                return Err(Error::RequestConflict);
            }
            advance(tx, scope, p, now, false)?;
            tx.execute("UPDATE chat_scheduled_plans SET future_hold='budget' WHERE plan_id=?1 AND future_hold IS NULL AND EXISTS(SELECT 1 FROM chat_scheduled_grants WHERE grant_id=?2 AND occupied_runs>=max_runs)",params![p.plan_id,run.grant_id]).map_err(|_|Error::StorageUnavailable)?;
        }
    }
    Ok(())
}
fn advance(
    tx: &Transaction<'_>,
    scope: &ChatScope,
    p: &PlanView,
    now: i64,
    definitive: bool,
) -> Result<(), Error> {
    let clock = now.max(store::cursor_at(tx, scope, &p.plan_id).map_err(plan_error)?);
    let preview = time::preview(&p.definition.rule, clock, p.effective_from).map_err(plan_error)?;
    let mut p = p.clone();
    p.next_at = preview.next_at;
    if definitive && p.next_at.is_none() && p.state == PlanState::Enabled {
        p.state = PlanState::Completed;
    }
    store::write_plan(tx, scope, &p, clock).map_err(plan_error)?;
    store::insert_future(tx, scope, &p, preview.logical_slot.as_deref(), clock).map_err(plan_error)
}
impl ChatRepository {
    pub(super) fn trigger_storage(&self) -> Result<(), Error> {
        self.execution_storage(true)?;
        if !self.schedule_preparation_enabled || !present(&self.connection)? {
            return Err(Error::StorageDisabled);
        }
        Ok(())
    }
    pub(in crate::chat) fn enable_schedule(
        &mut self,
        a: &ScheduleAuthority,
        request: GrantConfirmation,
        now: i64,
    ) -> Result<EnableReceipt, Error> {
        self.enable_schedule_inner(a, request, now, None)
    }
    pub(in crate::chat) fn confirm_automatic_schedule(
        &mut self,
        a: &ScheduleAuthority,
        input: super::super::ipc_generated::EnableConfirmation,
        now: i64,
    ) -> Result<EnableReceipt, Error> {
        a.require(&self.scope, ScheduleCapability::ScheduleRun, now)?;
        if !super::super::automatic::present(&self.connection)? {
            return Err(Error::StorageDisabled);
        }
        self.enable_schedule_inner(a, input.confirmation, now, Some(input.expected_next_at))
    }
    fn enable_schedule_inner(
        &mut self,
        a: &ScheduleAuthority,
        request: GrantConfirmation,
        now: i64,
        expected_next_at: Option<i64>,
    ) -> Result<EnableReceipt, Error> {
        self.trigger_storage()?;
        a.require(&self.scope, ScheduleCapability::ScheduleManage, now)?;
        id(&request.request_id)?;
        id(&request.plan_id)?;
        let hash = match expected_next_at {
            Some(next) => digest(&encode(&("enable/2", &request, next))?),
            None => digest(&encode(&("enable/1", &request))?),
        };
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
            let version: i64 = tx
                .query_row(
                    "SELECT format_version FROM chat_scheduled_enable_receipts WHERE grant_id=?1",
                    [&gid],
                    |r| r.get(0),
                )
                .map_err(|_| Error::FormatUnsupported)?;
            if version != 1 {
                return Err(Error::FormatUnsupported);
            }
            return Ok(EnableReceipt {
                automatic_consent: super::super::automatic::consent(&tx, &gid)?,
                plan: plan(&tx, &scope, &request.plan_id)?,
                grant: grant(&tx, &scope, &gid, now)?,
                future_hold: hold(&tx, &scope, &request.plan_id)?,
            });
        }
        // Only fresh explicit live confirmations require current execution readiness.
        // Historical receipts are observations and cannot mint consent.
        if (self.manual_runtime.enabled || expected_next_at.is_some())
            && (expected_next_at.is_none()
                || !self.manual_runtime.ready()
                || self.schedule_trigger_lifecycle.is_none())
        {
            return Err(Error::ExecutionNotReady);
        }
        if request.expected_revision < 1
            || !(1..=2147483647).contains(&request.max_runs)
            || request.expires_at <= now
            || request.expires_at > 253402300799
        {
            return Err(Error::InvalidInput);
        }
        let mut p = plan(&tx, &scope, &request.plan_id)?;
        if p.state == PlanState::Deleted {
            return Err(Error::NotFound);
        }
        if p.revision != request.expected_revision {
            return Err(Error::RevisionConflict);
        }
        let current_consent = !super::super::automatic::present(&tx)?
            || p.authorization_ref
                .as_ref()
                .map(|g| super::super::automatic::consent(&tx, g))
                .transpose()?
                .unwrap_or(false);
        let current_grant = p
            .authorization_ref
            .as_ref()
            .map(|id| grant(&tx, &scope, id, now))
            .transpose()?;
        if p.state == PlanState::Enabled
            && hold(&tx, &scope, &p.plan_id)?.is_none()
            && current_consent
            && current_grant.is_some_and(|g| {
                g.state == GrantState::Active && g.authorization_revision == a.revision
            })
        {
            return Err(Error::RequestConflict);
        }
        if guard::held(&tx).map_err(|_| Error::StorageUnavailable)?
            || guard::foreground_busy(&tx).map_err(|_| Error::StorageUnavailable)?
        {
            return Err(Error::ReservationBusy);
        }
        let w = workspace(&tx, &scope, &p)?;
        // A dedicated binding is not the authorization policy, but must still be usable.
        validate_automatic_target(&tx, &p)?;
        let clock = now.max(store::cursor_at(&tx, &scope, &p.plan_id).map_err(plan_error)?);
        let next =
            time::preview(&p.definition.rule, clock, p.effective_from).map_err(plan_error)?;
        let next_at = next.next_at.ok_or(Error::InvalidInput)?;
        if expected_next_at.is_some() && request.expires_at <= next_at {
            return Err(Error::InvalidInput);
        }
        if expected_next_at.is_some_and(|expected| expected != next_at) {
            return Err(Error::RevisionConflict);
        }
        p.revision = p.revision.checked_add(1).ok_or(Error::StorageUnavailable)?;
        p.state = PlanState::Enabled;
        p.next_at = next.next_at;
        let gid = Uuid::now_v7().to_string();
        p.authorization_ref = Some(gid.clone());
        p.authorization_expires_at = Some(request.expires_at);
        store::write_plan(&tx, &scope, &p, clock).map_err(plan_error)?;
        tx.execute("INSERT INTO chat_scheduled_grants(grant_id,owner_user_id,tenant_id,request_id,request_digest,plan_id,plan_revision,authorization_revision,definition_digest,workspace_source,workspace_id,max_runs,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",params![gid,scope.owner_user_id,scope.tenant_id,request.request_id,hash,p.plan_id,p.revision,a.revision,definition_digest(&p,&w)?,word(&w.source)?,w.resource_id,request.max_runs,request.expires_at]).map_err(|_|Error::StorageUnavailable)?;
        tx.execute(
            "INSERT INTO chat_scheduled_enable_receipts(grant_id,format_version) VALUES(?1,1)",
            [&gid],
        )
        .map_err(|_| Error::StorageUnavailable)?;
        if expected_next_at.is_some() {
            tx.execute("UPDATE chat_scheduled_enable_receipts SET automatic_consent_version=1 WHERE grant_id=?1", [&gid]).map_err(|_|Error::StorageUnavailable)?;
        }
        tx.execute(
            "UPDATE chat_scheduled_plans SET future_hold=NULL WHERE plan_id=?1",
            [&p.plan_id],
        )
        .map_err(|_| Error::StorageUnavailable)?;
        store::cancel_slots(&tx, &scope, &p.plan_id).map_err(plan_error)?;
        store::insert_future(&tx, &scope, &p, next.logical_slot.as_deref(), clock)
            .map_err(plan_error)?;
        let g = grant(&tx, &scope, &gid, now)?;
        crate::chat::schedules::ipc::commit_deadline(deadline)?;
        tx.commit().map_err(|_| Error::StorageUnavailable)?;
        Ok(EnableReceipt {
            automatic_consent: expected_next_at.is_some(),
            plan: p,
            grant: g,
            future_hold: None,
        })
    }
}

fn validate_automatic_target(tx: &Transaction<'_>, p: &PlanView) -> Result<(), Error> {
    let ask:bool=tx.query_row("SELECT NOT EXISTS(SELECT 1 FROM chat_scheduled_target_bindings b LEFT JOIN chat_sessions s ON s.id=b.conversation_id AND s.owner_user_id=b.owner_user_id AND s.tenant_id=b.tenant_id LEFT JOIN chat_projects w ON w.id=s.project_id AND w.owner_user_id=s.owner_user_id AND w.tenant_id=s.tenant_id LEFT JOIN chat_task_permissions m ON m.session_id=s.id WHERE b.plan_id=?1 AND (b.conversation_id IS NULL OR s.id IS NULL OR w.id IS NULL OR w.removed_at IS NOT NULL OR COALESCE(m.mode,'ask')!='ask' OR EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id)))",[&p.plan_id],|r|r.get(0)).map_err(|_|Error::StorageUnavailable)?;
    if !ask {
        return Err(Error::TargetUnavailable);
    }
    Ok(())
}

/// Creation or a direct switch click is the scheduling intent. Keep the existing
/// grant/receipt format so dispatch, revocation and older readers retain their
/// checks. These represent storage bounds, not a user-facing renewal period.
pub(in crate::chat::schedules) fn activate_default(
    tx: &Transaction<'_>,
    scope: &ChatScope,
    authority: &ScheduleAuthority,
    p: &mut PlanView,
    now: i64,
) -> Result<(), Error> {
    authority.require(scope, ScheduleCapability::ScheduleManage, now)?;
    authority.require(scope, ScheduleCapability::ScheduleRun, now)?;
    if !super::super::automatic::present(tx)? {
        return Err(Error::StorageDisabled);
    }
    let w = workspace(tx, scope, p)?;
    validate_automatic_target(tx, p)?;
    let clock = now.max(store::cursor_at(tx, scope, &p.plan_id).map_err(plan_error)?);
    let next = time::preview(&p.definition.rule, clock, p.effective_from).map_err(plan_error)?;
    if next.next_at.is_none() {
        return Err(Error::InvalidInput);
    }
    let gid = Uuid::now_v7().to_string();
    let request = Uuid::now_v7().to_string();
    let expires = 253402300799_i64;
    let max_runs =
        if p.definition.rule.frequency == super::super::generated::TimeRuleFrequency::Once {
            1
        } else {
            2147483647_i64
        };
    p.state = PlanState::Enabled;
    p.next_at = next.next_at;
    p.authorization_ref = Some(gid.clone());
    p.authorization_expires_at = Some(expires);
    store::write_plan(tx, scope, p, clock).map_err(plan_error)?;
    tx.execute("INSERT INTO chat_scheduled_grants(grant_id,owner_user_id,tenant_id,request_id,request_digest,plan_id,plan_revision,authorization_revision,definition_digest,workspace_source,workspace_id,max_runs,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",params![gid,scope.owner_user_id,scope.tenant_id,request,digest(&encode(&("default-enable/1", &p.plan_id, p.revision))?),p.plan_id,p.revision,authority.revision,definition_digest(p,&w)?,word(&w.source)?,w.resource_id,max_runs,expires]).map_err(|_|Error::StorageUnavailable)?;
    tx.execute("INSERT INTO chat_scheduled_enable_receipts(grant_id,format_version,automatic_consent_version) VALUES(?1,1,1)", [&gid]).map_err(|_|Error::StorageUnavailable)?;
    tx.execute(
        "UPDATE chat_scheduled_plans SET future_hold=NULL WHERE plan_id=?1",
        [&p.plan_id],
    )
    .map_err(|_| Error::StorageUnavailable)?;
    store::cancel_slots(tx, scope, &p.plan_id).map_err(plan_error)?;
    store::insert_future(tx, scope, p, next.logical_slot.as_deref(), clock).map_err(plan_error)
}
impl ScheduleExecutionService {
    pub async fn confirm_and_enable(
        &self,
        context: Uuid,
        request: GrantConfirmation,
    ) -> Result<EnableReceipt, Error> {
        let authority = self.authority.clone();
        self.manage(context, move |r, n| {
            let a = authority.schedule_authority(n)?;
            r.enable_schedule(&a, request, n)
        })
        .await
    }
    pub async fn preview_rerun(&self, original: String) -> Result<RerunPreview, Error> {
        let authority = self.authority.clone();
        self.worker
            .call(move |r| {
                Ok((|| {
                    let n = now()?;
                    authority.schedule_authority(n)?.require(
                        &r.scope,
                        ScheduleCapability::ScheduleRead,
                        n,
                    )?;
                    rerun_preview(&r.connection, &r.scope, &original)
                })())
            })
            .await
            .map_err(|_| Error::StorageUnavailable)?
    }
    pub async fn confirm_rerun(
        &self,
        context: Uuid,
        confirmation: RerunConfirmation,
        request: String,
    ) -> Result<RunView, Error> {
        let authority = self.authority.clone();
        self.manage(context, move |r, n| {
            let a = authority.schedule_authority(n)?;
            r.trigger_storage()?;
            r.prepare_trigger_local(
                &a,
                &confirmation.grant_id,
                confirmation.revision,
                &request,
                &Trigger::Rerun(confirmation.clone()),
                n,
            )
        })
        .await
    }
}

/// Interpret only known private formats. Manual history needs no new record.
pub(crate) fn validate_facts(
    db: &Connection,
    scope: &ChatScope,
    run: &RunView,
) -> Result<(), Error> {
    use super::super::execution_generated::RunTrigger;
    if run.trigger == RunTrigger::Manual {
        return Ok(());
    }
    if !present(db)? {
        return Err(Error::FormatUnsupported);
    }
    let (v,source,json):(i64,String,Option<String>)=db.query_row("SELECT format_version,trigger_source,confirmation_json FROM chat_scheduled_trigger_facts WHERE run_id=?1",[&run.run_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_|Error::FormatUnsupported)?;
    if v != 1 || source != word(&run.trigger)? {
        return Err(Error::FormatUnsupported);
    }
    if run.trigger == RunTrigger::Rerun {
        let c: RerunConfirmation = read(json.ok_or(Error::FormatUnsupported)?)?;
        let old:Option<(String,String,String)>=db.query_row("SELECT plan_id,snapshot_json,snapshot_digest FROM chat_scheduled_runs WHERE run_id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![c.original_run_id,scope.owner_user_id,scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|_|Error::StorageUnavailable)?;
        let (pid, snapshot, hash) = old.ok_or(Error::FormatUnsupported)?;
        let current: String = db
            .query_row(
                "SELECT snapshot_json FROM chat_scheduled_runs WHERE run_id=?1",
                [&run.run_id],
                |r| r.get(0),
            )
            .map_err(|_| Error::StorageUnavailable)?;
        let current: PlanView = read(current)?;
        if pid != run.plan_id
            || c.plan_id != pid
            || c.revision != run.plan_revision
            || c.grant_id != run.grant_id
            || Some(&c.original_run_id) != run.original_run_id.as_ref()
            || hash != c.original_snapshot_digest
            || digest(&snapshot) != hash
            || c.definition_digest != digest(&encode(&current.definition)?)
        {
            return Err(Error::FormatUnsupported);
        }
    } else {
        let matched:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_occurrences o JOIN chat_scheduled_trigger_facts f ON f.run_id=o.run_id WHERE o.run_id=?1 AND o.owner_user_id=?2 AND o.tenant_id=?3 AND o.plan_id=?4 AND o.schedule_epoch=?5 AND o.logical_slot=?6 AND o.scheduled_at=f.scheduled_at AND o.disposition!='planned' AND f.send_until=f.scheduled_at+60 AND f.scheduled_at>f.continuous_from)",params![run.run_id,scope.owner_user_id,scope.tenant_id,run.plan_id,run.schedule_epoch,run.logical_slot],|r|r.get(0)).map_err(|_|Error::StorageUnavailable)?;
        if !matched {
            return Err(Error::FormatUnsupported);
        }
    }
    Ok(())
}
pub(crate) fn validate_send(
    db: &Connection,
    run: &RunView,
    lifecycle: Option<&Lifecycle>,
    now: i64,
) -> Result<(), Error> {
    if run.trigger != super::super::execution_generated::RunTrigger::Automatic {
        return Ok(());
    }
    if super::super::automatic::present(db)?
        && !super::super::automatic::consent(db, &run.grant_id)?
    {
        return Err(Error::GrantMissing);
    }
    let (process,epoch,since,at):(String,i64,i64,i64)=db.query_row("SELECT process_generation,lifecycle_epoch,continuous_from,scheduled_at FROM chat_scheduled_trigger_facts WHERE run_id=?1 AND format_version=1",[&run.run_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(|_|Error::FormatUnsupported)?;
    let blocked:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_trigger_facts WHERE run_id=?1 AND send_closed_reason IS NOT NULL)",[&run.run_id],|r|r.get(0)).map_err(|_|Error::StorageUnavailable)?;
    if blocked {
        return Err(Error::ExecutionNotReady);
    }
    lifecycle
        .ok_or(Error::ExecutionNotReady)?
        .validate_ticket(
            &ContinuityTicket {
                process,
                epoch: u64::try_from(epoch).map_err(|_| Error::FormatUnsupported)?,
                since,
            },
            at,
            now,
        )
        .map_err(|_| Error::ExecutionNotReady)
}
pub(crate) fn finish_once(db: &Connection, run: &str) -> Result<(), crate::chat::error::ChatError> {
    if !present(db).map_err(|_| crate::chat::error::ChatError::DatabaseUnavailable)? {
        return Ok(());
    }
    db.execute("UPDATE chat_scheduled_plans SET state='completed' WHERE state='enabled' AND next_at IS NULL AND json_extract(rule_json,'$.frequency')='once' AND EXISTS(SELECT 1 FROM chat_scheduled_runs r WHERE r.run_id=?1 AND r.plan_id=chat_scheduled_plans.plan_id AND r.plan_revision=chat_scheduled_plans.revision AND r.schedule_epoch=chat_scheduled_plans.schedule_epoch AND r.trigger_source='automatic' AND r.delivery_state IN ('terminal','cancelled'))",[run]).map_err(|_|crate::chat::error::ChatError::DatabaseUnavailable)?;
    Ok(())
}
pub(crate) fn cancelled(
    db: &Connection,
    run: &str,
    reason: &str,
) -> Result<(), crate::chat::error::ChatError> {
    if !present(db).map_err(|_| crate::chat::error::ChatError::DatabaseUnavailable)? {
        return Ok(());
    }
    db.execute(
        "UPDATE chat_scheduled_occurrences SET disposition=?2 WHERE run_id=?1",
        params![run, reason],
    )
    .map_err(|_| crate::chat::error::ChatError::DatabaseUnavailable)?;
    finish_once(db, run)
}
#[derive(Clone, Debug)]
pub(crate) struct DueCandidate {
    slot: AutomaticSlot,
    grant: Option<String>,
    pub remote: Option<(Uuid, Uuid, Uuid)>,
}
pub(crate) const SCAN_LIMIT: usize = 32;
impl ChatRepository {
    /// Recovery is bounded and independent of unresolved Host executions.
    pub(crate) fn trigger_clock_tick(
        &mut self,
        lifecycle: &Lifecycle,
        now: i64,
    ) -> Result<Vec<DueCandidate>, crate::chat::error::ChatError> {
        use crate::chat::error::ChatError as E;
        let err = |_| E::DatabaseUnavailable;
        if !self.schedule_writes_enabled || !present(&self.connection).map_err(err)? {
            return Ok(vec![]);
        }
        if let Some(recovery) = lifecycle.clock_recovery() {
            let ids = {
                let mut q=self.connection.prepare("SELECT plan_id,revision FROM chat_scheduled_plans WHERE owner_user_id=?1 AND tenant_id=?2 AND state NOT IN ('deleted','completed') AND next_at<=?3 ORDER BY next_at,plan_id LIMIT 32").map_err(|_|E::DatabaseUnavailable)?;
                let rows = q
                    .query_map(
                        params![
                            self.scope.owner_user_id,
                            self.scope.tenant_id,
                            recovery.cutoff
                        ],
                        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
                    )
                    .map_err(|_| E::DatabaseUnavailable)?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(|_| E::DatabaseUnavailable)?;
                rows
            };
            for (id, rev) in &ids {
                self.recover_schedule_clock(id, *rev, recovery.cutoff, recovery.cause)
                    .map_err(|_| E::DatabaseUnavailable)?;
            }
            if ids.len() < SCAN_LIMIT {
                lifecycle.clocks_recovered(recovery);
            }
            return Ok(vec![]);
        }
        // Compatible readers may reconcile clocks but can never create a run.
        let Some(gate) = self.schedule_trigger_lifecycle.clone() else {
            return Ok(vec![]);
        };
        if self.schedule_dispatch_authority.is_none() {
            return Ok(vec![]);
        }
        let Ok(ticket) = gate.ticket() else {
            return Ok(vec![]);
        };
        if lifecycle.ticket().ok().as_ref() != Some(&ticket) {
            return Ok(vec![]);
        }
        let ids = {
            let mut q=self.connection.prepare("SELECT plan_id FROM chat_scheduled_plans WHERE owner_user_id=?1 AND tenant_id=?2 AND state NOT IN ('deleted','completed') AND next_at<=?3 ORDER BY next_at,plan_id LIMIT 32").map_err(|_|E::DatabaseUnavailable)?;
            let rows = q
                .query_map(
                    params![self.scope.owner_user_id, self.scope.tenant_id, now],
                    |r| r.get::<_, String>(0),
                )
                .map_err(|_| E::DatabaseUnavailable)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|_| E::DatabaseUnavailable)?;
            rows
        };
        let mut result = Vec::new();
        for id in ids {
            let p = plan(&self.connection, &self.scope, &id).map_err(err)?;
            let at = p.next_at.ok_or(E::DatabaseUnavailable)?;
            let slot:Option<String>=self.connection.query_row("SELECT logical_slot FROM chat_scheduled_occurrences WHERE plan_id=?1 AND schedule_epoch=?2 AND scheduled_at=?3 AND disposition='planned' AND run_id IS NULL",params![id,p.schedule_epoch,at],|r|r.get(0)).optional().map_err(|_|E::DatabaseUnavailable)?;
            let Some(slot) = slot else {
                // User pause cancels its planned slot. Advance this inactive cursor
                // so a page of paused plans cannot starve later due candidates.
                self.recover_schedule_clock(&id, p.revision, now, time::Continuity::Recovered)
                    .map_err(|_| E::DatabaseUnavailable)?;
                continue;
            };
            let remote:Option<(String,String,String)>=self.connection.query_row("SELECT s.agent_session_id,b.public_task_id,s.runtime_thread_id FROM chat_sessions s JOIN chat_public_task_bindings b ON b.session_id=s.id AND b.state='bound' WHERE s.id=COALESCE(?1,(SELECT conversation_id FROM chat_scheduled_target_bindings WHERE plan_id=?2)) AND s.owner_user_id=?3 AND s.tenant_id=?4 AND s.agent_session_id IS NOT NULL AND s.runtime_thread_id IS NOT NULL",params![p.definition.target.conversation_id,id,self.scope.owner_user_id,self.scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|_|E::DatabaseUnavailable)?;
            let remote = if p.state == PlanState::Enabled
                && hold(&self.connection, &self.scope, &id)
                    .map_err(err)?
                    .is_none()
                && now <= at + 60
                && !guard::held(&self.connection)?
                && !guard::foreground_busy(&self.connection)?
            {
                remote
            } else {
                None
            };
            let parse = |s: String| Uuid::parse_str(&s).map_err(|_| E::DatabaseUnavailable);
            result.push(DueCandidate {
                slot: AutomaticSlot {
                    plan: id,
                    revision: p.revision,
                    epoch: p.schedule_epoch,
                    slot,
                    at,
                    ticket: ticket.clone(),
                },
                grant: p.authorization_ref,
                remote: remote
                    .map(|(s, t, h)| Ok((parse(s)?, parse(t)?, parse(h)?)))
                    .transpose()?,
            });
        }
        Ok(result)
    }
    pub(crate) fn process_schedule_due(
        &mut self,
        c: DueCandidate,
        remote_reason: Option<&str>,
        now: i64,
    ) -> Result<(), crate::chat::error::ChatError> {
        use crate::chat::error::ChatError as E;
        let Some(authority) = self.schedule_dispatch_authority.clone() else {
            return Ok(());
        };
        let Some(lifecycle) = self.schedule_trigger_lifecycle.clone() else {
            return Ok(());
        };
        let a = authority
            .schedule_authority(now)
            .map_err(|_| E::ScopeDenied)?;
        let p = plan(&self.connection, &self.scope, &c.slot.plan)
            .map_err(|_| E::DatabaseUnavailable)?;
        if p.revision != c.slot.revision
            || p.schedule_epoch != c.slot.epoch
            || p.next_at != Some(c.slot.at)
        {
            return Ok(());
        }
        // An epoch change is reconciled by clock recovery, never interpreted as late awake work.
        if lifecycle.ticket().ok().as_ref() != Some(&c.slot.ticket) {
            return Ok(());
        }
        let h =
            hold(&self.connection, &self.scope, &p.plan_id).map_err(|_| E::DatabaseUnavailable)?;
        let reason = if c.slot.at <= c.slot.ticket.since {
            Some("missed_offline")
        } else if p.state != PlanState::Enabled {
            Some("skipped_paused")
        } else if now > c.slot.at + 60 {
            Some("missed_late")
        } else if h.is_some()
            || (super::super::automatic::present(&self.connection)
                .map_err(|_| E::DatabaseUnavailable)?
                && !p
                    .authorization_ref
                    .as_ref()
                    .map(|g| super::super::automatic::consent(&self.connection, g))
                    .transpose()
                    .map_err(|_| E::DatabaseUnavailable)?
                    .unwrap_or(false))
        {
            Some("unauthorized")
        } else if guard::held(&self.connection)? || guard::foreground_busy(&self.connection)? {
            Some("busy")
        } else {
            remote_reason
        };
        let failure = if let Some(reason) = reason {
            Some(reason)
        } else if let Some(gid) = &c.grant {
            let bytes = Sha256::digest(
                encode(&(
                    &self.scope.owner_user_id,
                    &self.scope.tenant_id,
                    &p.plan_id,
                    p.schedule_epoch,
                    &c.slot.slot,
                ))
                .map_err(|_| E::DatabaseUnavailable)?
                .as_bytes(),
            );
            let request =
                Uuid::from_bytes(bytes[..16].try_into().map_err(|_| E::DatabaseUnavailable)?)
                    .to_string();
            match self.prepare_trigger_local(
                &a,
                gid,
                p.revision,
                &request,
                &Trigger::Automatic(c.slot.clone()),
                now,
            ) {
                Ok(_) => return Ok(()),
                Err(Error::ReservationBusy) => Some("busy"),
                Err(Error::TargetUnavailable) => Some("target_unavailable"),
                Err(Error::PermissionDenied) => Some("permission_denied"),
                Err(
                    Error::GrantExpired
                    | Error::GrantExhausted
                    | Error::GrantStale
                    | Error::GrantMissing,
                ) => Some("unauthorized"),
                Err(Error::ExecutionNotReady) => {
                    if lifecycle.ticket().ok().as_ref() != Some(&c.slot.ticket) {
                        return Ok(());
                    }
                    Some("missed_late")
                }
                Err(Error::RevisionConflict | Error::RequestConflict) => return Ok(()),
                Err(_) => Some("resource_unavailable"),
            }
        } else {
            Some("unauthorized")
        };
        if let Some(reason) = failure {
            let now = now.max(super::now().map_err(|_| E::DatabaseUnavailable)?);
            let scope = self.scope.clone();
            let tx = self
                .connection
                .transaction()
                .map_err(|_| E::DatabaseUnavailable)?;
            let fresh = plan(&tx, &scope, &p.plan_id).map_err(|_| E::DatabaseUnavailable)?;
            if fresh.revision != p.revision || fresh.next_at != Some(c.slot.at) {
                return Ok(());
            }
            let changed=tx.execute("UPDATE chat_scheduled_occurrences SET disposition=?1,missed_through=?2 WHERE plan_id=?3 AND schedule_epoch=?4 AND logical_slot=?5 AND disposition='planned' AND run_id IS NULL",params![reason,now.max(c.slot.at),p.plan_id,p.schedule_epoch,c.slot.slot]).map_err(|_|E::DatabaseUnavailable)?;
            if changed == 1 {
                advance(&tx, &scope, &p, now, true).map_err(|_| E::DatabaseUnavailable)?;
                let hold = match reason {
                    "unauthorized" => Some("authorization"),
                    "target_unavailable" => Some("target"),
                    "permission_denied" => Some("permission"),
                    "resource_unavailable" => Some("resource"),
                    _ => None,
                };
                if let Some(h) = hold {
                    tx.execute("UPDATE chat_scheduled_plans SET future_hold=COALESCE(future_hold,?2) WHERE plan_id=?1",params![p.plan_id,h]).map_err(|_|E::DatabaseUnavailable)?;
                }
            }
            tx.commit().map_err(|_| E::DatabaseUnavailable)?;
        }
        Ok(())
    }
    /// At most the single currently reserved run. Never re-POST attempted operations.
    pub(crate) fn expire_automatic(
        &mut self,
        now: i64,
    ) -> Result<(), crate::chat::error::ChatError> {
        use crate::chat::error::ChatError as E;
        if !present(&self.connection).map_err(|_| E::DatabaseUnavailable)? {
            return Ok(());
        }
        let Some(authority) = self.schedule_dispatch_authority.clone() else {
            return Ok(());
        };
        let row:Option<(String,String,String,i64)>=self.connection.query_row("SELECT r.run_id,e.create_attempt,e.turn_attempt,f.scheduled_at FROM chat_scheduled_reservation v JOIN chat_scheduled_runs r ON r.run_id=v.run_id JOIN chat_scheduled_recovery e ON e.run_id=r.run_id JOIN chat_scheduled_trigger_facts f ON f.run_id=r.run_id WHERE r.trigger_source='automatic' AND e.turn_attempt='never' AND e.release_kind IS NULL",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(|_|E::DatabaseUnavailable)?;
        let Some((id, create, _, at)) = row else {
            return Ok(());
        };
        let run =
            read_run(&self.connection, &self.scope, &id).map_err(|_| E::DatabaseUnavailable)?;
        let time_bad = validate_send(
            &self.connection,
            &run,
            self.schedule_trigger_lifecycle.as_ref(),
            now,
        )
        .is_err();
        let g = grant(&self.connection, &self.scope, &run.grant_id, now)
            .map_err(|_| E::DatabaseUnavailable)?;
        let auth_bad = matches!(g.state, GrantState::Expired | GrantState::Stale);
        if !time_bad && !auth_bad {
            return Ok(());
        }
        let reason = if auth_bad {
            "unauthorized"
        } else if now > at + 60 {
            "missed_late"
        } else {
            "missed_offline"
        };
        if matches!(create.as_str(), "never" | "not_required") {
            let a = authority
                .schedule_authority(now)
                .map_err(|_| E::ScopeDenied)?;
            self.cancel_unsent_schedule_reason(&a, &id, now, reason)
        } else {
            let tx = self
                .connection
                .transaction()
                .map_err(|_| E::DatabaseUnavailable)?;
            tx.execute(
                "UPDATE chat_scheduled_runs SET needs_attention=1 WHERE run_id=?1",
                [&id],
            )
            .map_err(|_| E::DatabaseUnavailable)?;
            tx.execute(
                "UPDATE chat_scheduled_recovery SET turn_error_code=?2 WHERE run_id=?1",
                params![id, reason],
            )
            .map_err(|_| E::DatabaseUnavailable)?;
            tx.execute("UPDATE chat_scheduled_trigger_facts SET send_closed_reason=COALESCE(send_closed_reason,?2) WHERE run_id=?1",params![id,reason]).map_err(|_|E::DatabaseUnavailable)?;
            hold_unknown(&tx, &id)?;
            tx.commit().map_err(|_| E::DatabaseUnavailable)
        }
    }
}

impl ChatRepository {
    pub(crate) fn automatic_busy(
        &mut self,
        run: &str,
        now: i64,
    ) -> Result<(), crate::chat::error::ChatError> {
        use crate::chat::error::ChatError as E;
        if !present(&self.connection).map_err(|_| E::DatabaseUnavailable)? {
            return Ok(());
        }
        let row:Option<(String,String)>=self.connection.query_row("SELECT e.create_attempt,e.turn_attempt FROM chat_scheduled_runs r JOIN chat_scheduled_recovery e ON e.run_id=r.run_id WHERE r.run_id=?1 AND r.trigger_source='automatic' AND e.release_kind IS NULL",[run],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|_|E::DatabaseUnavailable)?;
        let Some((create, turn)) = row else {
            return Ok(());
        };
        if turn != "never" {
            return Ok(());
        }
        if matches!(create.as_str(), "never" | "not_required") {
            let a = self
                .schedule_dispatch_authority
                .as_ref()
                .ok_or(E::ScopeDenied)?
                .schedule_authority(now)
                .map_err(|_| E::ScopeDenied)?;
            self.cancel_unsent_schedule_reason(&a, run, now, "busy")
        } else {
            let tx = self
                .connection
                .transaction()
                .map_err(|_| E::DatabaseUnavailable)?;
            tx.execute(
                "UPDATE chat_scheduled_recovery SET turn_error_code='busy' WHERE run_id=?1",
                [run],
            )
            .map_err(|_| E::DatabaseUnavailable)?;
            tx.execute(
                "UPDATE chat_scheduled_runs SET needs_attention=1 WHERE run_id=?1",
                [run],
            )
            .map_err(|_| E::DatabaseUnavailable)?;
            tx.execute("UPDATE chat_scheduled_trigger_facts SET send_closed_reason=COALESCE(send_closed_reason,'busy') WHERE run_id=?1",[run]).map_err(|_|E::DatabaseUnavailable)?;
            hold_unknown(&tx, run)?;
            tx.commit().map_err(|_| E::DatabaseUnavailable)
        }
    }
}
