//! Binding intent and confirmed state are different records. All functions run
//! on the existing SQLCipher worker, inside its caller-owned transaction.
use super::generated as wire;
use crate::chat::database::ChatScope;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{de::DeserializeOwned, Serialize};

type Error = wire::ErrorCode;

fn db_error(_: rusqlite::Error) -> Error {
    Error::TemporarilyUnavailable
}
fn encode(value: &impl Serialize) -> Result<String, Error> {
    serde_json::to_string(value).map_err(|_| Error::InvalidRequest)
}
fn decode<T: DeserializeOwned>(value: &str) -> Result<T, Error> {
    serde_json::from_str(value).map_err(|_| Error::BindingUnavailable)
}
fn has_storage(db: &Connection) -> Result<bool, Error> {
    db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_expert_bindings')",[],|row|row.get(0)).map_err(db_error)
}
fn owned(db: &Connection, scope: &ChatScope, session: &str) -> Result<(), Error> {
    let exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM chat_sessions WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3)",
        params![session, scope.owner_user_id, scope.tenant_id], |r| r.get(0),
    ).map_err(db_error)?;
    if exists {
        Ok(())
    } else {
        Err(Error::NotFound)
    }
}

/// Resolved only from a verified Native catalog/receipt, never from UI hashes.
#[derive(Clone)]
pub(crate) struct ResolvedExpert {
    pub reference: wire::ExpertRef,
    pub display: wire::ExpertDisplay,
}
impl ResolvedExpert {
    fn validate(&self) -> Result<(), Error> {
        self.reference
            .validate()
            .map_err(|_| Error::InvalidRequest)?;
        self.display.validate().map_err(|_| Error::InvalidRequest)?;
        if self.reference.expert_id != self.display.expert_id
            || self.reference.version != self.display.version
        {
            return Err(Error::InvalidRequest);
        }
        Ok(())
    }
}

struct BindingRow {
    format: i64,
    revision: i64,
    display: Option<String>,
    state: String,
    operation_id: Option<String>,
}

pub(crate) fn read(
    db: &Connection,
    scope: &ChatScope,
    session: &str,
) -> Result<wire::BindingView, Error> {
    owned(db, scope, session)?;
    let value: Option<BindingRow> = db.query_row(
        "SELECT format_version,binding_revision,display_json,state,operation_id FROM chat_expert_bindings WHERE session_id=?1",
        [session], |r| Ok(BindingRow { format: r.get(0)?, revision: r.get(1)?, display: r.get(2)?, state: r.get(3)?, operation_id: r.get(4)? }),
    ).optional().map_err(db_error)?;
    let Some(row) = value else {
        let has_snapshot: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM chat_expert_submissions WHERE session_id=?1)",
                [session],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        if has_snapshot {
            return Err(Error::BindingUnavailable);
        }
        return Ok(wire::BindingView {
            managed: false,
            session_id: session.into(),
            binding_revision: 0,
            expert: None,
            state: wire::BindingState::None,
            operation_id: None,
            error_code: None,
        });
    };
    if row.format != 1 {
        return Err(Error::BindingUnavailable);
    }
    let result = wire::BindingView {
        managed: true,
        session_id: session.into(),
        binding_revision: row.revision,
        expert: row.display.as_deref().map(decode).transpose()?,
        state: decode(&encode(&row.state)?)?,
        operation_id: row.operation_id,
        error_code: None,
    };
    result.validate().map_err(|_| Error::BindingUnavailable)?;
    Ok(result)
}

pub(crate) fn reference(
    db: &Connection,
    scope: &ChatScope,
    session: &str,
) -> Result<Option<wire::ExpertRef>, Error> {
    let binding = read(db, scope, session)?;
    if !matches!(
        binding.state,
        wire::BindingState::None | wire::BindingState::Ready
    ) {
        return Err(Error::OperationPending);
    }
    let value: Option<Option<String>> = db.query_row(
        "SELECT expert_ref_json FROM chat_expert_bindings WHERE session_id=?1 AND format_version=1",
        [session], |r| r.get(0),
    ).optional().map_err(db_error)?;
    value.flatten().as_deref().map(decode).transpose()
}

