//! FEAT-164: retire authority, not historical model identities or run debits.
use super::{execution_generated::ExecutionErrorCode as Error, generated::*, store};
use crate::chat::{database::ChatScope, error::ChatError, models};
use rusqlite::{params, Connection, OptionalExtension};

pub(super) fn profile(definition: &PlanDefinition) -> Result<String, Error> {
    match definition.model_profile {
        Some(p) => serde_json::to_value(p)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .ok_or(Error::FormatUnsupported),
        None => Ok("minimax-m3-high-v1".into()), // historical default, not the current catalog default
    }
}
pub(super) fn require_definition(definition: &PlanDefinition) -> Result<(), Error> {
    let id = profile(definition)?;
    if !models::executable_profile(&id) || (id == "kimi-k3-1-pro-max-v1" && !models::v2_enabled()) {
        return Err(Error::ExecutionNotReady);
    }
    Ok(())
}
pub(super) fn execution_available(definition: &PlanDefinition) -> bool {
    require_definition(definition).is_ok()
        && profile(definition).is_ok_and(|p| models::dispatch_profile_available(&p))
}
pub(super) fn require_execution(
    db: &Connection,
    scope: &ChatScope,
    plan: &PlanView,
) -> Result<(), Error> {
    require_definition(&plan.definition)?;
    if !models::dispatch_profile_available(&profile(&plan.definition)?) {
        return Err(Error::ExecutionNotReady);
    }
    require_target(db, scope, plan)
}
pub(super) fn require_target(
    db: &Connection,
    scope: &ChatScope,
    plan: &PlanView,
) -> Result<(), Error> {
    if !models::table(db).map_err(|_| Error::StorageUnavailable)? {
        return Ok(()); // legacy plans predate per-chat selections
    }
    let bound: Option<String> = if plan.definition.target.mode == TargetMode::DedicatedChat {
        db.query_row("SELECT conversation_id FROM chat_scheduled_target_bindings WHERE plan_id=?1 AND owner_user_id=?2 AND tenant_id=?3", params![plan.plan_id,scope.owner_user_id,scope.tenant_id], |r|r.get(0)).optional().map_err(|_|Error::StorageUnavailable)?.flatten()
    } else {
        None
    };
    if let Some(chat) = plan
        .definition
        .target
        .conversation_id
        .as_ref()
        .or(bound.as_ref())
    {
        let selected: Option<(String, String)> = db
            .query_row(
                "SELECT profile_id,state FROM chat_model_selections WHERE session_id=?1",
                [chat],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|_| Error::StorageUnavailable)?;
        let id = profile(&plan.definition)?;
        if !(matches!(selected,Some((ref p,ref s)) if p==&id && s=="ready")
            || selected.is_none() && id == "minimax-m3-high-v1")
        {
            return Err(Error::TargetUnavailable);
        }
    }
    Ok(())
}

