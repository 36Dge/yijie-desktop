use super::artifact::{
    decode_artifact_event_envelope_v3, ArtifactProjection, ArtifactTransferService,
    ReadyFileContent, ReadyFileReadError, ReadyImageContent, ReadyImageReadError,
    ReadyReportContent, ReadyReportReadError, ReadyVideoContent, ReadyVideoRangeContent,
    ReadyVideoRangeRequest, ReadyVideoReadError,
};
use super::attachment::PreparedAttachment;
use super::authorization::{ChatAction, ChatAuthorizationManager};
use super::database::{
    ActiveTurnContext, AttachmentSummary, ClaimedDeletion, ClaimedOutbox, CleanupSurfaceState,
    DeletionStatus, DraftContentBlock, DraftTarget, Feat134HistorySnapshot, HistoryPage,
    MessageContentBlockProjection, OutboxKind, PendingConversation, ProjectSummary,
    PublicTaskBindingState, PublicTaskControlPlaneStatus, ReasoningItem, ReasoningPart,
    ReasoningStatus, RecoverySnapshot, SessionPage, SessionPageCursor, SessionSummary,
    StartTurnDispatchV2, OUTBOX_MAX_ATTEMPTS,
};
use super::error::ChatError;
use super::feat134::{Feat134HistoryProjection, Feat134Hydration, Feat134Projection};
use super::feat136::ExecutionProjection;
use super::feat137::{
    require_pending_decision_authority, ApprovalDecisionFailure, ApprovalDecisionIdentity,
    ApprovalDecisionResult, ApprovalProjection, HostPendingApprovalSnapshot, PendingApproval,
    PendingApprovalSnapshot,
};
use super::host_bridge::{HostBridge, HostTrace};
use super::host_domain::{
    HostApprovalDecision, HostBridgeError, HostBridgeErrorKind, HostCleanupOutcome,
    HostCleanupReason, HostCleanupSurfaceStatus, HostErrorCode, HostEventCursor, HostSessionState,
    HostStreamEvent,
};
use super::native_project;
use super::public_tasks::{
    PublicTaskControlPlane, PublicTaskCreateIntent, PublicTaskCreateOutcome, PublicTaskIssueCode,
};
use super::worker::DatabaseWorker;
use std::fmt::{Debug, Formatter};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::watch;
use uuid::Uuid;

const OUTBOX_LEASE_SECONDS: i64 = 30;
const RETRY_DELAY_SECONDS: i64 = 5;
const PROGRESS_FLUSH_EVENT_COUNT: usize = 16;
const PROGRESS_FLUSH_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Clone)]
pub struct ConversationApplication {
    database: DatabaseWorker,
    host: Option<Arc<HostBridge>>,
    public_tasks: Option<Arc<dyn PublicTaskControlPlane>>,
    artifact_transfers: Option<ArtifactTransferService>,
    feat137_streaming_enabled: bool,
}

#[derive(Clone)]
pub struct AuthorizedConversationApplication {
    application: ConversationApplication,
    authorization: ChatAuthorizationManager,
}

impl Debug for AuthorizedConversationApplication {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AuthorizedConversationApplication")
            .field("application", &self.application)
            .field("authorization", &self.authorization)
            .finish()
    }
}

impl AuthorizedConversationApplication {
    pub async fn native_history(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        turn_ids: Vec<Uuid>,
    ) -> Result<super::native_conversation_generated::NativeConversationHistory, ChatError> {
        self.authorize(context_id, ChatAction::ReadSessions)?;
        let result = self
            .application
            .native_history(session_id, turn_ids)
            .await?;
        self.authorize(context_id, ChatAction::ReadSessions)?;
        Ok(result)
    }
    pub fn new(
        application: ConversationApplication,
        authorization: ChatAuthorizationManager,
    ) -> Self {
        Self {
            application,
            authorization,
        }
    }

    fn authorize(&self, context_id: Uuid, action: ChatAction) -> Result<(), ChatError> {
        self.authorization
            .authorize(context_id, action, unix_seconds()?)
    }

    fn authorize_draft_target(
        &self,
        context_id: Uuid,
        draft_target: &DraftTarget,
    ) -> Result<(), ChatError> {
        self.authorize(
            context_id,
            match draft_target {
                DraftTarget::New => ChatAction::CreateSession,
                DraftTarget::Session(_) => ChatAction::SubmitTurn,
            },
        )
    }

    pub async fn create_local_session(
        &self,
        context_id: Uuid,
        project_id: Uuid,
        input: String,
        operation_id: Uuid,
    ) -> Result<PendingConversation, ChatError> {
        self.authorize(context_id, ChatAction::UseProject)?;
        self.authorize(context_id, ChatAction::CreateSession)?;
        let authorization_revision = self
            .authorization
            .authorization_revision(context_id, ChatAction::CreateSession, unix_seconds()?)
            .map_err(|_| ChatError::ScopeDenied)?;
        self.application
            .create_local_session(project_id, input, operation_id, authorization_revision)
            .await
    }

    pub async fn create_local_session_multimodal(
        &self,
        context_id: Uuid,
        project_id: Uuid,
        blocks: Vec<DraftContentBlock>,
        operation_id: Uuid,
    ) -> Result<PendingConversation, ChatError> {
        self.authorize(context_id, ChatAction::UseProject)?;
        self.authorize(context_id, ChatAction::CreateSession)?;
        let authorization_revision = self
            .authorization
            .authorization_revision(context_id, ChatAction::CreateSession, unix_seconds()?)
            .map_err(|_| ChatError::ScopeDenied)?;
        self.application
            .create_local_session_multimodal(
                project_id,
                blocks,
                operation_id,
                authorization_revision,
            )
            .await
    }

    pub async fn enqueue_turn(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        input: String,
        operation_id: Uuid,
    ) -> Result<Uuid, ChatError> {
        self.authorize(context_id, ChatAction::SubmitTurn)?;
        self.application
            .enqueue_turn(session_id, input, operation_id)
            .await
    }

    pub async fn enqueue_turn_multimodal(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        blocks: Vec<DraftContentBlock>,
        operation_id: Uuid,
    ) -> Result<Uuid, ChatError> {
        self.authorize(context_id, ChatAction::SubmitTurn)?;
        self.application
            .enqueue_turn_multimodal(session_id, blocks, operation_id)
            .await
    }

    pub async fn load_message_content_blocks(
        &self,
        context_id: Uuid,
        message_ids: Vec<Uuid>,
    ) -> Result<Vec<(Uuid, Vec<MessageContentBlockProjection>)>, ChatError> {
        self.authorize(context_id, ChatAction::ReadSessions)?;
        self.application
            .load_message_content_blocks(message_ids)
            .await
    }

    pub async fn load_artifacts_for_turns(
        &self,
        context_id: Uuid,
        turn_ids: Vec<Uuid>,
    ) -> Result<Vec<ArtifactProjection>, ChatError> {
        self.authorize(context_id, ChatAction::ReadSessions)?;
        self.application.load_artifacts_for_turns(turn_ids).await
    }

    pub async fn store_attachments(
        &self,
        context_id: Uuid,
        attachments: Vec<PreparedAttachment>,
        remaining_capacity: usize,
        draft_target: DraftTarget,
    ) -> Result<Vec<AttachmentSummary>, ChatError> {
        self.authorize_draft_target(context_id, &draft_target)?;
        self.application
            .store_attachments(attachments, remaining_capacity, draft_target)
            .await
    }

    pub async fn list_ready_attachments(
        &self,
        context_id: Uuid,
        draft_target: DraftTarget,
    ) -> Result<Vec<AttachmentSummary>, ChatError> {
        self.authorize_draft_target(context_id, &draft_target)?;
        self.application.list_ready_attachments(draft_target).await
    }

    pub async fn remove_ready_attachment(
        &self,
        context_id: Uuid,
        attachment_id: Uuid,
        draft_target: DraftTarget,
    ) -> Result<(), ChatError> {
        self.authorize_draft_target(context_id, &draft_target)?;
        self.application
            .remove_ready_attachment(attachment_id, draft_target)
            .await
    }

    pub async fn list_sessions(
        &self,
        context_id: Uuid,
        cursor: Option<SessionPageCursor>,
        limit: Option<usize>,
    ) -> Result<SessionPage, ChatError> {
        self.authorize(context_id, ChatAction::ReadSessions)?;
        self.application.list_sessions(cursor, limit).await
    }

    pub async fn resync_session(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        before_ordinal: Option<u64>,
        limit: Option<usize>,
    ) -> Result<ConversationResyncProjection, ChatError> {
        self.authorize(context_id, ChatAction::ReadSessions)?;
        self.application
            .resync_session(session_id, before_ordinal, limit)
            .await
    }

    pub async fn load_history(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        before_ordinal: Option<u64>,
        limit: Option<usize>,
    ) -> Result<HistoryPage, ChatError> {
        self.authorize(context_id, ChatAction::ReadSessions)?;
        self.application
            .load_history(session_id, before_ordinal, limit)
            .await
    }

    pub async fn load_feat134_history_projection(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        turn_ids: Vec<Uuid>,
    ) -> Result<Feat134HistoryProjection, ChatError> {
        self.authorize(context_id, ChatAction::ReadSessions)?;
        self.application
            .load_feat134_history_projection(session_id, turn_ids)
            .await
    }

    pub async fn load_feat136_history_projection(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        turn_ids: Vec<Uuid>,
    ) -> Result<Feat134HistoryProjection, ChatError> {
        self.authorize(context_id, ChatAction::ReadSessions)?;
        self.application
            .load_feat136_history_projection(session_id, turn_ids)
            .await
    }

    pub async fn load_feat134_history_snapshot(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        before_ordinal: Option<u64>,
        limit: Option<usize>,
    ) -> Result<Feat134HistorySnapshot, ChatError> {
        self.authorize(context_id, ChatAction::ReadSessions)?;
        self.application
            .load_feat134_history_snapshot(session_id, before_ordinal, limit)
            .await
    }

    pub async fn load_feat136_history_snapshot(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        before_ordinal: Option<u64>,
        limit: Option<usize>,
    ) -> Result<Feat134HistorySnapshot, ChatError> {
        self.authorize(context_id, ChatAction::ReadSessions)?;
        self.application
            .load_feat136_history_snapshot(session_id, before_ordinal, limit)
            .await
    }

    pub async fn load_feat137_history_snapshot(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        before_ordinal: Option<u64>,
        limit: Option<usize>,
    ) -> Result<Feat134HistorySnapshot, ChatError> {
        self.authorize(context_id, ChatAction::ReadSessions)?;
        self.application
            .load_feat137_history_snapshot(session_id, before_ordinal, limit)
            .await
    }

    pub async fn pending_approvals_v6(
        &self,
        context_id: Uuid,
        session_id: Uuid,
    ) -> Result<PendingApprovalSnapshot, ChatError> {
        self.authorize(context_id, ChatAction::ReadSessions)?;
        self.application.pending_approvals_v6(session_id).await
    }

    pub async fn pending_approvals_for_subscription_v6(
        &self,
        context_id: Uuid,
        session_id: Uuid,
    ) -> Result<PendingApprovalSnapshot, ChatError> {
        self.authorize(context_id, ChatAction::ReadSessions)?;
        self.application
            .pending_approvals_for_subscription_v6(session_id)
            .await
    }

    pub async fn decide_approval_v6(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        desktop_turn_id: Uuid,
        item_id: &str,
        approval_request_id: Uuid,
        decision: HostApprovalDecision,
    ) -> Result<ApprovalDecisionResult, ApprovalDecisionFailure> {
        self.authorize(context_id, ChatAction::SubmitTurn)
            .map_err(|_| ApprovalDecisionFailure::unavailable())?;
        self.application
            .decide_approval_v6(
                session_id,
                desktop_turn_id,
                item_id,
                approval_request_id,
                decision,
            )
            .await
    }

    pub async fn load_reasoning(
        &self,
        context_id: Uuid,
        turn_id: Uuid,
    ) -> Result<Vec<ReasoningItem>, ChatError> {
        self.authorize(context_id, ChatAction::ReadSessions)?;
        self.application.load_reasoning(turn_id).await
    }

    pub async fn rename_session(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        title: String,
    ) -> Result<(), ChatError> {
        self.authorize(context_id, ChatAction::RenameSession)?;
        self.application.rename_session(session_id, title).await
    }

    pub async fn set_session_pinned(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        pinned: bool,
    ) -> Result<(), ChatError> {
        self.authorize(context_id, ChatAction::PinSession)?;
        self.application
            .set_session_pinned(session_id, pinned)
            .await
    }

    pub async fn interrupt_turn(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        operation_id: Uuid,
    ) -> Result<Uuid, ChatError> {
        self.authorize(context_id, ChatAction::InterruptTurn)?;
        self.application
            .interrupt_turn(session_id, operation_id)
            .await
    }

    pub async fn begin_session_deletion(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        operation_id: Uuid,
    ) -> Result<DeletionStatus, ChatError> {
        self.authorize(context_id, ChatAction::DeleteSession)?;
        self.application
            .begin_session_deletion(session_id, operation_id)
            .await
    }

    pub async fn deletion_status(
        &self,
        context_id: Uuid,
        operation_id: Uuid,
    ) -> Result<Option<DeletionStatus>, ChatError> {
        self.authorize(context_id, ChatAction::ReadCleanup)?;
        self.application.deletion_status(operation_id).await
    }

    pub async fn deletion_status_for_session(
        &self,
        context_id: Uuid,
        session_id: Uuid,
    ) -> Result<Option<DeletionStatus>, ChatError> {
        self.authorize(context_id, ChatAction::ReadCleanup)?;
        self.application
            .deletion_status_for_session(session_id)
            .await
    }

    pub async fn public_task_control_plane_status(
        &self,
        context_id: Uuid,
        session_id: Uuid,
    ) -> Result<PublicTaskControlPlaneStatus, ChatError> {
        self.authorize(context_id, ChatAction::ReadSessions)?;
        self.application
            .public_task_control_plane_status(session_id)
            .await
    }

    pub async fn list_projects(&self, context_id: Uuid) -> Result<Vec<ProjectSummary>, ChatError> {
        self.authorize(context_id, ChatAction::ReadProjects)?;
        self.application.list_projects().await
    }

    pub async fn set_project_pinned(
        &self,
        context_id: Uuid,
        project_id: Uuid,
        pinned: bool,
    ) -> Result<(), ChatError> {
        self.authorize(context_id, ChatAction::PinProject)?;
        self.application
            .set_project_pinned(project_id, pinned)
            .await
    }

    pub async fn remove_project(
        &self,
        context_id: Uuid,
        project_id: Uuid,
    ) -> Result<(), ChatError> {
        self.authorize(context_id, ChatAction::RemoveProject)?;
        self.application.remove_project(project_id).await
    }
}