/// Used by every future send/model/permission admission, not only expert UI.
pub(crate) fn require_settled(db: &Connection, session: &str) -> Result<(), Error> {
    if !has_storage(db)? {
        return Ok(());
    }
    let busy: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM chat_expert_bindings WHERE session_id=?1 AND (format_version!=1 OR state NOT IN ('none','ready')))",
        [session], |r| r.get(0),
    ).map_err(db_error)?;
    if busy {
        Err(Error::OperationPending)
    } else {
        Ok(())
    }
}

/// A durable binding attempt occupies the existing foreground lane until its
/// original receipt settles, including after reopening with the feature off.
pub(crate) fn any_unsettled(db: &Connection) -> Result<bool, Error> {
    if !has_storage(db)? {
        return Ok(false);
    }
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM chat_expert_bindings WHERE format_version!=1 OR state NOT IN ('none','ready'))",
        [], |row| row.get(0),
    ).map_err(db_error)
}

pub(crate) fn read_operation(
    db: &Connection,
    scope: &ChatScope,
    session: &str,
    operation: &str,
) -> Result<Option<wire::BindingResult>, Error> {
    owned(db, scope, session)?;
    let value: Option<(i64, String)> = db.query_row(
        "SELECT format_version,receipt_json FROM chat_expert_binding_operations WHERE session_id=?1 AND operation_id=?2",
        params![session, operation], |r| Ok((r.get(0)?,r.get(1)?)),
    ).optional().map_err(db_error)?;
    match value {
        None => Ok(None),
        Some((1, value)) => decode(&value).map(Some),
        Some(_) => Err(Error::BindingUnavailable),
    }
}

