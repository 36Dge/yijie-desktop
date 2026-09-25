use super::generated::{
    PlanDefinition, PlanState, PlanView, SavePlanRequest, ScheduleErrorCode as Error, TargetMode,
    TargetReference, TargetState, TimeRuleFrequency,
};
use super::time::{self, Continuity, RULE_VERSION};
use crate::chat::database::{ChatRepository, ChatScope};
use crate::chat::error::ChatError;
use crate::chat::migrations::SCHEDULE_SCHEMA_VERSION;
use crate::chat::worker::DatabaseWorker;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScheduleStorageMode {
    CompatibleReader,
    PlanWriter,
    /// Native candidate only; ordinary app startup never selects this mode.
    ExecutionFoundation,
    /// Local preparation only. No ordinary launcher or renderer selects it.
    LocalPreparation,
    /// Recovery candidate only; does not enable scheduled dispatch.
    RecoveryFoundation,
    /// Dispatch-compatible writer; sending still needs a separate native authority.
    DispatchFoundation,
    /// Explicit native automatic/rerun candidate; never selected by ordinary startup.
    TriggerFoundation,
    /// Explicit draft producer/confirmation candidate; ordinary startup stays 15.
    DraftFoundation,
    ManagementFoundation,
    /// Explicit finite automatic consent; never selected by the ordinary entry.
    AutomaticFoundation,
    /// Explicit single-run purpose; ordinary startup remains unchanged.
    SingleRunFoundation,
    TimingFoundation,
}

pub(super) enum StateError {
    Plan(Error),
    Busy,
}
impl From<Error> for StateError {
    fn from(e: Error) -> Self {
        Self::Plan(e)
    }
}
impl StateError {
    fn legacy(self) -> Error {
        match self {
            Self::Plan(e) => e,
            Self::Busy => Error::ExecutionNotReady,
        }
    }
    pub(super) fn execution(self) -> super::execution_generated::ExecutionErrorCode {
        match self {
            Self::Plan(e) => super::execution::plan_error(e),
            Self::Busy => super::execution_generated::ExecutionErrorCode::ReservationBusy,
        }
    }
}