impl Debug for ConversationApplication {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ConversationApplication")
            .field("database", &"[SQLCIPHER_WORKER]")
            .field("host_configured", &self.host.is_some())
            .field("public_tasks_configured", &self.public_tasks.is_some())
            .field("artifacts_v3_enabled", &self.artifact_transfers.is_some())
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DispatchOutcome {
    Idle,
    SessionBound {
        session_id: Uuid,
    },
    TurnAccepted {
        session_id: Uuid,
    },
    TurnSubmissionFailed {
        operation_id: Uuid,
        session_id: Uuid,
        turn_id: Uuid,
    },
    TurnSubmissionUncertain {
        operation_id: Uuid,
        session_id: Uuid,
        turn_id: Uuid,
    },
    InterruptAccepted {
        session_id: Uuid,
    },
    RetryScheduled {
        operation_id: Uuid,
    },
    FailedSafely {
        operation_id: Uuid,
    },
    ControlPlaneChanged(PublicTaskControlPlaneStatus),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CoordinatorOutcome {
    Idle,
    Dispatched(DispatchOutcome),
    StreamRecovered { session_id: Uuid },
    CleanupRetryScheduled { operation_id: Uuid },
    CleanupComplete(DeletionStatus),
}

pub struct ConversationCoordinator {
    stop: watch::Sender<bool>,
    task: Option<tokio::task::JoinHandle<()>>,
}

impl Debug for ConversationCoordinator {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ConversationCoordinator")
            .field("running", &!self.is_finished())
            .finish()
    }
}

impl ConversationCoordinator {
    pub fn is_finished(&self) -> bool {
        self.task
            .as_ref()
            .is_none_or(tokio::task::JoinHandle::is_finished)
    }

    pub fn start(
        application: ConversationApplication,
        idle_poll_interval: Duration,
    ) -> Result<Self, ChatError> {
        Self::start_with_projection_sink(
            application,
            idle_poll_interval,
            Arc::new(NoopProjectionSink),
        )
    }

    pub fn start_with_projection_sink(
        application: ConversationApplication,
        idle_poll_interval: Duration,
        projection_sink: Arc<dyn TurnProjectionSink>,
    ) -> Result<Self, ChatError> {
        if !(Duration::from_millis(10)..=Duration::from_secs(60)).contains(&idle_poll_interval) {
            return Err(ChatError::InvalidInput);
        }
        let (stop, mut stop_receiver) = watch::channel(false);
        let task = tokio::spawn(async move {
            loop {
                let outcome = tokio::select! {
                    result = application.run_background_once_with_projection_sink(projection_sink.as_ref()) => Some(result),
                    changed = stop_receiver.changed() => {
                        if changed.is_err() || *stop_receiver.borrow() {
                            None
                        } else {
                            continue;
                        }
                    }
                };
                let Some(outcome) = outcome else {
                    break;
                };
                if let Ok(value) = &outcome {
                    let _ = projection_sink.publish_coordinator(value);
                }
                let should_wait = matches!(
                    &outcome,
                    Ok(CoordinatorOutcome::Idle | CoordinatorOutcome::CleanupRetryScheduled { .. })
                        | Err(_)
                );
                if should_wait {
                    tokio::select! {
                        _ = tokio::time::sleep(idle_poll_interval) => {}
                        changed = stop_receiver.changed() => {
                            if changed.is_err() || *stop_receiver.borrow() {
                                break;
                            }
                        }
                    }
                }
            }
        });
        Ok(Self {
            stop,
            task: Some(task),
        })
    }

    pub async fn stop(mut self) -> Result<(), ChatError> {
        let _ = self.stop.send(true);
        if let Some(task) = self.task.take() {
            task.await
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
        }
        Ok(())
    }
}

impl Drop for ConversationCoordinator {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct ConversationResyncProjection {
    pub session: SessionSummary,
    pub history: HistoryPage,
}

impl Debug for ConversationResyncProjection {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ConversationResyncProjection")
            .field("session", &self.session)
            .field("history_turn_count", &self.history.turns.len())
            .field(
                "has_more_history",
                &self.history.next_before_ordinal.is_some(),
            )
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct LiveReasoningProjection {
    pub item_id: String,
    pub status: Option<ReasoningStatus>,
    pub parts: Vec<ReasoningPart>,
}

impl Debug for LiveReasoningProjection {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LiveReasoningProjection")
            .field("item_id", &self.item_id)
            .field("status", &self.status)
            .field("part_count", &self.parts.len())
            .field(
                "utf8_bytes",
                &self.parts.iter().map(|part| part.text.len()).sum::<usize>(),
            )
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct LiveTurnProjection {
    pub session_id: Uuid,
    pub turn_id: Uuid,
    pub assistant_text: String,
    pub reasoning: Vec<LiveReasoningProjection>,
    pub terminal: bool,
    pub terminal_status: Option<String>,
}

impl Debug for LiveTurnProjection {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LiveTurnProjection")
            .field("session_id", &self.session_id)
            .field("turn_id", &self.turn_id)
            .field("assistant_utf8_bytes", &self.assistant_text.len())
            .field("reasoning_item_count", &self.reasoning.len())
            .field("terminal", &self.terminal)
            .field("terminal_status", &self.terminal_status)
            .finish()
    }
}

pub trait TurnProjectionSink: Send + Sync {
    fn publish_native(
        &self,
        _view: super::native_conversation_generated::NativeConversationView,
    ) -> Result<(), ChatError> {
        Ok(())
    }
    fn publish(&self, projection: LiveTurnProjection) -> Result<(), ChatError>;

    fn publish_feat137(
        &self,
        _projection: Feat134Projection,
        _approval: Option<ApprovalProjection>,
    ) -> Result<(), ChatError> {
        Ok(())
    }

    fn publish_coordinator(&self, _outcome: &CoordinatorOutcome) -> Result<(), ChatError> {
        Ok(())
    }

    fn publish_artifact_changed(
        &self,
        _session_id: Uuid,
        _turn_id: Uuid,
        _event_id: Uuid,
    ) -> Result<(), ChatError> {
        Ok(())
    }

