//! Non-secret product intent and durable idempotent receipts in the existing
//! SQLCipher connection. Live credentials/connection readiness belong to Broker.
use super::generated as wire;
use crate::chat::database::ChatScope;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use uuid::Uuid;

type Error = wire::ErrorCode;
type Result<T> = std::result::Result<T, Error>;
const MAX_REVISION: i64 = 9_007_199_254_740_991;

fn sql<T>(r: rusqlite::Result<T>) -> Result<T> {
    r.map_err(|_| Error::TemporarilyUnavailable)
}
fn encode<T: serde::Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|_| Error::TemporarilyUnavailable)
}
fn decode<T: serde::de::DeserializeOwned>(value: &str) -> Result<T> {
    serde_json::from_str(value).map_err(|_| Error::TemporarilyUnavailable)
}
pub(super) fn id(value: &str) -> Result<()> {
    if Uuid::parse_str(value).is_ok_and(|id| !id.is_nil() && id.to_string() == value) {
        Ok(())
    } else {
        Err(Error::InvalidRequest)
    }
}
fn next(value: i64) -> Result<i64> {
    value
        .checked_add(1)
        .filter(|n| *n <= MAX_REVISION)
        .ok_or(Error::RevisionConflict)
}
fn require_storage(db: &Connection) -> Result<()> {
    let exists: bool = sql(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='chat_connector_installations' AND type='table')",
        [], |r| r.get(0)))?;
    if exists {
        Ok(())
    } else {
        Err(Error::UnsupportedCapability)
    }
}
fn auth_status(entry: &wire::CatalogEntry) -> wire::AuthorizationStatus {
    match entry.auth_mode {
        wire::AuthMode::None => wire::AuthorizationStatus::NotRequired,
        wire::AuthMode::Oauth | wire::AuthMode::LocalOauth | wire::AuthMode::ProviderGateway => {
            wire::AuthorizationStatus::Required
        }
        _ => wire::AuthorizationStatus::Unknown,
    }
}
fn row(r: &rusqlite::Row<'_>, entry: &wire::CatalogEntry) -> rusqlite::Result<wire::Installation> {
    let installed: bool = r.get(4)?;
    let credential_ref: Option<String> = r.get(6)?;
    Ok(wire::Installation {
        installation_id: r.get(0)?,
        service_id: r.get(1)?,
        revision: r.get(2)?,
        generation: r.get(3)?,
        status: if installed {
            wire::InstallationStatus::Installed
        } else {
            wire::InstallationStatus::Removed
        },
        desired_enabled: r.get(5)?,
        // Persisted user intent is never evidence of a live connection.
        effective_enabled: false,
        configuration_status: if super::keyless_provider(&entry.service_id) {
            wire::ConfigurationStatus::Configured
        } else if credential_ref.is_some() {
            wire::ConfigurationStatus::Unknown
        } else {
            wire::ConfigurationStatus::Unconfigured
        },
        authorization_status: auth_status(entry),
        connection_status: wire::ConnectionStatus::Disconnected,
        credential_ref,
        active_operation: None,
        error_code: None,
    })
}
pub(super) fn lookup(
    db: &Connection,
    scope: &ChatScope,
    entry: &wire::CatalogEntry,
) -> Result<Option<wire::Installation>> {
    require_storage(db)?;
    let mut item = sql(db.query_row(
        "SELECT installation_id,service_id,revision,generation,installed,desired_enabled,credential_ref FROM chat_connector_installations WHERE owner_user_id=?1 AND tenant_id=?2 AND service_id=?3 AND format_version=1",
        params![scope.owner_user_id, scope.tenant_id, entry.service_id], |r| row(r, entry)).optional())?;
    if let Some(item) = item.as_mut() {
        if provider_storage(db)? {
            let record: Option<(Option<String>,String)> = sql(db.query_row("SELECT p.observation_json,o.response_json FROM chat_connector_provider_operations p JOIN chat_connector_operations o USING(owner_user_id,tenant_id,operation_id) WHERE p.owner_user_id=?1 AND p.tenant_id=?2 AND p.installation_id=?3 ORDER BY p.created_at DESC,p.rowid DESC LIMIT 1",params![scope.owner_user_id,scope.tenant_id,item.installation_id],|r|Ok((r.get(0)?,r.get(1)?))).optional())?;
            if let Some((observed, receipt)) = record {
                let result: wire::MutationResult = decode(&receipt)?;
                if result.installation.revision == item.revision
                    && result.installation.generation == item.generation
                {
                    if let Some(observed) = observed {
                        let observed: super::provider_generated::ProviderStatus =
                            decode(&observed)?;
                        if item.credential_ref.as_ref() == Some(&observed.binding.credential_ref) {
                            project_provider(item, &observed);
                            // Historical metadata is not current Host connectivity.
                            item.connection_status = wire::ConnectionStatus::Disconnected;
                        }
                    }
                    item.active_operation = matches!(
                        result.operation.status,
                        wire::OperationStatus::Pending | wire::OperationStatus::Unknown
                    )
                    .then_some(result.operation);
                    item.error_code = result.installation.error_code;
                }
            }
        }
    }
    Ok(item)
}
pub(super) fn list(
    db: &Connection,
    scope: &ChatScope,
    catalog: &[wire::CatalogEntry],
) -> Result<Vec<wire::Installation>> {
    require_storage(db)?;
    let mut out = Vec::new();
    for entry in catalog {
        if let Some(item) = lookup(db, scope, entry)? {
            if item.status != wire::InstallationStatus::Removed {
                out.push(item);
            }
        }
    }
    Ok(out)
}
pub(super) fn find(
    db: &Connection,
    scope: &ChatScope,
    catalog: &[wire::CatalogEntry],
    installation: &str,
) -> Result<wire::Installation> {
    id(installation)?;
    list(db, scope, catalog)?
        .into_iter()
        .find(|i| i.installation_id == installation)
        .ok_or(Error::NotFound)
}
fn digest(action: wire::OperationAction, payload: &impl serde::Serialize) -> Result<String> {
    let text = encode(&(action, payload))?;
    Ok(format!("{:x}", Sha256::digest(text.as_bytes())))
}
fn replay(
    db: &Connection,
    scope: &ChatScope,
    operation: &str,
    digest: &str,
) -> Result<Option<wire::MutationResult>> {
    id(operation)?;
    let found: Option<(String, String)> = sql(db.query_row(
        "SELECT request_digest,response_json FROM chat_connector_operations WHERE operation_id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND format_version=1",
        params![operation, scope.owner_user_id, scope.tenant_id], |r| Ok((r.get(0)?, r.get(1)?))).optional())?;
    found
        .map(|(saved, value)| {
            if saved != digest {
                return Err(Error::RequestConflict);
            }
            decode(&value)
        })
        .transpose()
}
fn save(
    db: &Connection,
    scope: &ChatScope,
    result: &wire::MutationResult,
    digest: &str,
    now: i64,
) -> Result<()> {
    sql(db.execute(
        "INSERT INTO chat_connector_operations(operation_id,owner_user_id,tenant_id,installation_id,request_digest,format_version,response_json,created_at) VALUES(?1,?2,?3,?4,?5,1,?6,?7)",
        params![result.operation.operation_id,scope.owner_user_id,scope.tenant_id,result.installation.installation_id,digest,encode(result)?,now]))?;
    Ok(())
}
fn receipt(
    installation: wire::Installation,
    operation: &str,
    action: wire::OperationAction,
    error: Option<Error>,
) -> wire::MutationResult {
    wire::MutationResult {
        operation: wire::Operation {
            operation_id: operation.to_owned(),
            installation_id: installation.installation_id.clone(),
            service_id: installation.service_id.clone(),
            action,
            status: if error.is_some() {
                wire::OperationStatus::Failed
            } else {
                wire::OperationStatus::Succeeded
            },
            revision: 1,
            cancellable: false,
            error_code: error,
        },
        installation,
    }
}
pub(super) fn install(
    db: &mut Connection,
    scope: &ChatScope,
    entry: &wire::CatalogEntry,
    catalog_revision: i64,
    payload: wire::InstallPayload,
    now: i64,
) -> Result<wire::MutationResult> {
    require_storage(db)?;
    if payload.expected_revision != 0 || payload.service_id != entry.service_id || now < 0 {
        return Err(Error::InvalidRequest);
    }
    let hash = digest(wire::OperationAction::Install, &payload)?;
    let tx = sql(db.transaction())?;
    if let Some(result) = replay(&tx, scope, &payload.operation_id, &hash)? {
        return Ok(result);
    }
    let old = lookup(&tx, scope, entry)?;
    if old
        .as_ref()
        .is_some_and(|i| i.status != wire::InstallationStatus::Removed)
    {
        return Err(Error::RevisionConflict);
    }
    let (installation, revision, generation) = match old {
        Some(i) => (i.installation_id, next(i.revision)?, next(i.generation)?),
        None => (Uuid::now_v7().to_string(), 1, 1),
    };
    sql(tx.execute(
        "INSERT INTO chat_connector_installations(installation_id,owner_user_id,tenant_id,service_id,format_version,revision,generation,catalog_revision,installed,desired_enabled,created_at,updated_at) VALUES(?1,?2,?3,?4,1,?5,?6,?7,1,0,?8,?8) ON CONFLICT(owner_user_id,tenant_id,service_id) DO UPDATE SET revision=excluded.revision,generation=excluded.generation,catalog_revision=excluded.catalog_revision,installed=1,desired_enabled=0,credential_ref=NULL,updated_at=excluded.updated_at",
        params![installation,scope.owner_user_id,scope.tenant_id,entry.service_id,revision,generation,catalog_revision,now]))?;
    let result = receipt(
        lookup(&tx, scope, entry)?.ok_or(Error::NotFound)?,
        &payload.operation_id,
        wire::OperationAction::Install,
        None,
    );
    save(&tx, scope, &result, &hash, now)?;
    sql(tx.commit())?;
    Ok(result)
}
/// The local phase may complete disable/removal only when no credential or
/// external operation is owned. Otherwise cleanup needs the Broker receipt.
pub(super) fn local_change(
    db: &mut Connection,
    scope: &ChatScope,
    catalog: &[wire::CatalogEntry],
    key: &wire::InstallationOperationPayload,
    action: wire::OperationAction,
    payload: &impl serde::Serialize,
    now: i64,
) -> Result<wire::MutationResult> {
    let installation_id = &key.installation_id;
    let operation_id = &key.operation_id;
    let expected_revision = key.expected_revision;
    require_storage(db)?;
    if now < 0 || !(1..=MAX_REVISION).contains(&expected_revision) {
        return Err(Error::InvalidRequest);
    }
    let hash = digest(action, payload)?;
    let tx = sql(db.transaction())?;
    if let Some(result) = replay(&tx, scope, operation_id, &hash)? {
        return Ok(result);
    }
    let mut item = find(&tx, scope, catalog, installation_id)?;
    if item.revision != expected_revision {
        return Err(Error::RevisionConflict);
    }
    let failure = match action {
        wire::OperationAction::Disable | wire::OperationAction::Uninstall => {
            if item.credential_ref.is_some() {
                Some(Error::CleanupPending)
            } else {
                None
            }
        }
        wire::OperationAction::Enable => Some(Error::NotConfigured),
        _ => Some(Error::UnsupportedCapability),
    };
    if failure.is_none() {
        item.revision = next(item.revision)?;
        item.generation = next(item.generation)?;
        item.desired_enabled = false;
        let installed = action != wire::OperationAction::Uninstall;
        item.status = if installed {
            wire::InstallationStatus::Installed
        } else {
            wire::InstallationStatus::Removed
        };
        sql(tx.execute(
            "UPDATE chat_connector_installations SET revision=?1,generation=?2,desired_enabled=0,installed=?3,updated_at=?4 WHERE installation_id=?5 AND owner_user_id=?6 AND tenant_id=?7",
            params![item.revision,item.generation,installed,now,item.installation_id,scope.owner_user_id,scope.tenant_id]))?;
    }
    let result = receipt(item, operation_id, action, failure);
    save(&tx, scope, &result, &hash, now)?;
    sql(tx.commit())?;
    Ok(result)
}
pub(super) fn operation(
    db: &Connection,
    scope: &ChatScope,
    operation_id: &str,
) -> Result<wire::MutationResult> {
    require_storage(db)?;
    id(operation_id)?;
    let text: Option<String> = sql(db.query_row(
        "SELECT response_json FROM chat_connector_operations WHERE operation_id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND format_version=1",
        params![operation_id,scope.owner_user_id,scope.tenant_id], |r| r.get(0)).optional())?;
    decode(&text.ok_or(Error::NotFound)?)
}

