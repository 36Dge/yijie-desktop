use super::authorization::{ChatAction, ChatAuthorizationManager};
use super::database::{
    ActiveTurnContext, ClaimedDeletion, ClaimedOutbox, CleanupSurfaceState, DeletionStatus,
    HistoryPage, OutboxKind, PendingConversation, ProjectSummary, PublicTaskBindingState,
    PublicTaskControlPlaneStatus, ReasoningItem, ReasoningPart, ReasoningStatus, RecoverySnapshot,
    SessionPage, SessionPageCursor, SessionSummary, StoredEventCursor, TerminalTurnCommit,
    TurnProgress,
};
use super::error::ChatError;
use super::host_bridge::{HostBridge, HostTrace};
use super::host_domain::{
    HostBridgeError, HostBridgeErrorKind, HostCleanupOutcome, HostCleanupReason,
    HostCleanupSurfaceStatus, HostErrorCode, HostEvent, HostEventCursor, HostEventKind,
    HostReasoningPart, HostReasoningReason, HostReasoningStatus, HostSessionState, HostTurnStatus,
};
use super::native_project;
use super::public_tasks::{
    PublicTaskControlPlane, PublicTaskCreateIntent, PublicTaskCreateOutcome, PublicTaskIssueCode,
};
use super::worker::DatabaseWorker;
use std::fmt::{Debug, Formatter};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::watch;
use uuid::Uuid;

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
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DispatchOutcome {
    Idle,
    SessionBound { session_id: Uuid },
    TurnAccepted { session_id: Uuid },
    InterruptAccepted { session_id: Uuid },
    RetryScheduled { operation_id: Uuid },
    FailedSafely { operation_id: Uuid },
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
            .field("running", &self.task.is_some())
            .finish()
    }
}

impl ConversationCoordinator {
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

    fn publish_coordinator(&self, _outcome: &CoordinatorOutcome) -> Result<(), ChatError> {
        Ok(())
    }
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
        }
    }

    pub fn new_offline(database: DatabaseWorker) -> Self {
        Self {
            database,
            host: None,
            public_tasks: None,
        }
    }

    fn host(&self) -> Result<&HostBridge, ChatError> {
        self.host.as_deref().ok_or(ChatError::SidecarUnavailable)
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
                Ok(DispatchOutcome::SessionBound {
                    session_id: dispatch.session_id,
                })
            }
            Ok(_) => {
                self.database.fail_outbox(claimed.operation_id).await?;
                Ok(DispatchOutcome::FailedSafely {
                    operation_id: claimed.operation_id,
                })
            }
            Err(error) => {
                self.handle_dispatch_error(claimed.operation_id, now, error)
                    .await
            }
        }
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
        let dispatch = self
            .database
            .load_start_turn_dispatch(claimed.operation_id)
            .await?;
        let trace = HostTrace {
            request_id: Some(dispatch.operation_id),
            ..HostTrace::default()
        };
        let runtime_turn_id = match self
            .host()?
            .start_turn(dispatch.agent_session_id, &dispatch.input, &trace)
            .await
        {
            Ok(turn_id) => turn_id,
            Err(error) if error.code() == Some(HostErrorCode::TurnActive) => {
                match self.host()?.get_session(dispatch.agent_session_id).await {
                    Ok(session) if session.active_turn_id.is_some() => {
                        session.active_turn_id.expect("checked above")
                    }
                    _ => {
                        self.database.fail_outbox(claimed.operation_id).await?;
                        return Ok(DispatchOutcome::FailedSafely {
                            operation_id: claimed.operation_id,
                        });
                    }
                }
            }
            Err(error) => {
                return self
                    .handle_dispatch_error(claimed.operation_id, now, error)
                    .await;
            }
        };
        self.database
            .suspend_started_turn_retry(dispatch.operation_id, runtime_turn_id)
            .await?;
        Ok(DispatchOutcome::TurnAccepted {
            session_id: dispatch.session_id,
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
        let context = self.database.active_turn_context(session_id).await?;
        let cursor = context
            .cursor
            .as_ref()
            .map(|cursor| HostEventCursor::new(cursor.stream_id, cursor.sequence))
            .transpose()
            .map_err(|_| ChatError::OrchestrationUnavailable)?;
        let mut stream = self
            .host()?
            .open_event_stream_v2(context.agent_session_id, cursor)
            .await
            .map_err(map_host_error)?;
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
            HostEventKind::ItemCompleted { item_type, text } if item_type == "agent_message" => {
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
            | HostEventKind::ItemStarted { .. }
            | HostEventKind::ItemCompleted { .. }
            | HostEventKind::Error { .. }
            | HostEventKind::Warning { .. }
            | HostEventKind::Unknown => {}
        }
        self.expected_stream = Some(event.cursor.stream_id);
        self.last_sequence = event.cursor.sequence;
        self.last_event_id = Some(event.event_id);
        Ok(ReducerOutcome::Progress)
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
    use std::fs;
    #[cfg(target_os = "macos")]
    use std::os::unix::fs::PermissionsExt;
    #[cfg(target_os = "macos")]
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    #[cfg(target_os = "macos")]
    use tokio::net::TcpListener;

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
                session_id: pending.session_id
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