    fn publish_artifact_resync_required(
        &self,
        _session_id: Uuid,
        _turn_id: Uuid,
        _reason: ArtifactResyncReason,
    ) -> Result<(), ChatError> {
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArtifactResyncReason {
    SequenceGap,
    ProtocolError,
}

struct NoopProjectionSink;

impl TurnProjectionSink for NoopProjectionSink {
    fn publish(&self, _projection: LiveTurnProjection) -> Result<(), ChatError> {
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PendingApprovalProjectionMode {
    Strict,
    SubscriptionHandshake,
}

fn project_pending_approval_snapshot(
    snapshot: HostPendingApprovalSnapshot,
    expected_agent_session_id: Uuid,
    local: Option<(&ActiveTurnContext, &Feat134Hydration)>,
    mode: PendingApprovalProjectionMode,
) -> Result<PendingApprovalSnapshot, ChatError> {
    let Some((context, hydration)) = local else {
        if snapshot
            .pending
            .iter()
            .any(|approval| approval.agent_session_id != expected_agent_session_id)
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        if snapshot.pending.is_empty()
            || mode == PendingApprovalProjectionMode::SubscriptionHandshake
        {
            return Ok(PendingApprovalSnapshot {
                stream_id: snapshot.stream_id,
                snapshot_at: snapshot.snapshot_at,
                pending: Vec::new(),
            });
        }
        return Err(ChatError::OrchestrationUnavailable);
    };
    if context.agent_session_id != expected_agent_session_id
        || context
            .cursor
            .as_ref()
            .is_some_and(|cursor| cursor.stream_id != snapshot.stream_id)
        || snapshot.pending.iter().any(|approval| {
            approval.task_id != context.task_id
                || approval.agent_session_id != context.agent_session_id
                || approval.codex_thread_id != context.codex_thread_id
                || approval.turn_id != context.runtime_turn_id
        })
    {
        return Err(ChatError::OrchestrationUnavailable);
    }

    let local_command_hydration_missing = snapshot.pending.iter().any(|approval| {
        !hydration.items.iter().any(|item| {
            item.item_id == approval.item_id
                && item.item_type == "command"
                && matches!(
                    item.execution.as_ref(),
                    Some(ExecutionProjection::Command(_))
                )
        })
    });
    if local_command_hydration_missing {
        if mode == PendingApprovalProjectionMode::SubscriptionHandshake {
            // The Host snapshot is not action authority until its Command has
            // been durably projected. Keep the already-established local SSE
            // subscription and return an empty, fail-closed snapshot; the
            // persist-before-emit live projection will reconcile it.
            return Ok(PendingApprovalSnapshot {
                stream_id: snapshot.stream_id,
                snapshot_at: snapshot.snapshot_at,
                pending: Vec::new(),
            });
        }
        return Err(ChatError::OrchestrationUnavailable);
    }

    Ok(PendingApprovalSnapshot {
        stream_id: snapshot.stream_id,
        snapshot_at: snapshot.snapshot_at,
        pending: snapshot
            .pending
            .into_iter()
            .map(|approval| PendingApproval {
                approval_request_id: approval.approval_request_id,
                turn_id: context.turn_id,
                item_id: approval.item_id,
                requested_at: approval.requested_at,
                expires_at: approval.expires_at,
            })
            .collect(),
    })
}

impl ConversationApplication {
    pub(crate) fn with_history_host(mut self, host: Option<Arc<HostBridge>>) -> Self {
        self.host = host;
        self
    }
    pub async fn native_history(
        &self,
        session_id: Uuid,
        turn_ids: Vec<Uuid>,
    ) -> Result<super::native_conversation_generated::NativeConversationHistory, ChatError> {
        if turn_ids.len() > 50 {
            return Err(ChatError::InvalidInput);
        }
        let binding = self.database.native_thread_binding(session_id).await?;
        let snapshot = match (&self.host, binding) {
            (Some(host), Some(id)) => host.read_native_thread(id).await.ok().map(Arc::new),
            _ => None,
        };
        let submissions = self
            .database
            .local_submissions(session_id, turn_ids.clone())
            .await?;
        let mut views = Vec::new();
        let mut bytes = 0_usize;
        let mut remaining_turn_ids = Vec::new();
        let mut record_diagnostics = Vec::new();
        for (index, id) in turn_ids.iter().enumerate() {
            let candidates = self
                .database
                .native_recovery_records(session_id, vec![*id], snapshot.clone(), false)
                .await?;
            let size = serde_json::to_vec(&candidates)
                .map_err(|_| ChatError::DatabaseUnavailable)?
                .len();
            if bytes.saturating_add(size) > 7 * 1024 * 1024 {
                remaining_turn_ids = turn_ids[index..].iter().map(Uuid::to_string).collect();
                break;
            }
            bytes += size;
            views.extend(candidates.views);
            record_diagnostics.extend(candidates.record_diagnostics);
        }
        Ok(
            super::native_conversation_generated::NativeConversationHistory {
                record_diagnostics: Some(record_diagnostics),
                submissions,
                views,
                remaining_turn_ids,
                history_availability: if snapshot.is_some() {
                    "partial"
                } else {
                    "unavailable"
                }
                .into(),
            },
        )
    }

    pub fn new(
        database: DatabaseWorker,
        host: Arc<HostBridge>,
        public_tasks: Arc<dyn PublicTaskControlPlane>,
    ) -> Self {
        Self {
            database,
            host: Some(host),
            public_tasks: Some(public_tasks),
            artifact_transfers: None,

            feat137_streaming_enabled: false,
        }
    }

    pub fn new_with_artifacts_v3(
        database: DatabaseWorker,
        host: Arc<HostBridge>,
        public_tasks: Arc<dyn PublicTaskControlPlane>,
    ) -> Self {
        Self {
            artifact_transfers: Some(ArtifactTransferService::new(host.clone(), database.clone())),

            feat137_streaming_enabled: false,
            database,
            host: Some(host),
            public_tasks: Some(public_tasks),
        }
    }

    pub fn new_with_artifacts_v4(
        database: DatabaseWorker,
        host: Arc<HostBridge>,
        public_tasks: Arc<dyn PublicTaskControlPlane>,
    ) -> Self {
        Self {
            artifact_transfers: Some(ArtifactTransferService::new(host.clone(), database.clone())),
            database,
            host: Some(host),
            public_tasks: Some(public_tasks),

            feat137_streaming_enabled: false,
        }
    }

    pub fn new_with_artifacts_v5(
        database: DatabaseWorker,
        host: Arc<HostBridge>,
        public_tasks: Arc<dyn PublicTaskControlPlane>,
    ) -> Self {
        Self {
            artifact_transfers: Some(ArtifactTransferService::new(host.clone(), database.clone())),
            database,
            host: Some(host),
            public_tasks: Some(public_tasks),

            feat137_streaming_enabled: false,
        }
    }

    pub fn new_with_artifacts_v6(
        database: DatabaseWorker,
        host: Arc<HostBridge>,
        public_tasks: Arc<dyn PublicTaskControlPlane>,
    ) -> Self {
        Self {
            artifact_transfers: Some(ArtifactTransferService::new(host.clone(), database.clone())),
            database,
            host: Some(host),
            public_tasks: Some(public_tasks),

            feat137_streaming_enabled: true,
        }
    }

    pub fn new_offline(database: DatabaseWorker) -> Self {
        Self {
            database,
            host: None,
            public_tasks: None,
            artifact_transfers: None,

            feat137_streaming_enabled: false,
        }
    }

    pub(crate) fn feat137_streaming_enabled(&self) -> bool {
        self.feat137_streaming_enabled
    }

    fn host(&self) -> Result<&HostBridge, ChatError> {
        self.host.as_deref().ok_or(ChatError::SidecarUnavailable)
    }

    pub async fn permission_state(
        &self,
        session_id: Option<Uuid>,
    ) -> Result<super::runtime_permissions::PermissionState, ChatError> {
        self.database.permission_state(session_id).await
    }

    pub async fn set_permission_mode(
        &self,
        session_id: Option<Uuid>,
        mode: super::runtime_permissions::PermissionMode,
        confirm_full: bool,
    ) -> Result<super::runtime_permissions::PermissionState, ChatError> {
        if let Some(id) = session_id {
            let state = self.database.permission_state(Some(id)).await?;
            if state.busy {
                return Err(ChatError::ConversationConflict);
            }
            let snapshot = self.runtime_approvals(id).await?;
            if snapshot.requests.iter().any(|r| r.status == "pending") {
                return Err(ChatError::ConversationConflict);
            }
        }
        // Validate confirmation before touching native availability. The database
        // remains the existing FEAT-152 authority for the selected UI mode.
        if mode == super::runtime_permissions::PermissionMode::Full
            && !confirm_full
            && !self
                .database
                .permission_state(session_id)
                .await?
                .full_access_confirmed
        {
            return Err(ChatError::ScopeDenied);
        }
        if std::env::var("YIJIE_FEAT144_SORFTIME_ENABLED").as_deref() == Ok("true") {
            self.host()?
                .prepare_mcp_permission_scope(mode)
                .await
                .map_err(map_host_error)?;
        }
        self.database
            .set_permission_mode(session_id, mode, confirm_full)
            .await
    }

    pub async fn runtime_approvals(
        &self,
        session_id: Uuid,
    ) -> Result<super::runtime_permissions::RuntimeApprovalSnapshot, ChatError> {
        let Some(id) = self
            .database
            .runtime_approval_session_id(session_id)
            .await?
        else {
            // A newly queued task has no Runtime yet and cannot have a
            // Runtime approval. Ownership was checked by the DB query.
            return Ok(super::runtime_permissions::RuntimeApprovalSnapshot::default());
        };
        self.host()?
            .runtime_approvals(id)
            .await
            .map_err(map_host_error)
    }

    pub async fn decide_runtime_approval(
        &self,
        session_id: Uuid,
        approval_id: Uuid,
        decision: &str,
    ) -> Result<super::runtime_permissions::RuntimeApproval, ChatError> {
        let id = self
            .database
            .agent_session_id_for_session(session_id)
            .await?;
        self.host()?
            .decide_runtime_approval(id, approval_id, decision)
            .await
            .map_err(map_host_error)
    }

    fn public_tasks(&self) -> Result<&dyn PublicTaskControlPlane, ChatError> {
        self.public_tasks
            .as_deref()
            .ok_or(ChatError::OrchestrationUnavailable)
    }

    pub async fn create_local_session(
        &self,
        project_id: Uuid,
        input: String,
        create_operation_id: Uuid,
        authorization_revision: u64,
    ) -> Result<PendingConversation, ChatError> {
        self.database
            .create_session_and_enqueue_with_authority(
                project_id,
                input,
                create_operation_id,
                authorization_revision,
            )
            .await
    }

    pub async fn create_local_session_multimodal(
        &self,
        project_id: Uuid,
        blocks: Vec<DraftContentBlock>,
        operation_id: Uuid,
        authorization_revision: u64,
    ) -> Result<PendingConversation, ChatError> {
        self.database
            .create_session_and_enqueue_multimodal(
                project_id,
                blocks,
                operation_id,
                authorization_revision,
            )
            .await
    }

    pub async fn enqueue_turn(
        &self,
        session_id: Uuid,
        input: String,
        operation_id: Uuid,
    ) -> Result<Uuid, ChatError> {
        self.database
            .enqueue_turn(session_id, input, operation_id)
            .await
    }

    pub async fn enqueue_turn_multimodal(
        &self,
        session_id: Uuid,
        blocks: Vec<DraftContentBlock>,
        operation_id: Uuid,
    ) -> Result<Uuid, ChatError> {
        self.database
            .enqueue_turn_multimodal(session_id, blocks, operation_id)
            .await
    }

    pub async fn load_message_content_blocks(
        &self,
        message_ids: Vec<Uuid>,
    ) -> Result<Vec<(Uuid, Vec<MessageContentBlockProjection>)>, ChatError> {
        self.database.load_message_content_blocks(message_ids).await
    }

    pub async fn load_artifacts_for_turns(
        &self,
        turn_ids: Vec<Uuid>,
    ) -> Result<Vec<ArtifactProjection>, ChatError> {
        self.database.load_artifacts_for_turns(turn_ids).await
    }

    pub(crate) async fn read_ready_image(
        &self,
        session_id: Uuid,
        turn_id: Uuid,
        artifact_id: Uuid,
        now: i64,
    ) -> Result<Result<ReadyImageContent, ReadyImageReadError>, ChatError> {
        self.database
            .read_ready_image(session_id, turn_id, artifact_id, now)
            .await
    }

    pub(crate) async fn read_ready_video(
        &self,
        session_id: Uuid,
        turn_id: Uuid,
        artifact_id: Uuid,
        now: i64,
    ) -> Result<Result<ReadyVideoContent, ReadyVideoReadError>, ChatError> {
        self.database
            .read_ready_video(session_id, turn_id, artifact_id, now)
            .await
    }

    pub(crate) async fn read_ready_file(
        &self,
        session_id: Uuid,
        turn_id: Uuid,
        artifact_id: Uuid,
        now: i64,
        max_bytes: usize,
    ) -> Result<Result<ReadyFileContent, ReadyFileReadError>, ChatError> {
        self.database
            .read_ready_file(session_id, turn_id, artifact_id, now, max_bytes)
            .await
    }

    pub(crate) async fn read_ready_report(
        &self,
        session_id: Uuid,
        turn_id: Uuid,
        artifact_id: Uuid,
        now: i64,
        max_bytes: usize,
    ) -> Result<Result<ReadyReportContent, ReadyReportReadError>, ChatError> {
        self.database
            .read_ready_report(session_id, turn_id, artifact_id, now, max_bytes)
            .await
    }

    pub(crate) async fn read_ready_video_range(
        &self,
        request: ReadyVideoRangeRequest,
    ) -> Result<Result<ReadyVideoRangeContent, ReadyVideoReadError>, ChatError> {
        self.database.read_ready_video_range(request).await
    }

    pub async fn store_attachments(
        &self,
        attachments: Vec<PreparedAttachment>,
        remaining_capacity: usize,
        draft_target: DraftTarget,
    ) -> Result<Vec<AttachmentSummary>, ChatError> {
        self.database
            .store_attachments(attachments, remaining_capacity, draft_target)
            .await
    }

    pub async fn list_ready_attachments(
        &self,
        draft_target: DraftTarget,
    ) -> Result<Vec<AttachmentSummary>, ChatError> {
        self.database.list_ready_attachments(draft_target).await
    }

    pub async fn remove_ready_attachment(
        &self,
        attachment_id: Uuid,
        draft_target: DraftTarget,
    ) -> Result<(), ChatError> {
        self.database
            .remove_ready_attachment(attachment_id, draft_target)
            .await
    }

    pub async fn list_sessions(
        &self,
        cursor: Option<SessionPageCursor>,
        limit: Option<usize>,
    ) -> Result<SessionPage, ChatError> {
        self.database.list_sessions(cursor, limit).await
    }

    pub async fn load_history(
        &self,
        session_id: Uuid,
        before_ordinal: Option<u64>,
        limit: Option<usize>,
    ) -> Result<HistoryPage, ChatError> {
        self.database
            .load_history(session_id, before_ordinal, limit)
            .await
    }

    pub async fn load_feat134_history_projection(
        &self,
        session_id: Uuid,
        turn_ids: Vec<Uuid>,
    ) -> Result<Feat134HistoryProjection, ChatError> {
        self.database
            .load_feat134_history_projection(session_id, turn_ids)
            .await
    }

    pub async fn load_feat136_history_projection(
        &self,
        session_id: Uuid,
        turn_ids: Vec<Uuid>,
    ) -> Result<Feat134HistoryProjection, ChatError> {
        self.database
            .load_feat136_history_projection(session_id, turn_ids)
            .await
    }

    pub async fn load_feat134_history_snapshot(
        &self,
        session_id: Uuid,
        before_ordinal: Option<u64>,
        limit: Option<usize>,
    ) -> Result<Feat134HistorySnapshot, ChatError> {
        self.database
            .load_feat134_history_snapshot(session_id, before_ordinal, limit)
            .await
    }

    pub async fn load_feat136_history_snapshot(
        &self,
        session_id: Uuid,
        before_ordinal: Option<u64>,
        limit: Option<usize>,
    ) -> Result<Feat134HistorySnapshot, ChatError> {
        self.database
            .load_feat136_history_snapshot(session_id, before_ordinal, limit)
            .await
    }

    pub async fn load_feat137_history_snapshot(
        &self,
        session_id: Uuid,
        before_ordinal: Option<u64>,
        limit: Option<usize>,
    ) -> Result<Feat134HistorySnapshot, ChatError> {
        self.database
            .load_feat137_history_snapshot(session_id, before_ordinal, limit)
            .await
    }

    pub async fn pending_approvals_v6(
        &self,
        session_id: Uuid,
    ) -> Result<PendingApprovalSnapshot, ChatError> {
        self.pending_approvals_v6_with_mode(session_id, PendingApprovalProjectionMode::Strict)
            .await
    }

    pub async fn pending_approvals_for_subscription_v6(
        &self,
        session_id: Uuid,
    ) -> Result<PendingApprovalSnapshot, ChatError> {
        self.pending_approvals_v6_with_mode(
            session_id,
            PendingApprovalProjectionMode::SubscriptionHandshake,
        )
        .await
    }

    async fn pending_approvals_v6_with_mode(
        &self,
        session_id: Uuid,
        mode: PendingApprovalProjectionMode,
    ) -> Result<PendingApprovalSnapshot, ChatError> {
        let agent_session_id = self
            .database
            .agent_session_id_for_session(session_id)
            .await?;
        let snapshot = self
            .host()?
            .pending_approvals_v6(agent_session_id)
            .await
            .map_err(map_host_error)?;
        match self.database.active_turn_context(session_id).await {
            Ok(context) => {
                let hydration = self
                    .database
                    .load_feat137_hydration(context.turn_id)
                    .await?;
                project_pending_approval_snapshot(
                    snapshot,
                    agent_session_id,
                    Some((&context, &hydration)),
                    mode,
                )
            }
            Err(ChatError::NotFound) => {
                project_pending_approval_snapshot(snapshot, agent_session_id, None, mode)
            }
            Err(error) => Err(error),
        }
    }

    pub async fn decide_approval_v6(
        &self,
        session_id: Uuid,
        desktop_turn_id: Uuid,
        item_id: &str,
        approval_request_id: Uuid,
        decision: HostApprovalDecision,
    ) -> Result<ApprovalDecisionResult, ApprovalDecisionFailure> {
        if !self.feat137_streaming_enabled
            || session_id.is_nil()
            || desktop_turn_id.is_nil()
            || approval_request_id.is_nil()
            || item_id.is_empty()
            || item_id.chars().count() > 256
            || item_id.len() > 1024
            || item_id.contains(['\r', '\n', '\0'])
        {
            return Err(ApprovalDecisionFailure::stale());
        }
        let context = self
            .database
            .active_turn_context(session_id)
            .await
            .map_err(|error| match error {
                ChatError::NotFound => ApprovalDecisionFailure::not_found(),
                _ => ApprovalDecisionFailure::reconciliation_required(),
            })?;
        if context.session_id != session_id || context.turn_id != desktop_turn_id {
            return Err(ApprovalDecisionFailure::stale());
        }
        let hydration = self
            .database
            .load_feat137_hydration(desktop_turn_id)
            .await
            .map_err(|_| ApprovalDecisionFailure::reconciliation_required())?;
        if !hydration.items.iter().any(|item| {
            item.item_id == item_id
                && item.item_type == "command"
                && matches!(
                    item.execution.as_ref(),
                    Some(ExecutionProjection::Command(_))
                )
        }) {
            return Err(ApprovalDecisionFailure::stale());
        }
        let host = self
            .host()
            .map_err(|_| ApprovalDecisionFailure::unavailable())?;
        let snapshot = host
            .pending_approvals_v6(context.agent_session_id)
            .await
            .map_err(|error| ApprovalDecisionFailure::from_host(&error))?;
        let pending = require_pending_decision_authority(
            &snapshot,
            &ApprovalDecisionIdentity {
                desktop_session_id: session_id,
                desktop_turn_id,
                item_id,
                approval_request_id,
                task_id: context.task_id,
                agent_session_id: context.agent_session_id,
                codex_thread_id: context.codex_thread_id,
                runtime_turn_id: context.runtime_turn_id,
                persisted_stream_id: context.cursor.as_ref().map(|cursor| cursor.stream_id),
            },
        )?;
        let decision_id = Uuid::now_v7();
        let result = host
            .decide_approval_v6(
                context.agent_session_id,
                approval_request_id,
                decision_id,
                snapshot.stream_id,
                decision,
            )
            .await
            .map_err(|error| ApprovalDecisionFailure::from_host(&error))?;
        result.validate_window(&pending.requested_at, &pending.expires_at)?;
        Ok(result)
    }

    pub async fn load_reasoning(&self, turn_id: Uuid) -> Result<Vec<ReasoningItem>, ChatError> {
        self.database.load_reasoning(turn_id).await
    }

    pub async fn rename_session(&self, session_id: Uuid, title: String) -> Result<(), ChatError> {
        self.database.rename_session(session_id, title).await
    }

    pub async fn set_session_pinned(
        &self,
        session_id: Uuid,
        pinned: bool,
    ) -> Result<(), ChatError> {
        self.database
            .set_session_pinned(session_id, pinned, unix_seconds()?)
            .await
    }

    pub async fn set_project_pinned(
        &self,
        project_id: Uuid,
        pinned: bool,
    ) -> Result<(), ChatError> {
        self.database
            .set_project_pinned(project_id, pinned, unix_seconds()?)
            .await
    }

    pub async fn remove_project(&self, project_id: Uuid) -> Result<(), ChatError> {
        self.database.remove_project(project_id.to_string()).await
    }

    pub async fn list_projects(&self) -> Result<Vec<ProjectSummary>, ChatError> {
        self.database.list_projects().await
    }

    pub async fn interrupt_turn(
        &self,
        session_id: Uuid,
        operation_id: Uuid,
    ) -> Result<Uuid, ChatError> {
        self.database
            .enqueue_interrupt(session_id, operation_id)
            .await
    }

    pub async fn begin_session_deletion(
        &self,
        session_id: Uuid,
        operation_id: Uuid,
    ) -> Result<DeletionStatus, ChatError> {
        self.database
            .begin_session_deletion(session_id, operation_id, unix_seconds()?)
            .await
    }

    pub async fn deletion_status(
        &self,
        operation_id: Uuid,
    ) -> Result<Option<DeletionStatus>, ChatError> {
        self.database.deletion_status(operation_id).await
    }

    pub async fn deletion_status_for_session(
        &self,
        session_id: Uuid,
    ) -> Result<Option<DeletionStatus>, ChatError> {
        self.database.deletion_status_for_session(session_id).await
    }

    pub async fn recovery_snapshot(&self) -> Result<RecoverySnapshot, ChatError> {
        self.database.recovery_snapshot().await
    }

    pub async fn public_task_control_plane_status(
        &self,
        session_id: Uuid,
    ) -> Result<PublicTaskControlPlaneStatus, ChatError> {
        self.database
            .public_task_control_plane_status(session_id)
            .await
    }

    pub async fn resume_blocked_public_tasks(
        &self,
        authorization_revision: u64,
    ) -> Result<usize, ChatError> {
        self.database
            .resume_blocked_public_tasks(authorization_revision, unix_seconds()?)
            .await
    }

    pub async fn resync_session(
        &self,
        session_id: Uuid,
        before_ordinal: Option<u64>,
        limit: Option<usize>,
    ) -> Result<ConversationResyncProjection, ChatError> {
        let session = self.database.session_summary(session_id).await?;
        let history = self
            .database
            .load_history(session_id, before_ordinal, limit)
            .await?;
        Ok(ConversationResyncProjection { session, history })
    }

    pub async fn apply_model_title(
        &self,
        session_id: Uuid,
        operation_id: Uuid,
        title: String,
    ) -> Result<bool, ChatError> {
        self.database
            .apply_model_title(session_id, operation_id, title)
            .await
    }

    pub async fn dispatch_next(&self) -> Result<DispatchOutcome, ChatError> {
        let now = unix_seconds()?;
        if self.feat137_streaming_enabled {
            if let Some(status) = self
                .database
                .fail_next_exhausted_public_task_binding(now)
                .await?
            {
                return Ok(DispatchOutcome::ControlPlaneChanged(status));
            }
        }
        let Some(claimed) = self
            .database
            .claim_next_conversation_outbox(now, OUTBOX_LEASE_SECONDS)
            .await?
        else {
            return Ok(DispatchOutcome::Idle);
        };
        match claimed.kind {
            OutboxKind::CreateSession => self.dispatch_create(claimed, now).await,
            OutboxKind::StartTurn => self.dispatch_turn(claimed, now).await,
            OutboxKind::InterruptTurn => self.dispatch_interrupt(claimed, now).await,
            _ => {
                self.database.fail_outbox(claimed.operation_id).await?;
                Ok(DispatchOutcome::FailedSafely {
                    operation_id: claimed.operation_id,
                })
            }
        }
    }

    async fn dispatch_create(
        &self,
        claimed: ClaimedOutbox,
        now: i64,
    ) -> Result<DispatchOutcome, ChatError> {
        let dispatch = self
            .database
            .load_create_session_dispatch(claimed.operation_id)
            .await?;
        let public_task_id = match dispatch.public_task_id {
            Some(public_task_id) => public_task_id,
            None => {
                let intent = PublicTaskCreateIntent {
                    operation_id: dispatch.operation_id,
                    client_reference_id: dispatch.client_reference_id,
                    authorization_revision: dispatch.authorization_revision,
                };
                match self.public_tasks()?.create_task(intent).await {
                    PublicTaskCreateOutcome::Bound { public_task_id } => {
                        let status = self
                            .database
                            .bind_public_task(dispatch.operation_id, public_task_id, now)
                            .await?;
                        debug_assert_eq!(status.state, PublicTaskBindingState::Bound);
                        self.database
                            .reschedule_outbox(dispatch.operation_id, now)
                            .await?;
                        return Ok(DispatchOutcome::ControlPlaneChanged(status));
                    }
                    PublicTaskCreateOutcome::BlockedAuth => {
                        return self
                            .transition_public_create(
                                dispatch.operation_id,
                                PublicTaskBindingState::BlockedAuth,
                                PublicTaskIssueCode::Unauthenticated,
                                None,
                                now,
                            )
                            .await;
                    }
                    PublicTaskCreateOutcome::Denied => {
                        return self
                            .transition_public_create(
                                dispatch.operation_id,
                                PublicTaskBindingState::Denied,
                                PublicTaskIssueCode::CapabilityDenied,
                                None,
                                now,
                            )
                            .await;
                    }
                    PublicTaskCreateOutcome::RetryWait => {
                        let next = now
                            .checked_add(RETRY_DELAY_SECONDS)
                            .ok_or(ChatError::InvalidInput)?;
                        return self
                            .transition_public_create(
                                dispatch.operation_id,
                                PublicTaskBindingState::RetryWait,
                                PublicTaskIssueCode::TemporarilyUnavailable,
                                Some(next),
                                now,
                            )
                            .await;
                    }
                    PublicTaskCreateOutcome::Conflict => {
                        return self
                            .transition_public_create(
                                dispatch.operation_id,
                                PublicTaskBindingState::Failed,
                                PublicTaskIssueCode::Conflict,
                                None,
                                now,
                            )
                            .await;
                    }
                    PublicTaskCreateOutcome::ProtocolError => {
                        return self
                            .transition_public_create(
                                dispatch.operation_id,
                                PublicTaskBindingState::Failed,
                                PublicTaskIssueCode::ProtocolError,
                                None,
                                now,
                            )
                            .await;
                    }
                }
            }
        };
        let bookmark = self
            .database
            .project_bookmark(dispatch.project_id.to_string())
            .await?;
        let selection =
            tokio::task::spawn_blocking(move || native_project::resolve_bookmark(&bookmark))
                .await
                .map_err(|_| ChatError::ProjectUnavailable)??;
        let trace = HostTrace {
            request_id: Some(dispatch.operation_id),
            ..HostTrace::default()
        };
        match self
            .host()?
            .start_session(public_task_id, &selection.canonical_path, &trace)
            .await
        {
            Ok(session)
                if session.task_id == public_task_id
                    && session.state == HostSessionState::Idle
                    && session.model_ready
                    && session.codex_thread_id.is_some() =>
            {
                self.database
                    .bind_host_session_and_enqueue_turn(
                        dispatch.operation_id,
                        public_task_id,
                        session.agent_session_id,
                        session.codex_thread_id.expect("checked above"),
                    )
                    .await?;
                if !self.feat137_streaming_enabled {
                    return Ok(DispatchOutcome::SessionBound {
                        session_id: dispatch.session_id,
                    });
                }
                let status = self
                    .database
                    .public_task_control_plane_status(dispatch.session_id)
                    .await?;
                debug_assert!(status.host_session_bound);
                Ok(DispatchOutcome::ControlPlaneChanged(status))
            }
            Ok(_) => {
                if !self.feat137_streaming_enabled {
                    self.database.fail_outbox(claimed.operation_id).await?;
                    return Ok(DispatchOutcome::FailedSafely {
                        operation_id: claimed.operation_id,
                    });
                }
                self.fail_host_session_binding(
                    claimed.operation_id,
                    PublicTaskIssueCode::ProtocolError,
                    now,
                )
                .await
            }
            Err(error) if error.kind() == HostBridgeErrorKind::NotReady => {
                if self.feat137_streaming_enabled
                    && i64::from(claimed.attempt_count) >= OUTBOX_MAX_ATTEMPTS
                {
                    self.fail_host_session_binding(
                        claimed.operation_id,
                        PublicTaskIssueCode::TemporarilyUnavailable,
                        now,
                    )
                    .await
                } else {
                    self.handle_dispatch_error(claimed.operation_id, now, error)
                        .await
                }
            }
            Err(error) => {
                if !self.feat137_streaming_enabled {
                    return self
                        .handle_dispatch_error(claimed.operation_id, now, error)
                        .await;
                }
                let issue = if error.kind() == HostBridgeErrorKind::Transport {
                    PublicTaskIssueCode::TemporarilyUnavailable
                } else {
                    PublicTaskIssueCode::ProtocolError
                };
                self.fail_host_session_binding(claimed.operation_id, issue, now)
                    .await
            }
        }
    }

    async fn fail_host_session_binding(
        &self,
        operation_id: Uuid,
        issue_code: PublicTaskIssueCode,
        now: i64,
    ) -> Result<DispatchOutcome, ChatError> {
        let status = self
            .database
            .fail_bound_public_task_binding(operation_id, issue_code.as_str().to_owned(), now)
            .await?;
        Ok(DispatchOutcome::ControlPlaneChanged(status))
    }

    async fn transition_public_create(
        &self,
        operation_id: Uuid,
        state: PublicTaskBindingState,
        issue_code: PublicTaskIssueCode,
        next_attempt_at: Option<i64>,
        now: i64,
    ) -> Result<DispatchOutcome, ChatError> {
        let status = self
            .database
            .transition_public_task_binding(
                operation_id,
                state,
                issue_code.as_str().to_owned(),
                next_attempt_at,
                now,
            )
            .await?;
        Ok(DispatchOutcome::ControlPlaneChanged(status))
    }

    async fn dispatch_turn(
        &self,
        claimed: ClaimedOutbox,
        now: i64,
    ) -> Result<DispatchOutcome, ChatError> {
        match self
            .database
            .start_turn_payload_version(claimed.operation_id)
            .await?
        {
            1 => {
                let dispatch = self
                    .database
                    .load_start_turn_dispatch(claimed.operation_id)
                    .await?;
                let trace = HostTrace {
                    request_id: Some(dispatch.operation_id),
                    ..HostTrace::default()
                };
                let result = if super::runtime_permissions::enabled() {
                    let mode = self
                        .database
                        .permission_state(Some(dispatch.session_id))
                        .await?
                        .mode;
                    self.host()?
                        .start_permission_turn(
                            dispatch.agent_session_id,
                            dispatch.operation_id,
                            &[super::database::HostTurnInputBlock::Text {
                                text: dispatch.input.clone(),
                            }],
                            &trace,
                            mode,
                        )
                        .await
                } else {
                    self.host()?
                        .start_turn(dispatch.agent_session_id, &dispatch.input, &trace)
                        .await
                };
                self.finish_turn_dispatch(
                    now,
                    1,
                    dispatch.operation_id,
                    dispatch.session_id,
                    result,
                )
                .await
            }
            2 => {
                let dispatch = match self
                    .database
                    .load_start_turn_dispatch_v2(claimed.operation_id)
                    .await
                {
                    Ok(dispatch) => dispatch,
                    Err(ChatError::NotFound) => {
                        return self
                            .record_failed_turn_submission(claimed.operation_id, now)
                            .await;
                    }
                    Err(error) => return Err(error),
                };
                let trace = HostTrace {
                    request_id: Some(dispatch.operation_id),
                    ..HostTrace::default()
                };
                let result = if super::runtime_permissions::enabled() {
                    let mode = self
                        .database
                        .permission_state(Some(dispatch.session_id))
                        .await?
                        .mode;
                    self.host()?
                        .start_permission_turn(
                            dispatch.agent_session_id,
                            dispatch.operation_id,
                            &dispatch.content_blocks,
                            &trace,
                            mode,
                        )
                        .await
                } else {
                    self.host()?
                        .start_turn_v2(
                            dispatch.agent_session_id,
                            dispatch.operation_id,
                            &dispatch.content_blocks,
                            &trace,
                        )
                        .await
                };
                if result.as_ref().is_err_and(|error| {
                    matches!(
                        error.kind(),
                        HostBridgeErrorKind::Transport
                            | HostBridgeErrorKind::AcceptedResponseInvalid
                    ) || matches!(
                        error.code(),
                        Some(HostErrorCode::SessionNotUsable | HostErrorCode::RuntimeRequestFailed)
                    )
                }) {
                    return self.record_uncertain_turn_submission(&dispatch).await;
                }
                self.finish_turn_dispatch(
                    now,
                    2,
                    dispatch.operation_id,
                    dispatch.session_id,
                    result,
                )
                .await
            }
            _ => {
                self.database.fail_outbox(claimed.operation_id).await?;
                Ok(DispatchOutcome::FailedSafely {
                    operation_id: claimed.operation_id,
                })
            }
        }
    }

    async fn finish_turn_dispatch(
        &self,
        now: i64,
        payload_version: i64,
        operation_id: Uuid,
        session_id: Uuid,
        result: Result<Uuid, HostBridgeError>,
    ) -> Result<DispatchOutcome, ChatError> {
        let runtime_turn_id = match result {
            Ok(turn_id) => turn_id,
            Err(_) if payload_version == 2 => {
                return self.record_failed_turn_submission(operation_id, now).await;
            }
            Err(error) => {
                return self.handle_dispatch_error(operation_id, now, error).await;
            }
        };
        self.database
            .accept_native_turn(
                operation_id,
                runtime_turn_id,
                self.host()?.instance_nonce().to_owned(),
            )
            .await?;
        Ok(DispatchOutcome::TurnAccepted { session_id })
    }

    async fn record_uncertain_turn_submission(
        &self,
        dispatch: &StartTurnDispatchV2,
    ) -> Result<DispatchOutcome, ChatError> {
        self.database
            .suspend_uncertain_start_turn(dispatch.operation_id)
            .await?;
        Ok(DispatchOutcome::TurnSubmissionUncertain {
            operation_id: dispatch.operation_id,
            session_id: dispatch.session_id,
            turn_id: dispatch.turn_id,
        })
    }

    async fn record_failed_turn_submission(
        &self,
        operation_id: Uuid,
        terminal_at: i64,
    ) -> Result<DispatchOutcome, ChatError> {
        let projection = self
            .database
            .record_failed_start_turn_submission(operation_id, terminal_at)
            .await?;
        Ok(DispatchOutcome::TurnSubmissionFailed {
            operation_id: projection.operation_id,
            session_id: projection.session_id,
            turn_id: projection.turn_id,
        })
    }

    async fn dispatch_interrupt(
        &self,
        claimed: ClaimedOutbox,
        now: i64,
    ) -> Result<DispatchOutcome, ChatError> {
        let dispatch = self
            .database
            .load_interrupt_dispatch(claimed.operation_id)
            .await?;
        let trace = HostTrace {
            request_id: Some(dispatch.operation_id),
            ..HostTrace::default()
        };
        match self
            .host()?
            .interrupt_turn(dispatch.agent_session_id, dispatch.runtime_turn_id, &trace)
            .await
        {
            Ok(()) => {
                self.database
                    .complete_interrupt(dispatch.operation_id)
                    .await?;
                Ok(DispatchOutcome::InterruptAccepted {
                    session_id: dispatch.session_id,
                })
            }
            Err(error) if error.code() == Some(HostErrorCode::TurnNotActive) => {
                match self.host()?.get_session(dispatch.agent_session_id).await {
                    Ok(session) if session.active_turn_id.is_none() => {
                        self.database
                            .complete_interrupt(dispatch.operation_id)
                            .await?;
                        Ok(DispatchOutcome::InterruptAccepted {
                            session_id: dispatch.session_id,
                        })
                    }
                    _ => {
                        self.database.fail_outbox(dispatch.operation_id).await?;
                        Ok(DispatchOutcome::FailedSafely {
                            operation_id: dispatch.operation_id,
                        })
                    }
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    HostBridgeErrorKind::NotReady | HostBridgeErrorKind::Transport
                ) =>
            {
                self.database
                    .reschedule_outbox(
                        dispatch.operation_id,
                        now.checked_add(RETRY_DELAY_SECONDS)
                            .ok_or(ChatError::InvalidInput)?,
                    )
                    .await?;
                Ok(DispatchOutcome::RetryScheduled {
                    operation_id: dispatch.operation_id,
                })
            }
            Err(_) => {
                self.database.fail_outbox(dispatch.operation_id).await?;
                Ok(DispatchOutcome::FailedSafely {
                    operation_id: dispatch.operation_id,
                })
            }
        }
    }

    pub async fn run_background_once(&self) -> Result<CoordinatorOutcome, ChatError> {
        self.run_background_once_with_projection_sink(&NoopProjectionSink)
            .await
    }

    pub async fn run_background_once_with_projection_sink(
        &self,
        sink: &dyn TurnProjectionSink,
    ) -> Result<CoordinatorOutcome, ChatError> {
        if let Some(artifact_transfers) = &self.artifact_transfers {
            artifact_transfers
                .recover_pending_acknowledgements()
                .await?;
        }
        let dispatch = self.dispatch_next().await?;
        if dispatch != DispatchOutcome::Idle {
            return Ok(CoordinatorOutcome::Dispatched(dispatch));
        }
        let recovery = self.database.recovery_snapshot().await?;
        if let Some(session_id) = recovery.active_session_ids.first().copied() {
            self.stream_active_turn_with_projection_sink(session_id, sink)
                .await?;
            return Ok(CoordinatorOutcome::StreamRecovered { session_id });
        }
        let now = unix_seconds()?;
        let Some(claimed) = self
            .database
            .claim_next_deletion(now, OUTBOX_LEASE_SECONDS)
            .await?
        else {
            self.database.purge_expired_deletion_receipts(now).await?;
            return Ok(CoordinatorOutcome::Idle);
        };
        self.drive_cleanup(claimed, now).await
    }

    async fn drive_cleanup(
        &self,
        claimed: ClaimedDeletion,
        now: i64,
    ) -> Result<CoordinatorOutcome, ChatError> {
        if claimed.host_state != CleanupSurfaceState::Complete
            || claimed.runtime_state != CleanupSurfaceState::Complete
        {
            let Some(agent_session_id) = claimed.agent_session_id else {
                self.database
                    .record_cleanup_surfaces(
                        claimed.operation_id,
                        CleanupSurfaceState::Complete,
                        CleanupSurfaceState::Complete,
                        "no_host_mapping".to_owned(),
                        now,
                    )
                    .await?;
                return self.finish_cleanup(claimed.operation_id, now).await;
            };
            let trace = HostTrace {
                request_id: Some(claimed.operation_id),
                ..HostTrace::default()
            };
            match self
                .host()?
                .cleanup_session(agent_session_id, claimed.operation_id, &trace)
                .await
            {
                Ok(HostCleanupOutcome::Complete { operation_id })
                    if operation_id == claimed.operation_id =>
                {
                    self.database
                        .record_cleanup_surfaces(
                            claimed.operation_id,
                            CleanupSurfaceState::Complete,
                            CleanupSurfaceState::Complete,
                            "cleanup_complete".to_owned(),
                            now,
                        )
                        .await?;
                }
                Ok(HostCleanupOutcome::Incomplete {
                    operation_id,
                    surfaces,
                    reason,
                }) if operation_id == claimed.operation_id => {
                    let next = now
                        .checked_add(RETRY_DELAY_SECONDS)
                        .ok_or(ChatError::InvalidInput)?;
                    self.database
                        .record_cleanup_surfaces(
                            operation_id,
                            aggregate_host_surfaces(surfaces.host_mapping, surfaces.host_replay),
                            map_cleanup_surface(surfaces.runtime_thread_tree),
                            cleanup_reason_code(reason).to_owned(),
                            next,
                        )
                        .await?;
                    return Ok(CoordinatorOutcome::CleanupRetryScheduled { operation_id });
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        HostBridgeErrorKind::NotReady | HostBridgeErrorKind::Transport
                    ) =>
                {
                    let next = now
                        .checked_add(RETRY_DELAY_SECONDS)
                        .ok_or(ChatError::InvalidInput)?;
                    self.database
                        .reschedule_deletion(claimed.operation_id, next)
                        .await?;
                    return Ok(CoordinatorOutcome::CleanupRetryScheduled {
                        operation_id: claimed.operation_id,
                    });
                }
                _ => {
                    let next = now
                        .checked_add(RETRY_DELAY_SECONDS)
                        .ok_or(ChatError::InvalidInput)?;
                    self.database
                        .record_cleanup_surfaces(
                            claimed.operation_id,
                            CleanupSurfaceState::Incomplete,
                            CleanupSurfaceState::Incomplete,
                            "cleanup_protocol_failure".to_owned(),
                            next,
                        )
                        .await?;
                    return Ok(CoordinatorOutcome::CleanupRetryScheduled {
                        operation_id: claimed.operation_id,
                    });
                }
            }
        }
        self.finish_cleanup(claimed.operation_id, now).await
    }

    async fn finish_cleanup(
        &self,
        operation_id: Uuid,
        now: i64,
    ) -> Result<CoordinatorOutcome, ChatError> {
        self.database.complete_local_deletion(operation_id).await?;
        let receipt = self
            .database
            .finalize_deletion_receipt(operation_id, now)
            .await?;
        Ok(CoordinatorOutcome::CleanupComplete(receipt))
    }

    async fn handle_dispatch_error(
        &self,
        operation_id: Uuid,
        now: i64,
        error: HostBridgeError,
    ) -> Result<DispatchOutcome, ChatError> {
        if error.kind() == HostBridgeErrorKind::NotReady {
            self.database
                .reschedule_outbox(
                    operation_id,
                    now.checked_add(RETRY_DELAY_SECONDS)
                        .ok_or(ChatError::InvalidInput)?,
                )
                .await?;
            Ok(DispatchOutcome::RetryScheduled { operation_id })
        } else {
            // Transport errors may represent an unknown outcome after the Host accepted a
            // request. Failing closed prevents an automatic duplicate session or turn.
            self.database.fail_outbox(operation_id).await?;
            Ok(DispatchOutcome::FailedSafely { operation_id })
        }
    }

    pub async fn stream_active_turn(&self, session_id: Uuid) -> Result<(), ChatError> {
        self.stream_active_turn_with_projection_sink(session_id, &NoopProjectionSink)
            .await
    }

    async fn flush_native_buffer(
        &self,
        buffer: &mut super::native_conversation::NativeDisplayBuffer,
        event: Option<super::native_conversation_generated::NativeEvent>,
        sink: &dyn TurnProjectionSink,
    ) -> Result<(), ChatError> {
        // The coordinator owns writes. UI history reads cannot replace this buffer.
        buffer.view = self
            .database
            .commit_native_view(
                buffer.context().clone(),
                buffer.view.clone(),
                event,
                unix_seconds()?,
            )
            .await?;
        sink.publish_native(buffer.view.clone())
    }

    async fn stream_native_conversation(
        &self,
        session_id: Uuid,
        sink: &dyn TurnProjectionSink,
    ) -> Result<(), ChatError> {
        use super::native_conversation::NativeDisplayBuffer;
        let context = self.database.active_turn_context(session_id).await?;
        let saved = self
            .database
            .native_views(session_id, vec![context.turn_id])
            .await?
            .into_iter()
            .find(|v| v.turn_id == context.turn_id.to_string());
        let mut buffer = NativeDisplayBuffer::new(context.clone(), saved)?;
        let cursor = buffer
            .view
            .cursor
            .as_ref()
            .map(|c| {
                HostEventCursor::new(
                    Uuid::parse_str(&c.stream_id).map_err(|_| ChatError::DatabaseUnavailable)?,
                    c.sequence
                        .parse()
                        .map_err(|_| ChatError::DatabaseUnavailable)?,
                )
                .map_err(map_host_error)
            })
            .transpose()?;
        let host = self.host()?;
        let origin = self
            .database
            .native_host_origin(session_id, context.turn_id)
            .await?;
        // Old rows are archives even when they contain Runtime IDs. They must
        // finish in the old app before cutover; never promote them by guessing.
        if origin.is_none() {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let generation_changed = origin
            .as_deref()
            .is_some_and(|nonce| nonce != host.instance_nonce());
        if generation_changed {
            let snapshot = host
                .read_native_thread(context.agent_session_id)
                .await
                .map_err(map_host_error)?;
            let restored = self
                .database
                .native_recovery_views(
                    session_id,
                    vec![context.turn_id],
                    Some(Arc::new(snapshot)),
                    true,
                )
                .await?;
            if let Some(view) = restored.into_iter().next() {
                let ended = view.status_source.as_deref() == Some("runtime_read")
                    && view
                        .status
                        .as_deref()
                        .is_some_and(|s| matches!(s, "completed" | "failed" | "interrupted"));
                sink.publish_native(view.clone())?;
                if ended {
                    sink.publish_artifact_resync_required(
                        session_id,
                        context.turn_id,
                        ArtifactResyncReason::ProtocolError,
                    )?;
                    return Ok(());
                }
            }
        }
        let mut stream = match host
            .open_native_event_stream(context.agent_session_id, cursor)
            .await
        {
            Ok(stream) => stream,
            Err(error)
                if matches!(
                    error.code(),
                    Some(HostErrorCode::EventStreamChanged | HostErrorCode::EventReplayUnavailable)
                ) =>
            {
                // Native history is a separate source, never merged by Item ID
                // with the observed display copy. No turn submission is retried.
                if error.code() == Some(HostErrorCode::EventStreamChanged) {
                    if let Ok(snapshot) = host.read_native_thread(context.agent_session_id).await {
                        let views = self
                            .database
                            .native_recovery_views(
                                session_id,
                                vec![context.turn_id],
                                Some(Arc::new(snapshot)),
                                true,
                            )
                            .await?;
                        if let Some(view) = views
                            .into_iter()
                            .find(|v| v.turn_id == context.turn_id.to_string())
                        {
                            let ended = view.status_source.as_deref() == Some("runtime_read")
                                && view.status.as_deref().is_some_and(|s| {
                                    matches!(s, "completed" | "failed" | "interrupted")
                                });
                            sink.publish_native(view.clone())?;
                            if ended {
                                return Ok(());
                            }
                        }
                    }
                }
                buffer.mark_unavailable("stream_changed");
                host.open_native_event_stream(context.agent_session_id, None)
                    .await
                    .map_err(map_host_error)?
            }
            Err(error) => return Err(map_host_error(error)),
        };
        // Artifact transport remains owned by FEAT-128. No ordinary v3 event
        // enters the native conversation display buffer or changes its result.
        let mut artifacts = if self.artifact_transfers.is_some() {
            match host
                .open_event_stream_v3(context.agent_session_id, None)
                .await
            {
                Ok(stream) => Some(stream),
                Err(_) => {
                    sink.publish_artifact_resync_required(
                        session_id,
                        context.turn_id,
                        ArtifactResyncReason::ProtocolError,
                    )?;
                    None
                }
            }
        } else {
            None
        };
        let mut artifact_delivery_done = artifacts.is_none();
        let mut artifact_sequence = 0_u64;
        let mut dirty = 0_usize;
        let mut flush = tokio::time::interval(PROGRESS_FLUSH_INTERVAL);
        flush.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut dispatch = tokio::time::interval(PROGRESS_FLUSH_INTERVAL);
        dispatch.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            if buffer.view.terminal_observed && artifact_delivery_done {
                return Ok(());
            }
            tokio::select! {
                _=dispatch.tick()=>{
                    // SSE can stay open for the whole Turn. Keep the existing
                    // outbox dispatcher responsive to native interrupt requests
                    // and ordinary submissions while receiving notifications.
                    // Dispatch errors do not change the observed execution state.
                    if let Ok(outcome)=self.dispatch_next().await {
                        if outcome!=DispatchOutcome::Idle {
                            sink.publish_coordinator(&CoordinatorOutcome::Dispatched(outcome))?;
                        }
                    }
                }
                value=stream.next_stream_event(),if !buffer.view.terminal_observed=>{
                    let event=match value {
                        Ok(Some(HostStreamEvent::Native(event)))=>event,
                        _=>{
                            buffer.mark_unavailable("native_stream_unavailable");
                            self.flush_native_buffer(&mut buffer,None,sink).await?;
                            return Err(ChatError::OrchestrationUnavailable)
                        }
                    };
                    match buffer.observe(&event) {
                        Ok(false)=>continue,
                        Err(_)=>{
                            buffer.mark_unavailable("native_projection_unavailable");
                            self.flush_native_buffer(&mut buffer,None,sink).await?;continue
                        },
                        Ok(true)=>{}
                    }
                    dirty+=1;
                    // Native snapshots/plans/terminals are facts and commit immediately.
                    // Deltas only modify this disposable display copy, flushed at 50 ms/16 events.
                    if !event.payload.native.method.ends_with("Delta")&&!event.payload.native.method.ends_with("/delta") || dirty>=PROGRESS_FLUSH_EVENT_COUNT {
                        self.flush_native_buffer(&mut buffer,Some(*event),sink).await?;dirty=0;
                    }
                }
                _=flush.tick(),if dirty>0=>{
                    self.flush_native_buffer(&mut buffer,None,sink).await?;dirty=0;
                }
                value=async {match artifacts.as_mut(){Some(stream)=>stream.next_stream_event().await,None=>std::future::pending().await}},if !artifact_delivery_done=>{
                    match value {
                        Ok(Some(HostStreamEvent::Ordinary(event)))=>{
                            if event.turn_id==Some(context.runtime_turn_id)&&event.event_type=="turn.completed"{artifact_delivery_done=true}
                        }
                        Ok(Some(HostStreamEvent::Artifact(envelope)))=>{
                            if envelope.turn_id!=context.runtime_turn_id||envelope.cursor.sequence<=artifact_sequence{continue}
                            artifact_sequence=envelope.cursor.sequence;
                            let delivered=async {
                                let artifact=decode_artifact_event_envelope_v3(&envelope,context.agent_session_id,context.runtime_turn_id,context.session_id,context.turn_id)?;
                                #[cfg(feature="feat128-s10-runtime")]
                                let measure=match &artifact {
                                    super::artifact::ArtifactEventV3::Started(id)=>Some((id.artifact_id,id.kind,id.ordinal,crate::feat128_s10d_runtime::Feat128S10dArtifactStage::Announced)),
                                    super::artifact::ArtifactEventV3::Progress{identity:id,..}=>Some((id.artifact_id,id.kind,id.ordinal,crate::feat128_s10d_runtime::Feat128S10dArtifactStage::Progress)),
                                    super::artifact::ArtifactEventV3::Completed(m)=>Some((m.artifact_id,m.kind,m.ordinal,crate::feat128_s10d_runtime::Feat128S10dArtifactStage::Ready)),
                                    _=>None,
                                };
                                self.artifact_transfers.as_ref().ok_or(ChatError::InvalidConfiguration)?.ingest_event(artifact).await?;
                                #[cfg(feature="feat128-s10-runtime")]
                                if let Some((id,kind,ordinal,stage))=measure{crate::feat128_s10d_runtime::feat128_s10d_record_native_artifact(id,kind,ordinal,stage).map_err(|_|ChatError::OrchestrationUnavailable)?;}

                                sink.publish_artifact_changed(session_id,context.turn_id,envelope.event_id)
                            }.await;
                            if delivered.is_err(){sink.publish_artifact_resync_required(session_id,context.turn_id,ArtifactResyncReason::ProtocolError)?;}
                        }
                        _=>{artifact_delivery_done=true;sink.publish_artifact_resync_required(session_id,context.turn_id,ArtifactResyncReason::ProtocolError)?;}
                    }
                }
            }
        }
    }

    pub async fn stream_active_turn_with_projection_sink(
        &self,
        session_id: Uuid,
        sink: &dyn TurnProjectionSink,
    ) -> Result<(), ChatError> {
        self.stream_native_conversation(session_id, sink).await
    }
}

fn map_host_error(_error: HostBridgeError) -> ChatError {
    ChatError::OrchestrationUnavailable
}

fn map_cleanup_surface(status: HostCleanupSurfaceStatus) -> CleanupSurfaceState {
    match status {
        HostCleanupSurfaceStatus::Complete => CleanupSurfaceState::Complete,
        HostCleanupSurfaceStatus::Incomplete => CleanupSurfaceState::Incomplete,
        HostCleanupSurfaceStatus::NotAttempted => CleanupSurfaceState::NotAttempted,
    }
}

fn aggregate_host_surfaces(
    mapping: HostCleanupSurfaceStatus,
    replay: HostCleanupSurfaceStatus,
) -> CleanupSurfaceState {
    match (mapping, replay) {
        (HostCleanupSurfaceStatus::Complete, HostCleanupSurfaceStatus::Complete) => {
            CleanupSurfaceState::Complete
        }
        (HostCleanupSurfaceStatus::Incomplete, _) | (_, HostCleanupSurfaceStatus::Incomplete) => {
            CleanupSurfaceState::Incomplete
        }
        _ => CleanupSurfaceState::NotAttempted,
    }
}

fn cleanup_reason_code(reason: HostCleanupReason) -> &'static str {
    match reason {
        HostCleanupReason::ActiveTurn => "active_turn",
        HostCleanupReason::TerminalUnconfirmed => "terminal_unconfirmed",
        HostCleanupReason::SharedThreadMapping => "shared_thread_mapping",
        HostCleanupReason::RuntimeDeleteFailed => "runtime_delete_failed",
        HostCleanupReason::RuntimeDeleteUnconfirmed => "runtime_delete_unconfirmed",
        HostCleanupReason::HostMappingCleanupFailed => "host_mapping_cleanup_failed",
        HostCleanupReason::HostReplayCleanupFailed => "host_replay_cleanup_failed",
        HostCleanupReason::OperationStateUnavailable => "operation_state_unavailable",
        HostCleanupReason::InternalError => "internal_error",
    }
}

fn unix_seconds() -> Result<i64, ChatError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .map_err(|_| ChatError::OrchestrationUnavailable)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    use crate::chat::keychain::{DatabaseKey, DatabaseKeyStore, ReceiptKey, ReceiptKeyStore};
    #[cfg(target_os = "macos")]
    use crate::chat::public_tasks::FixedPublicTaskControlPlane;
    #[cfg(target_os = "macos")]
    use crate::chat::sidecar::HostConnection;
    #[cfg(target_os = "macos")]
    use crate::native_auth::{
        synthetic_authorization_code_tokens, NativeAuthConfig, NativeAuthRuntime, OidcClient,
    };
    #[cfg(target_os = "macos")]
    use std::fs;
    #[cfg(target_os = "macos")]
    use std::os::unix::fs::PermissionsExt;

    #[cfg(target_os = "macos")]
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    #[cfg(target_os = "macos")]
    use tokio::net::TcpListener;

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn finished_coordinator_handle_is_not_reported_as_running() {
        let (stop, _stop_receiver) = watch::channel(false);
        let coordinator = ConversationCoordinator {
            stop,
            task: Some(tokio::spawn(async {})),
        };
        tokio::time::timeout(Duration::from_secs(1), async {
            while !coordinator.is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("coordinator task finishes");

        assert!(coordinator.is_finished());
        assert!(format!("{coordinator:?}").contains("running: false"));
        coordinator.stop().await.expect("finished task is reaped");
    }

    #[cfg(target_os = "macos")]
    struct TestKeyStore;

    #[cfg(target_os = "macos")]
    impl DatabaseKeyStore for TestKeyStore {
        fn load_or_create(&self, _database_exists: bool) -> Result<DatabaseKey, ChatError> {
            Ok(DatabaseKey::from_bytes([31; 32]))
        }
    }

    #[cfg(target_os = "macos")]
    impl ReceiptKeyStore for TestKeyStore {
        fn load_or_create(&self, _database_exists: bool) -> Result<ReceiptKey, ChatError> {
            Ok(ReceiptKey::from_bytes([32; 32]))
        }
    }

    #[cfg(target_os = "macos")]
    async fn prepare_v2_turn_outbox(
        label: &str,
    ) -> (
        std::path::PathBuf,
        DatabaseWorker,
        PendingConversation,
        ClaimedOutbox,
        Uuid,
    ) {
        let root = std::env::temp_dir().join(format!("yijie-{label}-{}", Uuid::now_v7()));
        let project_path = root.join("project");
        fs::create_dir_all(&project_path).unwrap();
        let selection = native_project::create_selection(&project_path)
            .unwrap()
            .unwrap();
        let database = DatabaseWorker::start(
            root.join("chat"),
            super::super::database::ChatScope::new(
                Uuid::now_v7().to_string(),
                Uuid::now_v7().to_string(),
            )
            .unwrap(),
            Box::new(TestKeyStore),
            Box::new(TestKeyStore),
        )
        .unwrap();
        let project = database
            .register_project(selection.canonical_path, selection.bookmark)
            .await
            .unwrap();
        let attachment = crate::chat::attachment::prepare_bytes(
            "idempotent.txt".to_owned(),
            b"bounded idempotent context".to_vec(),
            unix_seconds().unwrap(),
        )
        .unwrap();
        let attachment_id = attachment.id;
        database
            .store_attachments(vec![attachment], 1, DraftTarget::New)
            .await
            .unwrap();
        let pending = database
            .create_session_and_enqueue_multimodal(
                Uuid::parse_str(&project.id).unwrap(),
                vec![
                    DraftContentBlock::Text("inspect the attachment".to_owned()),
                    DraftContentBlock::File(attachment_id),
                ],
                Uuid::now_v7(),
                1,
            )
            .await
            .unwrap();
        let now = unix_seconds().unwrap();
        let create = database
            .claim_next_conversation_outbox(now, OUTBOX_LEASE_SECONDS)
            .await
            .unwrap()
            .unwrap();
        let public_task_id = Uuid::now_v7();
        database
            .bind_public_task(create.operation_id, public_task_id, now)
            .await
            .unwrap();
        database
            .reschedule_outbox(create.operation_id, now)
            .await
            .unwrap();
        let create = database
            .claim_next_conversation_outbox(now.max(unix_seconds().unwrap()), OUTBOX_LEASE_SECONDS)
            .await
            .unwrap()
            .unwrap();
        let agent_session_id = Uuid::now_v7();
        database
            .bind_host_session_and_enqueue_turn(
                create.operation_id,
                public_task_id,
                agent_session_id,
                Uuid::now_v7(),
            )
            .await
            .unwrap();
        let turn = database
            .claim_next_conversation_outbox(now.max(unix_seconds().unwrap()), OUTBOX_LEASE_SECONDS)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(turn.operation_id, pending.turn_operation_id);
        assert_eq!(
            database.start_turn_payload_version(turn.operation_id).await,
            Ok(2)
        );
        (root, database, pending, turn, agent_session_id)
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat134_background_recovery_terminalizes_preexisting_failed_turn_projection() {
        let (root, database, pending, turn, _agent_session_id) =
            prepare_v2_turn_outbox("feat134-failed-turn-recovery").await;
        database.fail_outbox(turn.operation_id).await.unwrap();
        let application = ConversationApplication::new_offline(database.clone());

        let outcome = application.run_background_once().await.unwrap();
        assert_eq!(
            outcome,
            CoordinatorOutcome::Dispatched(DispatchOutcome::TurnSubmissionFailed {
                operation_id: pending.turn_operation_id,
                session_id: pending.session_id,
                turn_id: pending.turn_id,
            })
        );
        let snapshot = database
            .load_feat134_history_snapshot(pending.session_id, None, Some(20))
            .await
            .unwrap();
        assert_eq!(
            snapshot.session.latest_turn_status.as_deref(),
            Some("failed")
        );
        assert_eq!(snapshot.history.turns[0].status, "failed");
        assert_eq!(snapshot.feat134.turns[0].terminal_code, None);
        assert!(!snapshot.feat134.turns[0].v4_authority);
        assert_eq!(
            application.run_background_once().await.unwrap(),
            CoordinatorOutcome::Idle
        );

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn legacy_background_does_not_run_feat134_failed_turn_recovery() {
        let (root, database, pending, turn, _agent_session_id) =
            prepare_v2_turn_outbox("legacy-no-feat134-failed-turn-recovery").await;
        database.fail_outbox(turn.operation_id).await.unwrap();
        let application = ConversationApplication::new_offline(database.clone());

        assert_eq!(
            application.run_background_once().await.unwrap(),
            CoordinatorOutcome::Idle
        );
        let history = database
            .load_history(pending.session_id, None, Some(20))
            .await
            .unwrap();
        assert_eq!(history.turns[0].status, "queued");
        assert_eq!(
            database
                .outbox_state(pending.turn_operation_id)
                .await
                .unwrap(),
            super::super::database::OutboxState::Failed
        );

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    fn http_response(status: &str, headers: &[(&str, &str)], body: &str) -> String {
        let mut response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
            body.len()
        );
        for (name, value) in headers {
            response.push_str(name);
            response.push_str(": ");
            response.push_str(value);
            response.push_str("\r\n");
        }
        response.push_str("\r\n");
        response.push_str(body);
        response
    }

    #[cfg(target_os = "macos")]
    fn ready_response(nonce: &str) -> String {
        http_response(
            "200 OK",
            &[
                ("Content-Type", "application/json"),
                ("Cache-Control", "no-store"),
                ("X-Yijie-Host-Instance-Nonce", nonce),
            ],
            r#"{"status":"ready","runtime_state":"ready"}"#,
        )
    }

    #[cfg(target_os = "macos")]
    fn not_ready_response(nonce: &str) -> String {
        http_response(
            "503 Service Unavailable",
            &[
                ("Content-Type", "application/json"),
                ("Cache-Control", "no-store"),
                ("X-Yijie-Host-Instance-Nonce", nonce),
            ],
            r#"{"status":"not_ready","runtime_state":"starting"}"#,
        )
    }

    #[cfg(target_os = "macos")]
    fn json_response(status: &str, body: &str) -> String {
        http_response(
            status,
            &[
                ("Content-Type", "application/json"),
                ("Cache-Control", "no-store"),
            ],
            body,
        )
    }

    #[cfg(target_os = "macos")]
    async fn read_request(stream: &mut tokio::net::TcpStream) -> String {
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 2048];
        loop {
            let count = stream.read(&mut buffer).await.unwrap();
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&buffer[..count]);
            let Some(headers_end) = bytes.windows(4).position(|value| value == b"\r\n\r\n") else {
                continue;
            };
            let header_text = std::str::from_utf8(&bytes[..headers_end]).unwrap();
            let content_length = header_text
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length: ")
                        .and_then(|value| value.parse::<usize>().ok())
                })
                .unwrap_or(0);
            if bytes.len() >= headers_end + 4 + content_length {
                break;
            }
        }
        String::from_utf8(bytes).unwrap()
    }

    #[cfg(target_os = "macos")]
    async fn serve_http(responses: Vec<String>) -> (u16, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let task = tokio::spawn(async move {
            let mut requests = Vec::with_capacity(responses.len());
            for response in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                requests.push(read_request(&mut stream).await);
                stream.write_all(response.as_bytes()).await.unwrap();
                stream.shutdown().await.unwrap();
            }
            requests
        });
        (port, task)
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat134_v2_first_claim_starts_same_operation_once_without_resume() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fa1";
        const TOKEN: &str = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
        let (root, database, pending, claimed, agent_session_id) =
            prepare_v2_turn_outbox("feat134-first-claim-direct-start").await;
        let runtime_turn_id = Uuid::now_v7();
        let token_directory = root.join("host");
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let (port, server) = serve_http(vec![
            ready_response(NONCE),
            json_response(
                "202 Accepted",
                &serde_json::json!({"turn_id": runtime_turn_id}).to_string(),
            ),
        ])
        .await;
        let application = ConversationApplication::new_with_artifacts_v4(
            database.clone(),
            Arc::new(
                HostBridge::from_connection(HostConnection {
                    port,
                    token_path,
                    instance_nonce: NONCE.to_owned(),
                })
                .unwrap(),
            ),
            Arc::new(FixedPublicTaskControlPlane::new([])),
        );

        assert_eq!(
            application
                .dispatch_turn(claimed, unix_seconds().unwrap())
                .await
                .unwrap(),
            DispatchOutcome::TurnAccepted {
                session_id: pending.session_id
            }
        );
        let active = database
            .active_turn_context(pending.session_id)
            .await
            .unwrap();
        assert_eq!(active.runtime_turn_id, runtime_turn_id);
        assert_eq!(
            database
                .outbox_state(pending.turn_operation_id)
                .await
                .unwrap(),
            super::super::database::OutboxState::Inflight
        );

        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].starts_with("GET /readyz HTTP/1.1"));
        assert!(requests[1].starts_with(&format!(
            "POST /v2/agent-sessions/{agent_session_id}/turns HTTP/1.1"
        )));
        let turn_request: serde_json::Value =
            serde_json::from_str(requests[1].split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(
            turn_request["operation_id"],
            pending.turn_operation_id.to_string()
        );

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat134_first_claim_turn_active_fails_without_binding_or_retry() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fa7";
        const TOKEN: &str = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
        let (root, database, pending, claimed, agent_session_id) =
            prepare_v2_turn_outbox("feat134-first-attempt-active-resume").await;
        assert_eq!(claimed.attempt_count, 1);
        let token_directory = root.join("host");
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let (port, server) = serve_http(vec![
            ready_response(NONCE),
            json_response(
                "409 Conflict",
                r#"{"error":{"code":"turn_active","message":"active"}}"#,
            ),
        ])
        .await;
        let application = ConversationApplication::new_with_artifacts_v4(
            database.clone(),
            Arc::new(
                HostBridge::from_connection(HostConnection {
                    port,
                    token_path,
                    instance_nonce: NONCE.to_owned(),
                })
                .unwrap(),
            ),
            Arc::new(FixedPublicTaskControlPlane::new([])),
        );

        assert_eq!(
            application
                .dispatch_turn(claimed, unix_seconds().unwrap())
                .await
                .unwrap(),
            DispatchOutcome::TurnSubmissionFailed {
                operation_id: pending.turn_operation_id,
                session_id: pending.session_id,
                turn_id: pending.turn_id,
            }
        );
        assert_eq!(
            database
                .outbox_state(pending.turn_operation_id)
                .await
                .unwrap(),
            super::super::database::OutboxState::Failed
        );
        let history = database
            .load_history(pending.session_id, None, Some(20))
            .await
            .unwrap();
        assert_eq!(history.turns[0].status, "failed");
        assert_eq!(history.turns[0].runtime_turn_id, None);

        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].starts_with(&format!(
            "POST /v2/agent-sessions/{agent_session_id}/turns HTTP/1.1"
        )));
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.starts_with(&format!(
                    "POST /v2/agent-sessions/{agent_session_id}/turns HTTP/1.1"
                )))
                .count(),
            1
        );

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat134_first_claim_session_not_usable_suspends_without_replay() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fa8";
        const TOKEN: &str = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
        let (root, database, pending, claimed, agent_session_id) =
            prepare_v2_turn_outbox("feat134-first-claim-session-not-usable").await;
        assert_eq!(claimed.attempt_count, 1);
        let token_directory = root.join("host");
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let (port, server) = serve_http(vec![
            ready_response(NONCE),
            json_response(
                "409 Conflict",
                r#"{"error":{"code":"session_not_usable","message":"pending"}}"#,
            ),
        ])
        .await;
        let application = ConversationApplication::new_with_artifacts_v4(
            database.clone(),
            Arc::new(
                HostBridge::from_connection(HostConnection {
                    port,
                    token_path,
                    instance_nonce: NONCE.to_owned(),
                })
                .unwrap(),
            ),
            Arc::new(FixedPublicTaskControlPlane::new([])),
        );