fn valid_id(value: &str) -> Result<(), Error> {
    let id = Uuid::parse_str(value).map_err(|_| Error::InvalidInput)?;
    if id.is_nil() || id.to_string() != value {
        return Err(Error::InvalidInput);
    }
    Ok(())
}
fn encode<T: Serialize>(value: &T) -> Result<String, Error> {
    serde_json::to_string(value).map_err(|_| Error::StorageUnavailable)
}
fn word<T: Serialize>(value: &T) -> Result<String, Error> {
    serde_json::to_value(value)
        .map_err(|_| Error::StorageUnavailable)?
        .as_str()
        .map(str::to_owned)
        .ok_or(Error::StorageUnavailable)
}
fn decode<T: DeserializeOwned>(value: String) -> rusqlite::Result<T> {
    serde_json::from_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })
}
fn decode_word<T: DeserializeOwned>(value: String) -> rusqlite::Result<T> {
    serde_json::from_value(serde_json::Value::String(value)).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })
}
pub(super) fn read_plan(
    connection: &Connection,
    scope: &ChatScope,
    id: &str,
) -> Result<PlanView, Error> {
    let plan = connection.query_row(
        "SELECT plan_id,revision,schedule_epoch,name,content,rule_json,target_mode,conversation_id,target_state,state,effective_from,next_at,rule_version,tzdb_version,authorization_ref,authorization_expires_at FROM chat_scheduled_plans WHERE plan_id=?1 AND owner_user_id=?2 AND tenant_id=?3",
        params![id, scope.owner_user_id, scope.tenant_id], |row| Ok(PlanView {
            plan_id:row.get(0)?,revision:row.get(1)?,schedule_epoch:row.get(2)?,
            definition:PlanDefinition {name:row.get(3)?,content:row.get(4)?,rule:decode(row.get(5)?)?,target:TargetReference {mode:decode_word(row.get(6)?)?,conversation_id:row.get(7)?}},
            target_state:decode_word(row.get(8)?)?,state:decode_word(row.get(9)?)?,effective_from:row.get(10)?,next_at:row.get(11)?,rule_version:row.get(12)?,tzdb_version:row.get(13)?,authorization_ref:row.get(14)?,authorization_expires_at:row.get(15)?,
        })).optional().map_err(|_| Error::StorageUnavailable)?.ok_or(Error::NotFound)?;
    if plan.rule_version != RULE_VERSION || plan.tzdb_version != chrono_tz::IANA_TZDB_VERSION {
        return Err(Error::RuleVersionUnsupported);
    }
    time::validate_rule(&plan.definition.rule).map_err(|_| Error::StorageUnavailable)?;
    if plan.revision < 1
        || plan.schedule_epoch < 1
        || plan.next_at.is_some_and(|next| next < plan.effective_from)
    {
        return Err(Error::StorageUnavailable);
    }
    Ok(plan)
}
fn next_revision(value: i64) -> Result<i64, Error> {
    value.checked_add(1).ok_or(Error::StorageUnavailable)
}
fn normalize(definition: &mut PlanDefinition) -> Result<(), Error> {
    definition.name = definition.name.trim().to_owned();
    definition.content = definition.content.trim().to_owned();
    if !(1..=80).contains(&definition.name.chars().count())
        || !(1..=10000).contains(&definition.content.chars().count())
    {
        return Err(Error::InvalidInput);
    }
    time::validate_rule(&definition.rule)?;
    if let Some(days) = &mut definition.rule.weekdays {
        days.sort_unstable();
    }
    match definition.target.mode {
        TargetMode::ExistingChat => valid_id(
            definition
                .target
                .conversation_id
                .as_deref()
                .ok_or(Error::InvalidInput)?,
        )?,
        _ if definition.target.conversation_id.is_some() => return Err(Error::InvalidInput),
        _ => {}
    }
    Ok(())
}
fn validate_target(
    tx: &Transaction<'_>,
    scope: &ChatScope,
    target: &TargetReference,
) -> Result<TargetState, Error> {
    let Some(id) = &target.conversation_id else {
        return Ok(TargetState::Unbound);
    };
    if super::drafts::is_draft(tx, scope, id).map_err(|_| Error::StorageUnavailable)? {
        return Err(Error::TargetUnavailable);
    }
    let available: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_sessions s JOIN chat_projects p ON p.id=s.project_id AND p.owner_user_id=s.owner_user_id AND p.tenant_id=s.tenant_id WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3 AND p.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id))",params![id,scope.owner_user_id,scope.tenant_id], |row|row.get(0)).map_err(|_|Error::StorageUnavailable)?;
    if !available {
        return Err(Error::TargetUnavailable);
    }
    Ok(TargetState::Ready)
}
pub(super) fn write_plan(
    tx: &Transaction<'_>,
    scope: &ChatScope,
    plan: &PlanView,
    cursor: i64,
) -> Result<(), Error> {
    tx.execute("INSERT INTO chat_scheduled_plans(plan_id,owner_user_id,tenant_id,revision,schedule_epoch,name,content,rule_json,rule_version,tzdb_version,target_mode,conversation_id,target_state,state,effective_from,next_at,cursor_at,authorization_ref,authorization_expires_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)
        ON CONFLICT(plan_id) DO UPDATE SET revision=excluded.revision,schedule_epoch=excluded.schedule_epoch,name=excluded.name,content=excluded.content,rule_json=excluded.rule_json,rule_version=excluded.rule_version,tzdb_version=excluded.tzdb_version,target_mode=excluded.target_mode,conversation_id=excluded.conversation_id,target_state=excluded.target_state,state=excluded.state,effective_from=excluded.effective_from,next_at=excluded.next_at,cursor_at=excluded.cursor_at,authorization_ref=excluded.authorization_ref,authorization_expires_at=excluded.authorization_expires_at
        WHERE chat_scheduled_plans.owner_user_id=excluded.owner_user_id AND chat_scheduled_plans.tenant_id=excluded.tenant_id",
        params![plan.plan_id,scope.owner_user_id,scope.tenant_id,plan.revision,plan.schedule_epoch,plan.definition.name,plan.definition.content,encode(&plan.definition.rule)?,plan.rule_version,plan.tzdb_version,word(&plan.definition.target.mode)?,plan.definition.target.conversation_id,word(&plan.target_state)?,word(&plan.state)?,plan.effective_from,plan.next_at,cursor,plan.authorization_ref,plan.authorization_expires_at]).map_err(|_|Error::StorageUnavailable)?;
    Ok(())
}
pub(super) fn cancel_slots(tx: &Transaction<'_>, scope: &ChatScope, id: &str) -> Result<(), Error> {
    tx.execute("UPDATE chat_scheduled_occurrences SET disposition='cancelled' WHERE plan_id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND disposition='planned'",params![id,scope.owner_user_id,scope.tenant_id]).map_err(|_|Error::StorageUnavailable)?;
    Ok(())
}
pub(super) fn insert_future(
    tx: &Transaction<'_>,
    scope: &ChatScope,
    plan: &PlanView,
    slot: Option<&str>,
    now: i64,
) -> Result<(), Error> {
    if let (Some(at), Some(slot)) = (plan.next_at, slot) {
        let consumed = tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='chat_scheduled_trigger_facts')", [], |r|r.get::<_,bool>(0)).map_err(|_|Error::StorageUnavailable)?;
        if consumed && tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_occurrences WHERE owner_user_id=?1 AND tenant_id=?2 AND plan_id=?3 AND schedule_epoch=?4 AND logical_slot=?5 AND run_id IS NOT NULL)", params![scope.owner_user_id,scope.tenant_id,plan.plan_id,plan.schedule_epoch,slot], |r|r.get::<_,bool>(0)).map_err(|_|Error::StorageUnavailable)? { return Ok(()); }

        tx.execute("INSERT INTO chat_scheduled_occurrences(owner_user_id,tenant_id,plan_id,schedule_epoch,logical_slot,scheduled_at,disposition) VALUES(?1,?2,?3,?4,?5,?6,'planned')
            ON CONFLICT(owner_user_id,tenant_id,plan_id,schedule_epoch,logical_slot) DO UPDATE SET disposition='planned',missed_through=NULL
            WHERE chat_scheduled_occurrences.disposition='cancelled' AND excluded.scheduled_at>?7",
            params![scope.owner_user_id,scope.tenant_id,plan.plan_id,plan.schedule_epoch,slot,at,now]).map_err(|_|Error::StorageUnavailable)?;
    }
    Ok(())
}
pub(super) fn cursor_at(
    connection: &Connection,
    scope: &ChatScope,
    id: &str,
) -> Result<i64, Error> {
    connection.query_row("SELECT cursor_at FROM chat_scheduled_plans WHERE plan_id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![id,scope.owner_user_id,scope.tenant_id], |row|row.get(0)).map_err(|_|Error::StorageUnavailable)
}

impl ChatRepository {
    pub(super) fn save_active_schedule(
        &mut self,
        authority: &super::ScheduleAuthority,
        request: SavePlanRequest,
        now: i64,
    ) -> Result<PlanView, super::execution_generated::ExecutionErrorCode> {
        use super::execution::plan_error;
        self.schedule_writable().map_err(plan_error)?;
        let deadline = self.schedule_ui_deadline;
        let tx = self
            .connection
            .transaction()
            .map_err(|_| super::execution_generated::ExecutionErrorCode::StorageUnavailable)?;
        let plan = save_active_in_transaction(&tx, &self.scope, authority, request, now)?;
        super::ipc::commit_deadline(deadline)?;
        tx.commit()
            .map_err(|_| super::execution_generated::ExecutionErrorCode::StorageUnavailable)?;
        Ok(plan)
    }

    pub(super) fn enable_default_schedule(
        &mut self,
        authority: &super::ScheduleAuthority,
        input: super::ipc_generated::PlanMutation,
        request: &str,
        now: i64,
    ) -> Result<PlanView, super::execution_generated::ExecutionErrorCode> {
        use super::execution::plan_error;
        use super::execution_generated::ExecutionErrorCode as E;
        self.schedule_writable().map_err(plan_error)?;
        let deadline = self.schedule_ui_deadline;
        let tx = self
            .connection
            .transaction()
            .map_err(|_| E::StorageUnavailable)?;
        let hash = format!(
            "{:x}",
            Sha256::digest(
                encode(&("default-enable/1", &input.plan_id, input.expected_revision))
                    .map_err(plan_error)?
                    .as_bytes()
            )
        );
        let prior: Option<(String, String)> = tx.query_row("SELECT request_digest,plan_id FROM chat_scheduled_requests WHERE owner_user_id=?1 AND tenant_id=?2 AND request_id=?3", params![self.scope.owner_user_id,self.scope.tenant_id,request], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|_| E::StorageUnavailable)?;
        if let Some((old, id)) = prior {
            if old != hash || id != input.plan_id {
                return Err(E::RequestConflict);
            }
            return read_plan(&tx, &self.scope, &id).map_err(plan_error);
        }
        let mut plan = read_plan(&tx, &self.scope, &input.plan_id).map_err(plan_error)?;
        if plan.state == PlanState::Deleted {
            return Err(E::NotFound);
        }
        if plan.revision != input.expected_revision {
            return Err(E::RevisionConflict);
        }
        // An unresolved run must be reconciled before future dispatch resumes.
        if super::execution_guard::plan_held(&tx, &self.scope, &plan.plan_id)
            .map_err(|_| E::StorageUnavailable)?
        {
            return Err(E::ReservationBusy);
        }
        plan.revision = next_revision(plan.revision).map_err(plan_error)?;
        super::triggers::activate_default(&tx, &self.scope, authority, &mut plan, now)?;
        tx.execute("INSERT INTO chat_scheduled_requests(owner_user_id,tenant_id,request_id,request_digest,plan_id) VALUES(?1,?2,?3,?4,?5)", params![self.scope.owner_user_id,self.scope.tenant_id,request,hash,plan.plan_id]).map_err(|_| E::StorageUnavailable)?;
        super::ipc::commit_deadline(deadline)?;
        tx.commit().map_err(|_| E::StorageUnavailable)?;
        Ok(plan)
    }

    fn schedule_readable(&self) -> Result<(), Error> {
        if self
            .schema_version()
            .map_err(|_| Error::StorageUnavailable)?
            < SCHEDULE_SCHEMA_VERSION
        {
            return Err(Error::StorageDisabled);
        }
        Ok(())
    }
    pub(super) fn schedule_writable(&self) -> Result<(), Error> {
        self.schedule_readable()?;
        if !self.schedule_writes_enabled {
            return Err(Error::StorageDisabled);
        }
        Ok(())
    }
    pub fn save_schedule(&mut self, request: SavePlanRequest, now: i64) -> Result<PlanView, Error> {
        self.schedule_writable()?;
        let deadline = self.schedule_ui_deadline;
        let scope = self.scope.clone();
        let tx = self
            .connection
            .transaction()
            .map_err(|_| Error::StorageUnavailable)?;
        let plan = save_in_transaction(&tx, &scope, request, now)?;
        super::ipc::commit_deadline(deadline).map_err(|_| Error::ExecutionNotReady)?;
        tx.commit().map_err(|_| Error::StorageUnavailable)?;
        Ok(plan)
    }
    pub fn read_schedule(&self, id: &str) -> Result<PlanView, Error> {
        self.schedule_readable()?;
        valid_id(id)?;
        let plan = read_plan(&self.connection, &self.scope, id)?;
        if plan.state == PlanState::Deleted {
            return Err(Error::NotFound);
        }
        Ok(plan)
    }
    pub fn list_schedules(&self) -> Result<Vec<PlanView>, Error> {
        self.schedule_readable()?;
        let mut statement = self.connection.prepare("SELECT plan_id FROM chat_scheduled_plans WHERE owner_user_id=?1 AND tenant_id=?2 AND state!='deleted' ORDER BY plan_id").map_err(|_|Error::StorageUnavailable)?;
        let ids = statement
            .query_map(
                params![self.scope.owner_user_id, self.scope.tenant_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|_| Error::StorageUnavailable)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| Error::StorageUnavailable)?;
        ids.iter()
            .map(|id| read_plan(&self.connection, &self.scope, id))
            .collect()
    }
    pub fn pause_schedule(&mut self, id: &str, revision: i64) -> Result<PlanView, Error> {
        self.change_schedule_state(id, revision, false, None)
            .map_err(StateError::legacy)
    }
    pub fn delete_schedule(&mut self, id: &str, revision: i64) -> Result<PlanView, Error> {
        self.change_schedule_state(id, revision, true, None)
            .map_err(StateError::legacy)
    }
    pub(super) fn change_schedule_state(
        &mut self,
        id: &str,
        expected_revision: i64,
        delete: bool,
        request: Option<&str>,
    ) -> Result<PlanView, StateError> {
        self.schedule_writable()?;
        valid_id(id)?;
        if expected_revision < 1 {
            return Err(Error::InvalidInput.into());
        }
        if let Some(request) = request {
            valid_id(request)?;
        }
        let hash = format!(
            "{:x}",
            Sha256::digest(
                encode(&(
                    if delete { "delete/1" } else { "pause/1" },
                    id,
                    expected_revision
                ))?
                .as_bytes()
            )
        );
        let deadline = self.schedule_ui_deadline;
        let scope = self.scope.clone();
        let tx = self
            .connection
            .transaction()
            .map_err(|_| Error::StorageUnavailable)?;
        if let Some(request) = request {
            let prior: Option<(String,String)> = tx.query_row(
                "SELECT request_digest,plan_id FROM chat_scheduled_requests WHERE owner_user_id=?1 AND tenant_id=?2 AND request_id=?3",
                params![scope.owner_user_id,scope.tenant_id,request], |r| Ok((r.get(0)?,r.get(1)?)))
                .optional().map_err(|_| Error::StorageUnavailable)?;
            if let Some((old, pid)) = prior {
                if old != hash || pid != id {
                    return Err(Error::RequestConflict.into());
                }
                return Ok(read_plan(&tx, &scope, id)?);
            }
        }
        let mut plan = read_plan(&tx, &scope, id)?;
        if plan.state == PlanState::Deleted && !delete {
            return Err(Error::NotFound.into());
        }
        if plan.state != PlanState::Deleted && plan.revision != expected_revision {
            return Err(Error::RevisionConflict.into());
        }
        // Same transaction and same plan, including legacy callers. Never release or
        // cancel a run to make deletion succeed.
        if delete
            && super::execution_guard::plan_held(&tx, &scope, id)
                .map_err(|_| Error::StorageUnavailable)?
        {
            return Err(StateError::Busy);
        }
        let desired = if delete {
            PlanState::Deleted
        } else {
            PlanState::Paused
        };
        if plan.state != desired {
            plan.state = desired;
            plan.revision = next_revision(plan.revision)?;
            plan.authorization_ref = None;
            plan.authorization_expires_at = None;
            if delete {
                plan.definition.target.conversation_id = None;
                plan.target_state = TargetState::Missing;
                plan.next_at = None;
            }
            let cursor = cursor_at(&tx, &scope, id)?;
            write_plan(&tx, &scope, &plan, cursor)?;
            cancel_slots(&tx, &scope, id)?;
        }
        if let Some(request) = request {
            tx.execute("INSERT INTO chat_scheduled_requests(owner_user_id,tenant_id,request_id,request_digest,plan_id) VALUES(?1,?2,?3,?4,?5)",params![scope.owner_user_id,scope.tenant_id,request,hash,id]).map_err(|_| Error::StorageUnavailable)?;
        }
        super::ipc::commit_deadline(deadline).map_err(|_| Error::ExecutionNotReady)?;
        tx.commit().map_err(|_| Error::StorageUnavailable)?;
        Ok(plan)
    }
    /// Explicit recovery calculation, not a scanner or claim. One missed interval
    /// is stored, even after years offline. Continuous-awake dispatch is phase 3.
    pub fn recover_schedule_clock(
        &mut self,
        id: &str,
        expected_revision: i64,
        now: i64,
        continuity: Continuity,
    ) -> Result<PlanView, Error> {
        self.schedule_writable()?;
        valid_id(id)?;
        time::validate_instant(now)?;
        if continuity == Continuity::ContinuousAwake {
            return Err(Error::ExecutionNotReady);
        }
        let scope = self.scope.clone();
        let tx = self
            .connection
            .transaction()
            .map_err(|_| Error::StorageUnavailable)?;
        let mut plan = read_plan(&tx, &scope, id)?;
        if plan.state == PlanState::Deleted {
            return Err(Error::NotFound);
        }
        if plan.revision != expected_revision {
            return Err(Error::RevisionConflict);
        }
        let cursor = cursor_at(&tx, &scope, id)?;
        if now <= cursor {
            return Ok(plan);
        }
        if let Some(next) = plan.next_at.filter(|next| *next <= now) {
            let reason = if plan.state == PlanState::Paused {
                "skipped_paused"
            } else if continuity == Continuity::Recovered {
                "missed_offline"
            } else {
                "clock_discontinuity"
            };
            tx.execute("UPDATE chat_scheduled_occurrences SET disposition=?1,missed_through=?2 WHERE plan_id=?3 AND owner_user_id=?4 AND tenant_id=?5 AND schedule_epoch=?6 AND scheduled_at=?7 AND disposition='planned'",params![reason,now,id,scope.owner_user_id,scope.tenant_id,plan.schedule_epoch,next]).map_err(|_|Error::StorageUnavailable)?;
        }
        let next = time::preview(&plan.definition.rule, now, plan.effective_from)?;
        let missed = plan.next_at.is_some_and(|at| at <= now);
        plan.next_at = next.next_at;
        if super::triggers::present(&tx).map_err(|_| Error::StorageUnavailable)?
            && missed
            && plan.state == PlanState::Enabled
            && plan.next_at.is_none()
        {
            plan.state = PlanState::Completed;
        }
        write_plan(&tx, &scope, &plan, now)?;
        insert_future(&tx, &scope, &plan, next.logical_slot.as_deref(), now)?;
        tx.commit().map_err(|_| Error::StorageUnavailable)?;
        Ok(plan)
    }
}

/// Also runs for a compatible v16 reader doing an ordinary Chat deletion. This
/// is safety maintenance, not plan activation. All updates share that deletion TX.
pub(in crate::chat) fn invalidate_targets(
    tx: &Transaction<'_>,
    scope: &ChatScope,
    session_id: &str,
) -> Result<(), ChatError> {
    let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='chat_scheduled_plans' AND type='table')",[],|row|row.get(0)).map_err(|_|ChatError::DatabaseUnavailable)?;
    if !exists {
        return Ok(());
    }
    if super::workspace::present(tx)? {
        super::workspace::guard_deletion(tx, scope, session_id)?;
        tx.execute("UPDATE chat_scheduled_occurrences SET disposition='cancelled' WHERE disposition='planned' AND owner_user_id=?2 AND tenant_id=?3 AND plan_id IN(SELECT plan_id FROM chat_scheduled_target_bindings WHERE conversation_id=?1 AND owner_user_id=?2 AND tenant_id=?3)",params![session_id,scope.owner_user_id,scope.tenant_id]).map_err(|_|ChatError::DatabaseUnavailable)?;
        tx.execute("UPDATE chat_scheduled_plans SET target_state='missing',state='paused',revision=revision+1,next_at=NULL,authorization_ref=NULL,authorization_expires_at=NULL WHERE owner_user_id=?2 AND tenant_id=?3 AND target_mode='dedicated_chat' AND state!='deleted' AND plan_id IN(SELECT plan_id FROM chat_scheduled_target_bindings WHERE conversation_id=?1 AND owner_user_id=?2 AND tenant_id=?3)",params![session_id,scope.owner_user_id,scope.tenant_id]).map_err(|_|ChatError::DatabaseUnavailable)?;
        tx.execute("UPDATE chat_scheduled_target_bindings SET conversation_id=NULL WHERE conversation_id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![session_id,scope.owner_user_id,scope.tenant_id]).map_err(|_|ChatError::DatabaseUnavailable)?;
        tx.execute("UPDATE chat_scheduled_run_bindings SET conversation_id=NULL,target_deleted=1 WHERE conversation_id=?1 AND run_id IN(SELECT run_id FROM chat_scheduled_runs WHERE owner_user_id=?2 AND tenant_id=?3)",params![session_id,scope.owner_user_id,scope.tenant_id]).map_err(|_|ChatError::DatabaseUnavailable)?;
    }
    tx.execute("UPDATE chat_scheduled_occurrences SET disposition='cancelled' WHERE disposition='planned' AND owner_user_id=?2 AND tenant_id=?3 AND plan_id IN(SELECT plan_id FROM chat_scheduled_plans WHERE conversation_id=?1 AND owner_user_id=?2 AND tenant_id=?3)",params![session_id,scope.owner_user_id,scope.tenant_id]).map_err(|_|ChatError::DatabaseUnavailable)?;
    tx.execute("UPDATE chat_scheduled_plans SET conversation_id=NULL,target_state='missing',state='paused',revision=revision+1,next_at=NULL,authorization_ref=NULL,authorization_expires_at=NULL WHERE conversation_id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND target_mode IN('existing_chat','dedicated_chat') AND state!='deleted'",params![session_id,scope.owner_user_id,scope.tenant_id]).map_err(|_|ChatError::DatabaseUnavailable)?;
    Ok(())
}

/// Uses the existing worker's single connection/queue. No second database owner.
#[derive(Clone)]
pub struct ScheduleService {
    worker: DatabaseWorker,
}
impl ScheduleService {
    pub fn new(worker: DatabaseWorker) -> Self {
        Self { worker }
    }
    pub async fn save(&self, request: SavePlanRequest, now: i64) -> Result<PlanView, Error> {
        self.worker
            .call(move |repo| Ok(repo.save_schedule(request, now)))
            .await
            .map_err(|_| Error::StorageUnavailable)?
    }
    pub async fn get(&self, id: String) -> Result<PlanView, Error> {
        self.worker
            .call(move |repo| Ok(repo.read_schedule(&id)))
            .await
            .map_err(|_| Error::StorageUnavailable)?
    }
    pub async fn list(&self) -> Result<Vec<PlanView>, Error> {
        self.worker
            .call(move |repo| Ok(repo.list_schedules()))
            .await
            .map_err(|_| Error::StorageUnavailable)?
    }
    pub async fn pause(&self, id: String, revision: i64) -> Result<PlanView, Error> {
        self.worker
            .call(move |repo| Ok(repo.pause_schedule(&id, revision)))
            .await
            .map_err(|_| Error::StorageUnavailable)?
    }
    pub async fn delete(&self, id: String, revision: i64) -> Result<PlanView, Error> {
        self.worker
            .call(move |repo| Ok(repo.delete_schedule(&id, revision)))
            .await
            .map_err(|_| Error::StorageUnavailable)?
    }
    pub async fn recover_clock(
        &self,
        id: String,
        revision: i64,
        now: i64,
        continuity: Continuity,
    ) -> Result<PlanView, Error> {
        self.worker
            .call(move |repo| Ok(repo.recover_schedule_clock(&id, revision, now, continuity)))
            .await
            .map_err(|_| Error::StorageUnavailable)?
    }
}

pub(super) fn save_active_in_transaction(
    tx: &Transaction<'_>,
    scope: &ChatScope,
    authority: &super::ScheduleAuthority,
    request: SavePlanRequest,
    now: i64,
) -> Result<PlanView, super::execution_generated::ExecutionErrorCode> {
    use super::execution::plan_error;
    use super::execution_generated::ExecutionErrorCode as E;
    let replay: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_requests WHERE owner_user_id=?1 AND tenant_id=?2 AND request_id=?3)", params![scope.owner_user_id,scope.tenant_id,request.request_id], |r| r.get(0)).map_err(|_| E::StorageUnavailable)?;
    let active = match request.plan_id.as_deref() {
        None => true,
        Some(id) => read_plan(tx, scope, id).map_err(plan_error)?.state == PlanState::Enabled,
    };
    let mut plan = save_in_transaction(tx, scope, request, now).map_err(plan_error)?;
    if active && !replay {
        if super::execution_guard::plan_held(tx, scope, &plan.plan_id)
            .map_err(|_| E::StorageUnavailable)?
        {
            return Err(E::ReservationBusy);
        }
        super::triggers::activate_default(tx, scope, authority, &mut plan, now)?;
    }
    Ok(plan)
}