pub(crate) fn replay_binding(
    db: &Connection,
    scope: &ChatScope,
    request: &wire::BindingSetPayload,
    intent_digest: &str,
) -> Result<Option<wire::BindingResult>, Error> {
    request.validate().map_err(|_| Error::InvalidRequest)?;
    owned(db, scope, &request.session_id)?;
    let prior: Option<(String, i64, String, String)> = db.query_row(
        "SELECT session_id,format_version,intent_digest,receipt_json FROM chat_expert_binding_operations WHERE operation_id=?1",
        [&request.operation_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    ).optional().map_err(db_error)?;
    if let Some((session, format, digest, receipt)) = prior {
        return if session != request.session_id || digest != intent_digest {
            Err(Error::RequestConflict)
        } else if format == 1 {
            decode(&receipt).map(Some)
        } else {
            Err(Error::BindingUnavailable)
        };
    }
    Ok(None)
}

/// Persist a pending intent while retaining the last confirmed reference and
/// revision. The caller's existing admission gate also excludes native activity
/// and approval; this durable check excludes queued/unknown sends and changes.
pub(crate) fn begin(
    db: &Transaction<'_>,
    scope: &ChatScope,
    request: &wire::BindingSetPayload,
    resolved: Option<&ResolvedExpert>,
    intent_digest: &str,
    timestamp: i64,
) -> Result<wire::BindingResult, Error> {
    request.validate().map_err(|_| Error::InvalidRequest)?;
    owned(db, scope, &request.session_id)?;
    if timestamp < 0
        || intent_digest.len() != 64
        || !intent_digest
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err(Error::InvalidRequest);
    }
    if let Some(prior) = replay_binding(db, scope, request, intent_digest)? {
        return Ok(prior);
    }
    crate::chat::schedules::execution_guard::foreground(db).map_err(|error| {
        if error == crate::chat::error::ChatError::ConversationConflict {
            Error::Busy
        } else {
            Error::TemporarilyUnavailable
        }
    })?;
    match (&request.expert, resolved) {
        (Some(selected), Some(value))
            if selected.expert_id == value.reference.expert_id
                && selected.version == value.reference.version =>
        {
            value.validate()?
        }
        (None, None) => {}
        _ => return Err(Error::VersionUnavailable),
    }
    let before = read(db, scope, &request.session_id)?;
    if before.binding_revision != request.expected_binding_revision {
        return Err(Error::RevisionConflict);
    }
    require_settled(db, &request.session_id)?;
    if request.expected_binding_revision >= 9007199254740991 {
        return Err(Error::CapacityExceeded);
    }
    let busy: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM chat_outbox WHERE session_id=?1 AND state IN ('pending','inflight')) OR EXISTS(SELECT 1 FROM chat_market_submissions m JOIN chat_market_dispatch d ON d.submission_operation_id=m.submission_operation_id WHERE m.session_id=?1 AND d.state IN ('pending','inflight','uncertain')) OR EXISTS(SELECT 1 FROM chat_deletion_jobs WHERE session_id=?1) OR EXISTS(SELECT 1 FROM chat_model_selections WHERE session_id=?1 AND state!='ready')",
        [&request.session_id], |r| r.get(0),
    ).map_err(db_error)?;
    if busy {
        return Err(Error::Busy);
    }
    let mut binding = before;
    binding.managed = true;
    binding.state = wire::BindingState::Applying;
    binding.operation_id = Some(request.operation_id.clone());
    let operation = wire::BindingOperation {
        operation_id: request.operation_id.clone(),
        session_id: request.session_id.clone(),
        state: wire::OperationState::Pending,
        expected_binding_revision: request.expected_binding_revision,
        binding_revision: binding.binding_revision,
        requested_expert: resolved.map(|v| v.display.clone()),
        error_code: None,
    };
    let result = wire::BindingResult { binding, operation };
    db.execute("INSERT INTO chat_expert_bindings(session_id,binding_revision,state,operation_id,updated_at) VALUES(?1,0,'applying',?2,?3) ON CONFLICT(session_id) DO UPDATE SET state='applying',operation_id=excluded.operation_id,updated_at=excluded.updated_at", params![request.session_id, request.operation_id, timestamp]).map_err(db_error)?;
    db.execute("INSERT INTO chat_expert_binding_operations(operation_id,session_id,intent_digest,expected_binding_revision,requested_ref_json,requested_display_json,receipt_json,state,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'pending',?8,?8)",params![request.operation_id,request.session_id,intent_digest,request.expected_binding_revision,resolved.map(|v|encode(&v.reference)).transpose()?,resolved.map(|v|encode(&v.display)).transpose()?,encode(&result)?,timestamp]).map_err(db_error)?;
    Ok(result)
}

