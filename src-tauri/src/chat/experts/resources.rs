//! Native persistence around the existing Host/Skills resource operations.
//! Replays and reopening only query the original operation. Explicit recovery
//! separately closes the original journal; it never installs or removes assets.
use super::{generated as wire, store};
use crate::chat::{
    authorization::{AuthorizationFailure, ChatAuthorizationManager},
    connectors::control::ExpertControlError,
    database::{ChatRepository, ChatScope},
    error::ChatError,
    ChatRuntime, HostBridge, RuntimeMode,
};
use crate::skills::SkillRuntime;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use uuid::Uuid;

type Error = wire::ErrorCode;
fn db_error(_: impl std::fmt::Debug) -> Error {
    Error::TemporarilyUnavailable
}
fn encode(value: &impl Serialize) -> Result<String, Error> {
    serde_json::to_string(value).map_err(|_| Error::InvalidRequest)
}
fn decode<T: DeserializeOwned>(value: &str) -> Result<T, Error> {
    serde_json::from_str(value).map_err(|_| Error::ResourceUnavailable)
}
fn now() -> Result<i64, Error> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|value| i64::try_from(value.as_secs()).ok())
        .ok_or(Error::TemporarilyUnavailable)
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
}
fn unsettled(value: &wire::ResourceOperation) -> bool {
    matches!(
        value.state,
        wire::OperationState::Pending | wire::OperationState::Unknown
    )
}

/// The stored request is the generated source type, including its original
/// request ID, method, Host instance, Native scope and exact resource selection.
#[derive(Clone)]
pub(super) enum PrivateRequest {
    Prepare(wire::PrivateResourcePrepareRequest),
    Remove(wire::PrivateResourceRemoveRequest),
}
impl PrivateRequest {
    fn payload(&self) -> &wire::PrivateResourcePayload {
        match self {
            Self::Prepare(v) => &v.payload,
            Self::Remove(v) => &v.payload,
        }
    }
    fn action(&self) -> &'static str {
        match self {
            Self::Prepare(_) => "prepare",
            Self::Remove(_) => "remove",
        }
    }
    fn validate(&self) -> Result<(), Error> {
        match self {
            Self::Prepare(v) => v.validate(),
            Self::Remove(v) => v.validate(),
        }
        .map_err(|_| Error::InvalidRequest)
    }
    fn json(&self) -> Result<String, Error> {
        match self {
            Self::Prepare(v) => encode(v),
            Self::Remove(v) => encode(v),
        }
    }
    fn from_json(action: &str, value: &str) -> Result<Self, Error> {
        match action {
            "prepare" => decode(value).map(Self::Prepare),
            "remove" => decode(value).map(Self::Remove),
            _ => Err(Error::ResourceUnavailable),
        }
    }
}

