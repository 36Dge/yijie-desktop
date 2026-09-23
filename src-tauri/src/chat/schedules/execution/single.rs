//! Explicit one-run purpose. The original grant owns quota and authority facts.
use super::*;
use crate::chat::schedules::ipc_generated as wire;

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Purpose {
    pub kind: wire::SingleRunKind,
    pub original: Option<String>,
}
pub(crate) fn present(db: &Connection) -> Result<bool, Error> {
    db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
        .map(|v| v >= crate::chat::migrations::SCHEDULE_SINGLE_RUN_SCHEMA_VERSION)
        .map_err(|_| Error::StorageUnavailable)
}
pub(crate) fn purpose(
    db: &Connection,
    scope: &ChatScope,
    grant: &str,
) -> Result<Option<Purpose>, Error> {
    if !present(db)? {
        return Ok(None);
    }
    type Row = (i64, String, Option<String>, String, i64);
    let row: Option<Row> = db.query_row("SELECT s.format_version,s.trigger_source,s.original_run_id,g.plan_id,g.max_runs FROM chat_scheduled_single_run_grants s JOIN chat_scheduled_grants g ON g.grant_id=s.grant_id WHERE g.grant_id=?1 AND g.owner_user_id=?2 AND g.tenant_id=?3", params![grant,scope.owner_user_id,scope.tenant_id], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(|_|Error::StorageUnavailable)?;
    let Some((v, kind, original, plan, max)) = row else {
        return Ok(None);
    };
    if v != 1 || max != 1 {
        return Err(Error::FormatUnsupported);
    }
    let kind = match (kind.as_str(), original.as_ref()) {
        ("manual", None) => wire::SingleRunKind::Manual,
        ("rerun", Some(old)) => {
            let matches:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_runs WHERE run_id=?1 AND plan_id=?2 AND owner_user_id=?3 AND tenant_id=?4)",params![old,plan,scope.owner_user_id,scope.tenant_id],|r|r.get(0)).map_err(|_|Error::StorageUnavailable)?;
            if !matches {
                return Err(Error::FormatUnsupported);
            }
            wire::SingleRunKind::Rerun
        }
        _ => return Err(Error::FormatUnsupported),
    };
    Ok(Some(Purpose { kind, original }))
}
pub(crate) fn is_single(db: &Connection, scope: &ChatScope, grant: &str) -> Result<bool, Error> {
    Ok(purpose(db, scope, grant)?.is_some())
}
pub(in crate::chat::schedules) fn matches_trigger(
    db: &Connection,
    scope: &ChatScope,
    grant: &str,
    trigger: &Trigger,
) -> Result<bool, Error> {
    Ok(match purpose(db, scope, grant)? {
        None => true, // The legacy grant/permit rules still apply.
        Some(p) => match trigger {
            Trigger::Manual => p.kind == wire::SingleRunKind::Manual,
            Trigger::Rerun(c) => {
                p.kind == wire::SingleRunKind::Rerun
                    && p.original.as_deref() == Some(&c.original_run_id)
            }
            Trigger::Automatic(_) => false,
        },
    })
}
pub(crate) fn result(
    db: &Connection,
    scope: &ChatScope,
    id: &str,
    n: i64,
) -> Result<wire::SingleRunGrantResult, Error> {
    let p = purpose(db, scope, id)?.ok_or(Error::GrantMissing)?;
    Ok(wire::SingleRunGrantResult {
        grant: grant(db, scope, id, n)?,
        kind: p.kind,
        original_run_id: p.original,
    })
}
/// Grant-independent review; no readiness, directory creation or write side effect.
pub(crate) fn review(
    db: &Connection,
    scope: &ChatScope,
    original: &str,
) -> Result<wire::RerunPreview, Error> {
    if !triggers::present(db)? {
        return Err(Error::StorageDisabled);
    }
    let r = read_run(db, scope, original)?;
    let p = plan(db, scope, &r.plan_id)?;
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
    Ok(wire::RerunPreview {
        confirmation: wire::RerunReview {
            original_run_id: r.run_id,
            original_snapshot_digest: r.snapshot_digest,
            plan_id: p.plan_id,
            revision: p.revision,
            definition_digest: digest(&encode(&p.definition)?),
        },
        original: old.definition,
        current: p.definition,
    })
}
pub(crate) fn review_from_confirmation(c: &triggers::RerunConfirmation) -> wire::RerunReview {
    wire::RerunReview {
        original_run_id: c.original_run_id.clone(),
        original_snapshot_digest: c.original_snapshot_digest.clone(),
        plan_id: c.plan_id.clone(),
        revision: c.revision,
        definition_digest: c.definition_digest.clone(),
    }
}
impl ChatRepository {
    pub(crate) fn confirm_single_grant_data(
        &mut self,
        a: &ScheduleAuthority,
        input: wire::SingleRunGrantConfirmation,
        n: i64,
    ) -> Result<wire::SingleRunGrantResult, Error> {
        a.require(&self.scope, ScheduleCapability::ScheduleRun, n)?;
        self.trigger_storage()?;
        if !present(&self.connection)? {
            return Err(Error::StorageDisabled);
        }
        let hash = digest(&encode(&("single/1", &input))?);
        let req = &input.confirmation;
        id(&req.request_id)?;
        id(&req.plan_id)?;
        let deadline = self.schedule_ui_deadline;
        let scope = self.scope.clone();
        let tx = self
            .connection
            .transaction()
            .map_err(|_| Error::StorageUnavailable)?;
        let prior:Option<(String,String)>=tx.query_row("SELECT grant_id,request_digest FROM chat_scheduled_grants WHERE request_id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![req.request_id,scope.owner_user_id,scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|_|Error::StorageUnavailable)?;
        if let Some((id, old)) = prior {
            if old != hash {
                return Err(Error::RequestConflict);
            }
            return result(&tx, &scope, &id, n); // Never renew a volatile permit.
        }
        if req.max_runs != 1 || req.expires_at <= n || req.expires_at > n + 600 {
            return Err(Error::InvalidInput);
        }
        let p = plan(&tx, &scope, &req.plan_id)?;
        if p.state == PlanState::Deleted {
            return Err(Error::NotFound);
        }
        if p.revision != req.expected_revision {
            return Err(Error::RevisionConflict);
        }
        let original = match (input.kind, input.review.as_ref()) {
            (wire::SingleRunKind::Manual, None) => None,
            (wire::SingleRunKind::Rerun, Some(c)) => {
                if c.plan_id != p.plan_id
                    || c.revision != p.revision
                    || review(&tx, &scope, &c.original_run_id)?.confirmation != *c
                {
                    return Err(Error::RevisionConflict);
                }
                Some(c.original_run_id.clone())
            }
            _ => return Err(Error::InvalidInput),
        };
        if guard::held(&tx).map_err(|_| Error::StorageUnavailable)?
            || guard::foreground_busy(&tx).map_err(|_| Error::StorageUnavailable)?
        {
            return Err(Error::ReservationBusy);
        }
        let w = workspace(&tx, &scope, &p)?;
        let gid = Uuid::now_v7().to_string();
        tx.execute("INSERT INTO chat_scheduled_grants(grant_id,owner_user_id,tenant_id,request_id,request_digest,plan_id,plan_revision,authorization_revision,definition_digest,workspace_source,workspace_id,max_runs,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,1,?12)",params![gid,scope.owner_user_id,scope.tenant_id,req.request_id,hash,p.plan_id,p.revision,a.revision,definition_digest(&p,&w)?,word(&w.source)?,w.resource_id,req.expires_at]).map_err(|_|Error::StorageUnavailable)?;
        tx.execute("INSERT INTO chat_scheduled_single_run_grants(grant_id,format_version,trigger_source,original_run_id) VALUES(?1,1,?2,?3)",params![gid,word(&input.kind)?,original]).map_err(|_|Error::StorageUnavailable)?;
        let out = result(&tx, &scope, &gid, n)?;
        super::super::ipc::commit_deadline(deadline)?;
        tx.commit().map_err(|_| Error::StorageUnavailable)?;
        Ok(out)
    }
}