pub(super) fn save_in_transaction(
    tx: &Transaction<'_>,
    scope: &ChatScope,
    mut request: SavePlanRequest,
    now: i64,
) -> Result<PlanView, Error> {
    time::validate_instant(now)?;
    valid_id(&request.request_id)?;
    if request.plan_id.is_some() != request.expected_revision.is_some()
        || request
            .expected_revision
            .is_some_and(|revision| revision < 1)
    {
        return Err(Error::InvalidInput);
    }
    if let Some(id) = &request.plan_id {
        valid_id(id)?;
    }
    normalize(&mut request.definition)?;
    let digest = format!("{:x}", Sha256::digest(encode(&request)?.as_bytes()));
    let receipt: Option<(String,String)> = tx.query_row("SELECT plan_id,request_digest FROM chat_scheduled_requests WHERE owner_user_id=?1 AND tenant_id=?2 AND request_id=?3",params![scope.owner_user_id,scope.tenant_id,request.request_id],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(|_|Error::StorageUnavailable)?;
    if let Some((id, previous_digest)) = receipt {
        if previous_digest != digest {
            return Err(Error::RequestConflict);
        }
        return read_plan(tx, scope, &id); // Current view; no replay mutation/resurrection.
    }
    let prior = request
        .plan_id
        .as_deref()
        .map(|id| read_plan(tx, scope, id))
        .transpose()?;
    if let Some(plan) = &prior {
        if plan.state == PlanState::Deleted {
            return Err(Error::NotFound);
        }
        if request.expected_revision != Some(plan.revision) {
            return Err(Error::RevisionConflict);
        }
    }
    let target_state = validate_target(tx, scope, &request.definition.target)?;
    let clock = match &prior {
        Some(plan) => now.max(cursor_at(tx, scope, &plan.plan_id)?),
        None => now,
    };
    let rule_changed = prior
        .as_ref()
        .is_none_or(|plan| plan.definition.rule != request.definition.rule);
    let effective = if rule_changed {
        clock
    } else {
        prior
            .as_ref()
            .ok_or(Error::StorageUnavailable)?
            .effective_from
    };
    let preview = time::preview(&request.definition.rule, clock, effective)?;
    if rule_changed
        && request.definition.rule.frequency == TimeRuleFrequency::Once
        && preview.next_at.is_none()
    {
        return Err(Error::InvalidInput);
    }
    let plan = PlanView {
        plan_id: prior
            .as_ref()
            .map_or_else(|| Uuid::now_v7().to_string(), |p| p.plan_id.clone()),
        revision: prior
            .as_ref()
            .map_or(Ok(1), |p| next_revision(p.revision))?,
        schedule_epoch: prior.as_ref().map_or(Ok(1), |p| {
            if rule_changed {
                next_revision(p.schedule_epoch)
            } else {
                Ok(p.schedule_epoch)
            }
        })?,
        definition: request.definition,
        state: PlanState::Paused,
        target_state,
        effective_from: effective,
        next_at: preview.next_at,
        rule_version: RULE_VERSION,
        tzdb_version: chrono_tz::IANA_TZDB_VERSION.to_owned(),
        authorization_ref: None,
        authorization_expires_at: None,
    };
    write_plan(tx, scope, &plan, clock)?;
    if prior.is_none()
        && tx
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .map_err(|_| Error::StorageUnavailable)?
            >= 23
    {
        tx.execute("UPDATE chat_scheduled_plans SET created_at=?1 WHERE plan_id=?2 AND owner_user_id=?3 AND tenant_id=?4", params![now,plan.plan_id,scope.owner_user_id,scope.tenant_id]).map_err(|_| Error::StorageUnavailable)?;
    }
    cancel_slots(tx, scope, &plan.plan_id)?;
    insert_future(tx, scope, &plan, preview.logical_slot.as_deref(), clock)?;
    tx.execute("INSERT INTO chat_scheduled_requests(owner_user_id,tenant_id,request_id,request_digest,plan_id) VALUES(?1,?2,?3,?4,?5)",params![scope.owner_user_id,scope.tenant_id,request.request_id,digest,plan.plan_id]).map_err(|_|Error::StorageUnavailable)?;
    Ok(plan)
}

pub(super) fn normalized_definition(
    mut definition: PlanDefinition,
) -> Result<PlanDefinition, Error> {
    normalize(&mut definition)?;
    Ok(definition)
}
