use super::super::{execution, generated::PlanView};
use super::*;
use crate::chat::database::ChatRepository;
use rusqlite::{params, params_from_iter, OptionalExtension};
fn sql<T>(result: rusqlite::Result<T>) -> Result<T, Code> {
    result.map_err(|_| E::StorageUnavailable.into())
}
fn str_field<'a>(v: &'a Value, k: &str, fallback: &'a str) -> &'a str {
    v[k].as_str().unwrap_or(fallback)
}
// Lifecycle priority is deliberate: a completed once-plan can retain budget hold.
fn plans_cte(repo: &ChatRepository) -> Result<String, Code> {
    let missing = if super::super::automatic::present(&repo.connection)? {
        "NOT EXISTS(SELECT 1 FROM chat_scheduled_enable_receipts e WHERE e.grant_id=g.grant_id AND e.format_version=1 AND e.automatic_consent_version=1)"
    } else {
        "1"
    };
    let effective = format!("CASE WHEN p.state!='enabled' THEN p.state WHEN p.future_hold IS NOT NULL OR g.grant_id IS NULL OR g.plan_revision!=p.revision OR g.authorization_revision!=?4 OR g.expires_at<=?3 OR g.occupied_runs>=g.max_runs OR ({missing}) THEN 'paused' ELSE 'enabled' END");
    Ok(format!("WITH plans AS (SELECT p.*,{effective} AS effective FROM chat_scheduled_plans p LEFT JOIN chat_scheduled_grants g ON g.grant_id=p.authorization_ref AND g.owner_user_id=p.owner_user_id AND g.tenant_id=p.tenant_id WHERE p.owner_user_id=?1 AND p.tenant_id=?2)"))
}
fn base(repo: &ChatRepository, n: i64, a: &ScheduleAuthority) -> Vec<rusqlite::types::Value> {
    vec![
        repo.scope.owner_user_id.clone().into(),
        repo.scope.tenant_id.clone().into(),
        n.into(),
        a.revision.into(),
    ]
}
fn summary(
    repo: &ChatRepository,
    p: &PlanView,
    a: &ScheduleAuthority,
    n: i64,
) -> Result<Value, Code> {
    let hold: Option<String> = sql(repo.connection.query_row(
        "SELECT future_hold FROM chat_scheduled_plans WHERE plan_id=?1",
        [&p.plan_id],
        |r| r.get(0),
    ))?;
    let mut state = value(&p.state)?;
    let mut reason = None;
    if p.state == super::super::generated::PlanState::Enabled {
        let g = p
            .authorization_ref
            .as_ref()
            .map(|id| execution::grant(&repo.connection, &repo.scope, id, n))
            .transpose()?;
        let consent = p
            .authorization_ref
            .as_ref()
            .map(|id| super::super::automatic::consent(&repo.connection, id))
            .transpose()?
            .unwrap_or(false);
        reason = hold
            .or_else(|| {
                g.as_ref().and_then(|g| {
                    if g.authorization_revision != a.revision
                        || g.state != super::super::execution_generated::GrantState::Active
                    {
                        Some(
                            if g.occupied_runs >= g.max_runs {
                                "budget"
                            } else {
                                "authorization"
                            }
                            .into(),
                        )
                    } else {
                        None
                    }
                })
            })
            .or_else(|| g.is_none().then(|| "authorization".into()))
            .or_else(|| (!consent).then(|| "confirmation".into()));
        if reason.is_some() {
            state = json!("paused");
        }
    }
    let mut out = json!({"plan_id":p.plan_id,"name":p.definition.name,"revision":p.revision,"raw_state":p.state,"effective_state":state,"target_mode":p.definition.target.mode,"target_state":p.target_state});
    if let Some(reason) = reason {
        out["pause_reason"] = json!(reason);
    }
    if let Some(next) = p.next_at {
        out["next_at"] = json!(next);
    }
    Ok(out)
}
pub(super) fn detail(
    repo: &ChatRepository,
    id: &str,
    a: &ScheduleAuthority,
    n: i64,
) -> Result<Value, Code> {
    let p = execution::plan(&repo.connection, &repo.scope, id)?;
    let mut out = json!({"summary":summary(repo,&p,a,n)?,"plan":p});
    if let Some(id) = p.authorization_ref {
        out["grant"] = value(&execution::grant(&repo.connection, &repo.scope, &id, n)?)?;
    }
    Ok(out)
}
pub(super) fn plans(
    repo: &ChatRepository,
    q: &Value,
    a: &ScheduleAuthority,
    n: i64,
    b: Option<&Boundary>,
    limit: usize,
) -> Result<Page, Code> {
    let order = str_field(q, "order", "name_asc");
    let sort = if order == "next_asc" {
        "printf('%015d',COALESCE(next_at,999999999999999))"
    } else {
        "name"
    };
    let cmp = if order == "name_desc" { "<" } else { ">" };
    let dir = if order == "name_desc" { "DESC" } else { "ASC" };
    let mut params = base(repo, n, a);
    params.extend([
        str_field(q, "search", "").to_owned().into(),
        str_field(q, "state", "all").to_owned().into(),
        i64::from(q["include_deleted"].as_bool().unwrap_or(false)).into(),
        b.map(|b| b.sort.clone()).unwrap_or_default().into(),
        b.map(|b| b.id.clone()).unwrap_or_default().into(),
        ((limit + 1) as i64).into(),
    ]);
    let query=format!("{} SELECT plan_id,{sort} AS sk FROM plans WHERE instr(lower(name),lower(?5))>0 AND (?6='all' OR effective=?6) AND (state!='deleted' OR (?6='all' AND ?7=1)) AND (?9='' OR ({sort},plan_id){cmp}(?8,?9)) ORDER BY {sort} {dir},plan_id {dir} LIMIT ?10",plans_cte(repo)?);
    let mut stmt = sql(repo.connection.prepare(&query))?;
    let rows = sql(sql(stmt.query_map(params_from_iter(params), |r| {
        Ok(Boundary {
            id: r.get(0)?,
            sort: r.get(1)?,
        })
    }))?
    .collect::<rusqlite::Result<Vec<_>>>())?;
    page(rows, limit, |b| {
        summary(
            repo,
            &execution::plan(&repo.connection, &repo.scope, &b.id)?,
            a,
            n,
        )
    })
}
pub(super) struct Page {
    pub items: Vec<Value>,
    pub next: Option<Boundary>,
}
fn page(
    rows: Vec<Boundary>,
    limit: usize,
    mut project: impl FnMut(&Boundary) -> Result<Value, Code>,
) -> Result<Page, Code> {
    let next = if rows.len() > limit {
        rows.get(limit - 1).cloned()
    } else {
        None
    };
    Ok(Page {
        items: rows
            .iter()
            .take(limit)
            .map(&mut project)
            .collect::<Result<_, _>>()?,
        next,
    })
}
pub(super) fn targets(
    repo: &ChatRepository,
    q: &Value,
    b: Option<&Boundary>,
    limit: usize,
) -> Result<Page, Code> {
    let mut stmt=sql(repo.connection.prepare("SELECT s.id,printf('%015d',s.last_activity_at) FROM chat_sessions s JOIN chat_projects p ON p.id=s.project_id AND p.owner_user_id=s.owner_user_id AND p.tenant_id=s.tenant_id WHERE s.owner_user_id=?1 AND s.tenant_id=?2 AND p.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id) AND instr(lower(s.title),lower(?3))>0 AND (?5='' OR (printf('%015d',s.last_activity_at),s.id)<(?4,?5)) ORDER BY s.last_activity_at DESC,s.id DESC LIMIT ?6"))?;
    let rows = sql(sql(stmt.query_map(
        params![
            repo.scope.owner_user_id,
            repo.scope.tenant_id,
            str_field(q, "search", ""),
            b.map(|b| b.sort.as_str()).unwrap_or(""),
            b.map(|b| b.id.as_str()).unwrap_or(""),
            (limit + 1) as i64
        ],
        |r| {
            Ok(Boundary {
                id: r.get(0)?,
                sort: r.get(1)?,
            })
        },
    ))?
    .collect::<rusqlite::Result<Vec<_>>>())?;
    page(rows, limit, |b| {
        let (title,updated,source,mode,native):(String,i64,String,String,bool)=sql(repo.connection.query_row("SELECT s.title,s.last_activity_at,p.workspace_source,COALESCE(t.mode,'ask'),EXISTS(SELECT 1 FROM chat_native_bindings b WHERE b.session_id=s.id) FROM chat_sessions s JOIN chat_projects p ON p.id=s.project_id LEFT JOIN chat_task_permissions t ON t.session_id=s.id WHERE s.id=?1",[&b.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))))?;
        let draft = super::super::drafts::is_draft(&repo.connection, &repo.scope, &b.id)
            .map_err(|_| E::StorageUnavailable)?;
        let reason = if draft {
            Some("target_unavailable")
        } else if mode != "ask" {
            Some("permission_denied")
        } else if !native {
            Some("native_identity_unavailable")
        } else {
            None
        };
        let mut out = json!({"conversation_id":b.id,"title":title,"updated_at":updated,"workspace_source":source,"can_save":!draft,"execution":if reason.is_some(){"blocked"}else{"requires_recheck"}});
        if let Some(reason) = reason {
            out["reason"] = json!(reason);
        }
        Ok(out)
    })
}
fn timing(started: bool) -> Value {
    json!({"execution_time":if started{"unknown"}else{"not_started"},"duration":if started{"unknown"}else{"not_started"},"source":"no_execution_clock"})
}
/// A bounded projection of the existing durable run facts. No observation,
/// acknowledgment, delivery permission or Host preparation happens on this read.
pub(super) fn important_updates(repo: &ChatRepository) -> Result<Value, Code> {
    let mut stmt = sql(repo.connection.prepare(
        "SELECT run_id,plan_id,snapshot_json,needs_attention,native_outcome FROM chat_scheduled_runs WHERE owner_user_id=?1 AND tenant_id=?2 AND format_version=1 ORDER BY needs_attention DESC,run_id DESC LIMIT 51",
    ))?;
    let rows = sql(sql(stmt.query_map(
        params![repo.scope.owner_user_id, repo.scope.tenant_id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, bool>(3)?,
                r.get::<_, String>(4)?,
            ))
        },
    ))?
    .collect::<rusqlite::Result<Vec<_>>>())?;
    let truncated = rows.len() > 50;
    let mut items = Vec::new();
    for (run, plan, snapshot, attention, outcome) in rows.into_iter().take(50) {
        let p: PlanView = serde_json::from_str(&snapshot).map_err(|_| E::FormatUnsupported)?;
        let state = if attention {
            "needs_attention"
        } else {
            match outcome.as_str() {
                "completed" => "completed",
                "failed" => "failed",
                "interrupted" => "interrupted",
                _ => "pending",
            }
        };
        items.push(json!({"run_id":run,"plan_id":plan,"name":p.definition.name,"state":state}));
    }
    Ok(json!({"items":items,"truncated":truncated}))
}
fn occurrence(repo: &ChatRepository, key: &Value) -> Result<Value, Code> {
    let p = &repo.scope;
    let row:Option<(i64,String,Option<i64>,Option<String>)>=sql(repo.connection.query_row("SELECT scheduled_at,disposition,missed_through,run_id FROM chat_scheduled_occurrences WHERE owner_user_id=?1 AND tenant_id=?2 AND plan_id=?3 AND schedule_epoch=?4 AND logical_slot=?5",params![p.owner_user_id,p.tenant_id,key["plan_id"].as_str(),key["schedule_epoch"].as_i64(),key["logical_slot"].as_str()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional())?;
    let (at, disposition, through, _) = row.ok_or(E::NotFound)?;
    if disposition == "planned" {
        return Err(E::NotFound.into());
    }
    let mut out = json!({"key":key,"scheduled_at":at,"disposition":disposition});
    if let Some(through) = through {
        out["missed_through"] = json!(through);
    }
    Ok(out)
}
fn run_record(
    repo: &ChatRepository,
    id: &str,
    a: &ScheduleAuthority,
    n: i64,
) -> Result<Value, Code> {
    let r = execution::read_run(&repo.connection, &repo.scope, id)?;
    let p = execution::plan(&repo.connection, &repo.scope, &r.plan_id)?;
    let link:Option<(Option<String>,String,bool,bool)>=sql(repo.connection.query_row("SELECT b.conversation_id,b.local_turn_id,b.target_deleted,EXISTS(SELECT 1 FROM chat_sessions s JOIN chat_turns t ON t.session_id=s.id AND t.id=b.local_turn_id JOIN chat_projects p ON p.id=s.project_id AND p.owner_user_id=s.owner_user_id AND p.tenant_id=s.tenant_id WHERE s.id=b.conversation_id AND s.owner_user_id=?2 AND s.tenant_id=?3 AND p.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id)) FROM chat_scheduled_run_bindings b WHERE b.run_id=?1",params![id,repo.scope.owner_user_id,repo.scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional())?;
    let conversation = match link {
        Some((_, _, true, _)) => json!({"status":"deleted"}),
        Some((Some(c), t, false, true)) => {
            json!({"status":"available","conversation_id":c,"local_turn_id":t})
        }
        _ => json!({"status":"unavailable"}),
    };
    let never:bool=sql(repo.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_recovery WHERE run_id=?1 AND format_version=1 AND turn_attempt='never')",[id],|r|r.get(0)))?;
    let snapshot: String = sql(repo.connection.query_row(
        "SELECT snapshot_json FROM chat_scheduled_runs WHERE run_id=?1",
        [id],
        |r| r.get(0),
    ))?;
    let zone = serde_json::from_str::<PlanView>(&snapshot)
        .ok()
        .map(|p| p.definition.rule.time_zone)
        .unwrap_or_else(|| "UTC".into());
    let live:bool=sql(repo.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_run_bindings b JOIN chat_native_views v ON v.turn_id=b.local_turn_id AND v.session_id=b.conversation_id JOIN chat_scheduled_recovery e ON e.run_id=b.run_id WHERE b.run_id=?1 AND e.release_kind IS NULL AND json_extract(v.view_json,'$.status')='inProgress' AND json_extract(v.view_json,'$.statusSource')='runtime_notification')",[id],|r|r.get(0)))?;
    let clock = repo
        .timing_view(id, never, live && !r.needs_attention, &zone)
        .map_err(|_| E::StorageUnavailable)?;
    let mut out = json!({"kind":"run","key":{"kind":"run","run_id":id},"plan":summary(repo,&p,a,n)?,"run":r,"conversation":conversation,"timing":clock,"attention":if r.needs_attention{"needs_attention"}else{"none"},"business_result":"not_evaluated"});
    let slot:Option<(String,i64,String)>=sql(repo.connection.query_row("SELECT plan_id,schedule_epoch,logical_slot FROM chat_scheduled_occurrences WHERE run_id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![id,repo.scope.owner_user_id,repo.scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional())?;
    if let Some((plan, epoch, slot)) = slot {
        out["occurrence"] = occurrence(
            repo,
            &json!({"kind":"occurrence","plan_id":plan,"schedule_epoch":epoch,"logical_slot":slot}),
        )?;
    }
    Ok(out)
}
pub(super) fn record(
    repo: &ChatRepository,
    key: &Value,
    a: &ScheduleAuthority,
    n: i64,
) -> Result<Value, Code> {
    if key["kind"] == "run" {
        return run_record(repo, key["run_id"].as_str().ok_or(E::InvalidInput)?, a, n);
    }
    let p = execution::plan(
        &repo.connection,
        &repo.scope,
        key["plan_id"].as_str().ok_or(E::InvalidInput)?,
    )?;
    let linked:bool=sql(repo.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_occurrences WHERE plan_id=?1 AND schedule_epoch=?2 AND logical_slot=?3 AND run_id IS NOT NULL)",params![p.plan_id,key["schedule_epoch"].as_i64(),key["logical_slot"].as_str()],|r|r.get(0)))?;
    if linked {
        return Err(E::NotFound.into());
    }
    Ok(
        json!({"kind":"occurrence","key":key,"plan":summary(repo,&p,a,n)?,"occurrence":occurrence(repo,key)?,"timing":timing(false)}),
    )
}
pub(super) fn record_detail(
    repo: &ChatRepository,
    key: &Value,
    a: &ScheduleAuthority,
    n: i64,
) -> Result<Value, Code> {
    let rec = record(repo, key, a, n)?;
    let mut out = json!({"record":rec});
    if key["kind"] == "run" {
        let snapshot:String=sql(repo.connection.query_row("SELECT snapshot_json FROM chat_scheduled_runs WHERE run_id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![key["run_id"].as_str(),repo.scope.owner_user_id,repo.scope.tenant_id],|r|r.get(0)))?;
        let p: PlanView = serde_json::from_str(&snapshot).map_err(|_| E::FormatUnsupported)?;
        out["configuration"] = json!({"name":p.definition.name,"content":p.definition.content,"rule":p.definition.rule,"target_mode":p.definition.target.mode});
    }
    Ok(out)
}
pub(super) fn records(
    repo: &ChatRepository,
    q: &Value,
    a: &ScheduleAuthority,
    n: i64,
    b: Option<&Boundary>,
    limit: usize,
) -> Result<Page, Code> {
    let query=format!("{}, records AS (SELECT r.run_id AS id,printf('%015d',COALESCE(o.scheduled_at,-1)) AS sk,json_object('kind','run','run_id',r.run_id) AS k,p.effective,p.plan_id FROM chat_scheduled_runs r JOIN plans p ON p.plan_id=r.plan_id LEFT JOIN chat_scheduled_occurrences o ON o.run_id=r.run_id WHERE r.owner_user_id=?1 AND r.tenant_id=?2 UNION ALL SELECT o.plan_id||':'||o.schedule_epoch||':'||o.logical_slot,printf('%015d',o.scheduled_at),json_object('kind','occurrence','plan_id',o.plan_id,'schedule_epoch',o.schedule_epoch,'logical_slot',o.logical_slot),p.effective,p.plan_id FROM chat_scheduled_occurrences o JOIN plans p ON p.plan_id=o.plan_id WHERE o.owner_user_id=?1 AND o.tenant_id=?2 AND o.run_id IS NULL AND o.disposition NOT IN ('planned','cancelled')) SELECT id,sk,k FROM records WHERE (?5='' OR plan_id=?5) AND (?6='all' OR effective=?6) AND (?8='' OR (sk,id)<(?7,?8)) ORDER BY sk DESC,id DESC LIMIT ?9",plans_cte(repo)?);
    let mut args = base(repo, n, a);
    args.extend([
        str_field(q, "plan_id", "").to_owned().into(),
        str_field(q, "state", "all").to_owned().into(),
        b.map(|b| b.sort.clone()).unwrap_or_default().into(),
        b.map(|b| b.id.clone()).unwrap_or_default().into(),
        ((limit + 1) as i64).into(),
    ]);
    let mut stmt = sql(repo.connection.prepare(&query))?;
    let rows = sql(sql(stmt.query_map(params_from_iter(args), |r| {
        Ok((
            Boundary {
                id: r.get(0)?,
                sort: r.get(1)?,
            },
            r.get::<_, String>(2)?,
        ))
    }))?
    .collect::<rusqlite::Result<Vec<_>>>())?;
    let next = if rows.len() > limit {
        Some(rows[limit - 1].0.clone())
    } else {
        None
    };
    let items = rows
        .iter()
        .take(limit)
        .map(|(_, key)| {
            let key = serde_json::from_str(key).map_err(|_| E::FormatUnsupported)?;
            record(repo, &key, a, n)
        })
        .collect::<Result<_, _>>()?;
    Ok(Page { items, next })
}

/// Stable keyset order: known creation times first in either direction; unknown
/// legacy values always last. The cursor is bound to scope/context/filter above.
pub(super) fn plan_cards(
    repo: &ChatRepository,
    q: &Value,
    a: &ScheduleAuthority,
    n: i64,
    b: Option<&Boundary>,
    limit: usize,
    version: i64,
) -> Result<Page, Code> {
    let created = if version >= 23 { "created_at" } else { "NULL" };
    let clock = if str_field(q, "order", "created_desc") == "created_asc" {
        created.to_owned()
    } else {
        format!("253402300799-{created}")
    };
    let sort =
        format!("CASE WHEN {created} IS NULL THEN '1' ELSE '0'||printf('%012d',{clock}) END");
    let mut args = base(repo, n, a);
    args.extend([
        str_field(q, "search", "").to_owned().into(),
        str_field(q, "state", "all").to_owned().into(),
        i64::from(q["include_deleted"].as_bool().unwrap_or(false)).into(),
        b.map(|b| b.sort.clone()).unwrap_or_default().into(),
        b.map(|b| b.id.clone()).unwrap_or_default().into(),
        ((limit + 1) as i64).into(),
    ]);
    let query = format!("{} SELECT plan_id,{sort} AS sk FROM plans WHERE (instr(lower(name),lower(?5))>0 OR instr(lower(content),lower(?5))>0) AND (?6='all' OR effective=?6) AND (state!='deleted' OR (?6='all' AND ?7=1)) AND (?9='' OR ({sort},plan_id)>(?8,?9)) ORDER BY sk,plan_id LIMIT ?10",plans_cte(repo)?);
    let mut stmt = sql(repo.connection.prepare(&query))?;
    let rows = sql(sql(stmt.query_map(params_from_iter(args), |r| {
        Ok(Boundary {
            id: r.get(0)?,
            sort: r.get(1)?,
        })
    }))?
    .collect::<rusqlite::Result<Vec<_>>>())?;
    page(rows, limit, |b| {
        let p = execution::plan(&repo.connection, &repo.scope, &b.id)?;
        let mut out = json!({"summary":summary(repo,&p,a,n)?,"content_preview":p.definition.content.chars().take(240).collect::<String>(),"rule":p.definition.rule});
        // Display identity comes from the same scoped native association. Never
        // infer an existing-chat target from a similarly named conversation.
        if let Some(chat) = &p.definition.target.conversation_id {
            let title: Option<String> = sql(repo.connection.query_row(
                "SELECT s.title FROM chat_sessions s JOIN chat_projects w ON w.id=s.project_id AND w.owner_user_id=s.owner_user_id AND w.tenant_id=s.tenant_id WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3 AND w.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id)",
                params![chat,repo.scope.owner_user_id,repo.scope.tenant_id], |r| r.get(0)).optional())?;
            if let Some(title) = title {
                out["target_title"] = json!(title);
            }
        }
        if version >= 23 {
            let created:Option<i64>=sql(repo.connection.query_row("SELECT created_at FROM chat_scheduled_plans WHERE plan_id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![p.plan_id,repo.scope.owner_user_id,repo.scope.tenant_id],|r|r.get(0)))?;
            if let Some(created) = created {
                out["created_at"] = json!(created);
            }
        }
        Ok(out)
    })
}

pub(super) fn record_rows(
    repo: &ChatRepository,
    q: &Value,
    a: &ScheduleAuthority,
    n: i64,
    b: Option<&Boundary>,
    limit: usize,
) -> Result<Page, Code> {
    let query=format!("{}, records AS (SELECT r.run_id AS id,printf('%015d',COALESCE(o.scheduled_at,-1)) AS sk,json_object('kind','run','run_id',r.run_id) AS k,p.effective,p.plan_id,json_extract(r.snapshot_json,'$.definition.name') AS saved_name,json_extract(r.snapshot_json,'$.definition.content') AS saved_content FROM chat_scheduled_runs r JOIN plans p ON p.plan_id=r.plan_id LEFT JOIN chat_scheduled_occurrences o ON o.run_id=r.run_id WHERE r.owner_user_id=?1 AND r.tenant_id=?2 UNION ALL SELECT o.plan_id||':'||o.schedule_epoch||':'||o.logical_slot,printf('%015d',o.scheduled_at),json_object('kind','occurrence','plan_id',o.plan_id,'schedule_epoch',o.schedule_epoch,'logical_slot',o.logical_slot),p.effective,p.plan_id,p.name,p.content FROM chat_scheduled_occurrences o JOIN plans p ON p.plan_id=o.plan_id WHERE o.owner_user_id=?1 AND o.tenant_id=?2 AND o.run_id IS NULL AND o.disposition NOT IN ('planned','cancelled')) SELECT id,sk,k FROM records WHERE (?5='' OR plan_id=?5) AND (?6='all' OR effective=?6) AND (instr(lower(saved_name),lower(?7))>0 OR instr(lower(saved_content),lower(?7))>0) AND (?9='' OR (sk,id)<(?8,?9)) ORDER BY sk DESC,id DESC LIMIT ?10",plans_cte(repo)?);
    let mut args = base(repo, n, a);
    args.extend([
        str_field(q, "plan_id", "").to_owned().into(),
        str_field(q, "state", "all").to_owned().into(),
        str_field(q, "search", "").to_owned().into(),
        b.map(|b| b.sort.clone()).unwrap_or_default().into(),
        b.map(|b| b.id.clone()).unwrap_or_default().into(),
        ((limit + 1) as i64).into(),
    ]);
    let mut stmt = sql(repo.connection.prepare(&query))?;
    let rows = sql(sql(stmt.query_map(params_from_iter(args), |r| {
        Ok((
            Boundary {
                id: r.get(0)?,
                sort: r.get(1)?,
            },
            r.get::<_, String>(2)?,
        ))
    }))?
    .collect::<rusqlite::Result<Vec<_>>>())?;
    let next = (rows.len() > limit).then(|| rows[limit - 1].0.clone());
    let items=rows.iter().take(limit).map(|(_,key)|{
        let key:Value=serde_json::from_str(key).map_err(|_|E::FormatUnsupported)?;
        let detail=record_detail(repo,&key,a,n)?;
        let (name,content,source)=if key["kind"]=="run" {
            (detail["configuration"]["name"].as_str().ok_or(E::FormatUnsupported)?.to_owned(),detail["configuration"]["content"].as_str().ok_or(E::FormatUnsupported)?.to_owned(),"run_snapshot")
        } else {
            let p=execution::plan(&repo.connection,&repo.scope,key["plan_id"].as_str().ok_or(E::InvalidInput)?)?;
            (p.definition.name,p.definition.content,"current_plan_reference")
        };
        Ok(json!({"record":detail["record"],"name":name,"content_preview":content.chars().take(240).collect::<String>(),"source":source}))
    }).collect::<Result<_,Code>>()?;
    Ok(Page { items, next })
}

pub(super) fn mutation_receipt(
    repo: &ChatRepository,
    q: &Value,
    a: &ScheduleAuthority,
    n: i64,
) -> Result<Value, Code> {
    let id:Option<String>=sql(repo.connection.query_row("SELECT plan_id FROM chat_scheduled_requests WHERE owner_user_id=?1 AND tenant_id=?2 AND request_id=?3",params![repo.scope.owner_user_id,repo.scope.tenant_id,q["original_request_id"].as_str().ok_or(E::InvalidInput)?],|r|r.get(0)).optional())?;
    match id {
        Some(id) => {
            Ok(json!({"observation":"observed","plan_id":id,"current_plan":detail(repo,&id,a,n)?}))
        }
        None => Ok(json!({"observation":"not_observed"})),
    }
}
