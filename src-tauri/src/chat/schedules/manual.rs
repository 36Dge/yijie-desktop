//! Current-process manual admission. Durable receipts never recreate permission.
use super::{
    draft_runtime::Action, execution, execution_generated as run, generated::PlanState,
    ipc_generated as wire, ScheduleAuthority,
};
use crate::chat::{
    database::{ChatRepository, ChatScope},
    error::ChatError,
    lifecycle::Lifecycle,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Clone)]
struct Permit {
    action: Action,
    host: String,
    grant: String,
    expires: i64,
}
#[derive(Default)]
pub(crate) struct NativeState {
    pub enabled: bool,
    pub lifecycle: Option<Lifecycle>,
    pub host: Option<(String, u64)>,
    grants: HashMap<String, Permit>,
    operations: HashMap<String, (String, Permit)>,
}
impl NativeState {
    pub(crate) fn observe_host(&mut self, host: Option<(String, u64)>) {
        if self.host != host {
            self.grants.clear();
            self.operations.clear();
        }
        self.host = host;
    }
    pub(crate) fn ready(&self) -> bool {
        self.enabled
            && self.host.as_ref().is_some_and(|(_, epoch)| {
                self.lifecycle
                    .as_ref()
                    .is_some_and(|l| l.validate(*epoch).is_ok())
            })
    }
    fn current(&self, p: &Permit, n: i64) -> bool {
        self.ready()
            && n < p.expires
            && n < p.action.deadline
            && self.host.as_ref() == Some(&(p.host.clone(), p.action.epoch))
    }
    pub(crate) fn allows(
        &self,
        db: &Connection,
        scope: &ChatScope,
        a: &ScheduleAuthority,
        op: Uuid,
        n: i64,
    ) -> bool {
        if !self.enabled {
            return true;
        }
        let Some((run, p)) = self.operations.get(&op.to_string()) else {
            return false;
        };
        if !self.current(p, n)
            || !self
                .lifecycle
                .as_ref()
                .is_some_and(|l| p.action.allows(scope, a, n, l))
        {
            return false;
        }
        let row:Option<(String,Option<String>,String,Option<String>)>=db.query_row("SELECT r.trigger_source,r.original_run_id,p.state,p.authorization_ref FROM chat_scheduled_runs r JOIN chat_scheduled_run_bindings b ON b.run_id=r.run_id JOIN chat_scheduled_plans p ON p.plan_id=r.plan_id JOIN chat_scheduled_grants g ON g.grant_id=r.grant_id WHERE (r.operation_id=?1 OR b.create_operation_id=?1) AND r.run_id=?2 AND r.grant_id=?3 AND r.owner_user_id=?4 AND r.tenant_id=?5 AND p.state!='deleted' AND p.revision=r.plan_revision AND g.max_runs=1",params![op.to_string(),run,p.grant,scope.owner_user_id,scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().ok().flatten();
        let Some((kind, original, state, selected)) = row else {
            return false;
        };
        match super::single::purpose(db, scope, &p.grant) {
            Ok(Some(purpose)) => match purpose.kind {
                wire::SingleRunKind::Manual => kind == "manual" && original.is_none(),
                wire::SingleRunKind::Rerun => kind == "rerun" && original == purpose.original,
            },
            Ok(None) => {
                kind == "manual" && state == "paused" && selected.as_deref() == Some(&p.grant)
            }
            Err(_) => false,
        }
    }
}
fn db(_: rusqlite::Error) -> run::ExecutionErrorCode {
    run::ExecutionErrorCode::StorageUnavailable
}
impl ChatRepository {
    pub(crate) fn manual_grant(
        &mut self,
        a: &ScheduleAuthority,
        input: run::GrantConfirmation,
        n: i64,
        action: Action,
    ) -> Result<run::GrantView, run::ExecutionErrorCode> {
        use run::ExecutionErrorCode as E;
        if !self.manual_runtime.enabled {
            return self.confirm_schedule_grant(a, input, n);
        }
        // Idempotent observation cannot renew or resurrect a confirmation.
        let prior:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_grants WHERE request_id=?1 AND owner_user_id=?2 AND tenant_id=?3)",params![input.request_id,self.scope.owner_user_id,self.scope.tenant_id],|r|r.get(0)).map_err(db)?;
        if prior {
            return self.confirm_schedule_grant(a, input, n);
        }
        if !self.manual_runtime.ready() {
            return Err(E::ExecutionNotReady);
        }
        if input.max_runs != 1 || input.expires_at <= n || input.expires_at > n + 600 {
            return Err(E::InvalidInput);
        }
        if execution::plan(&self.connection, &self.scope, &input.plan_id)?.state
            != PlanState::Paused
        {
            return Err(E::PermissionDenied);
        }
        self.manual_runtime
            .grants
            .retain(|_, p| p.expires > n && p.action.deadline > n);
        self.manual_runtime
            .operations
            .retain(|_, (_, p)| p.expires > n && p.action.deadline > n);
        if self.manual_runtime.grants.len() >= 128 {
            return Err(E::ExecutionNotReady);
        }
        let host = self
            .manual_runtime
            .host
            .as_ref()
            .ok_or(E::ExecutionNotReady)?
            .0
            .clone();
        let result = self.confirm_schedule_grant(a, input, n)?;
        self.manual_runtime.grants.insert(
            result.grant_id.clone(),
            Permit {
                action,
                host,
                grant: result.grant_id.clone(),
                expires: result.expires_at,
            },
        );
        Ok(result)
    }
    pub(crate) fn single_grant(
        &mut self,
        a: &ScheduleAuthority,
        input: wire::SingleRunGrantConfirmation,
        n: i64,
        action: Action,
    ) -> Result<wire::SingleRunGrantResult, run::ExecutionErrorCode> {
        use run::ExecutionErrorCode as E;
        let prior:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_grants WHERE request_id=?1 AND owner_user_id=?2 AND tenant_id=?3)",params![input.confirmation.request_id,self.scope.owner_user_id,self.scope.tenant_id],|r|r.get(0)).map_err(db)?;
        if prior {
            return self.confirm_single_grant_data(a, input, n);
        }
        if !self.manual_runtime.ready() {
            return Err(E::ExecutionNotReady);
        }
        self.manual_runtime
            .grants
            .retain(|_, p| p.expires > n && p.action.deadline > n);
        self.manual_runtime
            .operations
            .retain(|_, (_, p)| p.expires > n && p.action.deadline > n);
        if self.manual_runtime.grants.len() >= 128 {
            return Err(E::ExecutionNotReady);
        }
        let host = self
            .manual_runtime
            .host
            .as_ref()
            .ok_or(E::ExecutionNotReady)?
            .0
            .clone();
        let result = self.confirm_single_grant_data(a, input, n)?;
        self.manual_runtime.grants.insert(
            result.grant.grant_id.clone(),
            Permit {
                action,
                host,
                grant: result.grant.grant_id.clone(),
                expires: result.grant.expires_at,
            },
        );
        Ok(result)
    }
    pub(crate) fn manual_run(
        &mut self,
        a: &ScheduleAuthority,
        input: wire::ManualInput,
        request: &str,
        n: i64,
        context: Uuid,
    ) -> Result<run::RunView, wire::IpcErrorCode> {
        self.permitted_run(
            a,
            &input.grant_id,
            input.revision,
            request,
            execution::triggers::Trigger::Manual,
            n,
            context,
        )
    }
    pub(crate) fn rerun_run(
        &mut self,
        a: &ScheduleAuthority,
        input: wire::RerunConfirmation,
        request: &str,
        n: i64,
        context: Uuid,
    ) -> Result<run::RunView, wire::IpcErrorCode> {
        let c = execution::triggers::RerunConfirmation {
            original_run_id: input.original_run_id,
            original_snapshot_digest: input.original_snapshot_digest,
            plan_id: input.plan_id,
            revision: input.revision,
            definition_digest: input.definition_digest,
            grant_id: input.grant_id,
        };
        self.permitted_run(
            a,
            &c.grant_id.clone(),
            c.revision,
            request,
            execution::triggers::Trigger::Rerun(c),
            n,
            context,
        )
    }
    #[allow(clippy::too_many_arguments)]
    fn permitted_run(
        &mut self,
        a: &ScheduleAuthority,
        grant: &str,
        revision: i64,
        request: &str,
        trigger: execution::triggers::Trigger,
        n: i64,
        context: Uuid,
    ) -> Result<run::RunView, wire::IpcErrorCode> {
        use run::ExecutionErrorCode as E;
        let prior:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_runs WHERE request_id=?1 AND owner_user_id=?2 AND tenant_id=?3)",params![request,self.scope.owner_user_id,self.scope.tenant_id],|r|r.get(0)).map_err(db)?;
        if prior || !self.manual_runtime.enabled {
            return self
                .prepare_trigger_local(a, grant, revision, request, &trigger, n)
                .map_err(Into::into);
        }
        let permit = self
            .manual_runtime
            .grants
            .get(grant)
            .cloned()
            .ok_or(E::GrantMissing)?;
        if !self.manual_runtime.current(&permit, n)
            || permit.action.context != context
            || permit.action.revision != a.revision
        {
            return Err(E::GrantExpired.into());
        }
        let g = execution::grant(&self.connection, &self.scope, grant, n)?;
        let single = super::single::is_single(&self.connection, &self.scope, grant)?;
        if g.max_runs != 1
            || !super::single::matches_trigger(&self.connection, &self.scope, grant, &trigger)?
            || (!single
                && (!matches!(trigger, execution::triggers::Trigger::Manual)
                    || execution::plan(&self.connection, &self.scope, &g.plan_id)?.state
                        != PlanState::Paused))
        {
            return Err(E::PermissionDenied.into());
        }
        let result = self.prepare_trigger_local(a, grant, revision, request, &trigger, n)?;
        let create: Option<String> = self
            .connection
            .query_row(
                "SELECT create_operation_id FROM chat_scheduled_run_bindings WHERE run_id=?1",
                [&result.run_id],
                |r| r.get(0),
            )
            .map_err(|_| wire::PrivateErrorCode::OperationUnknown)?;
        self.manual_runtime.operations.insert(
            result.operation_id.clone(),
            (result.run_id.clone(), permit.clone()),
        );
        if let Some(op) = create {
            self.manual_runtime
                .operations
                .insert(op, (result.run_id.clone(), permit));
        }
        Ok(result)
    }
    pub(crate) fn execution_receipt(
        &self,
        input: wire::ExecutionReceiptKey,
        n: i64,
    ) -> Result<Value, wire::IpcErrorCode> {
        if input.operation == wire::ExecutionReceiptKeyOperation::Enable {
            return Ok(match self.enable_receipt(&input.original_request_id, n)? {
                Some(result) => json!({"observation":"enable_observed","result":result}),
                None => json!({"observation":"not_observed"}),
            });
        }
        if input.operation == wire::ExecutionReceiptKeyOperation::SingleGrant {
            let id:Option<String>=self.connection.query_row("SELECT grant_id FROM chat_scheduled_grants WHERE request_id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![input.original_request_id,self.scope.owner_user_id,self.scope.tenant_id],|r|r.get(0)).optional().map_err(db)?;
            return Ok(match id {
                Some(id) if super::single::is_single(&self.connection, &self.scope, &id)? => {
                    json!({"observation":"single_grant_observed","result":super::single::result(&self.connection,&self.scope,&id,n)?})
                }
                _ => json!({"observation":"not_observed"}),
            });
        }
        if input.operation == wire::ExecutionReceiptKeyOperation::Rerun {
            let id:Option<String>=self.connection.query_row("SELECT run_id FROM chat_scheduled_runs WHERE request_id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND trigger_source='rerun'",params![input.original_request_id,self.scope.owner_user_id,self.scope.tenant_id],|r|r.get(0)).optional().map_err(db)?;
            return Ok(match id {
                Some(id) => {
                    json!({"observation":"rerun_observed","run":execution::read_run(&self.connection,&self.scope,&id)?})
                }
                None => json!({"observation":"not_observed"}),
            });
        }
        let grant = input.operation == wire::ExecutionReceiptKeyOperation::Grant;
        let (table, key, filter) = if grant {
            ("chat_scheduled_grants", "grant_id", "")
        } else {
            (
                "chat_scheduled_runs",
                "run_id",
                " AND trigger_source='manual'",
            )
        };
        let id:Option<String>=self.connection.query_row(&format!("SELECT {key} FROM {table} WHERE request_id=?1 AND owner_user_id=?2 AND tenant_id=?3{filter}"),params![input.original_request_id,self.scope.owner_user_id,self.scope.tenant_id],|r|r.get(0)).optional().map_err(db)?;
        let Some(id) = id else {
            return Ok(json!({"observation":"not_observed"}));
        };
        if grant {
            Ok(
                json!({"observation":"grant_observed","grant":execution::grant(&self.connection,&self.scope,&id,n)?}),
            )
        } else {
            Ok(
                json!({"observation":"manual_observed","run":execution::read_run(&self.connection,&self.scope,&id)?}),
            )
        }
    }
    pub(crate) fn expire_manual(&mut self, n: i64) -> Result<(), ChatError> {
        if !self.manual_runtime.enabled {
            return Ok(());
        }
        let Some(authority) = self.schedule_dispatch_authority.as_ref() else {
            return Ok(());
        };
        let Ok(a) = authority.schedule_authority(n) else {
            return Ok(());
        };
        let Some(c) = self.scheduled_recovery_candidate(&a, n)? else {
            return Ok(());
        };
        let manual: bool = self
            .connection
            .query_row(
                "SELECT trigger_source='manual' FROM chat_scheduled_runs WHERE run_id=?1",
                [&c.run],
                |r| r.get(0),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if !manual {
            return Ok(());
        }
        if self
            .manual_runtime
            .allows(&self.connection, &self.scope, &a, c.operation, n)
        {
            return Ok(());
        }
        if matches!(c.create_attempt.as_str(), "never" | "not_required")
            && c.turn_attempt == "never"
        {
            self.cancel_unsent_schedule_reason(&a, &c.run, n, "cancelled")?;
        }
        Ok(())
    }
}