        assert_eq!(
            application
                .dispatch_turn(claimed, unix_seconds().unwrap())
                .await
                .unwrap(),
            DispatchOutcome::TurnSubmissionUncertain {
                operation_id: pending.turn_operation_id,
                session_id: pending.session_id,
                turn_id: pending.turn_id,
            }
        );
        assert_eq!(
            database
                .outbox_state(pending.turn_operation_id)
                .await
                .unwrap(),
            super::super::database::OutboxState::Inflight
        );
        let history = database
            .load_history(pending.session_id, None, Some(20))
            .await
            .unwrap();
        assert_eq!(history.turns[0].status, "queued");
        assert_eq!(history.turns[0].runtime_turn_id, None);

        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.starts_with(&format!(
                    "POST /v2/agent-sessions/{agent_session_id}/turns HTTP/1.1"
                )))
                .count(),
            1
        );

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat134_reclaimed_v2_turn_replays_same_operation_once_without_resume() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fa6";
        const TOKEN: &str = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
        let (root, database, pending, original_claim, agent_session_id) =
            prepare_v2_turn_outbox("feat134-reclaimed-active-resume").await;
        let reclaim_at = unix_seconds().unwrap() + OUTBOX_LEASE_SECONDS + 1;
        let reclaimed = database
            .claim_next_conversation_outbox(reclaim_at, OUTBOX_LEASE_SECONDS)
            .await
            .unwrap()
            .expect("expired v2 turn lease is reclaimed");
        assert_eq!(reclaimed.operation_id, original_claim.operation_id);
        assert_eq!(reclaimed.attempt_count, original_claim.attempt_count + 1);

        let runtime_turn_id = Uuid::now_v7();
        let token_directory = root.join("host");
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let (port, server) = serve_http(vec![
            ready_response(NONCE),
            json_response(
                "202 Accepted",
                &serde_json::json!({"turn_id": runtime_turn_id}).to_string(),
            ),
        ])
        .await;
        let application = ConversationApplication::new_with_artifacts_v4(
            database.clone(),
            Arc::new(
                HostBridge::from_connection(HostConnection {
                    port,
                    token_path,
                    instance_nonce: NONCE.to_owned(),
                })
                .unwrap(),
            ),
            Arc::new(FixedPublicTaskControlPlane::new([])),
        );

        assert_eq!(
            application
                .dispatch_turn(reclaimed, reclaim_at)
                .await
                .unwrap(),
            DispatchOutcome::TurnAccepted {
                session_id: pending.session_id
            }
        );
        let active_context = database
            .active_turn_context(pending.session_id)
            .await
            .unwrap();
        assert_eq!(active_context.runtime_turn_id, runtime_turn_id);
        assert_eq!(
            database
                .outbox_state(pending.turn_operation_id)
                .await
                .unwrap(),
            super::super::database::OutboxState::Inflight
        );

        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].starts_with("GET /readyz HTTP/1.1"));
        assert!(requests[1].starts_with(&format!(
            "POST /v2/agent-sessions/{agent_session_id}/turns HTTP/1.1"
        )));
        let replay_request: serde_json::Value =
            serde_json::from_str(requests[1].split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(
            replay_request["operation_id"],
            pending.turn_operation_id.to_string()
        );

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat132_invalid_accepted_response_suspends_without_binding_or_replay() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fa4";
        const TOKEN: &str = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
        let (root, database, pending, claimed, agent_session_id) =
            prepare_v2_turn_outbox("feat134-reconcile-active-turn").await;
        let token_directory = root.join("host");
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let (port, server) = serve_http(vec![
            ready_response(NONCE),
            json_response("202 Accepted", r#"{"turn_id":"#),
        ])
        .await;
        let application = ConversationApplication::new_with_artifacts_v4(
            database.clone(),
            Arc::new(
                HostBridge::from_connection(HostConnection {
                    port,
                    token_path,
                    instance_nonce: NONCE.to_owned(),
                })
                .unwrap(),
            ),
            Arc::new(FixedPublicTaskControlPlane::new([])),
        );

        assert_eq!(
            application
                .dispatch_turn(claimed, unix_seconds().unwrap())
                .await
                .unwrap(),
            DispatchOutcome::TurnSubmissionUncertain {
                operation_id: pending.turn_operation_id,
                session_id: pending.session_id,
                turn_id: pending.turn_id,
            }
        );
        assert_eq!(
            database
                .outbox_state(pending.turn_operation_id)
                .await
                .unwrap(),
            super::super::database::OutboxState::Inflight
        );
        let history = database
            .load_history(pending.session_id, None, Some(20))
            .await
            .unwrap();
        assert_eq!(history.turns[0].status, "queued");
        assert_eq!(history.turns[0].runtime_turn_id, None);

        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.starts_with(&format!(
                    "POST /v2/agent-sessions/{agent_session_id}/turns HTTP/1.1"
                )))
                .count(),
            1
        );
        assert!(!requests.iter().any(|request| request.starts_with(&format!(
            "GET /v1/agent-sessions/{agent_session_id} HTTP/1.1"
        ))));

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat134_transport_after_direct_start_suspends_without_replay() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fa5";
        const TOKEN: &str = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
        let (root, database, pending, claimed, agent_session_id) =
            prepare_v2_turn_outbox("feat134-reconcile-unresolved-turn").await;
        let token_directory = root.join("host");
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let (port, server) = serve_http(vec![ready_response(NONCE), String::new()]).await;
        let application = ConversationApplication::new_with_artifacts_v4(
            database.clone(),
            Arc::new(
                HostBridge::from_connection(HostConnection {
                    port,
                    token_path,
                    instance_nonce: NONCE.to_owned(),
                })
                .unwrap(),
            ),
            Arc::new(FixedPublicTaskControlPlane::new([])),
        );

        assert_eq!(
            application
                .dispatch_turn(claimed, unix_seconds().unwrap())
                .await
                .unwrap(),
            DispatchOutcome::TurnSubmissionUncertain {
                operation_id: pending.turn_operation_id,
                session_id: pending.session_id,
                turn_id: pending.turn_id,
            }
        );
        assert_eq!(
            database
                .outbox_state(pending.turn_operation_id)
                .await
                .unwrap(),
            super::super::database::OutboxState::Inflight
        );
        let history = database
            .load_history(pending.session_id, None, Some(20))
            .await
            .unwrap();
        assert_eq!(history.turns[0].status, "queued");
        assert_eq!(history.turns[0].runtime_turn_id, None);
        assert_eq!(
            application.run_background_once().await.unwrap(),
            CoordinatorOutcome::Idle
        );

        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.starts_with(&format!(
                    "POST /v2/agent-sessions/{agent_session_id}/turns HTTP/1.1"
                )))
                .count(),
            1
        );

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat134_direct_start_not_ready_fails_once_without_turn_post() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fa2";
        const TOKEN: &str = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
        let (root, database, pending, claimed, _agent_session_id) =
            prepare_v2_turn_outbox("feat134-resume-not-ready").await;
        let token_directory = root.join("host");
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let (port, server) = serve_http(vec![not_ready_response(NONCE)]).await;
        let application = ConversationApplication::new_with_artifacts_v4(
            database.clone(),
            Arc::new(
                HostBridge::from_connection(HostConnection {
                    port,
                    token_path,
                    instance_nonce: NONCE.to_owned(),
                })
                .unwrap(),
            ),
            Arc::new(FixedPublicTaskControlPlane::new([])),
        );

        assert_eq!(
            application
                .dispatch_turn(claimed, unix_seconds().unwrap())
                .await
                .unwrap(),
            DispatchOutcome::TurnSubmissionFailed {
                operation_id: pending.turn_operation_id,
                session_id: pending.session_id,
                turn_id: pending.turn_id,
            }
        );
        assert_eq!(
            database
                .outbox_state(pending.turn_operation_id)
                .await
                .unwrap(),
            super::super::database::OutboxState::Failed
        );
        let history = database
            .load_history(pending.session_id, None, Some(20))
            .await
            .unwrap();
        assert_eq!(history.turns[0].status, "failed");
        assert_eq!(history.turns[0].runtime_turn_id, None);
        assert_eq!(history.turns[0].reasoning_status, "unavailable");
        assert_eq!(
            application.dispatch_next().await.unwrap(),
            DispatchOutcome::Idle
        );
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("GET /readyz HTTP/1.1"));
        assert!(!requests[0].contains("/turns"));

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat134_reclaimed_session_not_usable_suspends_without_retry() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fa3";
        const TOKEN: &str = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
        let (root, database, pending, original_claim, agent_session_id) =
            prepare_v2_turn_outbox("feat134-reclaimed-session-not-usable").await;
        let reclaim_at = unix_seconds().unwrap() + OUTBOX_LEASE_SECONDS + 1;
        let reclaimed = database
            .claim_next_conversation_outbox(reclaim_at, OUTBOX_LEASE_SECONDS)
            .await
            .unwrap()
            .expect("expired v2 turn lease is reclaimed");
        assert_eq!(reclaimed.operation_id, original_claim.operation_id);
        assert_eq!(reclaimed.attempt_count, original_claim.attempt_count + 1);
        let token_directory = root.join("host");
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let (port, server) = serve_http(vec![
            ready_response(NONCE),
            json_response(
                "409 Conflict",
                r#"{"error":{"code":"session_not_usable","message":"pending"}}"#,
            ),
        ])
        .await;
        let application = ConversationApplication::new_with_artifacts_v4(
            database.clone(),
            Arc::new(
                HostBridge::from_connection(HostConnection {
                    port,
                    token_path,
                    instance_nonce: NONCE.to_owned(),
                })
                .unwrap(),
            ),
            Arc::new(FixedPublicTaskControlPlane::new([])),
        );

        assert_eq!(
            application
                .dispatch_turn(reclaimed, reclaim_at)
                .await
                .unwrap(),
            DispatchOutcome::TurnSubmissionUncertain {
                operation_id: pending.turn_operation_id,
                session_id: pending.session_id,
                turn_id: pending.turn_id,
            }
        );
        assert_eq!(
            database
                .outbox_state(pending.turn_operation_id)
                .await
                .unwrap(),
            super::super::database::OutboxState::Inflight
        );
        let history = database
            .load_history(pending.session_id, None, Some(20))
            .await
            .unwrap();
        assert_eq!(history.turns[0].status, "queued");
        assert_eq!(history.turns[0].runtime_turn_id, None);
        assert_eq!(history.turns[0].reasoning_status, "pending");
        assert_eq!(
            application.dispatch_next().await.unwrap(),
            DispatchOutcome::Idle
        );
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].starts_with("GET /readyz HTTP/1.1"));
        assert!(requests[1].starts_with(&format!(
            "POST /v2/agent-sessions/{agent_session_id}/turns HTTP/1.1"
        )));
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.starts_with(&format!(
                    "POST /v2/agent-sessions/{agent_session_id}/turns HTTP/1.1"
                )))
                .count(),
            1
        );

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat132_legacy_active_row_cannot_be_promoted_or_closed_by_missing_stream() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fa4";
        const TOKEN: &str = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
        let (root, database, pending, turn, _) =
            prepare_v2_turn_outbox("feat132-legacy-active").await;
        let runtime_turn_id = Uuid::now_v7();
        database
            .suspend_started_turn_retry(turn.operation_id, runtime_turn_id)
            .await
            .unwrap();
        let token_directory = root.join("host");
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let application = ConversationApplication::new_with_artifacts_v4(
            database.clone(),
            Arc::new(
                HostBridge::from_connection(HostConnection {
                    port: 9,
                    token_path,
                    instance_nonce: NONCE.into(),
                })
                .unwrap(),
            ),
            Arc::new(FixedPublicTaskControlPlane::new([])),
        );
        assert_eq!(
            application.stream_active_turn(pending.session_id).await,
            Err(ChatError::OrchestrationUnavailable)
        );
        assert_eq!(
            database
                .active_turn_context(pending.session_id)
                .await
                .unwrap()
                .runtime_turn_id,
            runtime_turn_id
        );
        assert_eq!(
            database.outbox_state(turn.operation_id).await.unwrap(),
            super::super::database::OutboxState::Inflight
        );
        assert!(database
            .native_views(pending.session_id, vec![pending.turn_id])
            .await
            .unwrap()
            .is_empty());
        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn v2_invalid_accepted_response_retries_same_operation_id() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fb0";
        const TOKEN: &str = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
        let (root, database, pending, claimed, _agent_session_id) =
            prepare_v2_turn_outbox("feat127-invalid-accepted-response").await;
        let token_directory = root.join("host");
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let runtime_turn_id = Uuid::now_v7();
        let (port, server) = serve_http(vec![
            ready_response(NONCE),
            json_response("202 Accepted", r#"{"turn_id":"#),
            ready_response(NONCE),
            json_response(
                "202 Accepted",
                &serde_json::json!({"turn_id": runtime_turn_id}).to_string(),
            ),
        ])
        .await;
        let application = ConversationApplication::new(
            database.clone(),
            Arc::new(
                HostBridge::from_connection(HostConnection {
                    port,
                    token_path,
                    instance_nonce: NONCE.to_owned(),
                })
                .unwrap(),
            ),
            Arc::new(FixedPublicTaskControlPlane::new([])),
        );

        database
            .reschedule_outbox(claimed.operation_id, unix_seconds().unwrap())
            .await
            .unwrap();
        assert_eq!(
            application.dispatch_next().await.unwrap(),
            DispatchOutcome::RetryScheduled {
                operation_id: pending.turn_operation_id
            }
        );
        tokio::time::sleep(Duration::from_secs(RETRY_DELAY_SECONDS as u64)).await;
        assert_eq!(
            application.dispatch_next().await.unwrap(),
            DispatchOutcome::TurnAccepted {
                session_id: pending.session_id
            }
        );

        let requests = server.await.unwrap();
        let first_body = requests[1].split("\r\n\r\n").nth(1).unwrap();
        let second_body = requests[3].split("\r\n\r\n").nth(1).unwrap();
        assert_eq!(first_body, second_body);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(first_body).unwrap()["operation_id"],
            pending.turn_operation_id.to_string()
        );

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn v2_turn_operation_conflict_is_not_retried() {
        let (root, database, pending, _claimed, _agent_session_id) =
            prepare_v2_turn_outbox("feat127-turn-operation-conflict").await;
        let application = ConversationApplication::new_offline(database.clone());
        assert_eq!(
            application
                .finish_turn_dispatch(
                    unix_seconds().unwrap(),
                    2,
                    pending.turn_operation_id,
                    pending.session_id,
                    Err(HostBridgeError::rejected(
                        HostErrorCode::TurnOperationConflict,
                    )),
                )
                .await
                .unwrap(),
            DispatchOutcome::TurnSubmissionFailed {
                operation_id: pending.turn_operation_id,
                session_id: pending.session_id,
                turn_id: pending.turn_id,
            }
        );
        assert_eq!(
            database
                .outbox_state(pending.turn_operation_id)
                .await
                .unwrap(),
            super::super::database::OutboxState::Failed
        );

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn v2_turn_active_never_binds_an_unrelated_runtime_turn() {
        let (root, database, pending, _claimed, _agent_session_id) =
            prepare_v2_turn_outbox("feat127-turn-active").await;
        let application = ConversationApplication::new_offline(database.clone());
        assert_eq!(
            application
                .finish_turn_dispatch(
                    unix_seconds().unwrap(),
                    2,
                    pending.turn_operation_id,
                    pending.session_id,
                    Err(HostBridgeError::rejected(HostErrorCode::TurnActive)),
                )
                .await
                .unwrap(),
            DispatchOutcome::TurnSubmissionFailed {
                operation_id: pending.turn_operation_id,
                session_id: pending.session_id,
                turn_id: pending.turn_id,
            }
        );
        assert_eq!(
            database
                .outbox_state(pending.turn_operation_id)
                .await
                .unwrap(),
            super::super::database::OutboxState::Failed
        );

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    fn s10p3_access_claim_summary(encoded: &str) -> serde_json::Value {
        fn decode_base64url(value: &str) -> Vec<u8> {
            let mut output = Vec::with_capacity(value.len() * 3 / 4);
            let mut accumulator = 0_u32;
            let mut bits = 0_u8;
            for byte in value.bytes() {
                let digit = match byte {
                    b'A'..=b'Z' => byte - b'A',
                    b'a'..=b'z' => byte - b'a' + 26,
                    b'0'..=b'9' => byte - b'0' + 52,
                    b'-' => 62,
                    b'_' => 63,
                    _ => panic!("invalid base64url token segment"),
                };
                accumulator = (accumulator << 6) | u32::from(digit);
                bits += 6;
                if bits >= 8 {
                    bits -= 8;
                    output.push((accumulator >> bits) as u8);
                    accumulator &= (1_u32 << bits).saturating_sub(1);
                }
            }
            output
        }

        let mut segments = encoded.split('.');
        let _header = segments.next().expect("JWT header");
        let claims = segments.next().expect("JWT claims");
        assert!(segments.next().is_some());
        assert!(segments.next().is_none());
        let claims: serde_json::Value =
            serde_json::from_slice(&decode_base64url(claims)).expect("JWT claims JSON");
        serde_json::json!({
            "iss": claims.get("iss"),
            "sub": claims.get("sub"),
            "aud": claims.get("aud"),
            "iat": claims.get("iat"),
            "nbf": claims.get("nbf"),
            "exp": claims.get("exp"),
        })
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    #[ignore = "S10P3 local integration: requires the explicit S10E synthetic API/identity profile"]
    async fn s10p3_real_desktop_rust_path_binds_public_task_before_host_and_retains_public_row() {
        const OWNER: &str = "12500000-0000-4000-8000-000000000001";
        const TENANT: &str = "12500000-0000-4000-8000-100000000001";
        const TOKEN: &str = "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

        assert_eq!(
            std::env::var("YIJIE_FEAT126_S10P3_REAL_MAIN_CHAIN").as_deref(),
            Ok("true")
        );
        let config = NativeAuthConfig::from_environment()
            .expect("native auth configuration")
            .expect("native auth enabled");
        let oidc = OidcClient::new(config.clone()).expect("OIDC client");
        let tokens = synthetic_authorization_code_tokens(&oidc)
            .await
            .expect("synthetic authorization-code and PKCE login");
        let claims = s10p3_access_claim_summary(tokens.access_token.expose());
        assert_eq!(
            claims["iss"],
            serde_json::json!("https://localhost:8443/realms/yijie-local")
        );
        assert_eq!(claims["sub"], serde_json::json!(OWNER));
        assert!(
            claims["aud"] == serde_json::json!("https://api.yijie.ai")
                || claims["aud"] == serde_json::json!(["https://api.yijie.ai"]),
            "content-free access claim summary: {claims}"
        );
        assert!(claims["iat"].is_number());
        assert!(claims["nbf"].is_number());
        assert!(claims["exp"].is_number());
        let native_auth = NativeAuthRuntime::from_test_oidc_tokens(config, oidc, tokens)
            .await
            .expect("native auth runtime");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let projection = native_auth
            .chat_projection(TENANT, now)
            .await
            .expect("real capability projection");
        assert!(projection
            .capabilities
            .iter()
            .any(|value| value == "task.create"));

        let root = std::env::temp_dir().join(format!("yijie-s10p3-real-{}", Uuid::now_v7()));
        let project_path = root.join("synthetic-project");
        let host_directory = root.join("host");
        fs::create_dir_all(&project_path).unwrap();
        fs::create_dir(&host_directory).unwrap();
        fs::set_permissions(&host_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = host_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let selection = native_project::create_selection(&project_path)
            .unwrap()
            .unwrap();
        let database = DatabaseWorker::start(
            root.join("chat"),
            super::super::database::ChatScope::new(OWNER.to_owned(), TENANT.to_owned()).unwrap(),
            Box::new(TestKeyStore),
            Box::new(TestKeyStore),
        )
        .unwrap();
        let project = database
            .register_project(selection.canonical_path, selection.bookmark)
            .await
            .unwrap();
        let provider = Arc::new(
            super::super::public_tasks::NativePublicTaskControlPlane::new(
                native_auth,
                Uuid::parse_str(OWNER).unwrap(),
                Uuid::parse_str(TENANT).unwrap(),
            ),
        );
        let application = ConversationApplication::new(
            database.clone(),
            Arc::new(
                HostBridge::from_connection(HostConnection {
                    port: 9,
                    token_path,
                    instance_nonce: "019fbd88-cbc3-7bf1-934d-7b05cd693f98".to_owned(),
                })
                .unwrap(),
            ),
            provider,
        );
        let operation_id = Uuid::now_v7();
        let pending = application
            .create_local_session(
                Uuid::parse_str(&project.id).unwrap(),
                "S10P3 synthetic local-only canary".to_owned(),
                operation_id,
                projection.authorization_revision,
            )
            .await
            .unwrap();
        assert_eq!(
            application.dispatch_next().await.unwrap(),
            DispatchOutcome::ControlPlaneChanged(PublicTaskControlPlaneStatus {
                session_id: pending.session_id,
                state: PublicTaskBindingState::Bound,
                issue_code: None,
                host_session_bound: false,
            })
        );
        assert_eq!(
            application
                .public_task_control_plane_status(pending.session_id)
                .await
                .unwrap()
                .state,
            PublicTaskBindingState::Bound
        );

        let delete_operation = Uuid::now_v7();
        application
            .begin_session_deletion(pending.session_id, delete_operation)
            .await
            .unwrap();
        assert!(matches!(
            application.run_background_once().await.unwrap(),
            CoordinatorOutcome::CleanupComplete(_)
        ));
        assert!(application
            .list_sessions(None, None)
            .await
            .unwrap()
            .sessions
            .is_empty());
        assert_eq!(
            application
                .public_task_control_plane_status(pending.session_id)
                .await,
            Err(ChatError::NotFound)
        );

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat132_open_native_stream_dispatches_interrupt_before_terminal() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fa6";
        let (root, database, pending, _claimed, agent_session_id) =
            prepare_v2_turn_outbox("feat132-responsive-interrupt").await;
        let runtime_turn_id = Uuid::now_v7();
        database
            .accept_native_turn(pending.turn_operation_id, runtime_turn_id, NONCE.into())
            .await
            .unwrap();
        let context = database
            .active_turn_context(pending.session_id)
            .await
            .unwrap();
        let stream_id = Uuid::now_v7();
        let event = |sequence, method: &str, status: &str| {
            let e = serde_json::json!({"schema_version":7,"event_id":Uuid::now_v7(),"stream_id":stream_id,"sequence":sequence,"occurred_at":"2026-09-09T00:00:00Z","task_id":context.task_id,"agent_session_id":agent_session_id,"codex_thread_id":context.codex_thread_id,"turn_id":runtime_turn_id,"event_type":"native.notification","terminal":method=="turn/completed","payload":{"native":{"source":"runtime_notification","method":method,"threadId":context.codex_thread_id,"turnId":runtime_turn_id,"availability":"available","turn":{"id":runtime_turn_id,"status":status,"items":[],"itemsComplete":false}}}});
            format!("id: {stream_id}:{sequence}\nevent: native.notification\ndata: {e}\n\n")
        };
        let started = event(1, "turn/started", "inProgress");
        let ended = event(2, "turn/completed", "interrupted");
        let token_directory = root.join("host");
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF").unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (opened, ready) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut readiness, _) = listener.accept().await.unwrap();
            assert!(read_request(&mut readiness)
                .await
                .starts_with("GET /readyz "));
            readiness
                .write_all(ready_response(NONCE).as_bytes())
                .await
                .unwrap();
            readiness.shutdown().await.unwrap();
            let (mut sse, _) = listener.accept().await.unwrap();
            assert!(read_request(&mut sse)
                .await
                .starts_with("GET /v7/agent-sessions/"));
            let headers=format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nX-Accel-Buffering: no\r\nX-Yijie-Event-Schema-Version: 7\r\nX-Yijie-Event-Stream-ID: {stream_id}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",started.len()+ended.len());
            sse.write_all(format!("{headers}{started}").as_bytes())
                .await
                .unwrap();
            opened.send(()).unwrap();
            let received=tokio::time::timeout(Duration::from_secs(2),async {
                loop {
                    let (mut connection, _)=listener.accept().await.unwrap();
                    let request=read_request(&mut connection).await;
                    if request.starts_with("GET /readyz ") {
                        connection.write_all(ready_response(NONCE).as_bytes()).await.unwrap();
                    } else {
                        assert!(request.starts_with(&format!("POST /v1/agent-sessions/{agent_session_id}/turns/{runtime_turn_id}/interrupt HTTP/1.1")));
                        connection.write_all(http_response("204 No Content",&[("Cache-Control","no-store")],"").as_bytes()).await.unwrap();
                        connection.shutdown().await.unwrap();
                        return;
                    }
                    connection.shutdown().await.unwrap();
                }
            }).await.is_ok();
            // Always finish the ordinary fixture response, including on a test
            // failure. No process kill or broken transport is used as a signal.
            sse.write_all(ended.as_bytes()).await.unwrap();
            sse.shutdown().await.unwrap();
            received
        });
        let application = ConversationApplication::new(
            database.clone(),
            Arc::new(
                HostBridge::from_connection(HostConnection {
                    port,
                    token_path,
                    instance_nonce: NONCE.into(),
                })
                .unwrap(),
            ),
            Arc::new(FixedPublicTaskControlPlane::new([])),
        );
        let worker = application.clone();
        let streaming =
            tokio::spawn(async move { worker.stream_active_turn(pending.session_id).await });
        ready.await.unwrap();
        let operation_id = Uuid::now_v7();
        application
            .interrupt_turn(pending.session_id, operation_id)
            .await
            .unwrap();
        let history = database
            .load_history(pending.session_id, None, Some(20))
            .await
            .unwrap();
        assert_ne!(
            history.turns[0].status, "stopping",
            "an outbox request cannot change native execution truth"
        );
        streaming.await.unwrap().unwrap();
        assert!(
            server.await.unwrap(),
            "interrupt must reach Host while SSE is still open"
        );
        let views = database
            .native_views(pending.session_id, vec![pending.turn_id])
            .await
            .unwrap();
        assert_eq!(views[0].status.as_deref(), Some("interrupted"));
        assert!(views[0].terminal_observed);
        assert_eq!(
            database.outbox_state(operation_id).await.unwrap(),
            super::super::database::OutboxState::Done
        );
        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat132_native_sse_commits_final_objects_without_legacy_body_reconciliation() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fa6";
        const TOKEN: &str = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
        let (root, database, pending, _claimed, agent_session_id) =
            prepare_v2_turn_outbox("feat132-native-stream").await;
        let runtime_turn_id = Uuid::now_v7();
        database
            .accept_native_turn(pending.turn_operation_id, runtime_turn_id, NONCE.into())
            .await
            .unwrap();
        let context = database
            .active_turn_context(pending.session_id)
            .await
            .unwrap();
        let stream_id = Uuid::now_v7();
        let mut sse = String::new();
        for (index,(method,payload)) in [
            ("turn/started",serde_json::json!({"turn":{"id":runtime_turn_id,"status":"inProgress","items":[],"itemsComplete":false}})),
            ("item/started",serde_json::json!({"item":{"id":"agent-native","type":"agentMessage","text":"","phase":"commentary","availability":"available"}})),
            ("item/agentMessage/delta",serde_json::json!({"itemId":"agent-native","delta":"draft"})),
            ("item/completed",serde_json::json!({"item":{"id":"agent-native","type":"agentMessage","text":"revised native final","phase":"final_answer","availability":"available"}})),
            ("turn/completed",serde_json::json!({"turn":{"id":runtime_turn_id,"status":"failed","errorCode":"usageLimitExceeded","items":[],"itemsComplete":false}})),
        ].into_iter().enumerate(){
            let sequence=index+1;let mut n=serde_json::json!({"source":"runtime_notification","method":method,"threadId":context.codex_thread_id,"turnId":runtime_turn_id,"availability":"available"});for(k,v)in payload.as_object().unwrap(){n[k]=v.clone();}
            let event=serde_json::json!({"schema_version":7,"event_id":Uuid::now_v7(),"stream_id":stream_id,"sequence":sequence,"occurred_at":"2026-09-08T00:00:00Z","task_id":context.task_id,"agent_session_id":agent_session_id,"codex_thread_id":context.codex_thread_id,"turn_id":runtime_turn_id,"event_type":"native.notification","terminal":method=="turn/completed","payload":{"native":n}});
            sse.push_str(&format!("id: {stream_id}:{sequence}\nevent: native.notification\ndata: {event}\n\n"));
        }
        let token_directory = root.join("host");
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, TOKEN).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let (port, server) = serve_http(vec![
            ready_response(NONCE),
            http_response(
                "200 OK",
                &[
                    ("Content-Type", "text/event-stream"),
                    ("Cache-Control", "no-store"),
                    ("X-Accel-Buffering", "no"),
                    ("X-Yijie-Event-Schema-Version", "7"),
                    ("X-Yijie-Event-Stream-ID", &stream_id.to_string()),
                ],
                &sse,
            ),
        ])
        .await;
        let application = ConversationApplication::new(
            database.clone(),
            Arc::new(
                HostBridge::from_connection(HostConnection {
                    port,
                    token_path,
                    instance_nonce: NONCE.into(),
                })
                .unwrap(),
            ),
            Arc::new(FixedPublicTaskControlPlane::new([])),
        );
        application
            .stream_active_turn(pending.session_id)
            .await
            .unwrap();
        let views = database
            .native_views(pending.session_id, vec![pending.turn_id])
            .await
            .unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].items[0].item.id, "agent-native");
        assert_eq!(
            views[0].items[0].item.text.as_deref(),
            Some("revised native final")
        );
        assert_eq!(views[0].status.as_deref(), Some("failed"));
        assert_eq!(
            views[0].terminal_error_code.as_deref(),
            Some("usageLimitExceeded")
        );
        assert!(views[0].terminal_observed);
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].starts_with(&format!(
            "GET /v7/agent-sessions/{agent_session_id}/events HTTP/1.1"
        )));
        assert!(requests.iter().all(|r| !r.starts_with("POST ")));
        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat132_coordinator_recovers_missing_cursor_from_confirmed_previous_host() {
        const OLD: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fa5";
        const CURRENT: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fa6";
        const TOKEN: &str = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
        let (root, database, pending, _claimed, agent_session_id) =
            prepare_v2_turn_outbox("feat132-recover-without-ui").await;
        let runtime_turn_id = Uuid::now_v7();
        database
            .accept_native_turn(pending.turn_operation_id, runtime_turn_id, OLD.into())
            .await
            .unwrap();
        let context = database
            .active_turn_context(pending.session_id)
            .await
            .unwrap();
        let token_directory = root.join("host");
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, TOKEN).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let snapshot = serde_json::json!({"schema_version":1,"source":"runtime_read","thread_id":context.codex_thread_id,"availability":"partial","turns":[{"id":runtime_turn_id,"status":"completed","itemsComplete":false,"items":[{"id":"item-0","type":"agentMessage","text":"recovered by Codex","phase":"final_answer","availability":"partial"}]}]});
        let (port, server) = serve_http(vec![
            ready_response(CURRENT),
            json_response("200 OK", &snapshot.to_string()),
        ])
        .await;
        let application = ConversationApplication::new(
            database.clone(),
            Arc::new(
                HostBridge::from_connection(HostConnection {
                    port,
                    token_path,
                    instance_nonce: CURRENT.into(),
                })
                .unwrap(),
            ),
            Arc::new(FixedPublicTaskControlPlane::new([])),
        );
        application
            .stream_active_turn(pending.session_id)
            .await
            .unwrap();
        let views = database
            .native_views(pending.session_id, vec![pending.turn_id])
            .await
            .unwrap();
        assert_eq!(views[0].status_source.as_deref(), Some("runtime_read"));
        assert!(!views[0].terminal_observed);
        assert_eq!(views[0].items[0].item.id, "item-0");
        assert_eq!(
            database
                .load_history(pending.session_id, None, Some(20))
                .await
                .unwrap()
                .turns[0]
                .status,
            "completed"
        );
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].starts_with(&format!(
            "GET /v1/agent-sessions/{agent_session_id}/native-thread HTTP/1.1"
        )));
        assert!(requests.iter().all(|r| !r.starts_with("POST ")));
        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }
}