#[derive(Clone)]
pub(super) struct Journal {
    pub request: PrivateRequest,
    pub receipt: wire::ResourceOperation,
    pub catalog_revision: String,
    intent_digest: String,
    updated_at: i64,
}
struct Row {
    owner: String,
    tenant: String,
    format: i64,
    expert: String,
    version: String,
    action: String,
    intent: String,
    catalog: String,
    request: String,
    receipt: String,
    state: String,
    updated: i64,
}
fn row(db: &Connection, operation: &str) -> Result<Option<Row>, Error> {
    db.query_row("SELECT owner_user_id,tenant_id,format_version,expert_id,expert_version,action,intent_digest,catalog_revision,request_json,receipt_json,state,updated_at FROM chat_expert_resource_operations WHERE operation_id=?1", [operation], |r| Ok(Row { owner:r.get(0)?,tenant:r.get(1)?,format:r.get(2)?,expert:r.get(3)?,version:r.get(4)?,action:r.get(5)?,intent:r.get(6)?,catalog:r.get(7)?,request:r.get(8)?,receipt:r.get(9)?,state:r.get(10)?,updated:r.get(11)? })).optional().map_err(db_error)
}
fn parse(row: Row, operation: &str) -> Result<Journal, Error> {
    if row.format != 1 || !digest(&row.intent) || !digest(&row.catalog) {
        return Err(Error::ResourceUnavailable);
    }
    let request = PrivateRequest::from_json(&row.action, &row.request)?;
    let receipt: wire::ResourceOperation = decode(&row.receipt)?;
    let payload = request.payload();
    if payload.operation_id != operation
        || payload.scope.owner_user_id != row.owner
        || payload.scope.tenant_id != row.tenant
        || payload.expert.expert_id != row.expert
        || payload.expert.version != row.version
        || receipt.operation_id != operation
        || receipt.expert != payload.expert
        || receipt.action != row.action
        || encode(&receipt.state)? != encode(&row.state)?
    {
        return Err(Error::ResourceUnavailable);
    }
    Ok(Journal {
        request,
        receipt,
        catalog_revision: row.catalog,
        intent_digest: row.intent,
        updated_at: row.updated,
    })
}
pub(super) fn read(
    db: &Connection,
    scope: &ChatScope,
    operation: &str,
) -> Result<Option<Journal>, Error> {
    match row(db, operation)? {
        None => Ok(None),
        Some(row) if row.owner != scope.owner_user_id || row.tenant != scope.tenant_id => Ok(None),
        Some(row) => parse(row, operation).map(Some),
    }
}
fn intent(
    repo: &ChatRepository,
    scope: &ChatScope,
    action: &str,
    payload: &wire::ResourcePayload,
) -> Result<String, Error> {
    let bytes = serde_json::to_vec(&(
        "yijie.expert-resource/v1",
        &scope.owner_user_id,
        &scope.tenant_id,
        action,
        payload,
    ))
    .map_err(|_| Error::InvalidRequest)?;
    Ok(repo.market_intent_digest(&bytes))
}
pub(super) fn replay(
    db: &Connection,
    scope: &ChatScope,
    payload: &wire::ResourcePayload,
    action: &str,
    fingerprint: &str,
) -> Result<Option<Journal>, Error> {
    payload.validate().map_err(|_| Error::InvalidRequest)?;
    let Some(saved) = row(db, &payload.operation_id)? else {
        return Ok(None);
    };
    if saved.owner != scope.owner_user_id
        || saved.tenant != scope.tenant_id
        || saved.intent != fingerprint
        || saved.action != action
        || saved.expert != payload.expert.expert_id
        || saved.version != payload.expert.version
    {
        return Err(Error::RequestConflict);
    }
    parse(saved, &payload.operation_id).map(Some)
}

/// Caller commits before any Host mutation; false means ordinary replay is query-only.
#[cfg(test)]
pub(super) fn begin(
    tx: &Transaction<'_>,
    scope: &ChatScope,
    request: PrivateRequest,
    fingerprint: &str,
    catalog: &str,
    timestamp: i64,
) -> Result<(Journal, bool), Error> {
    begin_with_coexisting(tx, scope, request, fingerprint, catalog, timestamp, &[])
}

