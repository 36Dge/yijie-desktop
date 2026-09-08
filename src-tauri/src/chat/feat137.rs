use super::error::ChatError;
use super::feat134::{
    Feat134Projection, TimelineDelta, TimelineItem, TimelinePhase, TimelinePlan,
    TimelineReasoningPart, TimelineReasoningStatus,
};
use super::host_domain::{
    protocol_error, HostApprovalDecision, HostApprovalOutcome, HostBridgeError,
    HostBridgeErrorKind, HostErrorCode, HostEvent, HostEventKind,
};
use serde::{Deserialize, Serialize};
use std::fmt::{Debug, Formatter};
use uuid::Uuid;

pub const FEAT137_FLAG: &str = "YIJIE_FEAT137_COMMAND_APPROVAL_ENABLED";
pub const SOURCE_SCHEMA_VERSION: u8 = 6;
pub const ACTION_ID: &str = "git_repository_check";
pub const WORKSPACE_SCOPE: &str = "current_workspace";
pub const PRIMARY_DECISION: &str = "accept_once";
pub const SECONDARY_DECISION: &str = "cancel_current_turn";
pub const TTL_SECONDS: u16 = 120;
pub const PROCESS_CONTENT_PROTECTED_MESSAGE: &str =
    "为保护命令、路径与审批上下文，模型过程内容已隐藏。";

fn is_process_agent_message(item: &TimelineItem) -> bool {
    item.item_type == "agentMessage" && item.phase != Some(TimelinePhase::FinalAnswer)
}

// Readonly validation of archived protected process content.
fn protected_parts_are_valid(
    status: Option<TimelineReasoningStatus>,
    parts: &[TimelineReasoningPart],
) -> bool {
    let protected = parts.len() == 1
        && parts[0].content_index == 0
        && parts[0].text == PROCESS_CONTENT_PROTECTED_MESSAGE;
    match status {
        Some(TimelineReasoningStatus::Complete | TimelineReasoningStatus::Incomplete) => protected,
        Some(TimelineReasoningStatus::Unavailable) => parts.is_empty(),
        None => parts.is_empty() || protected,
    }
}

fn protected_item_is_valid(item: &TimelineItem) -> bool {
    if is_process_agent_message(item) {
        item.text == PROCESS_CONTENT_PROTECTED_MESSAGE && item.reasoning_parts.is_empty()
    } else if item.item_type == "reasoning" {
        item.text.is_empty()
            && protected_parts_are_valid(item.reasoning_status, &item.reasoning_parts)
    } else {
        true
    }
}

fn protected_plan_is_valid(plan: &TimelinePlan) -> bool {
    plan.explanation
        .as_ref()
        .is_none_or(|value| value == PROCESS_CONTENT_PROTECTED_MESSAGE)
        && plan
            .steps
            .iter()
            .all(|step| step.step == PROCESS_CONTENT_PROTECTED_MESSAGE)
}

pub(crate) fn validate_process_state(
    items: &[TimelineItem],
    plan: Option<&TimelinePlan>,
) -> Result<(), ChatError> {
    if items.iter().all(protected_item_is_valid) && plan.is_none_or(protected_plan_is_valid) {
        Ok(())
    } else {
        Err(ChatError::InvalidInput)
    }
}

