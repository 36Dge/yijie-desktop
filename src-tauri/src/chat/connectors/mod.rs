//! FEAT-157 native product management. Provider credentials never cross this IPC.
#[allow(dead_code)]
pub(crate) mod broker_generated;
pub(crate) mod control;
pub(crate) mod dispatch;
#[allow(dead_code)]
pub(crate) mod generated;
#[allow(dead_code, unused_imports)]
pub(crate) mod host_generated;
pub(crate) mod observe;
pub(crate) mod provider;
#[allow(dead_code)]
pub(crate) mod provider_generated;
pub(crate) mod selection;
#[cfg(test)]
mod selection_gate_tests;
#[allow(dead_code)]
pub(crate) mod selection_generated;
mod store;
#[cfg(test)]
mod tests;

use super::{authorization::AuthorizationFailure, database::ChatScope, ChatRuntime, RuntimeMode};
use generated as wire;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, sync::OnceLock};
use tauri::State;
use uuid::Uuid;
type Error = wire::ErrorCode;

pub(crate) fn enabled() -> bool {
    std::env::var("YIJIE_ENV").as_deref() == Ok("local")
        && std::env::var("YIJIE_LOCAL_PROFILE").as_deref() == Ok("demo_fast")
        && std::env::var("YIJIE_MARKET_CONNECTORS_ENABLED").as_deref() == Ok("true")
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Catalog {
    catalog_revision: i64,
    catalog: Vec<wire::CatalogEntry>,
}
fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let value: Catalog =
            serde_json::from_str(include_str!("../../../../contracts/market-catalog.json"))
                .expect("validated Connectors catalog");
        assert_eq!(value.catalog.len(), 58);
        value
    })
}
// Compiled transport support is distinct from live credential/connection authority.
fn supports_provider(service: &str) -> bool {
    catalog().catalog.iter().any(|entry| {
        entry.service_id == service
            && entry.availability != wire::Availability::Blocked
            && matches!(
                entry.auth_mode,
                wire::AuthMode::Oauth
                    | wire::AuthMode::ApiKey
                    | wire::AuthMode::ProviderCredentials
                    | wire::AuthMode::None
            )
    })
}
fn keyless_provider(service: &str) -> bool {
    service == "shopify"
        && catalog()
            .catalog
            .iter()
            .any(|entry| entry.service_id == service && entry.auth_mode == wire::AuthMode::None)
}
fn uses_credential_form(service: &str) -> bool {
    service == "google-calendar"
        || catalog().catalog.iter().any(|entry| {
            entry.service_id == service
                && matches!(
                    entry.auth_mode,
                    wire::AuthMode::ApiKey | wire::AuthMode::ProviderCredentials
                )
        })
}
// This is compiled support for the reviewed daily profile, not a current
// credential, connection, enabled installation or executable turn grant.
fn projected_catalog(native_enabled: bool) -> Vec<wire::CatalogEntry> {
    catalog()
        .catalog
        .iter()
        .cloned()
        .map(|mut entry| {
            entry.authorization_available =
                Some(native_enabled && entry.auth_mode == wire::AuthMode::Oauth);
            if native_enabled && supports_provider(&entry.service_id) {
                entry.availability = wire::Availability::Available;
                entry
                    .blocker_codes
                    .retain(|code| *code != Error::ProviderOnboardingRequired);
            }
            entry
        })
        .collect()
}
fn now() -> Result<i64, Error> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_secs()).ok())
        .ok_or(Error::TemporarilyUnavailable)
}
fn encode(value: &impl Serialize) -> Result<Value, Error> {
    serde_json::to_value(value).map_err(|_| Error::TemporarilyUnavailable)
}
#[derive(Clone)]
enum Action {
    Snapshot,
    Install(wire::InstallPayload),
    SetEnabled(wire::SetEnabledPayload),
    Uninstall(wire::UninstallPayload),
    Configure(wire::CredentialOperationPayload),
    Authorize(wire::CredentialOperationPayload),
    Operation(wire::OperationReadPayload),
    Cancel(wire::OperationCancelPayload),
    Reopen(wire::OperationCancelPayload),
    Selection(wire::SelectionValidatePayload),
}
impl Action {
    fn permission(&self) -> &'static str {
        match self {
            Self::Snapshot | Self::Operation(_) | Self::Cancel(_) => "connector.read",
            Self::Install(_) | Self::SetEnabled(_) | Self::Uninstall(_) => "connector.manage",
            Self::Configure(_) | Self::Authorize(_) | Self::Reopen(_) => {
                "connector.credentials.manage"
            }
            Self::Selection(_) => "connector.use",
        }
    }
}
fn decode(name: &str, value: Value) -> Result<(String, String, Action), Error> {
    macro_rules! request {
        ($ty:ty, $variant:ident) => {{
            let r: $ty = serde_json::from_value(value).map_err(|_| Error::InvalidRequest)?;
            Ok((r.request_id, r.context_id, Action::$variant(r.payload)))
        }};
    }
    match name {
        "market_connectors_snapshot_v1" => {
            let r: wire::SnapshotRequest =
                serde_json::from_value(value).map_err(|_| Error::InvalidRequest)?;
            Ok((r.request_id, r.context_id, Action::Snapshot))
        }
        "market_connectors_install_v1" => request!(wire::InstallRequest, Install),
        "market_connectors_set_enabled_v1" => request!(wire::SetEnabledRequest, SetEnabled),
        "market_connectors_uninstall_v1" => request!(wire::UninstallRequest, Uninstall),
        "market_connectors_configure_v1" => request!(wire::ConfigureRequest, Configure),
        "market_connectors_authorize_v1" => request!(wire::AuthorizeRequest, Authorize),
        "market_connectors_operation_read_v1" => request!(wire::OperationReadRequest, Operation),
        "market_connectors_operation_cancel_v1" => request!(wire::OperationCancelRequest, Cancel),
        "market_connectors_operation_reopen_v1" => request!(wire::OperationReopenRequest, Reopen),
        "market_connectors_selection_validate_v1" => {
            request!(wire::SelectionValidateRequest, Selection)
        }
        _ => Err(Error::UnsupportedCapability),
    }
}
fn auth_error(error: AuthorizationFailure) -> Error {
    match error {
        AuthorizationFailure::ContextInvalid => Error::ContextInvalid,
        AuthorizationFailure::CapabilityDenied => Error::PermissionDenied,
    }
}
fn apply(
    db: &mut rusqlite::Connection,
    scope: &ChatScope,
    action: Action,
    capabilities: &HashSet<String>,
    timestamp: i64,
) -> Result<Value, Error> {
    let product = catalog();
    match action {
        Action::Snapshot => {
            let caps = wire::CONNECTOR_CAPABILITIES
                .iter()
                .filter(|key| capabilities.contains(**key))
                .map(|key| {
                    serde_json::from_value::<wire::Permission>(Value::String((*key).into()))
                        .map_err(|_| Error::UnsupportedCapability)
                })
                .collect::<Result<Vec<_>, _>>()?;
            encode(&wire::Snapshot {
                catalog_revision: product.catalog_revision,
                catalog: projected_catalog(enabled()),
                installations: store::list(db, scope, &product.catalog)?,
                capabilities: caps,
                execution_available: false,
            })
        }
        Action::Install(payload) => {
            let entry = product
                .catalog
                .iter()
                .find(|e| e.service_id == payload.service_id)
                .ok_or(Error::NotFound)?;
            encode(&store::install(
                db,
                scope,
                entry,
                product.catalog_revision,
                payload,
                timestamp,
            )?)
        }
        Action::SetEnabled(payload) => {
            let action = if payload.desired_enabled {
                wire::OperationAction::Enable
            } else {
                wire::OperationAction::Disable
            };
            encode(&store::local_change(
                db,
                scope,
                &product.catalog,
                &wire::InstallationOperationPayload {
                    installation_id: payload.installation_id.clone(),
                    operation_id: payload.operation_id.clone(),
                    expected_revision: payload.expected_revision,
                },
                action,
                &payload,
                timestamp,
            )?)
        }
        Action::Uninstall(payload) => encode(&store::local_change(
            db,
            scope,
            &product.catalog,
            &wire::InstallationOperationPayload {
                installation_id: payload.installation_id.clone(),
                operation_id: payload.operation_id.clone(),
                expected_revision: payload.expected_revision,
            },
            wire::OperationAction::Uninstall,
            &payload,
            timestamp,
        )?),
        Action::Configure(payload) | Action::Authorize(payload) => {
            let item = store::find(db, scope, &product.catalog, &payload.installation_id)?;
            if item.revision != payload.expected_revision
                || item.generation != payload.expected_generation
            {
                return Err(Error::RevisionConflict);
            }
            // No URL or credential is accepted from the renderer. Until the
            // Broker native handoff is qualified this capability stays closed.
            Err(Error::UnsupportedCapability)
        }
        Action::Operation(payload) => {
            encode(&store::operation(db, scope, &payload.operation_id)?.operation)
        }
        Action::Reopen(_) => Err(Error::UnsupportedCapability),
        Action::Cancel(payload) => {
            let result = store::operation(db, scope, &payload.operation_id)?;
            let required = match result.operation.action {
                wire::OperationAction::Configure | wire::OperationAction::Authorize => {
                    "connector.credentials.manage"
                }
                _ => "connector.manage",
            };
            if !capabilities.contains(required) {
                return Err(Error::PermissionDenied);
            }
            if result.operation.revision != payload.expected_revision {
                return Err(Error::RevisionConflict);
            }
            if result.operation.cancellable {
                return Err(Error::OperationPending);
            }
            // Re-reading a terminal operation never reverses its effects.
            encode(&result.operation)
        }
        Action::Selection(payload) => {
            let mut ids = HashSet::new();
            for selected in &payload.selection {
                if !ids.insert(&selected.installation_id) {
                    return Err(Error::InvalidRequest);
                }
                let item = store::find(db, scope, &product.catalog, &selected.installation_id)?;
                if item.revision != selected.revision || item.generation != selected.generation {
                    return Err(Error::SelectionStale);
                }
            }
            if !payload.selection.is_empty() {
                return Err(Error::ExecutionUnavailable);
            }
            encode(&wire::SelectionValidation {
                selection: Vec::new(),
                execution_available: false,
            })
        }
    }
}

