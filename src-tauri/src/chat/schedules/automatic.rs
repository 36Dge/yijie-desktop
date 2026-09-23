//! Finite background consent is durable; execution authority is always current.
use super::{
    execution, execution_generated::ExecutionErrorCode as Error, manual, ScheduleAuthority,
};
use crate::chat::{
    database::{ChatRepository, ChatScope},
    lifecycle::Lifecycle,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

pub(crate) fn present(db: &Connection) -> Result<bool, Error> {
    db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
        .map(|v| v >= crate::chat::migrations::SCHEDULE_AUTOMATIC_SCHEMA_VERSION)
        .map_err(|_| Error::StorageUnavailable)
}
pub(crate) fn consent(db: &Connection, grant: &str) -> Result<bool, Error> {
    if !present(db)? {
        return Ok(false);
    }
    db.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_enable_receipts WHERE grant_id=?1 AND format_version=1 AND automatic_consent_version=1)", [grant], |r| r.get(0))
        .map_err(|_| Error::StorageUnavailable)
}

/// A source-specific extra gate; the original dispatch validator still checks
/// scope, grant debit, plan/workspace, target, reservation and continuity.
#[allow(clippy::too_many_arguments)]
pub(crate) fn allows(
    db: &Connection,
    scope: &ChatScope,
    a: &ScheduleAuthority,
    op: Uuid,
    n: i64,
    lifecycle: Option<&Lifecycle>,
    manual: &manual::NativeState,
) -> bool {
    if !manual.enabled {
        // Preserve isolated older foundation semantics, never enable SQL24 by
        // turning the current-process manual gate off.
        return present(db).is_ok_and(|p| !p);
    }
    let row: Option<(String, String)> = db.query_row("SELECT r.trigger_source,r.grant_id FROM chat_scheduled_runs r JOIN chat_scheduled_run_bindings b ON b.run_id=r.run_id WHERE (r.operation_id=?1 OR b.create_operation_id=?1) AND r.owner_user_id=?2 AND r.tenant_id=?3",params![op.to_string(),scope.owner_user_id,scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().ok().flatten();
    match row {
        Some((kind, _)) if kind == "manual" || kind == "rerun" => {
            manual.allows(db, scope, a, op, n)
        }
        Some((kind, grant)) if kind == "automatic" => {
            lifecycle.is_some() && consent(db, &grant).unwrap_or(false)
        }
        _ => false,
    }
}

pub(crate) fn receipt_value(r: execution::EnableReceipt) -> Value {
    let mut out = json!({"plan":r.plan,"grant":r.grant,"automatic_consent":r.automatic_consent});
    if let Some(h) = r.future_hold {
        out["future_hold"] = json!(h);
    }
    out
}
impl ChatRepository {
    /// Historical rerun preparations stay non-dispatchable in this batch. A
    /// complete never-sent preparation can still release its original debit.
    pub(crate) fn expire_unstarted_rerun(
        &mut self,
        n: i64,
    ) -> Result<(), crate::chat::error::ChatError> {
        use crate::chat::error::ChatError as E;
        if !self.manual_runtime.enabled {
            return Ok(());
        }
        let Some(authority) = self.schedule_dispatch_authority.as_ref() else {
            return Ok(());
        };
        let a = authority
            .schedule_authority(n)
            .map_err(|_| E::ScopeDenied)?;
        let Some(c) = self.scheduled_recovery_candidate(&a, n)? else {
            return Ok(());
        };
        let rerun: bool = self
            .connection
            .query_row(
                "SELECT trigger_source='rerun' FROM chat_scheduled_runs WHERE run_id=?1",
                [&c.run],
                |r| r.get(0),
            )
            .map_err(|_| E::DatabaseUnavailable)?;
        if rerun
            && !self
                .manual_runtime
                .allows(&self.connection, &self.scope, &a, c.operation, n)
            && matches!(c.create_attempt.as_str(), "never" | "not_required")
            && c.turn_attempt == "never"
        {
            self.cancel_unsent_schedule_reason(&a, &c.run, n, "cancelled")?;
        }
        Ok(())
    }
    /// A: a retained finite automatic intent (next_at may be stale after offline).
    /// B: execution facts still need observation/cleanup, even with no future grant.
    pub(crate) fn automatic_startup_work(
        &self,
        n: i64,
    ) -> Result<(bool, bool), crate::chat::error::ChatError> {
        use crate::chat::error::ChatError as E;
        if !present(&self.connection).map_err(|_| E::DatabaseUnavailable)? {
            return Ok((false, false));
        }
        let a = self
            .schedule_dispatch_authority
            .as_ref()
            .ok_or(E::ScopeDenied)?
            .schedule_authority(n)
            .map_err(|_| E::ScopeDenied)?;
        a.require(
            &self.scope,
            super::execution_generated::ScheduleCapability::ScheduleRead,
            n,
        )
        .map_err(|_| E::ScopeDenied)?;
        let future:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_plans p JOIN chat_scheduled_grants g ON g.grant_id=p.authorization_ref JOIN chat_scheduled_enable_receipts e ON e.grant_id=g.grant_id WHERE p.owner_user_id=?1 AND p.tenant_id=?2 AND g.owner_user_id=p.owner_user_id AND g.tenant_id=p.tenant_id AND p.state='enabled' AND p.future_hold IS NULL AND p.next_at IS NOT NULL AND g.plan_revision=p.revision AND g.authorization_revision=?3 AND g.expires_at>?4 AND g.occupied_runs<g.max_runs AND e.format_version=1 AND e.automatic_consent_version=1)",params![self.scope.owner_user_id,self.scope.tenant_id,a.revision,n],|r|r.get(0)).map_err(|_|E::DatabaseUnavailable)?;
        let pending:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_runs r LEFT JOIN chat_scheduled_recovery e ON e.run_id=r.run_id WHERE r.owner_user_id=?1 AND r.tenant_id=?2 AND (e.release_kind IS NULL OR EXISTS(SELECT 1 FROM chat_scheduled_reservation v WHERE v.run_id=r.run_id)))",params![self.scope.owner_user_id,self.scope.tenant_id],|r|r.get(0)).map_err(|_|E::DatabaseUnavailable)?;
        Ok((future, pending))
    }
    pub(crate) fn enable_receipt(&self, request: &str, now: i64) -> Result<Option<Value>, Error> {
        let row:Option<(String,String,i64)>=self.connection.query_row("SELECT g.grant_id,g.plan_id,e.format_version FROM chat_scheduled_grants g JOIN chat_scheduled_enable_receipts e ON e.grant_id=g.grant_id WHERE g.request_id=?1 AND g.owner_user_id=?2 AND g.tenant_id=?3",params![request,self.scope.owner_user_id,self.scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|_|Error::StorageUnavailable)?;
        let Some((grant, plan, version)) = row else {
            return Ok(None);
        };
        if version != 1 {
            return Err(Error::FormatUnsupported);
        }
        Ok(Some(receipt_value(execution::EnableReceipt {
            automatic_consent: consent(&self.connection, &grant)?,
            grant: execution::grant(&self.connection, &self.scope, &grant, now)?,
            plan: execution::plan(&self.connection, &self.scope, &plan)?,
            future_hold: self
                .connection
                .query_row(
                    "SELECT future_hold FROM chat_scheduled_plans WHERE plan_id=?1",
                    [plan],
                    |r| r.get(0),
                )
                .map_err(|_| Error::StorageUnavailable)?,
        })))
    }
}