/// Freeze the complete owned-pipe request before I/O. A repeated request returns
/// false: the dispatcher must query the original operation, never send it again.
pub(crate) fn record_apply(
    db: &Transaction<'_>,
    scope: &ChatScope,
    payload: &wire::ApplyPayload,
    timestamp: i64,
) -> Result<bool, Error> {
    payload.validate().map_err(|_| Error::InvalidRequest)?;
    let Some(result) = read_operation(db, scope, &payload.local_session_id, &payload.operation_id)?
    else {
        return Err(Error::NotFound);
    };
    if payload.scope.owner_user_id != scope.owner_user_id
        || payload.scope.tenant_id != scope.tenant_id
        || payload.expected_binding_revision != result.operation.expected_binding_revision
        || payload.binding_revision != payload.expected_binding_revision + 1
    {
        return Err(Error::RequestConflict);
    }
    let (original, requested, updated): (Option<String>, Option<String>, i64) = db.query_row(
        "SELECT apply_payload_json,requested_ref_json,updated_at FROM chat_expert_binding_operations WHERE session_id=?1 AND operation_id=?2",
        params![payload.local_session_id, payload.operation_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).map_err(db_error)?;
    if let Some(original) = original {
        return if decode::<wire::ApplyPayload>(&original)? == *payload {
            Ok(false)
        } else {
            Err(Error::RequestConflict)
        };
    }
    let requested: Option<wire::ExpertRef> = requested.as_deref().map(decode).transpose()?;
    let binding = read(db, scope, &payload.local_session_id)?;
    if payload.expert != requested
        || binding.operation_id.as_deref() != Some(&payload.operation_id)
        || binding.binding_revision != payload.expected_binding_revision
        || result.operation.state != wire::OperationState::Pending
        || timestamp < updated
    {
        return Err(Error::RequestConflict);
    }
    db.execute("UPDATE chat_expert_binding_operations SET apply_payload_json=?3,updated_at=?4 WHERE session_id=?1 AND operation_id=?2 AND apply_payload_json IS NULL",params![payload.local_session_id,payload.operation_id,encode(payload)?,timestamp]).map_err(db_error)?;
    Ok(true)
}

/// Only a validated Host receipt matching the journaled owned-pipe attempt may
/// finish an apply. No caller-supplied boolean is a Runtime fact.
pub(crate) fn finish(
    db: &Transaction<'_>,
    scope: &ChatScope,
    receipt: &wire::ApplyReceipt,
    timestamp: i64,
) -> Result<wire::BindingResult, Error> {
    receipt.validate().map_err(|_| Error::InvalidRequest)?;
    let Some(mut result) =
        read_operation(db, scope, &receipt.local_session_id, &receipt.operation_id)?
    else {
        return Err(Error::NotFound);
    };
    let current = read(db, scope, &receipt.local_session_id)?;
    let (attempt, display, updated): (Option<String>, Option<String>, i64) = db.query_row(
        "SELECT apply_payload_json,requested_display_json,updated_at FROM chat_expert_binding_operations WHERE session_id=?1 AND operation_id=?2",
        params![receipt.local_session_id,receipt.operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
    ).map_err(db_error)?;
    let attempt: wire::ApplyPayload = decode(attempt.as_deref().ok_or(Error::OperationPending)?)?;
    let succeeded = receipt.state == wire::OperationState::Succeeded;
    if attempt.expert != receipt.expert
        || attempt.operation_id != receipt.operation_id
        || attempt.host_instance_id != receipt.host_instance_id
        || attempt.local_session_id != receipt.local_session_id
        || attempt.agent_session_id != receipt.agent_session_id
        || attempt.native_thread_id != receipt.native_thread_id
        || attempt.expected_binding_revision != receipt.expected_binding_revision
        || attempt.scope.owner_user_id != scope.owner_user_id
        || attempt.scope.tenant_id != scope.tenant_id
    {
        return Err(Error::RequestConflict);
    }
    if receipt.binding_revision != receipt.expected_binding_revision + i64::from(succeeded) {
        return Err(Error::RevisionConflict);
    }
    if matches!(
        result.operation.state,
        wire::OperationState::Succeeded | wire::OperationState::Rejected
    ) {
        return Ok(result);
    }
    if timestamp < updated {
        return Err(Error::RequestConflict);
    }
    if current.operation_id.as_deref() != Some(&receipt.operation_id)
        || current.binding_revision != receipt.expected_binding_revision
    {
        return Err(Error::RevisionConflict);
    }
    result.operation.state = receipt.state;
    result.operation.error_code = receipt.error_code;
    result.operation.binding_revision = receipt.binding_revision;
    result.binding = current;
    match receipt.state {
        wire::OperationState::Succeeded => {
            result.binding.binding_revision = receipt.binding_revision;
            result.binding.expert = display.as_deref().map(decode).transpose()?;
            result.binding.state = if receipt.expert.is_some() {
                wire::BindingState::Ready
            } else {
                wire::BindingState::None
            };
            db.execute("UPDATE chat_expert_bindings SET binding_revision=?2,expert_ref_json=?3,display_json=?4 WHERE session_id=?1 AND operation_id=?5",params![receipt.local_session_id,receipt.binding_revision,receipt.expert.as_ref().map(encode).transpose()?,display,receipt.operation_id]).map_err(db_error)?;
        }
        wire::OperationState::Rejected => {
            result.binding.state = if result.binding.expert.is_some() {
                wire::BindingState::Ready
            } else {
                wire::BindingState::None
            };
        }
        wire::OperationState::Pending => {
            result.binding.state = wire::BindingState::Applying;
        }
        wire::OperationState::Unknown => {
            result.binding.state = wire::BindingState::Unknown;
        }
    }
    db.execute("UPDATE chat_expert_bindings SET state=?2,updated_at=?3 WHERE session_id=?1 AND operation_id=?4",params![receipt.local_session_id,encode(&result.binding.state)?.trim_matches('"'),timestamp,receipt.operation_id]).map_err(db_error)?;
    db.execute("UPDATE chat_expert_binding_operations SET state=?2,receipt_json=?3,updated_at=?4 WHERE session_id=?5 AND operation_id=?1",params![receipt.operation_id,encode(&receipt.state)?.trim_matches('"'),encode(&result)?,timestamp,receipt.local_session_id]).map_err(db_error)?;
    Ok(result)
}

/// Check again inside the existing message/outbox transaction, after a replay
/// lookup and before any new writer mutates the conversation.
pub(crate) fn admit_submission(
    db: &Connection,
    scope: &ChatScope,
    request: &wire::NativeSubmitPayload,
    resolved: Option<&ResolvedExpert>,
) -> Result<(), Error> {
    request.validate().map_err(|_| Error::InvalidRequest)?;
    match (&request.expert, resolved) {
        (Some(selected), Some(value))
            if selected.expert_id == value.reference.expert_id
                && selected.version == value.reference.version =>
        {
            value.validate()?
        }
        (None, None) => {}
        _ => return Err(Error::VersionUnavailable),
    }
    let Some(session) = request.submission.session_id.as_deref() else {
        return if request.expected_binding_revision == 0 {
            Ok(())
        } else {
            Err(Error::RevisionConflict)
        };
    };
    let binding = read(db, scope, session)?;
    require_settled(db, session)?;
    if binding.binding_revision != request.expected_binding_revision {
        return Err(Error::RevisionConflict);
    }
    if reference(db, scope, session)? != resolved.map(|value| value.reference.clone()) {
        // An existing conversation changes only through a confirmed binding
        // operation. A new catalog/version may not silently replace its bytes.
        return Err(Error::BindingUnavailable);
    }
    Ok(())
}

/// Called after the original market row is inserted in the SAME transaction.
/// The actual admitted turn ID, not the UI request ID, binds the snapshot.
pub(crate) fn freeze_submission(
    db: &Transaction<'_>,
    scope: &ChatScope,
    request: &wire::NativeSubmitPayload,
    resolved: Option<&ResolvedExpert>,
    receipt: &wire::NativeReceipt,
    timestamp: i64,
) -> Result<wire::NativeSubmissionResult, Error> {
    receipt.validate().map_err(|_| Error::InvalidRequest)?;
    admit_submission(db, scope, request, resolved)?;
    owned(db, scope, &receipt.session_id)?;
    if timestamp < 0
        || receipt.submission_operation_id != request.submission.operation_id
        || request
            .submission
            .session_id
            .as_ref()
            .is_some_and(|id| id != &receipt.session_id)
    {
        return Err(Error::RequestConflict);
    }
    let matches_market: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM chat_market_submissions WHERE submission_operation_id=?1 AND session_id=?2 AND turn_operation_id=?3)",
        params![receipt.submission_operation_id,receipt.session_id,receipt.turn_operation_id],|row| row.get(0),
    ).map_err(db_error)?;
    if !matches_market {
        return Err(Error::RequestConflict);
    }
    let snapshot = wire::freeze_snapshot(
        receipt.turn_operation_id.clone(),
        request.expected_binding_revision,
        resolved.map(|value| value.reference.clone()),
    )
    .map_err(|_| Error::InvalidRequest)?;
    let display = resolved.map(|value| value.display.clone());
    db.execute(
        "INSERT INTO chat_expert_bindings(session_id,binding_revision,expert_ref_json,display_json,state,updated_at) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(session_id) DO NOTHING",
        params![receipt.session_id,request.expected_binding_revision,resolved.map(|value|encode(&value.reference)).transpose()?,display.as_ref().map(encode).transpose()?,if resolved.is_some(){"ready"}else{"none"},timestamp],
    ).map_err(db_error)?;
    db.execute(
        "INSERT INTO chat_expert_submissions(submission_operation_id,session_id,snapshot_json,display_json) VALUES(?1,?2,?3,?4)",
        params![receipt.submission_operation_id,receipt.session_id,encode(&snapshot)?,display.as_ref().map(encode).transpose()?],
    ).map_err(db_error)?;
    Ok(wire::NativeSubmissionResult {
        receipt: receipt.clone(),
        expert: display,
        binding_revision: request.expected_binding_revision,
    })
}