fn apply_observation(
    db: &mut rusqlite::Connection,
    scope: &ChatScope,
    action: Action,
    capabilities: &HashSet<String>,
    timestamp: i64,
    admission: Option<&provider::ProviderAdmission>,
) -> Result<Value, Error> {
    match action {
        Action::Snapshot => {
            let mut snapshot: wire::Snapshot = serde_json::from_value(apply(
                db,
                scope,
                Action::Snapshot,
                capabilities,
                timestamp,
            )?)
            .map_err(|_| Error::TemporarilyUnavailable)?;
            if let Some(admission) = admission {
                for item in &mut snapshot.installations {
                    admission.project_installation(scope, item);
                }
            }
            snapshot.execution_available = snapshot
                .installations
                .iter()
                .any(|item| item.effective_enabled);
            encode(&snapshot)
        }
        Action::Selection(payload) if !payload.selection.is_empty() => {
            let admission = admission.ok_or(Error::ExecutionUnavailable)?;
            provider::preflight(db, scope, &payload.selection, admission)?;
            let mut selection = Vec::new();
            for reference in payload.selection {
                let item = store::find(db, scope, &catalog().catalog, &reference.installation_id)?;
                let entry = catalog()
                    .catalog
                    .iter()
                    .find(|entry| entry.service_id == item.service_id)
                    .ok_or(Error::NotFound)?;
                selection.push(wire::SelectionDisplay {
                    reference,
                    service_id: item.service_id,
                    display_name: entry.display_name.clone(),
                });
            }
            encode(&wire::SelectionValidation {
                selection,
                execution_available: true,
            })
        }
        other => apply(db, scope, other, capabilities, timestamp),
    }
}
async fn command(raw: Value, runtime: &ChatRuntime, name: &str) -> Result<Value, wire::Error> {
    let known_id = raw
        .get("requestId")
        .and_then(Value::as_str)
        .filter(|s| store::id(s).is_ok())
        .map(str::to_owned);
    let result = async {
        let (request_id, context, action) = decode(name, raw)?;
        if !enabled() {
            return Err(Error::UnsupportedCapability);
        }
        let scope = match &runtime.mode {
            RuntimeMode::Local(config) => config.scope.clone(),
            _ => return Err(Error::PermissionDenied),
        };
        let context = Uuid::parse_str(&context).map_err(|_| Error::ContextInvalid)?;
        let authorization = runtime
            .authorization_manager()
            .map_err(|_| Error::ContextInvalid)?;
        let permission = action.permission();
        authorization
            .with_connector_context(context, &scope, permission, now()?, |_| ())
            .map_err(auth_error)?;
        if let Some(data) = provider::handle(
            runtime,
            authorization.clone(),
            context,
            scope.clone(),
            action.clone(),
        )
        .await?
        {
            return Ok(serde_json::json!({"schemaVersion":1,"requestId":request_id,"data":data}));
        }
        let worker = runtime
            .database()
            .await
            .map_err(|_| Error::TemporarilyUnavailable)?;
        let data = worker
            .call(move |repo| {
                Ok(authorization
                    .with_connector_context(
                        context,
                        &scope,
                        permission,
                        now().map_err(|_| super::error::ChatError::DatabaseUnavailable)?,
                        |caps| {
                            apply(
                                &mut repo.connection,
                                &scope,
                                action,
                                caps,
                                now().unwrap_or(-1),
                            )
                        },
                    )
                    .map_err(auth_error)
                    .and_then(|value| value))
            })
            .await
            .map_err(|_| Error::TemporarilyUnavailable)??;
        Ok(serde_json::json!({"schemaVersion":1,"requestId":request_id,"data":data}))
    }
    .await;
    result.map_err(|code| wire::Error {
        schema_version: 1,
        request_id: known_id,
        retryable: matches!(
            code,
            Error::TemporarilyUnavailable | Error::OperationPending
        ),
        code,
    })
}
macro_rules! command {
    ($name:ident) => {
        #[tauri::command]
        pub(crate) async fn $name(
            request: Value,
            chat_runtime: State<'_, ChatRuntime>,
        ) -> Result<Value, wire::Error> {
            command(request, &chat_runtime, stringify!($name)).await
        }
    };
}
command!(market_connectors_snapshot_v1);
command!(market_connectors_install_v1);
command!(market_connectors_set_enabled_v1);
command!(market_connectors_uninstall_v1);
command!(market_connectors_configure_v1);
command!(market_connectors_authorize_v1);
command!(market_connectors_operation_read_v1);
command!(market_connectors_operation_cancel_v1);
command!(market_connectors_operation_reopen_v1);
command!(market_connectors_selection_validate_v1);
