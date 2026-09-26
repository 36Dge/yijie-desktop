//! Desktop-private, versioned management boundary. No candidate constructor,
//! scheduler tick, raw authority, path, or transport is exposed to the WebView.
use super::{
    execution,
    execution_generated::{ExecutionErrorCode as E, ScheduleCapability},
    ipc_generated::{self as wire, IpcErrorCode as Code, PrivateErrorCode as P},
    ScheduleAuthority,
};
use crate::chat::{
    authorization::{AuthorizationFailure, ChatAuthorizationManager},
    database::ChatRepository,
    worker::DatabaseWorker,
    ChatRuntime, RuntimeMode,
};
use crate::native_auth::NativeAuthRuntime;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use uuid::Uuid;
mod query;
#[cfg(test)]
mod tests;
pub(super) mod validation;
impl From<E> for Code {
    fn from(e: E) -> Self {
        Self::Variant0(e)
    }
}
impl From<P> for Code {
    fn from(e: P) -> Self {
        Self::Variant1(e)
    }
}
fn auth_error(e: AuthorizationFailure) -> Code {
    match e {
        AuthorizationFailure::ContextInvalid => P::ContextInvalid.into(),
        AuthorizationFailure::CapabilityDenied => E::ScopeDenied.into(),
    }
}
fn value<T: Serialize>(v: &T) -> Result<Value, Code> {
    serde_json::to_value(v).map_err(|_| E::StorageUnavailable.into())
}
fn decode<T: DeserializeOwned>(v: &Value) -> Result<T, Code> {
    serde_json::from_value(v.clone()).map_err(|_| E::InvalidInput.into())
}
pub(super) fn commit_deadline(deadline: Option<i64>) -> Result<(), E> {
    if deadline.is_some_and(|d| execution::now().map_or(true, |n| n >= d)) {
        Err(E::ScopeDenied)
    } else {
        Ok(())
    }
}
#[derive(Clone)]
struct Boundary {
    sort: String,
    id: String,
}
struct Cursor {
    binding: String,
    boundary: Boundary,
    expires: i64,
}
#[derive(Clone, Default)]
pub(crate) struct ScheduleIpcRuntime {
    cursors: Arc<Mutex<HashMap<Uuid, Cursor>>>,
}
impl ScheduleIpcRuntime {
    fn boundary(&self, q: &Value, binding: &str, n: i64) -> Result<Option<Boundary>, Code> {
        let Some(token) = q.get("cursor") else {
            return Ok(None);
        };
        let token: Uuid = decode(token)?;
        let mut cursors = self.cursors.lock().map_err(|_| E::StorageUnavailable)?;
        cursors.retain(|_, c| c.expires > n);
        let c = cursors
            .get(&token)
            .filter(|c| c.binding == binding)
            .ok_or(P::CursorInvalid)?;
        Ok(Some(c.boundary.clone()))
    }
    fn page(&self, p: query::Page, binding: String, n: i64) -> Result<Value, Code> {
        let mut out = json!({"items":p.items});
        if let Some(boundary) = p.next {
            let mut cursors = self.cursors.lock().map_err(|_| E::StorageUnavailable)?;
            cursors.retain(|_, c| c.expires > n);
            if cursors.len() >= 512 {
                if let Some(id) = cursors
                    .iter()
                    .min_by_key(|(_, c)| c.expires)
                    .map(|(k, _)| *k)
                {
                    cursors.remove(&id);
                }
            }
            let id = Uuid::now_v7();
            cursors.insert(
                id,
                Cursor {
                    binding,
                    boundary,
                    expires: n + 300,
                },
            );
            out["next_cursor"] = json!(id);
        }
        Ok(out)
    }
}
fn definition(command: &str) -> Result<(&'static str, &'static str, &'static str, bool), Code> {
    wire::COMMANDS
        .iter()
        .find(|(name, ..)| *name == command)
        .map(|(_, req, res, permission, write)| (*req, *res, *permission, *write))
        .ok_or_else(|| E::InvalidInput.into())
}
fn error(code: Code, request_id: Option<String>) -> wire::ErrorResponse {
    wire::ErrorResponse {
        schema_version: 1,
        request_id,
        code,
    }
}
pub(crate) async fn command(
    request: Value,
    runtime: &ChatRuntime,
    ipc: &ScheduleIpcRuntime,
    name: &'static str,
) -> Result<Value, wire::ErrorResponse> {
    let request_id = request["requestId"]
        .as_str()
        .filter(|s| Uuid::parse_str(s).is_ok_and(|id| id.to_string() == *s))
        .map(str::to_owned);
    let result = async {
        let (req, _, permission, write) = definition(name)?;
        if !validation::valid(req, &request) {
            return Err(E::InvalidInput.into());
        }
        let context: Uuid = decode(&request["contextId"])?;
        let ui = runtime
            .authorization_manager()
            .map_err(|_| Code::from(P::ContextInvalid))?;
        let scope = match &runtime.mode {
            RuntimeMode::Local(c) => c.scope.clone(),
            _ => return Err(E::StorageDisabled.into()),
        };
        ui.with_schedule_context(
            context,
            &scope,
            write,
            permission == "run",
            execution::now()?,
            |_, _| (),
        )
        .map_err(auth_error)?;
        let authority = runtime.schedule_authority.clone().ok_or(E::ScopeDenied)?;
        // Reuse the single native-configured worker; this query cannot change its
        // storage mode or construct/start a Host.
        let worker = runtime
            .database()
            .await
            .map_err(|_| E::StorageUnavailable)?;
        if matches!(
            name,
            "schedule_submit_draft_v1"
                | "schedule_continue_draft_source_v1"
                | "schedule_operation_capabilities_v1"
        ) {
            let host = runtime.local_host_bridge().await;
            let available = match &host {
                Ok(h) => h.require_draft_capability().await.is_ok(),
                Err(_) => false,
            };
            if available {
                let host = host.map_err(|_| Code::from(P::DraftUnavailable))?;
                let nonce = host.instance_nonce().to_owned();
                let epoch = runtime.lifecycle.epoch();
                worker
                    .call(move |r| r.draft_host_observed(nonce, epoch))
                    .await
                    .map_err(super::drafts::chat)?;
                if name == "schedule_continue_draft_source_v1" {
                    let id = decode::<wire::DraftKey>(&request["payload"])?.source_id;
                    let c = worker
                        .call(move |r| r.draft_source_context(&id))
                        .await
                        .map_err(super::drafts::chat)?;
                    super::draft_recovery::recover_source(&worker, &host, &runtime.lifecycle, c)
                        .await
                        .map_err(super::drafts::chat)?;
                }
            } else {
                worker
                    .call(|r| {
                        r.draft_runtime.host = None;
                        r.draft_runtime.actions.clear();
                        Ok(())
                    })
                    .await
                    .map_err(super::drafts::chat)?;
                if name != "schedule_operation_capabilities_v1" {
                    return Err(P::DraftUnavailable.into());
                }
            }
        }
        if matches!(
            name,
            "schedule_operation_capabilities_v1"
                | "schedule_confirm_grant_v1"
                | "schedule_confirm_single_run_v1"
                | "schedule_confirm_rerun_v1"
                | "schedule_confirm_enable_v1"
                | "schedule_manual_run_v1"
        ) {
            // A read may inspect an already prepared Host, never start one.
            let observed = match runtime.local_host_bridge().await {
                Ok(host)
                    if crate::chat::runtime_permissions::enabled()
                        && host.ensure_ready().await.is_ok() =>
                {
                    Some((host.instance_nonce().to_owned(), runtime.lifecycle.epoch()))
                }
                _ => None,
            };
            worker
                .call(move |r| {
                    r.manual_runtime.observe_host(observed);
                    Ok(())
                })
                .await
                .map_err(super::drafts::chat)?;
        }
        if name == "schedule_get_record_v1" && request["payload"]["kind"] == "run" {
            if let (Some(run), Ok(host)) = (
                request["payload"]["run_id"].as_str(),
                runtime.local_host_bridge().await,
            ) {
                // Only refresh one already bound record, never prepare/start a Host.
                let _ = super::timing_runtime::collect_one(
                    &worker,
                    &host,
                    authority.clone(),
                    runtime.lifecycle.clone(),
                    Some((ui.clone(), context)),
                    Some(run.to_owned()),
                )
                .await;
            }
        }
        let response = execute(
            &worker,
            authority.clone(),
            ui.clone(),
            ipc.clone(),
            request,
            name,
        )
        .await?;
        if matches!(
            name,
            "schedule_list_records_v1" | "schedule_list_record_rows_v1"
        ) {
            let ids = response["data"]["items"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|row| {
                    let r = if name == "schedule_list_record_rows_v1" {
                        &row["record"]
                    } else {
                        row
                    };
                    (r["kind"] == "run")
                        .then(|| r["key"]["run_id"].as_str().map(str::to_owned))
                        .flatten()
                })
                .take(50)
                .collect();
            // Cache-only read work; the page itself returns immediately and works offline.
            let _ =
                super::timing_runtime::queue(&worker, authority, Some((ui.clone(), context)), ids)
                    .await;
            ui.with_schedule_context(context, &scope, false, false, execution::now()?, |_, _| ())
                .map_err(auth_error)?;
        }
        Ok(response)
    }
    .await;
    result.map_err(|code| error(code, request_id))
}
async fn execute(
    worker: &DatabaseWorker,
    authority: NativeAuthRuntime,
    ui: ChatAuthorizationManager,
    ipc: ScheduleIpcRuntime,
    request: Value,
    name: &'static str,
) -> Result<Value, Code> {
    let (req, res, permission, write) = definition(name)?;
    if !validation::valid(req, &request) {
        return Err(E::InvalidInput.into());
    }
    let context: Uuid = decode(&request["contextId"])?;
    let request_id = request["requestId"]
        .as_str()
        .ok_or(E::InvalidInput)?
        .to_owned();
    if Uuid::parse_str(&request_id).is_ok_and(|id| id.is_nil()) || context.is_nil() {
        return Err(E::InvalidInput.into());
    }
    let before = ui.clone();
    let rid = request_id.clone();
    let (result, scope) = worker
        .call(move |repo| {
            let scope = repo.scope.clone();
            let result = (|| {
                let n = execution::now()?;
                let mut a = authority.schedule_authority(n)?;
                let capability = match permission {
                    "manage" => ScheduleCapability::ScheduleManage,
                    "run" => ScheduleCapability::ScheduleRun,
                    _ => ScheduleCapability::ScheduleRead,
                };
                a.require(&scope, capability, n)?;
                before
                    .with_schedule_context(
                        context,
                        &scope,
                        write,
                        permission == "run",
                        n,
                        |deadline, revision| {
                            if revision != a.revision as u64 {
                                return Err(E::ScopeDenied.into());
                            }
                            let deadline = a.limit_to_ui(deadline);
                            repo.schedule_ui_deadline = Some(deadline);
                            let result = operation(
                                repo,
                                &ipc,
                                &request["payload"],
                                &a,
                                n,
                                name,
                                &rid,
                                context,
                                &before,
                            );
                            repo.schedule_ui_deadline = None;
                            result
                        },
                    )
                    .map_err(auth_error)?
            })();
            Ok((result, scope))
        })
        .await
        .map_err(|_| {
            if write {
                Code::from(P::OperationUnknown)
            } else {
                E::StorageUnavailable.into()
            }
        })?;
    if result.is_ok() && write {
        worker.schedule_changed.notify_one();
    }
    let data = result?;
    let response = json!({"schemaVersion":1,"requestId":request_id,"data":data});
    if !validation::valid(res, &response) {
        return Err(if write {
            P::OperationUnknown.into()
        } else {
            P::ProtocolMismatch.into()
        });
    }
    // A rebind/expiry after commit makes the receipt uncertain, never a retry hint.
    ui.with_schedule_context(
        context,
        &scope,
        write,
        permission == "run",
        execution::now()?,
        |_, _| (),
    )
    .map_err(|e| {
        if write {
            P::OperationUnknown.into()
        } else {
            auth_error(e)
        }
    })?;
    Ok(response)
}
#[allow(clippy::too_many_arguments)]
fn operation(
    repo: &mut ChatRepository,
    ipc: &ScheduleIpcRuntime,
    q: &Value,
    a: &ScheduleAuthority,
    n: i64,
    name: &str,
    request: &str,
    context: Uuid,
    ui: &ChatAuthorizationManager,
) -> Result<Value, Code> {
    let version: i64 = repo
        .connection
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|_| E::StorageUnavailable)?;
    if name == "schedule_operation_capabilities_v1" {
        let readable =
            (21..=crate::chat::migrations::MAX_READABLE_SCHEMA_VERSION).contains(&version);
        let permitted = |cap| a.require(&repo.scope, cap, n).is_ok();
        let cap = |available: bool, reason: &str| json!({"available":available,"reason":if available {"ready"}else{reason}});
        let writable = readable && repo.schedule_execution_writes_enabled;
        let save = writable && permitted(ScheduleCapability::ScheduleManage);
        let run = writable && permitted(ScheduleCapability::ScheduleRun);
        let draft_candidate = version >= 22
            && repo.schedule_draft_writes_enabled
            && repo.schedule_draft_dispatch_authority.is_some();
        let ready = repo.draft_runtime.host.as_ref().is_some_and(|(_, epoch)| {
            repo.draft_runtime
                .lifecycle
                .as_ref()
                .is_some_and(|l| l.validate(*epoch).is_ok())
        });
        return Ok(
            json!({"read":cap(readable,"storage_disabled"),"save":cap(save,if !readable {"storage_disabled"}else if !writable {"storage_read_only"}else{"authority_missing"}),
            "manual":cap(run&&repo.schedule_dispatch_authority.is_some()&&(!repo.manual_runtime.enabled||repo.manual_runtime.ready()),if !run {"authority_missing"}else if repo.manual_runtime.enabled {"runtime_unqualified"}else{"candidate_disabled"}),
            "single_run":cap(run&&version>=25&&repo.manual_runtime.ready()&&repo.schedule_dispatch_authority.is_some(),if !run {"authority_missing"}else if version>=25&&repo.manual_runtime.enabled {"runtime_unqualified"}else{"candidate_disabled"}),
            "automatic":cap(run&&version>=24&&repo.manual_runtime.ready()&&repo.schedule_dispatch_authority.is_some()&&repo.schedule_trigger_lifecycle.is_some(),if !run {"authority_missing"}else if version>=24&&repo.manual_runtime.enabled&&repo.schedule_trigger_lifecycle.is_some(){"runtime_unqualified"}else{"candidate_disabled"}),
            "draft":cap(run&&draft_candidate&&ready,if !run {"authority_missing"}else if !draft_candidate {"candidate_disabled"}else{"runtime_unqualified"})}),
        );
    }
    if name == "schedule_availability_v1" {
        return Ok(
            json!({"schema_version":version,"readable":(21..=crate::chat::migrations::MAX_READABLE_SCHEMA_VERSION).contains(&version),"writable":(21..=crate::chat::migrations::MAX_READABLE_SCHEMA_VERSION).contains(&version)&&repo.schedule_execution_writes_enabled,"preparation_enabled":repo.schedule_preparation_enabled,"dispatch":if repo.schedule_dispatch_authority.is_some(){"native_candidate"}else{"disabled"},"platform_qualified":false}),
        );
    }
    let (_, _, _, write) = definition(name)?;
    if !(21..=crate::chat::migrations::MAX_READABLE_SCHEMA_VERSION).contains(&version) {
        return Err(E::StorageDisabled.into());
    }
    if write && !repo.schedule_execution_writes_enabled {
        return Err(P::StorageReadOnly.into());
    }
    if repo.manual_runtime.enabled && version < 25 && name == "schedule_confirm_rerun_v1" {
        return Err(E::ExecutionNotReady.into());
    }
    match name {
        "schedule_read_execution_receipt_v1" => repo.execution_receipt(decode(q)?, n),
        "schedule_read_draft_submission_receipt_v1" => repo.read_draft_submission_receipt(
            &decode::<wire::DraftSubmissionKey>(q)?.original_request_id,
        ),
        "schedule_submit_draft_v1" | "schedule_continue_draft_source_v1" => {
            let epoch = repo
                .draft_runtime
                .lifecycle
                .as_ref()
                .ok_or(P::DraftUnavailable)?
                .permit()
                .map_err(super::drafts::chat)?;
            let action = super::draft_runtime::Action {
                epoch,
                deadline: repo.schedule_ui_deadline.ok_or(P::ContextInvalid)?,
                revision: a.revision,
                context,
                ui: ui.clone(),
            };
            let receipt = if name == "schedule_submit_draft_v1" {
                repo.submit_draft(decode(q)?, request, n, a.revision)?
            } else {
                repo.continue_draft_source(&decode::<wire::DraftKey>(q)?.source_id)
                    .map_err(super::drafts::chat)?
            };
            repo.grant_draft_action(&receipt.source_id, action)
                .map_err(|_| Code::from(P::OperationUnknown))?;
            value(&receipt)
        }
        "schedule_find_draft_source_v1" => value(
            &repo
                .find_draft_source(decode(q)?)
                .map_err(super::drafts::chat)?,
        ),
        "schedule_preview_draft_v1" => {
            repo.preview_draft(&decode::<wire::DraftKey>(q)?.source_id, n)
        }
        "schedule_confirm_draft_v1" => value(&repo.confirm_draft(decode(q)?, request, n)?),
        "schedule_confirm_active_draft_v1" => {
            value(&repo.confirm_draft_with_activation(decode(q)?, request, n, Some(a))?)
        }
        "schedule_enable_plan_v1" => {
            value(&repo.enable_default_schedule(a, decode(q)?, request, n)?)
        }
        "schedule_save_active_plan_v1" => {
            let r: super::generated::SavePlanRequest = decode(q)?;
            if r.request_id != request {
                return Err(E::RequestConflict.into());
            }
            value(&repo.save_active_schedule(a, r, n)?)
        }
        "schedule_list_plans_v1"
        | "schedule_list_targets_v1"
        | "schedule_list_records_v1"
        | "schedule_list_plan_cards_v1"
        | "schedule_list_record_rows_v1" => {
            let mut filter = q.clone();
            filter
                .as_object_mut()
                .ok_or(E::InvalidInput)?
                .remove("cursor");
            let binding = format!(
                "{:x}",
                Sha256::digest(
                    serde_json::to_vec(&(
                        name,
                        context,
                        &repo.scope.owner_user_id,
                        &repo.scope.tenant_id,
                        filter
                    ))
                    .map_err(|_| E::InvalidInput)?
                )
            );
            let b = ipc.boundary(q, &binding, n)?;
            let limit = q["limit"].as_u64().unwrap_or(20) as usize;
            let page = match name {
                "schedule_list_plans_v1" => query::plans(repo, q, a, n, b.as_ref(), limit)?,
                "schedule_list_targets_v1" => query::targets(repo, q, b.as_ref(), limit)?,
                "schedule_list_plan_cards_v1" => {
                    query::plan_cards(repo, q, a, n, b.as_ref(), limit, version)?
                }
                "schedule_list_record_rows_v1" => {
                    query::record_rows(repo, q, a, n, b.as_ref(), limit)?
                }
                _ => query::records(repo, q, a, n, b.as_ref(), limit)?,
            };
            ipc.page(page, binding, n)
        }
        "schedule_read_plan_mutation_receipt_v1" => query::mutation_receipt(repo, q, a, n),
        "schedule_get_plan_v1" => query::detail(repo, &decode::<wire::PlanKey>(q)?.plan_id, a, n),
        "schedule_get_record_v1" => query::record_detail(repo, q, a, n),
        "schedule_list_important_updates_v1" => query::important_updates(repo),
        "schedule_preview_time_v1" => value(
            &super::time::preview(&decode::<wire::TimeQuery>(q)?.rule, n, n)
                .map_err(execution::plan_error)?,
        ),
        "schedule_save_plan_v1" => {
            let r: super::generated::SavePlanRequest = decode(q)?;
            if r.request_id != request {
                return Err(E::RequestConflict.into());
            }
            value(&repo.save_schedule(r, n).map_err(execution::plan_error)?)
        }
        "schedule_pause_plan_v1" | "schedule_delete_plan_v1" => {
            let p: wire::PlanMutation = decode(q)?;
            value(
                &repo
                    .change_schedule_state(
                        &p.plan_id,
                        p.expected_revision,
                        name == "schedule_delete_plan_v1",
                        Some(request),
                    )
                    .map_err(super::store::StateError::execution)?,
            )
        }
        "schedule_confirm_grant_v1" => {
            let r: super::execution_generated::GrantConfirmation = decode(q)?;
            if r.request_id != request {
                return Err(E::RequestConflict.into());
            }
            let action = super::draft_runtime::Action {
                epoch: repo
                    .manual_runtime
                    .lifecycle
                    .as_ref()
                    .map_or(0, |l| l.epoch()),
                deadline: repo.schedule_ui_deadline.ok_or(P::ContextInvalid)?,
                revision: a.revision,
                context,
                ui: ui.clone(),
            };
            value(&repo.manual_grant(a, r, n, action)?)
        }
        "schedule_confirm_enable_v1" => {
            let input: wire::EnableConfirmation = decode(q)?;
            if input.confirmation.request_id != request {
                return Err(E::RequestConflict.into());
            }
            Ok(super::automatic::receipt_value(
                repo.confirm_automatic_schedule(a, input, n)?,
            ))
        }
        "schedule_manual_run_v1" => {
            let r: wire::ManualInput = decode(q)?;
            value(&repo.manual_run(a, r, request, n, context)?)
        }
        "schedule_preview_rerun_v1" => {
            let r: wire::RerunInput = decode(q)?;
            value(&super::single::review(
                &repo.connection,
                &repo.scope,
                &r.original_run_id,
            )?)
        }
        "schedule_confirm_rerun_v1" => {
            value(&repo.rerun_run(a, decode(q)?, request, n, context)?)
        }
        "schedule_confirm_single_run_v1" => {
            let input: wire::SingleRunGrantConfirmation = decode(q)?;
            if input.confirmation.request_id != request {
                return Err(E::RequestConflict.into());
            }
            let action = super::draft_runtime::Action {
                epoch: repo
                    .manual_runtime
                    .lifecycle
                    .as_ref()
                    .map_or(0, |l| l.epoch()),
                deadline: repo.schedule_ui_deadline.ok_or(P::ContextInvalid)?,
                revision: a.revision,
                context,
                ui: ui.clone(),
            };
            value(&repo.single_grant(a, input, n, action)?)
        }
        _ => Err(E::InvalidInput.into()),
    }
}

#[cfg(test)]
pub(crate) async fn execute_composition_fixture(
    worker: &DatabaseWorker,
    authority: NativeAuthRuntime,
    ui: ChatAuthorizationManager,
    ipc: ScheduleIpcRuntime,
    request: Value,
    name: &'static str,
) -> Result<Value, Code> {
    execute(worker, authority, ui, ipc, request, name).await
}