struct SubmissionRow {
    format: i64,
    snapshot: String,
    display: Option<String>,
    turn: String,
    session: String,
    market_session: String,
}

pub(crate) fn submission(
    db: &Connection,
    scope: &ChatScope,
    operation: &str,
) -> Result<Option<(wire::TurnExpertSnapshot, Option<wire::ExpertDisplay>)>, Error> {
    if !has_storage(db)? {
        return Ok(None);
    }
    let row: Option<SubmissionRow> = db.query_row(
        "SELECT e.format_version,e.snapshot_json,e.display_json,m.turn_operation_id,e.session_id,m.session_id FROM chat_expert_submissions e JOIN chat_market_submissions m USING(submission_operation_id) JOIN chat_sessions s ON s.id=e.session_id WHERE e.submission_operation_id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3",
        params![operation,scope.owner_user_id,scope.tenant_id],|r| Ok(SubmissionRow { format:r.get(0)?,snapshot:r.get(1)?,display:r.get(2)?,turn:r.get(3)?,session:r.get(4)?,market_session:r.get(5)? }),
    ).optional().map_err(db_error)?;
    let Some(row) = row else {
        return Ok(None);
    };
    if row.format != 1 || row.session != row.market_session {
        return Err(Error::BindingUnavailable);
    }
    let snapshot: wire::TurnExpertSnapshot = decode(&row.snapshot)?;
    let display: Option<wire::ExpertDisplay> = row.display.as_deref().map(decode).transpose()?;
    if snapshot.turn_operation_id != row.turn {
        return Err(Error::BindingUnavailable);
    }
    match (&snapshot.expert, &display) {
        (None, None) => {}
        (Some(reference), Some(display))
            if reference.expert_id == display.expert_id && reference.version == display.version => {
        }
        _ => return Err(Error::BindingUnavailable),
    }
    Ok(Some((snapshot, display)))
}

