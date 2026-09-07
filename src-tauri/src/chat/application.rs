use super::artifact::{
    decode_artifact_event_envelope_v3, ArtifactEventV3, ArtifactProjection,
    ArtifactTransferService, ReadyFileContent, ReadyFileReadError, ReadyImageContent,
    ReadyImageReadError, ReadyReportContent, ReadyReportReadError, ReadyVideoContent,
    ReadyVideoRangeContent, ReadyVideoRangeRequest, ReadyVideoReadError,
};
use super::attachment::PreparedAttachment;
use super::authorization::{ChatAction, ChatAuthorizationManager};
use super::database::{
    feat134_projection_requires_limit_terminal, ActiveTurnContext, AttachmentSummary,
    ClaimedDeletion, ClaimedOutbox, CleanupSurfaceState, DeletionStatus, DraftContentBlock,
    DraftTarget, Feat134HistorySnapshot, Feat136ObservedEventDisposition, HistoryPage,
    MessageContentBlockProjection, OutboxKind, PendingConversation, ProjectSummary,
    PublicTaskBindingState, PublicTaskControlPlaneStatus, ReasoningItem, ReasoningPart,
    ReasoningStatus, RecoverySnapshot, SessionPage, SessionPageCursor, SessionSummary,
    StartTurnDispatchV2, StoredEventCursor, TerminalTurnCommit, TurnProgress, OUTBOX_MAX_ATTEMPTS,
};
use super::error::ChatError;
use super::feat134::{
    Feat134HistoryProjection, Feat134Hydration, Feat134Projection, Feat134ProjectionFailure,
    Feat134ProjectionFailureKind, Feat134TurnReducer, TimelineReasoningStatus,
};
use super::feat136::{ExecutionProjection, Feat136TurnReducer};
use super::feat137::{
    protect_process_projection, require_pending_decision_authority, ApprovalDecisionFailure,
    ApprovalDecisionIdentity, ApprovalDecisionResult, ApprovalProjection,
    HostPendingApprovalSnapshot, PendingApproval, PendingApprovalSnapshot,
};
use super::host_bridge::{HostBridge, HostTrace};
use super::host_domain::{
    HostApprovalDecision, HostArtifactEventV3, HostBridgeError, HostBridgeErrorKind,
    HostCleanupOutcome, HostCleanupReason, HostCleanupSurfaceStatus, HostErrorCode, HostEvent,
    HostEventCursor, HostEventKind, HostReasoningPart, HostReasoningReason, HostReasoningStatus,
    HostSessionState, HostStreamEvent, HostTurnStatus,
};
use super::native_project;
use super::public_tasks::{
    PublicTaskControlPlane, PublicTaskCreateIntent, PublicTaskCreateOutcome, PublicTaskIssueCode,
};
use super::worker::DatabaseWorker;
#[cfg(feature = "feat128-s10-runtime")]
use crate::feat128_s10d_runtime::{feat128_s10d_record_native_artifact, Feat128S10dArtifactStage};
use std::fmt::{Debug, Formatter};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::watch;
use uuid::Uuid;

const ORPHANED_TERMINAL_REPLAY_GRACE: Duration = Duration::from_secs(2);

fn feat136_active_turn_stream_schema(
    persisted_schema_version: Option<u8>,
) -> Result<u8, ChatError> {
    match persisted_schema_version {
        Some(4) => Ok(4),
        None | Some(5) => Ok(5),
        Some(_) => Err(ChatError::DatabaseUnavailable),
    }
}

fn feat137_active_turn_stream_schema(
    persisted_schema_version: Option<u8>,
) -> Result<u8, ChatError> {
    match persisted_schema_version {
        Some(4) => Ok(4),
        Some(5) => Ok(5),
        None | Some(6) => Ok(6),
        Some(_) => Err(ChatError::DatabaseUnavailable),
    }
}

#[cfg(feature = "feat126-s10-driver")]
pub(crate) fn run_r8_reducer_probe() -> Result<u64, ChatError> {
    let identity = ProbeEventIdentity {
        stream_id: Uuid::from_u128(0x7000),
        task_id: Uuid::from_u128(0x7001),
        agent_session_id: Uuid::from_u128(0x7002),
        thread_id: Uuid::from_u128(0x7003),
        turn_id: Uuid::from_u128(0x7004),
    };
    let context = ActiveTurnContext {
        session_id: identity.task_id,
        task_id: identity.task_id,
        turn_id: Uuid::from_u128(0x7005),
        turn_operation_id: Uuid::from_u128(0x7006),
        agent_session_id: identity.agent_session_id,
        codex_thread_id: identity.thread_id,
        runtime_turn_id: identity.turn_id,
        assistant_text: String::new(),
        cursor: None,
    };
    let mut reducer = TurnEventReducer::new(context)?;
    let mut last_event_id = None;
    for sequence in 1..=5_000_u64 {
        let event_id = Uuid::from_u128(0x8000 + u128::from(sequence));
        let event = HostEvent {
            cursor: HostEventCursor::new(identity.stream_id, sequence)
                .map_err(|_| ChatError::DatabaseUnavailable)?,
            event_type: "synthetic".to_owned(),
            event_id,
            task_id: identity.task_id,
            agent_session_id: identity.agent_session_id,
            codex_thread_id: identity.thread_id,
            turn_id: Some(identity.turn_id),
            item_id: Some("synthetic".to_owned()),
            occurred_at: "2026-08-13T00:00:00Z".to_owned(),
            encoded_bytes: 1,
            kind: HostEventKind::AgentMessageDelta {
                delta: "x".to_owned(),
            },
        };
        if !matches!(
            reducer.apply(
                event,
                i64::try_from(sequence).map_err(|_| ChatError::InvalidInput)?
            )?,
            ReducerOutcome::Progress
        ) {
            return Err(ChatError::DatabaseUnavailable);
        }
        last_event_id = Some(event_id);
    }
    let Some(last_event_id) = last_event_id else {
        return Err(ChatError::DatabaseUnavailable);
    };
    for _ in 0..5_000_u64 {
        let event = HostEvent {
            cursor: HostEventCursor::new(identity.stream_id, 5_000)
                .map_err(|_| ChatError::DatabaseUnavailable)?,
            event_type: "synthetic".to_owned(),
            event_id: last_event_id,
            task_id: identity.task_id,
            agent_session_id: identity.agent_session_id,
            codex_thread_id: identity.thread_id,
            turn_id: Some(identity.turn_id),
            item_id: Some("synthetic".to_owned()),
            occurred_at: "2026-08-13T00:00:00Z".to_owned(),
            encoded_bytes: 1,
            kind: HostEventKind::AgentMessageDelta {
                delta: "x".to_owned(),
            },
        };
        if !matches!(reducer.apply(event, 1)?, ReducerOutcome::Duplicate) {
            return Err(ChatError::DatabaseUnavailable);
        }
    }
    Ok(10_000)
}

#[cfg(feature = "feat126-s10-driver")]
struct ProbeEventIdentity {
    stream_id: Uuid,
    task_id: Uuid,
    agent_session_id: Uuid,
    thread_id: Uuid,
    turn_id: Uuid,
}

const OUTBOX_LEASE_SECONDS: i64 = 30;
const RETRY_DELAY_SECONDS: i64 = 5;
const MAX_ASSISTANT_BYTES: usize = 1024 * 1024;
const MAX_REASONING_ITEMS: usize = 8;
const MAX_REASONING_PARTS: usize = 8;
const MAX_REASONING_PART_BYTES: usize = 64 * 1024;
const MAX_REASONING_ITEM_BYTES: usize = 128 * 1024;
const MAX_REASONING_TURN_BYTES: usize = 256 * 1024;
const PROGRESS_FLUSH_EVENT_COUNT: usize = 16;
const PROGRESS_FLUSH_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Clone)]
pub struct ConversationApplication {
    database: DatabaseWorker,
    host: Option<Arc<HostBridge>>,
    public_tasks: Option<Arc<dyn PublicTaskControlPlane>>,
    artifact_transfers: Option<ArtifactTransferService>,
    feat134_streaming_enabled: bool,
    feat136_streaming_enabled: bool,
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
    TurnFailedSafely {
        operation_id: Uuid,
        session_id: Uuid,
        turn_id: Uuid,
    },
    TurnReconciliationRequired {
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
    fn publish(&self, projection: LiveTurnProjection) -> Result<(), ChatError>;

    fn publish_feat134(&self, _projection: Feat134Projection) -> Result<(), ChatError> {
        Ok(())
    }

    fn publish_feat136(&self, _projection: Feat134Projection) -> Result<(), ChatError> {
        Ok(())
    }

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
pub enum ReducerOutcomeKind {
    Duplicate,
    Progress,
    Terminal,
}

pub enum ReducerOutcome {
    Duplicate,
    Progress,
    Terminal(TerminalTurnCommit),
}

impl ReducerOutcome {
    pub fn kind(&self) -> ReducerOutcomeKind {
        match self {
            Self::Duplicate => ReducerOutcomeKind::Duplicate,
            Self::Progress => ReducerOutcomeKind::Progress,
            Self::Terminal(_) => ReducerOutcomeKind::Terminal,
        }
    }
}

impl Debug for ReducerOutcome {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ReducerOutcome")
            .field("kind", &self.kind())
            .finish()
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
            feat134_streaming_enabled: false,
            feat136_streaming_enabled: false,
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
            feat134_streaming_enabled: false,
            feat136_streaming_enabled: false,
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
            feat134_streaming_enabled: true,
            feat136_streaming_enabled: false,
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
            feat134_streaming_enabled: true,
            feat136_streaming_enabled: true,
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
            feat134_streaming_enabled: true,
            feat136_streaming_enabled: true,
            feat137_streaming_enabled: true,
        }
    }