pub(super) fn begin_with_coexisting(
    tx: &Transaction<'_>,
    scope: &ChatScope,
    request: PrivateRequest,
    fingerprint: &str,
    catalog: &str,
    timestamp: i64,
    coexisting: &[wire::ExpertRef],
) -> Result<(Journal, bool), Error> {
    request.validate()?;
    let payload = request.payload();
    if timestamp < 0
        || !digest(fingerprint)
        || !digest(catalog)
        || payload.scope.owner_user_id != scope.owner_user_id
        || payload.scope.tenant_id != scope.tenant_id
    {
        return Err(Error::InvalidRequest);
    }
    let ui = wire::ResourcePayload {
        operation_id: payload.operation_id.clone(),
        expert: payload.expert.clone(),
    };
    if let Some(previous) = replay(tx, scope, &ui, request.action(), fingerprint)? {
        return Ok((previous, false));
    }
    let blocked:bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_expert_resource_operations WHERE expert_id=?1 AND state IN ('pending','unknown'))", [&payload.expert.expert_id], |r|r.get(0)).map_err(db_error)?;
    if blocked {
        return Err(Error::OperationPending);
    }
    if request.action() == "remove" && store::resource_in_use(tx, &payload.expert)? {
        return Err(Error::ResourceInUse);
    }
    if request.action() == "prepare"
        && store::resource_replacement_in_use(tx, &payload.expert, coexisting)?
    {
        return Err(Error::ResourceInUse);
    }
    let receipt = wire::ResourceOperation {
        operation_id: payload.operation_id.clone(),
        expert: payload.expert.clone(),
        action: request.action().into(),
        state: wire::OperationState::Pending,
        error_code: None,
    };
    tx.execute("INSERT INTO chat_expert_resource_operations(operation_id,owner_user_id,tenant_id,format_version,expert_id,expert_version,action,intent_digest,catalog_revision,request_json,receipt_json,state,created_at,updated_at) VALUES(?1,?2,?3,1,?4,?5,?6,?7,?8,?9,?10,'pending',?11,?11)",params![payload.operation_id,scope.owner_user_id,scope.tenant_id,payload.expert.expert_id,payload.expert.version,receipt.action,fingerprint,catalog,request.json()?,encode(&receipt)?,timestamp]).map_err(db_error)?;
    Ok((
        Journal {
            request,
            receipt,
            catalog_revision: catalog.into(),
            intent_digest: fingerprint.into(),
            updated_at: timestamp,
        },
        true,
    ))
}

/// Only matching positive Host evidence advances a saved operation. A missing
/// read/status is not a rejection. Terminal receipts are immutable.
pub(super) fn finish(
    tx: &Transaction<'_>,
    scope: &ChatScope,
    original: &Journal,
    receipt: &wire::ResourceOperation,
    timestamp: i64,
) -> Result<wire::ResourceOperation, Error> {
    receipt.validate().map_err(|_| Error::OutcomeUnknown)?;
    let previous = read(tx, scope, &original.receipt.operation_id)?.ok_or(Error::NotFound)?;
    if previous.intent_digest != original.intent_digest
        || previous.request.json()? != original.request.json()?
        || previous.catalog_revision != original.catalog_revision
        || receipt.operation_id != previous.receipt.operation_id
        || receipt.expert != previous.receipt.expert
        || receipt.action != previous.receipt.action
    {
        return Err(Error::RequestConflict);
    }
    if !unsettled(&previous.receipt) {
        return if previous.receipt == *receipt {
            Ok(previous.receipt)
        } else {
            Err(Error::RequestConflict)
        };
    }
    if timestamp < previous.updated_at {
        return Err(Error::InvalidRequest);
    }
    if previous.receipt.state == wire::OperationState::Unknown
        && receipt.state == wire::OperationState::Pending
    {
        return Ok(previous.receipt);
    }
    tx.execute("UPDATE chat_expert_resource_operations SET receipt_json=?2,state=?3,updated_at=?4 WHERE operation_id=?1", params![receipt.operation_id,encode(receipt)?,serde_json::to_value(receipt.state).map_err(|_| Error::InvalidRequest)?.as_str().ok_or(Error::InvalidRequest)?,timestamp]).map_err(db_error)?;
    Ok(receipt.clone())
}