/// Assets are shared across locally retained conversations. Checking only the
/// caller's current session would permit deletion of another conversation's
/// immutable reference. Returns only a boolean, never another scope's content.
pub(crate) fn resource_in_use(
    db: &Connection,
    selected: &wire::ExpertSelection,
) -> Result<bool, Error> {
    selected.validate().map_err(|_| Error::InvalidRequest)?;
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM chat_expert_bindings WHERE json_extract(expert_ref_json,'$.expertId')=?1 AND json_extract(expert_ref_json,'$.version')=?2) OR EXISTS(SELECT 1 FROM chat_expert_submissions WHERE json_extract(snapshot_json,'$.expert.expertId')=?1 AND json_extract(snapshot_json,'$.expert.version')=?2) OR EXISTS(SELECT 1 FROM chat_expert_binding_operations WHERE state IN ('pending','unknown') AND json_extract(requested_ref_json,'$.expertId')=?1 AND json_extract(requested_ref_json,'$.version')=?2)",
        params![selected.expert_id,selected.version],|row|row.get(0),
    ).map_err(db_error)
}

/// The existing installer has one directory per installation identity. A new
/// version may not replace bytes retained by an older conversation snapshot.
pub(crate) fn resource_replacement_in_use(
    db: &Connection,
    selected: &wire::ExpertSelection,
) -> Result<bool, Error> {
    selected.validate().map_err(|_| Error::InvalidRequest)?;
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM (SELECT expert_ref_json AS reference FROM chat_expert_bindings UNION ALL SELECT json_extract(snapshot_json,'$.expert') AS reference FROM chat_expert_submissions UNION ALL SELECT requested_ref_json AS reference FROM chat_expert_binding_operations WHERE state IN ('pending','unknown')) WHERE json_extract(reference,'$.expertId')=?1 AND json_extract(reference,'$.version')!=?2)",
        params![selected.expert_id, selected.version],
        |row| row.get(0),
    ).map_err(db_error)
}