    pub fn new_offline(database: DatabaseWorker) -> Self {
        Self {
            database,
            host: None,
            public_tasks: None,
            artifact_transfers: None,
            feat134_streaming_enabled: false,
            feat136_streaming_enabled: false,
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
                    dispatch.agent_session_id,
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
                    Err(ChatError::NotFound) if self.feat134_streaming_enabled => {
                        return self
                            .finalize_failed_feat134_turn_dispatch(claimed.operation_id, now)
                            .await;
                    }
                    Err(ChatError::NotFound) => {
                        self.database.fail_outbox(claimed.operation_id).await?;
                        return Ok(DispatchOutcome::FailedSafely {
                            operation_id: claimed.operation_id,
                        });
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
                if self.feat134_streaming_enabled
                    && result.as_ref().is_err_and(|error| {
                        matches!(
                            error.kind(),
                            HostBridgeErrorKind::Transport
                                | HostBridgeErrorKind::AcceptedResponseInvalid
                        ) || error.code() == Some(HostErrorCode::SessionNotUsable)
                    })
                {
                    return self
                        .suspend_uncertain_feat134_turn_dispatch(&dispatch)
                        .await;
                }
                self.finish_turn_dispatch(
                    now,
                    2,
                    dispatch.operation_id,
                    dispatch.session_id,
                    dispatch.agent_session_id,
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
        agent_session_id: Uuid,
        result: Result<Uuid, HostBridgeError>,
    ) -> Result<DispatchOutcome, ChatError> {
        let runtime_turn_id = match result {
            Ok(turn_id) => turn_id,
            Err(error)
                if payload_version == 1 && error.code() == Some(HostErrorCode::TurnActive) =>
            {
                match self.host()?.get_session(agent_session_id).await {
                    Ok(session) if session.active_turn_id.is_some() => {
                        session.active_turn_id.expect("checked above")
                    }
                    _ => {
                        self.database.fail_outbox(operation_id).await?;
                        return Ok(DispatchOutcome::FailedSafely { operation_id });
                    }
                }
            }
            Err(error)
                if payload_version == 2
                    && !self.feat134_streaming_enabled
                    && matches!(
                        error.kind(),
                        HostBridgeErrorKind::Transport
                            | HostBridgeErrorKind::AcceptedResponseInvalid
                    ) =>
            {
                self.database
                    .reschedule_outbox(
                        operation_id,
                        now.checked_add(RETRY_DELAY_SECONDS)
                            .ok_or(ChatError::InvalidInput)?,
                    )
                    .await?;
                return Ok(DispatchOutcome::RetryScheduled { operation_id });
            }
            Err(_) if self.feat134_streaming_enabled && payload_version == 2 => {
                return self
                    .finalize_failed_feat134_turn_dispatch(operation_id, now)
                    .await;
            }
            Err(error) => {
                return self.handle_dispatch_error(operation_id, now, error).await;
            }
        };
        self.database
            .suspend_started_turn_retry(operation_id, runtime_turn_id)
            .await?;
        Ok(DispatchOutcome::TurnAccepted { session_id })
    }

    async fn suspend_uncertain_feat134_turn_dispatch(
        &self,
        dispatch: &StartTurnDispatchV2,
    ) -> Result<DispatchOutcome, ChatError> {
        self.database
            .suspend_uncertain_start_turn(dispatch.operation_id)
            .await?;
        Ok(DispatchOutcome::TurnReconciliationRequired {
            operation_id: dispatch.operation_id,
            session_id: dispatch.session_id,
            turn_id: dispatch.turn_id,
        })
    }

    async fn finalize_failed_feat134_turn_dispatch(
        &self,
        operation_id: Uuid,
        terminal_at: i64,
    ) -> Result<DispatchOutcome, ChatError> {
        let projection = self
            .database
            .finalize_failed_start_turn_dispatch(operation_id, terminal_at)
            .await?;
        Ok(DispatchOutcome::TurnFailedSafely {
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
                            .finalize_interrupted_without_stream(dispatch.operation_id, now)
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
        if self.feat134_streaming_enabled {
            let now = unix_seconds()?;
            if let Some(projection) = self
                .database
                .recover_next_failed_start_turn_projection(now)
                .await?
            {
                return Ok(CoordinatorOutcome::Dispatched(
                    DispatchOutcome::TurnFailedSafely {
                        operation_id: projection.operation_id,
                        session_id: projection.session_id,
                        turn_id: projection.turn_id,
                    },
                ));
            }
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

    pub async fn stream_active_turn_with_projection_sink(
        &self,
        session_id: Uuid,
        sink: &dyn TurnProjectionSink,
    ) -> Result<(), ChatError> {
        if self.feat134_streaming_enabled {
            let artifact_transfers = self
                .artifact_transfers
                .as_ref()
                .ok_or(ChatError::InvalidConfiguration)?;
            return if self.feat137_streaming_enabled {
                let turn_id = self.database.active_turn_context(session_id).await?.turn_id;
                match feat137_active_turn_stream_schema(
                    self.database
                        .turn_projection_schema_version(turn_id)
                        .await?,
                )? {
                    4 => {
                        self.stream_active_turn_v4(session_id, sink, artifact_transfers)
                            .await
                    }
                    5 => {
                        self.stream_active_turn_v5(session_id, sink, artifact_transfers)
                            .await
                    }
                    6 => {
                        self.stream_active_turn_v6(session_id, sink, artifact_transfers)
                            .await
                    }
                    _ => Err(ChatError::DatabaseUnavailable),
                }
            } else if self.feat136_streaming_enabled {
                let turn_id = self.database.active_turn_context(session_id).await?.turn_id;
                match feat136_active_turn_stream_schema(
                    self.database
                        .turn_projection_schema_version(turn_id)
                        .await?,
                )? {
                    4 => {
                        self.stream_active_turn_v4(session_id, sink, artifact_transfers)
                            .await
                    }
                    5 => {
                        self.stream_active_turn_v5(session_id, sink, artifact_transfers)
                            .await
                    }
                    _ => Err(ChatError::DatabaseUnavailable),
                }
            } else {
                self.stream_active_turn_v4(session_id, sink, artifact_transfers)
                    .await
            };
        }
        if let Some(artifact_transfers) = &self.artifact_transfers {
            return self
                .stream_active_turn_v3(session_id, sink, artifact_transfers)
                .await;
        }
        let mut context = self.database.active_turn_context(session_id).await?;
        let cursor = context
            .cursor
            .as_ref()
            .map(|cursor| HostEventCursor::new(cursor.stream_id, cursor.sequence))
            .transpose()
            .map_err(|_| ChatError::OrchestrationUnavailable)?;
        let host = self.host()?;
        let mut stream = match host
            .open_event_stream_v2(context.agent_session_id, cursor)
            .await
        {
            Ok(stream) => stream,
            Err(error)
                if cursor.is_some() && error.code() == Some(HostErrorCode::EventStreamChanged) =>
            {
                let stream = host
                    .open_event_stream_v2(context.agent_session_id, None)
                    .await
                    .map_err(map_host_error)?;
                let expected = context
                    .cursor
                    .take()
                    .ok_or(ChatError::ConversationConflict)?;
                self.database
                    .clear_event_cursor_after_stream_change(session_id, expected)
                    .await?;
                stream
            }
            Err(error) => return Err(map_host_error(error)),
        };
        let mut reducer = TurnEventReducer::new(context)?;
        let mut progress_dirty = false;
        let mut unflushed_events = 0_usize;
        let mut last_flush = Instant::now();
        loop {
            let event = match stream.next_event().await {
                Ok(Some(event)) => event,
                Ok(None) => {
                    if progress_dirty {
                        self.database
                            .persist_turn_progress(reducer.progress()?)
                            .await?;
                        sink.publish(reducer.projection(false)?)?;
                    }
                    return Err(ChatError::OrchestrationUnavailable);
                }
                Err(error) => {
                    if progress_dirty {
                        self.database
                            .persist_turn_progress(reducer.progress()?)
                            .await?;
                        sink.publish(reducer.projection(false)?)?;
                    }
                    return Err(map_host_error(error));
                }
            };
            match reducer.apply(event, unix_millis()?)? {
                ReducerOutcome::Duplicate => {}
                ReducerOutcome::Progress => {
                    progress_dirty = true;
                    unflushed_events += 1;
                    if unflushed_events >= PROGRESS_FLUSH_EVENT_COUNT
                        || last_flush.elapsed() >= PROGRESS_FLUSH_INTERVAL
                    {
                        self.database
                            .persist_turn_progress(reducer.progress()?)
                            .await?;
                        sink.publish(reducer.projection(false)?)?;
                        progress_dirty = false;
                        unflushed_events = 0;
                        last_flush = Instant::now();
                    }
                }
                ReducerOutcome::Terminal(terminal) => {
                    self.database.commit_terminal_turn(terminal).await?;
                    sink.publish(reducer.projection(true)?)?;
                    return Ok(());
                }
            }
        }
    }

    async fn stream_active_turn_v3(
        &self,
        session_id: Uuid,
        sink: &dyn TurnProjectionSink,
        artifact_transfers: &ArtifactTransferService,
    ) -> Result<(), ChatError> {
        artifact_transfers
            .recover_pending_acknowledgements()
            .await?;
        let mut context = self.database.active_turn_context(session_id).await?;
        let cursor = context
            .cursor
            .as_ref()
            .map(|cursor| HostEventCursor::new(cursor.stream_id, cursor.sequence))
            .transpose()
            .map_err(|_| ChatError::OrchestrationUnavailable)?;
        let host = self.host()?;
        let host_snapshot = host
            .get_session(context.agent_session_id)
            .await
            .map_err(map_host_error)?;
        if host_snapshot.task_id != context.task_id
            || host_snapshot.agent_session_id != context.agent_session_id
            || host_snapshot.codex_thread_id != Some(context.codex_thread_id)
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let replay_must_supply_terminal = matches!(
            host_snapshot.state,
            HostSessionState::Idle | HostSessionState::Failed
        ) && host_snapshot.active_turn_id.is_none();
        let mut stream = match host
            .open_event_stream_v3(context.agent_session_id, cursor)
            .await
        {
            Ok(stream) => stream,
            Err(error)
                if cursor.is_some() && error.code() == Some(HostErrorCode::EventStreamChanged) =>
            {
                let stream = host
                    .open_event_stream_v3(context.agent_session_id, None)
                    .await
                    .map_err(map_host_error)?;
                let expected = context
                    .cursor
                    .take()
                    .ok_or(ChatError::ConversationConflict)?;
                self.database
                    .clear_event_cursor_after_stream_change(session_id, expected)
                    .await?;
                sink.publish_artifact_resync_required(
                    session_id,
                    context.turn_id,
                    ArtifactResyncReason::SequenceGap,
                )?;
                stream
            }
            Err(error) => return Err(map_host_error(error)),
        };
        let mut reducer = TurnEventReducer::new(context)?;
        let mut progress_dirty = false;
        let mut unflushed_events = 0_usize;
        let mut last_flush = Instant::now();
        loop {
            let next_event = if replay_must_supply_terminal {
                match tokio::time::timeout(
                    ORPHANED_TERMINAL_REPLAY_GRACE,
                    stream.next_stream_event(),
                )
                .await
                {
                    Ok(result) => result,
                    Err(_) => {
                        if progress_dirty {
                            self.database
                                .persist_turn_progress(reducer.progress()?)
                                .await?;
                            sink.publish(reducer.projection(false)?)?;
                        }
                        self.database
                            .finalize_orphaned_turn_without_stream(
                                reducer.session_id,
                                reducer.local_turn_id,
                                reducer.runtime_turn_id,
                                unix_seconds()?,
                            )
                            .await?;
                        sink.publish_artifact_resync_required(
                            reducer.session_id,
                            reducer.local_turn_id,
                            ArtifactResyncReason::ProtocolError,
                        )?;
                        return Ok(());
                    }
                }
            } else {
                stream.next_stream_event().await
            };
            let event = match next_event {
                Ok(Some(event)) => event,
                Ok(None) => {
                    if progress_dirty {
                        self.database
                            .persist_turn_progress(reducer.progress()?)
                            .await?;
                        sink.publish(reducer.projection(false)?)?;
                    }
                    return Err(ChatError::OrchestrationUnavailable);
                }
                Err(error) => {
                    if progress_dirty {
                        self.database
                            .persist_turn_progress(reducer.progress()?)
                            .await?;
                        sink.publish(reducer.projection(false)?)?;
                    }
                    sink.publish_artifact_resync_required(
                        session_id,
                        reducer.local_turn_id,
                        ArtifactResyncReason::ProtocolError,
                    )?;
                    return Err(map_host_error(error));
                }
            };
            match event {
                HostStreamEvent::Ordinary(event) => {
                    let resync_reason = reducer.resync_reason(event.cursor, event.event_id);
                    let reduced = reducer.apply(event, unix_millis()?).inspect_err(|_| {
                        let _ = sink.publish_artifact_resync_required(
                            session_id,
                            reducer.local_turn_id,
                            resync_reason,
                        );
                    })?;
                    match reduced {
                        ReducerOutcome::Duplicate => {}
                        ReducerOutcome::Progress => {
                            progress_dirty = true;
                            unflushed_events += 1;
                            if unflushed_events >= PROGRESS_FLUSH_EVENT_COUNT
                                || last_flush.elapsed() >= PROGRESS_FLUSH_INTERVAL
                            {
                                self.database
                                    .persist_turn_progress(reducer.progress()?)
                                    .await?;
                                sink.publish(reducer.projection(false)?)?;
                                progress_dirty = false;
                                unflushed_events = 0;
                                last_flush = Instant::now();
                            }
                        }
                        ReducerOutcome::Terminal(terminal) => {
                            self.database.commit_terminal_turn(terminal).await?;
                            sink.publish(reducer.projection(true)?)?;
                            return Ok(());
                        }
                    }
                }
                HostStreamEvent::Artifact(envelope) => {
                    let artifact = decode_artifact_event_envelope_v3(
                        &envelope,
                        reducer.agent_session_id,
                        reducer.runtime_turn_id,
                        reducer.session_id,
                        reducer.local_turn_id,
                    )
                    .inspect_err(|_| {
                        let _ = sink.publish_artifact_resync_required(
                            session_id,
                            reducer.local_turn_id,
                            ArtifactResyncReason::ProtocolError,
                        );
                    })?;
                    if matches!(artifact, ArtifactEventV3::Completed(_)) && progress_dirty {
                        self.database
                            .persist_turn_progress(reducer.progress()?)
                            .await?;
                        sink.publish(reducer.projection(false)?)?;
                        progress_dirty = false;
                        unflushed_events = 0;
                        last_flush = Instant::now();
                    }
                    let resync_reason = reducer.resync_reason(envelope.cursor, envelope.event_id);
                    let observed = reducer.observe_artifact(&envelope).inspect_err(|_| {
                        let _ = sink.publish_artifact_resync_required(
                            session_id,
                            reducer.local_turn_id,
                            resync_reason,
                        );
                    })?;
                    match observed {
                        ReducerOutcome::Duplicate => continue,
                        ReducerOutcome::Terminal(_) => return Err(ChatError::ConversationConflict),
                        ReducerOutcome::Progress => {}
                    }
                    let cursor_progress = reducer.progress()?;
                    #[cfg(feature = "feat128-s10-runtime")]
                    let runtime_transition = match &artifact {
                        ArtifactEventV3::Started(identity) => (
                            identity.artifact_id,
                            identity.kind,
                            identity.ordinal,
                            Feat128S10dArtifactStage::Announced,
                        ),
                        ArtifactEventV3::Progress { identity, .. } => (
                            identity.artifact_id,
                            identity.kind,
                            identity.ordinal,
                            Feat128S10dArtifactStage::Progress,
                        ),
                        ArtifactEventV3::Completed(manifest) => (
                            manifest.artifact_id,
                            manifest.kind,
                            manifest.ordinal,
                            Feat128S10dArtifactStage::Ready,
                        ),
                        ArtifactEventV3::Failed { .. } => {
                            return Err(ChatError::ConversationConflict)
                        }
                    };
                    match artifact {
                        ArtifactEventV3::Completed(manifest) => {
                            if let Err(error) = artifact_transfers
                                .transfer_completed_with_cursor(manifest, cursor_progress)
                                .await
                            {
                                sink.publish_artifact_changed(
                                    session_id,
                                    reducer.local_turn_id,
                                    envelope.event_id,
                                )?;
                                return Err(error);
                            }
                        }
                        artifact => {
                            self.database
                                .commit_artifact_event_progress(cursor_progress, artifact)
                                .await?;
                        }
                    }
                    #[cfg(feature = "feat128-s10-runtime")]
                    feat128_s10d_record_native_artifact(
                        runtime_transition.0,
                        runtime_transition.1,
                        runtime_transition.2,
                        runtime_transition.3,
                    )
                    .map_err(|_| ChatError::ConversationConflict)?;
                    if progress_dirty {
                        sink.publish(reducer.projection(false)?)?;
                    }
                    progress_dirty = false;
                    unflushed_events = 0;
                    last_flush = Instant::now();
                    sink.publish_artifact_changed(
                        session_id,
                        reducer.local_turn_id,
                        envelope.event_id,
                    )?;
                }
            }
        }
    }

    /// Reduces one ordinary Host v4 event and commits the resulting private projection before it
    /// can be published. A Desktop projection limit is closed atomically from the confirmed
    /// durable prefix; the offending text never crosses this application boundary into storage.
    async fn reduce_and_persist_feat134_event(
        &self,
        reducer: &mut Feat134TurnReducer,
        event: HostEvent,
        observed_at_ms: i64,
    ) -> Result<Option<(Feat134Projection, bool)>, ChatError> {
        let mut failure = Feat134ProjectionFailure {
            session_id: reducer.session_id(),
            turn_id: reducer.local_turn_id(),
            cursor: StoredEventCursor {
                stream_id: event.cursor.stream_id,
                sequence: event.cursor.sequence,
                event_id: event.event_id,
            },
            source_event_type: event.event_type.clone(),
            source_turn_id: event.turn_id,
            source_occurred_at: event.occurred_at.clone(),
            source_event_bytes: event.encoded_bytes,
            observed_at_ms,
            kind: Feat134ProjectionFailureKind::LimitExceeded,
        };
        let projection = match reducer.apply(event, observed_at_ms) {
            Ok(None) => return Ok(None),
            Err(ChatError::ProjectionLimitExceeded) => {
                return self
                    .database
                    .commit_feat134_projection_failure(failure)
                    .await
                    .map(|projection| Some((projection, true)));
            }
            Err(ChatError::ProjectionReconciliationFailed) => {
                failure.kind = Feat134ProjectionFailureKind::ProtocolConflict;
                return self
                    .database
                    .commit_feat134_projection_failure(failure)
                    .await
                    .map(|projection| Some((projection, true)));
            }
            Err(error) => return Err(error),
            Ok(Some(projection)) => projection,
        };
        if feat134_projection_requires_limit_terminal(&projection)? {
            // This is a Desktop-derived terminal, not a Host terminal fact. The DB atomically
            // consumes the offending cursor while retaining only the confirmed prefix, preventing
            // an infinite replay of the event.
            return self
                .database
                .commit_feat134_projection_failure(failure)
                .await
                .map(|projection| Some((projection, true)));
        }
        let mut projection = projection;
        let persisted = if projection.terminal.is_some() {
            self.database
                .commit_feat134_terminal(projection.clone())
                .await
        } else {
            self.database
                .persist_feat134_projection(projection.clone())
                .await
        };
        let durable_sequence = match persisted {
            Ok(durable_sequence) => durable_sequence,
            Err(ChatError::ProjectionLimitExceeded) => {
                return self
                    .database
                    .commit_feat134_projection_failure(failure)
                    .await
                    .map(|projection| Some((projection, true)));
            }
            Err(error) => return Err(error),
        };
        projection.durable_sequence = Some(durable_sequence);
        Ok(Some((projection, false)))
    }

    async fn reduce_and_persist_feat136_event(
        &self,
        reducer: &mut Feat136TurnReducer,
        event: HostEvent,
        observed_at_ms: i64,
    ) -> Result<Option<(Feat134Projection, bool)>, ChatError> {
        let mut failure = Feat134ProjectionFailure {
            session_id: reducer.session_id(),
            turn_id: reducer.local_turn_id(),
            cursor: StoredEventCursor {
                stream_id: event.cursor.stream_id,
                sequence: event.cursor.sequence,
                event_id: event.event_id,
            },
            source_event_type: event.event_type.clone(),
            source_turn_id: event.turn_id,
            source_occurred_at: event.occurred_at.clone(),
            source_event_bytes: event.encoded_bytes,
            observed_at_ms,
            kind: Feat134ProjectionFailureKind::LimitExceeded,
        };
        let projection = match reducer.apply(event, observed_at_ms) {
            Ok(None) => return Ok(None),
            Err(ChatError::ProjectionLimitExceeded) => {
                return self
                    .database
                    .commit_feat136_projection_failure(failure)
                    .await
                    .map(|projection| Some((projection, true)));
            }
            Err(ChatError::ProjectionReconciliationFailed) => {
                failure.kind = Feat134ProjectionFailureKind::ProtocolConflict;
                return self
                    .database
                    .commit_feat136_projection_failure(failure)
                    .await
                    .map(|projection| Some((projection, true)));
            }
            Err(error) => return Err(error),
            Ok(Some(projection)) => projection,
        };
        if feat134_projection_requires_limit_terminal(&projection)? {
            return self
                .database
                .commit_feat136_projection_failure(failure)
                .await
                .map(|projection| Some((projection, true)));
        }
        let mut projection = projection;
        let persisted = if projection.terminal.is_some() {
            self.database
                .commit_feat136_terminal(projection.clone())
                .await
        } else {
            self.database
                .persist_feat136_projection(projection.clone())
                .await
        };
        let durable_sequence = match persisted {
            Ok(durable_sequence) => durable_sequence,
            Err(ChatError::ProjectionLimitExceeded) => {
                return self
                    .database
                    .commit_feat136_projection_failure(failure)
                    .await
                    .map(|projection| Some((projection, true)));
            }
            Err(error) => return Err(error),
        };
        projection.durable_sequence = Some(durable_sequence);
        Ok(Some((projection, false)))
    }

    async fn reduce_and_persist_feat137_event(
        &self,
        reducer: &mut Feat136TurnReducer,
        event: HostEvent,
        approval: Option<ApprovalProjection>,
        observed_at_ms: i64,
    ) -> Result<Option<(Feat134Projection, Option<ApprovalProjection>, bool)>, ChatError> {
        let mut failure = Feat134ProjectionFailure {
            session_id: reducer.session_id(),
            turn_id: reducer.local_turn_id(),
            cursor: StoredEventCursor {
                stream_id: event.cursor.stream_id,
                sequence: event.cursor.sequence,
                event_id: event.event_id,
            },
            source_event_type: event.event_type.clone(),
            source_turn_id: event.turn_id,
            source_occurred_at: event.occurred_at.clone(),
            source_event_bytes: event.encoded_bytes,
            observed_at_ms,
            kind: Feat134ProjectionFailureKind::LimitExceeded,
        };
        let projection = match reducer.apply(event, observed_at_ms) {
            Ok(None) => return Ok(None),
            Err(ChatError::ProjectionLimitExceeded) => {
                return self
                    .database
                    .commit_feat137_projection_failure(failure)
                    .await
                    .map(|projection| Some((projection, None, true)));
            }
            Err(ChatError::ProjectionReconciliationFailed) => {
                failure.kind = Feat134ProjectionFailureKind::ProtocolConflict;
                return self
                    .database
                    .commit_feat137_projection_failure(failure)
                    .await
                    .map(|projection| Some((projection, None, true)));
            }
            Err(error) => return Err(error),
            Ok(Some(projection)) => projection,
        };
        let projection = protect_process_projection(projection)?;
        if feat134_projection_requires_limit_terminal(&projection)? {
            return self
                .database
                .commit_feat137_projection_failure(failure)
                .await
                .map(|projection| Some((projection, None, true)));
        }
        let mut projection = projection;
        let persisted = if projection.terminal.is_some() {
            if approval.is_some() {
                return Err(ChatError::OrchestrationUnavailable);
            }
            self.database
                .commit_feat137_terminal(projection.clone())
                .await
        } else {
            self.database
                .persist_feat137_projection(projection.clone(), approval.clone())
                .await
        };
        let durable_sequence = match persisted {
            Ok(durable_sequence) => durable_sequence,
            Err(ChatError::ProjectionLimitExceeded) => {
                return self
                    .database
                    .commit_feat137_projection_failure(failure)
                    .await
                    .map(|projection| Some((projection, None, true)));
            }
            Err(error) => return Err(error),
        };
        projection.durable_sequence = Some(durable_sequence);
        let approval = approval
            .map(|approval| approval.with_durable_sequence(durable_sequence))
            .transpose()?;
        Ok(Some((projection, approval, false)))
    }

    async fn stream_active_turn_v4(
        &self,
        session_id: Uuid,
        sink: &dyn TurnProjectionSink,
        artifact_transfers: &ArtifactTransferService,
    ) -> Result<(), ChatError> {
        artifact_transfers
            .recover_pending_acknowledgements()
            .await?;
        let mut context = self.database.active_turn_context(session_id).await?;
        let hydration = self
            .database
            .load_feat134_hydration(context.turn_id)
            .await?;
        let cursor = context
            .cursor
            .as_ref()
            .map(|cursor| HostEventCursor::new(cursor.stream_id, cursor.sequence))
            .transpose()
            .map_err(|_| ChatError::OrchestrationUnavailable)?;
        let agent_session_id = context.agent_session_id;
        let runtime_turn_id = context.runtime_turn_id;
        let host = self.host()?;
        let host_snapshot = host
            .get_session(context.agent_session_id)
            .await
            .map_err(map_host_error)?;
        if host_snapshot.task_id != context.task_id
            || host_snapshot.agent_session_id != context.agent_session_id
            || host_snapshot.codex_thread_id != Some(context.codex_thread_id)
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let replay_must_supply_terminal = matches!(
            host_snapshot.state,
            HostSessionState::Idle | HostSessionState::Failed
        ) && host_snapshot.active_turn_id.is_none();
        let mut stream = match host
            .open_event_stream_v4(context.agent_session_id, cursor)
            .await
        {
            Ok(stream) => stream,
            Err(error)
                if cursor.is_some() && error.code() == Some(HostErrorCode::EventStreamChanged) =>
            {
                let stream = host
                    .open_event_stream_v4(context.agent_session_id, None)
                    .await
                    .map_err(map_host_error)?;
                let expected = context
                    .cursor
                    .take()
                    .ok_or(ChatError::ConversationConflict)?;
                self.database
                    .reset_feat134_after_stream_change(session_id, context.turn_id, expected)
                    .await?;
                sink.publish_artifact_resync_required(
                    session_id,
                    context.turn_id,
                    ArtifactResyncReason::SequenceGap,
                )?;
                stream
            }
            Err(error) => return Err(map_host_error(error)),
        };
        let hydration = if context.cursor.is_some() {
            Some(hydration)
        } else {
            None
        };
        let mut reducer = Feat134TurnReducer::new(context, hydration)?;
        loop {
            let next_event = if replay_must_supply_terminal {
                match tokio::time::timeout(
                    ORPHANED_TERMINAL_REPLAY_GRACE,
                    stream.next_stream_event(),
                )
                .await
                {
                    Ok(result) => result,
                    Err(_) => {
                        self.database
                            .finalize_orphaned_turn_without_stream(
                                reducer.session_id(),
                                reducer.local_turn_id(),
                                reducer.runtime_turn_id(),
                                unix_seconds()?,
                            )
                            .await?;
                        sink.publish_artifact_resync_required(
                            reducer.session_id(),
                            reducer.local_turn_id(),
                            ArtifactResyncReason::ProtocolError,
                        )?;
                        return Ok(());
                    }
                }
            } else {
                stream.next_stream_event().await
            };
            let event = next_event.map_err(map_host_error)?.ok_or_else(|| {
                let _ = sink.publish_artifact_resync_required(
                    session_id,
                    reducer.local_turn_id(),
                    ArtifactResyncReason::ProtocolError,
                );
                ChatError::OrchestrationUnavailable
            })?;
            match event {
                HostStreamEvent::Ordinary(event) => {
                    let resync_reason = reducer.resync_reason(event.cursor, event.event_id);
                    let observed_at_ms = unix_millis()?;
                    let (projection, projection_limit) = match self
                        .reduce_and_persist_feat134_event(&mut reducer, event, observed_at_ms)
                        .await
                    {
                        Ok(None) => continue,
                        Ok(Some(result)) => result,
                        Err(error) => {
                            let _ = sink.publish_artifact_resync_required(
                                session_id,
                                reducer.local_turn_id(),
                                resync_reason,
                            );
                            return Err(error);
                        }
                    };
                    sink.publish_feat134(projection.clone())?;
                    sink.publish(feat134_legacy_projection(&projection))?;
                    if projection.terminal.is_some() {
                        if projection_limit {
                            // Best-effort normal Host control; local fail-closed state is already
                            // durable and never depends on this request succeeding.
                            let _ = host
                                .interrupt_turn(
                                    agent_session_id,
                                    runtime_turn_id,
                                    &HostTrace {
                                        request_id: Some(projection.cursor.event_id),
                                        ..HostTrace::default()
                                    },
                                )
                                .await;
                        }
                        return Ok(());
                    }
                }
                HostStreamEvent::Artifact(envelope) => {
                    let artifact = decode_artifact_event_envelope_v3(
                        &envelope,
                        reducer.agent_session_id(),
                        reducer.runtime_turn_id(),
                        reducer.session_id(),
                        reducer.local_turn_id(),
                    )
                    .inspect_err(|_| {
                        let _ = sink.publish_artifact_resync_required(
                            session_id,
                            reducer.local_turn_id(),
                            ArtifactResyncReason::ProtocolError,
                        );
                    })?;
                    let resync_reason = reducer.resync_reason(envelope.cursor, envelope.event_id);
                    if !reducer.observe_artifact(&envelope).inspect_err(|_| {
                        let _ = sink.publish_artifact_resync_required(
                            session_id,
                            reducer.local_turn_id(),
                            resync_reason,
                        );
                    })? {
                        continue;
                    }
                    let cursor_progress = reducer.progress()?;
                    #[cfg(feature = "feat128-s10-runtime")]
                    let runtime_transition = match &artifact {
                        ArtifactEventV3::Started(identity) => (
                            identity.artifact_id,
                            identity.kind,
                            identity.ordinal,
                            Feat128S10dArtifactStage::Announced,
                        ),
                        ArtifactEventV3::Progress { identity, .. } => (
                            identity.artifact_id,
                            identity.kind,
                            identity.ordinal,
                            Feat128S10dArtifactStage::Progress,
                        ),
                        ArtifactEventV3::Completed(manifest) => (
                            manifest.artifact_id,
                            manifest.kind,
                            manifest.ordinal,
                            Feat128S10dArtifactStage::Ready,
                        ),
                        ArtifactEventV3::Failed { .. } => {
                            return Err(ChatError::ConversationConflict)
                        }
                    };
                    match artifact {
                        ArtifactEventV3::Completed(manifest) => {
                            artifact_transfers
                                .transfer_completed_with_cursor(manifest, cursor_progress)
                                .await?;
                        }
                        artifact => {
                            self.database
                                .commit_artifact_event_progress(cursor_progress, artifact)
                                .await?;
                        }
                    }
                    #[cfg(feature = "feat128-s10-runtime")]
                    feat128_s10d_record_native_artifact(
                        runtime_transition.0,
                        runtime_transition.1,
                        runtime_transition.2,
                        runtime_transition.3,
                    )
                    .map_err(|_| ChatError::ConversationConflict)?;
                    sink.publish_artifact_changed(
                        session_id,
                        reducer.local_turn_id(),
                        envelope.event_id,
                    )?;
                }
            }
        }
    }

    async fn stream_active_turn_v5(
        &self,
        session_id: Uuid,
        sink: &dyn TurnProjectionSink,
        artifact_transfers: &ArtifactTransferService,
    ) -> Result<(), ChatError> {
        self.stream_active_turn_v5_or_v6(session_id, sink, artifact_transfers, 5)
            .await
    }

    async fn stream_active_turn_v6(
        &self,
        session_id: Uuid,
        sink: &dyn TurnProjectionSink,
        artifact_transfers: &ArtifactTransferService,
    ) -> Result<(), ChatError> {
        self.stream_active_turn_v5_or_v6(session_id, sink, artifact_transfers, 6)
            .await
    }

    async fn stream_active_turn_v5_or_v6(
        &self,
        session_id: Uuid,
        sink: &dyn TurnProjectionSink,
        artifact_transfers: &ArtifactTransferService,
        schema_version: u8,
    ) -> Result<(), ChatError> {
        if !matches!(schema_version, 5 | 6) {
            return Err(ChatError::InvalidConfiguration);
        }
        artifact_transfers
            .recover_pending_acknowledgements()
            .await?;
        let mut context = self.database.active_turn_context(session_id).await?;
        let hydration = if schema_version == 6 {
            self.database
                .load_feat137_hydration(context.turn_id)
                .await?
        } else {
            self.database
                .load_feat136_hydration(context.turn_id)
                .await?
        };
        let cursor = context
            .cursor
            .as_ref()
            .map(|cursor| HostEventCursor::new(cursor.stream_id, cursor.sequence))
            .transpose()
            .map_err(|_| ChatError::OrchestrationUnavailable)?;
        let agent_session_id = context.agent_session_id;
        let runtime_turn_id = context.runtime_turn_id;
        let host = self.host()?;
        let host_snapshot = host
            .get_session(context.agent_session_id)
            .await
            .map_err(map_host_error)?;
        if host_snapshot.task_id != context.task_id
            || host_snapshot.agent_session_id != context.agent_session_id
            || host_snapshot.codex_thread_id != Some(context.codex_thread_id)
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let replay_must_supply_terminal = matches!(
            host_snapshot.state,
            HostSessionState::Idle | HostSessionState::Failed
        ) && host_snapshot.active_turn_id.is_none();
        let open_stream = async {
            if schema_version == 6 {
                host.open_event_stream_v6(context.agent_session_id, cursor)
                    .await
            } else {
                host.open_event_stream_v5(context.agent_session_id, cursor)
                    .await
            }
        };
        let mut stream = match open_stream.await {
            Ok(stream) => stream,
            Err(error)
                if cursor.is_some() && error.code() == Some(HostErrorCode::EventStreamChanged) =>
            {
                let stream = if schema_version == 6 {
                    host.open_event_stream_v6(context.agent_session_id, None)
                        .await
                } else {
                    host.open_event_stream_v5(context.agent_session_id, None)
                        .await
                }
                .map_err(map_host_error)?;
                let expected = context
                    .cursor
                    .take()
                    .ok_or(ChatError::ConversationConflict)?;
                self.database
                    .reset_feat134_after_stream_change(session_id, context.turn_id, expected)
                    .await?;
                sink.publish_artifact_resync_required(
                    session_id,
                    context.turn_id,
                    ArtifactResyncReason::SequenceGap,
                )?;
                stream
            }
            Err(error) => return Err(map_host_error(error)),
        };
        let hydration = if context.cursor.is_some() {
            Some(hydration)
        } else {
            None
        };
        let mut reducer = Feat136TurnReducer::new(context, hydration)?;
        loop {
            let next_event = if replay_must_supply_terminal {
                match tokio::time::timeout(
                    ORPHANED_TERMINAL_REPLAY_GRACE,
                    stream.next_stream_event(),
                )
                .await
                {
                    Ok(result) => result,
                    Err(_) => {
                        self.database
                            .finalize_orphaned_turn_without_stream(
                                reducer.session_id(),
                                reducer.local_turn_id(),
                                reducer.runtime_turn_id(),
                                unix_seconds()?,
                            )
                            .await?;
                        sink.publish_artifact_resync_required(
                            reducer.session_id(),
                            reducer.local_turn_id(),
                            ArtifactResyncReason::ProtocolError,
                        )?;
                        return Ok(());
                    }
                }
            } else {
                stream.next_stream_event().await
            };
            let event = feat136_stream_event_or_resync(
                next_event,
                sink,
                session_id,
                reducer.local_turn_id(),
            )?;
            match event {
                HostStreamEvent::Ordinary(event) => {
                    let observed_cursor = StoredEventCursor {
                        stream_id: event.cursor.stream_id,
                        sequence: event.cursor.sequence,
                        event_id: event.event_id,
                    };
                    match self
                        .database
                        .classify_feat136_observed_event(
                            session_id,
                            reducer.local_turn_id(),
                            observed_cursor,
                            event.event_type.clone(),
                            event.turn_id.is_some(),
                        )
                        .await?
                    {
                        Feat136ObservedEventDisposition::Duplicate => continue,
                        Feat136ObservedEventDisposition::Conflict => {
                            sink.publish_artifact_resync_required(
                                session_id,
                                reducer.local_turn_id(),
                                ArtifactResyncReason::ProtocolError,
                            )?;
                            return Err(ChatError::OrchestrationUnavailable);
                        }
                        Feat136ObservedEventDisposition::New => {}
                    }
                    let resync_reason = reducer.resync_reason(event.cursor, event.event_id);
                    let observed_at_ms = unix_millis()?;
                    let approval = if schema_version == 6 {
                        ApprovalProjection::from_event(
                            &event,
                            session_id,
                            reducer.local_turn_id(),
                            reducer.runtime_turn_id(),
                        )?
                    } else {
                        None
                    };
                    let (projection, approval, projection_limit) = if schema_version == 6 {
                        match self
                            .reduce_and_persist_feat137_event(
                                &mut reducer,
                                event,
                                approval,
                                observed_at_ms,
                            )
                            .await
                        {
                            Ok(None) => continue,
                            Ok(Some(result)) => result,
                            Err(error) => {
                                let _ = sink.publish_artifact_resync_required(
                                    session_id,
                                    reducer.local_turn_id(),
                                    resync_reason,
                                );
                                return Err(error);
                            }
                        }
                    } else {
                        match self
                            .reduce_and_persist_feat136_event(&mut reducer, event, observed_at_ms)
                            .await
                        {
                            Ok(None) => continue,
                            Ok(Some((projection, projection_limit))) => {
                                (projection, None, projection_limit)
                            }
                            Err(error) => {
                                let _ = sink.publish_artifact_resync_required(
                                    session_id,
                                    reducer.local_turn_id(),
                                    resync_reason,
                                );
                                return Err(error);
                            }
                        }
                    };
                    if schema_version == 6 {
                        sink.publish_feat137(projection.clone(), approval)?;
                    } else {
                        sink.publish_feat136(projection.clone())?;
                    }
                    sink.publish(feat134_legacy_projection(&projection))?;
                    if projection.terminal.is_some() {
                        if projection_limit {
                            // Best-effort normal Host control; local fail-closed state is already
                            // durable and never depends on this request succeeding.
                            let _ = host
                                .interrupt_turn(
                                    agent_session_id,
                                    runtime_turn_id,
                                    &HostTrace {
                                        request_id: Some(projection.cursor.event_id),
                                        ..HostTrace::default()
                                    },
                                )
                                .await;
                        }
                        return Ok(());
                    }
                }
                HostStreamEvent::Artifact(envelope) => {
                    let artifact = decode_artifact_event_envelope_v3(
                        &envelope,
                        reducer.agent_session_id(),
                        reducer.runtime_turn_id(),
                        reducer.session_id(),
                        reducer.local_turn_id(),
                    )
                    .inspect_err(|_| {
                        let _ = sink.publish_artifact_resync_required(
                            session_id,
                            reducer.local_turn_id(),
                            ArtifactResyncReason::ProtocolError,
                        );
                    })?;
                    let resync_reason = reducer.resync_reason(envelope.cursor, envelope.event_id);
                    if !reducer.observe_artifact(&envelope).inspect_err(|_| {
                        let _ = sink.publish_artifact_resync_required(
                            session_id,
                            reducer.local_turn_id(),
                            resync_reason,
                        );
                    })? {
                        continue;
                    }
                    let cursor_progress = reducer.progress()?;
                    #[cfg(feature = "feat128-s10-runtime")]
                    let runtime_transition = match &artifact {
                        ArtifactEventV3::Started(identity) => (
                            identity.artifact_id,
                            identity.kind,
                            identity.ordinal,
                            Feat128S10dArtifactStage::Announced,
                        ),
                        ArtifactEventV3::Progress { identity, .. } => (
                            identity.artifact_id,
                            identity.kind,
                            identity.ordinal,
                            Feat128S10dArtifactStage::Progress,
                        ),
                        ArtifactEventV3::Completed(manifest) => (
                            manifest.artifact_id,
                            manifest.kind,
                            manifest.ordinal,
                            Feat128S10dArtifactStage::Ready,
                        ),
                        ArtifactEventV3::Failed { .. } => {
                            return Err(ChatError::ConversationConflict)
                        }
                    };
                    match artifact {
                        ArtifactEventV3::Completed(manifest) => {
                            artifact_transfers
                                .transfer_completed_with_cursor(manifest, cursor_progress)
                                .await?;
                        }
                        artifact => {
                            self.database
                                .commit_artifact_event_progress(cursor_progress, artifact)
                                .await?;
                        }
                    }
                    #[cfg(feature = "feat128-s10-runtime")]
                    feat128_s10d_record_native_artifact(
                        runtime_transition.0,
                        runtime_transition.1,
                        runtime_transition.2,
                        runtime_transition.3,
                    )
                    .map_err(|_| ChatError::ConversationConflict)?;
                    sink.publish_artifact_changed(
                        session_id,
                        reducer.local_turn_id(),
                        envelope.event_id,
                    )?;
                }
            }
        }
    }
}

fn feat134_legacy_projection(projection: &Feat134Projection) -> LiveTurnProjection {
    let reasoning = projection
        .items
        .iter()
        .filter(|item| item.item_type == "reasoning")
        .map(|item| LiveReasoningProjection {
            item_id: item.item_id.clone(),
            status: item.reasoning_status.map(|status| match status {
                TimelineReasoningStatus::Complete => ReasoningStatus::Complete,
                TimelineReasoningStatus::Incomplete => ReasoningStatus::Incomplete,
                TimelineReasoningStatus::Unavailable => ReasoningStatus::Unavailable,
            }),
            parts: item
                .reasoning_parts
                .iter()
                .map(|part| ReasoningPart {
                    content_index: part.content_index,
                    text: part.text.clone(),
                })
                .collect(),
        })
        .collect();
    LiveTurnProjection {
        session_id: projection.session_id,
        turn_id: projection.turn_id,
        assistant_text: projection.assistant_text.clone(),
        reasoning,
        terminal: projection.terminal.is_some(),
        terminal_status: projection
            .terminal
            .as_ref()
            .map(|terminal| terminal.status.to_owned()),
    }
}

struct ReasoningAccumulator {
    item_id: String,
    item_ordinal: usize,
    parts: Vec<String>,
    finalized: Option<FinalizedReasoning>,
    finalized_at_ms: i64,
}

struct FinalizedReasoning {
    status: ReasoningStatus,
    reason_code: Option<String>,
    parts: Vec<ReasoningPart>,
}

pub struct TurnEventReducer {
    session_id: Uuid,
    local_turn_id: Uuid,
    task_id: Uuid,
    agent_session_id: Uuid,
    codex_thread_id: Uuid,
    runtime_turn_id: Uuid,
    expected_stream: Option<Uuid>,
    last_sequence: u64,
    last_event_id: Option<Uuid>,
    assistant_item_id: Option<String>,
    assistant_text: String,
    reasoning: Vec<ReasoningAccumulator>,
    terminal: bool,
    terminal_status: Option<String>,
}

impl Debug for TurnEventReducer {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TurnEventReducer")
            .field("session_id", &self.session_id)
            .field("local_turn_id", &self.local_turn_id)
            .field("task_id", &self.task_id)
            .field("agent_session_id", &self.agent_session_id)
            .field("codex_thread_id", &self.codex_thread_id)
            .field("runtime_turn_id", &self.runtime_turn_id)
            .field("expected_stream", &self.expected_stream)
            .field("last_sequence", &self.last_sequence)
            .field("assistant_utf8_bytes", &self.assistant_text.len())
            .field("reasoning_item_count", &self.reasoning.len())
            .field("terminal", &self.terminal)
            .finish()
    }
}

impl TurnEventReducer {
    pub fn new(context: ActiveTurnContext) -> Result<Self, ChatError> {
        if context.assistant_text.len() > MAX_ASSISTANT_BYTES
            || context.assistant_text.contains('\0')
        {
            return Err(ChatError::DatabaseUnavailable);
        }
        let (expected_stream, last_sequence, last_event_id) = match context.cursor {
            Some(cursor) => (
                Some(cursor.stream_id),
                cursor.sequence,
                Some(cursor.event_id),
            ),
            None => (None, 0, None),
        };
        Ok(Self {
            session_id: context.session_id,
            local_turn_id: context.turn_id,
            task_id: context.task_id,
            agent_session_id: context.agent_session_id,
            codex_thread_id: context.codex_thread_id,
            runtime_turn_id: context.runtime_turn_id,
            expected_stream,
            last_sequence,
            last_event_id,
            assistant_item_id: None,
            assistant_text: context.assistant_text,
            reasoning: Vec::new(),
            terminal: false,
            terminal_status: None,
        })
    }

    pub fn apply(
        &mut self,
        event: HostEvent,
        observed_at_ms: i64,
    ) -> Result<ReducerOutcome, ChatError> {
        if observed_at_ms < 0 || self.terminal {
            return Err(ChatError::ConversationConflict);
        }
        if event.task_id != self.task_id
            || event.agent_session_id != self.agent_session_id
            || event.codex_thread_id != self.codex_thread_id
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        if event.cursor.sequence == self.last_sequence
            && self.last_event_id == Some(event.event_id)
            && self.expected_stream == Some(event.cursor.stream_id)
        {
            return Ok(ReducerOutcome::Duplicate);
        }
        let expected_sequence = self
            .last_sequence
            .checked_add(1)
            .ok_or(ChatError::OrchestrationUnavailable)?;
        if event.cursor.sequence != expected_sequence
            || self
                .expected_stream
                .is_some_and(|stream| stream != event.cursor.stream_id)
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        if requires_current_turn(&event.kind) && event.turn_id != Some(self.runtime_turn_id) {
            return Err(ChatError::OrchestrationUnavailable);
        }
        match event.kind {
            HostEventKind::AgentMessageDelta { delta } => {
                self.bind_assistant_item(event.item_id)?;
                let new_len = self
                    .assistant_text
                    .len()
                    .checked_add(delta.len())
                    .ok_or(ChatError::OrchestrationUnavailable)?;
                if new_len > MAX_ASSISTANT_BYTES || delta.contains('\0') {
                    return Err(ChatError::OrchestrationUnavailable);
                }
                self.assistant_text.push_str(&delta);
            }
            HostEventKind::ItemCompleted {
                item_type, text, ..
            } if item_type == "agent_message" => {
                self.bind_assistant_item(event.item_id)?;
                if let Some(text) = text {
                    if text.len() > MAX_ASSISTANT_BYTES || text.contains('\0') {
                        return Err(ChatError::OrchestrationUnavailable);
                    }
                    if self.assistant_text.is_empty() {
                        self.assistant_text = text;
                    } else if self.assistant_text != text {
                        return Err(ChatError::OrchestrationUnavailable);
                    }
                }
            }
            HostEventKind::ReasoningTextDelta {
                content_index,
                delta,
            } => {
                let item_id = event.item_id.ok_or(ChatError::OrchestrationUnavailable)?;
                self.append_reasoning_delta(item_id, content_index, delta)?;
            }
            HostEventKind::ReasoningTextFinalized {
                status,
                contents,
                reason,
            } => {
                let item_id = event.item_id.ok_or(ChatError::OrchestrationUnavailable)?;
                self.finalize_reasoning(item_id, status, contents, reason, observed_at_ms)?;
            }
            HostEventKind::TurnCompleted { status, .. } => {
                let cursor = StoredEventCursor {
                    stream_id: event.cursor.stream_id,
                    sequence: event.cursor.sequence,
                    event_id: event.event_id,
                };
                let (reasoning_status, reasoning_reason_code, reasoning_items) =
                    self.finish_reasoning(status, observed_at_ms)?;
                self.terminal = true;
                self.terminal_status = Some(turn_status_text(status).to_owned());
                self.expected_stream = Some(event.cursor.stream_id);
                self.last_sequence = event.cursor.sequence;
                self.last_event_id = Some(event.event_id);
                return Ok(ReducerOutcome::Terminal(TerminalTurnCommit {
                    local_turn_id: self.local_turn_id,
                    terminal_status: turn_status_text(status).to_owned(),
                    terminal_at: observed_at_ms / 1000,
                    assistant_text: self.assistant_text.clone(),
                    cursor,
                    reasoning_status,
                    reasoning_reason_code,
                    reasoning_items,
                }));
            }
            HostEventKind::ThreadStarted { .. }
            | HostEventKind::TurnStarted
            | HostEventKind::TurnPlanUpdated { .. }
            | HostEventKind::ItemStarted { .. }
            | HostEventKind::ItemCompleted { .. }
            | HostEventKind::CommandStarted { .. }
            | HostEventKind::CommandOutputDelta { .. }
            | HostEventKind::CommandCompleted { .. }
            | HostEventKind::ToolStarted { .. }
            | HostEventKind::ToolProgress { .. }
            | HostEventKind::ToolCompleted { .. }
            | HostEventKind::ApprovalRequested(_)
            | HostEventKind::ApprovalResolved(_)
            | HostEventKind::Error { .. }
            | HostEventKind::Warning { .. }
            | HostEventKind::Unknown => {}
        }
        self.expected_stream = Some(event.cursor.stream_id);
        self.last_sequence = event.cursor.sequence;
        self.last_event_id = Some(event.event_id);
        Ok(ReducerOutcome::Progress)
    }

    pub fn observe_artifact(
        &mut self,
        event: &HostArtifactEventV3,
    ) -> Result<ReducerOutcome, ChatError> {
        if self.terminal {
            return Err(ChatError::ConversationConflict);
        }
        if event.task_id != self.task_id
            || event.agent_session_id != self.agent_session_id
            || event.codex_thread_id != self.codex_thread_id
            || event.turn_id != self.runtime_turn_id
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        if event.cursor.sequence == self.last_sequence
            && self.last_event_id == Some(event.event_id)
            && self.expected_stream == Some(event.cursor.stream_id)
        {
            return Ok(ReducerOutcome::Duplicate);
        }
        let expected_sequence = self
            .last_sequence
            .checked_add(1)
            .ok_or(ChatError::OrchestrationUnavailable)?;
        if event.cursor.sequence != expected_sequence
            || self
                .expected_stream
                .is_some_and(|stream| stream != event.cursor.stream_id)
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        self.expected_stream = Some(event.cursor.stream_id);
        self.last_sequence = event.cursor.sequence;
        self.last_event_id = Some(event.event_id);
        Ok(ReducerOutcome::Progress)
    }

    fn resync_reason(&self, cursor: HostEventCursor, event_id: Uuid) -> ArtifactResyncReason {
        if cursor.sequence == self.last_sequence
            && self.last_event_id == Some(event_id)
            && self.expected_stream == Some(cursor.stream_id)
        {
            return ArtifactResyncReason::ProtocolError;
        }
        if cursor.sequence != self.last_sequence.checked_add(1).unwrap_or_default()
            || self
                .expected_stream
                .is_some_and(|stream| stream != cursor.stream_id)
        {
            ArtifactResyncReason::SequenceGap
        } else {
            ArtifactResyncReason::ProtocolError
        }
    }

    pub fn progress(&self) -> Result<TurnProgress, ChatError> {
        Ok(TurnProgress {
            local_turn_id: self.local_turn_id,
            assistant_text: self.assistant_text.clone(),
            cursor: StoredEventCursor {
                stream_id: self
                    .expected_stream
                    .ok_or(ChatError::ConversationConflict)?,
                sequence: self.last_sequence,
                event_id: self.last_event_id.ok_or(ChatError::ConversationConflict)?,
            },
        })
    }

    pub fn projection(&self, terminal: bool) -> Result<LiveTurnProjection, ChatError> {
        if terminal != self.terminal {
            return Err(ChatError::ConversationConflict);
        }
        let reasoning = self
            .reasoning
            .iter()
            .map(|item| {
                let (status, parts) = match &item.finalized {
                    Some(finalized) => (Some(finalized.status), finalized.parts.clone()),
                    None => (
                        None,
                        item.parts
                            .iter()
                            .enumerate()
                            .filter(|(_, text)| !text.is_empty())
                            .map(|(content_index, text)| ReasoningPart {
                                content_index,
                                text: text.clone(),
                            })
                            .collect(),
                    ),
                };
                LiveReasoningProjection {
                    item_id: item.item_id.clone(),
                    status,
                    parts,
                }
            })
            .collect();
        Ok(LiveTurnProjection {
            session_id: self.session_id,
            turn_id: self.local_turn_id,
            assistant_text: self.assistant_text.clone(),
            reasoning,
            terminal,
            terminal_status: self.terminal_status.clone(),
        })
    }

    fn bind_assistant_item(&mut self, item_id: Option<String>) -> Result<(), ChatError> {
        let item_id = item_id.ok_or(ChatError::OrchestrationUnavailable)?;
        if self
            .assistant_item_id
            .as_ref()
            .is_some_and(|existing| existing != &item_id)
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        self.assistant_item_id = Some(item_id);
        Ok(())
    }

    fn append_reasoning_delta(
        &mut self,
        item_id: String,
        content_index: usize,
        delta: String,
    ) -> Result<(), ChatError> {
        if delta.is_empty()
            || delta.contains('\0')
            || content_index >= MAX_REASONING_PARTS
            || delta.len() > 16 * 1024
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let item = self.reasoning_item(item_id)?;
        if item.finalized.is_some() || content_index > item.parts.len() {
            return Err(ChatError::OrchestrationUnavailable);
        }
        if content_index == item.parts.len() {
            item.parts.push(String::new());
        }
        let current_part_len = item
            .parts
            .get(content_index)
            .ok_or(ChatError::OrchestrationUnavailable)?
            .len();
        let current_item_len = item.parts.iter().map(String::len).sum::<usize>();
        let new_part_len = current_part_len
            .checked_add(delta.len())
            .ok_or(ChatError::OrchestrationUnavailable)?;
        let new_item_len = current_item_len
            .checked_add(delta.len())
            .ok_or(ChatError::OrchestrationUnavailable)?;
        if new_part_len > MAX_REASONING_PART_BYTES || new_item_len > MAX_REASONING_ITEM_BYTES {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let part = item
            .parts
            .get_mut(content_index)
            .ok_or(ChatError::OrchestrationUnavailable)?;
        part.push_str(&delta);
        Ok(())
    }

    fn finalize_reasoning(
        &mut self,
        item_id: String,
        status: HostReasoningStatus,
        contents: Vec<HostReasoningPart>,
        reason: Option<HostReasoningReason>,
        observed_at_ms: i64,
    ) -> Result<(), ChatError> {
        let item = self.reasoning_item(item_id)?;
        if item.finalized.is_some() {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let snapshot = contents
            .into_iter()
            .map(|part| ReasoningPart {
                content_index: part.content_index,
                text: part.text,
            })
            .collect::<Vec<_>>();
        let snapshot_bytes = snapshot.iter().map(|part| part.text.len()).sum::<usize>();
        if snapshot.len() > MAX_REASONING_PARTS || snapshot_bytes > MAX_REASONING_ITEM_BYTES {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let buffered = item
            .parts
            .iter()
            .enumerate()
            .map(|(content_index, text)| ReasoningPart {
                content_index,
                text: text.clone(),
            })
            .collect::<Vec<_>>();
        let reconciled = buffered.is_empty() || buffered == snapshot;
        let (status, reason_code) = match status {
            HostReasoningStatus::Complete if reconciled => (ReasoningStatus::Complete, None),
            HostReasoningStatus::Complete => (
                ReasoningStatus::Incomplete,
                Some("protocol_error".to_owned()),
            ),
            HostReasoningStatus::Incomplete => (
                ReasoningStatus::Incomplete,
                Some(reason_text(reason.ok_or(ChatError::OrchestrationUnavailable)?).to_owned()),
            ),
            HostReasoningStatus::Unavailable => (
                ReasoningStatus::Unavailable,
                Some(reason_text(reason.ok_or(ChatError::OrchestrationUnavailable)?).to_owned()),
            ),
        };
        item.finalized = Some(FinalizedReasoning {
            status,
            reason_code,
            parts: snapshot,
        });
        item.finalized_at_ms = observed_at_ms;
        Ok(())
    }

    fn reasoning_item(&mut self, item_id: String) -> Result<&mut ReasoningAccumulator, ChatError> {
        if let Some(index) = self
            .reasoning
            .iter()
            .position(|item| item.item_id == item_id)
        {
            return self
                .reasoning
                .get_mut(index)
                .ok_or(ChatError::OrchestrationUnavailable);
        }
        if self.reasoning.len() >= MAX_REASONING_ITEMS {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let item_ordinal = self.reasoning.len();
        self.reasoning.push(ReasoningAccumulator {
            item_id,
            item_ordinal,
            parts: Vec::new(),
            finalized: None,
            finalized_at_ms: 0,
        });
        self.reasoning
            .last_mut()
            .ok_or(ChatError::OrchestrationUnavailable)
    }

    fn finish_reasoning(
        &mut self,
        terminal_status: HostTurnStatus,
        observed_at_ms: i64,
    ) -> Result<(ReasoningStatus, Option<String>, Vec<ReasoningItem>), ChatError> {
        if self.reasoning.is_empty() {
            return Ok((
                ReasoningStatus::Unavailable,
                Some("reasoning_not_emitted".to_owned()),
                Vec::new(),
            ));
        }
        let missing_reason = match terminal_status {
            HostTurnStatus::Completed => "protocol_error",
            HostTurnStatus::Interrupted => "turn_interrupted",
            HostTurnStatus::Failed => "runtime_error",
        };
        let mut items = Vec::with_capacity(self.reasoning.len());
        for accumulator in &mut self.reasoning {
            let finalized = match accumulator.finalized.take() {
                Some(mut finalized) => {
                    if terminal_status != HostTurnStatus::Completed
                        && finalized.status == ReasoningStatus::Complete
                    {
                        finalized.status = ReasoningStatus::Incomplete;
                        finalized.reason_code = Some(missing_reason.to_owned());
                    }
                    finalized
                }
                None if terminal_status == HostTurnStatus::Interrupted
                    && !accumulator.parts.is_empty() =>
                {
                    FinalizedReasoning {
                        status: ReasoningStatus::Incomplete,
                        reason_code: Some("turn_interrupted".to_owned()),
                        parts: accumulator
                            .parts
                            .iter()
                            .enumerate()
                            .map(|(content_index, text)| ReasoningPart {
                                content_index,
                                text: text.clone(),
                            })
                            .collect(),
                    }
                }
                None => FinalizedReasoning {
                    status: ReasoningStatus::Unavailable,
                    reason_code: Some(missing_reason.to_owned()),
                    parts: Vec::new(),
                },
            };
            let finalized_at_ms = if accumulator.finalized_at_ms == 0 {
                observed_at_ms
            } else {
                accumulator.finalized_at_ms
            };
            items.push(ReasoningItem {
                item_id: accumulator.item_id.clone(),
                item_ordinal: accumulator.item_ordinal,
                status: finalized.status,
                reason_code: finalized.reason_code,
                finalized_at_ms,
                parts: finalized.parts,
            });
        }
        let total_bytes = items
            .iter()
            .flat_map(|item| &item.parts)
            .map(|part| part.text.len())
            .sum::<usize>();
        if total_bytes > MAX_REASONING_TURN_BYTES {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let (status, reason) = if let Some(item) = items
            .iter()
            .find(|item| item.status == ReasoningStatus::Unavailable)
        {
            (ReasoningStatus::Unavailable, item.reason_code.clone())
        } else if let Some(item) = items
            .iter()
            .find(|item| item.status == ReasoningStatus::Incomplete)
        {
            (ReasoningStatus::Incomplete, item.reason_code.clone())
        } else {
            (ReasoningStatus::Complete, None)
        };
        Ok((status, reason, items))
    }
}

fn requires_current_turn(kind: &HostEventKind) -> bool {
    matches!(
        kind,
        HostEventKind::TurnStarted
            | HostEventKind::ItemStarted { .. }
            | HostEventKind::AgentMessageDelta { .. }
            | HostEventKind::ReasoningTextDelta { .. }
            | HostEventKind::ReasoningTextFinalized { .. }
            | HostEventKind::ItemCompleted { .. }
            | HostEventKind::ApprovalRequested(_)
            | HostEventKind::ApprovalResolved(_)
            | HostEventKind::TurnCompleted { .. }
            | HostEventKind::Error { .. }
    )
}

fn reason_text(reason: HostReasoningReason) -> &'static str {
    match reason {
        HostReasoningReason::ReasoningNotEmitted => "reasoning_not_emitted",
        HostReasoningReason::TurnInterrupted => "turn_interrupted",
        HostReasoningReason::StreamGap => "stream_gap",
        HostReasoningReason::RuntimeError => "runtime_error",
        HostReasoningReason::LimitExceeded => "limit_exceeded",
        HostReasoningReason::ProtocolError => "protocol_error",
        HostReasoningReason::HostShutdown => "host_shutdown",
    }
}

fn turn_status_text(status: HostTurnStatus) -> &'static str {
    match status {
        HostTurnStatus::Completed => "completed",
        HostTurnStatus::Interrupted => "interrupted",
        HostTurnStatus::Failed => "failed",
    }
}

fn map_host_error(_error: HostBridgeError) -> ChatError {
    ChatError::OrchestrationUnavailable
}

fn feat136_stream_event_or_resync(
    next_event: Result<Option<HostStreamEvent>, HostBridgeError>,
    sink: &dyn TurnProjectionSink,
    session_id: Uuid,
    turn_id: Uuid,
) -> Result<HostStreamEvent, ChatError> {
    match next_event {
        Ok(Some(event)) => Ok(event),
        Ok(None) => {
            sink.publish_artifact_resync_required(
                session_id,
                turn_id,
                ArtifactResyncReason::ProtocolError,
            )?;
            Err(ChatError::OrchestrationUnavailable)
        }
        Err(error) => {
            sink.publish_artifact_resync_required(
                session_id,
                turn_id,
                ArtifactResyncReason::ProtocolError,
            )?;
            Err(map_host_error(error))
        }
    }
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

fn unix_millis() -> Result<i64, ChatError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ChatError::OrchestrationUnavailable)?;
    i64::try_from(duration.as_millis()).map_err(|_| ChatError::OrchestrationUnavailable)
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
    use sha2::Digest;
    #[cfg(target_os = "macos")]
    use std::fs;
    #[cfg(target_os = "macos")]
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicUsize, Ordering};
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

    struct EventIdentity {
        stream_id: Uuid,
        task_id: Uuid,
        agent_session_id: Uuid,
        thread_id: Uuid,
        turn_id: Uuid,
    }

    fn context() -> (ActiveTurnContext, EventIdentity) {
        let identity = EventIdentity {
            stream_id: Uuid::now_v7(),
            task_id: Uuid::now_v7(),
            agent_session_id: Uuid::now_v7(),
            thread_id: Uuid::now_v7(),
            turn_id: Uuid::now_v7(),
        };
        (
            ActiveTurnContext {
                session_id: identity.task_id,
                task_id: identity.task_id,
                turn_id: Uuid::now_v7(),
                turn_operation_id: Uuid::now_v7(),
                agent_session_id: identity.agent_session_id,
                codex_thread_id: identity.thread_id,
                runtime_turn_id: identity.turn_id,
                assistant_text: String::new(),
                cursor: None,
            },
            identity,
        )
    }

    struct Feat136ResyncSink(AtomicUsize);

    impl TurnProjectionSink for Feat136ResyncSink {
        fn publish(&self, _projection: LiveTurnProjection) -> Result<(), ChatError> {
            Ok(())
        }

        fn publish_artifact_resync_required(
            &self,
            _session_id: Uuid,
            _turn_id: Uuid,
            reason: ArtifactResyncReason,
        ) -> Result<(), ChatError> {
            assert_eq!(reason, ArtifactResyncReason::ProtocolError);
            self.0.fetch_add(1, Ordering::Relaxed);
            Ok(())
        }
    }

    #[test]
    fn feat136_protocol_decoder_failure_requests_conservative_resync() {
        let sink = Feat136ResyncSink(AtomicUsize::new(0));
        let result = feat136_stream_event_or_resync(
            Err(HostBridgeError::new(HostBridgeErrorKind::Protocol)),
            &sink,
            Uuid::now_v7(),
            Uuid::now_v7(),
        );
        assert!(matches!(result, Err(ChatError::OrchestrationUnavailable)));
        assert_eq!(sink.0.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn feat136_active_turn_stream_version_is_sticky_at_the_turn_boundary() {
        assert_eq!(feat136_active_turn_stream_schema(None), Ok(5));
        assert_eq!(feat136_active_turn_stream_schema(Some(4)), Ok(4));
        assert_eq!(feat136_active_turn_stream_schema(Some(5)), Ok(5));
        assert_eq!(
            feat136_active_turn_stream_schema(Some(6)),
            Err(ChatError::DatabaseUnavailable)
        );
    }

    #[test]
    fn feat137_active_turn_stream_version_is_sticky_at_the_turn_boundary() {
        assert_eq!(feat137_active_turn_stream_schema(None), Ok(6));
        assert_eq!(feat137_active_turn_stream_schema(Some(4)), Ok(4));
        assert_eq!(feat137_active_turn_stream_schema(Some(5)), Ok(5));
        assert_eq!(feat137_active_turn_stream_schema(Some(6)), Ok(6));
        assert_eq!(
            feat137_active_turn_stream_schema(Some(7)),
            Err(ChatError::DatabaseUnavailable)
        );
    }

    #[test]
    fn feat137_subscription_snapshot_fails_closed_only_for_local_command_hydration_lag() {
        let (context, identity) = context();
        let approval_request_id = Uuid::now_v7();
        let item_id = "command-approval";
        let snapshot = HostPendingApprovalSnapshot {
            stream_id: identity.stream_id,
            snapshot_at: "2026-08-31T01:00:01Z".to_owned(),
            pending: vec![crate::chat::feat137::HostPendingApproval {
                approval_request_id,
                task_id: identity.task_id,
                agent_session_id: identity.agent_session_id,
                codex_thread_id: identity.thread_id,
                turn_id: identity.turn_id,
                item_id: item_id.to_owned(),
                requested_at: "2026-08-31T01:00:00Z".to_owned(),
                expires_at: "2026-08-31T01:02:00Z".to_owned(),
            }],
        };

        assert_eq!(
            project_pending_approval_snapshot(
                snapshot.clone(),
                identity.agent_session_id,
                Some((&context, &Feat134Hydration::default())),
                PendingApprovalProjectionMode::Strict,
            ),
            Err(ChatError::OrchestrationUnavailable),
        );
        let lagged = project_pending_approval_snapshot(
            snapshot.clone(),
            identity.agent_session_id,
            Some((&context, &Feat134Hydration::default())),
            PendingApprovalProjectionMode::SubscriptionHandshake,
        )
        .unwrap();
        assert_eq!(lagged.stream_id, identity.stream_id);
        assert!(lagged.pending.is_empty());

        let pre_context = project_pending_approval_snapshot(
            snapshot.clone(),
            identity.agent_session_id,
            None,
            PendingApprovalProjectionMode::SubscriptionHandshake,
        )
        .unwrap();
        assert!(pre_context.pending.is_empty());
        assert_eq!(
            project_pending_approval_snapshot(
                snapshot.clone(),
                identity.agent_session_id,
                None,
                PendingApprovalProjectionMode::Strict,
            ),
            Err(ChatError::OrchestrationUnavailable),
        );

        let mut mismatched = snapshot.clone();
        mismatched.pending[0].task_id = Uuid::now_v7();
        assert_eq!(
            project_pending_approval_snapshot(
                mismatched,
                identity.agent_session_id,
                Some((&context, &Feat134Hydration::default())),
                PendingApprovalProjectionMode::SubscriptionHandshake,
            ),
            Err(ChatError::OrchestrationUnavailable),
        );
        let mut mismatched_agent = snapshot.clone();
        mismatched_agent.pending[0].agent_session_id = Uuid::now_v7();
        assert_eq!(
            project_pending_approval_snapshot(
                mismatched_agent,
                identity.agent_session_id,
                None,
                PendingApprovalProjectionMode::SubscriptionHandshake,
            ),
            Err(ChatError::OrchestrationUnavailable),
        );

        let mut reducer = Feat136TurnReducer::new(context.clone(), None).unwrap();
        let command = reducer
            .apply(
                event(
                    &identity,
                    1,
                    Some(item_id),
                    HostEventKind::CommandStarted {
                        command_summary: crate::chat::host_domain::HostSafeText {
                            text: "Inspect repository state".to_owned(),
                            truncated: false,
                            truncation_reason: None,
                        },
                        cwd: crate::chat::host_domain::HostCommandCwd::WorkspaceRoot,
                    },
                ),
                1,
            )
            .unwrap()
            .unwrap();
        let hydrated = Feat134Hydration {
            items: command.items,
            plan: command.plan,
            turn_notices: command.turn_notices,
        };
        let projected = project_pending_approval_snapshot(
            snapshot,
            identity.agent_session_id,
            Some((&context, &hydrated)),
            PendingApprovalProjectionMode::SubscriptionHandshake,
        )
        .unwrap();
        assert_eq!(projected.pending.len(), 1);
        assert_eq!(
            projected.pending[0].approval_request_id,
            approval_request_id
        );
        assert_eq!(projected.pending[0].turn_id, context.turn_id);
    }

    #[test]
    fn feat137_projection_is_durable_before_its_live_approval_event_is_published() {
        let source = include_str!("application.rs");
        let reduce_start = source
            .find("async fn reduce_and_persist_feat137_event(")
            .unwrap();
        let stream_start = source[reduce_start..]
            .find("async fn stream_active_turn_v4(")
            .map(|offset| reduce_start + offset)
            .unwrap();
        let reducer = &source[reduce_start..stream_start];
        assert!(
            reducer
                .find("protect_process_projection(projection)?")
                .unwrap()
                < reducer
                    .find("persist_feat137_projection(projection.clone(), approval.clone())")
                    .unwrap()
        );

        let stream = &source[stream_start..];
        assert!(
            stream.find("reduce_and_persist_feat137_event(").unwrap()
                < stream
                    .find("sink.publish_feat137(projection.clone(), approval)?")
                    .unwrap()
        );
    }

    fn event(
        identity: &EventIdentity,
        sequence: u64,
        item_id: Option<&str>,
        kind: HostEventKind,
    ) -> HostEvent {
        HostEvent {
            cursor: HostEventCursor::new(identity.stream_id, sequence).unwrap(),
            event_type: "synthetic".to_owned(),
            event_id: Uuid::now_v7(),
            task_id: identity.task_id,
            agent_session_id: identity.agent_session_id,
            codex_thread_id: identity.thread_id,
            turn_id: if matches!(kind, HostEventKind::Warning { .. }) {
                None
            } else {
                Some(identity.turn_id)
            },
            item_id: item_id.map(str::to_owned),
            occurred_at: "2026-08-03T00:00:00Z".to_owned(),
            encoded_bytes: 1,
            kind,
        }
    }

    #[test]
    fn reducer_reconciles_answer_and_reasoning_into_one_terminal_commit() {
        let (context, identity) = context();
        let local_turn_id = context.turn_id;
        let mut reducer = TurnEventReducer::new(context).unwrap();
        let events = [
            event(
                &identity,
                1,
                Some("reason-1"),
                HostEventKind::ReasoningTextDelta {
                    content_index: 0,
                    delta: "分析".to_owned(),
                },
            ),
            event(
                &identity,
                2,
                Some("reason-1"),
                HostEventKind::ReasoningTextFinalized {
                    status: HostReasoningStatus::Complete,
                    contents: vec![HostReasoningPart {
                        content_index: 0,
                        text: "分析".to_owned(),
                    }],
                    reason: None,
                },
            ),
            event(
                &identity,
                3,
                Some("answer-1"),
                HostEventKind::AgentMessageDelta {
                    delta: "完成".to_owned(),
                },
            ),
            event(
                &identity,
                4,
                Some("answer-1"),
                HostEventKind::ItemCompleted {
                    item_type: "agent_message".to_owned(),
                    text: Some("完成".to_owned()),
                    phase: None,
                },
            ),
        ];
        for (index, event) in events.into_iter().enumerate() {
            assert_eq!(
                reducer.apply(event, index as i64 + 1).unwrap().kind(),
                ReducerOutcomeKind::Progress
            );
        }
        let terminal = event(
            &identity,
            5,
            None,
            HostEventKind::TurnCompleted {
                status: HostTurnStatus::Completed,
                code: None,
                message: None,
            },
        );
        let ReducerOutcome::Terminal(commit) = reducer.apply(terminal, 5).unwrap() else {
            panic!("terminal commit expected");
        };
        assert_eq!(commit.local_turn_id, local_turn_id);
        assert_eq!(commit.assistant_text, "完成");
        assert_eq!(commit.reasoning_status, ReasoningStatus::Complete);
        assert_eq!(commit.reasoning_items[0].parts[0].text, "分析");
    }

    #[test]
    fn reducer_ignores_exact_duplicate_but_rejects_gap_and_identity_mixup() {
        let (context, identity) = context();
        let mut reducer = TurnEventReducer::new(context).unwrap();
        let first = event(
            &identity,
            1,
            Some("answer"),
            HostEventKind::AgentMessageDelta {
                delta: "a".to_owned(),
            },
        );
        let duplicate_id = first.event_id;
        reducer.apply(first, 1).unwrap();
        let mut duplicate = event(
            &identity,
            1,
            Some("answer"),
            HostEventKind::AgentMessageDelta {
                delta: "a".to_owned(),
            },
        );
        duplicate.event_id = duplicate_id;
        assert_eq!(
            reducer.apply(duplicate, 2).unwrap().kind(),
            ReducerOutcomeKind::Duplicate
        );
        assert!(matches!(
            reducer.apply(
                event(
                    &identity,
                    3,
                    Some("answer"),
                    HostEventKind::AgentMessageDelta {
                        delta: "b".to_owned(),
                    },
                ),
                3,
            ),
            Err(ChatError::OrchestrationUnavailable)
        ));
    }

    #[test]
    fn artifact_observation_shares_the_ordinary_cursor_domain_and_is_idempotent() {
        let (context, identity) = context();
        let local_turn_id = context.turn_id;
        let mut reducer = TurnEventReducer::new(context).unwrap();
        reducer
            .apply(
                event(
                    &identity,
                    1,
                    Some("answer"),
                    HostEventKind::AgentMessageDelta {
                        delta: "a".to_owned(),
                    },
                ),
                1,
            )
            .unwrap();
        let artifact = HostArtifactEventV3 {
            schema_version: 3,
            cursor: HostEventCursor::new(identity.stream_id, 2).unwrap(),
            event_type: "item.artifact.started".to_owned(),
            event_id: Uuid::now_v7(),
            task_id: identity.task_id,
            agent_session_id: identity.agent_session_id,
            codex_thread_id: identity.thread_id,
            turn_id: identity.turn_id,
            occurred_at: "2026-08-20T00:00:00Z".to_owned(),
            payload: serde_json::json!({}),
        };
        assert_eq!(
            reducer.observe_artifact(&artifact).unwrap().kind(),
            ReducerOutcomeKind::Progress
        );
        assert_eq!(reducer.progress().unwrap().cursor.sequence, 2);
        assert_eq!(reducer.progress().unwrap().local_turn_id, local_turn_id);
        assert_eq!(
            reducer.observe_artifact(&artifact).unwrap().kind(),
            ReducerOutcomeKind::Duplicate
        );
        let mut gap = artifact;
        gap.cursor.sequence = 4;
        gap.event_id = Uuid::now_v7();
        assert!(matches!(
            reducer.observe_artifact(&gap),
            Err(ChatError::OrchestrationUnavailable)
        ));
    }

    #[test]
    fn completed_snapshot_conflict_is_explicit_incomplete_not_silent_complete() {
        let (context, identity) = context();
        let mut reducer = TurnEventReducer::new(context).unwrap();
        reducer
            .apply(
                event(
                    &identity,
                    1,
                    Some("reason"),
                    HostEventKind::ReasoningTextDelta {
                        content_index: 0,
                        delta: "prefix".to_owned(),
                    },
                ),
                1,
            )
            .unwrap();
        reducer
            .apply(
                event(
                    &identity,
                    2,
                    Some("reason"),
                    HostEventKind::ReasoningTextFinalized {
                        status: HostReasoningStatus::Complete,
                        contents: vec![HostReasoningPart {
                            content_index: 0,
                            text: "different".to_owned(),
                        }],
                        reason: None,
                    },
                ),
                2,
            )
            .unwrap();
        let ReducerOutcome::Terminal(commit) = reducer
            .apply(
                event(
                    &identity,
                    3,
                    None,
                    HostEventKind::TurnCompleted {
                        status: HostTurnStatus::Completed,
                        code: None,
                        message: None,
                    },
                ),
                3,
            )
            .unwrap()
        else {
            panic!("terminal expected");
        };
        assert_eq!(commit.reasoning_status, ReasoningStatus::Incomplete);
        assert_eq!(
            commit.reasoning_reason_code.as_deref(),
            Some("protocol_error")
        );
        assert_eq!(commit.reasoning_items[0].parts[0].text, "different");
    }

    #[test]
    fn missing_reasoning_is_unavailable_without_fabricated_item_or_answer() {
        let (context, identity) = context();
        let mut reducer = TurnEventReducer::new(context).unwrap();
        let ReducerOutcome::Terminal(commit) = reducer
            .apply(
                event(
                    &identity,
                    1,
                    None,
                    HostEventKind::TurnCompleted {
                        status: HostTurnStatus::Completed,
                        code: None,
                        message: None,
                    },
                ),
                1,
            )
            .unwrap()
        else {
            panic!("terminal expected");
        };
        assert_eq!(commit.reasoning_status, ReasoningStatus::Unavailable);
        assert_eq!(
            commit.reasoning_reason_code.as_deref(),
            Some("reasoning_not_emitted")
        );
        assert!(commit.reasoning_items.is_empty());
        assert!(commit.assistant_text.is_empty());
    }

    #[test]
    fn rust_projection_source_exposes_bounded_live_reasoning_but_redacts_debug() {
        let canary = "S7C-LIVE-RAW-CANARY";
        let (context, identity) = context();
        let session_id = context.session_id;
        let turn_id = context.turn_id;
        let mut reducer = TurnEventReducer::new(context).unwrap();
        reducer
            .apply(
                event(
                    &identity,
                    1,
                    Some("reason"),
                    HostEventKind::ReasoningTextDelta {
                        content_index: 0,
                        delta: canary.to_owned(),
                    },
                ),
                1,
            )
            .unwrap();
        let projection = reducer.projection(false).unwrap();
        assert_eq!(projection.session_id, session_id);
        assert_eq!(projection.turn_id, turn_id);
        assert_eq!(projection.reasoning[0].parts[0].text, canary);
        assert!(!format!("{projection:?}").contains(canary));
        assert_eq!(
            reducer.projection(true),
            Err(ChatError::ConversationConflict)
        );
    }

    #[test]
    fn reducer_restart_continues_after_durable_cursor_without_repeating_answer() {
        let (mut context, identity) = context();
        let prior_event_id = Uuid::now_v7();
        context.assistant_text = "已保存".to_owned();
        context.cursor = Some(StoredEventCursor {
            stream_id: identity.stream_id,
            sequence: 2,
            event_id: prior_event_id,
        });
        let mut reducer = TurnEventReducer::new(context).unwrap();
        reducer
            .apply(
                event(
                    &identity,
                    3,
                    Some("answer"),
                    HostEventKind::AgentMessageDelta {
                        delta: "增量".to_owned(),
                    },
                ),
                3,
            )
            .unwrap();
        let ReducerOutcome::Terminal(commit) = reducer
            .apply(
                event(
                    &identity,
                    4,
                    None,
                    HostEventKind::TurnCompleted {
                        status: HostTurnStatus::Completed,
                        code: None,
                        message: None,
                    },
                ),
                4,
            )
            .unwrap()
        else {
            panic!("terminal expected");
        };
        assert_eq!(commit.assistant_text, "已保存增量");
        assert_eq!(commit.cursor.sequence, 4);
    }

    #[test]
    fn reducer_processes_ten_thousand_ordered_deltas_without_snapshot_per_event() {
        let (context, identity) = context();
        let mut reducer = TurnEventReducer::new(context).unwrap();
        for sequence in 1..=10_000 {
            assert_eq!(
                reducer
                    .apply(
                        event(
                            &identity,
                            sequence,
                            Some("answer"),
                            HostEventKind::AgentMessageDelta {
                                delta: "x".to_owned(),
                            },
                        ),
                        sequence as i64,
                    )
                    .unwrap()
                    .kind(),
                ReducerOutcomeKind::Progress
            );
        }
        let progress = reducer.progress().unwrap();
        assert_eq!(progress.assistant_text.len(), 10_000);
        assert_eq!(progress.cursor.sequence, 10_000);
    }

    #[test]
    fn controlled_interrupt_persists_only_validated_reasoning_prefix_as_incomplete() {
        let (context, identity) = context();
        let mut reducer = TurnEventReducer::new(context).unwrap();
        reducer
            .apply(
                event(
                    &identity,
                    1,
                    Some("reason"),
                    HostEventKind::ReasoningTextDelta {
                        content_index: 0,
                        delta: "已验证前缀".to_owned(),
                    },
                ),
                1,
            )
            .unwrap();
        let ReducerOutcome::Terminal(commit) = reducer
            .apply(
                event(
                    &identity,
                    2,
                    None,
                    HostEventKind::TurnCompleted {
                        status: HostTurnStatus::Interrupted,
                        code: None,
                        message: None,
                    },
                ),
                2,
            )
            .unwrap()
        else {
            panic!("terminal expected");
        };
        assert_eq!(commit.reasoning_status, ReasoningStatus::Incomplete);
        assert_eq!(
            commit.reasoning_reason_code.as_deref(),
            Some("turn_interrupted")
        );
        assert_eq!(commit.reasoning_items[0].parts[0].text, "已验证前缀");
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
    async fn feat137_decision_rebinds_local_identity_then_posts_once() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693f72";
        const TOKEN: &str = "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG";
        let (root, database, pending_conversation, turn, agent_session_id) =
            prepare_v2_turn_outbox("feat137-decision-binding").await;
        let runtime_turn_id = Uuid::now_v7();
        database
            .suspend_started_turn_retry(turn.operation_id, runtime_turn_id)
            .await
            .unwrap();
        let context = database
            .active_turn_context(pending_conversation.session_id)
            .await
            .unwrap();
        let stream_id = Uuid::now_v7();
        let item_id = "command-approval";
        let mut reducer = Feat136TurnReducer::new(context.clone(), None).unwrap();
        let projection = reducer
            .apply(
                HostEvent {
                    cursor: HostEventCursor::new(stream_id, 1).unwrap(),
                    event_type: "item.started".to_owned(),
                    event_id: Uuid::now_v7(),
                    task_id: context.task_id,
                    agent_session_id,
                    codex_thread_id: context.codex_thread_id,
                    turn_id: Some(runtime_turn_id),
                    item_id: Some(item_id.to_owned()),
                    occurred_at: "2026-08-30T12:00:00Z".to_owned(),
                    encoded_bytes: 1,
                    kind: HostEventKind::CommandStarted {
                        command_summary: crate::chat::host_domain::HostSafeText {
                            text: "Inspect repository state".to_owned(),
                            truncated: false,
                            truncation_reason: None,
                        },
                        cwd: crate::chat::host_domain::HostCommandCwd::WorkspaceRoot,
                    },
                },
                1,
            )
            .unwrap()
            .unwrap();
        database
            .persist_feat137_projection(projection, None)
            .await
            .unwrap();

        let approval_request_id = Uuid::now_v7();
        let pending_body = serde_json::json!({
            "schema_version": 6,
            "stream_id": stream_id,
            "snapshot_at": "2026-08-30T12:00:10Z",
            "pending": [{
                "approval_request_id": approval_request_id,
                "revision": 1,
                "task_id": context.task_id,
                "agent_session_id": agent_session_id,
                "codex_thread_id": context.codex_thread_id,
                "turn_id": runtime_turn_id,
                "item_id": item_id,
                "action_id": "git_repository_check",
                "workspace_scope": "current_workspace",
                "decisions": {
                    "primary": "accept_once",
                    "secondary": "cancel_current_turn"
                },
                "requested_at": "2026-08-30T12:00:00Z",
                "expires_at": "2026-08-30T12:02:00Z",
                "ttl_seconds": 120
            }]
        })
        .to_string();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let mut requests = Vec::with_capacity(4);
            for response in [
                ready_response(NONCE),
                json_response("200 OK", &pending_body),
            ] {
                let (mut stream, _) = listener.accept().await.unwrap();
                requests.push(read_request(&mut stream).await);
                stream.write_all(response.as_bytes()).await.unwrap();
                stream.shutdown().await.unwrap();
            }
            let (mut ready, _) = listener.accept().await.unwrap();
            requests.push(read_request(&mut ready).await);
            ready
                .write_all(ready_response(NONCE).as_bytes())
                .await
                .unwrap();
            ready.shutdown().await.unwrap();

            let (mut decision_stream, _) = listener.accept().await.unwrap();
            let decision_request = read_request(&mut decision_stream).await;
            let encoded = decision_request
                .split_once("\r\n\r\n")
                .map(|(_, body)| body)
                .unwrap();
            let request: serde_json::Value = serde_json::from_str(encoded).unwrap();
            let decision_id = request["decision_id"].as_str().unwrap();
            let response = serde_json::json!({
                "schema_version": 6,
                "approval_request_id": approval_request_id,
                "decision_id": decision_id,
                "stream_id": stream_id,
                "revision": 2,
                "decision": "accept_once",
                "outcome": "accepted_once",
                "resolved_at": "2026-08-30T12:00:30Z",
            })
            .to_string();
            requests.push(decision_request);
            decision_stream
                .write_all(json_response("200 OK", &response).as_bytes())
                .await
                .unwrap();
            decision_stream.shutdown().await.unwrap();
            requests
        });

        let token_directory = root.join("host");
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let application = ConversationApplication::new_with_artifacts_v6(
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
                .decide_approval_v6(
                    pending_conversation.session_id,
                    context.turn_id,
                    "different-command",
                    approval_request_id,
                    HostApprovalDecision::AcceptOnce,
                )
                .await
                .unwrap_err()
                .issue(),
            super::super::feat137::ApprovalIssue::ApprovalStale
        );
        let result = application
            .decide_approval_v6(
                pending_conversation.session_id,
                context.turn_id,
                item_id,
                approval_request_id,
                HostApprovalDecision::AcceptOnce,
            )
            .await
            .unwrap();
        assert_eq!(result.approval_request_id, approval_request_id);
        assert_eq!(result.stream_id, stream_id);

        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 4);
        assert!(requests[1].starts_with(&format!(
            "GET /v6/agent-sessions/{agent_session_id}/approvals/pending HTTP/1.1"
        )));
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.starts_with("POST "))
                .count(),
            1
        );
        assert!(!requests[3].contains(&context.turn_id.to_string()));
        assert!(!requests[3].contains(item_id));

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat134_background_recovery_terminalizes_preexisting_failed_turn_projection() {
        let (root, database, pending, turn, _agent_session_id) =
            prepare_v2_turn_outbox("feat134-failed-turn-recovery").await;
        database.fail_outbox(turn.operation_id).await.unwrap();
        let mut application = ConversationApplication::new_offline(database.clone());
        application.feat134_streaming_enabled = true;

        let outcome = application.run_background_once().await.unwrap();
        assert_eq!(
            outcome,
            CoordinatorOutcome::Dispatched(DispatchOutcome::TurnFailedSafely {
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
    #[tokio::test]
    async fn feat134_application_consumes_one_overflow_event_and_reopens_confirmed_prefix() {
        let (root, database, pending, turn, _agent_session_id) =
            prepare_v2_turn_outbox("feat134-application-projection-limit").await;
        let runtime_turn_id = Uuid::now_v7();
        database
            .suspend_started_turn_retry(turn.operation_id, runtime_turn_id)
            .await
            .unwrap();
        let context = database
            .active_turn_context(pending.session_id)
            .await
            .unwrap();
        let identity = EventIdentity {
            stream_id: Uuid::now_v7(),
            task_id: context.task_id,
            agent_session_id: context.agent_session_id,
            thread_id: context.codex_thread_id,
            turn_id: runtime_turn_id,
        };
        let mut reducer = Feat134TurnReducer::new(context, None).unwrap();
        let application = ConversationApplication::new_offline(database.clone());
        let confirmed_canary = "C".repeat(600 * 1024);
        let offending_canary = "O".repeat(600 * 1024);

        let mut confirmed = event(
            &identity,
            1,
            Some("answer-confirmed"),
            HostEventKind::ItemCompleted {
                item_type: "agentMessage".to_owned(),
                text: Some(confirmed_canary.clone()),
                phase: Some(super::super::host_domain::HostAgentMessagePhase::FinalAnswer),
            },
        );
        confirmed.event_type = "item.completed".to_owned();
        let (confirmed_projection, projection_limit) = application
            .reduce_and_persist_feat134_event(&mut reducer, confirmed, 1_000)
            .await
            .unwrap()
            .unwrap();
        assert!(!projection_limit);
        assert_eq!(confirmed_projection.durable_sequence, Some(1));
        assert_eq!(confirmed_projection.items.len(), 1);

        // Two individually legal final-answer items exceed the Desktop's joined-answer boundary.
        // The second body must never be persisted even though its source cursor is consumed once.
        let mut overflow = event(
            &identity,
            2,
            Some("answer-overflow"),
            HostEventKind::ItemCompleted {
                item_type: "agentMessage".to_owned(),
                text: Some(offending_canary),
                phase: Some(super::super::host_domain::HostAgentMessagePhase::FinalAnswer),
            },
        );
        overflow.event_type = "item.completed".to_owned();
        let (failed_projection, projection_limit) = application
            .reduce_and_persist_feat134_event(&mut reducer, overflow, 2_000)
            .await
            .unwrap()
            .unwrap();
        assert!(projection_limit);
        assert_eq!(failed_projection.durable_sequence, Some(2));
        assert_eq!(failed_projection.items.len(), 1);
        assert_eq!(failed_projection.items[0].text, confirmed_canary);
        assert_eq!(
            failed_projection
                .terminal
                .as_ref()
                .and_then(|terminal| terminal.code.as_deref()),
            Some("projection_limit_exceeded")
        );

        let snapshot = application
            .load_feat134_history_snapshot(pending.session_id, None, Some(1))
            .await
            .unwrap();
        assert_eq!(snapshot.feat134.durable_sequence_cut, 2);
        assert_eq!(snapshot.history.turns[0].status, "failed");
        assert_eq!(snapshot.feat134.turns[0].items.len(), 1);
        assert_eq!(snapshot.feat134.turns[0].items[0].text, confirmed_canary);
        assert_eq!(
            snapshot.feat134.turns[0].terminal_code.as_deref(),
            Some("projection_limit_exceeded")
        );
        assert_eq!(
            database.active_turn_context(pending.session_id).await,
            Err(ChatError::NotFound)
        );

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat134_application_terminalizes_snapshot_conflict_from_confirmed_prefix() {
        let (root, database, pending, turn, _agent_session_id) =
            prepare_v2_turn_outbox("feat134-application-projection-conflict").await;
        let runtime_turn_id = Uuid::now_v7();
        database
            .suspend_started_turn_retry(turn.operation_id, runtime_turn_id)
            .await
            .unwrap();
        let context = database
            .active_turn_context(pending.session_id)
            .await
            .unwrap();
        let identity = EventIdentity {
            stream_id: Uuid::now_v7(),
            task_id: context.task_id,
            agent_session_id: context.agent_session_id,
            thread_id: context.codex_thread_id,
            turn_id: runtime_turn_id,
        };
        let mut reducer = Feat134TurnReducer::new(context, None).unwrap();
        let application = ConversationApplication::new_offline(database.clone());

        for (sequence, kind) in [
            (
                1,
                HostEventKind::ItemStarted {
                    item_type: "agentMessage".to_owned(),
                    text: Some(String::new()),
                    phase: Some(super::super::host_domain::HostAgentMessagePhase::FinalAnswer),
                },
            ),
            (
                2,
                HostEventKind::AgentMessageDelta {
                    delta: "confirmed prefix".to_owned(),
                },
            ),
        ] {
            let mut source = event(&identity, sequence, Some("answer"), kind);
            source.event_type = if sequence == 1 {
                "item.started".to_owned()
            } else {
                "item.agent_message.delta".to_owned()
            };
            let (projection, projection_failure) = application
                .reduce_and_persist_feat134_event(
                    &mut reducer,
                    source,
                    i64::try_from(sequence).unwrap(),
                )
                .await
                .unwrap()
                .unwrap();
            assert!(!projection_failure);
            assert_eq!(projection.durable_sequence, Some(sequence));
        }

        let mut conflicting = event(
            &identity,
            3,
            Some("answer"),
            HostEventKind::ItemCompleted {
                item_type: "agentMessage".to_owned(),
                text: Some("divergent body".to_owned()),
                phase: Some(super::super::host_domain::HostAgentMessagePhase::FinalAnswer),
            },
        );
        conflicting.event_type = "item.completed".to_owned();
        let (failed, projection_failure) = application
            .reduce_and_persist_feat134_event(&mut reducer, conflicting, 3)
            .await
            .unwrap()
            .unwrap();
        assert!(projection_failure);
        assert_eq!(failed.durable_sequence, Some(3));
        assert_eq!(failed.assistant_text, "confirmed prefix");
        assert_eq!(failed.items[0].text, "confirmed prefix");
        assert_eq!(failed.items[0].status.as_str(), "incomplete");
        assert_eq!(
            failed
                .terminal
                .as_ref()
                .and_then(|terminal| terminal.code.as_deref()),
            Some("projection_conflict")
        );
        assert!(!format!("{failed:?}").contains("divergent body"));

        let snapshot = application
            .load_feat134_history_snapshot(pending.session_id, None, Some(1))
            .await
            .unwrap();
        assert_eq!(snapshot.feat134.durable_sequence_cut, 3);
        assert_eq!(snapshot.feat134.turns[0].items[0].text, "confirmed prefix");
        assert_eq!(
            snapshot.feat134.turns[0].terminal_code.as_deref(),
            Some("projection_conflict")
        );
        assert_eq!(
            snapshot.history.turns[0].reasoning_reason_code.as_deref(),
            Some("protocol_error")
        );

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat134_application_bounds_repeated_replacement_event_bytes() {
        const ONE_MIB: usize = 1024 * 1024;
        const BYTE_BUDGET_EVENTS: u64 = 16;
        let (root, database, pending, turn, _agent_session_id) =
            prepare_v2_turn_outbox("feat134-application-event-byte-budget").await;
        let runtime_turn_id = Uuid::now_v7();
        database
            .suspend_started_turn_retry(turn.operation_id, runtime_turn_id)
            .await
            .unwrap();
        let context = database
            .active_turn_context(pending.session_id)
            .await
            .unwrap();
        let identity = EventIdentity {
            stream_id: Uuid::now_v7(),
            task_id: context.task_id,
            agent_session_id: context.agent_session_id,
            thread_id: context.codex_thread_id,
            turn_id: runtime_turn_id,
        };
        let mut reducer = Feat134TurnReducer::new(context, None).unwrap();
        let application = ConversationApplication::new_offline(database.clone());

        for sequence in 1..=BYTE_BUDGET_EVENTS {
            let mut source = event(
                &identity,
                sequence,
                None,
                HostEventKind::TurnPlanUpdated {
                    explanation: None,
                    steps: vec![super::super::host_domain::HostPlanStep {
                        step: format!("confirmed replacement {sequence}"),
                        status: super::super::host_domain::HostPlanStepStatus::InProgress,
                    }],
                },
            );
            source.event_type = "turn.plan.updated".to_owned();
            source.encoded_bytes = ONE_MIB;
            let (projection, projection_failure) = application
                .reduce_and_persist_feat134_event(
                    &mut reducer,
                    source,
                    i64::try_from(sequence).unwrap(),
                )
                .await
                .unwrap()
                .unwrap();
            assert!(!projection_failure);
            assert_eq!(projection.durable_sequence, Some(sequence));
        }

        let sequence = BYTE_BUDGET_EVENTS + 1;
        let mut overflow = event(
            &identity,
            sequence,
            None,
            HostEventKind::TurnPlanUpdated {
                explanation: None,
                steps: vec![super::super::host_domain::HostPlanStep {
                    step: "offending replacement".to_owned(),
                    status: super::super::host_domain::HostPlanStepStatus::InProgress,
                }],
            },
        );
        overflow.event_type = "turn.plan.updated".to_owned();
        overflow.encoded_bytes = ONE_MIB;
        let (failed, projection_failure) = application
            .reduce_and_persist_feat134_event(
                &mut reducer,
                overflow,
                i64::try_from(sequence).unwrap(),
            )
            .await
            .unwrap()
            .unwrap();
        assert!(projection_failure);
        assert_eq!(failed.durable_sequence, Some(sequence));
        assert_eq!(
            failed.plan.as_ref().unwrap().steps[0].step,
            "confirmed replacement 16"
        );
        assert_eq!(
            failed
                .terminal
                .as_ref()
                .and_then(|terminal| terminal.code.as_deref()),
            Some("projection_limit_exceeded")
        );
        assert!(!format!("{failed:?}").contains("offending replacement"));
        let snapshot = application
            .load_feat134_history_snapshot(pending.session_id, None, Some(1))
            .await
            .unwrap();
        assert_eq!(
            snapshot.feat134.turns[0].plan.as_ref().unwrap().steps[0].step,
            "confirmed replacement 16"
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
    fn http_response_bytes(status: &str, headers: &[(&str, &str)], body: &[u8]) -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
            body.len()
        )
        .into_bytes();
        for (name, value) in headers {
            response.extend_from_slice(name.as_bytes());
            response.extend_from_slice(b": ");
            response.extend_from_slice(value.as_bytes());
            response.extend_from_slice(b"\r\n");
        }
        response.extend_from_slice(b"\r\n");
        response.extend_from_slice(body);
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
            DispatchOutcome::TurnFailedSafely {
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
            DispatchOutcome::TurnReconciliationRequired {
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
    async fn feat134_invalid_accepted_response_suspends_without_binding_or_replay() {
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
            DispatchOutcome::TurnReconciliationRequired {
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
            DispatchOutcome::TurnReconciliationRequired {
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
            DispatchOutcome::TurnFailedSafely {
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
            DispatchOutcome::TurnReconciliationRequired {
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
    async fn serve_orphaned_v4_session(
        nonce: &'static str,
        session_body: String,
        stream_id: Uuid,
    ) -> (u16, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let task = tokio::spawn(async move {
            let mut requests = Vec::with_capacity(4);
            for response in [
                ready_response(nonce),
                json_response("200 OK", &session_body),
                ready_response(nonce),
            ] {
                let (mut stream, _) = listener.accept().await.unwrap();
                requests.push(read_request(&mut stream).await);
                stream.write_all(response.as_bytes()).await.unwrap();
                stream.shutdown().await.unwrap();
            }

            let (mut stream, _) = listener.accept().await.unwrap();
            requests.push(read_request(&mut stream).await);
            let headers = format!(
                "HTTP/1.1 200 OK\r\n\
                 Content-Type: text/event-stream\r\n\
                 Cache-Control: no-store\r\n\
                 X-Accel-Buffering: no\r\n\
                 X-Yijie-Event-Schema-Version: 4\r\n\
                 X-Yijie-Event-Stream-ID: {stream_id}\r\n\
                 Connection: close\r\n\r\n"
            );
            stream.write_all(headers.as_bytes()).await.unwrap();
            for _ in 0..50 {
                tokio::time::sleep(Duration::from_millis(50)).await;
                if stream.write_all(b": heartbeat\n\n").await.is_err() {
                    break;
                }
            }
            let _ = stream.shutdown().await;
            requests
        });
        (port, task)
    }

    #[cfg(target_os = "macos")]
    async fn serve_http_bytes(
        responses: Vec<Vec<u8>>,
    ) -> (u16, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let task = tokio::spawn(async move {
            let mut requests = Vec::with_capacity(responses.len());
            for response in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                requests.push(read_request(&mut stream).await);
                stream.write_all(&response).await.unwrap();
                stream.shutdown().await.unwrap();
            }
            requests
        });
        (port, task)
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn feat134_idle_host_without_terminal_replay_closes_orphan_without_duplicate_post() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fa4";
        const TOKEN: &str = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
        let (root, database, pending, turn, agent_session_id) =
            prepare_v2_turn_outbox("feat134-orphan-terminal-replay").await;
        let runtime_turn_id = Uuid::now_v7();
        database
            .suspend_started_turn_retry(turn.operation_id, runtime_turn_id)
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
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let session_body = serde_json::json!({
            "session": {
                "task_id": context.task_id,
                "agent_session_id": agent_session_id,
                "codex_thread_id": context.codex_thread_id,
                "active_turn_id": "",
                "state": "idle",
                "cwd": root.join("project"),
                "model": "MiniMax-M3",
                "model_provider": "minimax",
                "failure_code": "",
                "created_at": "2026-08-28T00:00:00Z",
                "updated_at": "2026-08-28T00:00:01Z"
            }
        })
        .to_string();
        let (port, server) = serve_orphaned_v4_session(NONCE, session_body, Uuid::now_v7()).await;
        let bridge = Arc::new(
            HostBridge::from_connection(HostConnection {
                port,
                token_path,
                instance_nonce: NONCE.to_owned(),
            })
            .unwrap(),
        );
        let application = ConversationApplication::new_with_artifacts_v4(
            database.clone(),
            bridge,
            Arc::new(FixedPublicTaskControlPlane::new([])),
        );

        application
            .stream_active_turn(pending.session_id)
            .await
            .unwrap();
        assert_eq!(
            database.outbox_state(turn.operation_id).await.unwrap(),
            super::super::database::OutboxState::Done
        );
        assert_eq!(
            database.active_turn_context(pending.session_id).await,
            Err(ChatError::NotFound)
        );
        let history = application
            .load_history(pending.session_id, None, None)
            .await
            .unwrap();
        assert_eq!(history.turns[0].status, "failed");
        assert_eq!(
            history.turns[0].reasoning_reason_code.as_deref(),
            Some("host_shutdown")
        );
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 4);
        assert!(requests[1].starts_with(&format!(
            "GET /v1/agent-sessions/{agent_session_id} HTTP/1.1"
        )));
        assert!(requests[3].starts_with(&format!(
            "GET /v4/agent-sessions/{agent_session_id}/events?event_schema_version=4 HTTP/1.1"
        )));
        assert!(!requests.iter().any(|request| request.starts_with("POST ")));

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn v2_transport_loss_retries_same_operation_and_accepts_idempotent_replay() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fb0";
        const TOKEN: &str = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
        let (root, database, pending, claimed, _agent_session_id) =
            prepare_v2_turn_outbox("feat127-lost-response").await;
        let token_directory = root.join("host");
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
        let runtime_turn_id = Uuid::now_v7();
        let (port, server) = serve_http(vec![
            ready_response(NONCE),
            String::new(),
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
        assert_eq!(requests.len(), 4);
        let first_body = requests[1].split("\r\n\r\n").nth(1).unwrap();
        let second_body = requests[3].split("\r\n\r\n").nth(1).unwrap();
        assert_eq!(first_body, second_body);
        let payload: serde_json::Value = serde_json::from_str(first_body).unwrap();
        assert_eq!(
            payload["operation_id"],
            pending.turn_operation_id.to_string()
        );

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
        let (root, database, pending, _claimed, agent_session_id) =
            prepare_v2_turn_outbox("feat127-turn-operation-conflict").await;
        let application = ConversationApplication::new_offline(database.clone());
        assert_eq!(
            application
                .finish_turn_dispatch(
                    unix_seconds().unwrap(),
                    2,
                    pending.turn_operation_id,
                    pending.session_id,
                    agent_session_id,
                    Err(HostBridgeError::rejected(
                        HostErrorCode::TurnOperationConflict,
                    )),
                )
                .await
                .unwrap(),
            DispatchOutcome::FailedSafely {
                operation_id: pending.turn_operation_id
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
        let (root, database, pending, _claimed, agent_session_id) =
            prepare_v2_turn_outbox("feat127-turn-active").await;
        let application = ConversationApplication::new_offline(database.clone());
        assert_eq!(
            application
                .finish_turn_dispatch(
                    unix_seconds().unwrap(),
                    2,
                    pending.turn_operation_id,
                    pending.session_id,
                    agent_session_id,
                    Err(HostBridgeError::rejected(HostErrorCode::TurnActive)),
                )
                .await
                .unwrap(),
            DispatchOutcome::FailedSafely {
                operation_id: pending.turn_operation_id
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
    fn sse_event(
        stream_id: Uuid,
        sequence: u64,
        identity: &EventIdentity,
        item_id: Option<&str>,
        event_type: &str,
        terminal: bool,
        payload: serde_json::Value,
    ) -> String {
        let event_id = Uuid::now_v7();
        let body = serde_json::json!({
            "schema_version": 2,
            "event_id": event_id,
            "stream_id": stream_id,
            "sequence": sequence,
            "occurred_at": "2026-08-03T00:00:00Z",
            "task_id": identity.task_id,
            "agent_session_id": identity.agent_session_id,
            "codex_thread_id": identity.thread_id,
            "turn_id": identity.turn_id,
            "item_id": item_id,
            "event_type": event_type,
            "terminal": terminal,
            "payload": payload,
        });
        format!("id: {stream_id}:{sequence}\nevent: {event_type}\ndata: {body}\n\n")
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn fake_host_application_dispatches_and_persists_complete_local_history() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693f90";
        const TOKEN: &str = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
        let root = std::env::temp_dir().join(format!("yijie-s7b-app-{}", Uuid::now_v7()));
        let project_path = root.join("project");
        let token_directory = root.join("host");
        fs::create_dir_all(&project_path).unwrap();
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
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
        let project_id = Uuid::parse_str(&project.id).unwrap();
        let create_operation_id = Uuid::now_v7();
        let pending = database
            .create_session_and_enqueue(project_id, "首条消息".to_owned(), create_operation_id)
            .await
            .unwrap();
        let task_id = Uuid::now_v7();
        let agent_session_id = Uuid::now_v7();
        let thread_id = Uuid::now_v7();
        let runtime_turn_id = Uuid::now_v7();
        let stream_id = Uuid::now_v7();
        let identity = EventIdentity {
            stream_id,
            task_id,
            agent_session_id,
            thread_id,
            turn_id: runtime_turn_id,
        };
        let session_body = serde_json::json!({
            "session": {
                "task_id": task_id,
                "agent_session_id": agent_session_id,
                "codex_thread_id": thread_id,
                "active_turn_id": "",
                "state": "idle",
                "cwd": project_path,
                "model": "MiniMax-M3",
                "model_provider": "minimax",
                "failure_code": "",
                "created_at": "2026-08-03T00:00:00Z",
                "updated_at": "2026-08-03T00:00:01Z"
            }
        })
        .to_string();
        let mut sse_body = String::new();
        sse_body.push_str(&sse_event(
            stream_id,
            1,
            &identity,
            Some("reasoning-1"),
            "item.reasoning_text.delta",
            false,
            serde_json::json!({"content_index": 0, "delta": "合成推理"}),
        ));
        sse_body.push_str(&sse_event(
            stream_id,
            2,
            &identity,
            Some("reasoning-1"),
            "item.reasoning_text.finalized",
            false,
            serde_json::json!({
                "status": "complete",
                "contents": [{"content_index": 0, "text": "合成推理"}]
            }),
        ));
        sse_body.push_str(&sse_event(
            stream_id,
            3,
            &identity,
            Some("answer-1"),
            "item.agent_message.delta",
            false,
            serde_json::json!({"delta": "合成回答"}),
        ));
        sse_body.push_str(&sse_event(
            stream_id,
            4,
            &identity,
            None,
            "turn.completed",
            true,
            serde_json::json!({"status": "completed"}),
        ));
        let stream_id_header = stream_id.to_string();
        let stream_response = http_response(
            "200 OK",
            &[
                ("Content-Type", "text/event-stream"),
                ("Cache-Control", "no-store"),
                ("X-Accel-Buffering", "no"),
                ("X-Yijie-Event-Schema-Version", "2"),
                ("X-Yijie-Event-Stream-ID", &stream_id_header),
            ],
            &sse_body,
        );
        let (port, server) = serve_http(vec![
            ready_response(NONCE),
            json_response("201 Created", &session_body),
            ready_response(NONCE),
            json_response(
                "202 Accepted",
                &serde_json::json!({"turn_id": runtime_turn_id}).to_string(),
            ),
            ready_response(NONCE),
            stream_response,
        ])
        .await;
        let bridge = Arc::new(
            HostBridge::from_connection(HostConnection {
                port,
                token_path,
                instance_nonce: NONCE.to_owned(),
            })
            .unwrap(),
        );
        let public_tasks = Arc::new(FixedPublicTaskControlPlane::new([
            PublicTaskCreateOutcome::Bound {
                public_task_id: task_id,
            },
        ]));
        let application =
            ConversationApplication::new(database.clone(), bridge, public_tasks.clone());
        assert_eq!(
            application.dispatch_next().await.unwrap(),
            DispatchOutcome::ControlPlaneChanged(PublicTaskControlPlaneStatus {
                session_id: pending.session_id,
                state: PublicTaskBindingState::Bound,
                issue_code: None,
                host_session_bound: false,
            })
        );
        let public_calls = public_tasks.calls();
        assert_eq!(public_calls.len(), 1);
        assert_eq!(public_calls[0].operation_id, create_operation_id);
        assert_eq!(public_calls[0].authorization_revision, 1);
        assert_ne!(public_calls[0].client_reference_id, pending.session_id);
        assert_eq!(
            application.dispatch_next().await.unwrap(),
            DispatchOutcome::SessionBound {
                session_id: pending.session_id,
            }
        );
        assert_eq!(
            application.dispatch_next().await.unwrap(),
            DispatchOutcome::TurnAccepted {
                session_id: pending.session_id
            }
        );
        application
            .stream_active_turn(pending.session_id)
            .await
            .unwrap();
        let history = application
            .load_history(pending.session_id, None, None)
            .await
            .unwrap();
        assert_eq!(history.turns.len(), 1);
        assert_eq!(history.turns[0].messages[0].content, "首条消息");
        assert_eq!(history.turns[0].messages[1].content, "合成回答");
        assert_eq!(history.turns[0].reasoning[0].total_bytes, "合成推理".len());
        assert_eq!(
            database
                .outbox_state(pending.turn_operation_id)
                .await
                .unwrap(),
            super::super::database::OutboxState::Done
        );
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 6);
        assert!(requests[1].contains(&format!("POST /v1/tasks/{task_id}/agent-sessions")));
        assert!(requests[3].contains(r#""input":"首条消息""#));
        assert!(!requests[3].contains("model"));
        assert!(!requests[3].contains("reasoning_effort"));
        assert!(requests[5].contains("event_schema_version=2"));

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn v3_coordinator_uses_one_mixed_stream_and_commits_artifact_before_terminal_cursor() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693f91";
        const TOKEN: &str = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
        let root = std::env::temp_dir().join(format!("yijie-s10b-v3-app-{}", Uuid::now_v7()));
        let project_path = root.join("project");
        let token_directory = root.join("host");
        fs::create_dir_all(&project_path).unwrap();
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
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
        let pending = database
            .create_session_and_enqueue(
                Uuid::parse_str(&project.id).unwrap(),
                "v3 input".to_owned(),
                Uuid::now_v7(),
            )
            .await
            .unwrap();
        let identity = EventIdentity {
            stream_id: Uuid::now_v7(),
            task_id: Uuid::now_v7(),
            agent_session_id: Uuid::now_v7(),
            thread_id: Uuid::now_v7(),
            turn_id: Uuid::now_v7(),
        };
        struct MixedArtifact<'a> {
            id: Uuid,
            kind: &'a str,
            display_name: &'a str,
            media_type: &'a str,
            content: Vec<u8>,
        }
        let mixed_artifacts = [
            MixedArtifact {
                id: Uuid::now_v7(),
                kind: "image",
                display_name: "synthetic.png",
                media_type: "image/png",
                content: include_bytes!("../../icons/32x32.png").to_vec(),
            },
            MixedArtifact {
                id: Uuid::now_v7(),
                kind: "video",
                display_name: "synthetic.mp4",
                media_type: "video/mp4",
                content: b"\0\0\0\x0cftypisom".to_vec(),
            },
            MixedArtifact {
                id: Uuid::now_v7(),
                kind: "file",
                display_name: "synthetic.csv",
                media_type: "text/csv",
                content: b"name,value\nlocal,4\n".to_vec(),
            },
            MixedArtifact {
                id: Uuid::now_v7(),
                kind: "report",
                display_name: "synthetic-report.json",
                media_type: "application/vnd.yijie.report+json;version=1",
                content: br#"{"schema_version":1,"title":"Synthetic","generated_at":"2026-08-20T00:00:00Z","sections":[]}"#.to_vec(),
            },
        ];
        let session_body = serde_json::json!({
            "session": {
                "task_id": identity.task_id,
                "agent_session_id": identity.agent_session_id,
                "codex_thread_id": identity.thread_id,
                "active_turn_id": "",
                "state": "idle",
                "cwd": project_path,
                "model": "MiniMax-M3",
                "model_provider": "minimax",
                "failure_code": "",
                "created_at": "2026-08-20T00:00:00Z",
                "updated_at": "2026-08-20T00:00:01Z"
            }
        })
        .to_string();
        let active_session_body = serde_json::json!({
            "session": {
                "task_id": identity.task_id,
                "agent_session_id": identity.agent_session_id,
                "codex_thread_id": identity.thread_id,
                "active_turn_id": identity.turn_id,
                "state": "active",
                "cwd": project_path,
                "model": "MiniMax-M3",
                "model_provider": "minimax",
                "failure_code": "",
                "created_at": "2026-08-20T00:00:00Z",
                "updated_at": "2026-08-20T00:00:02Z"
            }
        })
        .to_string();
        let frame = |sequence: u64,
                     item_id: Option<&str>,
                     event_type: &str,
                     terminal: bool,
                     payload: serde_json::Value| {
            let event_id = Uuid::now_v7();
            let mut body = serde_json::json!({
                "schema_version": 3,
                "event_id": event_id,
                "stream_id": identity.stream_id,
                "sequence": sequence,
                "occurred_at": "2026-08-20T00:00:02Z",
                "task_id": identity.task_id,
                "agent_session_id": identity.agent_session_id,
                "codex_thread_id": identity.thread_id,
                "turn_id": identity.turn_id,
                "event_type": event_type,
                "terminal": terminal,
                "payload": payload
            });
            if let Some(item_id) = item_id {
                body["item_id"] = serde_json::json!(item_id);
            }
            format!(
                "id: {}:{sequence}\nevent: {event_type}\ndata: {body}\n\n",
                identity.stream_id
            )
        };
        let mut sse_body = String::new();
        sse_body.push_str(&frame(
            1,
            Some("answer"),
            "item.agent_message.delta",
            false,
            serde_json::json!({"delta":"v3 answer"}),
        ));
        let mut sequence = 2_u64;
        for (ordinal, artifact) in mixed_artifacts.iter().enumerate() {
            let item_id = format!("artifact-{}", artifact.id);
            let base_payload = |status: &str| {
                serde_json::json!({
                    "artifact_id": artifact.id,
                    "kind": artifact.kind,
                    "provenance": "synthetic",
                    "status": status,
                    "ordinal": ordinal
                })
            };
            let mut started = base_payload("in_progress");
            started["display_name"] = serde_json::json!(artifact.display_name);
            sse_body.push_str(&frame(
                sequence,
                Some(&item_id),
                "item.artifact.started",
                false,
                started,
            ));
            sequence += 1;
            let mut progress = base_payload("in_progress");
            progress["stage"] = serde_json::json!("generating");
            progress["progress_percent"] = serde_json::json!(50.0);
            sse_body.push_str(&frame(
                sequence,
                Some(&item_id),
                "item.artifact.progress",
                false,
                progress,
            ));
            sequence += 1;
            let mut completed = base_payload("ready");
            completed["display_name"] = serde_json::json!(artifact.display_name);
            completed["media_type"] = serde_json::json!(artifact.media_type);
            completed["size_bytes"] = serde_json::json!(artifact.content.len());
            completed["sha256"] =
                serde_json::json!(format!("{:x}", sha2::Sha256::digest(&artifact.content)));
            completed["content_href"] = serde_json::json!(format!(
                "/v3/agent-sessions/{}/artifacts/{}/content",
                identity.agent_session_id, artifact.id
            ));
            sse_body.push_str(&frame(
                sequence,
                Some(&item_id),
                "item.artifact.completed",
                false,
                completed,
            ));
            sequence += 1;
        }
        sse_body.push_str(&frame(
            sequence,
            None,
            "turn.completed",
            true,
            serde_json::json!({"status":"completed"}),
        ));
        let stream_header = identity.stream_id.to_string();
        let stream_response = http_response(
            "200 OK",
            &[
                ("Content-Type", "text/event-stream"),
                ("Cache-Control", "no-store"),
                ("X-Accel-Buffering", "no"),
                ("X-Yijie-Event-Schema-Version", "3"),
                ("X-Yijie-Event-Stream-ID", &stream_header),
            ],
            &sse_body,
        );
        let mut responses = vec![
            ready_response(NONCE).into_bytes(),
            json_response("201 Created", &session_body).into_bytes(),
            ready_response(NONCE).into_bytes(),
            json_response(
                "202 Accepted",
                &serde_json::json!({"turn_id": identity.turn_id}).to_string(),
            )
            .into_bytes(),
            ready_response(NONCE).into_bytes(),
            json_response("200 OK", &active_session_body).into_bytes(),
            ready_response(NONCE).into_bytes(),
            stream_response.into_bytes(),
        ];
        for artifact in &mixed_artifacts {
            let digest = format!("{:x}", sha2::Sha256::digest(&artifact.content));
            let etag = format!("\"{digest}\"");
            let disposition = format!("attachment; filename={}", artifact.display_name);
            responses.push(ready_response(NONCE).into_bytes());
            responses.push(http_response_bytes(
                "200 OK",
                &[
                    ("Content-Type", artifact.media_type),
                    ("Cache-Control", "no-store"),
                    ("ETag", &etag),
                    ("Content-Disposition", &disposition),
                    ("Accept-Ranges", "bytes"),
                    ("X-Content-Type-Options", "nosniff"),
                ],
                &artifact.content,
            ));
            responses.push(ready_response(NONCE).into_bytes());
            responses.push(
                json_response(
                    "500 Internal Server Error",
                    r#"{"error":{"code":"internal_error","message":"synthetic"}}"#,
                )
                .into_bytes(),
            );
        }
        let (port, server) = serve_http_bytes(responses).await;
        let bridge = Arc::new(
            HostBridge::from_connection(HostConnection {
                port,
                token_path: token_path.clone(),
                instance_nonce: NONCE.to_owned(),
            })
            .unwrap(),
        );
        let public_tasks = Arc::new(FixedPublicTaskControlPlane::new([
            PublicTaskCreateOutcome::Bound {
                public_task_id: identity.task_id,
            },
        ]));
        let application =
            ConversationApplication::new_with_artifacts_v3(database.clone(), bridge, public_tasks);
        assert!(matches!(
            application.dispatch_next().await.unwrap(),
            DispatchOutcome::ControlPlaneChanged(_)
        ));
        assert!(matches!(
            application.dispatch_next().await.unwrap(),
            DispatchOutcome::SessionBound { .. }
        ));
        assert!(matches!(
            application.dispatch_next().await.unwrap(),
            DispatchOutcome::TurnAccepted { .. }
        ));
        application
            .stream_active_turn(pending.session_id)
            .await
            .unwrap();
        let artifacts = database
            .load_artifacts_for_turns(vec![pending.turn_id])
            .await
            .unwrap();
        assert_eq!(artifacts.len(), 4);
        assert_eq!(
            artifacts
                .iter()
                .map(|artifact| (
                    artifact.ordinal,
                    artifact.kind.as_str(),
                    artifact.state.as_str()
                ))
                .collect::<Vec<_>>(),
            vec![
                (0, "image", "ready"),
                (1, "video", "ready"),
                (2, "file", "ready"),
                (3, "report", "ready"),
            ]
        );
        let pending_acks = database.pending_artifact_acknowledgements().await.unwrap();
        assert_eq!(pending_acks.len(), 4);
        let history = application
            .load_history(pending.session_id, None, None)
            .await
            .unwrap();
        assert_eq!(history.turns[0].messages[1].content, "v3 answer");
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 24);
        assert!(requests[7].contains(&format!(
            "/v3/agent-sessions/{}/events?event_schema_version=3",
            identity.agent_session_id
        )));
        assert!(!requests
            .iter()
            .any(|request| request.contains("/v2/agent-sessions")));
        for (index, artifact) in mixed_artifacts.iter().enumerate() {
            assert!(requests[9 + (index * 4)].contains(&format!(
                "/v3/agent-sessions/{}/artifacts/{}/content",
                identity.agent_session_id, artifact.id
            )));
            assert!(requests[11 + (index * 4)].contains(&format!(
                "/v3/agent-sessions/{}/artifacts/{}/ack",
                identity.agent_session_id, artifact.id
            )));
        }
        drop(application);
        let mut recovery_responses = Vec::with_capacity(8);
        for pending_ack in &pending_acks {
            let recovery_body = serde_json::json!({
                "artifact_id": pending_ack.manifest.artifact_id,
                "ack_id": pending_ack.commit.ack_id,
                "status": "acknowledged",
                "cleanup_status": "completed",
                "acknowledged_at": "2026-08-20T00:00:06Z"
            })
            .to_string();
            recovery_responses.push(ready_response(NONCE));
            recovery_responses.push(json_response("200 OK", &recovery_body));
        }
        let (recovery_port, recovery_server) = serve_http(recovery_responses).await;
        let recovery_host = Arc::new(
            HostBridge::from_connection(HostConnection {
                port: recovery_port,
                token_path,
                instance_nonce: NONCE.to_owned(),
            })
            .unwrap(),
        );
        let recovery = ArtifactTransferService::new(recovery_host, database.clone());
        assert_eq!(
            recovery.recover_pending_acknowledgements().await.unwrap(),
            4
        );
        assert!(database
            .pending_artifact_acknowledgements()
            .await
            .unwrap()
            .is_empty());
        let recovery_requests = recovery_server.await.unwrap();
        assert_eq!(recovery_requests.len(), 8);
        for (index, pending_ack) in pending_acks.iter().enumerate() {
            assert!(recovery_requests[1 + (index * 2)].contains(&format!(
                "/v3/agent-sessions/{}/artifacts/{}/ack",
                identity.agent_session_id, pending_ack.manifest.artifact_id
            )));
        }
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn host_restart_rebases_one_stale_stream_cursor_and_commits_failed_terminal() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693fa0";
        const TOKEN: &str = "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
        let root = std::env::temp_dir().join(format!("yijie-r8-stream-rebase-{}", Uuid::now_v7()));
        let project_path = root.join("project");
        let token_directory = root.join("host");
        fs::create_dir_all(&project_path).unwrap();
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
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
        let pending = database
            .create_session_and_enqueue(
                Uuid::parse_str(&project.id).unwrap(),
                "synthetic restart turn".to_owned(),
                Uuid::now_v7(),
            )
            .await
            .unwrap();
        let now = unix_seconds().unwrap();
        let create = database
            .claim_next_conversation_outbox(now, 30)
            .await
            .unwrap()
            .unwrap();
        let task_id = Uuid::now_v7();
        database
            .bind_public_task(create.operation_id, task_id, now)
            .await
            .unwrap();
        database
            .reschedule_outbox(create.operation_id, now)
            .await
            .unwrap();
        let create = database
            .claim_next_conversation_outbox(now, 30)
            .await
            .unwrap()
            .unwrap();
        let agent_session_id = Uuid::now_v7();
        let thread_id = Uuid::now_v7();
        database
            .bind_host_session_and_enqueue_turn(
                create.operation_id,
                task_id,
                agent_session_id,
                thread_id,
            )
            .await
            .unwrap();
        let turn = database
            .claim_next_conversation_outbox(now.max(unix_seconds().unwrap()), 30)
            .await
            .unwrap()
            .unwrap();
        let runtime_turn_id = Uuid::now_v7();
        database
            .suspend_started_turn_retry(turn.operation_id, runtime_turn_id)
            .await
            .unwrap();
        let active = database
            .active_turn_context(pending.session_id)
            .await
            .unwrap();
        let old_cursor = StoredEventCursor {
            stream_id: Uuid::now_v7(),
            sequence: 9,
            event_id: Uuid::now_v7(),
        };
        database
            .persist_turn_progress(TurnProgress {
                local_turn_id: active.turn_id,
                assistant_text: "synthetic partial".to_owned(),
                cursor: old_cursor.clone(),
            })
            .await
            .unwrap();

        let new_stream_id = Uuid::now_v7();
        let identity = EventIdentity {
            stream_id: new_stream_id,
            task_id,
            agent_session_id,
            thread_id,
            turn_id: runtime_turn_id,
        };
        let sse_body = sse_event(
            new_stream_id,
            1,
            &identity,
            None,
            "turn.completed",
            true,
            serde_json::json!({"status": "failed"}),
        );
        let stream_id_header = new_stream_id.to_string();
        let stream_response = http_response(
            "200 OK",
            &[
                ("Content-Type", "text/event-stream"),
                ("Cache-Control", "no-store"),
                ("X-Accel-Buffering", "no"),
                ("X-Yijie-Event-Schema-Version", "2"),
                ("X-Yijie-Event-Stream-ID", &stream_id_header),
            ],
            &sse_body,
        );
        let changed_response = json_response(
            "409 Conflict",
            r#"{"error":{"code":"event_stream_changed","message":"event stream changed after Host restart"}}"#,
        );
        let (port, server) = serve_http(vec![
            ready_response(NONCE),
            changed_response,
            ready_response(NONCE),
            stream_response,
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

        application
            .stream_active_turn(pending.session_id)
            .await
            .unwrap();
        assert_eq!(
            database.outbox_state(turn.operation_id).await.unwrap(),
            super::super::database::OutboxState::Done
        );
        assert_eq!(
            database.active_turn_context(pending.session_id).await,
            Err(ChatError::NotFound)
        );
        let history = application
            .load_history(pending.session_id, None, None)
            .await
            .unwrap();
        assert_eq!(history.turns[0].status, "failed");
        assert_eq!(history.turns[0].messages[1].content, "synthetic partial");

        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 4);
        let stale_request = requests[1].to_ascii_lowercase();
        let fresh_request = requests[3].to_ascii_lowercase();
        assert!(stale_request.contains(&format!(
            "last-event-id: {}:{}",
            old_cursor.stream_id, old_cursor.sequence
        )));
        assert!(!fresh_request.contains("last-event-id:"));
        assert!(
            requests[1].starts_with(&format!("GET /v2/agent-sessions/{agent_session_id}/events"))
        );
        assert!(
            requests[3].starts_with(&format!("GET /v2/agent-sessions/{agent_session_id}/events"))
        );

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn fake_host_coordinator_finishes_durable_content_free_cleanup() {
        const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693f91";
        const TOKEN: &str = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
        let root = std::env::temp_dir().join(format!("yijie-s7c-cleanup-{}", Uuid::now_v7()));
        let project_path = root.join("project");
        let token_directory = root.join("host");
        fs::create_dir_all(&project_path).unwrap();
        fs::create_dir(&token_directory).unwrap();
        fs::set_permissions(&token_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let token_path = token_directory.join("api-token");
        fs::write(&token_path, format!("{TOKEN}\n")).unwrap();
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).unwrap();
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
        let pending = database
            .create_session_and_enqueue(
                Uuid::parse_str(&project.id).unwrap(),
                "cleanup canary prompt".to_owned(),
                Uuid::now_v7(),
            )
            .await
            .unwrap();
        let now = unix_seconds().unwrap();
        let create = database
            .claim_next_conversation_outbox(now, 30)
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
            .claim_next_conversation_outbox(now, 30)
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
            .claim_next_conversation_outbox(now.max(unix_seconds().unwrap()), 30)
            .await
            .unwrap()
            .unwrap();
        database
            .suspend_started_turn_retry(turn.operation_id, Uuid::now_v7())
            .await
            .unwrap();
        let active = database
            .active_turn_context(pending.session_id)
            .await
            .unwrap();
        database
            .commit_terminal_turn(TerminalTurnCommit {
                local_turn_id: active.turn_id,
                terminal_status: "completed".to_owned(),
                terminal_at: now,
                assistant_text: "cleanup canary answer".to_owned(),
                cursor: StoredEventCursor {
                    stream_id: Uuid::now_v7(),
                    sequence: 1,
                    event_id: Uuid::now_v7(),
                },
                reasoning_status: ReasoningStatus::Unavailable,
                reasoning_reason_code: Some("reasoning_not_emitted".to_owned()),
                reasoning_items: Vec::new(),
            })
            .await
            .unwrap();
        let operation_id = Uuid::now_v7();
        let cleanup_body = serde_json::json!({
            "operation_id": operation_id,
            "outcome": "complete",
            "surfaces": {
                "runtime_thread_tree": "complete",
                "host_mapping": "complete",
                "host_replay": "complete"
            }
        })
        .to_string();
        let (port, server) = serve_http(vec![
            ready_response(NONCE),
            json_response("200 OK", &cleanup_body),
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
        application
            .begin_session_deletion(pending.session_id, operation_id)
            .await
            .unwrap();
        let outcome = application.run_background_once().await.unwrap();
        let CoordinatorOutcome::CleanupComplete(receipt) = outcome else {
            panic!("cleanup must finish through the coordinator");
        };
        assert_eq!(receipt.operation_id, operation_id);
        assert_eq!(receipt.outcome_code, "cleanup_complete");
        assert!(application
            .list_sessions(None, None)
            .await
            .unwrap()
            .sessions
            .is_empty());
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].contains(&format!(
            "POST /v2/agent-sessions/{agent_session_id}/cleanup-operations"
        )));
        assert!(!requests[1].contains("cleanup canary"));
        assert!(!format!("{receipt:?}").contains("cleanup canary"));

        drop(application);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }
}