pub(super) fn scoped_journal(db: &Connection, scope: &ChatScope) -> Result<Vec<Journal>, Error> {
    let mut statement = db.prepare("SELECT operation_id FROM chat_expert_resource_operations WHERE owner_user_id=?1 AND tenant_id=?2 ORDER BY CASE WHEN state IN ('pending','unknown') THEN 0 ELSE 1 END,updated_at DESC,rowid DESC LIMIT 256").map_err(db_error)?;
    let ids = statement
        .query_map(params![scope.owner_user_id, scope.tenant_id], |r| {
            r.get::<_, String>(0)
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    ids.into_iter()
        .map(|id| read(db, scope, &id)?.ok_or(Error::ResourceUnavailable))
        .collect()
}
pub(super) fn merge_status(
    tx: &Transaction<'_>,
    scope: &ChatScope,
    status: &wire::PrivateStatus,
    timestamp: i64,
) -> Result<(), Error> {
    status.validate().map_err(|_| Error::ResourceUnavailable)?;
    let saved = scoped_journal(tx, scope)?;
    for original in saved.iter().filter(|entry| {
        unsettled(&entry.receipt) && entry.catalog_revision == status.catalog_revision
    }) {
        if let Some(receipt) = status
            .resource_operations
            .iter()
            .find(|value| value.operation_id == original.receipt.operation_id)
        {
            finish(tx, scope, original, receipt, timestamp)?;
        }
    }
    Ok(())
}

pub(super) fn project(
    db: &Connection,
    scope: &ChatScope,
    catalog: &mut wire::CatalogSnapshot,
) -> Result<(), Error> {
    let saved = scoped_journal(db, scope)?;
    for entry in &mut catalog.experts {
        if let Some(record) = saved.iter().find(|v| {
            v.receipt.expert.expert_id == entry.display.expert_id
                && v.receipt.expert.version == entry.display.version
        }) {
            if unsettled(&record.receipt) {
                entry.state = wire::ResourceState::Preparing;
                entry.error_code = record.receipt.error_code;
            }
            entry.operation = Some(record.receipt.clone());
        }
        let blocked:bool = db.query_row("SELECT EXISTS(SELECT 1 FROM chat_expert_resource_operations WHERE expert_id=?1 AND state IN ('pending','unknown'))",[&entry.display.expert_id],|r|r.get(0)).map_err(db_error)?;
        if blocked {
            entry.state = wire::ResourceState::Preparing;
            entry.error_code = Some(Error::OperationPending);
        }
    }
    Ok(())
}

#[derive(Clone)]
struct Access {
    manager: ChatAuthorizationManager,
    scope: ChatScope,
    context: Uuid,
}
impl Access {
    fn new(chat: &ChatRuntime, context: &str) -> Result<Self, Error> {
        let scope = match &chat.mode {
            RuntimeMode::Local(config) => config.scope.clone(),
            _ => return Err(Error::PermissionDenied),
        };
        Ok(Self {
            manager: chat
                .authorization_manager()
                .map_err(|_| Error::ContextInvalid)?,
            scope,
            context: Uuid::parse_str(context).map_err(|_| Error::ContextInvalid)?,
        })
    }
    fn run<T>(
        &self,
        required: &[&str],
        operation: impl FnOnce(wire::ScopeBinding) -> Result<T, Error>,
    ) -> Result<T, Error> {
        self.manager
            .with_market_authority(self.context, &self.scope, required, now()?, operation)
            .map_err(|e| match e {
                AuthorizationFailure::ContextInvalid => Error::ContextInvalid,
                AuthorizationFailure::CapabilityDenied => Error::PermissionDenied,
            })?
    }
    fn authority(&self, required: &[&str]) -> Result<wire::ScopeBinding, Error> {
        self.run(required, Ok)
    }
}
async fn host(chat: &ChatRuntime) -> Result<std::sync::Arc<HostBridge>, Error> {
    chat.ensure_demo_fast_sidecar()
        .await
        .map_err(|_| Error::QualificationRequired)?;
    chat.local_host_bridge()
        .await
        .map_err(|_| Error::QualificationRequired)
}
fn make_request(
    host: String,
    scope: wire::ScopeBinding,
    payload: &wire::ResourcePayload,
    remove: bool,
) -> PrivateRequest {
    let private = wire::PrivateResourcePayload {
        host_instance_id: host,
        scope,
        operation_id: payload.operation_id.clone(),
        expert: payload.expert.clone(),
    };
    let request_id = Uuid::now_v7().to_string();
    if remove {
        PrivateRequest::Remove(wire::PrivateResourceRemoveRequest {
            schema_version: 1,
            request_id,
            method: "expert_resources_remove".into(),
            payload: private,
        })
    } else {
        PrivateRequest::Prepare(wire::PrivateResourcePrepareRequest {
            schema_version: 1,
            request_id,
            method: "expert_resources_prepare".into(),
            payload: private,
        })
    }
}
async fn query_host(
    host: &HostBridge,
    access: &Access,
    original: &Journal,
    required: &[&str],
) -> Result<wire::ResourceOperation, Error> {
    let control = host.market_control().ok_or(Error::UnsupportedCapability)?;
    let request_id = Uuid::now_v7().to_string();
    let response: wire::PrivateResourceReadResponse = control
        .expert_request(
            &request_id,
            &wire::PrivateResourceReadRequest {
                schema_version: 1,
                request_id: request_id.clone(),
                method: "expert_resources_operation_read".into(),
                payload: wire::PrivateResourceReadPayload {
                    host_instance_id: host.instance_nonce().into(),
                    scope: access.authority(required)?,
                    operation_id: original.receipt.operation_id.clone(),
                },
            },
            "expert_resources_operation_read",
        )
        .await
        .map_err(super::control_error)?;
    Ok(response.data)
}
async fn settle(
    chat: &ChatRuntime,
    access: &Access,
    original: Journal,
    receipt: wire::ResourceOperation,
) -> Result<wire::ResourceOperation, Error> {
    let worker = chat.database().await.map_err(db_error)?;
    let scope = access.scope.clone();
    worker
        .call(move |repo| {
            let tx = repo
                .connection
                .transaction()
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            let result = finish(&tx, &scope, &original, &receipt, now().unwrap_or(-1));
            if result.is_ok() {
                tx.commit().map_err(|_| ChatError::DatabaseUnavailable)?;
            }
            Ok(result)
        })
        .await
        .map_err(db_error)?
}
async fn reconcile(
    chat: &ChatRuntime,
    access: &Access,
    original: Journal,
    required: &[&str],
) -> Result<wire::ResourceOperation, Error> {
    if !unsettled(&original.receipt) {
        return Ok(original.receipt);
    }
    // A new Host or an empty status cannot reauthorize the original mutation.
    let original_receipt = original.receipt.clone();
    let Ok(host) = host(chat).await else {
        return Ok(original_receipt);
    };
    // Receipt reads need the current read authority and original operation ID,
    // not a new install qualification or a newly generated private intent.
    let receipt = match query_host(&host, access, &original, required).await {
        Ok(value) => value,
        Err(_) => return Ok(original_receipt),
    };
    settle(chat, access, original, receipt).await
}

pub(super) fn recovery_request(
    current_host: String,
    current_scope: wire::ScopeBinding,
    original: &Journal,
) -> Result<wire::PrivateResourceRecoverRequest, Error> {
    let saved = original.request.payload();
    if current_scope.owner_user_id != saved.scope.owner_user_id
        || current_scope.tenant_id != saved.scope.tenant_id
    {
        return Err(Error::ContextInvalid);
    }
    let request = wire::PrivateResourceRecoverRequest {
        schema_version: 1,
        request_id: Uuid::now_v7().to_string(),
        method: "expert_resources_recover".into(),
        payload: wire::PrivateResourceRecoverPayload {
            host_instance_id: current_host,
            scope: current_scope,
            original: saved.clone(),
            action: original.request.action().into(),
        },
    };
    request.validate().map_err(|_| Error::InvalidRequest)?;
    Ok(request)
}

async fn recover(
    chat: &ChatRuntime,
    access: &Access,
    operation: String,
) -> Result<wire::ResourceOperation, Error> {
    access.authority(&["plugin.manage"])?;
    let _gate = access.manager.market_admission_lock().await;
    let worker = chat.database().await.map_err(db_error)?;
    let check = access.clone();
    let original = worker
        .call(move |repo| {
            Ok(check.run(&["plugin.manage"], |_| {
                read(&repo.connection, &check.scope, &operation)?.ok_or(Error::NotFound)
            }))
        })
        .await
        .map_err(db_error)??;
    if !unsettled(&original.receipt) {
        return Ok(original.receipt);
    }
    let host = host(chat).await?;
    let request = recovery_request(
        host.instance_nonce().into(),
        access.authority(&["plugin.manage"])?,
        &original,
    )?;
    let control = host.market_control().ok_or(Error::UnsupportedCapability)?;
    // No new resource intent, catalog selection, installation or removal is
    // authorized here. A guard rejection or transport error cannot establish
    // the old operation's outcome; leave its durable receipt unchanged.
    let response: wire::PrivateResourceRecoverResponse = control
        .expert_request(&request.request_id, &request, "expert_resources_recover")
        .await
        .map_err(super::control_error)?;
    settle(chat, access, original, response.data).await
}
async fn change(
    chat: &ChatRuntime,
    skills: &SkillRuntime,
    access: &Access,
    payload: wire::ResourcePayload,
    remove: bool,
) -> Result<wire::ResourceOperation, Error> {
    access.authority(&["plugin.manage"])?;
    let _gate = access.manager.market_admission_lock().await;
    let worker = chat.database().await.map_err(db_error)?;
    let check = access.clone();
    let ui = payload.clone();
    let action = if remove { "remove" } else { "prepare" };
    let prior = worker
        .call(move |repo| {
            Ok(check.run(&["plugin.manage"], |_| {
                replay(
                    &repo.connection,
                    &check.scope,
                    &ui,
                    action,
                    &intent(repo, &check.scope, action, &ui)?,
                )
            }))
        })
        .await
        .map_err(db_error)??;
    if let Some(original) = prior {
        return reconcile(chat, access, original, &["plugin.manage"]).await;
    }
    let host = host(chat).await?;
    let status = super::status(skills, &host, access.authority(&["plugin.manage"])?).await?;
    let catalog = skills
        .expert_catalog(chat, true, status.execution_available)
        .await?;
    let entry = catalog
        .experts
        .iter()
        .find(|entry| {
            entry.display.expert_id == payload.expert.expert_id
                && entry.display.version == payload.expert.version
        })
        .ok_or(Error::VersionUnavailable)?;
    if !matches!(
        entry.state,
        wire::ResourceState::Available | wire::ResourceState::Ready
    ) {
        return Err(entry.error_code.unwrap_or(Error::ResourceUnavailable));
    }
    if remove && entry.state == wire::ResourceState::Ready {
        skills.expert_resolve(chat, &payload.expert).await?;
    }
    let prepare = access.clone();
    let ui = payload.clone();
    let instance = host.instance_nonce().to_owned();
    let revision = status.catalog_revision;
    let coexisting = skills.expert_coexisting_refs(&payload.expert)?;
    let (original, fresh) = worker
        .call(move |repo| {
            Ok(prepare.run(&["plugin.manage"], |authority| {
                let fingerprint = intent(repo, &prepare.scope, action, &ui)?;
                let request = make_request(instance, authority, &ui, remove);
                let tx = repo.connection.transaction().map_err(db_error)?;
                let result = begin_with_coexisting(
                    &tx,
                    &prepare.scope,
                    request,
                    &fingerprint,
                    &revision,
                    now()?,
                    &coexisting,
                )?;
                tx.commit().map_err(db_error)?;
                Ok(result)
            }))
        })
        .await
        .map_err(db_error)??;
    if !fresh {
        return reconcile(chat, access, original, &["plugin.manage"]).await;
    }
    let authority = access.authority(&["plugin.manage"]);
    let allowed = authority.as_ref().is_ok_and(|current| {
        let saved = &original.request.payload().scope;
        current.owner_user_id == saved.owner_user_id
            && current.tenant_id == saved.tenant_id
            && current.native_process_epoch == saved.native_process_epoch
            && current.authorization_revision == saved.authorization_revision
    });
    let result = if !allowed {
        Err(ExpertControlError::Rejected(wire::Error {
            schema_version: 1,
            request_id: None,
            code: authority.err().unwrap_or(Error::ContextInvalid),
            retryable: false,
        }))
    } else if let Some(control) = host.market_control() {
        match &original.request {
            PrivateRequest::Prepare(request) => control
                .expert_request::<_, wire::PrivateResourcePrepareResponse>(
                    &request.request_id,
                    request,
                    "expert_resources_prepare",
                )
                .await
                .map(|v| v.data),
            PrivateRequest::Remove(request) => control
                .expert_request::<_, wire::PrivateResourceRemoveResponse>(
                    &request.request_id,
                    request,
                    "expert_resources_remove",
                )
                .await
                .map(|v| v.data),
        }
    } else {
        Err(ExpertControlError::Closed)
    };
    let receipt = match result {
        Ok(receipt) => receipt,
        Err(error) => {
            let (state, code) = match error {
                ExpertControlError::Rejected(error)
                    if !matches!(
                        error.code,
                        Error::OutcomeUnknown | Error::TemporarilyUnavailable
                    ) =>
                {
                    (wire::OperationState::Rejected, error.code)
                }
                ExpertControlError::Busy => (wire::OperationState::Rejected, Error::Busy),
                ExpertControlError::InvalidRequest => {
                    (wire::OperationState::Rejected, Error::InvalidRequest)
                }
                _ => (wire::OperationState::Unknown, Error::OutcomeUnknown),
            };
            wire::ResourceOperation {
                state,
                error_code: Some(code),
                ..original.receipt.clone()
            }
        }
    };
    let receipt = if receipt.operation_id != original.receipt.operation_id
        || receipt.expert != original.receipt.expert
        || receipt.action != original.receipt.action
    {
        wire::ResourceOperation {
            state: wire::OperationState::Unknown,
            error_code: Some(Error::OutcomeUnknown),
            ..original.receipt.clone()
        }
    } else {
        receipt
    };
    // Persist the authenticated original result even if its UI context expired.
    settle(chat, access, original, receipt).await
}
async fn snapshot(
    chat: &ChatRuntime,
    skills: &SkillRuntime,
    access: &Access,
) -> Result<wire::CatalogSnapshot, Error> {
    access.authority(&["plugin.read"])?;
    let _gate = access.manager.market_admission_lock().await;
    let host = host(chat).await?;
    let status = super::status(skills, &host, access.authority(&["plugin.read"])?).await?;
    let mut catalog = skills
        .expert_catalog(
            chat,
            access.authority(&["plugin.manage"]).is_ok(),
            status.execution_available,
        )
        .await?;
    let worker = chat.database().await.map_err(db_error)?;
    let check = access.clone();
    worker
        .call(move |repo| {
            Ok(check.run(&["plugin.read"], |_| {
                let tx = repo.connection.transaction().map_err(db_error)?;
                merge_status(&tx, &check.scope, &status, now()?)?;
                project(&tx, &check.scope, &mut catalog)?;
                tx.commit().map_err(db_error)?;
                Ok(catalog)
            }))
        })
        .await
        .map_err(db_error)?
}

pub(crate) async fn command(
    raw: Value,
    chat: &ChatRuntime,
    skills: &SkillRuntime,
    name: &str,
) -> Result<Value, wire::Error> {
    let known = raw
        .get("requestId")
        .and_then(Value::as_str)
        .filter(|value| {
            Uuid::parse_str(value).is_ok_and(|id| !id.is_nil() && id.to_string() == *value)
        })
        .map(str::to_owned);
    let result=async {
        if !super::enabled(){return Err(Error::UnsupportedCapability)}
        let (request_id,context,payload,remove)=match name {
            "experts_developer_read_v1"=>{
                let value:wire::DeveloperReadRequest=serde_json::from_value(raw).map_err(|_|Error::InvalidRequest)?;
                value.validate().map_err(|_|Error::InvalidRequest)?;
                let access=Access::new(chat,&value.context_id)?;
                let developer=access.run(&["plugin.read"],|_|skills.expert_developer(&value.payload))?;
                developer.validate().map_err(|_|Error::ResourceUnavailable)?;
                access.authority(&["plugin.read"])?;
                return Ok(serde_json::json!({"schemaVersion":1,"requestId":value.request_id,"data":developer}));
            },
            "experts_snapshot_v1"=>{let value:wire::SnapshotRequest=serde_json::from_value(raw).map_err(|_|Error::InvalidRequest)?;(value.request_id,value.context_id,None,false)},
            "experts_prepare_v1"=>{let value:wire::PrepareRequest=serde_json::from_value(raw).map_err(|_|Error::InvalidRequest)?;(value.request_id,value.context_id,Some(value.payload),false)},
            "experts_remove_v1"=>{let value:wire::RemoveRequest=serde_json::from_value(raw).map_err(|_|Error::InvalidRequest)?;(value.request_id,value.context_id,Some(value.payload),true)},
            "experts_operation_read_v1"=>{
                let value:wire::ResourceOperationReadRequest=serde_json::from_value(raw).map_err(|_|Error::InvalidRequest)?;
                let access=Access::new(chat,&value.context_id)?;access.authority(&["plugin.read"])?;
                let _gate=access.manager.market_admission_lock().await;
                let worker=chat.database().await.map_err(db_error)?;let check=access.clone();let operation=value.payload.operation_id;
                let original=worker.call(move|repo|Ok(check.run(&["plugin.read"],|_|read(&repo.connection,&check.scope,&operation)?.ok_or(Error::NotFound)))).await.map_err(db_error)??;
                let receipt=reconcile(chat,&access,original,&["plugin.read"]).await?;
                access.authority(&["plugin.read"])?;
                return Ok(serde_json::json!({"schemaVersion":1,"requestId":value.request_id,"data":receipt}));
            },
            "experts_operation_recover_v1"=>{
                let value:wire::ResourceOperationRecoverRequest=serde_json::from_value(raw).map_err(|_|Error::InvalidRequest)?;
                value.validate().map_err(|_|Error::InvalidRequest)?;
                let access=Access::new(chat,&value.context_id)?;
                let receipt=recover(chat,&access,value.payload.operation_id).await?;
                access.authority(&["plugin.manage"])?;
                return Ok(serde_json::json!({"schemaVersion":1,"requestId":value.request_id,"data":receipt}));
            },
            _=>return Err(Error::UnsupportedCapability),
        };
        let access=Access::new(chat,&context)?;
        let data=if let Some(payload)=payload {
            let receipt=change(chat,skills,&access,payload,remove).await?;
            access.authority(&["plugin.manage"])?;serde_json::to_value(receipt).map_err(db_error)?
        }else{
            let catalog=snapshot(chat,skills,&access).await?;
            access.authority(&["plugin.read"])?;serde_json::to_value(catalog).map_err(db_error)?
        };
        Ok(serde_json::json!({"schemaVersion":1,"requestId":request_id,"data":data}))
    }.await;
    result.map_err(|code| wire::Error {
        schema_version: 1,
        request_id: known,
        code,
        retryable: code == Error::TemporarilyUnavailable,
    })
}