/// Read the exact original adapter attempt for read-only receipt recovery.
pub(crate) fn apply_payload(
    db: &Connection,
    scope: &ChatScope,
    session: &str,
    operation: &str,
) -> Result<Option<wire::ApplyPayload>, Error> {
    owned(db, scope, session)?;
    let value: Option<Option<String>> = db.query_row(
        "SELECT apply_payload_json FROM chat_expert_binding_operations WHERE session_id=?1 AND operation_id=?2 AND format_version=1",
        params![session,operation],|row|row.get(0),
    ).optional().map_err(db_error)?;
    value.flatten().as_deref().map(decode).transpose()
}

/// A typed rejection of an owned request is distinct from a missing response.
/// Neither case is represented as a successful Runtime instruction receipt.
pub(crate) enum AttemptFailure {
    Rejected(Error),
    Unknown,
}
pub(crate) fn fail_attempt(
    db: &Transaction<'_>,
    scope: &ChatScope,
    session: &str,
    operation: &str,
    failure: AttemptFailure,
    timestamp: i64,
) -> Result<wire::BindingResult, Error> {
    let mut result = read_operation(db, scope, session, operation)?.ok_or(Error::NotFound)?;
    if matches!(
        result.operation.state,
        wire::OperationState::Succeeded | wire::OperationState::Rejected
    ) {
        return Ok(result);
    }
    let current = read(db, scope, session)?;
    if current.operation_id.as_deref() != Some(operation) {
        return Err(Error::RequestConflict);
    }
    let updated: i64 = db
        .query_row(
            "SELECT updated_at FROM chat_expert_binding_operations WHERE operation_id=?1",
            [operation],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if timestamp < updated {
        return Err(Error::RequestConflict);
    }
    result.binding = current;
    match failure {
        AttemptFailure::Unknown => {
            result.operation.state = wire::OperationState::Unknown;
            result.operation.error_code = Some(Error::OutcomeUnknown);
            result.binding.state = wire::BindingState::Unknown;
        }
        AttemptFailure::Rejected(code) => {
            result.operation.state = wire::OperationState::Rejected;
            result.operation.error_code = Some(code);
            result.binding.state = if result.binding.expert.is_some() {
                wire::BindingState::Ready
            } else {
                wire::BindingState::None
            };
        }
    }
    db.execute("UPDATE chat_expert_binding_operations SET state=?2,receipt_json=?3,updated_at=?4 WHERE operation_id=?1",params![operation,encode(&result.operation.state)?.trim_matches('"'),encode(&result)?,timestamp]).map_err(db_error)?;
    db.execute("UPDATE chat_expert_bindings SET state=?2,updated_at=?3 WHERE session_id=?1 AND operation_id=?4",params![session,encode(&result.binding.state)?.trim_matches('"'),timestamp,operation]).map_err(db_error)?;
    Ok(result)
}