#[derive(Clone)]
pub(super) struct ProviderOperation {
    pub payload: super::provider_generated::ProviderPayload,
    pub kind: String,
    pub browser_opened: bool,
    pub result: wire::MutationResult,
    // Process-local return fact only; never inferred from a pending DB row.
    pub newly_created: bool,
}
fn provider_storage(db: &Connection) -> Result<bool> {
    sql(db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='chat_connector_provider_operations')", [], |r|r.get(0)))
}
pub(super) fn provider_operation(
    db: &Connection,
    scope: &ChatScope,
    operation_id: &str,
) -> Result<Option<ProviderOperation>> {
    if !provider_storage(db)? {
        return Ok(None);
    }
    let row: Option<(String,String,bool)> = sql(db.query_row("SELECT payload_json,kind,browser_opened FROM chat_connector_provider_operations WHERE owner_user_id=?1 AND tenant_id=?2 AND operation_id=?3",params![scope.owner_user_id,scope.tenant_id,operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional())?;
    row.map(|(payload, kind, browser_opened)| {
        Ok(ProviderOperation {
            payload: decode(&payload)?,
            kind,
            browser_opened,
            result: operation(db, scope, operation_id)?,
            newly_created: false,
        })
    })
    .transpose()
}

pub(super) struct ProviderIntent<'a> {
    pub key: &'a wire::InstallationOperationPayload,
    pub expected_generation: Option<i64>,
    pub action: wire::OperationAction,
    pub intent: &'a serde_json::Value,
    pub host: &'a str,
    pub authority: super::broker_generated::ScopeBinding,
    pub now: i64,
}
pub(super) fn check_provider_change(
    db: &Connection,
    scope: &ChatScope,
    catalog: &[wire::CatalogEntry],
    key: &wire::InstallationOperationPayload,
    expected_generation: Option<i64>,
    action: wire::OperationAction,
) -> Result<wire::Installation> {
    if !provider_storage(db)? {
        return Err(Error::UnsupportedCapability);
    }
    let item = find(db, scope, catalog, &key.installation_id)?;
    if item.revision != key.expected_revision
        || expected_generation.is_some_and(|generation| generation != item.generation)
    {
        return Err(Error::RevisionConflict);
    }
    let forget = matches!(
        action,
        wire::OperationAction::Disable | wire::OperationAction::Uninstall
    );
    if !super::supports_provider(&item.service_id) && !forget {
        return Err(Error::UnsupportedCapability);
    }
    if !matches!(
        action,
        wire::OperationAction::Authorize
            | wire::OperationAction::Configure
            | wire::OperationAction::Enable
            | wire::OperationAction::Disable
            | wire::OperationAction::Uninstall
    ) {
        return Err(Error::UnsupportedCapability);
    }
    if !forget {
        let pending:bool=sql(db.query_row("SELECT EXISTS(SELECT 1 FROM chat_connector_operations WHERE owner_user_id=?1 AND tenant_id=?2 AND installation_id=?3 AND json_extract(response_json,'$.operation.status') IN ('pending','unknown'))",params![scope.owner_user_id,scope.tenant_id,item.installation_id],|r|r.get(0)))?;
        if pending {
            return Err(Error::OperationPending);
        }
    }
    if !matches!(
        action,
        wire::OperationAction::Authorize | wire::OperationAction::Configure
    ) && item.credential_ref.is_none()
        && !(action == wire::OperationAction::Enable && super::keyless_provider(&item.service_id))
    {
        return Err(Error::NotConfigured);
    }
    Ok(item)
}
pub(super) fn prepare_provider(
    db: &mut Connection,
    scope: &ChatScope,
    catalog: &[wire::CatalogEntry],
    intent: ProviderIntent<'_>,
) -> Result<ProviderOperation> {
    if !provider_storage(db)? {
        return Err(Error::UnsupportedCapability);
    }
    let hash = digest(intent.action, intent.intent)?;
    let tx = sql(db.transaction())?;
    if replay(&tx, scope, &intent.key.operation_id, &hash)?.is_some() {
        return provider_operation(&tx, scope, &intent.key.operation_id)?
            .ok_or(Error::RequestConflict);
    }
    let mut item = check_provider_change(
        &tx,
        scope,
        catalog,
        intent.key,
        intent.expected_generation,
        intent.action,
    )?;
    let kind = match intent.action {
        wire::OperationAction::Authorize | wire::OperationAction::Configure => "auth",
        wire::OperationAction::Enable => "probe",
        wire::OperationAction::Disable | wire::OperationAction::Uninstall => "forget",
        _ => return Err(Error::UnsupportedCapability),
    };
    item.revision = next(item.revision)?;
    item.desired_enabled = false;
    let credential_ref = item
        .credential_ref
        .clone()
        .unwrap_or_else(|| Uuid::now_v7().to_string());
    item.credential_ref = Some(credential_ref.clone());
    let payload = super::provider_generated::ProviderPayload {
        operation_id: intent.key.operation_id.clone(),
        host_instance_id: intent.host.into(),
        scope: intent.authority,
        binding: super::provider_generated::ProviderBinding {
            reference: wire::SelectionRef {
                installation_id: item.installation_id.clone(),
                revision: item.revision,
                generation: item.generation,
            },
            service_id: item.service_id.clone(),
            credential_ref,
        },
    };
    payload.validate().map_err(|_| Error::InvalidRequest)?;
    sql(tx.execute("UPDATE chat_connector_installations SET revision=?1,desired_enabled=0,credential_ref=?2,updated_at=?3 WHERE installation_id=?4 AND owner_user_id=?5 AND tenant_id=?6",params![item.revision,item.credential_ref,intent.now,item.installation_id,scope.owner_user_id,scope.tenant_id]))?;
    let mut result = receipt(item, &intent.key.operation_id, intent.action, None);
    result.operation.status = wire::OperationStatus::Pending;
    result.operation.cancellable = kind != "forget";
    result.installation.active_operation = Some(result.operation.clone());
    save(&tx, scope, &result, &hash, intent.now)?;
    sql(tx.execute("INSERT INTO chat_connector_provider_operations(operation_id,owner_user_id,tenant_id,installation_id,kind,payload_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)",params![intent.key.operation_id,scope.owner_user_id,scope.tenant_id,result.installation.installation_id,kind,encode(&payload)?,intent.now]))?;
    sql(tx.commit())?;
    Ok(ProviderOperation {
        payload,
        kind: kind.into(),
        browser_opened: false,
        result,
        newly_created: true,
    })
}

fn provider_error(code: super::provider_generated::ErrorCode) -> Error {
    use super::provider_generated::ErrorCode as P;
    match code {
        P::AuthorityMismatch | P::ScopeExpired => Error::ContextInvalid,
        P::BindingMismatch => Error::RevisionConflict,
        P::NotFound => Error::NotFound,
        P::RequestConflict => Error::RequestConflict,
        P::NotQualified => Error::ProviderOnboardingRequired,
        P::AuthorizationRejected => Error::AuthorizationCancelled,
        P::AuthorizationTimeout => Error::AuthorizationRequired,
        P::CleanupPending => Error::CleanupPending,
        P::CapacityExceeded => Error::OperationPending,
        _ => Error::TemporarilyUnavailable,
    }
}
fn project_provider(
    item: &mut wire::Installation,
    status: &super::provider_generated::ProviderStatus,
) {
    use super::provider_generated as p;
    item.configuration_status = if status.authorization_status == p::AuthorizationStatus::Authorized
    {
        wire::ConfigurationStatus::Configured
    } else {
        wire::ConfigurationStatus::Unknown
    };
    item.authorization_status = match status.authorization_status {
        p::AuthorizationStatus::Authorized => wire::AuthorizationStatus::Authorized,
        p::AuthorizationStatus::Authorizing => wire::AuthorizationStatus::Authorizing,
        p::AuthorizationStatus::Unauthorized => wire::AuthorizationStatus::Required,
        p::AuthorizationStatus::Error => wire::AuthorizationStatus::Failed,
        p::AuthorizationStatus::Unknown => wire::AuthorizationStatus::Unknown,
    };
    if super::keyless_provider(&item.service_id) {
        item.configuration_status = wire::ConfigurationStatus::Configured;
        item.authorization_status = wire::AuthorizationStatus::NotRequired;
    }
    item.connection_status = match status.connection_status {
        p::ConnectionStatus::Connected => wire::ConnectionStatus::Ready,
        p::ConnectionStatus::Connecting => wire::ConnectionStatus::Connecting,
        p::ConnectionStatus::Error => wire::ConnectionStatus::Failed,
        p::ConnectionStatus::Disconnected => wire::ConnectionStatus::Disconnected,
    };
    // Saved observations cannot prove a current worker, tool qualification or grant.
    item.effective_enabled = false;
    item.error_code = status.error_code.map(provider_error);
}
pub(super) fn finish_provider(
    db: &mut Connection,
    scope: &ChatScope,
    expected: &ProviderOperation,
    mut status: super::provider_generated::ProviderStatus,
    now: i64,
) -> Result<ProviderOperation> {
    use super::provider_generated as p;
    status.validate().map_err(|_| Error::OutcomeUnknown)?;
    if status.operation_id != expected.payload.operation_id
        || status.host_instance_id != expected.payload.host_instance_id
        || status.binding != expected.payload.binding
        || status.scope != expected.payload.scope
    {
        return Err(Error::OutcomeUnknown);
    }
    status.authorization_url = None;
    let tx = sql(db.transaction())?;
    let mut current =
        provider_operation(&tx, scope, &status.operation_id)?.ok_or(Error::NotFound)?;
    // A terminal Native receipt is immutable; repeated poll cannot redo effects.
    if !matches!(
        current.result.operation.status,
        wire::OperationStatus::Pending | wire::OperationStatus::Unknown
    ) {
        return Ok(current);
    }
    let original = &current.payload.binding.reference;
    let mut item = find(
        &tx,
        scope,
        &super::catalog().catalog,
        &original.installation_id,
    )?;
    if item.revision != original.revision
        || item.generation != original.generation
        || item.credential_ref.as_ref() != Some(&current.payload.binding.credential_ref)
    {
        return Err(Error::SelectionStale);
    }
    project_provider(&mut item, &status);
    current.result.operation.status = match status.operation_state {
        p::OperationState::Starting | p::OperationState::AwaitingUser => {
            wire::OperationStatus::Pending
        }
        p::OperationState::Succeeded => wire::OperationStatus::Succeeded,
        p::OperationState::Failed => wire::OperationStatus::Failed,
        p::OperationState::Cancelled => wire::OperationStatus::Cancelled,
    };
    current.result.operation.error_code = status.error_code.map(provider_error);
    if current.kind == "probe" && status.operation_state == p::OperationState::Succeeded {
        let qualified = current.result.operation.action == wire::OperationAction::Enable
            && status.qualification == p::Qualification::Qualified
            && status.authorization_status == p::AuthorizationStatus::Authorized
            && status.connection_status == p::ConnectionStatus::Connected
            && status.execution_available;
        if qualified {
            // Persist only the explicit user's intent. The same revision is
            // already frozen in the live provider binding; completion must not
            // silently replace that binding or persist effective readiness.
            item.desired_enabled = true;
            sql(tx.execute("UPDATE chat_connector_installations SET desired_enabled=1,updated_at=?1 WHERE installation_id=?2 AND owner_user_id=?3 AND tenant_id=?4 AND revision=?5 AND generation=?6",params![now,item.installation_id,scope.owner_user_id,scope.tenant_id,item.revision,item.generation]))?;
        } else {
            current.result.operation.status = wire::OperationStatus::Failed;
            current.result.operation.error_code = Some(Error::ProviderOnboardingRequired);
            item.error_code = Some(Error::ProviderOnboardingRequired);
        }
    }
    if current.kind == "forget" && status.operation_state == p::OperationState::Succeeded {
        // Once the owned vault deletion is confirmed, earlier superseded
        // authorization/probe intents cannot remain pending or resume later.
        let prior: Vec<(String, String)> = {
            let mut q=sql(tx.prepare("SELECT operation_id,response_json FROM chat_connector_operations WHERE owner_user_id=?1 AND tenant_id=?2 AND installation_id=?3 AND operation_id<>?4 AND json_extract(response_json,'$.operation.status') IN ('pending','unknown')"))?;
            let rows = sql(q.query_map(
                params![
                    scope.owner_user_id,
                    scope.tenant_id,
                    item.installation_id,
                    status.operation_id
                ],
                |r| Ok((r.get(0)?, r.get(1)?)),
            ))?;
            sql(rows.collect())?
        };
        for (operation_id, text) in prior {
            let mut old: wire::MutationResult = decode(&text)?;
            old.operation.status = wire::OperationStatus::Cancelled;
            old.operation.cancellable = false;
            old.operation.revision = next(old.operation.revision)?;
            old.operation.error_code = Some(Error::AuthorizationCancelled);
            old.installation.active_operation = None;
            sql(tx.execute("UPDATE chat_connector_operations SET response_json=?1 WHERE owner_user_id=?2 AND tenant_id=?3 AND operation_id=?4",params![encode(&old)?,scope.owner_user_id,scope.tenant_id,operation_id]))?;
        }
        item.generation = next(item.generation)?;
        item.revision = next(item.revision)?;
        item.credential_ref = None;
        item.desired_enabled = false;
        let installed = current.result.operation.action != wire::OperationAction::Uninstall;
        item.status = if installed {
            wire::InstallationStatus::Installed
        } else {
            wire::InstallationStatus::Removed
        };
        item.configuration_status = wire::ConfigurationStatus::Unconfigured;
        item.authorization_status = wire::AuthorizationStatus::Required;
        item.connection_status = wire::ConnectionStatus::Disconnected;
        sql(tx.execute("UPDATE chat_connector_installations SET revision=?1,generation=?2,credential_ref=NULL,desired_enabled=0,installed=?3,updated_at=?4 WHERE installation_id=?5 AND owner_user_id=?6 AND tenant_id=?7",params![item.revision,item.generation,installed,now,item.installation_id,scope.owner_user_id,scope.tenant_id]))?;
    }
    current.result.operation.cancellable = current.kind != "forget"
        && current.result.operation.status == wire::OperationStatus::Pending;
    if current.result.operation != expected.result.operation {
        current.result.operation.revision = next(current.result.operation.revision)?;
    }
    item.active_operation = (current.result.operation.status == wire::OperationStatus::Pending)
        .then(|| current.result.operation.clone());
    current.result.installation = item;
    sql(tx.execute("UPDATE chat_connector_operations SET response_json=?1 WHERE owner_user_id=?2 AND tenant_id=?3 AND operation_id=?4",params![encode(&current.result)?,scope.owner_user_id,scope.tenant_id,status.operation_id]))?;
    sql(tx.execute("UPDATE chat_connector_provider_operations SET observation_json=?1,updated_at=?2 WHERE owner_user_id=?3 AND tenant_id=?4 AND operation_id=?5",params![encode(&status)?,now,scope.owner_user_id,scope.tenant_id,status.operation_id]))?;
    sql(tx.commit())?;
    Ok(current)
}
pub(super) fn reserve_provider_browser(
    db: &Connection,
    scope: &ChatScope,
    operation_id: &str,
) -> Result<bool> {
    Ok(sql(db.execute("UPDATE chat_connector_provider_operations SET browser_opened=1 WHERE owner_user_id=?1 AND tenant_id=?2 AND operation_id=?3 AND browser_opened=0",params![scope.owner_user_id,scope.tenant_id,operation_id]))?==1)
}

pub(super) fn verify_provider_replay(
    db: &Connection,
    scope: &ChatScope,
    id: &str,
    action: wire::OperationAction,
    intent: &serde_json::Value,
) -> Result<()> {
    replay(db, scope, id, &digest(action, intent)?)?
        .ok_or(Error::NotFound)
        .map(|_| ())
}

/// A precise pre-dispatch rejection may finish a new intent. Once the original
/// outcome is unknown, a later rejected read is not evidence it never ran.
pub(super) fn provider_control_failure(
    db: &mut Connection,
    scope: &ChatScope,
    operation_id: &str,
    code: Error,
    definitive: bool,
    newly_created: bool,
) -> Result<ProviderOperation> {
    let tx = sql(db.transaction())?;
    let mut current = provider_operation(&tx, scope, operation_id)?.ok_or(Error::NotFound)?;
    if !matches!(
        current.result.operation.status,
        wire::OperationStatus::Pending | wire::OperationStatus::Unknown
    ) {
        return Ok(current);
    }
    if current.result.operation.status == wire::OperationStatus::Unknown {
        return Ok(current);
    }
    let observed:bool=sql(tx.query_row("SELECT observation_json IS NOT NULL FROM chat_connector_provider_operations WHERE owner_user_id=?1 AND tenant_id=?2 AND operation_id=?3",params![scope.owner_user_id,scope.tenant_id,operation_id],|r|r.get(0)))?;
    let terminal = definitive && newly_created && !observed;
    current.result.operation.status = if terminal {
        wire::OperationStatus::Failed
    } else {
        wire::OperationStatus::Unknown
    };
    current.result.operation.revision = next(current.result.operation.revision)?;
    current.result.operation.error_code = Some(if terminal {
        code
    } else {
        Error::OutcomeUnknown
    });
    if terminal {
        current.result.operation.cancellable = false;
    }
    current.result.installation.active_operation =
        (!terminal).then(|| current.result.operation.clone());
    current.result.installation.error_code = Some(code);
    sql(tx.execute("UPDATE chat_connector_operations SET response_json=?1 WHERE owner_user_id=?2 AND tenant_id=?3 AND operation_id=?4",params![encode(&current.result)?,scope.owner_user_id,scope.tenant_id,operation_id]))?;
    sql(tx.commit())?;
    Ok(current)
}

/// Only an explicit current Enable intent supplies a provider operation to
/// poll. Auth receipts and historical readiness never activate an installation.
pub(super) fn enabled_provider_operations(
    db: &Connection,
    scope: &ChatScope,
    selection: &[wire::SelectionRef],
) -> Result<Vec<ProviderOperation>> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for reference in selection {
        if !seen.insert(&reference.installation_id) {
            return Err(Error::InvalidRequest);
        }
        let item = find(
            db,
            scope,
            &super::catalog().catalog,
            &reference.installation_id,
        )?;
        if item.revision != reference.revision || item.generation != reference.generation {
            return Err(Error::SelectionStale);
        }
        if !super::supports_provider(&item.service_id)
            || !item.desired_enabled
            || item.credential_ref.is_none()
        {
            return Err(Error::ExecutionUnavailable);
        }
        let operation:Option<String>=sql(db.query_row("SELECT p.operation_id FROM chat_connector_provider_operations p JOIN chat_connector_operations o USING(owner_user_id,tenant_id,operation_id) WHERE p.owner_user_id=?1 AND p.tenant_id=?2 AND p.installation_id=?3 AND p.kind='probe' AND json_extract(o.response_json,'$.operation.action')='enable' AND json_extract(o.response_json,'$.operation.status')='succeeded' ORDER BY p.created_at DESC,p.rowid DESC LIMIT 1",params![scope.owner_user_id,scope.tenant_id,item.installation_id],|r|r.get(0)).optional())?;
        let operation =
            provider_operation(db, scope, &operation.ok_or(Error::ExecutionUnavailable)?)?
                .ok_or(Error::ExecutionUnavailable)?;
        if operation.payload.binding.reference != *reference
            || item.credential_ref.as_ref() != Some(&operation.payload.binding.credential_ref)
        {
            return Err(Error::SelectionStale);
        }
        out.push(operation);
    }
    Ok(out)
}