/// Called before the repository is handed to DatabaseWorker. One ordinary domain
/// transaction records each transition exactly once; no run/grant/receipt rewrite.
pub(crate) fn retire_before_worker(
    db: &mut Connection,
    scope: &ChatScope,
    now: i64,
) -> Result<(), ChatError> {
    if !models::v2_enabled() {
        return Ok(());
    }
    let tx = db
        .transaction()
        .map_err(|_| ChatError::DatabaseUnavailable)?;
    let ids = {
        let mut q=tx.prepare("SELECT p.plan_id FROM chat_scheduled_plans p JOIN chat_plan_models m ON m.plan_id=p.plan_id WHERE p.owner_user_id=?1 AND p.tenant_id=?2 AND p.state IN ('enabled','paused') AND m.profile_id='kimi-k3-max-v1' AND NOT EXISTS(SELECT 1 FROM chat_plan_model_retirements r WHERE r.plan_id=p.plan_id) ORDER BY p.plan_id").map_err(|_|ChatError::DatabaseUnavailable)?;
        let rows = q
            .query_map(params![scope.owner_user_id, scope.tenant_id], |r| {
                r.get::<_, String>(0)
            })
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| ChatError::DatabaseUnavailable)?
    };
    for id in ids {
        let mut plan =
            store::read_plan(&tx, scope, &id).map_err(|_| ChatError::DatabaseUnavailable)?;
        let revision = plan
            .revision
            .checked_add(1)
            .ok_or(ChatError::DatabaseUnavailable)?;
        tx.execute("INSERT INTO chat_plan_model_retirements(plan_id,owner_user_id,tenant_id,format_version,retired_profile,previous_revision,retired_revision,previous_state,previous_authorization_ref,retired_at) VALUES(?1,?2,?3,1,'kimi-k3-max-v1',?4,?5,?6,?7,?8)",params![id,scope.owner_user_id,scope.tenant_id,plan.revision,revision,if plan.state==PlanState::Enabled {"enabled"} else {"paused"},plan.authorization_ref,now]).map_err(|_|ChatError::DatabaseUnavailable)?;
        plan.state = PlanState::Paused;
        plan.revision = revision;
        plan.authorization_ref = None;
        plan.authorization_expires_at = None;
        plan.next_at = None;
        let cursor = tx
            .query_row(
                "SELECT cursor_at FROM chat_scheduled_plans WHERE plan_id=?1",
                [&id],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        store::write_plan(&tx, scope, &plan, cursor).map_err(|_| ChatError::DatabaseUnavailable)?;
        tx.execute(
            "UPDATE chat_scheduled_plans SET future_hold='authorization' WHERE plan_id=?1",
            [&id],
        )
        .map_err(|_| ChatError::DatabaseUnavailable)?;
        tx.execute("UPDATE chat_scheduled_occurrences SET disposition='cancelled' WHERE plan_id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND disposition='planned' AND run_id IS NULL",params![id,scope.owner_user_id,scope.tenant_id]).map_err(|_|ChatError::DatabaseUnavailable)?;
    }
    tx.commit().map_err(|_| ChatError::DatabaseUnavailable)
}

/// Automatic expiry must not turn retirement into a cancellation/refund. Explicit
/// existing never-sent cancellation remains a separate user/domain operation.
pub(super) fn retired_run(
    db: &Connection,
    scope: &ChatScope,
    run: &str,
) -> Result<bool, ChatError> {
    if !cfg!(feature = "kimi-k31-pro-candidate") {
        return Ok(false);
    }
    let (snapshot,digest):(String,String)=db.query_row("SELECT snapshot_json,snapshot_digest FROM chat_scheduled_runs WHERE run_id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![run,scope.owner_user_id,scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|ChatError::DatabaseUnavailable)?;
    use sha2::{Digest, Sha256};
    if format!("{:x}", Sha256::digest(snapshot.as_bytes())) != digest {
        return Err(ChatError::DatabaseUnavailable);
    }
    let plan: PlanView =
        serde_json::from_str(&snapshot).map_err(|_| ChatError::DatabaseUnavailable)?;
    Ok(plan.definition.model_profile == Some(PlanDefinitionModelProfile::KimiK3MaxV1))
}

/// Filter before LIMIT so paused Kimi rows cannot starve runnable MiniMax plans.
pub(super) fn due_plan_ids(
    db: &Connection,
    scope: &ChatScope,
    now: i64,
    limit: i64,
) -> Result<Vec<String>, ChatError> {
    let model_sql = if models::table(db)? {
        "COALESCE((SELECT m.profile_id FROM chat_plan_models m WHERE m.plan_id=p.plan_id),'minimax-m3-high-v1')"
    } else {
        "'minimax-m3-high-v1'"
    };
    let mut q=db.prepare(&format!("SELECT p.plan_id FROM chat_scheduled_plans p WHERE p.owner_user_id=?1 AND p.tenant_id=?2 AND p.state NOT IN ('deleted','completed') AND p.next_at<=?3 AND (?4=0 OR {model_sql}!='kimi-k3-max-v1') AND (?5=0 OR {model_sql}!='kimi-k3-1-pro-max-v1') ORDER BY p.next_at,p.plan_id LIMIT ?6")).map_err(|_|ChatError::DatabaseUnavailable)?;
    let rows = q
        .query_map(
            params![
                scope.owner_user_id,
                scope.tenant_id,
                now,
                cfg!(feature = "kimi-k31-pro-candidate"),
                !models::v2_enabled()
                    || !models::dispatch_profile_available("kimi-k3-1-pro-max-v1"),
                limit
            ],
            |r| r.get::<_, String>(0),
        )
        .map_err(|_| ChatError::DatabaseUnavailable)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| ChatError::DatabaseUnavailable)
}