/// Defense-in-depth invariant for every v6 SQLCipher and IPC entry point. This is deliberately
/// validation-only: callers must use `protect_process_projection` rather than silently repairing
/// a projection at a storage or transport boundary.
pub(crate) fn validate_process_projection(projection: &Feat134Projection) -> Result<(), ChatError> {
    validate_process_state(&projection.items, projection.plan.as_ref())?;
    let valid_delta = match &projection.delta {
        TimelineDelta::PlanUpdated(plan) => protected_plan_is_valid(plan),
        TimelineDelta::ItemStarted(item) | TimelineDelta::ItemCompleted(item) => {
            protected_item_is_valid(item)
        }
        TimelineDelta::AgentMessageAppend { phase, text, .. } => {
            *phase == Some(TimelinePhase::FinalAnswer) || text == PROCESS_CONTENT_PROTECTED_MESSAGE
        }
        TimelineDelta::ReasoningAppend { text, .. } => text == PROCESS_CONTENT_PROTECTED_MESSAGE,
        TimelineDelta::ReasoningFinalized { status, parts, .. } => {
            protected_parts_are_valid(Some(*status), parts)
        }
        _ => true,
    };
    if valid_delta {
        Ok(())
    } else {
        Err(ChatError::InvalidInput)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApprovalProjectionStatus {
    Pending,
    Resolved,
}

impl ApprovalProjectionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Resolved => "resolved",
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct ApprovalProjection {
    pub session_id: Uuid,
    pub turn_id: Uuid,
    pub item_id: String,
    pub approval_request_id: Uuid,
    pub status: ApprovalProjectionStatus,
    pub revision: u8,
    pub requested_at: String,
    pub expires_at: String,
    pub outcome: Option<HostApprovalOutcome>,
    pub decision_id: Option<Uuid>,
    pub decision: Option<HostApprovalDecision>,
    pub resolved_at: Option<String>,
    pub source_event_id: Uuid,
    pub source_sequence: u64,
    pub source_occurred_at: String,
    pub durable_sequence: Option<u64>,
}

impl Debug for ApprovalProjection {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ApprovalProjection")
            .field("session_id", &self.session_id)
            .field("turn_id", &self.turn_id)
            .field("item_id_utf8_bytes", &self.item_id.len())
            .field("status", &self.status)
            .field("revision", &self.revision)
            .field("outcome", &self.outcome)
            .field("decision_present", &self.decision.is_some())
            .field("source_event_id", &self.source_event_id)
            .field("source_sequence", &self.source_sequence)
            .field("durable_sequence", &self.durable_sequence)
            .finish()
    }
}

impl ApprovalProjection {
    pub fn from_event(
        event: &HostEvent,
        desktop_session_id: Uuid,
        desktop_turn_id: Uuid,
        expected_runtime_turn_id: Uuid,
    ) -> Result<Option<Self>, ChatError> {
        if desktop_session_id.is_nil()
            || desktop_turn_id.is_nil()
            || expected_runtime_turn_id.is_nil()
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        match &event.kind {
            HostEventKind::ApprovalRequested(_) | HostEventKind::ApprovalResolved(_)
                if event.turn_id == Some(expected_runtime_turn_id) => {}
            HostEventKind::ApprovalRequested(_) | HostEventKind::ApprovalResolved(_) => {
                return Err(ChatError::OrchestrationUnavailable)
            }
            _ => return Ok(None),
        }
        let item_id = event
            .item_id
            .clone()
            .ok_or(ChatError::OrchestrationUnavailable)?;
        let common = |approval_request_id, status, revision, requested_at, expires_at| Self {
            session_id: desktop_session_id,
            turn_id: desktop_turn_id,
            item_id: item_id.clone(),
            approval_request_id,
            status,
            revision,
            requested_at,
            expires_at,
            outcome: None,
            decision_id: None,
            decision: None,
            resolved_at: None,
            source_event_id: event.event_id,
            source_sequence: event.cursor.sequence,
            source_occurred_at: event.occurred_at.clone(),
            durable_sequence: None,
        };
        Ok(Some(match &event.kind {
            HostEventKind::ApprovalRequested(approval) => common(
                approval.approval_request_id,
                ApprovalProjectionStatus::Pending,
                1,
                approval.requested_at.clone(),
                approval.expires_at.clone(),
            ),
            HostEventKind::ApprovalResolved(approval) => {
                let mut projection = common(
                    approval.approval_request_id,
                    ApprovalProjectionStatus::Resolved,
                    2,
                    approval.requested_at.clone(),
                    approval.expires_at.clone(),
                );
                projection.outcome = Some(approval.outcome);
                projection.decision_id = approval.decision_id;
                projection.decision = approval.decision;
                projection.resolved_at = Some(approval.resolved_at.clone());
                projection
            }
            _ => unreachable!(),
        }))
    }

    pub fn with_durable_sequence(mut self, durable_sequence: u64) -> Result<Self, ChatError> {
        if durable_sequence == 0 || self.durable_sequence.is_some() {
            return Err(ChatError::DatabaseUnavailable);
        }
        self.durable_sequence = Some(durable_sequence);
        Ok(self)
    }

    pub(crate) fn validate_durable(&self) -> Result<(), ChatError> {
        if self.session_id.is_nil()
            || self.turn_id.is_nil()
            || self.approval_request_id.is_nil()
            || self.source_event_id.is_nil()
            || self.source_sequence == 0
            || self.durable_sequence.is_none_or(|sequence| sequence == 0)
            || self.item_id.is_empty()
            || self.item_id.chars().count() > 256
            || self.item_id.len() > 1024
            || self
                .item_id
                .chars()
                .any(|character| matches!(character, '\r' | '\n' | '\0'))
        {
            return Err(ChatError::DatabaseUnavailable);
        }
        let requested_at =
            parse_rfc3339_epoch_nanos(&self.requested_at).ok_or(ChatError::DatabaseUnavailable)?;
        let expires_at =
            parse_rfc3339_epoch_nanos(&self.expires_at).ok_or(ChatError::DatabaseUnavailable)?;
        let _source_occurred_at = parse_rfc3339_epoch_nanos(&self.source_occurred_at)
            .ok_or(ChatError::DatabaseUnavailable)?;
        if expires_at.checked_sub(requested_at) != Some(i128::from(TTL_SECONDS) * 1_000_000_000) {
            return Err(ChatError::DatabaseUnavailable);
        }
        match (
            self.status,
            self.revision,
            self.outcome,
            self.decision_id,
            self.decision,
            self.resolved_at.as_deref(),
        ) {
            (ApprovalProjectionStatus::Pending, 1, None, None, None, None) => Ok(()),
            (
                ApprovalProjectionStatus::Resolved,
                2,
                Some(HostApprovalOutcome::AcceptedOnce),
                Some(decision_id),
                Some(HostApprovalDecision::AcceptOnce),
                Some(resolved_at),
            )
            | (
                ApprovalProjectionStatus::Resolved,
                2,
                Some(HostApprovalOutcome::CancelledCurrentTurn),
                Some(decision_id),
                Some(HostApprovalDecision::CancelCurrentTurn),
                Some(resolved_at),
            ) => {
                let resolved_at =
                    parse_rfc3339_epoch_nanos(resolved_at).ok_or(ChatError::DatabaseUnavailable)?;
                if decision_id.is_nil() || resolved_at < requested_at || resolved_at >= expires_at {
                    Err(ChatError::DatabaseUnavailable)
                } else {
                    Ok(())
                }
            }
            (
                ApprovalProjectionStatus::Resolved,
                2,
                Some(HostApprovalOutcome::Expired),
                None,
                None,
                Some(resolved_at),
            ) => {
                let resolved_at =
                    parse_rfc3339_epoch_nanos(resolved_at).ok_or(ChatError::DatabaseUnavailable)?;
                if resolved_at < expires_at {
                    Err(ChatError::DatabaseUnavailable)
                } else {
                    Ok(())
                }
            }
            (
                ApprovalProjectionStatus::Resolved,
                2,
                Some(HostApprovalOutcome::ResolvedElsewhere),
                None,
                None,
                Some(resolved_at),
            ) => {
                let resolved_at =
                    parse_rfc3339_epoch_nanos(resolved_at).ok_or(ChatError::DatabaseUnavailable)?;
                if resolved_at < requested_at || resolved_at >= expires_at {
                    Err(ChatError::DatabaseUnavailable)
                } else {
                    Ok(())
                }
            }
            _ => Err(ChatError::DatabaseUnavailable),
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct HostPendingApproval {
    pub approval_request_id: Uuid,
    pub task_id: Uuid,
    pub agent_session_id: Uuid,
    pub codex_thread_id: Uuid,
    pub turn_id: Uuid,
    pub item_id: String,
    pub requested_at: String,
    pub expires_at: String,
}

impl Debug for HostPendingApproval {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostPendingApproval")
            .field("revision", &1)
            .field("item_id_utf8_bytes", &self.item_id.len())
            .field("action_id", &ACTION_ID)
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct HostPendingApprovalSnapshot {
    pub stream_id: Uuid,
    pub snapshot_at: String,
    pub pending: Vec<HostPendingApproval>,
}

pub(crate) struct ApprovalDecisionIdentity<'a> {
    pub desktop_session_id: Uuid,
    pub desktop_turn_id: Uuid,
    pub item_id: &'a str,
    pub approval_request_id: Uuid,
    pub task_id: Uuid,
    pub agent_session_id: Uuid,
    pub codex_thread_id: Uuid,
    pub runtime_turn_id: Uuid,
    pub persisted_stream_id: Option<Uuid>,
}

pub(crate) fn require_pending_decision_authority<'a>(
    snapshot: &'a HostPendingApprovalSnapshot,
    identity: &ApprovalDecisionIdentity<'_>,
) -> Result<&'a HostPendingApproval, ApprovalDecisionFailure> {
    if identity.desktop_session_id.is_nil()
        || identity.desktop_turn_id.is_nil()
        || identity.approval_request_id.is_nil()
        || identity.task_id.is_nil()
        || identity.agent_session_id.is_nil()
        || identity.codex_thread_id.is_nil()
        || identity.runtime_turn_id.is_nil()
        || identity.item_id.is_empty()
        || identity.item_id.chars().count() > 256
        || identity.item_id.len() > 1024
        || identity.item_id.contains(['\r', '\n', '\0'])
        || identity.persisted_stream_id != Some(snapshot.stream_id)
    {
        return Err(ApprovalDecisionFailure::stale());
    }
    let Some(pending) = snapshot.pending.first() else {
        return Err(ApprovalDecisionFailure::not_found());
    };
    if snapshot.pending.len() != 1
        || pending.approval_request_id != identity.approval_request_id
        || pending.task_id != identity.task_id
        || pending.agent_session_id != identity.agent_session_id
        || pending.codex_thread_id != identity.codex_thread_id
        || pending.turn_id != identity.runtime_turn_id
        || pending.item_id != identity.item_id
    {
        return Err(ApprovalDecisionFailure::stale());
    }
    Ok(pending)
}

#[derive(Clone, PartialEq, Eq)]
pub struct PendingApproval {
    pub approval_request_id: Uuid,
    pub turn_id: Uuid,
    pub item_id: String,
    pub requested_at: String,
    pub expires_at: String,
}

#[derive(Clone, PartialEq, Eq)]
pub struct PendingApprovalSnapshot {
    pub stream_id: Uuid,
    pub snapshot_at: String,
    pub pending: Vec<PendingApproval>,
}

#[derive(Clone, PartialEq, Eq)]
pub struct ApprovalDecisionResult {
    pub approval_request_id: Uuid,
    pub decision_id: Uuid,
    pub stream_id: Uuid,
    pub decision: HostApprovalDecision,
    pub outcome: HostApprovalOutcome,
    pub resolved_at: String,
}

impl Debug for ApprovalDecisionResult {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ApprovalDecisionResult")
            .field("schema_version", &SOURCE_SCHEMA_VERSION)
            .field("approval_request_id", &self.approval_request_id)
            .field("decision_id", &self.decision_id)
            .field("stream_id", &self.stream_id)
            .field("revision", &2)
            .field("decision", &self.decision)
            .field("outcome", &self.outcome)
            .finish()
    }
}

impl ApprovalDecisionResult {
    pub(crate) fn validate_window(
        &self,
        requested_at: &str,
        expires_at: &str,
    ) -> Result<(), ApprovalDecisionFailure> {
        let requested = parse_rfc3339_epoch_nanos(requested_at)
            .ok_or_else(ApprovalDecisionFailure::reconciliation_required)?;
        let expires = parse_rfc3339_epoch_nanos(expires_at)
            .ok_or_else(ApprovalDecisionFailure::reconciliation_required)?;
        let resolved = parse_rfc3339_epoch_nanos(&self.resolved_at)
            .ok_or_else(ApprovalDecisionFailure::reconciliation_required)?;
        if expires.checked_sub(requested) != Some(i128::from(TTL_SECONDS) * 1_000_000_000)
            || resolved < requested
            || resolved >= expires
        {
            return Err(ApprovalDecisionFailure::reconciliation_required());
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalIssue {
    Unauthorized,
    InvalidApprovalRequest,
    ApprovalVersionMismatch,
    SessionNotFound,
    ApprovalNotFound,
    ApprovalStale,
    ApprovalExpired,
    ApprovalAlreadyResolved,
    ApprovalDecisionConflict,
    ApprovalUnavailable,
    InternalError,
}

impl ApprovalIssue {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Unauthorized => "unauthorized",
            Self::InvalidApprovalRequest => "invalid_approval_request",
            Self::ApprovalVersionMismatch => "approval_version_mismatch",
            Self::SessionNotFound => "session_not_found",
            Self::ApprovalNotFound => "approval_not_found",
            Self::ApprovalStale => "approval_stale",
            Self::ApprovalExpired => "approval_expired",
            Self::ApprovalAlreadyResolved => "approval_already_resolved",
            Self::ApprovalDecisionConflict => "approval_decision_conflict",
            Self::ApprovalUnavailable => "approval_unavailable",
            Self::InternalError => "internal_error",
        }
    }

    fn from_host_code(code: HostErrorCode) -> Option<Self> {
        Some(match code {
            HostErrorCode::Unauthorized => Self::Unauthorized,
            HostErrorCode::InvalidApprovalRequest => Self::InvalidApprovalRequest,
            HostErrorCode::ApprovalVersionMismatch => Self::ApprovalVersionMismatch,
            HostErrorCode::SessionNotFound => Self::SessionNotFound,
            HostErrorCode::ApprovalNotFound => Self::ApprovalNotFound,
            HostErrorCode::ApprovalStale => Self::ApprovalStale,
            HostErrorCode::ApprovalExpired => Self::ApprovalExpired,
            HostErrorCode::ApprovalAlreadyResolved => Self::ApprovalAlreadyResolved,
            HostErrorCode::ApprovalDecisionConflict => Self::ApprovalDecisionConflict,
            HostErrorCode::ApprovalUnavailable => Self::ApprovalUnavailable,
            HostErrorCode::InternalError => Self::InternalError,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ApprovalDecisionFailure {
    issue: ApprovalIssue,
}

impl ApprovalDecisionFailure {
    pub const fn reconciliation_required() -> Self {
        Self {
            issue: ApprovalIssue::InternalError,
        }
    }

    pub const fn stale() -> Self {
        Self {
            issue: ApprovalIssue::ApprovalStale,
        }
    }

    pub const fn not_found() -> Self {
        Self {
            issue: ApprovalIssue::ApprovalNotFound,
        }
    }

    pub const fn unavailable() -> Self {
        Self {
            issue: ApprovalIssue::ApprovalUnavailable,
        }
    }

    pub fn from_host(error: &HostBridgeError) -> Self {
        let issue = if error.kind() == HostBridgeErrorKind::Rejected {
            error
                .code()
                .and_then(ApprovalIssue::from_host_code)
                .unwrap_or(ApprovalIssue::InternalError)
        } else if matches!(
            error.kind(),
            HostBridgeErrorKind::Protocol | HostBridgeErrorKind::AcceptedResponseInvalid
        ) {
            ApprovalIssue::InternalError
        } else {
            ApprovalIssue::ApprovalUnavailable
        };
        Self { issue }
    }

    pub const fn issue(self) -> ApprovalIssue {
        self.issue
    }
}

impl Debug for PendingApprovalSnapshot {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PendingApprovalSnapshot")
            .field("schema_version", &SOURCE_SCHEMA_VERSION)
            .field("stream_id", &self.stream_id)
            .field("pending_count", &self.pending.len())
            .finish()
    }
}

impl Debug for HostPendingApprovalSnapshot {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostPendingApprovalSnapshot")
            .field("schema_version", &SOURCE_SCHEMA_VERSION)
            .field("stream_id", &self.stream_id)
            .field("pending_count", &self.pending.len())
            .finish()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WirePendingApprovalSnapshot {
    schema_version: u8,
    stream_id: String,
    snapshot_at: String,
    pending: Vec<WirePendingApproval>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WirePendingApproval {
    approval_request_id: String,
    revision: u8,
    task_id: String,
    agent_session_id: String,
    codex_thread_id: String,
    turn_id: String,
    item_id: String,
    action_id: String,
    workspace_scope: String,
    decisions: WireApprovalDecisionSet,
    requested_at: String,
    expires_at: String,
    ttl_seconds: u16,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireApprovalDecisionSet {
    primary: String,
    secondary: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireApprovalDecisionResponse {
    schema_version: u8,
    approval_request_id: String,
    decision_id: String,
    stream_id: String,
    revision: u8,
    decision: String,
    outcome: String,
    resolved_at: String,
}

pub(super) fn decode_approval_decision_response_v6(
    bytes: &[u8],
    expected_approval_request_id: Uuid,
    expected_decision_id: Uuid,
    expected_stream_id: Uuid,
    expected_decision: HostApprovalDecision,
) -> Result<ApprovalDecisionResult, HostBridgeError> {
    if expected_approval_request_id.is_nil()
        || expected_decision_id.is_nil()
        || expected_stream_id.is_nil()
    {
        return Err(protocol_error());
    }
    let wire: WireApprovalDecisionResponse =
        serde_json::from_slice(bytes).map_err(|_| protocol_error())?;
    let approval_request_id = parse_non_nil_uuid(&wire.approval_request_id)?;
    let decision_id = parse_non_nil_uuid(&wire.decision_id)?;
    let stream_id = parse_non_nil_uuid(&wire.stream_id)?;
    let decision = match wire.decision.as_str() {
        PRIMARY_DECISION => HostApprovalDecision::AcceptOnce,
        SECONDARY_DECISION => HostApprovalDecision::CancelCurrentTurn,
        _ => return Err(protocol_error()),
    };
    let outcome = match wire.outcome.as_str() {
        "accepted_once" => HostApprovalOutcome::AcceptedOnce,
        "cancelled_current_turn" => HostApprovalOutcome::CancelledCurrentTurn,
        _ => return Err(protocol_error()),
    };
    if wire.schema_version != SOURCE_SCHEMA_VERSION
        || approval_request_id != expected_approval_request_id
        || decision_id != expected_decision_id
        || stream_id != expected_stream_id
        || wire.revision != 2
        || decision != expected_decision
        || !matches!(
            (decision, outcome),
            (
                HostApprovalDecision::AcceptOnce,
                HostApprovalOutcome::AcceptedOnce
            ) | (
                HostApprovalDecision::CancelCurrentTurn,
                HostApprovalOutcome::CancelledCurrentTurn
            )
        )
        || parse_rfc3339_epoch_nanos(&wire.resolved_at).is_none()
    {
        return Err(protocol_error());
    }
    Ok(ApprovalDecisionResult {
        approval_request_id,
        decision_id,
        stream_id,
        decision,
        outcome,
        resolved_at: wire.resolved_at,
    })
}

pub(super) fn decode_pending_approval_snapshot_v6(
    bytes: &[u8],
    expected_session_id: Uuid,
) -> Result<HostPendingApprovalSnapshot, HostBridgeError> {
    let wire: WirePendingApprovalSnapshot =
        serde_json::from_slice(bytes).map_err(|_| protocol_error())?;
    if wire.schema_version != SOURCE_SCHEMA_VERSION
        || wire.pending.len() > 1
        || expected_session_id.is_nil()
    {
        return Err(protocol_error());
    }
    let stream_id = parse_non_nil_uuid(&wire.stream_id)?;
    let snapshot_at = parse_rfc3339_epoch_nanos(&wire.snapshot_at).ok_or_else(protocol_error)?;
    let mut pending = Vec::with_capacity(wire.pending.len());
    for approval in wire.pending {
        if approval.revision != 1
            || approval.action_id != ACTION_ID
            || approval.workspace_scope != WORKSPACE_SCOPE
            || approval.decisions.primary != PRIMARY_DECISION
            || approval.decisions.secondary != SECONDARY_DECISION
            || approval.ttl_seconds != TTL_SECONDS
            || approval.item_id.is_empty()
            || approval.item_id.chars().count() > 256
            || approval.item_id.len() > 1024
            || approval.item_id.contains(['\r', '\n', '\0'])
        {
            return Err(protocol_error());
        }
        let agent_session_id = parse_non_nil_uuid(&approval.agent_session_id)?;
        let requested_at =
            parse_rfc3339_epoch_nanos(&approval.requested_at).ok_or_else(protocol_error)?;
        let expires_at =
            parse_rfc3339_epoch_nanos(&approval.expires_at).ok_or_else(protocol_error)?;
        if agent_session_id != expected_session_id
            || expires_at.checked_sub(requested_at) != Some(i128::from(TTL_SECONDS) * 1_000_000_000)
            || snapshot_at < requested_at
            || snapshot_at >= expires_at
        {
            return Err(protocol_error());
        }
        pending.push(HostPendingApproval {
            approval_request_id: parse_non_nil_uuid(&approval.approval_request_id)?,
            task_id: parse_non_nil_uuid(&approval.task_id)?,
            agent_session_id,
            codex_thread_id: parse_non_nil_uuid(&approval.codex_thread_id)?,
            turn_id: parse_non_nil_uuid(&approval.turn_id)?,
            item_id: approval.item_id,
            requested_at: approval.requested_at,
            expires_at: approval.expires_at,
        });
    }
    Ok(HostPendingApprovalSnapshot {
        stream_id,
        snapshot_at: wire.snapshot_at,
        pending,
    })
}

fn parse_non_nil_uuid(value: &str) -> Result<Uuid, HostBridgeError> {
    let value = Uuid::parse_str(value).map_err(|_| protocol_error())?;
    (!value.is_nil())
        .then_some(value)
        .ok_or_else(protocol_error)
}

fn parse_rfc3339_epoch_nanos(value: &str) -> Option<i128> {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes.len() > 64
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return None;
    }
    let year = parse_decimal(bytes.get(0..4)?)?;
    let month = parse_decimal(bytes.get(5..7)?)?;
    let day = parse_decimal(bytes.get(8..10)?)?;
    let hour = parse_decimal(bytes.get(11..13)?)?;
    let minute = parse_decimal(bytes.get(14..16)?)?;
    let second = parse_decimal(bytes.get(17..19)?)?;
    if year == 0
        || !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(year, month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let mut index = 19_usize;
    let mut fraction_nanos = 0_i128;
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        let start = index;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) && index - start < 9 {
            fraction_nanos = fraction_nanos
                .checked_mul(10)?
                .checked_add(i128::from(bytes[index] - b'0'))?;
            index += 1;
        }
        if index == start || bytes.get(index).is_some_and(u8::is_ascii_digit) {
            return None;
        }
        for _ in index - start..9 {
            fraction_nanos = fraction_nanos.checked_mul(10)?;
        }
    }
    let offset_seconds = if bytes.get(index) == Some(&b'Z') && index + 1 == bytes.len() {
        0_i64
    } else {
        let sign = match bytes.get(index) {
            Some(b'+') => 1_i64,
            Some(b'-') => -1_i64,
            _ => return None,
        };
        if index + 6 != bytes.len() || bytes.get(index + 3) != Some(&b':') {
            return None;
        }
        let offset_hour = parse_decimal(bytes.get(index + 1..index + 3)?)?;
        let offset_minute = parse_decimal(bytes.get(index + 4..index + 6)?)?;
        if offset_hour > 23 || offset_minute > 59 {
            return None;
        }
        sign * i64::from(offset_hour * 3600 + offset_minute * 60)
    };
    let seconds = days_from_civil(year, month, day)?
        .checked_mul(86_400)?
        .checked_add(i64::from(hour * 3600 + minute * 60 + second))?
        .checked_sub(offset_seconds)?;
    i128::from(seconds)
        .checked_mul(1_000_000_000)?
        .checked_add(fraction_nanos)
}

fn parse_decimal(bytes: &[u8]) -> Option<u32> {
    if bytes.is_empty() || !bytes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    bytes.iter().try_fold(0_u32, |value, digit| {
        value.checked_mul(10)?.checked_add(u32::from(*digit - b'0'))
    })
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year.is_multiple_of(400) || (year.is_multiple_of(4) && !year.is_multiple_of(100)) => {
            29
        }
        2 => 28,
        _ => 0,
    }
}

fn days_from_civil(year: u32, month: u32, day: u32) -> Option<i64> {
    let year = i64::from(year) - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let shifted_month = i64::from(month) + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era.checked_mul(146_097)?
        .checked_add(day_of_era)?
        .checked_sub(719_468)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::chat::host_domain::{HostApprovalRequested, HostEventCursor};
    use serde_json::json;

    const SESSION_ID: &str = "22222222-2222-4222-8222-222222222222";

    fn pending_snapshot() -> serde_json::Value {
        json!({
          "schema_version": 6,
          "stream_id": "55555555-5555-4555-8555-555555555555",
          "snapshot_at": "2026-08-30T12:00:10Z",
          "pending": [{
            "approval_request_id": "66666666-6666-4666-8666-666666666666",
            "revision": 1,
            "task_id": "11111111-1111-4111-8111-111111111111",
            "agent_session_id": SESSION_ID,
            "codex_thread_id": "33333333-3333-4333-8333-333333333333",
            "turn_id": "44444444-4444-4444-8444-444444444444",
            "item_id": "cmd-feat-137-1",
            "action_id": "git_repository_check",
            "workspace_scope": "current_workspace",
            "decisions": {"primary": "accept_once", "secondary": "cancel_current_turn"},
            "requested_at": "2026-08-30T12:00:00Z",
            "expires_at": "2026-08-30T12:02:00Z",
            "ttl_seconds": 120
          }]
        })
    }

    #[test]
    fn pending_snapshot_is_closed_and_live_window_bound() {
        let expected = Uuid::parse_str(SESSION_ID).unwrap();
        let valid = serde_json::to_vec(&pending_snapshot()).unwrap();
        let decoded = decode_pending_approval_snapshot_v6(&valid, expected).unwrap();
        assert_eq!(decoded.pending.len(), 1);

        for invalid in [
            {
                let mut value = pending_snapshot();
                value["pending"][0]["command"] = json!("PRIVATE_COMMAND_CANARY");
                value
            },
            {
                let mut value = pending_snapshot();
                value["snapshot_at"] = json!("2026-08-30T12:02:00Z");
                value
            },
            {
                let mut value = pending_snapshot();
                value["pending"][0]["expires_at"] = json!("2026-08-30T12:01:59Z");
                value
            },
        ] {
            assert!(decode_pending_approval_snapshot_v6(
                &serde_json::to_vec(&invalid).unwrap(),
                expected,
            )
            .is_err());
        }
    }

    #[test]
    fn pending_decision_authority_binds_every_host_and_desktop_identity() {
        let snapshot = decode_pending_approval_snapshot_v6(
            &serde_json::to_vec(&pending_snapshot()).unwrap(),
            Uuid::parse_str(SESSION_ID).unwrap(),
        )
        .unwrap();
        let desktop_session_id = Uuid::from_u128(0x1601);
        let desktop_turn_id = Uuid::from_u128(0x1602);
        let approval_request_id = Uuid::parse_str("66666666-6666-4666-8666-666666666666").unwrap();
        let identity = |approval_request_id, item_id, runtime_turn_id, persisted_stream_id| {
            ApprovalDecisionIdentity {
                desktop_session_id,
                desktop_turn_id,
                item_id,
                approval_request_id,
                task_id: Uuid::parse_str("11111111-1111-4111-8111-111111111111").unwrap(),
                agent_session_id: Uuid::parse_str(SESSION_ID).unwrap(),
                codex_thread_id: Uuid::parse_str("33333333-3333-4333-8333-333333333333").unwrap(),
                runtime_turn_id,
                persisted_stream_id,
            }
        };
        let runtime_turn_id = Uuid::parse_str("44444444-4444-4444-8444-444444444444").unwrap();
        let stream_id = Uuid::parse_str("55555555-5555-4555-8555-555555555555").unwrap();
        let valid = identity(
            approval_request_id,
            "cmd-feat-137-1",
            runtime_turn_id,
            Some(stream_id),
        );
        assert_eq!(
            require_pending_decision_authority(&snapshot, &valid)
                .unwrap()
                .approval_request_id,
            approval_request_id
        );

        for invalid in [
            identity(
                Uuid::from_u128(0x1691),
                "cmd-feat-137-1",
                runtime_turn_id,
                Some(stream_id),
            ),
            identity(
                approval_request_id,
                "different-command",
                runtime_turn_id,
                Some(stream_id),
            ),
            identity(
                approval_request_id,
                "cmd-feat-137-1",
                Uuid::from_u128(0x1692),
                Some(stream_id),
            ),
            identity(
                approval_request_id,
                "cmd-feat-137-1",
                runtime_turn_id,
                Some(Uuid::from_u128(0x1693)),
            ),
            identity(approval_request_id, "cmd-feat-137-1", runtime_turn_id, None),
        ] {
            assert_eq!(
                require_pending_decision_authority(&snapshot, &invalid)
                    .unwrap_err()
                    .issue(),
                ApprovalIssue::ApprovalStale
            );
        }
    }

    #[test]
    fn durable_projection_maps_runtime_turn_to_distinct_desktop_turn() {
        let runtime_turn_id = Uuid::from_u128(0x1371);
        let desktop_turn_id = Uuid::from_u128(0x1372);
        let desktop_session_id = Uuid::from_u128(0x1373);
        let event = HostEvent {
            cursor: HostEventCursor::new(Uuid::from_u128(0x1374), 1).unwrap(),
            event_type: "approval.requested".to_owned(),
            event_id: Uuid::from_u128(0x1375),
            task_id: Uuid::from_u128(0x1376),
            agent_session_id: Uuid::from_u128(0x1377),
            codex_thread_id: Uuid::from_u128(0x1378),
            turn_id: Some(runtime_turn_id),
            item_id: Some("command-1".to_owned()),
            occurred_at: "2026-08-30T12:00:00Z".to_owned(),
            encoded_bytes: 1,
            kind: HostEventKind::ApprovalRequested(HostApprovalRequested {
                approval_request_id: Uuid::from_u128(0x1379),
                requested_at: "2026-08-30T12:00:00Z".to_owned(),
                expires_at: "2026-08-30T12:02:00Z".to_owned(),
            }),
        };
        let projection = ApprovalProjection::from_event(
            &event,
            desktop_session_id,
            desktop_turn_id,
            runtime_turn_id,
        )
        .unwrap()
        .unwrap()
        .with_durable_sequence(1)
        .unwrap();
        assert_eq!(projection.turn_id, desktop_turn_id);
        assert_ne!(projection.turn_id, runtime_turn_id);
        projection.validate_durable().unwrap();
        assert!(ApprovalProjection::from_event(
            &event,
            desktop_session_id,
            desktop_turn_id,
            Uuid::from_u128(0x1380),
        )
        .is_err());
    }

    #[test]
    fn durable_projection_rejects_tampered_safe_hydration_fields() {
        let base = ApprovalProjection {
            session_id: Uuid::from_u128(0x1401),
            turn_id: Uuid::from_u128(0x1402),
            item_id: "command-1".to_owned(),
            approval_request_id: Uuid::from_u128(0x1403),
            status: ApprovalProjectionStatus::Pending,
            revision: 1,
            requested_at: "2026-08-30T12:00:00Z".to_owned(),
            expires_at: "2026-08-30T12:02:00Z".to_owned(),
            outcome: None,
            decision_id: None,
            decision: None,
            resolved_at: None,
            source_event_id: Uuid::from_u128(0x1404),
            source_sequence: 1,
            source_occurred_at: "2026-08-30T12:00:00Z".to_owned(),
            durable_sequence: Some(1),
        };
        base.validate_durable().unwrap();
        for invalid in [
            ApprovalProjection {
                expires_at: "2026-08-30T12:01:59Z".to_owned(),
                ..base.clone()
            },
            ApprovalProjection {
                source_occurred_at: "not-a-time".to_owned(),
                ..base.clone()
            },
            ApprovalProjection {
                item_id: "command\nprivate".to_owned(),
                ..base.clone()
            },
            ApprovalProjection {
                source_sequence: 0,
                ..base.clone()
            },
            ApprovalProjection {
                durable_sequence: Some(0),
                ..base.clone()
            },
        ] {
            assert_eq!(
                invalid.validate_durable(),
                Err(ChatError::DatabaseUnavailable)
            );
        }
    }

    #[test]
    fn decision_response_is_closed_and_exactly_correlated() {
        let approval_request_id = Uuid::from_u128(0x1501);
        let decision_id = Uuid::from_u128(0x1502);
        let stream_id = Uuid::from_u128(0x1503);
        let valid = json!({
            "schema_version": 6,
            "approval_request_id": approval_request_id,
            "decision_id": decision_id,
            "stream_id": stream_id,
            "revision": 2,
            "decision": "accept_once",
            "outcome": "accepted_once",
            "resolved_at": "2026-08-30T12:00:30.123456789Z",
        });
        let decoded = decode_approval_decision_response_v6(
            &serde_json::to_vec(&valid).unwrap(),
            approval_request_id,
            decision_id,
            stream_id,
            HostApprovalDecision::AcceptOnce,
        )
        .unwrap();
        assert_eq!(decoded.outcome, HostApprovalOutcome::AcceptedOnce);
        decoded
            .validate_window("2026-08-30T12:00:00Z", "2026-08-30T12:02:00Z")
            .unwrap();

        for invalid in [
            {
                let mut value = valid.clone();
                value["raw_command"] = json!("PRIVATE_COMMAND_CANARY");
                value
            },
            {
                let mut value = valid.clone();
                value["decision_id"] = json!(Uuid::from_u128(0x1599));
                value
            },
            {
                let mut value = valid.clone();
                value["outcome"] = json!("cancelled_current_turn");
                value
            },
            {
                let mut value = valid.clone();
                value["resolved_at"] = json!("2026-02-31T12:00:30Z");
                value
            },
        ] {
            assert!(decode_approval_decision_response_v6(
                &serde_json::to_vec(&invalid).unwrap(),
                approval_request_id,
                decision_id,
                stream_id,
                HostApprovalDecision::AcceptOnce,
            )
            .is_err());
        }
    }

    #[test]
    fn decision_failure_maps_every_ambiguous_path_to_closed_reconciliation() {
        let transport = HostBridgeError::new(HostBridgeErrorKind::Transport);
        assert_eq!(
            ApprovalDecisionFailure::from_host(&transport).issue(),
            ApprovalIssue::ApprovalUnavailable
        );
        let protocol = HostBridgeError::new(HostBridgeErrorKind::Protocol);
        assert_eq!(
            ApprovalDecisionFailure::from_host(&protocol).issue(),
            ApprovalIssue::InternalError
        );
        let stale = HostBridgeError::rejected(HostErrorCode::ApprovalStale);
        assert_eq!(
            ApprovalDecisionFailure::from_host(&stale).issue(),
            ApprovalIssue::ApprovalStale
        );
        for issue in [
            ApprovalIssue::Unauthorized,
            ApprovalIssue::InvalidApprovalRequest,
            ApprovalIssue::ApprovalVersionMismatch,
            ApprovalIssue::SessionNotFound,
            ApprovalIssue::ApprovalNotFound,
            ApprovalIssue::ApprovalStale,
            ApprovalIssue::ApprovalExpired,
            ApprovalIssue::ApprovalAlreadyResolved,
            ApprovalIssue::ApprovalDecisionConflict,
            ApprovalIssue::ApprovalUnavailable,
            ApprovalIssue::InternalError,
        ] {
            assert_eq!(serde_json::to_value(issue).unwrap(), json!(issue.as_str()));
        }
    }
}
