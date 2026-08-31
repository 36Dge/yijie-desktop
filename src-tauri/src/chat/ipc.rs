use super::application::{
    ArtifactResyncReason, AuthorizedConversationApplication, ConversationApplication,
    ConversationCoordinator, CoordinatorOutcome, DispatchOutcome, LiveTurnProjection,
    TurnProjectionSink,
};
use super::artifact::ArtifactProjection;
use super::attachment::{
    self, AttachmentImportError, AttachmentPreparationProgress, AttachmentPreparationStage,
    PreparedAttachment,
};
use super::authorization::{
    AuthoritativeChatProjection, AuthorizationFailure, ChatAction, ChatAuthorizationManager,
};
use super::database::{
    AttachmentSummary, CleanupSurfaceState, DeletionStatus, DraftContentBlock, DraftTarget,
    Feat134HistorySnapshot, HistoryPage, MessageContentBlockProjection, ProjectSummary,
    PublicTaskBindingState, PublicTaskControlPlaneStatus, ReasoningItem, ReasoningStatus,
    SessionPage, SessionPageCursor, SessionSummary, SessionTitleSource,
};
use super::feat134::{
    Feat134HistoryProjection, Feat134Projection, SourceIdentity, TimelineDelta, TimelineItem,
    TimelineNotice, TimelineNoticeScope, TimelinePlan, TimelineReasoningPart,
};
use super::feat136::{
    CommandCwdProjection, CommandOutputProjection, ExecutionProjection, SafeTextProjection,
    ToolIdentityProjection,
};
use super::feat137::{
    ApprovalIssue, ApprovalProjection, ApprovalProjectionStatus, PendingApprovalSnapshot,
};
use super::host_domain::HostApprovalDecision;
use super::{ChatError, ChatRuntime};
use crate::native_auth::{NativeAuthRuntime, NativeProjectionError};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt::{Debug, Formatter};
use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use uuid::Uuid;

pub const CHAT_IPC_SCHEMA_VERSION: u8 = 1;
pub const CHAT_IPC_V2_SCHEMA_VERSION: u8 = 2;
pub const CHAT_IPC_V3_SCHEMA_VERSION: u8 = 3;
pub const CHAT_IPC_V4_SCHEMA_VERSION: u8 = 4;
pub const CHAT_IPC_V5_SCHEMA_VERSION: u8 = 5;
pub const CHAT_IPC_V6_SCHEMA_VERSION: u8 = 6;
pub const CHAT_EVENT_CHANNEL: &str = "yijie:chat:event:v1";
pub const CHAT_CONTROL_PLANE_EVENT_CHANNEL: &str = "yijie:chat:control-plane:event:v1";
pub const CHAT_ATTACHMENT_IMPORT_EVENT_CHANNEL: &str = "yijie:chat:attachment-import:event:v2";
pub const CHAT_ARTIFACT_LIVE_EVENT_CHANNEL: &str = "yijie:chat:artifact:changed:v1";
const MAX_REQUEST_BYTES: usize = 128 * 1024;
const MAX_INPUT_BYTES: usize = 64 * 1024;
const MAX_TITLE_BYTES: usize = 1024;
const MAX_SESSION_PAGE_BYTES: usize = 512 * 1024;
const MAX_HISTORY_PAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_REASONING_BYTES: usize = 256 * 1024;
const MAX_RESYNC_BYTES: usize = 1280 * 1024;
const MAX_V4_RESYNC_BYTES: usize = 5 * 1024 * 1024;
const V4_RESPONSE_STRUCTURAL_HEADROOM: usize = 128 * 1024;
const DEFAULT_HISTORY_PAGE_LIMIT: usize = 20;
const CURSOR_LIFETIME_SECONDS: i64 = 10 * 60;
const MAX_CURSOR_RECORDS: usize = 512;
const MAX_SUBSCRIPTIONS: usize = 8;
const MAX_EVENT_BATCH: usize = 64;
const MAX_EVENT_BATCH_BYTES: usize = 256 * 1024;
const MAX_ASSISTANT_APPEND_BYTES: usize = 64 * 1024;
const MAX_REASONING_APPEND_BYTES: usize = 16 * 1024;
const MAX_ARTIFACT_NOTIFICATION_QUEUE: usize = 64;
const MAX_V4_EVENT_BYTES: usize = 1200 * 1024;

#[derive(Clone)]
pub struct ChatIpcRuntime {
    inner: Arc<ChatIpcInner>,
}

struct ChatIpcInner {
    process_epoch: Uuid,
    cursors: StdMutex<HashMap<String, CursorRecord>>,
    reads: StdMutex<HashMap<Uuid, bool>>,
    pending_approval_snapshots: StdMutex<HashMap<(Uuid, Uuid, Uuid), PendingApprovalSnapshot>>,
    event_bridge: ChatEventBridge,
    coordinator: Mutex<Option<ConversationCoordinator>>,
    bind_generation: AtomicU64,
    bind_gate: Mutex<()>,
    host_resume_generation: Mutex<Option<String>>,
}

impl Debug for ChatIpcRuntime {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ChatIpcRuntime")
            .field("process_epoch", &self.inner.process_epoch)
            .field("cursor_store", &"[OPAQUE]")
            .field("event_bridge", &self.inner.event_bridge)
            .finish()
    }
}

#[derive(Clone)]
enum CursorValue {
    Sessions(SessionPageCursor),
    History { session_id: Uuid, before: u64 },
}

#[derive(Clone)]
struct CursorRecord {
    context_id: Uuid,
    expires_at: i64,
    value: CursorValue,
}

async fn ensure_host_generation_once<T, E, Acquire, AcquireFuture, Resume, ResumeFuture>(
    state: &Mutex<Option<String>>,
    acquire: Acquire,
    resume: Resume,
) -> Result<(), E>
where
    Acquire: FnOnce() -> AcquireFuture,
    AcquireFuture: Future<Output = Result<(String, T), E>>,
    Resume: FnOnce(T) -> ResumeFuture,
    ResumeFuture: Future<Output = Result<(), E>>,
{
    // Generation discovery and the resume that consumes its exact bridge are
    // one singleflight critical section. A rollover cannot be cached under the
    // generation that preceded it.
    let mut resumed_generation = state.lock().await;
    let (generation, authority) = acquire().await?;
    if resumed_generation.as_deref() == Some(generation.as_str()) {
        return Ok(());
    }
    resume(authority).await?;
    *resumed_generation = Some(generation);
    Ok(())
}

impl ChatIpcRuntime {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(ChatIpcInner {
                process_epoch: Uuid::now_v7(),
                cursors: StdMutex::new(HashMap::new()),
                reads: StdMutex::new(HashMap::new()),
                pending_approval_snapshots: StdMutex::new(HashMap::new()),
                event_bridge: ChatEventBridge::new(),
                coordinator: Mutex::new(None),
                bind_generation: AtomicU64::new(0),
                bind_gate: Mutex::new(()),
                host_resume_generation: Mutex::new(None),
            }),
        }
    }

    fn issue_cursor(
        &self,
        context_id: Uuid,
        value: CursorValue,
        now: i64,
    ) -> Result<String, ChatIpcError> {
        let mut cursors = self
            .inner
            .cursors
            .lock()
            .map_err(|_| ChatIpcError::temporarily_unavailable(None))?;
        cursors.retain(|_, record| record.expires_at > now);
        if cursors.len() >= MAX_CURSOR_RECORDS {
            return Err(ChatIpcError::limit_exceeded(None));
        }
        let token = Uuid::now_v7().simple().to_string();
        cursors.insert(
            token.clone(),
            CursorRecord {
                context_id,
                expires_at: now
                    .checked_add(CURSOR_LIFETIME_SECONDS)
                    .ok_or_else(|| ChatIpcError::request_invalid(None))?,
                value,
            },
        );
        Ok(token)
    }

    fn resolve_session_cursor(
        &self,
        context_id: Uuid,
        token: Option<&str>,
        now: i64,
        request_id: Uuid,
    ) -> Result<Option<SessionPageCursor>, ChatIpcError> {
        let Some(token) = token else {
            return Ok(None);
        };
        let cursors = self
            .inner
            .cursors
            .lock()
            .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request_id)))?;
        match cursors.get(token) {
            Some(CursorRecord {
                context_id: expected_context,
                expires_at,
                value: CursorValue::Sessions(cursor),
            }) if *expected_context == context_id && *expires_at > now => Ok(Some(cursor.clone())),
            _ => Err(ChatIpcError::cursor_invalid(Some(request_id))),
        }
    }

    fn resolve_history_cursor(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        token: Option<&str>,
        now: i64,
        request_id: Uuid,
    ) -> Result<Option<u64>, ChatIpcError> {
        let Some(token) = token else {
            return Ok(None);
        };
        let cursors = self
            .inner
            .cursors
            .lock()
            .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request_id)))?;
        match cursors.get(token) {
            Some(CursorRecord {
                context_id: expected_context,
                expires_at,
                value:
                    CursorValue::History {
                        session_id: expected_session,
                        before,
                    },
            }) if *expected_context == context_id
                && *expected_session == session_id
                && *expires_at > now =>
            {
                Ok(Some(*before))
            }
            _ => Err(ChatIpcError::cursor_invalid(Some(request_id))),
        }
    }

    fn begin_read(&self, request_id: Uuid) -> Result<(), ChatIpcError> {
        let mut reads = self
            .inner
            .reads
            .lock()
            .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request_id)))?;
        if reads.insert(request_id, false).is_some() {
            return Err(ChatIpcError::conflict(Some(request_id)));
        }
        Ok(())
    }

    fn finish_read(&self, request_id: Uuid) -> Result<(), ChatIpcError> {
        let cancelled = self
            .inner
            .reads
            .lock()
            .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request_id)))?
            .remove(&request_id)
            .unwrap_or(true);
        if cancelled {
            Err(ChatIpcError::request_cancelled(Some(request_id)))
        } else {
            Ok(())
        }
    }

    fn cancel_read(&self, target_request_id: Uuid) -> Result<bool, ChatIpcError> {
        let mut reads = self
            .inner
            .reads
            .lock()
            .map_err(|_| ChatIpcError::temporarily_unavailable(None))?;
        Ok(match reads.get_mut(&target_request_id) {
            Some(cancelled) => {
                *cancelled = true;
                true
            }
            None => false,
        })
    }

    fn cache_pending_approval_snapshot(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        subscription_id: Uuid,
        snapshot: PendingApprovalSnapshot,
    ) -> Result<(), ChatIpcError> {
        self.inner
            .pending_approval_snapshots
            .lock()
            .map_err(|_| ChatIpcError::temporarily_unavailable(None))?
            .insert((context_id, session_id, subscription_id), snapshot);
        Ok(())
    }

    fn take_pending_approval_snapshot(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        subscription_id: Uuid,
    ) -> Result<Option<PendingApprovalSnapshot>, ChatIpcError> {
        Ok(self
            .inner
            .pending_approval_snapshots
            .lock()
            .map_err(|_| ChatIpcError::temporarily_unavailable(None))?
            .remove(&(context_id, session_id, subscription_id)))
    }

    fn discard_pending_approval_snapshot(&self, context_id: Uuid, subscription_id: Uuid) {
        if let Ok(mut snapshots) = self.inner.pending_approval_snapshots.lock() {
            snapshots.retain(|(owned_context, _, owned_subscription), _| {
                *owned_context != context_id || *owned_subscription != subscription_id
            });
        }
    }

    async fn ensure_coordinator(
        &self,
        app: AppHandle,
        application: ConversationApplication,
        authorization: ChatAuthorizationManager,
    ) -> Result<(), ChatError> {
        let feat137_streaming_enabled = application.feat137_streaming_enabled();
        self.inner
            .event_bridge
            .configure(app, authorization, feat137_streaming_enabled)
            .map_err(|_| ChatError::OrchestrationUnavailable)?;
        let finished = {
            let mut coordinator = self.inner.coordinator.lock().await;
            if coordinator
                .as_ref()
                .is_some_and(ConversationCoordinator::is_finished)
            {
                coordinator.take()
            } else {
                None
            }
        };
        if let Some(finished) = finished {
            // A completed or panicked coordinator must not permanently occupy the runtime slot.
            // Its join result is diagnostic only; recovery starts from the durable database
            // cursor and therefore never repeats the accepted Host turn.
            let _ = finished.stop().await;
        }
        let mut coordinator = self.inner.coordinator.lock().await;
        if coordinator.is_none() {
            *coordinator = Some(ConversationCoordinator::start_with_projection_sink(
                application,
                Duration::from_millis(50),
                Arc::new(self.inner.event_bridge.clone()),
            )?);
        }
        Ok(())
    }

    async fn ensure_bound_sessions_resumed(&self, runtime: &ChatRuntime) -> Result<(), ChatError> {
        ensure_host_generation_once(
            &self.inner.host_resume_generation,
            || runtime.host_resume_authority(),
            |host| runtime.feat137_resume_bound_sessions_with_host(host),
        )
        .await
    }

    async fn stop_coordinator(&self) -> Result<(), ChatError> {
        let coordinator = self.inner.coordinator.lock().await.take();
        if let Some(coordinator) = coordinator {
            coordinator.stop().await?;
        }
        Ok(())
    }

    pub fn invalidate_all(&self) {
        self.inner.event_bridge.invalidate_all();
        if let Ok(mut cursors) = self.inner.cursors.lock() {
            cursors.clear();
        }
        if let Ok(mut reads) = self.inner.reads.lock() {
            reads.clear();
        }
        if let Ok(mut snapshots) = self.inner.pending_approval_snapshots.lock() {
            snapshots.clear();
        }
    }

    pub fn invalidate_pending_bindings(&self) {
        self.inner.bind_generation.fetch_add(1, Ordering::SeqCst);
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub(crate) async fn feat126_s10_shutdown(&self) -> Result<(), ChatError> {
        if let Some(coordinator) = self.inner.coordinator.lock().await.take() {
            coordinator.stop().await?;
        }
        self.invalidate_pending_bindings();
        self.invalidate_all();
        Ok(())
    }

    fn begin_binding(&self) -> u64 {
        self.inner
            .bind_generation
            .fetch_add(1, Ordering::SeqCst)
            .wrapping_add(1)
    }

    fn begin_fail_closed_binding(
        &self,
        manager: &ChatAuthorizationManager,
    ) -> Result<u64, ChatError> {
        let generation = self.begin_binding();
        let invalidated = manager.invalidate_all();
        self.invalidate_all();
        invalidated?;
        Ok(generation)
    }

    fn begin_scoped_binding(
        &self,
        manager: &ChatAuthorizationManager,
        feat137_enabled: bool,
    ) -> Result<u64, ChatError> {
        if feat137_enabled {
            self.begin_fail_closed_binding(manager)
        } else {
            Ok(self.begin_binding())
        }
    }

    fn binding_is_current(&self, generation: u64) -> bool {
        self.inner.bind_generation.load(Ordering::SeqCst) == generation
    }
}

impl Default for ChatIpcRuntime {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone)]
struct ChatEventBridge {
    inner: Arc<StdMutex<EventBridgeState>>,
}

struct EventBridgeState {
    app: Option<AppHandle>,
    authorization: Option<ChatAuthorizationManager>,
    feat137_streaming_enabled: bool,
    subscriptions: HashMap<Uuid, SubscriptionRecord>,
    cleanup_sessions: HashMap<Uuid, Uuid>,
    control_plane_sequence: u64,
}

struct SubscriptionRecord {
    schema_version: u8,
    context_id: Uuid,
    session_id: Uuid,
    projection_sequence: u64,
    assistant_text: String,
    reasoning: HashMap<(usize, usize), String>,
    terminal: bool,
    blocked: bool,
    artifact_turn_id: Option<Uuid>,
    artifact_notifications: ArtifactNotificationQueue,
}

#[derive(Clone, Copy)]
enum ArtifactNotification {
    Changed {
        event_id: Uuid,
    },
    ResyncRequired {
        event_id: Uuid,
        reason: &'static str,
    },
    ContextInvalidated {
        event_id: Uuid,
    },
}

#[derive(Default)]
struct ArtifactNotificationQueue {
    sequence: u64,
    pending: VecDeque<ArtifactNotification>,
}

impl ArtifactNotificationQueue {
    fn enqueue_changed(&mut self, event_id: Uuid) {
        if self.pending.len() >= MAX_ARTIFACT_NOTIFICATION_QUEUE {
            self.enqueue_resync("backpressure");
            return;
        }
        self.pending
            .push_back(ArtifactNotification::Changed { event_id });
    }

    fn enqueue_resync(&mut self, reason: &'static str) {
        self.pending.clear();
        self.pending
            .push_back(ArtifactNotification::ResyncRequired {
                event_id: Uuid::now_v7(),
                reason,
            });
    }

    fn enqueue_context_invalidated(&mut self) {
        self.pending.clear();
        self.pending
            .push_back(ArtifactNotification::ContextInvalidated {
                event_id: Uuid::now_v7(),
            });
    }

    fn drain(
        &mut self,
        subscription_id: Uuid,
        context_id: Uuid,
        session_id: Uuid,
        turn_id: Uuid,
    ) -> Result<Vec<ArtifactLiveEventDto>, ChatError> {
        let mut events = Vec::with_capacity(self.pending.len());
        while let Some(notification) = self.pending.pop_front() {
            self.sequence = self
                .sequence
                .checked_add(1)
                .ok_or(ChatError::OrchestrationUnavailable)?;
            let (event_id, kind, payload) = match notification {
                ArtifactNotification::Changed { event_id } => {
                    (event_id, "artifact_changed", json!({}))
                }
                ArtifactNotification::ResyncRequired { event_id, reason } => {
                    (event_id, "resync_required", json!({"reason": reason}))
                }
                ArtifactNotification::ContextInvalidated { event_id } => (
                    event_id,
                    "context_invalidated",
                    json!({"reason":"authority_changed"}),
                ),
            };
            events.push(ArtifactLiveEventDto {
                schema_version: 1,
                subscription_id,
                context_id,
                session_id,
                turn_id,
                event_id,
                notification_sequence: self.sequence.to_string(),
                kind,
                payload,
            });
        }
        Ok(events)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactLiveEventDto {
    schema_version: u8,
    subscription_id: Uuid,
    context_id: Uuid,
    session_id: Uuid,
    turn_id: Uuid,
    event_id: Uuid,
    notification_sequence: String,
    kind: &'static str,
    payload: Value,
}

impl Debug for ChatEventBridge {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        let count = self
            .inner
            .lock()
            .map(|state| state.subscriptions.len())
            .unwrap_or_default();
        formatter
            .debug_struct("ChatEventBridge")
            .field("subscription_count", &count)
            .finish()
    }
}

impl ChatEventBridge {
    fn new() -> Self {
        Self {
            inner: Arc::new(StdMutex::new(EventBridgeState {
                app: None,
                authorization: None,
                feat137_streaming_enabled: false,
                subscriptions: HashMap::new(),
                cleanup_sessions: HashMap::new(),
                control_plane_sequence: 0,
            })),
        }
    }

    fn configure(
        &self,
        app: AppHandle,
        authorization: ChatAuthorizationManager,
        feat137_streaming_enabled: bool,
    ) -> Result<(), ()> {
        let mut state = self.inner.lock().map_err(|_| ())?;
        state.app = Some(app);
        state.authorization = Some(authorization);
        state.feat137_streaming_enabled = feat137_streaming_enabled;
        Ok(())
    }

    fn subscribe(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        schema_version: u8,
    ) -> Result<Uuid, ChatIpcError> {
        if !matches!(
            schema_version,
            CHAT_IPC_SCHEMA_VERSION
                | CHAT_IPC_V4_SCHEMA_VERSION
                | CHAT_IPC_V5_SCHEMA_VERSION
                | CHAT_IPC_V6_SCHEMA_VERSION
        ) {
            return Err(ChatIpcError::request_invalid(None));
        }
        let mut state = self
            .inner
            .lock()
            .map_err(|_| ChatIpcError::temporarily_unavailable(None))?;
        if state.subscriptions.len() >= MAX_SUBSCRIPTIONS {
            return Err(ChatIpcError::limit_exceeded(None));
        }
        let subscription_id = Uuid::now_v7();
        state.subscriptions.insert(
            subscription_id,
            SubscriptionRecord {
                schema_version,
                context_id,
                session_id,
                projection_sequence: 0,
                assistant_text: String::new(),
                reasoning: HashMap::new(),
                terminal: false,
                blocked: false,
                artifact_turn_id: None,
                artifact_notifications: ArtifactNotificationQueue::default(),
            },
        );
        Ok(subscription_id)
    }

    fn unsubscribe(&self, context_id: Uuid, subscription_id: Uuid) -> bool {
        self.inner
            .lock()
            .ok()
            .and_then(|mut state| {
                let owned = state
                    .subscriptions
                    .get(&subscription_id)
                    .is_some_and(|record| record.context_id == context_id);
                owned.then(|| state.subscriptions.remove(&subscription_id))
            })
            .flatten()
            .is_some()
    }

    fn owns_subscription(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        subscription_id: Uuid,
        schema_version: u8,
    ) -> bool {
        self.inner.lock().ok().is_some_and(|state| {
            state
                .subscriptions
                .get(&subscription_id)
                .is_some_and(|record| {
                    record.context_id == context_id
                        && record.session_id == session_id
                        && record.schema_version == schema_version
                })
        })
    }

    fn invalidate_all(&self) {
        let (app, events, artifact_events) = match self.inner.lock() {
            Ok(mut state) => {
                let app = state.app.clone();
                let mut events = Vec::new();
                let mut artifact_events = Vec::new();
                for (subscription_id, mut record) in state.subscriptions.drain() {
                    record.projection_sequence += 1;
                    events.push(event_envelope(
                        subscription_id,
                        &record,
                        None,
                        "context_invalidated",
                        json!({"reason":"authority_changed"}),
                    ));
                    if let Some(turn_id) = record.artifact_turn_id {
                        record.artifact_notifications.enqueue_context_invalidated();
                        if let Ok(mut drained) = record.artifact_notifications.drain(
                            subscription_id,
                            record.context_id,
                            record.session_id,
                            turn_id,
                        ) {
                            artifact_events.append(&mut drained);
                        }
                    }
                }
                state.cleanup_sessions.clear();
                (app, events, artifact_events)
            }
            Err(_) => return,
        };
        if let Some(app) = app {
            for event in events {
                let _ = app.emit(CHAT_EVENT_CHANNEL, event);
            }
            let _ = emit_artifact_events(&app, &artifact_events);
        }
    }

    fn track_cleanup(
        &self,
        context_id: Uuid,
        session_id: Uuid,
        status: &DeletionStatus,
    ) -> Result<(), ChatIpcError> {
        let (app, events) = {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| ChatIpcError::temporarily_unavailable(None))?;
            state
                .cleanup_sessions
                .insert(status.operation_id, session_id);
            let app = state.app.clone();
            let mut events = Vec::new();
            for (subscription_id, record) in &mut state.subscriptions {
                if record.schema_version == CHAT_IPC_SCHEMA_VERSION
                    && record.context_id == context_id
                    && record.session_id == session_id
                {
                    record.projection_sequence += 1;
                    events.push(event_envelope(
                        *subscription_id,
                        record,
                        None,
                        "cleanup_state",
                        cleanup_event_payload(status),
                    ));
                }
            }
            (app, events)
        };
        if let Some(app) = app {
            for event in events {
                app.emit(CHAT_EVENT_CHANNEL, event)
                    .map_err(|_| ChatIpcError::temporarily_unavailable(None))?;
            }
        }
        Ok(())
    }

    fn publish_control_plane(
        &self,
        projection: &PublicTaskControlPlaneStatus,
    ) -> Result<(), ChatError> {
        let now = unix_seconds()?;
        let (app, event) = {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
            let app = state
                .app
                .clone()
                .ok_or(ChatError::OrchestrationUnavailable)?;
            let authorization = state
                .authorization
                .clone()
                .ok_or(ChatError::OrchestrationUnavailable)?;
            let authorized = authorization.has_authorized_context(ChatAction::ReadSessions, now)?;
            if !authorized {
                return Ok(());
            }
            state.control_plane_sequence = state
                .control_plane_sequence
                .checked_add(1)
                .ok_or(ChatError::OrchestrationUnavailable)?;
            (
                app,
                ControlPlaneEventDto::from_status(
                    state.control_plane_sequence,
                    projection,
                    state.feat137_streaming_enabled,
                ),
            )
        };
        app.emit(CHAT_CONTROL_PLANE_EVENT_CHANNEL, event)
            .map_err(|_| ChatError::OrchestrationUnavailable)
    }

    fn publish_artifact_notification(
        &self,
        session_id: Uuid,
        turn_id: Uuid,
        notification: ArtifactNotification,
    ) -> Result<(), ChatError> {
        let now = unix_seconds()?;
        let (app, events) = {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
            let app = state
                .app
                .clone()
                .ok_or(ChatError::OrchestrationUnavailable)?;
            let authorization = state
                .authorization
                .clone()
                .ok_or(ChatError::OrchestrationUnavailable)?;
            let subscription_ids = state
                .subscriptions
                .iter()
                .filter_map(|(id, record)| (record.session_id == session_id).then_some(*id))
                .collect::<Vec<_>>();
            let mut events = Vec::new();
            for subscription_id in subscription_ids {
                let Some(record) = state.subscriptions.get_mut(&subscription_id) else {
                    continue;
                };
                record.artifact_turn_id = Some(turn_id);
                if authorization
                    .authorize_detailed(record.context_id, ChatAction::ReadSessions, now)
                    .is_err()
                {
                    record.artifact_notifications.enqueue_context_invalidated();
                } else {
                    match notification {
                        ArtifactNotification::Changed { event_id } => {
                            record.artifact_notifications.enqueue_changed(event_id)
                        }
                        ArtifactNotification::ResyncRequired { reason, .. } => {
                            record.artifact_notifications.enqueue_resync(reason)
                        }
                        ArtifactNotification::ContextInvalidated { .. } => {
                            record.artifact_notifications.enqueue_context_invalidated()
                        }
                    }
                }
                events.append(&mut record.artifact_notifications.drain(
                    subscription_id,
                    record.context_id,
                    record.session_id,
                    turn_id,
                )?);
            }
            (app, events)
        };
        if emit_artifact_events(&app, &events) {
            return Ok(());
        }
        if let Ok(mut state) = self.inner.lock() {
            for event in events {
                if let Some(record) = state.subscriptions.get_mut(&event.subscription_id) {
                    record
                        .artifact_notifications
                        .enqueue_resync("protocol_error");
                }
            }
        }
        Ok(())
    }
}

fn emit_artifact_events(app: &AppHandle, events: &[ArtifactLiveEventDto]) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return events.is_empty();
    };
    events
        .iter()
        .all(|event| window.emit(CHAT_ARTIFACT_LIVE_EVENT_CHANNEL, event).is_ok())
}

impl TurnProjectionSink for ChatEventBridge {
    fn publish(&self, projection: LiveTurnProjection) -> Result<(), ChatError> {
        let now = unix_seconds()?;
        let (app, events) = {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
            let app = state
                .app
                .clone()
                .ok_or(ChatError::OrchestrationUnavailable)?;
            let authorization = state
                .authorization
                .clone()
                .ok_or(ChatError::OrchestrationUnavailable)?;
            let mut events = Vec::new();
            let subscription_ids = state
                .subscriptions
                .iter()
                .filter_map(|(id, record)| {
                    (record.schema_version == CHAT_IPC_SCHEMA_VERSION
                        && record.session_id == projection.session_id)
                        .then_some(*id)
                })
                .collect::<Vec<_>>();
            for subscription_id in subscription_ids {
                let Some(record) = state.subscriptions.get_mut(&subscription_id) else {
                    continue;
                };
                record.artifact_turn_id = Some(projection.turn_id);
                if authorization
                    .authorize_detailed(record.context_id, ChatAction::ReadSessions, now)
                    .is_err()
                {
                    record.projection_sequence += 1;
                    events.push(event_envelope(
                        subscription_id,
                        record,
                        Some(projection.turn_id),
                        "context_invalidated",
                        json!({"reason":"authority_changed"}),
                    ));
                    record.blocked = true;
                    continue;
                }
                if record.blocked || record.terminal {
                    continue;
                }
                let mut candidate = projection_events(subscription_id, record, &projection)?;
                let candidate_bytes = candidate
                    .iter()
                    .try_fold(0_usize, |total, event| {
                        serde_json::to_vec(event)
                            .ok()
                            .and_then(|encoded| total.checked_add(encoded.len()))
                    })
                    .unwrap_or(usize::MAX);
                if candidate.len() > MAX_EVENT_BATCH || candidate_bytes > MAX_EVENT_BATCH_BYTES {
                    record.blocked = true;
                    record.projection_sequence += 1;
                    events.push(event_envelope(
                        subscription_id,
                        record,
                        Some(projection.turn_id),
                        "resync_required",
                        json!({"reason":"backpressure"}),
                    ));
                } else {
                    events.append(&mut candidate);
                }
            }
            (app, events)
        };
        for event in events {
            app.emit(CHAT_EVENT_CHANNEL, event)
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
        }
        Ok(())
    }

    fn publish_feat134(&self, projection: Feat134Projection) -> Result<(), ChatError> {
        let durable_sequence = projection
            .durable_sequence
            .filter(|sequence| *sequence > 0)
            .ok_or(ChatError::DatabaseUnavailable)?;
        let now = unix_seconds()?;
        let (app, events) = {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
            let app = state
                .app
                .clone()
                .ok_or(ChatError::OrchestrationUnavailable)?;
            let authorization = state
                .authorization
                .clone()
                .ok_or(ChatError::OrchestrationUnavailable)?;
            let subscription_ids = state
                .subscriptions
                .iter()
                .filter_map(|(id, record)| {
                    feat134_subscription_matches(record, projection.session_id).then_some(*id)
                })
                .collect::<Vec<_>>();
            let mut events = Vec::new();
            for subscription_id in subscription_ids {
                let Some(record) = state.subscriptions.get_mut(&subscription_id) else {
                    continue;
                };
                record.artifact_turn_id = Some(projection.turn_id);
                if authorization
                    .authorize_detailed(record.context_id, ChatAction::ReadSessions, now)
                    .is_err()
                {
                    record.projection_sequence = record
                        .projection_sequence
                        .checked_add(1)
                        .ok_or(ChatError::OrchestrationUnavailable)?;
                    events.push(event_envelope(
                        subscription_id,
                        record,
                        None,
                        "context_invalidated",
                        json!({"reason":"authority_changed"}),
                    ));
                    record.blocked = true;
                    continue;
                }
                if record.blocked || record.terminal {
                    continue;
                }
                let Some((turn_id, kind, payload, event_id)) = feat134_event_payload(&projection)?
                else {
                    continue;
                };
                record.projection_sequence = record
                    .projection_sequence
                    .checked_add(1)
                    .ok_or(ChatError::OrchestrationUnavailable)?;
                let event = feat134_source_event_envelope(
                    subscription_id,
                    record,
                    turn_id,
                    event_id,
                    durable_sequence,
                    kind,
                    payload,
                );
                let event_bytes = serde_json::to_vec(&event)
                    .map(|encoded| encoded.len())
                    .unwrap_or(usize::MAX);
                if event_bytes > MAX_V4_EVENT_BYTES {
                    record.blocked = true;
                    events.push(event_envelope(
                        subscription_id,
                        record,
                        Some(projection.turn_id),
                        "resync_required",
                        json!({"reason":"backpressure"}),
                    ));
                } else {
                    if matches!(projection.delta, TimelineDelta::TurnTerminal(_)) {
                        record.terminal = true;
                    }
                    events.push(event);
                }
            }
            (app, events)
        };
        for event in events {
            app.emit(CHAT_EVENT_CHANNEL, event)
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
        }
        Ok(())
    }

    fn publish_feat136(&self, projection: Feat134Projection) -> Result<(), ChatError> {
        let durable_sequence = projection
            .durable_sequence
            .filter(|sequence| *sequence > 0)
            .ok_or(ChatError::DatabaseUnavailable)?;
        let now = unix_seconds()?;
        let (app, events) = {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
            let app = state
                .app
                .clone()
                .ok_or(ChatError::OrchestrationUnavailable)?;
            let authorization = state
                .authorization
                .clone()
                .ok_or(ChatError::OrchestrationUnavailable)?;
            let subscription_ids = state
                .subscriptions
                .iter()
                .filter_map(|(id, record)| {
                    (matches!(
                        record.schema_version,
                        CHAT_IPC_V5_SCHEMA_VERSION | CHAT_IPC_V6_SCHEMA_VERSION
                    ) && record.session_id == projection.session_id)
                        .then_some(*id)
                })
                .collect::<Vec<_>>();
            let mut events = Vec::new();
            for subscription_id in subscription_ids {
                let Some(record) = state.subscriptions.get_mut(&subscription_id) else {
                    continue;
                };
                record.artifact_turn_id = Some(projection.turn_id);
                if authorization
                    .authorize_detailed(record.context_id, ChatAction::ReadSessions, now)
                    .is_err()
                {
                    record.projection_sequence = record
                        .projection_sequence
                        .checked_add(1)
                        .ok_or(ChatError::OrchestrationUnavailable)?;
                    events.push(event_envelope(
                        subscription_id,
                        record,
                        None,
                        "context_invalidated",
                        json!({"reason":"authority_changed"}),
                    ));
                    record.blocked = true;
                    continue;
                }
                if record.blocked || record.terminal {
                    continue;
                }
                let Some((turn_id, kind, payload, event_id)) = feat136_event_payload(&projection)?
                else {
                    continue;
                };
                record.projection_sequence = record
                    .projection_sequence
                    .checked_add(1)
                    .ok_or(ChatError::OrchestrationUnavailable)?;
                let event = feat136_source_event_envelope(
                    subscription_id,
                    record,
                    turn_id,
                    event_id,
                    durable_sequence,
                    kind,
                    payload,
                );
                let event_bytes = serde_json::to_vec(&event)
                    .map(|encoded| encoded.len())
                    .unwrap_or(usize::MAX);
                if event_bytes > MAX_V4_EVENT_BYTES {
                    record.blocked = true;
                    events.push(event_envelope(
                        subscription_id,
                        record,
                        Some(projection.turn_id),
                        "resync_required",
                        json!({"reason":"backpressure"}),
                    ));
                } else {
                    if matches!(projection.delta, TimelineDelta::TurnTerminal(_)) {
                        record.terminal = true;
                    }
                    events.push(event);
                }
            }
            (app, events)
        };
        for event in events {
            app.emit(CHAT_EVENT_CHANNEL, event)
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
        }
        Ok(())
    }

    fn publish_feat137(
        &self,
        projection: Feat134Projection,
        approval: Option<ApprovalProjection>,
    ) -> Result<(), ChatError> {
        let durable_sequence = projection
            .durable_sequence
            .filter(|sequence| *sequence > 0)
            .ok_or(ChatError::DatabaseUnavailable)?;
        if approval.as_ref().is_some_and(|approval| {
            approval.session_id != projection.session_id
                || approval.turn_id != projection.turn_id
                || approval.durable_sequence != Some(durable_sequence)
                || approval.source_event_id != projection.cursor.event_id
        }) {
            return Err(ChatError::DatabaseUnavailable);
        }
        let now = unix_seconds()?;
        let (app, events) = {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
            let app = state
                .app
                .clone()
                .ok_or(ChatError::OrchestrationUnavailable)?;
            let authorization = state
                .authorization
                .clone()
                .ok_or(ChatError::OrchestrationUnavailable)?;
            let subscription_ids = state
                .subscriptions
                .iter()
                .filter_map(|(id, record)| {
                    (record.schema_version == CHAT_IPC_V6_SCHEMA_VERSION
                        && record.session_id == projection.session_id)
                        .then_some(*id)
                })
                .collect::<Vec<_>>();
            let mut events = Vec::new();
            for subscription_id in subscription_ids {
                let Some(record) = state.subscriptions.get_mut(&subscription_id) else {
                    continue;
                };
                record.artifact_turn_id = Some(projection.turn_id);
                if authorization
                    .authorize_detailed(record.context_id, ChatAction::ReadSessions, now)
                    .is_err()
                {
                    record.projection_sequence = record
                        .projection_sequence
                        .checked_add(1)
                        .ok_or(ChatError::OrchestrationUnavailable)?;
                    events.push(event_envelope(
                        subscription_id,
                        record,
                        None,
                        "context_invalidated",
                        json!({"reason":"authority_changed"}),
                    ));
                    record.blocked = true;
                    continue;
                }
                if record.blocked || record.terminal {
                    continue;
                }
                let event = if let Some(approval) = approval.as_ref() {
                    Some((
                        Some(approval.turn_id),
                        "approval_changed",
                        approval_projection_payload(approval)?,
                        approval.source_event_id,
                    ))
                } else {
                    feat136_event_payload(&projection)?
                };
                let Some((turn_id, kind, payload, event_id)) = event else {
                    continue;
                };
                record.projection_sequence = record
                    .projection_sequence
                    .checked_add(1)
                    .ok_or(ChatError::OrchestrationUnavailable)?;
                let event = if approval.is_some() {
                    source_event_envelope(
                        subscription_id,
                        record,
                        turn_id,
                        event_id,
                        durable_sequence,
                        kind,
                        payload,
                    )
                } else {
                    feat136_source_event_envelope(
                        subscription_id,
                        record,
                        turn_id,
                        event_id,
                        durable_sequence,
                        kind,
                        payload,
                    )
                };
                let event_bytes = serde_json::to_vec(&event)
                    .map(|encoded| encoded.len())
                    .unwrap_or(usize::MAX);
                if event_bytes > MAX_V4_EVENT_BYTES {
                    record.blocked = true;
                    events.push(event_envelope(
                        subscription_id,
                        record,
                        Some(projection.turn_id),
                        "resync_required",
                        json!({"reason":"backpressure"}),
                    ));
                } else {
                    if matches!(projection.delta, TimelineDelta::TurnTerminal(_)) {
                        record.terminal = true;
                    }
                    events.push(event);
                }
            }
            (app, events)
        };
        for event in events {
            app.emit(CHAT_EVENT_CHANNEL, event)
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
        }
        Ok(())
    }

    fn publish_coordinator(&self, outcome: &CoordinatorOutcome) -> Result<(), ChatError> {
        if let CoordinatorOutcome::Dispatched(DispatchOutcome::ControlPlaneChanged(status)) =
            outcome
        {
            return self.publish_control_plane(status);
        }
        if let Some((session_id, turn_id)) = turn_resync_target(outcome) {
            let now = unix_seconds()?;
            let (app, events) = {
                let mut state = self
                    .inner
                    .lock()
                    .map_err(|_| ChatError::OrchestrationUnavailable)?;
                let app = state
                    .app
                    .clone()
                    .ok_or(ChatError::OrchestrationUnavailable)?;
                let authorization = state
                    .authorization
                    .clone()
                    .ok_or(ChatError::OrchestrationUnavailable)?;
                let plan =
                    turn_resync_subscription_plan(&state.subscriptions, session_id, |context_id| {
                        authorization
                            .authorize_detailed(context_id, ChatAction::ReadSessions, now)
                            .is_ok()
                    });
                let mut events = Vec::with_capacity(plan.len());
                for (subscription_id, action) in plan {
                    let record = state
                        .subscriptions
                        .get_mut(&subscription_id)
                        .ok_or(ChatError::OrchestrationUnavailable)?;
                    events.push(turn_resync_control_event(
                        subscription_id,
                        record,
                        turn_id,
                        action,
                    )?);
                }
                (app, events)
            };
            for event in events {
                app.emit(CHAT_EVENT_CHANNEL, event)
                    .map_err(|_| ChatError::OrchestrationUnavailable)?;
            }
            return Ok(());
        }
        let now = unix_seconds()?;
        let (operation_id, status, terminal) = match outcome {
            CoordinatorOutcome::CleanupRetryScheduled { operation_id } => {
                (*operation_id, "retry_scheduled", false)
            }
            CoordinatorOutcome::CleanupComplete(status) => (status.operation_id, "complete", true),
            CoordinatorOutcome::Idle
            | CoordinatorOutcome::Dispatched(_)
            | CoordinatorOutcome::StreamRecovered { .. } => return Ok(()),
        };
        let (app, events) = {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
            let Some(session_id) = state.cleanup_sessions.get(&operation_id).copied() else {
                return Ok(());
            };
            let app = state
                .app
                .clone()
                .ok_or(ChatError::OrchestrationUnavailable)?;
            let authorization = state
                .authorization
                .clone()
                .ok_or(ChatError::OrchestrationUnavailable)?;
            let mut events = Vec::new();
            for (subscription_id, record) in &mut state.subscriptions {
                if record.schema_version == CHAT_IPC_SCHEMA_VERSION
                    && record.session_id == session_id
                {
                    if authorization
                        .authorize_detailed(record.context_id, ChatAction::ReadCleanup, now)
                        .is_err()
                    {
                        record.projection_sequence += 1;
                        events.push(event_envelope(
                            *subscription_id,
                            record,
                            None,
                            "context_invalidated",
                            json!({"reason":"authority_changed"}),
                        ));
                        record.blocked = true;
                        continue;
                    }
                    record.projection_sequence += 1;
                    events.push(event_envelope(
                        *subscription_id,
                        record,
                        None,
                        "cleanup_state",
                        json!({
                            "operationId": operation_id.to_string(),
                            "state": status
                        }),
                    ));
                }
            }
            if terminal {
                state.cleanup_sessions.remove(&operation_id);
            }
            (app, events)
        };
        for event in events {
            app.emit(CHAT_EVENT_CHANNEL, event)
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
        }
        Ok(())
    }

    fn publish_artifact_changed(
        &self,
        session_id: Uuid,
        turn_id: Uuid,
        event_id: Uuid,
    ) -> Result<(), ChatError> {
        let _ = self.publish_artifact_notification(
            session_id,
            turn_id,
            ArtifactNotification::Changed { event_id },
        );
        Ok(())
    }

    fn publish_artifact_resync_required(
        &self,
        session_id: Uuid,
        turn_id: Uuid,
        reason: ArtifactResyncReason,
    ) -> Result<(), ChatError> {
        let reason = match reason {
            ArtifactResyncReason::SequenceGap => "sequence_gap",
            ArtifactResyncReason::ProtocolError => "protocol_error",
        };
        let _ = self.publish_artifact_notification(
            session_id,
            turn_id,
            ArtifactNotification::ResyncRequired {
                event_id: Uuid::now_v7(),
                reason,
            },
        );
        Ok(())
    }
}

fn turn_resync_target(outcome: &CoordinatorOutcome) -> Option<(Uuid, Uuid)> {
    match outcome {
        CoordinatorOutcome::Dispatched(DispatchOutcome::TurnFailedSafely {
            session_id,
            turn_id,
            ..
        })
        | CoordinatorOutcome::Dispatched(DispatchOutcome::TurnReconciliationRequired {
            session_id,
            turn_id,
            ..
        }) => Some((*session_id, *turn_id)),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TurnResyncSubscriptionAction {
    ResyncRequired,
    ContextInvalidated,
}

fn turn_resync_subscription_plan<F>(
    subscriptions: &HashMap<Uuid, SubscriptionRecord>,
    session_id: Uuid,
    mut is_authorized: F,
) -> Vec<(Uuid, TurnResyncSubscriptionAction)>
where
    F: FnMut(Uuid) -> bool,
{
    let mut plan = subscriptions
        .iter()
        .filter_map(|(subscription_id, record)| {
            if !matches!(
                record.schema_version,
                CHAT_IPC_V4_SCHEMA_VERSION
                    | CHAT_IPC_V5_SCHEMA_VERSION
                    | CHAT_IPC_V6_SCHEMA_VERSION
            ) || record.session_id != session_id
                || record.blocked
                || record.terminal
            {
                return None;
            }
            let action = if is_authorized(record.context_id) {
                TurnResyncSubscriptionAction::ResyncRequired
            } else {
                TurnResyncSubscriptionAction::ContextInvalidated
            };
            Some((*subscription_id, action))
        })
        .collect::<Vec<_>>();
    plan.sort_unstable_by_key(|(subscription_id, _)| *subscription_id);
    plan
}

fn turn_resync_control_event(
    subscription_id: Uuid,
    record: &mut SubscriptionRecord,
    turn_id: Uuid,
    action: TurnResyncSubscriptionAction,
) -> Result<ChatEventEnvelope, ChatError> {
    record.projection_sequence = record
        .projection_sequence
        .checked_add(1)
        .ok_or(ChatError::OrchestrationUnavailable)?;
    record.blocked = true;
    let (kind, payload) = match action {
        TurnResyncSubscriptionAction::ResyncRequired => {
            ("resync_required", json!({"reason":"protocol_error"}))
        }
        TurnResyncSubscriptionAction::ContextInvalidated => {
            ("context_invalidated", json!({"reason":"authority_changed"}))
        }
    };
    Ok(event_envelope(
        subscription_id,
        record,
        Some(turn_id),
        kind,
        payload,
    ))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatEventEnvelope {
    schema_version: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_schema_version: Option<u8>,
    subscription_id: String,
    context_id: String,
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    turn_id: Option<String>,
    projection_sequence: String,
    event_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    durable_sequence: Option<String>,
    kind: &'static str,
    payload: Value,
}

fn event_envelope(
    subscription_id: Uuid,
    record: &SubscriptionRecord,
    turn_id: Option<Uuid>,
    kind: &'static str,
    payload: Value,
) -> ChatEventEnvelope {
    ChatEventEnvelope {
        schema_version: record.schema_version,
        source_schema_version: None,
        subscription_id: subscription_id.to_string(),
        context_id: record.context_id.to_string(),
        session_id: record.session_id.to_string(),
        turn_id: turn_id.map(|id| id.to_string()),
        projection_sequence: record.projection_sequence.to_string(),
        event_id: Uuid::now_v7().to_string(),
        durable_sequence: None,
        kind,
        payload,
    }
}

fn feat134_subscription_matches(record: &SubscriptionRecord, session_id: Uuid) -> bool {
    matches!(
        record.schema_version,
        CHAT_IPC_V4_SCHEMA_VERSION | CHAT_IPC_V5_SCHEMA_VERSION | CHAT_IPC_V6_SCHEMA_VERSION
    ) && record.session_id == session_id
}

fn source_event_envelope(
    subscription_id: Uuid,
    record: &SubscriptionRecord,
    turn_id: Option<Uuid>,
    event_id: Uuid,
    durable_sequence: u64,
    kind: &'static str,
    payload: Value,
) -> ChatEventEnvelope {
    ChatEventEnvelope {
        schema_version: record.schema_version,
        source_schema_version: None,
        subscription_id: subscription_id.to_string(),
        context_id: record.context_id.to_string(),
        session_id: record.session_id.to_string(),
        turn_id: turn_id.map(|id| id.to_string()),
        projection_sequence: record.projection_sequence.to_string(),
        event_id: event_id.to_string(),
        durable_sequence: Some(durable_sequence.to_string()),
        kind,
        payload,
    }
}

fn feat134_source_event_envelope(
    subscription_id: Uuid,
    record: &SubscriptionRecord,
    turn_id: Option<Uuid>,
    event_id: Uuid,
    durable_sequence: u64,
    kind: &'static str,
    payload: Value,
) -> ChatEventEnvelope {
    let mut envelope = source_event_envelope(
        subscription_id,
        record,
        turn_id,
        event_id,
        durable_sequence,
        kind,
        payload,
    );
    if record.schema_version >= CHAT_IPC_V5_SCHEMA_VERSION {
        envelope.source_schema_version = Some(CHAT_IPC_V4_SCHEMA_VERSION);
    }
    envelope
}

fn feat136_source_event_envelope(
    subscription_id: Uuid,
    record: &SubscriptionRecord,
    turn_id: Option<Uuid>,
    event_id: Uuid,
    durable_sequence: u64,
    kind: &'static str,
    payload: Value,
) -> ChatEventEnvelope {
    let mut envelope = source_event_envelope(
        subscription_id,
        record,
        turn_id,
        event_id,
        durable_sequence,
        kind,
        payload,
    );
    if record.schema_version == CHAT_IPC_V6_SCHEMA_VERSION {
        envelope.source_schema_version = Some(CHAT_IPC_V5_SCHEMA_VERSION);
    }
    envelope
}

fn source_fact(source: &SourceIdentity) -> Value {
    json!({
        "sourceEventId": source.event_id.to_string(),
        "sourceSequence": source.sequence.to_string(),
        "sourceOccurredAt": source.occurred_at,
    })
}

fn timeline_item_lifecycle_payload(item: &TimelineItem) -> Value {
    json!({
        "sourceEventId": item.source_event_id.to_string(),
        "sourceSequence": item.source_sequence.to_string(),
        "sourceOccurredAt": item.source_occurred_at,
        "itemId": item.item_id,
        "itemOrdinal": item.item_ordinal,
        "itemType": item.item_type,
        "phase": item.phase.map(|phase| phase.as_str()),
        "text": (item.item_type == "agentMessage").then_some(item.text.as_str()),
    })
}

fn plan_payload(plan: &TimelinePlan) -> Value {
    json!({
        "sourceEventId": plan.source_event_id.to_string(),
        "sourceSequence": plan.source_sequence.to_string(),
        "sourceOccurredAt": plan.source_occurred_at,
        "explanation": plan.explanation,
        "steps": plan.steps.iter().map(|step| json!({
            "ordinal": step.ordinal,
            "step": step.step,
            "status": step.status,
        })).collect::<Vec<_>>(),
    })
}

fn notice_payload(notice: &TimelineNotice, include_observed_at: bool) -> Value {
    let mut payload = json!({
        "sourceEventId": notice.source_event_id.to_string(),
        "sourceSequence": notice.source_sequence.to_string(),
        "sourceOccurredAt": notice.source_occurred_at,
        "scope": notice.scope.as_str(),
        "severity": notice.severity.as_str(),
        "code": notice.code,
        "willRetry": notice.will_retry,
    });
    if include_observed_at {
        payload["observedAtMs"] = json!(notice.observed_at_ms);
    }
    payload
}

fn reasoning_parts_payload(parts: &[TimelineReasoningPart]) -> Vec<Value> {
    parts
        .iter()
        .map(|part| {
            json!({
                "contentIndex": part.content_index,
                "text": part.text,
            })
        })
        .collect()
}

type Feat134EventPayload = (Option<Uuid>, &'static str, Value, Uuid);

fn feat134_event_payload(
    projection: &Feat134Projection,
) -> Result<Option<Feat134EventPayload>, ChatError> {
    let turn_id = Some(projection.turn_id);
    let event = match &projection.delta {
        TimelineDelta::Ignored => return Ok(None),
        TimelineDelta::TurnStarted(source) => (
            turn_id,
            "turn_started",
            source_fact(source),
            source.event_id,
        ),
        TimelineDelta::PlanUpdated(plan) => (
            turn_id,
            "plan_updated",
            plan_payload(plan),
            plan.source_event_id,
        ),
        TimelineDelta::ItemStarted(item) => (
            turn_id,
            "item_started",
            timeline_item_lifecycle_payload(item),
            item.source_event_id,
        ),
        TimelineDelta::ItemCompleted(item) => (
            turn_id,
            "item_completed",
            timeline_item_lifecycle_payload(item),
            item.source_event_id,
        ),
        TimelineDelta::AgentMessageAppend {
            source,
            item_id,
            item_ordinal,
            phase,
            text,
        } => (
            turn_id,
            "agent_message_append",
            json!({
                "sourceEventId": source.event_id.to_string(),
                "sourceSequence": source.sequence.to_string(),
                "sourceOccurredAt": source.occurred_at,
                "itemId": item_id,
                "itemOrdinal": item_ordinal,
                "phase": phase.map(|value| value.as_str()),
                "text": text,
            }),
            source.event_id,
        ),
        TimelineDelta::ReasoningAppend {
            source,
            item_id,
            item_ordinal,
            content_index,
            text,
        } => (
            turn_id,
            "reasoning_append",
            json!({
                "sourceEventId": source.event_id.to_string(),
                "sourceSequence": source.sequence.to_string(),
                "sourceOccurredAt": source.occurred_at,
                "itemId": item_id,
                "itemOrdinal": item_ordinal,
                "contentIndex": content_index,
                "text": text,
            }),
            source.event_id,
        ),
        TimelineDelta::ReasoningFinalized {
            source,
            item_id,
            item_ordinal,
            status,
            reason_code,
            parts,
        } => (
            turn_id,
            "reasoning_finalized",
            json!({
                "sourceEventId": source.event_id.to_string(),
                "sourceSequence": source.sequence.to_string(),
                "sourceOccurredAt": source.occurred_at,
                "itemId": item_id,
                "itemOrdinal": item_ordinal,
                "status": status.as_str(),
                "reasonCode": reason_code,
                "parts": reasoning_parts_payload(parts),
            }),
            source.event_id,
        ),
        TimelineDelta::CommandStarted(_)
        | TimelineDelta::CommandOutputAppend { .. }
        | TimelineDelta::CommandCompleted(_)
        | TimelineDelta::ToolStarted(_)
        | TimelineDelta::ToolProgress { .. }
        | TimelineDelta::ToolCompleted(_) => return Err(ChatError::OrchestrationUnavailable),
        TimelineDelta::Notice(notice) => (
            (notice.scope == TimelineNoticeScope::Turn).then_some(projection.turn_id),
            "notice",
            notice_payload(notice, false),
            notice.source_event_id,
        ),
        TimelineDelta::TurnTerminal(terminal) => (
            turn_id,
            "turn_terminal",
            json!({
                "sourceEventId": terminal.source_event_id.to_string(),
                "sourceSequence": terminal.source_sequence.to_string(),
                "sourceOccurredAt": terminal.source_occurred_at,
                "status": terminal.status,
                "code": terminal.code,
                "unfinishedReasoningReasonCode": terminal.unfinished_reasoning_reason_code,
            }),
            terminal.source_event_id,
        ),
    };
    if projection.source_turn_id.is_none()
        && !matches!(projection.delta, TimelineDelta::Notice(ref notice) if notice.scope == TimelineNoticeScope::Session)
    {
        return Err(ChatError::OrchestrationUnavailable);
    }
    Ok(Some(event))
}

fn feat136_event_payload(
    projection: &Feat134Projection,
) -> Result<Option<Feat134EventPayload>, ChatError> {
    let turn_id = Some(projection.turn_id);
    let event = match &projection.delta {
        TimelineDelta::CommandStarted(item) => {
            let ExecutionProjection::Command(command) = item
                .execution
                .as_ref()
                .ok_or(ChatError::DatabaseUnavailable)?
            else {
                return Err(ChatError::DatabaseUnavailable);
            };
            (
                turn_id,
                "command_started",
                execution_item_source_payload(
                    item,
                    json!({
                        "status": command.status.as_str(),
                        "commandSummary": safe_text_payload(&command.command_summary),
                        "cwd": cwd_payload(&command.cwd),
                    }),
                ),
                item.source_event_id,
            )
        }
        TimelineDelta::CommandOutputAppend {
            source,
            item_id,
            item_ordinal,
            delta,
        } => (
            turn_id,
            "command_output_append",
            json!({
                "sourceEventId": source.event_id.to_string(),
                "sourceSequence": source.sequence.to_string(),
                "sourceOccurredAt": source.occurred_at,
                "itemId": item_id,
                "itemOrdinal": item_ordinal,
                "text": delta.text,
                "truncated": delta.truncated,
                "truncationReason": delta.truncation_reason.map(|reason| reason.as_str()),
            }),
            source.event_id,
        ),
        TimelineDelta::CommandCompleted(item) => {
            let ExecutionProjection::Command(command) = item
                .execution
                .as_ref()
                .ok_or(ChatError::DatabaseUnavailable)?
            else {
                return Err(ChatError::DatabaseUnavailable);
            };
            let output = command
                .output
                .as_ref()
                .ok_or(ChatError::DatabaseUnavailable)?;
            (
                turn_id,
                "command_completed",
                execution_item_source_payload(
                    item,
                    json!({
                        "status": command.status.as_str(),
                        "commandSummary": safe_text_payload(&command.command_summary),
                        "cwd": cwd_payload(&command.cwd),
                        "durationMs": command.duration_ms,
                        "exitCode": command.exit_code,
                        "output": command_output_payload(output),
                        "error": command.error.as_ref().map(execution_error_payload),
                    }),
                ),
                item.source_event_id,
            )
        }
        TimelineDelta::ToolStarted(item) => {
            let ExecutionProjection::Tool(tool) = item
                .execution
                .as_ref()
                .ok_or(ChatError::DatabaseUnavailable)?
            else {
                return Err(ChatError::DatabaseUnavailable);
            };
            (
                turn_id,
                "tool_started",
                execution_item_source_payload(
                    item,
                    json!({
                        "status": tool.status.as_str(),
                        "identity": tool_identity_payload(&tool.identity),
                        "argumentsSummary": safe_text_payload(&tool.arguments_summary),
                    }),
                ),
                item.source_event_id,
            )
        }
        TimelineDelta::ToolProgress {
            item_id,
            item_ordinal,
            progress,
        } => {
            let item = projection
                .items
                .iter()
                .find(|item| item.item_id == *item_id)
                .ok_or(ChatError::DatabaseUnavailable)?;
            let ExecutionProjection::Tool(tool) = item
                .execution
                .as_ref()
                .ok_or(ChatError::DatabaseUnavailable)?
            else {
                return Err(ChatError::DatabaseUnavailable);
            };
            (
                turn_id,
                "tool_progress",
                json!({
                    "sourceEventId": progress.source.event_id.to_string(),
                    "sourceSequence": progress.source.sequence.to_string(),
                    "sourceOccurredAt": progress.source.occurred_at,
                    "itemId": item_id,
                    "itemOrdinal": item_ordinal,
                    "status": tool.status.as_str(),
                    "identity": tool_identity_payload(&tool.identity),
                    "progressIndex": progress.progress_index,
                    "summary": safe_text_payload(&progress.summary),
                }),
                progress.source.event_id,
            )
        }
        TimelineDelta::ToolCompleted(item) => {
            let ExecutionProjection::Tool(tool) = item
                .execution
                .as_ref()
                .ok_or(ChatError::DatabaseUnavailable)?
            else {
                return Err(ChatError::DatabaseUnavailable);
            };
            (
                turn_id,
                "tool_completed",
                execution_item_source_payload(
                    item,
                    json!({
                        "status": tool.status.as_str(),
                        "identity": tool_identity_payload(&tool.identity),
                        "argumentsSummary": safe_text_payload(&tool.arguments_summary),
                        "durationMs": tool.duration_ms,
                        "resultSummary": tool.result_summary.as_ref().map(safe_text_payload),
                        "error": tool.error.as_ref().map(execution_error_payload),
                    }),
                ),
                item.source_event_id,
            )
        }
        _ => return feat134_event_payload(projection),
    };
    Ok(Some(event))
}

fn execution_item_source_payload(item: &TimelineItem, fields: Value) -> Value {
    let mut value = json!({
        "sourceEventId": item.source_event_id.to_string(),
        "sourceSequence": item.source_sequence.to_string(),
        "sourceOccurredAt": item.source_occurred_at,
        "itemId": item.item_id,
        "itemOrdinal": item.item_ordinal,
    });
    if let (Some(target), Some(fields)) = (value.as_object_mut(), fields.as_object()) {
        target.extend(fields.clone());
    }
    value
}

fn source_identity_payload(source: &SourceIdentity) -> Value {
    json!({
        "sourceEventId": source.event_id.to_string(),
        "sourceSequence": source.sequence.to_string(),
        "sourceOccurredAt": source.occurred_at,
    })
}

fn safe_text_payload(value: &SafeTextProjection) -> Value {
    json!({
        "text": value.text,
        "truncated": value.truncated,
        "truncationReason": value.truncation_reason.map(|reason| reason.as_str()),
    })
}

fn cwd_payload(value: &CommandCwdProjection) -> Value {
    json!({
        "kind": value.kind(),
        "segments": value.segments(),
    })
}

fn command_output_payload(value: &CommandOutputProjection) -> Value {
    match value {
        CommandOutputProjection::Complete { text } => json!({
            "retention": "complete", "text": text, "head": null, "tail": null,
            "reason": null, "truncated": false, "truncationReason": null,
        }),
        CommandOutputProjection::HeadTail { head, tail, reason } => json!({
            "retention": "head_tail", "text": null, "head": head, "tail": tail,
            "reason": null, "truncated": true, "truncationReason": reason.as_str(),
        }),
        CommandOutputProjection::Unavailable => json!({
            "retention": "unavailable", "text": null, "head": null, "tail": null,
            "reason": "not_available", "truncated": false, "truncationReason": null,
        }),
    }
}

fn tool_identity_payload(value: &ToolIdentityProjection) -> Value {
    let (server_name, tool_name) = value.names();
    json!({
        "resolution": value.resolution(),
        "serverName": server_name,
        "toolName": tool_name,
    })
}

fn execution_error_payload(value: &super::feat136::ProjectionError) -> Value {
    json!({"code": value.code.as_str(), "summary": value.summary})
}

fn approval_projection_payload(approval: &ApprovalProjection) -> Result<Value, ChatError> {
    let durable_sequence = approval
        .durable_sequence
        .filter(|sequence| *sequence > 0)
        .ok_or(ChatError::DatabaseUnavailable)?;
    let mut value = json!({
        "sourceEventId": approval.source_event_id.to_string(),
        "sourceSequence": approval.source_sequence.to_string(),
        "sourceOccurredAt": approval.source_occurred_at,
        "turnId": approval.turn_id.to_string(),
        "itemId": approval.item_id,
        "approvalRequestId": approval.approval_request_id.to_string(),
        "status": approval.status.as_str(),
        "revision": approval.revision,
        "actionId": super::feat137::ACTION_ID,
        "workspaceScope": super::feat137::WORKSPACE_SCOPE,
        "requestedAt": approval.requested_at,
        "expiresAt": approval.expires_at,
    });
    let object = value
        .as_object_mut()
        .ok_or(ChatError::DatabaseUnavailable)?;
    match approval.status {
        ApprovalProjectionStatus::Pending => {
            object.insert(
                "decisions".to_owned(),
                json!({
                    "primary": super::feat137::PRIMARY_DECISION,
                    "secondary": super::feat137::SECONDARY_DECISION,
                }),
            );
            object.insert("ttlSeconds".to_owned(), json!(super::feat137::TTL_SECONDS));
        }
        ApprovalProjectionStatus::Resolved => {
            object.insert(
                "outcome".to_owned(),
                json!(approval
                    .outcome
                    .ok_or(ChatError::DatabaseUnavailable)?
                    .as_str()),
            );
            object.insert(
                "resolvedAt".to_owned(),
                json!(approval
                    .resolved_at
                    .as_deref()
                    .ok_or(ChatError::DatabaseUnavailable)?),
            );
            match (approval.decision_id, approval.decision) {
                (Some(decision_id), Some(decision)) => {
                    object.insert("decisionId".to_owned(), json!(decision_id.to_string()));
                    object.insert("decision".to_owned(), json!(decision.as_str()));
                }
                (None, None) => {}
                _ => return Err(ChatError::DatabaseUnavailable),
            }
        }
    }
    let _ = durable_sequence;
    Ok(value)
}

fn execution_payload(value: &ExecutionProjection) -> Value {
    match value {
        ExecutionProjection::Command(command) => json!({
            "kind": "command",
            "status": command.status.as_str(),
            "startedSource": source_identity_payload(&command.started_source),
            "lastSource": source_identity_payload(&command.last_source),
            "commandSummary": safe_text_payload(&command.command_summary),
            "cwd": cwd_payload(&command.cwd),
            "liveOutput": command.live_output.as_ref().map(safe_text_payload),
            "output": command.output.as_ref().map(command_output_payload),
            "durationMs": command.duration_ms,
            "exitCode": command.exit_code,
            "error": command.error.as_ref().map(execution_error_payload),
        }),
        ExecutionProjection::Tool(tool) => json!({
            "kind": "tool",
            "status": tool.status.as_str(),
            "startedSource": source_identity_payload(&tool.started_source),
            "lastSource": source_identity_payload(&tool.last_source),
            "identity": tool_identity_payload(&tool.identity),
            "argumentsSummary": safe_text_payload(&tool.arguments_summary),
            "progress": tool.progress.iter().map(|progress| json!({
                "sourceEventId": progress.source.event_id.to_string(),
                "sourceSequence": progress.source.sequence.to_string(),
                "sourceOccurredAt": progress.source.occurred_at,
                "progressIndex": progress.progress_index,
                "summary": safe_text_payload(&progress.summary),
            })).collect::<Vec<_>>(),
            "durationMs": tool.duration_ms,
            "resultSummary": tool.result_summary.as_ref().map(safe_text_payload),
            "error": tool.error.as_ref().map(execution_error_payload),
        }),
    }
}

fn projection_events(
    subscription_id: Uuid,
    record: &mut SubscriptionRecord,
    projection: &LiveTurnProjection,
) -> Result<Vec<ChatEventEnvelope>, ChatError> {
    let mut payloads: Vec<(&'static str, Value)> = Vec::new();
    let assistant_append = projection
        .assistant_text
        .strip_prefix(&record.assistant_text)
        .ok_or(ChatError::OrchestrationUnavailable)?;
    for chunk in split_plain_text(assistant_append, MAX_ASSISTANT_APPEND_BYTES)? {
        if !chunk.is_empty() {
            payloads.push(("assistant_append", json!({"text":chunk})));
        }
    }
    for (item_ordinal, item) in projection.reasoning.iter().enumerate() {
        for part in &item.parts {
            let key = (item_ordinal, part.content_index);
            let previous = record.reasoning.get(&key).map(String::as_str).unwrap_or("");
            let append = part
                .text
                .strip_prefix(previous)
                .ok_or(ChatError::OrchestrationUnavailable)?;
            for chunk in split_plain_text(append, MAX_REASONING_APPEND_BYTES)? {
                if !chunk.is_empty() {
                    payloads.push((
                        "reasoning_append",
                        json!({
                            "itemOrdinal": item_ordinal,
                            "contentIndex": part.content_index,
                            "text": chunk
                        }),
                    ));
                }
            }
        }
    }
    if projection.terminal && !record.terminal {
        payloads.push((
            "turn_terminal",
            json!({
                "status": projection.terminal_status.as_deref().unwrap_or("failed")
            }),
        ));
    } else if !projection.terminal && record.projection_sequence == 0 {
        payloads.push(("turn_state", json!({"status":"streaming"})));
    }
    let mut events = Vec::with_capacity(payloads.len());
    for (kind, payload) in payloads {
        record.projection_sequence = record
            .projection_sequence
            .checked_add(1)
            .ok_or(ChatError::OrchestrationUnavailable)?;
        events.push(event_envelope(
            subscription_id,
            record,
            Some(projection.turn_id),
            kind,
            payload,
        ));
    }
    record.assistant_text.clone_from(&projection.assistant_text);
    record.reasoning.clear();
    for (item_ordinal, item) in projection.reasoning.iter().enumerate() {
        for part in &item.parts {
            record
                .reasoning
                .insert((item_ordinal, part.content_index), part.text.clone());
        }
    }
    record.terminal = projection.terminal;
    Ok(events)
}

fn split_plain_text(value: &str, max_bytes: usize) -> Result<Vec<&str>, ChatError> {
    if value.contains('\0') || max_bytes == 0 {
        return Err(ChatError::OrchestrationUnavailable);
    }
    if value.is_empty() {
        return Ok(Vec::new());
    }
    let mut chunks = Vec::new();
    let mut start = 0_usize;
    while start < value.len() {
        let mut end = value.len().min(start + max_bytes);
        while end > start && !value.is_char_boundary(end) {
            end -= 1;
        }
        if end == start {
            return Err(ChatError::OrchestrationUnavailable);
        }
        chunks.push(&value[start..end]);
        start = end;
    }
    Ok(chunks)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatIpcError {
    schema_version: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
    code: &'static str,
    retryable: bool,
    recovery: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    attachment_issue: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attachment_item_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    approval_issue: Option<ApprovalIssue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_ms: Option<u64>,
}

impl Debug for ChatIpcError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ChatIpcError")
            .field("schema_version", &self.schema_version)
            .field("request_id", &self.request_id)
            .field("code", &self.code)
            .field("retryable", &self.retryable)
            .field("recovery", &self.recovery)
            .field("attachment_issue", &self.attachment_issue)
            .field("attachment_item_count", &self.attachment_item_count)
            .field("approval_issue", &self.approval_issue)
            .finish()
    }
}

impl ChatIpcError {
    fn new(
        request_id: Option<Uuid>,
        code: &'static str,
        retryable: bool,
        recovery: &'static str,
    ) -> Self {
        Self {
            schema_version: CHAT_IPC_SCHEMA_VERSION,
            request_id: request_id.map(|id| id.to_string()),
            code,
            retryable,
            recovery,
            attachment_issue: None,
            attachment_item_count: None,
            approval_issue: None,
            retry_after_ms: None,
        }
    }

    pub(crate) fn request_invalid(request_id: Option<Uuid>) -> Self {
        Self::new(request_id, "chat_request_invalid", false, "fix_request")
    }

    fn request_cancelled(request_id: Option<Uuid>) -> Self {
        Self::new(request_id, "chat_request_cancelled", false, "none")
    }

    fn context_invalid(request_id: Option<Uuid>) -> Self {
        Self::new(request_id, "chat_context_invalid", false, "rebind_context")
    }

    fn capability_denied(request_id: Option<Uuid>) -> Self {
        Self::new(
            request_id,
            "chat_capability_denied",
            false,
            "request_permission",
        )
    }

    fn cursor_invalid(request_id: Option<Uuid>) -> Self {
        Self::new(request_id, "chat_cursor_invalid", false, "reload")
    }

    fn conflict(request_id: Option<Uuid>) -> Self {
        Self::new(request_id, "chat_conflict", false, "resync")
    }

    fn limit_exceeded(request_id: Option<Uuid>) -> Self {
        Self::new(request_id, "chat_limit_exceeded", false, "reduce_input")
    }

    fn temporarily_unavailable(request_id: Option<Uuid>) -> Self {
        let mut error = Self::new(request_id, "chat_temporarily_unavailable", true, "retry");
        error.retry_after_ms = Some(1000);
        error
    }

    fn approval_reconciliation_required(request_id: Uuid, issue: ApprovalIssue) -> Self {
        let mut error = Self::conflict(Some(request_id));
        error.approval_issue = Some(issue);
        error
    }

    fn v2(mut self) -> Self {
        self.schema_version = CHAT_IPC_V2_SCHEMA_VERSION;
        self
    }

    fn v3(mut self) -> Self {
        self.schema_version = CHAT_IPC_V3_SCHEMA_VERSION;
        self
    }

    fn v4(mut self) -> Self {
        self.schema_version = CHAT_IPC_V4_SCHEMA_VERSION;
        self
    }

    fn v5(mut self) -> Self {
        self.schema_version = CHAT_IPC_V5_SCHEMA_VERSION;
        self
    }

    fn v6(mut self) -> Self {
        self.schema_version = CHAT_IPC_V6_SCHEMA_VERSION;
        self
    }

    fn with_attachment_issue(mut self, issue: &'static str) -> Self {
        self.attachment_issue = Some(issue);
        self
    }

    fn with_attachment_item_count(mut self, item_count: usize) -> Self {
        if (1..=attachment::MAX_ATTACHMENTS_PER_MESSAGE).contains(&item_count) {
            self.attachment_item_count = Some(item_count);
        }
        self
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommandRequest<T> {
    schema_version: u8,
    request_id: Uuid,
    context_id: Uuid,
    payload: T,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindRequest {
    schema_version: u8,
    request_id: Uuid,
    payload: BindPayload,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindPayload {
    tenant_selector: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResponse<T> {
    schema_version: u8,
    request_id: String,
    data: T,
}

impl<T> CommandResponse<T> {
    fn new(request_id: Uuid, data: T) -> Self {
        Self {
            schema_version: CHAT_IPC_SCHEMA_VERSION,
            request_id: request_id.to_string(),
            data,
        }
    }

    fn new_v2(request_id: Uuid, data: T) -> Self {
        Self {
            schema_version: CHAT_IPC_V2_SCHEMA_VERSION,
            request_id: request_id.to_string(),
            data,
        }
    }

    fn new_v3(request_id: Uuid, data: T) -> Self {
        Self {
            schema_version: CHAT_IPC_V3_SCHEMA_VERSION,
            request_id: request_id.to_string(),
            data,
        }
    }

    fn new_v4(request_id: Uuid, data: T) -> Self {
        Self {
            schema_version: CHAT_IPC_V4_SCHEMA_VERSION,
            request_id: request_id.to_string(),
            data,
        }
    }

    fn new_v5(request_id: Uuid, data: T) -> Self {
        Self {
            schema_version: CHAT_IPC_V5_SCHEMA_VERSION,
            request_id: request_id.to_string(),
            data,
        }
    }

    fn new_v6(request_id: Uuid, data: T) -> Self {
        Self {
            schema_version: CHAT_IPC_V6_SCHEMA_VERSION,
            request_id: request_id.to_string(),
            data,
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct EmptyPayload {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectOperationPayload {
    project_id: Uuid,
    operation_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OperationOnlyPayload {
    operation_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum RecoveryIntent {
    StartOrRetry,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecoveryPayload {
    operation_id: Uuid,
    intent: RecoveryIntent,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct LocalRecoveryPlan {
    revoke_approval_authority: bool,
    resume_bound_sessions: bool,
    restart_normal_coordinator: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BindLifecycle {
    Legacy,
    Feat137,
}

fn bind_lifecycle(feat137_enabled: bool) -> BindLifecycle {
    #[cfg(feature = "feat126-s10-driver")]
    {
        let _ = feat137_enabled;
        BindLifecycle::Legacy
    }
    #[cfg(not(feature = "feat126-s10-driver"))]
    {
        if feat137_enabled {
            BindLifecycle::Feat137
        } else {
            BindLifecycle::Legacy
        }
    }
}

fn local_recovery_plan(feat137_enabled: bool) -> LocalRecoveryPlan {
    #[cfg(feature = "feat126-s10-driver")]
    {
        let _ = feat137_enabled;
        LocalRecoveryPlan {
            revoke_approval_authority: false,
            // ChatRuntime preserves the S10 baseline: every recovery performs
            // its own exact Idle-only resume without the FEAT-137 generation cache.
            resume_bound_sessions: false,
            restart_normal_coordinator: false,
        }
    }
    #[cfg(not(feature = "feat126-s10-driver"))]
    {
        LocalRecoveryPlan {
            revoke_approval_authority: feat137_enabled,
            resume_bound_sessions: feat137_enabled,
            restart_normal_coordinator: feat137_enabled,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetProjectPinnedPayload {
    project_id: Uuid,
    pinned: bool,
    operation_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateSessionPayload {
    project_id: Uuid,
    input: String,
    operation_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmitTurnPayload {
    session_id: Uuid,
    input: String,
    operation_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PickAttachmentsPayload {
    draft_target: DraftTargetPayload,
    operation_id: Uuid,
    remaining_capacity: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportAttachmentsPayload {
    paths: Vec<String>,
    draft_target: DraftTargetPayload,
    operation_id: Uuid,
    remaining_capacity: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListDraftAttachmentsPayload {
    draft_target: DraftTargetPayload,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemoveAttachmentPayload {
    attachment_id: Uuid,
    draft_target: DraftTargetPayload,
    operation_id: Uuid,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum DraftTargetPayload {
    New {},
    Session {
        #[serde(rename = "sessionId")]
        session_id: Uuid,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum TurnContentBlockPayload {
    Text {
        text: String,
    },
    File {
        #[serde(rename = "attachmentId")]
        attachment_id: Uuid,
    },
    Image {
        #[serde(rename = "attachmentId")]
        attachment_id: Uuid,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateSessionV2Payload {
    project_id: Uuid,
    content_blocks: Vec<TurnContentBlockPayload>,
    operation_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmitTurnV2Payload {
    session_id: Uuid,
    content_blocks: Vec<TurnContentBlockPayload>,
    operation_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListSessionsPayload {
    cursor: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionReadPayload {
    session_id: Uuid,
    cursor: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionResyncV6Payload {
    session_id: Uuid,
    subscription_id: Uuid,
    cursor: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DecideApprovalV6Payload {
    session_id: Uuid,
    turn_id: Uuid,
    item_id: String,
    approval_request_id: Uuid,
    decision: HostApprovalDecision,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReasoningPayload {
    turn_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RenameSessionPayload {
    session_id: Uuid,
    title: String,
    operation_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetSessionPinnedPayload {
    session_id: Uuid,
    pinned: bool,
    operation_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionOperationPayload {
    session_id: Uuid,
    operation_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CleanupStatusPayload {
    operation_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionControlPlanePayload {
    session_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubscribePayload {
    session_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UnsubscribePayload {
    subscription_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelPayload {
    target_request_id: Uuid,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BoundContextDto {
    context_id: String,
    expires_at_epoch_seconds: i64,
    allowed_actions: Vec<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectDto {
    project_id: String,
    safe_name: String,
    pinned_at: Option<i64>,
    last_used_at: i64,
    available: bool,
}

impl From<ProjectSummary> for ProjectDto {
    fn from(project: ProjectSummary) -> Self {
        Self {
            project_id: project.id,
            safe_name: project.safe_name,
            pinned_at: project.pinned_at,
            last_used_at: project.last_used_at,
            available: project.available,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionDto {
    session_id: String,
    project_id: String,
    title: String,
    title_source: &'static str,
    pinned_at: Option<i64>,
    last_activity_at: i64,
    latest_turn_status: Option<String>,
    project_available: bool,
}

impl From<SessionSummary> for SessionDto {
    fn from(session: SessionSummary) -> Self {
        Self {
            session_id: session.session_id.to_string(),
            project_id: session.project_id.to_string(),
            title: session.title,
            title_source: match session.title_source {
                SessionTitleSource::Fallback => "fallback",
                SessionTitleSource::Model => "model",
                SessionTitleSource::User => "user",
            },
            pinned_at: session.pinned_at,
            last_activity_at: session.last_activity_at,
            latest_turn_status: session.latest_turn_status,
            project_available: session.project_available,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionPageDto {
    sessions: Vec<SessionDto>,
    next_cursor: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MessageDto {
    message_id: String,
    role: String,
    content: String,
    status: String,
    ordinal: u64,
    created_at: i64,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum MessageContentBlockDto {
    Text {
        text: String,
    },
    File {
        #[serde(rename = "attachmentId")]
        attachment_id: String,
        name: String,
        #[serde(rename = "mediaType")]
        media_type: String,
        #[serde(rename = "sizeBytes")]
        size_bytes: usize,
        status: String,
        #[serde(rename = "expiresAt")]
        expires_at: i64,
    },
    Image {
        #[serde(rename = "attachmentId")]
        attachment_id: String,
        name: String,
        #[serde(rename = "mediaType")]
        media_type: String,
        #[serde(rename = "sizeBytes")]
        size_bytes: usize,
        status: String,
        #[serde(rename = "expiresAt")]
        expires_at: i64,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MessageDtoV2 {
    message_id: String,
    role: String,
    content: String,
    content_blocks: Vec<MessageContentBlockDto>,
    status: String,
    ordinal: u64,
    created_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReasoningMetadataDto {
    item_ordinal: usize,
    status: &'static str,
    reason_code: Option<String>,
    total_bytes: usize,
    part_count: usize,
    finalized_at_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryTurnDto {
    turn_id: String,
    status: String,
    terminal_at: Option<i64>,
    reasoning_status: String,
    reasoning_reason_code: Option<String>,
    messages: Vec<MessageDto>,
    reasoning: Vec<ReasoningMetadataDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryTurnDtoV2 {
    turn_id: String,
    status: String,
    terminal_at: Option<i64>,
    reasoning_status: String,
    reasoning_reason_code: Option<String>,
    messages: Vec<MessageDtoV2>,
    reasoning: Vec<ReasoningMetadataDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactDtoV3 {
    artifact_id: String,
    kind: &'static str,
    provenance: &'static str,
    status: String,
    ordinal: usize,
    progress_stage: Option<&'static str>,
    progress_percent: Option<f64>,
    display_name: Option<String>,
    media_type: Option<String>,
    size_bytes: Option<usize>,
    local_committed_at: Option<i64>,
    expires_at: Option<i64>,
    has_poster: bool,
    error_code: Option<String>,
    retryable: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryTurnDtoV3 {
    turn_id: String,
    status: String,
    terminal_at: Option<i64>,
    reasoning_status: String,
    reasoning_reason_code: Option<String>,
    messages: Vec<MessageDtoV2>,
    reasoning: Vec<ReasoningMetadataDto>,
    artifacts: Vec<ArtifactDtoV3>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryPageDto {
    turns: Vec<HistoryTurnDto>,
    next_cursor: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryPageDtoV2 {
    turns: Vec<HistoryTurnDtoV2>,
    next_cursor: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryPageDtoV3 {
    turns: Vec<HistoryTurnDtoV3>,
    next_cursor: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TimelinePlanStepDtoV4 {
    ordinal: usize,
    step: String,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TimelinePlanDtoV4 {
    source_event_id: String,
    source_sequence: String,
    source_occurred_at: String,
    explanation: Option<String>,
    steps: Vec<TimelinePlanStepDtoV4>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TimelineReasoningPartDtoV4 {
    content_index: usize,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TimelineItemDtoV4 {
    source_event_id: String,
    source_sequence: String,
    source_occurred_at: String,
    item_id: String,
    item_ordinal: usize,
    item_type: String,
    phase: Option<&'static str>,
    status: &'static str,
    text: String,
    reasoning_status: Option<&'static str>,
    reasoning_reason_code: Option<String>,
    reasoning_parts: Vec<TimelineReasoningPartDtoV4>,
    started_at_ms: i64,
    completed_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    execution: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TimelineNoticeDtoV4 {
    source_event_id: String,
    source_sequence: String,
    source_occurred_at: String,
    scope: &'static str,
    severity: &'static str,
    code: Option<String>,
    will_retry: bool,
    observed_at_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryTurnDtoV4 {
    turn_id: String,
    projection_authority: &'static str,
    status: String,
    terminal_at: Option<i64>,
    reasoning_status: String,
    reasoning_reason_code: Option<String>,
    messages: Vec<MessageDtoV2>,
    reasoning: Vec<ReasoningMetadataDto>,
    artifacts: Vec<ArtifactDtoV3>,
    terminal_code: Option<String>,
    timeline_items: Vec<TimelineItemDtoV4>,
    plan: Option<TimelinePlanDtoV4>,
    notices: Vec<TimelineNoticeDtoV4>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryPageDtoV4 {
    turns: Vec<HistoryTurnDtoV4>,
    next_cursor: Option<String>,
    session_notices: Vec<TimelineNoticeDtoV4>,
    durable_sequence_cut: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AttachmentDto {
    attachment_id: String,
    #[serde(rename = "type")]
    kind: String,
    name: String,
    media_type: String,
    size_bytes: usize,
    status: String,
    expires_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentImportEventDto {
    schema_version: u8,
    context_id: String,
    operation_id: String,
    sequence: String,
    stage: &'static str,
    item_count: usize,
    issue: Option<&'static str>,
}

impl Debug for AttachmentImportEventDto {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AttachmentImportEventDto")
            .field("schema_version", &self.schema_version)
            .field("context_id", &self.context_id)
            .field("operation_id", &self.operation_id)
            .field("sequence", &self.sequence)
            .field("stage", &self.stage)
            .field("item_count", &self.item_count)
            .field("issue", &self.issue)
            .finish()
    }
}

struct AttachmentImportEventEmitter {
    app: AppHandle,
    context_id: Uuid,
    operation_id: Uuid,
    item_count: usize,
    next_sequence: u64,
    last_stage: Option<AttachmentPreparationStage>,
}

fn valid_attachment_import_transition(
    previous: Option<AttachmentPreparationStage>,
    next: AttachmentPreparationStage,
) -> bool {
    matches!(
        (previous, next),
        (None, AttachmentPreparationStage::Queued)
            | (
                Some(AttachmentPreparationStage::Queued),
                AttachmentPreparationStage::Importing
            )
            | (
                Some(AttachmentPreparationStage::Importing),
                AttachmentPreparationStage::Parsing | AttachmentPreparationStage::ErrorTerminal
            )
            | (
                Some(AttachmentPreparationStage::Parsing),
                AttachmentPreparationStage::Indexing | AttachmentPreparationStage::ErrorTerminal
            )
            | (
                Some(AttachmentPreparationStage::Indexing),
                AttachmentPreparationStage::Ready | AttachmentPreparationStage::ErrorTerminal
            )
    )
}

impl AttachmentImportEventEmitter {
    fn new(app: AppHandle, context_id: Uuid, operation_id: Uuid, item_count: usize) -> Self {
        Self {
            app,
            context_id,
            operation_id,
            item_count,
            next_sequence: 1,
            last_stage: None,
        }
    }

    fn emit_progress(
        &mut self,
        progress: AttachmentPreparationProgress,
    ) -> Result<(), AttachmentImportError> {
        if progress.item_count != self.item_count {
            return Err(AttachmentImportError::InvalidContent);
        }
        let event = self.progress_event(progress)?;
        self.app
            .emit(CHAT_ATTACHMENT_IMPORT_EVENT_CHANNEL, event)
            .map_err(|_| AttachmentImportError::Unavailable)
    }

    fn emit_ready(&mut self) {
        let event = self.next_event(AttachmentPreparationStage::Ready, None);
        if let Ok(event) = event {
            let _ = self.app.emit(CHAT_ATTACHMENT_IMPORT_EVENT_CHANNEL, event);
        }
    }

    fn emit_storage_failure(&mut self) {
        let event = self.next_event(
            AttachmentPreparationStage::ErrorTerminal,
            Some("unavailable"),
        );
        if let Ok(event) = event {
            let _ = self.app.emit(CHAT_ATTACHMENT_IMPORT_EVENT_CHANNEL, event);
        }
    }

    fn progress_event(
        &mut self,
        progress: AttachmentPreparationProgress,
    ) -> Result<AttachmentImportEventDto, AttachmentImportError> {
        self.next_event(progress.stage, progress.issue)
    }

    fn next_event(
        &mut self,
        stage: AttachmentPreparationStage,
        issue: Option<&'static str>,
    ) -> Result<AttachmentImportEventDto, AttachmentImportError> {
        if !(1..=attachment::MAX_ATTACHMENTS_PER_MESSAGE).contains(&self.item_count)
            || (stage == AttachmentPreparationStage::ErrorTerminal) != issue.is_some()
            || !valid_attachment_import_transition(self.last_stage, stage)
        {
            return Err(AttachmentImportError::InvalidContent);
        }
        let sequence = self.next_sequence;
        self.next_sequence = self
            .next_sequence
            .checked_add(1)
            .ok_or(AttachmentImportError::Unavailable)?;
        self.last_stage = Some(stage);
        Ok(AttachmentImportEventDto {
            schema_version: CHAT_IPC_V2_SCHEMA_VERSION,
            context_id: self.context_id.to_string(),
            operation_id: self.operation_id.to_string(),
            sequence: sequence.to_string(),
            stage: stage.as_str(),
            item_count: self.item_count,
            issue,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReasoningPartDto {
    content_index: usize,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReasoningItemDto {
    item_ordinal: usize,
    status: &'static str,
    reason_code: Option<String>,
    finalized_at_ms: i64,
    parts: Vec<ReasoningPartDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CleanupStatusDto {
    operation_id: String,
    desktop_state: &'static str,
    host_state: &'static str,
    runtime_state: &'static str,
    outcome_code: String,
    last_error_code: Option<String>,
    requested_at: i64,
    completed_at: Option<i64>,
    expires_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OperationDto {
    operation_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreatedSessionDto {
    session_id: String,
    turn_id: String,
    operation_id: String,
}

#[derive(Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlPlaneDto {
    session_id: String,
    state: &'static str,
    issue_code: Option<String>,
    retryable: bool,
    recovery: &'static str,
}

impl ControlPlaneDto {
    fn from_status(status: &PublicTaskControlPlaneStatus, feat137_enabled: bool) -> Self {
        let projected_state = match (status.state, feat137_enabled) {
            (PublicTaskBindingState::Pending | PublicTaskBindingState::Inflight, _) => "pending",
            (PublicTaskBindingState::Bound, false) => "bound",
            (PublicTaskBindingState::Bound, true) if status.host_session_bound => "bound",
            (PublicTaskBindingState::Bound, true) => "binding_pending",
            (PublicTaskBindingState::BlockedAuth, _) => "blocked_auth",
            (PublicTaskBindingState::RetryWait, _) => "retry_wait",
            (PublicTaskBindingState::Denied, _) => "denied",
            (PublicTaskBindingState::Failed, _) => "failed",
        };
        let (retryable, recovery) = match (status.state, feat137_enabled) {
            (PublicTaskBindingState::Pending | PublicTaskBindingState::Bound, _) => (false, "none"),
            (PublicTaskBindingState::Inflight, false) | (PublicTaskBindingState::RetryWait, _) => {
                (true, "retry")
            }
            (PublicTaskBindingState::Inflight, true) => (false, "none"),
            (PublicTaskBindingState::BlockedAuth, _) => (false, "sign_in"),
            (PublicTaskBindingState::Denied, _) => (false, "none"),
            (PublicTaskBindingState::Failed, _) => (false, "resync"),
        };
        let issue_code = match (status.state, feat137_enabled) {
            (PublicTaskBindingState::Pending, true)
            | (PublicTaskBindingState::Inflight, true)
            | (PublicTaskBindingState::Bound, true) => None,
            _ => status.issue_code.clone(),
        };
        Self {
            session_id: status.session_id.to_string(),
            state: projected_state,
            issue_code,
            retryable,
            recovery,
        }
    }
}

#[derive(Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ControlPlaneEventDto {
    schema_version: u8,
    sequence: String,
    session_id: String,
    state: &'static str,
    issue_code: Option<String>,
    retryable: bool,
    recovery: &'static str,
}

impl ControlPlaneEventDto {
    fn from_status(
        sequence: u64,
        status: &PublicTaskControlPlaneStatus,
        feat137_enabled: bool,
    ) -> Self {
        let projection = ControlPlaneDto::from_status(status, feat137_enabled);
        Self {
            schema_version: CHAT_IPC_SCHEMA_VERSION,
            sequence: sequence.to_string(),
            session_id: projection.session_id,
            state: projection.state,
            issue_code: projection.issue_code,
            retryable: projection.retryable,
            recovery: projection.recovery,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionDto {
    subscription_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionDtoV6 {
    subscription_id: String,
    pending_approval_snapshot: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CancelledDto {
    cancelled: bool,
}

fn reasoning_status(status: ReasoningStatus) -> &'static str {
    match status {
        ReasoningStatus::Complete => "complete",
        ReasoningStatus::Incomplete => "incomplete",
        ReasoningStatus::Unavailable => "unavailable",
    }
}

fn cleanup_state(state: CleanupSurfaceState) -> &'static str {
    match state {
        CleanupSurfaceState::Pending => "pending",
        CleanupSurfaceState::Complete => "complete",
        CleanupSurfaceState::Incomplete => "incomplete",
        CleanupSurfaceState::NotAttempted => "not_attempted",
    }
}

fn history_dto(page: HistoryPage, next_cursor: Option<String>) -> HistoryPageDto {
    HistoryPageDto {
        turns: page
            .turns
            .into_iter()
            .map(|turn| HistoryTurnDto {
                turn_id: turn.turn_id.to_string(),
                status: turn.status,
                terminal_at: turn.terminal_at,
                reasoning_status: turn.reasoning_status,
                reasoning_reason_code: turn.reasoning_reason_code,
                messages: turn
                    .messages
                    .into_iter()
                    .map(|message| MessageDto {
                        message_id: message.message_id.to_string(),
                        role: message.role,
                        content: message.content,
                        status: message.status,
                        ordinal: message.ordinal,
                        created_at: message.created_at,
                    })
                    .collect(),
                reasoning: turn
                    .reasoning
                    .into_iter()
                    .map(|item| ReasoningMetadataDto {
                        item_ordinal: item.item_ordinal,
                        status: reasoning_status(item.status),
                        reason_code: item.reason_code,
                        total_bytes: item.total_bytes,
                        part_count: item.part_count,
                        finalized_at_ms: item.finalized_at_ms,
                    })
                    .collect(),
            })
            .collect(),
        next_cursor,
    }
}

impl From<AttachmentSummary> for AttachmentDto {
    fn from(attachment: AttachmentSummary) -> Self {
        Self {
            attachment_id: attachment.attachment_id.to_string(),
            kind: attachment.kind,
            name: attachment.safe_name,
            media_type: attachment.media_type,
            size_bytes: attachment.byte_size,
            status: attachment.state,
            expires_at: attachment.expires_at,
        }
    }
}

fn attachment_content_block(
    attachment: AttachmentSummary,
) -> Result<MessageContentBlockDto, ChatError> {
    let AttachmentDto {
        attachment_id,
        kind,
        name,
        media_type,
        size_bytes,
        status,
        expires_at,
    } = attachment.into();
    match kind.as_str() {
        "file" => Ok(MessageContentBlockDto::File {
            attachment_id,
            name,
            media_type,
            size_bytes,
            status,
            expires_at,
        }),
        "image" => Ok(MessageContentBlockDto::Image {
            attachment_id,
            name,
            media_type,
            size_bytes,
            status,
            expires_at,
        }),
        _ => Err(ChatError::DatabaseUnavailable),
    }
}

fn history_message_ids(page: &HistoryPage) -> Vec<Uuid> {
    page.turns
        .iter()
        .flat_map(|turn| turn.messages.iter().map(|message| message.message_id))
        .collect()
}

fn history_dto_v2(
    page: HistoryPage,
    next_cursor: Option<String>,
    projections: Vec<(Uuid, Vec<MessageContentBlockProjection>)>,
) -> Result<HistoryPageDtoV2, ChatError> {
    let mut projections = projections.into_iter().collect::<HashMap<_, _>>();
    let mut turns = Vec::with_capacity(page.turns.len());
    for turn in page.turns {
        let mut messages = Vec::with_capacity(turn.messages.len());
        for message in turn.messages {
            let stored = projections
                .remove(&message.message_id)
                .ok_or(ChatError::DatabaseUnavailable)?;
            let content_blocks = if stored.is_empty() {
                vec![MessageContentBlockDto::Text {
                    text: if message.content.is_empty() {
                        " ".to_owned()
                    } else {
                        message.content.clone()
                    },
                }]
            } else {
                let mut blocks = Vec::with_capacity(stored.len());
                for (expected_ordinal, block) in stored.into_iter().enumerate() {
                    match block {
                        MessageContentBlockProjection::Text { ordinal, text }
                            if ordinal == expected_ordinal =>
                        {
                            blocks.push(MessageContentBlockDto::Text { text });
                        }
                        MessageContentBlockProjection::Attachment {
                            ordinal,
                            attachment,
                        } if ordinal == expected_ordinal => {
                            blocks.push(attachment_content_block(attachment)?);
                        }
                        _ => return Err(ChatError::DatabaseUnavailable),
                    }
                }
                blocks
            };
            messages.push(MessageDtoV2 {
                message_id: message.message_id.to_string(),
                role: message.role,
                content: message.content,
                content_blocks,
                status: message.status,
                ordinal: message.ordinal,
                created_at: message.created_at,
            });
        }
        turns.push(HistoryTurnDtoV2 {
            turn_id: turn.turn_id.to_string(),
            status: turn.status,
            terminal_at: turn.terminal_at,
            reasoning_status: turn.reasoning_status,
            reasoning_reason_code: turn.reasoning_reason_code,
            messages,
            reasoning: turn
                .reasoning
                .into_iter()
                .map(|item| ReasoningMetadataDto {
                    item_ordinal: item.item_ordinal,
                    status: reasoning_status(item.status),
                    reason_code: item.reason_code,
                    total_bytes: item.total_bytes,
                    part_count: item.part_count,
                    finalized_at_ms: item.finalized_at_ms,
                })
                .collect(),
        });
    }
    if !projections.is_empty() {
        return Err(ChatError::DatabaseUnavailable);
    }
    Ok(HistoryPageDtoV2 { turns, next_cursor })
}

fn history_dto_v3(
    page: HistoryPage,
    next_cursor: Option<String>,
    projections: Vec<(Uuid, Vec<MessageContentBlockProjection>)>,
    artifacts: Vec<ArtifactProjection>,
) -> Result<HistoryPageDtoV3, ChatError> {
    let turn_ids = page
        .turns
        .iter()
        .map(|turn| turn.turn_id)
        .collect::<HashSet<_>>();
    let mut by_turn = HashMap::<Uuid, Vec<ArtifactDtoV3>>::new();
    for artifact in artifacts {
        if !turn_ids.contains(&artifact.turn_id) {
            return Err(ChatError::DatabaseUnavailable);
        }
        by_turn
            .entry(artifact.turn_id)
            .or_default()
            .push(ArtifactDtoV3 {
                artifact_id: artifact.artifact_id.to_string(),
                kind: artifact.kind.as_str(),
                provenance: artifact.provenance.as_str(),
                status: artifact.state,
                ordinal: artifact.ordinal,
                progress_stage: artifact.progress_stage.map(|stage| stage.as_str()),
                progress_percent: artifact.progress_percent,
                display_name: artifact.display_name,
                media_type: artifact.media_type,
                size_bytes: artifact.size_bytes,
                local_committed_at: artifact.local_committed_at,
                expires_at: artifact.expires_at,
                has_poster: artifact.has_poster,
                error_code: artifact.error_code,
                retryable: artifact.retryable,
            });
    }
    let v2 = history_dto_v2(page, next_cursor, projections)?;
    let mut turns = Vec::with_capacity(v2.turns.len());
    for turn in v2.turns {
        let turn_id = Uuid::parse_str(&turn.turn_id).map_err(|_| ChatError::DatabaseUnavailable)?;
        let artifacts = by_turn.remove(&turn_id).unwrap_or_default();
        if artifacts.len() > 12
            || artifacts.iter().any(|artifact| artifact.ordinal >= 12)
            || artifacts
                .windows(2)
                .any(|pair| pair[0].ordinal >= pair[1].ordinal)
        {
            return Err(ChatError::DatabaseUnavailable);
        }
        turns.push(HistoryTurnDtoV3 {
            turn_id: turn.turn_id,
            status: turn.status,
            terminal_at: turn.terminal_at,
            reasoning_status: turn.reasoning_status,
            reasoning_reason_code: turn.reasoning_reason_code,
            messages: turn.messages,
            reasoning: turn.reasoning,
            artifacts,
        });
    }
    if !by_turn.is_empty() {
        return Err(ChatError::DatabaseUnavailable);
    }
    Ok(HistoryPageDtoV3 {
        turns,
        next_cursor: v2.next_cursor,
    })
}

fn timeline_plan_dto_v4(plan: TimelinePlan) -> Result<TimelinePlanDtoV4, ChatError> {
    if plan.steps.is_empty()
        || plan
            .steps
            .iter()
            .enumerate()
            .any(|(index, step)| step.ordinal != index)
    {
        return Err(ChatError::DatabaseUnavailable);
    }
    Ok(TimelinePlanDtoV4 {
        source_event_id: plan.source_event_id.to_string(),
        source_sequence: plan.source_sequence.to_string(),
        source_occurred_at: plan.source_occurred_at,
        explanation: plan.explanation,
        steps: plan
            .steps
            .into_iter()
            .map(|step| TimelinePlanStepDtoV4 {
                ordinal: step.ordinal,
                step: step.step,
                status: step.status,
            })
            .collect(),
    })
}

fn timeline_item_dto_v4(item: TimelineItem) -> TimelineItemDtoV4 {
    let execution = item.execution.as_ref().map(execution_payload);
    TimelineItemDtoV4 {
        source_event_id: item.source_event_id.to_string(),
        source_sequence: item.source_sequence.to_string(),
        source_occurred_at: item.source_occurred_at,
        item_id: item.item_id,
        item_ordinal: item.item_ordinal,
        item_type: item.item_type,
        phase: item.phase.map(|phase| phase.as_str()),
        status: item.status.as_str(),
        text: item.text,
        reasoning_status: item.reasoning_status.map(|status| status.as_str()),
        reasoning_reason_code: item.reasoning_reason_code,
        reasoning_parts: item
            .reasoning_parts
            .into_iter()
            .map(|part| TimelineReasoningPartDtoV4 {
                content_index: part.content_index,
                text: part.text,
            })
            .collect(),
        started_at_ms: item.started_at_ms,
        completed_at_ms: item.completed_at_ms,
        execution,
    }
}

fn timeline_notice_dto_v4(notice: TimelineNotice) -> TimelineNoticeDtoV4 {
    TimelineNoticeDtoV4 {
        source_event_id: notice.source_event_id.to_string(),
        source_sequence: notice.source_sequence.to_string(),
        source_occurred_at: notice.source_occurred_at,
        scope: notice.scope.as_str(),
        severity: notice.severity.as_str(),
        code: notice.code,
        will_retry: notice.will_retry,
        observed_at_ms: notice.observed_at_ms,
    }
}

fn history_dto_v4(
    page: HistoryPage,
    next_cursor: Option<String>,
    projections: Vec<(Uuid, Vec<MessageContentBlockProjection>)>,
    artifacts: Vec<ArtifactProjection>,
    feat134: Feat134HistoryProjection,
) -> Result<HistoryPageDtoV4, ChatError> {
    history_dto_projected(page, next_cursor, projections, artifacts, feat134, "v4")
}

fn history_dto_projected(
    page: HistoryPage,
    next_cursor: Option<String>,
    projections: Vec<(Uuid, Vec<MessageContentBlockProjection>)>,
    artifacts: Vec<ArtifactProjection>,
    feat134: Feat134HistoryProjection,
    authority: &'static str,
) -> Result<HistoryPageDtoV4, ChatError> {
    let v3 = history_dto_v3(page, next_cursor, projections, artifacts)?;
    let mut feat_turns = feat134
        .turns
        .into_iter()
        .map(|turn| (turn.turn_id, turn))
        .collect::<HashMap<_, _>>();
    let mut turns = Vec::with_capacity(v3.turns.len());
    for turn in v3.turns {
        let turn_id = Uuid::parse_str(&turn.turn_id).map_err(|_| ChatError::DatabaseUnavailable)?;
        let facts = feat_turns
            .remove(&turn_id)
            .ok_or(ChatError::DatabaseUnavailable)?;
        if facts
            .items
            .iter()
            .enumerate()
            .any(|(index, item)| item.item_ordinal != index + 1)
            || facts
                .notices
                .iter()
                .any(|notice| notice.scope != TimelineNoticeScope::Turn)
            || (!facts.v4_authority
                && (facts.terminal_code.is_some()
                    || !facts.items.is_empty()
                    || facts.plan.is_some()
                    || !facts.notices.is_empty()))
            || facts.v4_authority != facts.source_schema_version.is_some()
        {
            return Err(ChatError::DatabaseUnavailable);
        }
        let projection_authority = match facts.source_schema_version {
            Some(4) => "v4",
            Some(5) if authority == "v5" => "v5",
            Some(_) => return Err(ChatError::DatabaseUnavailable),
            None => "legacy",
        };
        let messages = turn
            .messages
            .into_iter()
            .filter(|message| {
                message.role == "user" || (!facts.v4_authority && message.role == "assistant")
            })
            .collect();
        let reasoning = if facts.v4_authority {
            Vec::new()
        } else {
            turn.reasoning
        };
        turns.push(HistoryTurnDtoV4 {
            turn_id: turn.turn_id,
            projection_authority,
            status: turn.status,
            terminal_at: turn.terminal_at,
            reasoning_status: turn.reasoning_status,
            reasoning_reason_code: turn.reasoning_reason_code,
            messages,
            reasoning,
            artifacts: turn.artifacts,
            terminal_code: facts.terminal_code,
            timeline_items: facts.items.into_iter().map(timeline_item_dto_v4).collect(),
            plan: facts.plan.map(timeline_plan_dto_v4).transpose()?,
            notices: facts
                .notices
                .into_iter()
                .map(timeline_notice_dto_v4)
                .collect(),
        });
    }
    if !feat_turns.is_empty()
        || feat134
            .session_notices
            .iter()
            .any(|notice| notice.scope != TimelineNoticeScope::Session)
    {
        return Err(ChatError::DatabaseUnavailable);
    }
    Ok(HistoryPageDtoV4 {
        turns,
        next_cursor: v3.next_cursor,
        session_notices: feat134
            .session_notices
            .into_iter()
            .map(timeline_notice_dto_v4)
            .collect(),
        durable_sequence_cut: feat134.durable_sequence_cut.to_string(),
    })
}

fn history_dto_v5(
    page: HistoryPage,
    next_cursor: Option<String>,
    projections: Vec<(Uuid, Vec<MessageContentBlockProjection>)>,
    artifacts: Vec<ArtifactProjection>,
    feat136: Feat134HistoryProjection,
) -> Result<Value, ChatError> {
    let dto = history_dto_projected(page, next_cursor, projections, artifacts, feat136, "v5")?;
    let mut value = serde_json::to_value(dto).map_err(|_| ChatError::DatabaseUnavailable)?;
    let turns = value
        .get_mut("turns")
        .and_then(Value::as_array_mut)
        .ok_or(ChatError::DatabaseUnavailable)?;
    for turn in turns {
        if !matches!(
            turn.get("projectionAuthority").and_then(Value::as_str),
            Some("legacy" | "v4" | "v5")
        ) {
            return Err(ChatError::DatabaseUnavailable);
        }
        if turn.get("projectionAuthority").and_then(Value::as_str) == Some("v5") {
            let items = turn
                .get_mut("timelineItems")
                .and_then(Value::as_array_mut)
                .ok_or(ChatError::DatabaseUnavailable)?;
            for item in items {
                let object = item.as_object_mut().ok_or(ChatError::DatabaseUnavailable)?;
                object.entry("execution").or_insert(Value::Null);
            }
        }
    }
    Ok(value)
}

fn history_dto_v6(
    page: HistoryPage,
    next_cursor: Option<String>,
    projections: Vec<(Uuid, Vec<MessageContentBlockProjection>)>,
    artifacts: Vec<ArtifactProjection>,
    feat136: Feat134HistoryProjection,
    approvals: Vec<ApprovalProjection>,
) -> Result<Value, ChatError> {
    let mut value = history_dto_v5(page, next_cursor, projections, artifacts, feat136)?;
    let object = value
        .as_object_mut()
        .ok_or(ChatError::DatabaseUnavailable)?;
    object.insert(
        "approvals".to_owned(),
        Value::Array(
            approvals
                .iter()
                .map(approval_projection_payload)
                .collect::<Result<Vec<_>, _>>()?,
        ),
    );
    Ok(value)
}

fn pending_approval_snapshot_dto(snapshot: &PendingApprovalSnapshot) -> Value {
    json!({
        "schemaVersion": CHAT_IPC_V6_SCHEMA_VERSION,
        "streamId": snapshot.stream_id.to_string(),
        "snapshotAt": snapshot.snapshot_at,
        "pending": snapshot.pending.iter().map(|approval| json!({
            "approvalRequestId": approval.approval_request_id.to_string(),
            "revision": 1,
            "turnId": approval.turn_id.to_string(),
            "itemId": approval.item_id,
            "actionId": super::feat137::ACTION_ID,
            "workspaceScope": super::feat137::WORKSPACE_SCOPE,
            "decisions": {
                "primary": super::feat137::PRIMARY_DECISION,
                "secondary": super::feat137::SECONDARY_DECISION,
            },
            "requestedAt": approval.requested_at,
            "expiresAt": approval.expires_at,
            "ttlSeconds": super::feat137::TTL_SECONDS,
        })).collect::<Vec<_>>(),
    })
}

async fn load_bounded_feat134_history_snapshot(
    authorized: &AuthorizedConversationApplication,
    context_id: Uuid,
    session_id: Uuid,
    before_ordinal: Option<u64>,
    requested_limit: Option<usize>,
    response_limit: usize,
    request_id: Uuid,
) -> Result<Feat134HistorySnapshot, ChatIpcError> {
    let byte_budget = response_limit
        .checked_sub(V4_RESPONSE_STRUCTURAL_HEADROOM)
        .ok_or_else(|| ChatIpcError::limit_exceeded(Some(request_id)).v4())?;
    let mut limit = requested_limit.unwrap_or(DEFAULT_HISTORY_PAGE_LIMIT);
    loop {
        let snapshot = authorized
            .load_feat134_history_snapshot(context_id, session_id, before_ordinal, Some(limit))
            .await
            .map_err(|error| map_chat_error(error, Some(request_id)).v4())?;
        let probe = history_dto_v4(
            snapshot.history.clone(),
            None,
            snapshot.message_content_blocks.clone(),
            snapshot.artifacts.clone(),
            snapshot.feat134.clone(),
        )
        .map_err(|error| map_chat_error(error, Some(request_id)).v4())?;
        let encoded_bytes = serde_json::to_vec(&probe)
            .map(|encoded| encoded.len())
            .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request_id)).v4())?;
        match next_feat134_history_page_limit(
            snapshot.history.turns.len(),
            encoded_bytes,
            byte_budget,
        ) {
            Ok(None) => return Ok(snapshot),
            Ok(Some(next_limit)) => limit = next_limit,
            Err(()) => {
                return Err(ChatIpcError::limit_exceeded(Some(request_id)).v4());
            }
        }
    }
}

async fn load_bounded_feat136_history_snapshot(
    authorized: &AuthorizedConversationApplication,
    context_id: Uuid,
    session_id: Uuid,
    before_ordinal: Option<u64>,
    requested_limit: Option<usize>,
    response_limit: usize,
    request_id: Uuid,
) -> Result<Feat134HistorySnapshot, ChatIpcError> {
    let byte_budget = response_limit
        .checked_sub(V4_RESPONSE_STRUCTURAL_HEADROOM)
        .ok_or_else(|| ChatIpcError::limit_exceeded(Some(request_id)).v5())?;
    let mut limit = requested_limit.unwrap_or(DEFAULT_HISTORY_PAGE_LIMIT);
    loop {
        let snapshot = authorized
            .load_feat136_history_snapshot(context_id, session_id, before_ordinal, Some(limit))
            .await
            .map_err(|error| map_chat_error(error, Some(request_id)).v5())?;
        let probe = history_dto_v5(
            snapshot.history.clone(),
            None,
            snapshot.message_content_blocks.clone(),
            snapshot.artifacts.clone(),
            snapshot.feat134.clone(),
        )
        .map_err(|error| map_chat_error(error, Some(request_id)).v5())?;
        let encoded_bytes = serde_json::to_vec(&probe)
            .map(|encoded| encoded.len())
            .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request_id)).v5())?;
        match next_feat134_history_page_limit(
            snapshot.history.turns.len(),
            encoded_bytes,
            byte_budget,
        ) {
            Ok(None) => return Ok(snapshot),
            Ok(Some(next_limit)) => limit = next_limit,
            Err(()) => {
                return Err(ChatIpcError::limit_exceeded(Some(request_id)).v5());
            }
        }
    }
}

async fn load_bounded_feat137_history_snapshot(
    authorized: &AuthorizedConversationApplication,
    context_id: Uuid,
    session_id: Uuid,
    before_ordinal: Option<u64>,
    requested_limit: Option<usize>,
    response_limit: usize,
    request_id: Uuid,
) -> Result<Feat134HistorySnapshot, ChatIpcError> {
    let byte_budget = response_limit
        .checked_sub(V4_RESPONSE_STRUCTURAL_HEADROOM)
        .ok_or_else(|| ChatIpcError::limit_exceeded(Some(request_id)).v6())?;
    let mut limit = requested_limit.unwrap_or(DEFAULT_HISTORY_PAGE_LIMIT);
    loop {
        let snapshot = authorized
            .load_feat137_history_snapshot(context_id, session_id, before_ordinal, Some(limit))
            .await
            .map_err(|error| map_chat_error(error, Some(request_id)).v6())?;
        let probe = history_dto_v6(
            snapshot.history.clone(),
            None,
            snapshot.message_content_blocks.clone(),
            snapshot.artifacts.clone(),
            snapshot.feat134.clone(),
            snapshot.approvals.clone(),
        )
        .map_err(|error| map_chat_error(error, Some(request_id)).v6())?;
        let encoded_bytes = serde_json::to_vec(&probe)
            .map(|encoded| encoded.len())
            .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request_id)).v6())?;
        match next_feat134_history_page_limit(
            snapshot.history.turns.len(),
            encoded_bytes,
            byte_budget,
        ) {
            Ok(None) => return Ok(snapshot),
            Ok(Some(next_limit)) => limit = next_limit,
            Err(()) => return Err(ChatIpcError::limit_exceeded(Some(request_id)).v6()),
        }
    }
}

fn next_feat134_history_page_limit(
    turn_count: usize,
    encoded_bytes: usize,
    byte_budget: usize,
) -> Result<Option<usize>, ()> {
    if encoded_bytes <= byte_budget {
        return Ok(None);
    }
    if turn_count <= 1 {
        return Err(());
    }
    Ok(Some((turn_count / 2).max(1)))
}

fn reasoning_dto(items: Vec<ReasoningItem>) -> Vec<ReasoningItemDto> {
    items
        .into_iter()
        .map(|item| ReasoningItemDto {
            item_ordinal: item.item_ordinal,
            status: reasoning_status(item.status),
            reason_code: item.reason_code,
            finalized_at_ms: item.finalized_at_ms,
            parts: item
                .parts
                .into_iter()
                .map(|part| ReasoningPartDto {
                    content_index: part.content_index,
                    text: part.text,
                })
                .collect(),
        })
        .collect()
}

fn cleanup_dto(status: DeletionStatus) -> CleanupStatusDto {
    CleanupStatusDto {
        operation_id: status.operation_id.to_string(),
        desktop_state: cleanup_state(status.desktop_state),
        host_state: cleanup_state(status.host_state),
        runtime_state: cleanup_state(status.runtime_state),
        outcome_code: status.outcome_code,
        last_error_code: status.last_error_code,
        requested_at: status.requested_at,
        completed_at: status.completed_at,
        expires_at: status.expires_at,
    }
}

fn cleanup_event_payload(status: &DeletionStatus) -> Value {
    let state = if status.completed_at.is_some() {
        "complete"
    } else if status.host_state == CleanupSurfaceState::Incomplete
        || status.runtime_state == CleanupSurfaceState::Incomplete
    {
        "retry_scheduled"
    } else {
        "pending"
    };
    json!({
        "operationId": status.operation_id.to_string(),
        "state": state
    })
}

fn decode_request<T: DeserializeOwned>(raw: Value) -> Result<CommandRequest<T>, ChatIpcError> {
    let request_id = extract_request_id(&raw);
    if serde_json::to_vec(&raw)
        .map(|encoded| encoded.len() > MAX_REQUEST_BYTES)
        .unwrap_or(true)
    {
        return Err(ChatIpcError::limit_exceeded(request_id));
    }
    let request: CommandRequest<T> =
        serde_json::from_value(raw).map_err(|_| ChatIpcError::request_invalid(request_id))?;
    if request.schema_version != CHAT_IPC_SCHEMA_VERSION
        || request.request_id.is_nil()
        || request.context_id.is_nil()
    {
        return Err(ChatIpcError::request_invalid(Some(request.request_id)));
    }
    Ok(request)
}

fn decode_request_v2<T: DeserializeOwned>(raw: Value) -> Result<CommandRequest<T>, ChatIpcError> {
    let request_id = extract_request_id(&raw);
    if serde_json::to_vec(&raw)
        .map(|encoded| encoded.len() > MAX_REQUEST_BYTES)
        .unwrap_or(true)
    {
        return Err(ChatIpcError::limit_exceeded(request_id).v2());
    }
    let request: CommandRequest<T> =
        serde_json::from_value(raw).map_err(|_| ChatIpcError::request_invalid(request_id).v2())?;
    if request.schema_version != CHAT_IPC_V2_SCHEMA_VERSION
        || request.request_id.is_nil()
        || request.context_id.is_nil()
    {
        return Err(ChatIpcError::request_invalid(Some(request.request_id)).v2());
    }
    Ok(request)
}

fn decode_request_v3<T: DeserializeOwned>(raw: Value) -> Result<CommandRequest<T>, ChatIpcError> {
    let request_id = extract_request_id(&raw);
    if serde_json::to_vec(&raw)
        .map(|encoded| encoded.len() > MAX_REQUEST_BYTES)
        .unwrap_or(true)
    {
        return Err(ChatIpcError::limit_exceeded(request_id).v3());
    }
    let request: CommandRequest<T> =
        serde_json::from_value(raw).map_err(|_| ChatIpcError::request_invalid(request_id).v3())?;
    if request.schema_version != CHAT_IPC_V3_SCHEMA_VERSION
        || request.request_id.is_nil()
        || request.context_id.is_nil()
    {
        return Err(ChatIpcError::request_invalid(Some(request.request_id)).v3());
    }
    Ok(request)
}

fn decode_request_v4<T: DeserializeOwned>(raw: Value) -> Result<CommandRequest<T>, ChatIpcError> {
    let request_id = extract_request_id(&raw);
    if serde_json::to_vec(&raw)
        .map(|encoded| encoded.len() > MAX_REQUEST_BYTES)
        .unwrap_or(true)
    {
        return Err(ChatIpcError::limit_exceeded(request_id).v4());
    }
    let request: CommandRequest<T> =
        serde_json::from_value(raw).map_err(|_| ChatIpcError::request_invalid(request_id).v4())?;
    if request.schema_version != CHAT_IPC_V4_SCHEMA_VERSION
        || request.request_id.is_nil()
        || request.context_id.is_nil()
    {
        return Err(ChatIpcError::request_invalid(Some(request.request_id)).v4());
    }
    Ok(request)
}

fn decode_request_v5<T: DeserializeOwned>(raw: Value) -> Result<CommandRequest<T>, ChatIpcError> {
    let request_id = extract_request_id(&raw);
    if serde_json::to_vec(&raw)
        .map(|encoded| encoded.len() > MAX_REQUEST_BYTES)
        .unwrap_or(true)
    {
        return Err(ChatIpcError::limit_exceeded(request_id).v5());
    }
    let request: CommandRequest<T> =
        serde_json::from_value(raw).map_err(|_| ChatIpcError::request_invalid(request_id).v5())?;
    if request.schema_version != CHAT_IPC_V5_SCHEMA_VERSION
        || request.request_id.is_nil()
        || request.context_id.is_nil()
    {
        return Err(ChatIpcError::request_invalid(Some(request.request_id)).v5());
    }
    Ok(request)
}

fn decode_request_v6<T: DeserializeOwned>(raw: Value) -> Result<CommandRequest<T>, ChatIpcError> {
    let request_id = extract_request_id(&raw);
    if serde_json::to_vec(&raw)
        .map(|encoded| encoded.len() > MAX_REQUEST_BYTES)
        .unwrap_or(true)
    {
        return Err(ChatIpcError::limit_exceeded(request_id).v6());
    }
    let request: CommandRequest<T> =
        serde_json::from_value(raw).map_err(|_| ChatIpcError::request_invalid(request_id).v6())?;
    if request.schema_version != CHAT_IPC_V6_SCHEMA_VERSION
        || request.request_id.is_nil()
        || request.context_id.is_nil()
    {
        return Err(ChatIpcError::request_invalid(Some(request.request_id)).v6());
    }
    Ok(request)
}

fn request_schema_version(raw: &Value) -> Option<u8> {
    raw.as_object()?
        .get("schemaVersion")?
        .as_u64()
        .and_then(|value| u8::try_from(value).ok())
}

fn draft_content_blocks(
    blocks: Vec<TurnContentBlockPayload>,
    request_id: Uuid,
) -> Result<Vec<DraftContentBlock>, ChatIpcError> {
    if blocks.is_empty() || blocks.len() > 16 {
        return Err(ChatIpcError::limit_exceeded(Some(request_id)).v2());
    }
    let mut attachment_count = 0_usize;
    let mut result = Vec::with_capacity(blocks.len());
    for block in blocks {
        match block {
            TurnContentBlockPayload::Text { text } => {
                validate_input(&text, request_id).map_err(ChatIpcError::v2)?;
                result.push(DraftContentBlock::Text(text));
            }
            TurnContentBlockPayload::File { attachment_id } => {
                attachment_count += 1;
                if attachment_id.is_nil() {
                    return Err(ChatIpcError::request_invalid(Some(request_id)).v2());
                }
                result.push(DraftContentBlock::File(attachment_id));
            }
            TurnContentBlockPayload::Image { attachment_id } => {
                attachment_count += 1;
                if attachment_id.is_nil() {
                    return Err(ChatIpcError::request_invalid(Some(request_id)).v2());
                }
                result.push(DraftContentBlock::Image(attachment_id));
            }
        }
    }
    if attachment_count > attachment::MAX_ATTACHMENTS_PER_MESSAGE {
        return Err(ChatIpcError::limit_exceeded(Some(request_id)).v2());
    }
    Ok(result)
}

fn map_attachment_import_error(
    error: AttachmentImportError,
    request_id: Uuid,
    item_count: usize,
) -> ChatIpcError {
    let mapped = match error {
        AttachmentImportError::TooMany => ChatIpcError::limit_exceeded(Some(request_id))
            .v2()
            .with_attachment_issue("too_many"),
        AttachmentImportError::TooLarge => ChatIpcError::limit_exceeded(Some(request_id))
            .v2()
            .with_attachment_issue("too_large"),
        AttachmentImportError::ArchiveUnsupported => {
            ChatIpcError::request_invalid(Some(request_id))
                .v2()
                .with_attachment_issue("archive_unsupported")
        }
        AttachmentImportError::Unsupported => ChatIpcError::request_invalid(Some(request_id))
            .v2()
            .with_attachment_issue("unsupported"),
        AttachmentImportError::InvalidContent => ChatIpcError::request_invalid(Some(request_id))
            .v2()
            .with_attachment_issue("invalid_content"),
        AttachmentImportError::ParseFailed => ChatIpcError::request_invalid(Some(request_id))
            .v2()
            .with_attachment_issue("parse_failed"),
        AttachmentImportError::Unavailable => {
            ChatIpcError::temporarily_unavailable(Some(request_id)).v2()
        }
    };
    mapped.with_attachment_item_count(item_count)
}

fn validate_remaining_capacity(
    remaining_capacity: usize,
    request_id: Uuid,
) -> Result<(), ChatIpcError> {
    if !(1..=attachment::MAX_ATTACHMENTS_PER_MESSAGE).contains(&remaining_capacity) {
        return Err(ChatIpcError::request_invalid(Some(request_id)).v2());
    }
    Ok(())
}

fn draft_target(
    payload: DraftTargetPayload,
    request_id: Uuid,
) -> Result<DraftTarget, ChatIpcError> {
    match payload {
        DraftTargetPayload::New {} => Ok(DraftTarget::New),
        DraftTargetPayload::Session { session_id } if !session_id.is_nil() => {
            Ok(DraftTarget::Session(session_id))
        }
        DraftTargetPayload::Session { .. } => {
            Err(ChatIpcError::request_invalid(Some(request_id)).v2())
        }
    }
}

fn draft_target_action(draft_target: &DraftTarget) -> ChatAction {
    match draft_target {
        DraftTarget::New => ChatAction::CreateSession,
        DraftTarget::Session(_) => ChatAction::SubmitTurn,
    }
}

fn validate_attachment_batch_size(
    count: usize,
    remaining_capacity: usize,
    request_id: Uuid,
) -> Result<(), ChatIpcError> {
    validate_remaining_capacity(remaining_capacity, request_id)?;
    if count == 0 {
        return Err(ChatIpcError::request_invalid(Some(request_id)).v2());
    }
    if count > remaining_capacity || count > attachment::MAX_ATTACHMENTS_PER_MESSAGE {
        return Err(ChatIpcError::limit_exceeded(Some(request_id))
            .v2()
            .with_attachment_issue("too_many")
            .with_attachment_item_count(count));
    }
    Ok(())
}

fn validate_attachment_paths(
    paths: &[String],
    request_id: Uuid,
) -> Result<Vec<PathBuf>, ChatIpcError> {
    let mut unique = HashSet::with_capacity(paths.len());
    let mut validated = Vec::with_capacity(paths.len());
    for raw in paths {
        if raw.is_empty() || raw.len() > 4096 || raw.contains('\0') {
            return Err(ChatIpcError::request_invalid(Some(request_id)).v2());
        }
        let path = PathBuf::from(raw);
        if !path.is_absolute() || !unique.insert(path.clone()) {
            return Err(ChatIpcError::request_invalid(Some(request_id)).v2());
        }
        validated.push(path);
    }
    Ok(validated)
}

async fn prepare_attachments(
    app: AppHandle,
    context_id: Uuid,
    operation_id: Uuid,
    paths: Vec<PathBuf>,
    now: i64,
    remaining_capacity: usize,
    request_id: Uuid,
) -> Result<(Vec<PreparedAttachment>, AttachmentImportEventEmitter), ChatIpcError> {
    let item_count = paths.len();
    let (result, emitter) = tokio::task::spawn_blocking(move || {
        let mut emitter =
            AttachmentImportEventEmitter::new(app, context_id, operation_id, item_count);
        let result =
            attachment::prepare_paths_with_progress(paths, now, remaining_capacity, |progress| {
                emitter.emit_progress(progress)
            });
        (result, emitter)
    })
    .await
    .map_err(|_| {
        ChatIpcError::temporarily_unavailable(Some(request_id))
            .v2()
            .with_attachment_item_count(item_count)
    })?;
    result
        .map(|attachments| (attachments, emitter))
        .map_err(|error| map_attachment_import_error(error, request_id, item_count))
}

fn decode_bind_request(raw: Value) -> Result<BindRequest, ChatIpcError> {
    let request_id = extract_request_id(&raw);
    if serde_json::to_vec(&raw)
        .map(|encoded| encoded.len() > MAX_REQUEST_BYTES)
        .unwrap_or(true)
    {
        return Err(ChatIpcError::limit_exceeded(request_id));
    }
    let request: BindRequest =
        serde_json::from_value(raw).map_err(|_| ChatIpcError::request_invalid(request_id))?;
    if request.schema_version != CHAT_IPC_SCHEMA_VERSION
        || request.request_id.is_nil()
        || Uuid::parse_str(&request.payload.tenant_selector).is_err()
        || request.payload.tenant_selector.len() != 36
    {
        return Err(ChatIpcError::request_invalid(Some(request.request_id)));
    }
    Ok(request)
}

fn extract_request_id(value: &Value) -> Option<Uuid> {
    value
        .as_object()
        .and_then(|object| object.get("requestId"))
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .filter(|value| !value.is_nil())
}

fn authorize(
    manager: &ChatAuthorizationManager,
    context_id: Uuid,
    action: ChatAction,
    request_id: Uuid,
) -> Result<(), ChatIpcError> {
    match manager.authorize_detailed(
        context_id,
        action,
        unix_seconds().map_err(|error| map_chat_error(error, Some(request_id)))?,
    ) {
        Ok(()) => Ok(()),
        Err(AuthorizationFailure::ContextInvalid) => {
            Err(ChatIpcError::context_invalid(Some(request_id)))
        }
        Err(AuthorizationFailure::CapabilityDenied) => {
            Err(ChatIpcError::capability_denied(Some(request_id)))
        }
    }
}

fn map_chat_error(error: ChatError, request_id: Option<Uuid>) -> ChatIpcError {
    match error {
        ChatError::ScopeDenied => ChatIpcError::context_invalid(request_id),
        ChatError::InvalidInput | ChatError::InvalidConfiguration => {
            ChatIpcError::request_invalid(request_id)
        }
        ChatError::ProjectionLimitExceeded => ChatIpcError::limit_exceeded(request_id),
        ChatError::NotFound => {
            ChatIpcError::new(request_id, "chat_resource_not_found", false, "reload")
        }
        ChatError::ProjectUnavailable | ChatError::NativePickerUnavailable => ChatIpcError::new(
            request_id,
            "chat_project_invalid",
            false,
            "reselect_project",
        ),
        ChatError::ConversationConflict | ChatError::ProjectionReconciliationFailed => {
            ChatIpcError::conflict(request_id)
        }
        ChatError::SidecarUnavailable => {
            ChatIpcError::new(request_id, "chat_host_not_ready", true, "start_host")
        }
        ChatError::CleanupIncomplete => {
            ChatIpcError::new(request_id, "chat_cleanup_incomplete", true, "wait_cleanup")
        }
        ChatError::DatabaseBusy
        | ChatError::DatabaseUnavailable
        | ChatError::DatabaseReadOnly
        | ChatError::DatabaseFull
        | ChatError::DatabaseCorrupt
        | ChatError::DatabaseKeyMissing
        | ChatError::DatabaseUnsafe
        | ChatError::MigrationFailed
        | ChatError::SecureStorageUnavailable => {
            ChatIpcError::new(request_id, "chat_storage_unavailable", true, "retry")
        }
        ChatError::OrchestrationUnavailable => {
            ChatIpcError::new(request_id, "chat_protocol_error", false, "resync")
        }
        ChatError::Disabled => ChatIpcError::temporarily_unavailable(request_id),
    }
}

#[tauri::command]
pub async fn chat_get_local_readiness_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
) -> Result<CommandResponse<super::ChatLocalReadiness>, ChatIpcError> {
    let request: CommandRequest<EmptyPayload> = decode_request(request)?;
    let manager = chat_runtime
        .authorization_manager()
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadSessions,
        request.request_id,
    )?;
    Ok(CommandResponse::new(
        request.request_id,
        chat_runtime.local_readiness(false).await,
    ))
}

#[tauri::command]
pub async fn chat_request_local_recovery_v1(
    request: Value,
    app: AppHandle,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<super::ChatLocalReadiness>, ChatIpcError> {
    let request: CommandRequest<RecoveryPayload> = decode_request(request)?;
    validate_operation(request.payload.operation_id, request.request_id)?;
    let RecoveryIntent::StartOrRetry = request.payload.intent;
    let manager = chat_runtime
        .authorization_manager()
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadSessions,
        request.request_id,
    )?;
    let recovery_plan = local_recovery_plan(chat_runtime.feat137_streaming_enabled());
    if recovery_plan.revoke_approval_authority {
        let stopped = ipc_runtime.stop_coordinator().await;
        // Even an unknown coordinator stop outcome cannot preserve Host-minted
        // action authority across a recovery generation.
        ipc_runtime.invalidate_all();
        stopped.map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    }
    let mut readiness = chat_runtime.request_local_recovery().await;
    if readiness.host == super::ChatHostReadiness::Ready
        && readiness.storage == super::ChatStorageReadiness::Ready
    {
        let resumed = if recovery_plan.resume_bound_sessions {
            ipc_runtime
                .ensure_bound_sessions_resumed(&chat_runtime)
                .await
        } else {
            Ok(())
        };
        #[cfg(not(feature = "feat126-s10-driver"))]
        let recovered = if recovery_plan.restart_normal_coordinator {
            match resumed {
                Ok(()) => match chat_runtime.local_conversation_application().await {
                    Ok(application) => {
                        ipc_runtime
                            .ensure_coordinator(app, application, manager)
                            .await
                    }
                    Err(error) => Err(error),
                },
                Err(error) => Err(error),
            }
        } else {
            Ok(())
        };
        #[cfg(feature = "feat126-s10-driver")]
        let recovered = resumed;
        #[cfg(feature = "feat126-s10-driver")]
        let _ = app;
        if recovered.is_err() {
            chat_runtime.invalidate_host_bridge().await;
            readiness = chat_runtime.local_readiness(false).await;
        }
    }
    Ok(CommandResponse::new(request.request_id, readiness))
}

fn validate_input(input: &str, request_id: Uuid) -> Result<(), ChatIpcError> {
    if input.trim().is_empty() || input.len() > MAX_INPUT_BYTES || input.contains('\0') {
        return Err(ChatIpcError::limit_exceeded(Some(request_id)));
    }
    Ok(())
}

fn validate_title(title: &str, request_id: Uuid) -> Result<(), ChatIpcError> {
    if title.trim().is_empty() || title.len() > MAX_TITLE_BYTES || title.contains('\0') {
        return Err(ChatIpcError::request_invalid(Some(request_id)));
    }
    Ok(())
}

fn validate_operation(operation_id: Uuid, request_id: Uuid) -> Result<(), ChatIpcError> {
    if operation_id.is_nil() {
        Err(ChatIpcError::request_invalid(Some(request_id)))
    } else {
        Ok(())
    }
}

fn enforce_response_limit<T: Serialize>(
    value: &T,
    limit: usize,
    request_id: Uuid,
) -> Result<(), ChatIpcError> {
    if serde_json::to_vec(value)
        .map(|encoded| encoded.len() <= limit)
        .unwrap_or(false)
    {
        Ok(())
    } else {
        Err(ChatIpcError::limit_exceeded(Some(request_id)))
    }
}

fn unix_seconds() -> Result<i64, ChatError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_secs()).ok())
        .ok_or(ChatError::InvalidInput)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::{
        CommandProjection, CommandStatus, LiveReasoningProjection, ProjectionError,
        ProjectionErrorCode, ReasoningPart, TimelineItemStatus,
    };
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use tokio::sync::Notify;

    #[test]
    #[cfg(not(feature = "feat126-s10-driver"))]
    fn feat137_normal_recovery_plan_is_exactly_gated() {
        assert_eq!(
            local_recovery_plan(false),
            LocalRecoveryPlan {
                revoke_approval_authority: false,
                resume_bound_sessions: false,
                restart_normal_coordinator: false,
            }
        );
        assert_eq!(
            local_recovery_plan(true),
            LocalRecoveryPlan {
                revoke_approval_authority: true,
                resume_bound_sessions: true,
                restart_normal_coordinator: true,
            }
        );
        assert_eq!(bind_lifecycle(false), BindLifecycle::Legacy);
        assert_eq!(bind_lifecycle(true), BindLifecycle::Feat137);
    }

    #[test]
    #[cfg(feature = "feat126-s10-driver")]
    fn feat126_s10_recovery_delegates_each_resume_to_chat_runtime() {
        assert_eq!(
            local_recovery_plan(false),
            LocalRecoveryPlan {
                revoke_approval_authority: false,
                resume_bound_sessions: false,
                restart_normal_coordinator: false,
            }
        );
        assert_eq!(bind_lifecycle(false), BindLifecycle::Legacy);
        assert_eq!(bind_lifecycle(true), BindLifecycle::Legacy);
    }

    #[tokio::test]
    async fn feat137_host_generation_resume_is_atomic_exactly_once_and_failure_safe() {
        let state = Mutex::new(None);
        let resumes = AtomicUsize::new(0);
        for generation in ["generation-a", "generation-a", "generation-b"] {
            ensure_host_generation_once(
                &state,
                || async { Ok::<_, &'static str>((generation.to_owned(), ())) },
                |_| async {
                    resumes.fetch_add(1, AtomicOrdering::SeqCst);
                    Ok(())
                },
            )
            .await
            .unwrap();
        }
        assert_eq!(resumes.load(AtomicOrdering::SeqCst), 2);
        assert_eq!(state.lock().await.as_deref(), Some("generation-b"));

        let failed_state = Mutex::new(None);
        let failed_resumes = AtomicUsize::new(0);
        let failed = ensure_host_generation_once(
            &failed_state,
            || async { Ok::<_, &'static str>(("generation-c".to_owned(), ())) },
            |_| async {
                failed_resumes.fetch_add(1, AtomicOrdering::SeqCst);
                Err("resume_failed")
            },
        )
        .await;
        assert_eq!(failed, Err("resume_failed"));
        assert!(failed_state.lock().await.is_none());
        ensure_host_generation_once(
            &failed_state,
            || async { Ok::<_, &'static str>(("generation-c".to_owned(), ())) },
            |_| async {
                failed_resumes.fetch_add(1, AtomicOrdering::SeqCst);
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(failed_resumes.load(AtomicOrdering::SeqCst), 2);
    }

    #[tokio::test]
    async fn feat137_host_generation_discovery_waits_inside_singleflight() {
        let state = Arc::new(Mutex::new(None));
        let acquired = Arc::new(AtomicUsize::new(0));
        let resumed = Arc::new(AtomicUsize::new(0));
        let first_resume_started = Arc::new(Notify::new());
        let release_first_resume = Arc::new(Notify::new());

        let first = tokio::spawn({
            let state = state.clone();
            let acquired = acquired.clone();
            let resumed = resumed.clone();
            let first_resume_started = first_resume_started.clone();
            let release_first_resume = release_first_resume.clone();
            async move {
                ensure_host_generation_once(
                    &state,
                    || async move {
                        acquired.fetch_add(1, AtomicOrdering::SeqCst);
                        Ok::<_, &'static str>(("generation-a".to_owned(), ()))
                    },
                    |_| async move {
                        resumed.fetch_add(1, AtomicOrdering::SeqCst);
                        first_resume_started.notify_one();
                        release_first_resume.notified().await;
                        Ok(())
                    },
                )
                .await
            }
        });
        first_resume_started.notified().await;

        let second = tokio::spawn({
            let state = state.clone();
            let acquired = acquired.clone();
            let resumed = resumed.clone();
            async move {
                ensure_host_generation_once(
                    &state,
                    || async move {
                        acquired.fetch_add(1, AtomicOrdering::SeqCst);
                        Ok::<_, &'static str>(("generation-b".to_owned(), ()))
                    },
                    |_| async move {
                        resumed.fetch_add(1, AtomicOrdering::SeqCst);
                        Ok(())
                    },
                )
                .await
            }
        });
        tokio::task::yield_now().await;
        assert_eq!(acquired.load(AtomicOrdering::SeqCst), 1);
        release_first_resume.notify_one();
        first.await.unwrap().unwrap();
        second.await.unwrap().unwrap();
        assert_eq!(acquired.load(AtomicOrdering::SeqCst), 2);
        assert_eq!(resumed.load(AtomicOrdering::SeqCst), 2);
        assert_eq!(state.lock().await.as_deref(), Some("generation-b"));
    }

    #[test]
    fn feat137_decision_ipc_accepts_only_local_identity_and_closed_decision() {
        let request_id = Uuid::now_v7();
        let context_id = Uuid::now_v7();
        let session_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        let approval_request_id = Uuid::now_v7();
        let request = json!({
            "schemaVersion": 6,
            "requestId": request_id,
            "contextId": context_id,
            "payload": {
                "sessionId": session_id,
                "turnId": turn_id,
                "itemId": "command-approval",
                "approvalRequestId": approval_request_id,
                "decision": "accept_once",
            }
        });
        let decoded: CommandRequest<DecideApprovalV6Payload> =
            decode_request_v6(request.clone()).unwrap();
        assert_eq!(decoded.payload.session_id, session_id);
        assert_eq!(decoded.payload.turn_id, turn_id);
        assert_eq!(decoded.payload.approval_request_id, approval_request_id);
        assert_eq!(decoded.payload.decision, HostApprovalDecision::AcceptOnce);

        for forbidden in [
            "decisionId",
            "expectedStreamId",
            "agentSessionId",
            "runtimeTurnId",
            "rawCommand",
            "cwd",
        ] {
            let mut widened = request.clone();
            widened["payload"][forbidden] = json!(Uuid::now_v7().to_string());
            assert!(decode_request_v6::<DecideApprovalV6Payload>(widened).is_err());
        }
        let mut unknown_decision = request;
        unknown_decision["payload"]["decision"] = json!("always_allow");
        assert!(decode_request_v6::<DecideApprovalV6Payload>(unknown_decision).is_err());
    }

    #[test]
    fn feat137_resync_requires_one_closed_non_nil_subscription_continuation() {
        let request_id = Uuid::now_v7();
        let context_id = Uuid::now_v7();
        let session_id = Uuid::now_v7();
        let subscription_id = Uuid::now_v7();
        let request = json!({
            "schemaVersion": 6,
            "requestId": request_id,
            "contextId": context_id,
            "payload": {
                "sessionId": session_id,
                "subscriptionId": subscription_id,
                "limit": 20,
            }
        });
        let decoded: CommandRequest<SessionResyncV6Payload> =
            decode_request_v6(request.clone()).unwrap();
        assert_eq!(decoded.payload.session_id, session_id);
        assert_eq!(decoded.payload.subscription_id, subscription_id);

        let mut missing = request.clone();
        missing["payload"]
            .as_object_mut()
            .unwrap()
            .remove("subscriptionId");
        assert!(decode_request_v6::<SessionResyncV6Payload>(missing).is_err());
        let mut widened = request;
        widened["payload"]["hostStreamId"] = json!(Uuid::now_v7());
        assert!(decode_request_v6::<SessionResyncV6Payload>(widened).is_err());
    }

    #[test]
    fn feat137_decision_failure_is_non_retryable_and_requires_resync() {
        let request_id = Uuid::now_v7();
        let value = serde_json::to_value(
            ChatIpcError::approval_reconciliation_required(
                request_id,
                ApprovalIssue::ApprovalUnavailable,
            )
            .v6(),
        )
        .unwrap();
        assert_eq!(
            value,
            json!({
                "schemaVersion": 6,
                "requestId": request_id.to_string(),
                "code": "chat_conflict",
                "retryable": false,
                "recovery": "resync",
                "approvalIssue": "approval_unavailable",
            })
        );
    }

    #[test]
    fn artifact_live_schema_and_queue_are_closed_bounded_monotonic_and_content_free() {
        let schema: Value = serde_json::from_str(include_str!(
            "../../schemas/chat-artifact-live-v1.schema.json"
        ))
        .expect("artifact live schema");
        assert_eq!(schema["x-yijie-schema-version"], 1);
        assert_eq!(
            schema["x-yijie-event-channel"],
            CHAT_ARTIFACT_LIVE_EVENT_CHANNEL
        );
        assert_eq!(schema["$defs"]["common"]["additionalProperties"], false);

        let subscription_id = Uuid::now_v7();
        let context_id = Uuid::now_v7();
        let session_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        let mut queue = ArtifactNotificationQueue::default();
        for _ in 0..=MAX_ARTIFACT_NOTIFICATION_QUEUE {
            queue.enqueue_changed(Uuid::now_v7());
        }
        let events = queue
            .drain(subscription_id, context_id, session_id, turn_id)
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].notification_sequence, "1");
        assert_eq!(events[0].kind, "resync_required");
        assert_eq!(events[0].payload, json!({"reason":"backpressure"}));
        queue.enqueue_changed(Uuid::now_v7());
        let next = queue
            .drain(subscription_id, context_id, session_id, turn_id)
            .unwrap();
        assert_eq!(next[0].notification_sequence, "2");
        let encoded = serde_json::to_string(&next).unwrap().to_ascii_lowercase();
        for forbidden in [
            "artifactid",
            "media",
            "size",
            "bytes",
            "base64",
            "digest",
            "href",
            "path",
            "token",
            "requestid",
            "error",
        ] {
            assert!(!encoded.contains(forbidden), "leaked {forbidden}");
        }
    }

    const COMMAND_NAMES: [&str; 23] = [
        "chat_bind_context_v1",
        "chat_list_projects_v1",
        "chat_pick_project_v1",
        "chat_revalidate_project_v1",
        "chat_set_project_pinned_v1",
        "chat_remove_project_v1",
        "chat_create_session_v1",
        "chat_submit_turn_v1",
        "chat_list_sessions_v1",
        "chat_load_history_v1",
        "chat_load_reasoning_v1",
        "chat_rename_session_v1",
        "chat_set_session_pinned_v1",
        "chat_interrupt_turn_v1",
        "chat_delete_session_v1",
        "chat_get_cleanup_status_v1",
        "chat_get_session_control_plane_v1",
        "chat_get_local_readiness_v1",
        "chat_request_local_recovery_v1",
        "chat_subscribe_session_v1",
        "chat_resync_session_v1",
        "chat_cancel_request_v1",
        "chat_unsubscribe_session_v1",
    ];

    #[test]
    fn schema_and_golden_fixtures_freeze_closed_v1_allowlists() {
        let schema: Value =
            serde_json::from_str(include_str!("../../schemas/chat-ipc-v1.schema.json"))
                .expect("schema json");
        assert_eq!(schema["x-yijie-schema-version"], 1);
        assert_eq!(schema["x-yijie-event-channel"], CHAT_EVENT_CHANNEL);
        assert_eq!(
            schema["x-yijie-control-plane-event-channel"],
            CHAT_CONTROL_PLANE_EVENT_CHANNEL
        );
        for channel in [CHAT_EVENT_CHANNEL, CHAT_CONTROL_PLANE_EVENT_CHANNEL] {
            assert!(
                channel
                    .chars()
                    .all(|value| value.is_ascii_alphanumeric() || "-/:_".contains(value)),
                "Tauri event channel must use its closed EventName character set"
            );
        }
        assert_eq!(
            schema["x-yijie-command-names"],
            serde_json::to_value(COMMAND_NAMES).unwrap()
        );
        let contracts = schema["x-yijie-command-contracts"]
            .as_object()
            .expect("command contract map");
        assert_eq!(contracts.len(), COMMAND_NAMES.len());
        let definitions = schema["$defs"].as_object().expect("schema definitions");
        for command in COMMAND_NAMES {
            let contract = contracts
                .get(command)
                .and_then(Value::as_object)
                .expect("command contract");
            assert_eq!(contract.len(), 2, "closed command contract: {command}");
            for surface in ["request", "response"] {
                let reference = contract[surface].as_str().expect("contract reference");
                let definition = reference
                    .strip_prefix("#/$defs/")
                    .expect("local definition reference");
                assert!(
                    definitions.contains_key(definition),
                    "missing {surface} definition for {command}: {definition}"
                );
            }
        }
        let error_codes = schema["x-yijie-error-codes"]
            .as_array()
            .expect("error code list");
        assert_eq!(error_codes.len(), 16);
        let event_kinds = schema["x-yijie-event-kinds"]
            .as_array()
            .expect("event kinds");
        assert_eq!(event_kinds.len(), 7);
        let event_variants = definitions["event"]["oneOf"]
            .as_array()
            .expect("closed event variants");
        assert_eq!(event_variants.len(), event_kinds.len());
        for variant in event_variants {
            let reference = variant["$ref"].as_str().expect("event reference");
            let definition = reference
                .strip_prefix("#/$defs/")
                .expect("local event definition");
            assert!(definitions.contains_key(definition));
        }
        for payload in [
            "bindPayload",
            "emptyPayload",
            "operationOnlyPayload",
            "recoveryPayload",
            "projectOperationPayload",
            "setProjectPinnedPayload",
            "createSessionPayload",
            "submitTurnPayload",
            "listSessionsPayload",
            "sessionReadPayload",
            "reasoningPayload",
            "renameSessionPayload",
            "setSessionPinnedPayload",
            "sessionOperationPayload",
            "cleanupStatusPayload",
            "sessionControlPlanePayload",
            "subscribePayload",
            "unsubscribePayload",
            "cancelPayload",
            "assistantPayload",
            "reasoningAppendPayload",
            "turnStatePayload",
            "turnTerminalPayload",
            "cleanupEventPayload",
            "resyncRequiredPayload",
            "contextInvalidatedPayload",
        ] {
            assert_eq!(
                definitions[payload]["additionalProperties"],
                Value::Bool(false),
                "payload must be closed: {payload}"
            );
        }

        assert_eq!(
            definitions["controlPlaneEvent"]["additionalProperties"],
            Value::Bool(false)
        );

        let bind: Value =
            serde_json::from_str(include_str!("../../fixtures/chat-ipc-v1/bind-request.json"))
                .unwrap();
        let decoded = decode_bind_request(bind).expect("closed bind fixture");
        assert_eq!(decoded.schema_version, 1);
        assert_eq!(
            decoded.payload.tenant_selector,
            "019c1a00-0000-7000-8000-000000000002"
        );

        let mut with_owner: Value =
            serde_json::from_str(include_str!("../../fixtures/chat-ipc-v1/bind-request.json"))
                .unwrap();
        with_owner
            .as_object_mut()
            .unwrap()
            .insert("ownerUserId".to_owned(), json!(Uuid::now_v7()));
        assert!(decode_bind_request(with_owner).is_err());

        let app_source = include_str!("../lib.rs");
        for command in COMMAND_NAMES {
            assert!(
                app_source.contains(&format!("chat::ipc::{command}")),
                "versioned private command missing from invoke handler: {command}"
            );
        }
        for legacy in [
            "chat::chat_list_projects,",
            "chat::chat_pick_project,",
            "chat::chat_revalidate_project,",
            "chat::chat_set_project_pinned,",
            "chat::chat_remove_project,",
        ] {
            assert!(
                !app_source.contains(legacy),
                "legacy project IPC bypass remains registered: {legacy}"
            );
        }

        let capability: Value =
            serde_json::from_str(include_str!("../../capabilities/default.json"))
                .expect("Tauri capability");
        let permissions = capability["permissions"]
            .as_array()
            .expect("capability permissions");
        for required in ["core:event:allow-listen", "core:event:allow-unlisten"] {
            assert!(permissions.iter().any(|permission| permission == required));
        }
        for forbidden in [
            "core:event:default",
            "core:event:allow-emit",
            "core:event:allow-emit-to",
        ] {
            assert!(!permissions.iter().any(|permission| permission == forbidden));
        }
    }

    #[test]
    fn private_v3_schema_is_metadata_only_and_version_negotiated() {
        let schema: Value =
            serde_json::from_str(include_str!("../../schemas/chat-ipc-v3.schema.json"))
                .expect("v3 schema json");
        assert_eq!(schema["x-yijie-schema-version"], 3);
        assert_eq!(
            schema["x-yijie-command-names"],
            json!(["chat_load_history_v3"])
        );
        let properties = schema["$defs"]["artifact"]["properties"]
            .as_object()
            .expect("artifact properties");
        for forbidden in [
            "sha256",
            "contentHref",
            "posterHref",
            "bytes",
            "path",
            "token",
        ] {
            assert!(!properties.contains_key(forbidden));
        }
        let request_id = Uuid::now_v7();
        let request: CommandRequest<SessionReadPayload> = decode_request_v3(json!({
            "schemaVersion": 3,
            "requestId": request_id,
            "contextId": Uuid::now_v7(),
            "payload": {"sessionId": Uuid::now_v7()}
        }))
        .expect("closed v3 request");
        assert_eq!(request.schema_version, CHAT_IPC_V3_SCHEMA_VERSION);
        let error = decode_request_v3::<SessionReadPayload>(json!({
            "schemaVersion": 2,
            "requestId": request_id,
            "contextId": Uuid::now_v7(),
            "payload": {"sessionId": Uuid::now_v7()}
        }));
        let Err(error) = error else {
            panic!("v2 request cannot call v3 command");
        };
        assert_eq!(error.schema_version, CHAT_IPC_V3_SCHEMA_VERSION);
    }

    #[test]
    fn errors_and_context_fixture_never_expose_authority_or_secret_fields() {
        fn assert_response<T: Serialize>(corpus: &Value, name: &str, request_id: Uuid, data: T) {
            assert_eq!(
                serde_json::to_value(CommandResponse::new(request_id, data)).unwrap(),
                corpus[name],
                "Rust response DTO drift: {name}"
            );
        }

        let error = ChatIpcError::context_invalid(Some(
            Uuid::parse_str("019c1a00-0000-7000-8000-000000000001").unwrap(),
        ));
        let encoded = serde_json::to_value(error).unwrap();
        let fixture: Value =
            serde_json::from_str(include_str!("../../fixtures/chat-ipc-v1/error.json")).unwrap();
        assert_eq!(encoded, fixture);

        let response = CommandResponse::new(
            Uuid::parse_str("019c1a00-0000-7000-8000-000000000001").unwrap(),
            BoundContextDto {
                context_id: "019c1a00-0000-7000-8000-000000000003".to_owned(),
                expires_at_epoch_seconds: 1_785_758_700,
                allowed_actions: vec!["read_sessions", "read_projects"],
            },
        );
        let encoded = serde_json::to_value(response).unwrap();
        let fixture: Value = serde_json::from_str(include_str!(
            "../../fixtures/chat-ipc-v1/context-response.json"
        ))
        .unwrap();
        assert_eq!(encoded, fixture);
        let text = encoded.to_string().to_ascii_lowercase();
        for forbidden in [
            "owner",
            "bearer",
            "sqlcipher",
            "projectpath",
            "runtime",
            "hostid",
        ] {
            assert!(!text.contains(forbidden), "forbidden key {forbidden}");
        }

        let request_id = Uuid::parse_str("019c1a00-0000-7000-8000-000000000001").unwrap();
        let project_id = "019c1a00-0000-7000-8000-000000000009";
        let session_id = "019c1a00-0000-7000-8000-000000000005";
        let turn_id = "019c1a00-0000-7000-8000-000000000006";
        let operation_id = "019c1a00-0000-7000-8000-00000000000b";
        let corpus: Value = serde_json::from_str(include_str!(
            "../../fixtures/chat-ipc-v1/response-corpus.json"
        ))
        .unwrap();
        let control_status = PublicTaskControlPlaneStatus {
            session_id: Uuid::parse_str(session_id).unwrap(),
            state: PublicTaskBindingState::RetryWait,
            issue_code: Some("chat_temporarily_unavailable".to_owned()),
            host_session_bound: false,
        };
        let control_response: Value = serde_json::from_str(include_str!(
            "../../fixtures/chat-ipc-v1/control-plane-response.json"
        ))
        .unwrap();
        assert_eq!(
            serde_json::to_value(CommandResponse::new(
                request_id,
                ControlPlaneDto::from_status(&control_status, false),
            ))
            .unwrap(),
            control_response
        );
        let control_event: Value = serde_json::from_str(include_str!(
            "../../fixtures/chat-ipc-v1/control-plane-event.json"
        ))
        .unwrap();
        assert_eq!(
            serde_json::to_value(ControlPlaneEventDto::from_status(
                7,
                &PublicTaskControlPlaneStatus {
                    session_id: Uuid::parse_str(session_id).unwrap(),
                    state: PublicTaskBindingState::Bound,
                    issue_code: None,
                    host_session_bound: true,
                },
                false,
            ))
            .unwrap(),
            control_event
        );
        assert_response(
            &corpus,
            "projectList",
            request_id,
            vec![ProjectDto {
                project_id: project_id.to_owned(),
                safe_name: "Synthetic Project".to_owned(),
                pinned_at: Some(1_785_758_000),
                last_used_at: 1_785_758_100,
                available: true,
            }],
        );
        assert_response(&corpus, "optionalProject", request_id, None::<ProjectDto>);
        assert_response(
            &corpus,
            "project",
            request_id,
            ProjectDto {
                project_id: project_id.to_owned(),
                safe_name: "Synthetic Project".to_owned(),
                pinned_at: None,
                last_used_at: 1_785_758_100,
                available: true,
            },
        );
        assert_response(
            &corpus,
            "operation",
            request_id,
            OperationDto {
                operation_id: operation_id.to_owned(),
            },
        );
        assert_response(
            &corpus,
            "createdTurn",
            request_id,
            CreatedSessionDto {
                session_id: session_id.to_owned(),
                turn_id: turn_id.to_owned(),
                operation_id: operation_id.to_owned(),
            },
        );
        assert_response(
            &corpus,
            "sessionPage",
            request_id,
            SessionPageDto {
                sessions: vec![SessionDto {
                    session_id: session_id.to_owned(),
                    project_id: project_id.to_owned(),
                    title: "Synthetic Session".to_owned(),
                    title_source: "fallback",
                    pinned_at: None,
                    last_activity_at: 1_785_758_200,
                    latest_turn_status: Some("completed".to_owned()),
                    project_available: true,
                }],
                next_cursor: Some("abcdef0123456789".to_owned()),
            },
        );
        assert_response(
            &corpus,
            "historyPage",
            request_id,
            HistoryPageDto {
                turns: vec![HistoryTurnDto {
                    turn_id: turn_id.to_owned(),
                    status: "completed".to_owned(),
                    terminal_at: Some(1_785_758_300),
                    reasoning_status: "complete".to_owned(),
                    reasoning_reason_code: None,
                    messages: vec![MessageDto {
                        message_id: "019c1a00-0000-7000-8000-00000000000a".to_owned(),
                        role: "assistant".to_owned(),
                        content: "synthetic assistant fixture".to_owned(),
                        status: "completed".to_owned(),
                        ordinal: 1,
                        created_at: 1_785_758_250,
                    }],
                    reasoning: vec![ReasoningMetadataDto {
                        item_ordinal: 0,
                        status: "complete",
                        reason_code: None,
                        total_bytes: 27,
                        part_count: 1,
                        finalized_at_ms: 1_785_758_300_000,
                    }],
                }],
                next_cursor: None,
            },
        );
        assert_response(
            &corpus,
            "reasoningList",
            request_id,
            vec![ReasoningItemDto {
                item_ordinal: 0,
                status: "complete",
                reason_code: None,
                finalized_at_ms: 1_785_758_300_000,
                parts: vec![ReasoningPartDto {
                    content_index: 0,
                    text: "synthetic reasoning fixture".to_owned(),
                }],
            }],
        );
        assert_response(
            &corpus,
            "cleanup",
            request_id,
            CleanupStatusDto {
                operation_id: operation_id.to_owned(),
                desktop_state: "complete",
                host_state: "complete",
                runtime_state: "complete",
                outcome_code: "cleanup_complete".to_owned(),
                last_error_code: None,
                requested_at: 1_785_758_200,
                completed_at: Some(1_785_758_300),
                expires_at: Some(1_788_350_300),
            },
        );
        assert_response(
            &corpus,
            "optionalCleanup",
            request_id,
            None::<CleanupStatusDto>,
        );
        assert_response(
            &corpus,
            "subscription",
            request_id,
            SubscriptionDto {
                subscription_id: "019c1a00-0000-7000-8000-000000000004".to_owned(),
            },
        );
        assert_response(
            &corpus,
            "cancelled",
            request_id,
            CancelledDto { cancelled: true },
        );
        assert_response(
            &corpus,
            "localReadiness",
            request_id,
            super::super::ChatLocalReadiness {
                lifecycle: super::super::ChatReadinessLifecycle::Ready,
                host: super::super::ChatHostReadiness::Ready,
                runtime: super::super::ChatRuntimeReadiness::Ready,
                storage: super::super::ChatStorageReadiness::Ready,
                can_send: true,
                issue_code: None,
                retryable: false,
                recovery: "none",
                retry_after_ms: None,
            },
        );
        assert_response(
            &corpus,
            "resync",
            request_id,
            ResyncDto {
                session: SessionDto {
                    session_id: session_id.to_owned(),
                    project_id: project_id.to_owned(),
                    title: "Synthetic Session".to_owned(),
                    title_source: "fallback",
                    pinned_at: None,
                    last_activity_at: 1_785_758_200,
                    latest_turn_status: Some("completed".to_owned()),
                    project_available: true,
                },
                history: HistoryPageDto {
                    turns: Vec::new(),
                    next_cursor: None,
                },
                cleanup: None,
            },
        );

        let event_corpus: Vec<Value> =
            serde_json::from_str(include_str!("../../fixtures/chat-ipc-v1/event-corpus.json"))
                .unwrap();
        let mut record = SubscriptionRecord {
            schema_version: CHAT_IPC_SCHEMA_VERSION,
            context_id: Uuid::parse_str("019c1a00-0000-7000-8000-000000000003").unwrap(),
            session_id: Uuid::parse_str(session_id).unwrap(),
            projection_sequence: 0,
            assistant_text: String::new(),
            reasoning: HashMap::new(),
            terminal: false,
            blocked: false,
            artifact_turn_id: None,
            artifact_notifications: ArtifactNotificationQueue::default(),
        };
        let subscription_id = Uuid::parse_str("019c1a00-0000-7000-8000-000000000004").unwrap();
        let turn_id = Uuid::parse_str(turn_id).unwrap();
        for expected in event_corpus {
            record.projection_sequence = expected["projectionSequence"]
                .as_str()
                .unwrap()
                .parse()
                .unwrap();
            let kind = match expected["kind"].as_str().unwrap() {
                "assistant_append" => "assistant_append",
                "reasoning_append" => "reasoning_append",
                "turn_state" => "turn_state",
                "turn_terminal" => "turn_terminal",
                "cleanup_state" => "cleanup_state",
                "resync_required" => "resync_required",
                "context_invalidated" => "context_invalidated",
                _ => unreachable!(),
            };
            let event_turn_id = if matches!(
                kind,
                "assistant_append" | "reasoning_append" | "turn_state" | "turn_terminal"
            ) {
                Some(turn_id)
            } else {
                None
            };
            let mut encoded = serde_json::to_value(event_envelope(
                subscription_id,
                &record,
                event_turn_id,
                kind,
                expected["payload"].clone(),
            ))
            .unwrap();
            encoded["eventId"] = expected["eventId"].clone();
            assert_eq!(encoded, expected, "Rust event DTO drift: {kind}");
        }
    }

    #[test]
    fn projection_is_incremental_bounded_and_uses_only_local_reasoning_ordinals() {
        let context_id = Uuid::now_v7();
        let session_id = Uuid::now_v7();
        let subscription_id = Uuid::now_v7();
        let mut record = SubscriptionRecord {
            schema_version: CHAT_IPC_SCHEMA_VERSION,
            context_id,
            session_id,
            projection_sequence: 0,
            assistant_text: String::new(),
            reasoning: HashMap::new(),
            terminal: false,
            blocked: false,
            artifact_turn_id: None,
            artifact_notifications: ArtifactNotificationQueue::default(),
        };
        let projection = LiveTurnProjection {
            session_id,
            turn_id: Uuid::now_v7(),
            assistant_text: "answer".to_owned(),
            reasoning: vec![LiveReasoningProjection {
                item_id: "host-private-item".to_owned(),
                status: None,
                parts: vec![ReasoningPart {
                    content_index: 0,
                    text: "reason".to_owned(),
                }],
            }],
            terminal: false,
            terminal_status: None,
        };
        let events = projection_events(subscription_id, &mut record, &projection).unwrap();
        assert_eq!(events.len(), 3);
        let encoded = serde_json::to_string(&events).unwrap();
        assert!(encoded.contains("assistant_append"));
        assert!(encoded.contains("reasoning_append"));
        assert!(encoded.contains("itemOrdinal"));
        assert!(!encoded.contains("host-private-item"));

        let duplicate = projection_events(subscription_id, &mut record, &projection).unwrap();
        assert!(duplicate.is_empty());

        let mut oversized = projection;
        oversized.assistant_text = format!("answer{}", "a".repeat(MAX_EVENT_BATCH_BYTES + 1));
        let candidates = projection_events(subscription_id, &mut record, &oversized).unwrap();
        let bytes = candidates
            .iter()
            .map(|event| serde_json::to_vec(event).unwrap().len())
            .sum::<usize>();
        assert!(bytes > MAX_EVENT_BATCH_BYTES);
    }

    #[test]
    fn request_and_plain_text_limits_fail_closed() {
        let request_id = Uuid::now_v7();
        assert!(validate_input("", request_id).is_err());
        assert!(validate_input(&"a".repeat(MAX_INPUT_BYTES + 1), request_id).is_err());
        assert!(split_plain_text("safe text", 4).is_ok());
        assert!(split_plain_text("unsafe\0text", 4).is_err());
    }

    #[test]
    fn attachment_import_event_is_aggregate_and_content_free() {
        assert!(valid_attachment_import_transition(
            None,
            AttachmentPreparationStage::Queued
        ));
        assert!(valid_attachment_import_transition(
            Some(AttachmentPreparationStage::Queued),
            AttachmentPreparationStage::Importing
        ));
        assert!(valid_attachment_import_transition(
            Some(AttachmentPreparationStage::Importing),
            AttachmentPreparationStage::Parsing
        ));
        assert!(valid_attachment_import_transition(
            Some(AttachmentPreparationStage::Parsing),
            AttachmentPreparationStage::Indexing
        ));
        assert!(valid_attachment_import_transition(
            Some(AttachmentPreparationStage::Indexing),
            AttachmentPreparationStage::Ready
        ));
        for previous in [
            AttachmentPreparationStage::Importing,
            AttachmentPreparationStage::Parsing,
            AttachmentPreparationStage::Indexing,
        ] {
            assert!(valid_attachment_import_transition(
                Some(previous),
                AttachmentPreparationStage::ErrorTerminal
            ));
        }
        assert!(!valid_attachment_import_transition(
            Some(AttachmentPreparationStage::Importing),
            AttachmentPreparationStage::Indexing
        ));
        assert!(!valid_attachment_import_transition(
            Some(AttachmentPreparationStage::Ready),
            AttachmentPreparationStage::ErrorTerminal
        ));

        let event = AttachmentImportEventDto {
            schema_version: CHAT_IPC_V2_SCHEMA_VERSION,
            context_id: "019c1a00-0000-7000-8000-000000000003".to_owned(),
            operation_id: "019c1a00-0000-7000-8000-000000000004".to_owned(),
            sequence: "4".to_owned(),
            stage: AttachmentPreparationStage::Indexing.as_str(),
            item_count: 2,
            issue: None,
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            json!({
                "schemaVersion": 2,
                "contextId": "019c1a00-0000-7000-8000-000000000003",
                "operationId": "019c1a00-0000-7000-8000-000000000004",
                "sequence": "4",
                "stage": "indexing",
                "itemCount": 2,
                "issue": null,
            })
        );
        let encoded = serde_json::to_string(&event).unwrap();
        for forbidden in ["name", "path", "attachment", "digest", "dataUrl", "content"] {
            assert!(!encoded.contains(forbidden), "event leaked {forbidden}");
        }
    }

    #[test]
    fn attachment_v2_payloads_freeze_capacity_and_remove_contracts() {
        let request_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f10").unwrap();
        let context_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f11").unwrap();
        let operation_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f12").unwrap();
        let attachment_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f13").unwrap();
        let request = |payload: Value| {
            json!({
                "schemaVersion": 2,
                "requestId": request_id,
                "contextId": context_id,
                "payload": payload,
            })
        };

        let shared_fixture: Value = serde_json::from_str(include_str!(
            "../../fixtures/chat-ipc-v2/create-session-attachment-only-request.json"
        ))
        .unwrap();
        let shared_request: CommandRequest<CreateSessionV2Payload> =
            decode_request_v2(shared_fixture).expect("shared TypeScript/Rust request fixture");
        assert_eq!(
            shared_request.payload.project_id.to_string(),
            "019c1a00-0000-7000-8000-000000000013"
        );
        assert_eq!(shared_request.payload.content_blocks.len(), 1);
        assert!(matches!(
            &shared_request.payload.content_blocks[0],
            TurnContentBlockPayload::File { attachment_id }
                if attachment_id.to_string() == "019c1a00-0000-7000-8000-000000000010"
        ));

        let pick: CommandRequest<PickAttachmentsPayload> = decode_request_v2(request(json!({
            "draftTarget": { "type": "new" },
            "operationId": operation_id,
            "remainingCapacity": 3,
        })))
        .expect("valid picker request");
        assert_eq!(pick.payload.remaining_capacity, 3);
        assert!(matches!(
            pick.payload.draft_target,
            DraftTargetPayload::New {}
        ));
        assert!(decode_request_v2::<PickAttachmentsPayload>(request(json!({
            "operationId": operation_id,
            "remainingCapacity": 3,
        })))
        .is_err());
        assert!(decode_request_v2::<PickAttachmentsPayload>(request(json!({
            "draftTarget": { "type": "new" },
            "operationId": operation_id,
            "remainingCapacity": 3,
            "unexpected": true,
        })))
        .is_err());

        for invalid in [0, attachment::MAX_ATTACHMENTS_PER_MESSAGE + 1] {
            let error = validate_remaining_capacity(invalid, request_id).unwrap_err();
            assert_eq!(error.schema_version, CHAT_IPC_V2_SCHEMA_VERSION);
            assert_eq!(error.code, "chat_request_invalid");
        }
        let error = validate_attachment_batch_size(4, 3, request_id).unwrap_err();
        assert_eq!(error.schema_version, CHAT_IPC_V2_SCHEMA_VERSION);
        assert_eq!(error.code, "chat_limit_exceeded");
        assert_eq!(error.attachment_issue, Some("too_many"));
        assert_eq!(error.attachment_item_count, Some(4));

        let too_large = map_attachment_import_error(AttachmentImportError::TooLarge, request_id, 2);
        assert_eq!(too_large.code, "chat_limit_exceeded");
        assert_eq!(too_large.attachment_issue, Some("too_large"));
        assert_eq!(too_large.attachment_item_count, Some(2));
        let archive =
            map_attachment_import_error(AttachmentImportError::ArchiveUnsupported, request_id, 2);
        assert_eq!(archive.code, "chat_request_invalid");
        assert_eq!(archive.attachment_issue, Some("archive_unsupported"));
        assert_eq!(
            serde_json::to_value(&archive).unwrap()["attachmentIssue"],
            "archive_unsupported"
        );
        assert_eq!(
            serde_json::to_value(&archive).unwrap()["attachmentItemCount"],
            2
        );

        let imported: CommandRequest<ImportAttachmentsPayload> =
            decode_request_v2(request(json!({
                "paths": ["/tmp/a.txt", "/tmp/b.txt"],
                "draftTarget": { "type": "session", "sessionId": operation_id },
                "operationId": operation_id,
                "remainingCapacity": 2,
            })))
            .expect("valid import request");
        assert_eq!(imported.payload.paths.len(), 2);
        assert_eq!(imported.payload.remaining_capacity, 2);
        assert!(matches!(
            imported.payload.draft_target,
            DraftTargetPayload::Session { session_id } if session_id == operation_id
        ));
        assert_eq!(
            validate_attachment_paths(&imported.payload.paths, request_id).unwrap(),
            vec![PathBuf::from("/tmp/a.txt"), PathBuf::from("/tmp/b.txt")]
        );
        for invalid in [
            vec!["relative.txt".to_owned()],
            vec!["/tmp/a.txt".to_owned(), "/tmp/a.txt".to_owned()],
            vec!["/tmp/unsafe\0name.txt".to_owned()],
        ] {
            let error = validate_attachment_paths(&invalid, request_id).unwrap_err();
            assert_eq!(error.schema_version, CHAT_IPC_V2_SCHEMA_VERSION);
            assert_eq!(error.code, "chat_request_invalid");
        }

        let removed: CommandRequest<RemoveAttachmentPayload> = decode_request_v2(request(json!({
            "attachmentId": attachment_id,
            "draftTarget": { "type": "new" },
            "operationId": operation_id,
        })))
        .expect("valid remove request");
        assert_eq!(removed.payload.attachment_id, attachment_id);
        assert_eq!(removed.payload.operation_id, operation_id);

        let listed: CommandRequest<ListDraftAttachmentsPayload> =
            decode_request_v2(request(json!({
                "draftTarget": { "type": "session", "sessionId": operation_id },
            })))
            .expect("valid draft-list request");
        assert!(matches!(
            listed.payload.draft_target,
            DraftTargetPayload::Session { session_id } if session_id == operation_id
        ));
        for invalid_target in [
            json!({ "type": "new", "sessionId": operation_id }),
            json!({ "type": "session" }),
            json!({ "type": "unknown" }),
        ] {
            assert!(
                decode_request_v2::<ListDraftAttachmentsPayload>(request(json!({
                    "draftTarget": invalid_target,
                })))
                .is_err()
            );
        }
        let nil_target: CommandRequest<ListDraftAttachmentsPayload> =
            decode_request_v2(request(json!({
                "draftTarget": {
                    "type": "session",
                    "sessionId": Uuid::nil(),
                },
            })))
            .expect("serde accepts UUID shape before semantic validation");
        assert!(draft_target(nil_target.payload.draft_target, request_id).is_err());
        assert_eq!(
            draft_target_action(&DraftTarget::New),
            ChatAction::CreateSession
        );
        assert_eq!(
            draft_target_action(&DraftTarget::Session(operation_id)),
            ChatAction::SubmitTurn
        );

        let created: CommandRequest<CreateSessionV2Payload> = decode_request_v2(request(json!({
            "projectId": operation_id,
            "contentBlocks": [
                { "type": "text", "text": "inspect attachments" },
                { "type": "file", "attachmentId": attachment_id },
                { "type": "image", "attachmentId": attachment_id },
            ],
            "operationId": operation_id,
        })))
        .expect("valid multimodal create request");
        assert_eq!(created.payload.content_blocks.len(), 3);
        assert!(matches!(
            created.payload.content_blocks[1],
            TurnContentBlockPayload::File { attachment_id: value } if value == attachment_id
        ));
        assert!(matches!(
            created.payload.content_blocks[2],
            TurnContentBlockPayload::Image { attachment_id: value } if value == attachment_id
        ));
        assert!(decode_request_v2::<CreateSessionV2Payload>(request(json!({
            "projectId": operation_id,
            "contentBlocks": [
                { "type": "file", "attachment_id": attachment_id },
            ],
            "operationId": operation_id,
        })))
        .is_err());

        assert_eq!(
            serde_json::to_value(CommandResponse::new_v2(
                request_id,
                OperationDto {
                    operation_id: operation_id.to_string(),
                },
            ))
            .unwrap(),
            json!({
                "schemaVersion": 2,
                "requestId": request_id,
                "data": { "operationId": operation_id },
            })
        );
    }

    #[test]
    fn feat134_v4_request_and_response_negotiation_is_exact() {
        let request_id = Uuid::now_v7();
        let context_id = Uuid::now_v7();
        let session_id = Uuid::now_v7();
        let request = json!({
            "schemaVersion": 4,
            "requestId": request_id,
            "contextId": context_id,
            "payload": { "sessionId": session_id },
        });
        let decoded: CommandRequest<SubscribePayload> =
            decode_request_v4(request.clone()).expect("v4 request");
        assert_eq!(decoded.schema_version, CHAT_IPC_V4_SCHEMA_VERSION);
        assert!(decode_request_v3::<SubscribePayload>(request).is_err());

        let response = serde_json::to_value(CommandResponse::new_v4(
            request_id,
            SubscriptionDto {
                subscription_id: Uuid::now_v7().to_string(),
            },
        ))
        .unwrap();
        assert_eq!(response["schemaVersion"], CHAT_IPC_V4_SCHEMA_VERSION);
        assert_eq!(response["requestId"], request_id.to_string());
    }

    #[test]
    fn feat136_v5_subscription_receives_marked_inherited_v4_items_without_execution() {
        let session_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        let runtime_turn_id = Uuid::now_v7();
        let source_event_id = Uuid::now_v7();
        let item = TimelineItem {
            item_id: "assistant-v4".to_owned(),
            item_ordinal: 1,
            item_type: "agentMessage".to_owned(),
            phase: Some(crate::chat::TimelinePhase::FinalAnswer),
            status: crate::chat::TimelineItemStatus::InProgress,
            text: String::new(),
            reasoning_status: None,
            reasoning_reason_code: None,
            reasoning_parts: Vec::new(),
            reasoning_finalized_at_ms: None,
            execution: None,
            started_at_ms: 1,
            completed_at_ms: None,
            source_event_id,
            source_sequence: 1,
            source_occurred_at: "2026-08-30T00:00:00Z".to_owned(),
        };
        let projection = Feat134Projection {
            durable_sequence: Some(1),
            session_id,
            turn_id,
            cursor: crate::chat::StoredEventCursor {
                stream_id: Uuid::now_v7(),
                sequence: 1,
                event_id: source_event_id,
            },
            source_event_type: "item.started".to_owned(),
            source_turn_id: Some(runtime_turn_id),
            source_occurred_at: item.source_occurred_at.clone(),
            source_event_bytes: 1,
            observed_at_ms: 1,
            assistant_text: String::new(),
            items: vec![item.clone()],
            plan: None,
            turn_notices: Vec::new(),
            session_notice: None,
            terminal: None,
            delta: TimelineDelta::ItemStarted(item),
        };
        let mut record = SubscriptionRecord {
            schema_version: CHAT_IPC_V5_SCHEMA_VERSION,
            context_id: Uuid::now_v7(),
            session_id,
            projection_sequence: 1,
            assistant_text: String::new(),
            reasoning: HashMap::new(),
            terminal: false,
            blocked: false,
            artifact_turn_id: None,
            artifact_notifications: ArtifactNotificationQueue::default(),
        };
        assert!(feat134_subscription_matches(&record, session_id));
        assert!(!feat134_subscription_matches(&record, Uuid::now_v7()));

        let (event_turn_id, kind, payload, event_id) =
            feat134_event_payload(&projection).unwrap().unwrap();
        assert_eq!(kind, "item_started");
        assert!(payload.get("execution").is_none());
        let encoded = serde_json::to_value(feat134_source_event_envelope(
            Uuid::now_v7(),
            &record,
            event_turn_id,
            event_id,
            1,
            kind,
            payload,
        ))
        .unwrap();
        assert_eq!(encoded["schemaVersion"], CHAT_IPC_V5_SCHEMA_VERSION);
        assert_eq!(encoded["sourceSchemaVersion"], CHAT_IPC_V4_SCHEMA_VERSION);
        assert_eq!(encoded["kind"], "item_started");
        assert_eq!(encoded["turnId"], turn_id.to_string());
        assert_eq!(encoded["eventId"], source_event_id.to_string());
        assert_eq!(encoded["durableSequence"], "1");
        assert!(encoded["payload"].get("execution").is_none());

        let generic_event_id = Uuid::now_v7();
        let mut generic_item = projection.items[0].clone();
        generic_item.item_id = "command-v4".to_owned();
        generic_item.item_type = "commandExecution".to_owned();
        generic_item.phase = None;
        generic_item.source_event_id = generic_event_id;
        generic_item.source_sequence = 2;
        let mut generic_projection = projection.clone();
        generic_projection.cursor.sequence = 2;
        generic_projection.cursor.event_id = generic_event_id;
        generic_projection.items = vec![generic_item.clone()];
        generic_projection.delta = TimelineDelta::ItemStarted(generic_item);
        generic_projection.durable_sequence = Some(2);
        let (generic_turn_id, generic_kind, generic_payload, generic_id) =
            feat134_event_payload(&generic_projection).unwrap().unwrap();
        let generic = serde_json::to_value(feat134_source_event_envelope(
            Uuid::now_v7(),
            &record,
            generic_turn_id,
            generic_id,
            2,
            generic_kind,
            generic_payload,
        ))
        .unwrap();
        assert_eq!(generic["schemaVersion"], CHAT_IPC_V5_SCHEMA_VERSION);
        assert_eq!(generic["sourceSchemaVersion"], CHAT_IPC_V4_SCHEMA_VERSION);
        assert_eq!(generic["payload"]["itemType"], "commandExecution");
        assert!(generic["payload"].get("execution").is_none());

        let native_v5 = serde_json::to_value(source_event_envelope(
            Uuid::now_v7(),
            &record,
            generic_turn_id,
            generic_id,
            2,
            generic_kind,
            generic["payload"].clone(),
        ))
        .unwrap();
        assert!(native_v5.get("sourceSchemaVersion").is_none());

        record.schema_version = CHAT_IPC_V6_SCHEMA_VERSION;
        assert!(feat134_subscription_matches(&record, session_id));
        let sticky_v5_in_v6 = serde_json::to_value(feat136_source_event_envelope(
            Uuid::now_v7(),
            &record,
            generic_turn_id,
            generic_id,
            2,
            generic_kind,
            generic["payload"].clone(),
        ))
        .unwrap();
        assert_eq!(sticky_v5_in_v6["schemaVersion"], CHAT_IPC_V6_SCHEMA_VERSION);
        assert_eq!(
            sticky_v5_in_v6["sourceSchemaVersion"],
            CHAT_IPC_V5_SCHEMA_VERSION
        );
        let sticky_v4_in_v6 = serde_json::to_value(feat134_source_event_envelope(
            Uuid::now_v7(),
            &record,
            event_turn_id,
            event_id,
            1,
            kind,
            encoded["payload"].clone(),
        ))
        .unwrap();
        assert_eq!(
            sticky_v4_in_v6["sourceSchemaVersion"],
            CHAT_IPC_V4_SCHEMA_VERSION
        );
        let native_v6 = serde_json::to_value(source_event_envelope(
            Uuid::now_v7(),
            &record,
            generic_turn_id,
            generic_id,
            2,
            generic_kind,
            generic["payload"].clone(),
        ))
        .unwrap();
        assert!(native_v6.get("sourceSchemaVersion").is_none());

        record.schema_version = CHAT_IPC_V4_SCHEMA_VERSION;
        assert!(feat134_subscription_matches(&record, session_id));
        let inherited_v4 = serde_json::to_value(feat134_source_event_envelope(
            Uuid::now_v7(),
            &record,
            event_turn_id,
            event_id,
            1,
            kind,
            encoded["payload"].clone(),
        ))
        .unwrap();
        assert_eq!(inherited_v4["schemaVersion"], CHAT_IPC_V4_SCHEMA_VERSION);
        assert!(inherited_v4.get("sourceSchemaVersion").is_none());
    }

    #[test]
    fn feat136_failed_nonzero_command_ipc_payload_keeps_authoritative_terminal_fields() {
        let session_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        let started_source = SourceIdentity {
            event_id: Uuid::now_v7(),
            sequence: 1,
            occurred_at: "2026-08-30T00:00:00Z".to_owned(),
        };
        let completed_source = SourceIdentity {
            event_id: Uuid::now_v7(),
            sequence: 2,
            occurred_at: "2026-08-30T00:00:00.014Z".to_owned(),
        };
        let item = TimelineItem {
            item_id: "command-failed".to_owned(),
            item_ordinal: 1,
            item_type: "command".to_owned(),
            phase: None,
            status: TimelineItemStatus::Completed,
            text: String::new(),
            reasoning_status: None,
            reasoning_reason_code: None,
            reasoning_parts: Vec::new(),
            reasoning_finalized_at_ms: None,
            execution: Some(ExecutionProjection::Command(CommandProjection {
                status: CommandStatus::Failed,
                started_source,
                last_source: completed_source.clone(),
                command_summary: SafeTextProjection {
                    text: "Inspect a missing reference".to_owned(),
                    truncated: false,
                    truncation_reason: None,
                },
                cwd: CommandCwdProjection::WorkspaceRoot,
                live_output: None,
                output: Some(CommandOutputProjection::Complete {
                    text: "reference unavailable\n".to_owned(),
                }),
                duration_ms: Some(14),
                exit_code: Some(9),
                error: Some(ProjectionError {
                    code: ProjectionErrorCode::CommandFailed,
                    summary: "command exited with a non-zero status".to_owned(),
                }),
            })),
            started_at_ms: 1_000,
            completed_at_ms: Some(1_014),
            source_event_id: completed_source.event_id,
            source_sequence: completed_source.sequence,
            source_occurred_at: completed_source.occurred_at.clone(),
        };
        let projection = Feat134Projection {
            session_id,
            turn_id,
            cursor: crate::chat::StoredEventCursor {
                stream_id: Uuid::now_v7(),
                sequence: completed_source.sequence,
                event_id: completed_source.event_id,
            },
            source_event_type: "item.completed".to_owned(),
            source_turn_id: Some(Uuid::now_v7()),
            source_occurred_at: completed_source.occurred_at.clone(),
            source_event_bytes: 1,
            observed_at_ms: 1_014,
            durable_sequence: Some(2),
            assistant_text: String::new(),
            items: vec![item.clone()],
            plan: None,
            turn_notices: Vec::new(),
            session_notice: None,
            terminal: None,
            delta: TimelineDelta::CommandCompleted(item),
        };

        let (payload_turn_id, kind, payload, event_id) =
            feat136_event_payload(&projection).unwrap().unwrap();
        assert_eq!(payload_turn_id, Some(turn_id));
        assert_eq!(kind, "command_completed");
        assert_eq!(event_id, completed_source.event_id);
        assert_eq!(
            payload,
            json!({
                "sourceEventId": completed_source.event_id.to_string(),
                "sourceSequence": "2",
                "sourceOccurredAt": "2026-08-30T00:00:00.014Z",
                "itemId": "command-failed",
                "itemOrdinal": 1,
                "status": "failed",
                "commandSummary": {
                    "text": "Inspect a missing reference",
                    "truncated": false,
                    "truncationReason": null,
                },
                "cwd": { "kind": "workspace_root", "segments": [] },
                "durationMs": 14,
                "exitCode": 9,
                "output": {
                    "retention": "complete",
                    "text": "reference unavailable\n",
                    "head": null,
                    "tail": null,
                    "reason": null,
                    "truncated": false,
                    "truncationReason": null,
                },
                "error": {
                    "code": "command_failed",
                    "summary": "command exited with a non-zero status",
                },
            })
        );
    }

    #[test]
    fn feat137_pending_private_projection_keeps_host_stream_but_redacts_host_identity() {
        let host_stream_id = Uuid::now_v7();
        let desktop_turn_id = Uuid::now_v7();
        let snapshot = PendingApprovalSnapshot {
            stream_id: host_stream_id,
            snapshot_at: "2026-08-30T12:00:30Z".to_owned(),
            pending: vec![crate::chat::PendingApproval {
                approval_request_id: Uuid::now_v7(),
                turn_id: desktop_turn_id,
                item_id: "command-1".to_owned(),
                requested_at: "2026-08-30T12:00:00Z".to_owned(),
                expires_at: "2026-08-30T12:02:00Z".to_owned(),
            }],
        };
        let encoded = pending_approval_snapshot_dto(&snapshot);
        assert_eq!(encoded["streamId"], host_stream_id.to_string());
        assert_eq!(encoded["pending"][0]["turnId"], desktop_turn_id.to_string());
        for forbidden in [
            "taskId",
            "agentSessionId",
            "codexThreadId",
            "runtimeTurnId",
            "actionable",
            "command",
            "cwd",
            "runtimeWire",
        ] {
            assert!(encoded["pending"][0].get(forbidden).is_none());
        }
    }

    #[test]
    fn feat134_live_warning_is_thread_scoped_and_provider_message_cannot_cross_ipc() {
        let source_event_id = Uuid::now_v7();
        let stream_id = Uuid::now_v7();
        let session_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        let notice = TimelineNotice {
            source_event_id,
            source_sequence: 3,
            source_occurred_at: "2026-08-28T06:00:00Z".to_owned(),
            scope: TimelineNoticeScope::Session,
            severity: crate::chat::TimelineNoticeSeverity::Warning,
            code: Some("provider_warning".to_owned()),
            will_retry: false,
            observed_at_ms: 100,
        };
        let projection = Feat134Projection {
            durable_sequence: Some(7),
            session_id,
            turn_id,
            cursor: crate::chat::StoredEventCursor {
                stream_id,
                sequence: 3,
                event_id: source_event_id,
            },
            source_event_type: "warning".to_owned(),
            source_turn_id: None,
            source_occurred_at: notice.source_occurred_at.clone(),
            source_event_bytes: 1,
            observed_at_ms: notice.observed_at_ms,
            assistant_text: String::new(),
            items: Vec::new(),
            plan: None,
            turn_notices: Vec::new(),
            session_notice: Some(notice.clone()),
            terminal: None,
            delta: TimelineDelta::Notice(notice),
        };
        let (event_turn_id, kind, payload, event_id) =
            feat134_event_payload(&projection).unwrap().unwrap();
        assert_eq!(event_turn_id, None);
        assert_eq!(kind, "notice");
        assert_eq!(event_id, source_event_id);
        assert_eq!(
            payload,
            json!({
                "sourceEventId": source_event_id.to_string(),
                "sourceSequence": "3",
                "sourceOccurredAt": "2026-08-28T06:00:00Z",
                "scope": "session",
                "severity": "warning",
                "code": "provider_warning",
                "willRetry": false,
            })
        );
        assert!(payload.get("message").is_none());

        let record = SubscriptionRecord {
            schema_version: CHAT_IPC_V4_SCHEMA_VERSION,
            context_id: Uuid::now_v7(),
            session_id,
            projection_sequence: 1,
            assistant_text: String::new(),
            reasoning: HashMap::new(),
            terminal: false,
            blocked: false,
            artifact_turn_id: None,
            artifact_notifications: ArtifactNotificationQueue::default(),
        };
        let envelope = source_event_envelope(
            Uuid::now_v7(),
            &record,
            event_turn_id,
            event_id,
            7,
            kind,
            payload,
        );
        let encoded = serde_json::to_value(envelope).unwrap();
        assert_eq!(encoded["schemaVersion"], CHAT_IPC_V4_SCHEMA_VERSION);
        assert!(encoded.get("turnId").is_none());
        assert_eq!(encoded["eventId"], source_event_id.to_string());
        assert_eq!(encoded["durableSequence"], "7");
        let mut empty_delta_projection = projection;
        empty_delta_projection.source_turn_id = Some(Uuid::now_v7());
        empty_delta_projection.session_notice = None;
        empty_delta_projection.delta = TimelineDelta::Ignored;
        empty_delta_projection.durable_sequence = Some(8);
        assert_eq!(
            feat134_event_payload(&empty_delta_projection).unwrap(),
            None,
            "a durably consumed empty Host delta must not create a private WebView event"
        );
        let control = serde_json::to_value(event_envelope(
            Uuid::now_v7(),
            &record,
            Some(turn_id),
            "resync_required",
            json!({"reason":"sequence_gap"}),
        ))
        .unwrap();
        assert!(control.get("durableSequence").is_none());
    }

    #[test]
    fn feat134_history_keeps_terminal_and_session_notice_codes_content_free() {
        let turn_id = Uuid::now_v7();
        let source_event_id = Uuid::now_v7();
        let notice = TimelineNotice {
            source_event_id,
            source_sequence: 1,
            source_occurred_at: "2026-08-28T06:00:00Z".to_owned(),
            scope: TimelineNoticeScope::Session,
            severity: crate::chat::TimelineNoticeSeverity::Warning,
            code: Some("bounded_warning".to_owned()),
            will_retry: false,
            observed_at_ms: 20,
        };
        let page = HistoryPage {
            turns: vec![crate::chat::HistoryTurn {
                turn_id,
                runtime_turn_id: Some(Uuid::now_v7()),
                status: "failed".to_owned(),
                terminal_at: Some(10),
                reasoning_status: "unavailable".to_owned(),
                reasoning_reason_code: Some("runtime_error".to_owned()),
                messages: Vec::new(),
                reasoning: Vec::new(),
            }],
            next_before_ordinal: None,
        };
        let feat134 = Feat134HistoryProjection {
            turns: vec![crate::chat::Feat134HistoryTurn {
                turn_id,
                v4_authority: true,
                source_schema_version: Some(4),
                terminal_code: Some("runtime_error".to_owned()),
                items: Vec::new(),
                plan: None,
                notices: Vec::new(),
            }],
            session_notices: vec![notice],
            durable_sequence_cut: 7,
        };
        let dto = history_dto_v4(page, None, Vec::new(), Vec::new(), feat134).unwrap();
        let encoded = serde_json::to_value(dto).unwrap();
        assert_eq!(encoded["turns"][0]["terminalCode"], "runtime_error");
        assert_eq!(encoded["turns"][0]["projectionAuthority"], "v4");
        assert!(encoded["turns"][0].get("terminalMessage").is_none());
        assert_eq!(encoded["sessionNotices"][0]["scope"], "session");
        assert!(encoded["sessionNotices"][0].get("message").is_none());
    }

    #[test]
    fn feat134_failed_turn_control_is_content_free_and_requires_authoritative_resync() {
        let subscription_id = Uuid::now_v7();
        let context_id = Uuid::now_v7();
        let session_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        let mut record = SubscriptionRecord {
            schema_version: CHAT_IPC_V4_SCHEMA_VERSION,
            context_id,
            session_id,
            projection_sequence: 0,
            assistant_text: String::new(),
            reasoning: HashMap::new(),
            terminal: false,
            blocked: false,
            artifact_turn_id: None,
            artifact_notifications: ArtifactNotificationQueue::default(),
        };

        let event = turn_resync_control_event(
            subscription_id,
            &mut record,
            turn_id,
            TurnResyncSubscriptionAction::ResyncRequired,
        )
        .unwrap();
        let encoded = serde_json::to_value(event).unwrap();
        assert_eq!(record.projection_sequence, 1);
        assert!(record.blocked);
        assert_eq!(encoded["schemaVersion"], CHAT_IPC_V4_SCHEMA_VERSION);
        assert_eq!(encoded["subscriptionId"], subscription_id.to_string());
        assert_eq!(encoded["contextId"], context_id.to_string());
        assert_eq!(encoded["sessionId"], session_id.to_string());
        assert_eq!(encoded["turnId"], turn_id.to_string());
        assert_eq!(encoded["projectionSequence"], "1");
        assert_eq!(encoded["kind"], "resync_required");
        assert_eq!(encoded["payload"], json!({"reason":"protocol_error"}));
        assert!(encoded.get("durableSequence").is_none());
        let serialized = encoded.to_string().to_ascii_lowercase();
        for forbidden in ["prompt", "reasoning", "plan", "final", "message"] {
            assert!(!serialized.contains(forbidden), "leaked {forbidden}");
        }
    }

    #[test]
    fn feat134_reconciliation_outcome_requests_resync_without_projecting_failed_status() {
        let operation_id = Uuid::from_u128(0x400);
        let session_id = Uuid::from_u128(0x401);
        let turn_id = Uuid::from_u128(0x402);
        let subscription_id = Uuid::from_u128(0x403);
        let context_id = Uuid::from_u128(0x404);
        let outcome = CoordinatorOutcome::Dispatched(DispatchOutcome::TurnReconciliationRequired {
            operation_id,
            session_id,
            turn_id,
        });
        assert_eq!(turn_resync_target(&outcome), Some((session_id, turn_id)));
        let mut subscriptions = HashMap::from([(
            subscription_id,
            SubscriptionRecord {
                schema_version: CHAT_IPC_V4_SCHEMA_VERSION,
                context_id,
                session_id,
                projection_sequence: 0,
                assistant_text: String::new(),
                reasoning: HashMap::new(),
                terminal: false,
                blocked: false,
                artifact_turn_id: None,
                artifact_notifications: ArtifactNotificationQueue::default(),
            },
        )]);
        let plan = turn_resync_subscription_plan(&subscriptions, session_id, |_| true);
        assert_eq!(
            plan,
            vec![(
                subscription_id,
                TurnResyncSubscriptionAction::ResyncRequired,
            )]
        );
        let event = turn_resync_control_event(
            subscription_id,
            subscriptions.get_mut(&subscription_id).unwrap(),
            turn_id,
            plan[0].1,
        )
        .unwrap();
        let encoded = serde_json::to_value(event).unwrap();
        assert_eq!(encoded["kind"], "resync_required");
        assert_eq!(encoded["payload"], json!({"reason":"protocol_error"}));
        assert!(encoded.get("status").is_none());
        assert!(!encoded.to_string().contains("failed"));
        assert!(!encoded.to_string().contains(&operation_id.to_string()));
    }

    #[test]
    fn feat137_failed_turn_subscription_plan_blocks_v6_until_authoritative_resync() {
        let session_id = Uuid::from_u128(0x600);
        let authorized_context_id = Uuid::from_u128(0x601);
        let denied_context_id = Uuid::from_u128(0x602);
        let authorized_subscription_id = Uuid::from_u128(0x603);
        let denied_subscription_id = Uuid::from_u128(0x604);
        let record = |context_id| SubscriptionRecord {
            schema_version: CHAT_IPC_V6_SCHEMA_VERSION,
            context_id,
            session_id,
            projection_sequence: 0,
            assistant_text: String::new(),
            reasoning: HashMap::new(),
            terminal: false,
            blocked: false,
            artifact_turn_id: None,
            artifact_notifications: ArtifactNotificationQueue::default(),
        };
        let subscriptions = HashMap::from([
            (authorized_subscription_id, record(authorized_context_id)),
            (denied_subscription_id, record(denied_context_id)),
        ]);

        let plan = turn_resync_subscription_plan(&subscriptions, session_id, |context_id| {
            context_id == authorized_context_id
        });

        assert_eq!(
            plan,
            vec![
                (
                    authorized_subscription_id,
                    TurnResyncSubscriptionAction::ResyncRequired,
                ),
                (
                    denied_subscription_id,
                    TurnResyncSubscriptionAction::ContextInvalidated,
                ),
            ]
        );
    }

    #[test]
    fn feat134_failed_turn_subscription_plan_filters_exact_v4_authority_and_invalidates_denied() {
        let target_session_id = Uuid::from_u128(0x100);
        let other_session_id = Uuid::from_u128(0x101);
        let authorized_context_id = Uuid::from_u128(0x200);
        let denied_context_id = Uuid::from_u128(0x201);
        let matching_v4_id = Uuid::from_u128(1);
        let denied_v4_id = Uuid::from_u128(2);
        let same_session_v1_id = Uuid::from_u128(3);
        let other_session_v4_id = Uuid::from_u128(4);
        let blocked_v4_id = Uuid::from_u128(5);
        let terminal_v4_id = Uuid::from_u128(6);
        let record =
            |schema_version, context_id, session_id, blocked, terminal| SubscriptionRecord {
                schema_version,
                context_id,
                session_id,
                projection_sequence: 0,
                assistant_text: String::new(),
                reasoning: HashMap::new(),
                terminal,
                blocked,
                artifact_turn_id: None,
                artifact_notifications: ArtifactNotificationQueue::default(),
            };
        let mut subscriptions = HashMap::from([
            (
                matching_v4_id,
                record(
                    CHAT_IPC_V4_SCHEMA_VERSION,
                    authorized_context_id,
                    target_session_id,
                    false,
                    false,
                ),
            ),
            (
                denied_v4_id,
                record(
                    CHAT_IPC_V4_SCHEMA_VERSION,
                    denied_context_id,
                    target_session_id,
                    false,
                    false,
                ),
            ),
            (
                same_session_v1_id,
                record(
                    CHAT_IPC_SCHEMA_VERSION,
                    authorized_context_id,
                    target_session_id,
                    false,
                    false,
                ),
            ),
            (
                other_session_v4_id,
                record(
                    CHAT_IPC_V4_SCHEMA_VERSION,
                    authorized_context_id,
                    other_session_id,
                    false,
                    false,
                ),
            ),
            (
                blocked_v4_id,
                record(
                    CHAT_IPC_V4_SCHEMA_VERSION,
                    authorized_context_id,
                    target_session_id,
                    true,
                    false,
                ),
            ),
            (
                terminal_v4_id,
                record(
                    CHAT_IPC_V4_SCHEMA_VERSION,
                    authorized_context_id,
                    target_session_id,
                    false,
                    true,
                ),
            ),
        ]);
        let mut authorization_checks = Vec::new();

        let plan = turn_resync_subscription_plan(&subscriptions, target_session_id, |context_id| {
            authorization_checks.push(context_id);
            context_id != denied_context_id
        });

        assert_eq!(
            plan,
            vec![
                (matching_v4_id, TurnResyncSubscriptionAction::ResyncRequired,),
                (
                    denied_v4_id,
                    TurnResyncSubscriptionAction::ContextInvalidated,
                ),
            ]
        );
        authorization_checks.sort_unstable();
        assert_eq!(
            authorization_checks,
            vec![authorized_context_id, denied_context_id]
        );

        let turn_id = Uuid::from_u128(0x300);
        let events = plan
            .into_iter()
            .map(|(subscription_id, action)| {
                let record = subscriptions.get_mut(&subscription_id).unwrap();
                serde_json::to_value(
                    turn_resync_control_event(subscription_id, record, turn_id, action).unwrap(),
                )
                .unwrap()
            })
            .collect::<Vec<_>>();
        assert_eq!(events[0]["kind"], "resync_required");
        assert_eq!(events[0]["payload"], json!({"reason":"protocol_error"}));
        assert_eq!(events[1]["kind"], "context_invalidated");
        assert_eq!(events[1]["payload"], json!({"reason":"authority_changed"}));
        for subscription_id in [matching_v4_id, denied_v4_id] {
            let record = subscriptions.get(&subscription_id).unwrap();
            assert_eq!(record.projection_sequence, 1);
            assert!(record.blocked);
        }
        assert_eq!(
            subscriptions
                .get(&same_session_v1_id)
                .unwrap()
                .projection_sequence,
            0
        );
        assert_eq!(
            subscriptions
                .get(&other_session_v4_id)
                .unwrap()
                .projection_sequence,
            0
        );
        assert_eq!(
            subscriptions
                .get(&blocked_v4_id)
                .unwrap()
                .projection_sequence,
            0
        );
        assert_eq!(
            subscriptions
                .get(&terminal_v4_id)
                .unwrap()
                .projection_sequence,
            0
        );
    }

    #[test]
    fn feat134_history_projection_authority_preserves_legacy_and_deduplicates_v4() {
        let legacy_turn_id = Uuid::now_v7();
        let v4_turn_id = Uuid::now_v7();
        let history_turn = |turn_id| crate::chat::HistoryTurn {
            turn_id,
            runtime_turn_id: Some(Uuid::now_v7()),
            status: "completed".to_owned(),
            terminal_at: Some(10),
            reasoning_status: "unavailable".to_owned(),
            reasoning_reason_code: Some("reasoning_not_emitted".to_owned()),
            messages: vec![
                crate::chat::HistoryMessage {
                    message_id: Uuid::now_v7(),
                    role: "user".to_owned(),
                    content: "question".to_owned(),
                    status: "committed".to_owned(),
                    ordinal: 1,
                    created_at: 1,
                },
                crate::chat::HistoryMessage {
                    message_id: Uuid::now_v7(),
                    role: "assistant".to_owned(),
                    content: "answer".to_owned(),
                    status: "committed".to_owned(),
                    ordinal: 2,
                    created_at: 2,
                },
            ],
            reasoning: vec![crate::chat::HistoryReasoningMetadata {
                item_id: "legacy-reasoning".to_owned(),
                item_ordinal: 0,
                status: crate::chat::ReasoningStatus::Unavailable,
                reason_code: Some("reasoning_not_emitted".to_owned()),
                total_bytes: 0,
                part_count: 0,
                finalized_at_ms: 10,
            }],
        };
        let page = HistoryPage {
            turns: vec![history_turn(legacy_turn_id), history_turn(v4_turn_id)],
            next_before_ordinal: None,
        };
        let projections = history_message_ids(&page)
            .into_iter()
            .map(|message_id| (message_id, Vec::new()))
            .collect();
        let feat134 = Feat134HistoryProjection {
            turns: vec![
                crate::chat::Feat134HistoryTurn {
                    turn_id: legacy_turn_id,
                    v4_authority: false,
                    source_schema_version: None,
                    terminal_code: None,
                    items: Vec::new(),
                    plan: None,
                    notices: Vec::new(),
                },
                crate::chat::Feat134HistoryTurn {
                    turn_id: v4_turn_id,
                    v4_authority: true,
                    source_schema_version: Some(4),
                    terminal_code: None,
                    items: Vec::new(),
                    plan: None,
                    notices: Vec::new(),
                },
            ],
            session_notices: Vec::new(),
            durable_sequence_cut: 1,
        };
        let encoded = serde_json::to_value(
            history_dto_v4(page, None, projections, Vec::new(), feat134).unwrap(),
        )
        .unwrap();
        assert_eq!(encoded["turns"][0]["projectionAuthority"], "legacy");
        assert_eq!(encoded["turns"][0]["messages"].as_array().unwrap().len(), 2);
        assert_eq!(
            encoded["turns"][0]["reasoning"].as_array().unwrap().len(),
            1
        );
        assert_eq!(encoded["turns"][1]["projectionAuthority"], "v4");
        assert_eq!(encoded["turns"][1]["messages"].as_array().unwrap().len(), 1);
        assert_eq!(encoded["turns"][1]["messages"][0]["role"], "user");
        assert!(encoded["turns"][1]["reasoning"]
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn feat136_v5_history_and_resync_preserve_mixed_projection_authority() {
        let legacy_turn_id = Uuid::now_v7();
        let v4_turn_id = Uuid::now_v7();
        let v5_turn_id = Uuid::now_v7();
        let history_turn = |turn_id| crate::chat::HistoryTurn {
            turn_id,
            runtime_turn_id: Some(Uuid::now_v7()),
            status: "completed".to_owned(),
            terminal_at: Some(10),
            reasoning_status: "unavailable".to_owned(),
            reasoning_reason_code: Some("reasoning_not_emitted".to_owned()),
            messages: Vec::new(),
            reasoning: Vec::new(),
        };
        let timeline_item = |item_id: &str, sequence: u64| crate::chat::TimelineItem {
            item_id: item_id.to_owned(),
            item_ordinal: 1,
            item_type: "agent_message".to_owned(),
            phase: None,
            status: crate::chat::TimelineItemStatus::Completed,
            text: "safe projection".to_owned(),
            reasoning_status: None,
            reasoning_reason_code: None,
            reasoning_parts: Vec::new(),
            reasoning_finalized_at_ms: None,
            execution: None,
            started_at_ms: 1,
            completed_at_ms: Some(2),
            source_event_id: Uuid::now_v7(),
            source_sequence: sequence,
            source_occurred_at: "2026-08-29T00:00:00Z".to_owned(),
        };
        let page = HistoryPage {
            turns: vec![
                history_turn(legacy_turn_id),
                history_turn(v4_turn_id),
                history_turn(v5_turn_id),
            ],
            next_before_ordinal: None,
        };
        let projection = Feat134HistoryProjection {
            turns: vec![
                crate::chat::Feat134HistoryTurn {
                    turn_id: legacy_turn_id,
                    v4_authority: false,
                    source_schema_version: None,
                    terminal_code: None,
                    items: Vec::new(),
                    plan: None,
                    notices: Vec::new(),
                },
                crate::chat::Feat134HistoryTurn {
                    turn_id: v4_turn_id,
                    v4_authority: true,
                    source_schema_version: Some(4),
                    terminal_code: None,
                    items: vec![timeline_item("v4-item", 1)],
                    plan: None,
                    notices: Vec::new(),
                },
                crate::chat::Feat134HistoryTurn {
                    turn_id: v5_turn_id,
                    v4_authority: true,
                    source_schema_version: Some(5),
                    terminal_code: None,
                    items: vec![timeline_item("v5-item", 2)],
                    plan: None,
                    notices: Vec::new(),
                },
            ],
            session_notices: Vec::new(),
            durable_sequence_cut: 2,
        };
        let history = history_dto_v5(page, None, Vec::new(), Vec::new(), projection).unwrap();
        assert_eq!(history["turns"][0]["projectionAuthority"], "legacy");
        assert_eq!(history["turns"][1]["projectionAuthority"], "v4");
        assert!(history["turns"][1]["timelineItems"][0]
            .get("execution")
            .is_none());
        assert_eq!(history["turns"][2]["projectionAuthority"], "v5");
        assert!(history["turns"][2]["timelineItems"][0]["execution"].is_null());

        let resync = serde_json::to_value(ResyncDtoV5 {
            session: SessionSummary {
                session_id: Uuid::now_v7(),
                project_id: Uuid::now_v7(),
                title: "mixed".to_owned(),
                title_source: SessionTitleSource::Fallback,
                pinned_at: None,
                last_activity_at: 10,
                latest_turn_status: Some("completed".to_owned()),
                project_available: true,
            }
            .into(),
            history: history.clone(),
            cleanup: None,
        })
        .unwrap();
        assert_eq!(resync["history"], history);
    }

    #[test]
    fn feat134_v4_resync_accepts_large_single_turn_final_and_reasoning_snapshot() {
        let session_id = Uuid::now_v7();
        let project_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        let user_message_id = Uuid::now_v7();
        let assistant_message_id = Uuid::now_v7();
        let page = HistoryPage {
            turns: vec![crate::chat::HistoryTurn {
                turn_id,
                runtime_turn_id: Some(Uuid::now_v7()),
                status: "completed".to_owned(),
                terminal_at: Some(2),
                reasoning_status: "complete".to_owned(),
                reasoning_reason_code: None,
                messages: vec![
                    crate::chat::HistoryMessage {
                        message_id: user_message_id,
                        role: "user".to_owned(),
                        content: "question".to_owned(),
                        status: "committed".to_owned(),
                        ordinal: 1,
                        created_at: 1,
                    },
                    crate::chat::HistoryMessage {
                        message_id: assistant_message_id,
                        role: "assistant".to_owned(),
                        content: "legacy duplicate".to_owned(),
                        status: "committed".to_owned(),
                        ordinal: 2,
                        created_at: 2,
                    },
                ],
                reasoning: Vec::new(),
            }],
            next_before_ordinal: None,
        };
        let source_event_id = Uuid::now_v7();
        let source_occurred_at = "2026-08-28T06:00:00Z".to_owned();
        let feat134 = Feat134HistoryProjection {
            turns: vec![crate::chat::Feat134HistoryTurn {
                turn_id,
                v4_authority: true,
                source_schema_version: Some(4),
                terminal_code: None,
                items: vec![
                    crate::chat::TimelineItem {
                        item_id: "commentary-1".to_owned(),
                        item_ordinal: 1,
                        item_type: "agentMessage".to_owned(),
                        phase: Some(crate::chat::TimelinePhase::Commentary),
                        status: crate::chat::TimelineItemStatus::Completed,
                        text: "c".repeat(1024 * 1024),
                        reasoning_status: None,
                        reasoning_reason_code: None,
                        reasoning_parts: Vec::new(),
                        reasoning_finalized_at_ms: None,
                        started_at_ms: 1,
                        completed_at_ms: Some(2),
                        source_event_id,
                        source_sequence: 1,
                        source_occurred_at: source_occurred_at.clone(),
                        execution: None,
                    },
                    crate::chat::TimelineItem {
                        item_id: "commentary-2".to_owned(),
                        item_ordinal: 2,
                        item_type: "agentMessage".to_owned(),
                        phase: Some(crate::chat::TimelinePhase::Commentary),
                        status: crate::chat::TimelineItemStatus::Completed,
                        text: "d".repeat(1024 * 1024),
                        reasoning_status: None,
                        reasoning_reason_code: None,
                        reasoning_parts: Vec::new(),
                        reasoning_finalized_at_ms: None,
                        started_at_ms: 1,
                        completed_at_ms: Some(2),
                        source_event_id,
                        source_sequence: 2,
                        source_occurred_at: source_occurred_at.clone(),
                        execution: None,
                    },
                    crate::chat::TimelineItem {
                        item_id: "final".to_owned(),
                        item_ordinal: 3,
                        item_type: "agentMessage".to_owned(),
                        phase: Some(crate::chat::TimelinePhase::FinalAnswer),
                        status: crate::chat::TimelineItemStatus::Completed,
                        text: "f".repeat(600 * 1024),
                        reasoning_status: None,
                        reasoning_reason_code: None,
                        reasoning_parts: Vec::new(),
                        reasoning_finalized_at_ms: None,
                        started_at_ms: 1,
                        completed_at_ms: Some(2),
                        source_event_id,
                        source_sequence: 3,
                        source_occurred_at: source_occurred_at.clone(),
                        execution: None,
                    },
                    crate::chat::TimelineItem {
                        item_id: "reasoning".to_owned(),
                        item_ordinal: 4,
                        item_type: "reasoning".to_owned(),
                        phase: None,
                        status: crate::chat::TimelineItemStatus::Completed,
                        text: String::new(),
                        reasoning_status: Some(crate::chat::TimelineReasoningStatus::Complete),
                        reasoning_reason_code: None,
                        reasoning_parts: (0..4)
                            .map(|content_index| crate::chat::TimelineReasoningPart {
                                content_index,
                                text: "r".repeat(64 * 1024),
                            })
                            .collect(),
                        reasoning_finalized_at_ms: Some(2),
                        started_at_ms: 1,
                        completed_at_ms: Some(2),
                        source_event_id,
                        source_sequence: 4,
                        source_occurred_at,
                        execution: None,
                    },
                ],
                plan: None,
                notices: Vec::new(),
            }],
            session_notices: Vec::new(),
            durable_sequence_cut: 4,
        };
        let history = history_dto_v4(
            page,
            None,
            vec![
                (user_message_id, Vec::new()),
                (assistant_message_id, Vec::new()),
            ],
            Vec::new(),
            feat134,
        )
        .unwrap();
        let data = ResyncDtoV4 {
            session: SessionDto {
                session_id: session_id.to_string(),
                project_id: project_id.to_string(),
                title: "snapshot".to_owned(),
                title_source: "fallback",
                pinned_at: None,
                last_activity_at: 2,
                latest_turn_status: Some("completed".to_owned()),
                project_available: true,
            },
            history,
            cleanup: None,
        };
        let encoded_size = serde_json::to_vec(&data).unwrap().len();
        assert!(encoded_size > 2800 * 1024);
        assert!(encoded_size < MAX_HISTORY_PAGE_BYTES);
        assert!(encoded_size < MAX_V4_RESYNC_BYTES);
        enforce_response_limit(&data, MAX_HISTORY_PAGE_BYTES, Uuid::now_v7()).unwrap();
        enforce_response_limit(&data, MAX_V4_RESYNC_BYTES, Uuid::now_v7()).unwrap();
    }

    #[test]
    fn feat134_v4_history_byte_budget_shrinks_pages_and_keeps_the_narrowed_cursor() {
        let turn = |turn_index: usize| HistoryTurnDtoV4 {
            turn_id: Uuid::now_v7().to_string(),
            projection_authority: "v4",
            status: "completed".to_owned(),
            terminal_at: Some(2),
            reasoning_status: "unavailable".to_owned(),
            reasoning_reason_code: Some("reasoning_not_emitted".to_owned()),
            messages: Vec::new(),
            reasoning: Vec::new(),
            artifacts: Vec::new(),
            terminal_code: None,
            timeline_items: (1..=2)
                .map(|item_ordinal| TimelineItemDtoV4 {
                    source_event_id: Uuid::now_v7().to_string(),
                    source_sequence: item_ordinal.to_string(),
                    source_occurred_at: "2026-08-28T06:00:00Z".to_owned(),
                    item_id: format!("turn-{turn_index}-item-{item_ordinal}"),
                    item_ordinal,
                    item_type: "agentMessage".to_owned(),
                    phase: Some("commentary"),
                    status: "completed",
                    text: "x".repeat(1024 * 1024),
                    reasoning_status: None,
                    reasoning_reason_code: None,
                    reasoning_parts: Vec::new(),
                    started_at_ms: 1,
                    completed_at_ms: Some(2),
                    execution: None,
                })
                .collect(),
            plan: None,
            notices: Vec::new(),
        };
        let byte_budget = MAX_HISTORY_PAGE_BYTES - V4_RESPONSE_STRUCTURAL_HEADROOM;
        let mut candidate_limits = vec![4_usize, 2, 1].into_iter();
        let mut current_limit = candidate_limits.next().unwrap();
        let selected = loop {
            let page = HistoryPageDtoV4 {
                turns: (0..current_limit).map(&turn).collect(),
                next_cursor: Some(format!("opaque-before-{current_limit}")),
                session_notices: Vec::new(),
                durable_sequence_cut: "9".to_owned(),
            };
            let encoded_bytes = serde_json::to_vec(&page).unwrap().len();
            match next_feat134_history_page_limit(page.turns.len(), encoded_bytes, byte_budget)
                .unwrap()
            {
                Some(next_limit) => {
                    assert!(next_limit < current_limit);
                    assert_eq!(Some(next_limit), candidate_limits.next());
                    current_limit = next_limit;
                }
                None => break page,
            }
        };
        assert_eq!(selected.turns.len(), 1);
        assert_eq!(selected.next_cursor.as_deref(), Some("opaque-before-1"));
        assert!(serde_json::to_vec(&selected).unwrap().len() <= byte_budget);
        assert_eq!(
            next_feat134_history_page_limit(1, byte_budget + 1, byte_budget),
            Err(())
        );
    }

    #[test]
    fn feat134_schema_and_native_event_fixture_are_frozen_and_content_free() {
        let schema: Value =
            serde_json::from_str(include_str!("../../schemas/chat-ipc-v4.schema.json"))
                .expect("v4 schema");
        assert_eq!(schema["x-yijie-schema-version"], 4);
        assert_eq!(schema["x-yijie-event-channel"], CHAT_EVENT_CHANNEL);
        assert_eq!(
            schema["$defs"]["noticeLive"]["allOf"][1]["additionalProperties"],
            false
        );
        assert_eq!(
            schema["$defs"]["turnTerminal"]["allOf"][1]["additionalProperties"],
            false
        );

        let expected: Vec<Value> =
            serde_json::from_str(include_str!("../../fixtures/chat-ipc-v4/event-corpus.json"))
                .expect("v4 event fixture");
        let subscription_id = Uuid::parse_str("13400000-0000-4000-8000-000000000002").unwrap();
        let context_id = Uuid::parse_str("13400000-0000-4000-8000-000000000003").unwrap();
        let session_id = Uuid::parse_str("13400000-0000-4000-8000-000000000004").unwrap();
        let turn_id = Uuid::parse_str("13400000-0000-4000-8000-000000000005").unwrap();
        let mut record = SubscriptionRecord {
            schema_version: CHAT_IPC_V4_SCHEMA_VERSION,
            context_id,
            session_id,
            projection_sequence: 0,
            assistant_text: String::new(),
            reasoning: HashMap::new(),
            terminal: false,
            blocked: false,
            artifact_turn_id: None,
            artifact_notifications: ArtifactNotificationQueue::default(),
        };
        for (index, fixture) in expected.into_iter().enumerate() {
            let sequence = u64::try_from(index + 1).unwrap();
            record.projection_sequence = sequence;
            let source_event_id = Uuid::parse_str(fixture["eventId"].as_str().unwrap()).unwrap();
            let source = SourceIdentity {
                event_id: source_event_id,
                sequence,
                occurred_at: fixture["payload"]["sourceOccurredAt"]
                    .as_str()
                    .unwrap()
                    .to_owned(),
            };
            let (event_turn_id, kind, payload) = match fixture["kind"].as_str().unwrap() {
                "turn_started" => (Some(turn_id), "turn_started", source_fact(&source)),
                "plan_updated" => {
                    let plan = TimelinePlan {
                        source_event_id,
                        source_sequence: sequence,
                        source_occurred_at: source.occurred_at.clone(),
                        explanation: None,
                        steps: Vec::new(),
                        observed_at_ms: 0,
                    };
                    (Some(turn_id), "plan_updated", plan_payload(&plan))
                }
                "notice" => {
                    let notice = TimelineNotice {
                        source_event_id,
                        source_sequence: sequence,
                        source_occurred_at: source.occurred_at.clone(),
                        scope: TimelineNoticeScope::Session,
                        severity: crate::chat::TimelineNoticeSeverity::Warning,
                        code: Some("provider_warning".to_owned()),
                        will_retry: false,
                        observed_at_ms: 0,
                    };
                    (None, "notice", notice_payload(&notice, false))
                }
                "turn_terminal" => (
                    Some(turn_id),
                    "turn_terminal",
                    json!({
                        "sourceEventId": source.event_id.to_string(),
                        "sourceSequence": source.sequence.to_string(),
                        "sourceOccurredAt": source.occurred_at,
                        "status": "failed",
                        "code": "runtime_error",
                        "unfinishedReasoningReasonCode": "runtime_error",
                    }),
                ),
                kind => panic!("unexpected v4 fixture kind: {kind}"),
            };
            let encoded = serde_json::to_value(source_event_envelope(
                subscription_id,
                &record,
                event_turn_id,
                source_event_id,
                sequence,
                kind,
                payload,
            ))
            .unwrap();
            assert_eq!(encoded, fixture);
            assert!(encoded["payload"].get("message").is_none());
        }
    }

    #[test]
    fn only_the_newest_bind_generation_can_publish_a_context() {
        let runtime = ChatIpcRuntime::new();
        let first = runtime.begin_binding();
        assert!(runtime.binding_is_current(first));
        let second = runtime.begin_binding();
        assert!(!runtime.binding_is_current(first));
        assert!(runtime.binding_is_current(second));
        runtime.invalidate_pending_bindings();
        assert!(!runtime.binding_is_current(second));
    }

    #[test]
    fn decoded_rebind_immediately_revokes_context_subscription_and_snapshot_authority() {
        let tenant_id = Uuid::now_v7();
        let scope = crate::chat::database::ChatScope::new(
            Uuid::now_v7().to_string(),
            tenant_id.to_string(),
        )
        .unwrap();
        let manager = ChatAuthorizationManager::new(&scope).unwrap();
        let context = manager
            .bind(
                AuthoritativeChatProjection::from_trusted_native_projection(
                    tenant_id,
                    1,
                    100,
                    ["task.read".to_owned(), "task.create".to_owned()],
                )
                .unwrap(),
                1,
            )
            .unwrap();
        let runtime = ChatIpcRuntime::new();
        let session_id = Uuid::now_v7();
        let subscription_id = runtime
            .inner
            .event_bridge
            .subscribe(context.context_id, session_id, CHAT_IPC_V6_SCHEMA_VERSION)
            .unwrap();
        runtime
            .cache_pending_approval_snapshot(
                context.context_id,
                session_id,
                subscription_id,
                PendingApprovalSnapshot {
                    stream_id: Uuid::now_v7(),
                    snapshot_at: "2026-08-31T00:00:00Z".to_owned(),
                    pending: Vec::new(),
                },
            )
            .unwrap();

        let legacy_generation = runtime.begin_scoped_binding(&manager, false).unwrap();
        assert!(runtime.binding_is_current(legacy_generation));
        assert!(manager
            .authorize_detailed(context.context_id, ChatAction::SubmitTurn, 2)
            .is_ok());
        assert!(runtime.inner.event_bridge.owns_subscription(
            context.context_id,
            session_id,
            subscription_id,
            CHAT_IPC_V6_SCHEMA_VERSION,
        ));
        assert_eq!(
            runtime
                .inner
                .pending_approval_snapshots
                .lock()
                .unwrap()
                .len(),
            1,
        );

        let generation = runtime.begin_scoped_binding(&manager, true).unwrap();

        assert!(runtime.binding_is_current(generation));
        assert_eq!(
            manager.authorize_detailed(context.context_id, ChatAction::SubmitTurn, 2),
            Err(AuthorizationFailure::ContextInvalid),
        );
        assert!(!runtime.inner.event_bridge.owns_subscription(
            context.context_id,
            session_id,
            subscription_id,
            CHAT_IPC_V6_SCHEMA_VERSION,
        ));
        assert!(runtime
            .take_pending_approval_snapshot(context.context_id, session_id, subscription_id,)
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn superseded_bind_inside_resume_cannot_publish_context_event_or_coordinator() {
        let tenant_id = Uuid::now_v7();
        let scope = crate::chat::database::ChatScope::new(
            Uuid::now_v7().to_string(),
            tenant_id.to_string(),
        )
        .unwrap();
        let manager = ChatAuthorizationManager::new(&scope).unwrap();
        let runtime = ChatIpcRuntime::new();
        let first_generation = runtime.begin_fail_closed_binding(&manager).unwrap();
        let first_guard = runtime.inner.bind_gate.lock().await;
        let first_context = manager
            .bind(
                AuthoritativeChatProjection::from_trusted_native_projection(
                    tenant_id,
                    1,
                    100,
                    ["task.read".to_owned(), "task.create".to_owned()],
                )
                .unwrap(),
                1,
            )
            .unwrap();
        let session_id = Uuid::now_v7();
        let first_subscription = runtime
            .inner
            .event_bridge
            .subscribe(
                first_context.context_id,
                session_id,
                CHAT_IPC_V6_SCHEMA_VERSION,
            )
            .unwrap();
        let superseded = Arc::new(Notify::new());
        let second = tokio::spawn({
            let runtime = runtime.clone();
            let manager = manager.clone();
            let superseded = superseded.clone();
            async move {
                let generation = runtime.begin_fail_closed_binding(&manager).unwrap();
                superseded.notify_one();
                let _guard = runtime.inner.bind_gate.lock().await;
                generation
            }
        });

        // This is the checkpoint reached after the first bind's controlled Host
        // resume/DB await. A newer decoded bind has already erected its barrier,
        // even though it cannot yet enter the mutation gate.
        superseded.notified().await;
        assert!(!runtime.binding_is_current(first_generation));
        assert_eq!(
            manager.authorize_detailed(first_context.context_id, ChatAction::SubmitTurn, 2),
            Err(AuthorizationFailure::ContextInvalid),
        );
        assert!(!runtime.inner.event_bridge.owns_subscription(
            first_context.context_id,
            session_id,
            first_subscription,
            CHAT_IPC_V6_SCHEMA_VERSION,
        ));
        assert!(runtime.inner.coordinator.lock().await.is_none());
        drop(first_guard);
        let second_generation = second.await.unwrap();
        assert!(runtime.binding_is_current(second_generation));
    }

    #[test]
    fn feat137_control_plane_waits_for_host_identity_before_bound() {
        let session_id = Uuid::now_v7();
        let pending = ControlPlaneDto::from_status(
            &PublicTaskControlPlaneStatus {
                session_id,
                state: PublicTaskBindingState::Bound,
                issue_code: None,
                host_session_bound: false,
            },
            true,
        );
        assert_eq!(pending.state, "binding_pending");
        assert!(!pending.retryable);
        assert_eq!(pending.recovery, "none");

        let bound = ControlPlaneDto::from_status(
            &PublicTaskControlPlaneStatus {
                session_id,
                state: PublicTaskBindingState::Bound,
                issue_code: None,
                host_session_bound: true,
            },
            true,
        );
        assert_eq!(bound.state, "bound");
    }

    #[test]
    fn feat137_off_control_plane_projection_is_literal_legacy_behavior() {
        let session_id = Uuid::now_v7();
        let unbound = PublicTaskControlPlaneStatus {
            session_id,
            state: PublicTaskBindingState::Bound,
            issue_code: None,
            host_session_bound: false,
        };
        assert_eq!(ControlPlaneDto::from_status(&unbound, false).state, "bound");
        assert_eq!(
            ControlPlaneDto::from_status(&unbound, true).state,
            "binding_pending"
        );

        let inflight = PublicTaskControlPlaneStatus {
            session_id,
            state: PublicTaskBindingState::Inflight,
            issue_code: Some("chat_temporarily_unavailable".to_owned()),
            host_session_bound: false,
        };
        let legacy = ControlPlaneDto::from_status(&inflight, false);
        assert_eq!(legacy.state, "pending");
        assert_eq!(
            legacy.issue_code.as_deref(),
            Some("chat_temporarily_unavailable")
        );
        assert!(legacy.retryable);
        assert_eq!(legacy.recovery, "retry");
        let feat137 = ControlPlaneDto::from_status(&inflight, true);
        assert_eq!(feat137.state, "pending");
        assert_eq!(feat137.issue_code, None);
        assert!(!feat137.retryable);
        assert_eq!(feat137.recovery, "none");
    }

    #[test]
    fn feat137_control_plane_dto_matches_closed_web_shapes_during_inflight_and_exhaustion() {
        let request_id = Uuid::parse_str("019c1a00-0000-7000-8000-000000000001").unwrap();
        let session_id = Uuid::parse_str("019c1a00-0000-7000-8000-000000000005").unwrap();
        for (status, fixture) in [
            (
                PublicTaskControlPlaneStatus {
                    session_id,
                    state: PublicTaskBindingState::Inflight,
                    issue_code: Some("chat_temporarily_unavailable".to_owned()),
                    host_session_bound: false,
                },
                include_str!("../../fixtures/chat-ipc-v1/control-plane-inflight-response.json"),
            ),
            (
                PublicTaskControlPlaneStatus {
                    session_id,
                    state: PublicTaskBindingState::Failed,
                    issue_code: Some("chat_temporarily_unavailable".to_owned()),
                    host_session_bound: false,
                },
                include_str!("../../fixtures/chat-ipc-v1/control-plane-failed-response.json"),
            ),
        ] {
            let expected: Value = serde_json::from_str(fixture).unwrap();
            assert_eq!(
                serde_json::to_value(CommandResponse::new(
                    request_id,
                    ControlPlaneDto::from_status(&status, true),
                ))
                .unwrap(),
                expected,
            );
        }
    }

    #[test]
    fn feat137_subscription_snapshot_is_exactly_bound_and_consumed_once() {
        let runtime = ChatIpcRuntime::new();
        let context_id = Uuid::now_v7();
        let session_id = Uuid::now_v7();
        let first_subscription = Uuid::now_v7();
        let second_subscription = Uuid::now_v7();
        let first = PendingApprovalSnapshot {
            stream_id: Uuid::now_v7(),
            snapshot_at: "2026-08-31T00:00:00Z".to_owned(),
            pending: Vec::new(),
        };
        let second = PendingApprovalSnapshot {
            stream_id: Uuid::now_v7(),
            snapshot_at: "2026-08-31T00:00:01Z".to_owned(),
            pending: Vec::new(),
        };

        runtime
            .cache_pending_approval_snapshot(
                context_id,
                session_id,
                first_subscription,
                first.clone(),
            )
            .unwrap();
        runtime
            .cache_pending_approval_snapshot(
                context_id,
                session_id,
                second_subscription,
                second.clone(),
            )
            .unwrap();
        assert!(runtime
            .take_pending_approval_snapshot(context_id, session_id, Uuid::now_v7())
            .unwrap()
            .is_none());
        assert_eq!(
            runtime
                .take_pending_approval_snapshot(context_id, session_id, first_subscription)
                .unwrap(),
            Some(first)
        );
        assert!(runtime
            .take_pending_approval_snapshot(context_id, session_id, first_subscription)
            .unwrap()
            .is_none());
        assert_eq!(
            runtime
                .take_pending_approval_snapshot(context_id, session_id, second_subscription)
                .unwrap(),
            Some(second)
        );
    }

    #[test]
    fn feat137_subscription_cleanup_requires_exact_context_ownership() {
        let runtime = ChatIpcRuntime::new();
        let context_id = Uuid::now_v7();
        let foreign_context_id = Uuid::now_v7();
        let session_id = Uuid::now_v7();
        let subscription_id = runtime
            .inner
            .event_bridge
            .subscribe(context_id, session_id, CHAT_IPC_V6_SCHEMA_VERSION)
            .unwrap();
        let snapshot = PendingApprovalSnapshot {
            stream_id: Uuid::now_v7(),
            snapshot_at: "2026-08-31T00:00:00Z".to_owned(),
            pending: Vec::new(),
        };
        runtime
            .cache_pending_approval_snapshot(
                context_id,
                session_id,
                subscription_id,
                snapshot.clone(),
            )
            .unwrap();

        assert!(!runtime
            .inner
            .event_bridge
            .unsubscribe(foreign_context_id, subscription_id));
        runtime.discard_pending_approval_snapshot(foreign_context_id, subscription_id);
        assert!(!runtime.inner.event_bridge.owns_subscription(
            foreign_context_id,
            session_id,
            subscription_id,
            CHAT_IPC_V6_SCHEMA_VERSION,
        ));
        assert!(runtime.inner.event_bridge.owns_subscription(
            context_id,
            session_id,
            subscription_id,
            CHAT_IPC_V6_SCHEMA_VERSION,
        ));
        assert!(runtime
            .inner
            .event_bridge
            .unsubscribe(context_id, subscription_id));
        assert!(runtime
            .take_pending_approval_snapshot(context_id, session_id, subscription_id)
            .unwrap()
            .is_some());
        runtime
            .cache_pending_approval_snapshot(context_id, session_id, subscription_id, snapshot)
            .unwrap();
        runtime.discard_pending_approval_snapshot(context_id, subscription_id);
        assert!(runtime
            .take_pending_approval_snapshot(context_id, session_id, subscription_id)
            .unwrap()
            .is_none());
    }

    #[test]
    fn feat137_reopen_resumes_before_coordinator_and_subscribe_get_is_sse_first() {
        let source = include_str!("ipc.rs");
        assert!(source.contains("host_resume_generation: Mutex<Option<String>>"));
        let bind_start = source.rfind("pub async fn chat_bind_context_v1(").unwrap();
        let bind_end = source[bind_start..]
            .find("pub async fn chat_list_projects_v1(")
            .map(|offset| bind_start + offset)
            .unwrap();
        let bind = &source[bind_start..bind_end];
        assert!(
            bind.find("begin_scoped_binding(manager, true)").unwrap()
                < bind.find(".chat_projection(").unwrap()
        );
        assert!(bind.contains("None => ipc_runtime.begin_binding()"));
        let feat137_start = bind.find("let prepared = async").unwrap();
        let feat137 = &bind[feat137_start..];
        let context_bind = feat137.find(".bind(projection, now)").unwrap();
        let after_context_bind = &feat137[context_bind..];
        assert!(
            after_context_bind.find(".bind(projection, now)").unwrap()
                < after_context_bind.find("stop_coordinator()").unwrap()
        );
        assert!(
            feat137.find(".bind(projection, now)").unwrap()
                < feat137.find("ensure_demo_fast_sidecar()").unwrap()
        );
        assert!(
            feat137.find("ensure_demo_fast_sidecar()").unwrap()
                < feat137
                    .find("ensure_bound_sessions_resumed(&chat_runtime)")
                    .unwrap()
        );
        assert!(
            feat137.find(".bind(projection, now)").unwrap()
                < feat137
                    .find(".ensure_coordinator(app, application")
                    .unwrap()
        );
        assert!(bind.matches("binding_is_current(bind_generation)").count() >= 7);
        assert!(feat137.contains("if native_can_read_task"));

        let subscribe_start = source
            .rfind("pub async fn chat_subscribe_session_v1(")
            .unwrap();
        let subscribe_end = source[subscribe_start..]
            .find("pub async fn chat_unsubscribe_session_v1(")
            .map(|offset| subscribe_start + offset)
            .unwrap();
        let subscribe = &source[subscribe_start..subscribe_end];
        assert!(
            subscribe.find("if !binding.host_session_bound").unwrap()
                < subscribe
                    .find(".event_bridge\n            .subscribe(")
                    .unwrap()
        );
        assert!(
            subscribe
                .find(".event_bridge\n            .subscribe(")
                .unwrap()
                < subscribe
                    .find(".pending_approvals_for_subscription_v6(")
                    .unwrap()
        );
        assert!(
            subscribe
                .find(".pending_approvals_for_subscription_v6(")
                .unwrap()
                < subscribe.find("cache_pending_approval_snapshot(").unwrap()
        );

        let recovery_start = source
            .find("pub async fn chat_request_local_recovery_v1(")
            .unwrap();
        let recovery_end = source[recovery_start..]
            .find("fn validate_input(")
            .map(|offset| recovery_start + offset)
            .unwrap();
        let recovery = &source[recovery_start..recovery_end];
        assert!(recovery.contains("ipc_runtime: State<'_, ChatIpcRuntime>"));
        assert!(
            recovery.find("stop_coordinator()").unwrap()
                < recovery.find("request_local_recovery().await").unwrap()
        );
        assert!(
            recovery
                .find("ensure_bound_sessions_resumed(&chat_runtime)")
                .unwrap()
                < recovery
                    .find("ensure_coordinator(app, application")
                    .unwrap()
        );

        let unsubscribe_start = source
            .rfind("pub async fn chat_unsubscribe_session_v1(")
            .unwrap();
        let unsubscribe_end = source[unsubscribe_start..]
            .find("pub async fn chat_cancel_request_v1(")
            .map(|offset| unsubscribe_start + offset)
            .unwrap();
        let unsubscribe = &source[unsubscribe_start..unsubscribe_end];
        assert!(
            unsubscribe.find("manager.authorize_detailed(").unwrap()
                < unsubscribe.find(".unsubscribe(request.context_id").unwrap()
        );
        assert!(unsubscribe.contains("Err(AuthorizationFailure::ContextInvalid)"));
        assert!(unsubscribe.contains("Err(AuthorizationFailure::CapabilityDenied)"));
    }
}

fn map_native_projection_error(error: NativeProjectionError, request_id: Uuid) -> ChatIpcError {
    match error {
        NativeProjectionError::Unauthenticated => {
            ChatIpcError::new(Some(request_id), "chat_unauthenticated", false, "sign_in")
        }
        NativeProjectionError::CapabilityDenied => {
            ChatIpcError::capability_denied(Some(request_id))
        }
        NativeProjectionError::Invalid => ChatIpcError::request_invalid(Some(request_id)),
        NativeProjectionError::Unavailable => {
            ChatIpcError::temporarily_unavailable(Some(request_id))
        }
    }
}

async fn applications(
    runtime: &ChatRuntime,
    request_id: Uuid,
) -> Result<
    (
        ConversationApplication,
        AuthorizedConversationApplication,
        ChatAuthorizationManager,
    ),
    ChatIpcError,
> {
    let application = runtime
        .local_conversation_application()
        .await
        .map_err(|error| map_chat_error(error, Some(request_id)))?;
    let authorization = runtime
        .authorization_manager()
        .map_err(|error| map_chat_error(error, Some(request_id)))?;
    let authorized =
        AuthorizedConversationApplication::new(application.clone(), authorization.clone());
    Ok((application, authorized, authorization))
}

async fn offline_applications(
    runtime: &ChatRuntime,
    request_id: Uuid,
) -> Result<
    (
        ConversationApplication,
        AuthorizedConversationApplication,
        ChatAuthorizationManager,
    ),
    ChatIpcError,
> {
    let application = runtime
        .local_offline_conversation_application()
        .await
        .map_err(|error| map_chat_error(error, Some(request_id)))?;
    let authorization = runtime
        .authorization_manager()
        .map_err(|error| map_chat_error(error, Some(request_id)))?;
    let authorized =
        AuthorizedConversationApplication::new(application.clone(), authorization.clone());
    Ok((application, authorized, authorization))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResyncDto {
    session: SessionDto,
    history: HistoryPageDto,
    cleanup: Option<CleanupStatusDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResyncDtoV2 {
    session: SessionDto,
    history: HistoryPageDtoV2,
    cleanup: Option<CleanupStatusDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResyncDtoV4 {
    session: SessionDto,
    history: HistoryPageDtoV4,
    cleanup: Option<CleanupStatusDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResyncDtoV5 {
    session: SessionDto,
    history: Value,
    cleanup: Option<CleanupStatusDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResyncDtoV6 {
    session: SessionDto,
    history: Value,
    cleanup: Option<CleanupStatusDto>,
    pending_approval_snapshot: Value,
}

#[tauri::command]
pub async fn chat_bind_context_v1(
    request: Value,
    app: AppHandle,
    auth_runtime: State<'_, NativeAuthRuntime>,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<BoundContextDto>, ChatIpcError> {
    let request = decode_bind_request(request)?;
    let feat137_binding =
        bind_lifecycle(chat_runtime.feat137_streaming_enabled()) == BindLifecycle::Feat137;
    let early_manager = if feat137_binding {
        Some(
            chat_runtime
                .authorization_manager()
                .map_err(|error| map_chat_error(error, Some(request.request_id)))?,
        )
    } else {
        None
    };
    // Only FEAT-137 erects the fail-closed authorization barrier before the
    // first native await. The legacy path retains its original bind ordering.
    let bind_generation = match early_manager.as_ref() {
        Some(manager) => ipc_runtime
            .begin_scoped_binding(manager, true)
            .map_err(|error| map_chat_error(error, Some(request.request_id)))?,
        None => ipc_runtime.begin_binding(),
    };
    let now = unix_seconds().map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    let native = match auth_runtime
        .chat_projection(&request.payload.tenant_selector, now)
        .await
    {
        Ok(native) => native,
        Err(error) => {
            if ipc_runtime.binding_is_current(bind_generation) && feat137_binding {
                let _ = ipc_runtime.stop_coordinator().await;
            }
            return Err(map_native_projection_error(error, request.request_id));
        }
    };
    if !ipc_runtime.binding_is_current(bind_generation) {
        return Err(ChatIpcError::request_cancelled(Some(request.request_id)));
    }
    let native_authorization_revision = native.authorization_revision;
    let native_can_create_task = native
        .capabilities
        .iter()
        .any(|capability| capability == "task.create");
    let native_can_read_task = native
        .capabilities
        .iter()
        .any(|capability| capability == "task.read");
    let manager = match early_manager {
        Some(manager) => manager,
        None => chat_runtime
            .authorization_manager()
            .map_err(|error| map_chat_error(error, Some(request.request_id)))?,
    };
    let projection = AuthoritativeChatProjection::from_trusted_native_projection(
        native.tenant_id,
        native.authorization_revision,
        native.expires_at,
        native.capabilities,
    )
    .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    let _bind_guard = ipc_runtime.inner.bind_gate.lock().await;
    if !ipc_runtime.binding_is_current(bind_generation) {
        return Err(ChatIpcError::request_cancelled(Some(request.request_id)));
    }
    if !feat137_binding {
        let context = manager
            .bind(projection, now)
            .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
        chat_runtime
            .ensure_demo_fast_sidecar()
            .await
            .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
        app.state::<super::artifact_native::ArtifactNativeRuntime>()
            .invalidate_all();
        app.state::<super::artifact_video_native::ArtifactVideoNativeRuntime>()
            .invalidate_all();
        app.state::<super::artifact_file_native::ArtifactFileNativeRuntime>()
            .invalidate_all();
        let offline = chat_runtime
            .local_offline_conversation_application()
            .await
            .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
        if native_can_create_task {
            offline
                .resume_blocked_public_tasks(native_authorization_revision)
                .await
                .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
        }
        ipc_runtime
            .inner
            .event_bridge
            .configure(app.clone(), manager.clone(), false)
            .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)))?;
        ipc_runtime.invalidate_all();
        if let Ok(application) = chat_runtime.local_conversation_application().await {
            ipc_runtime
                .ensure_coordinator(app, application, manager.clone())
                .await
                .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
        }
        let allowed_actions =
            manager
                .allowed_actions(context.context_id, now)
                .map_err(|failure| match failure {
                    AuthorizationFailure::ContextInvalid => {
                        ChatIpcError::context_invalid(Some(request.request_id))
                    }
                    AuthorizationFailure::CapabilityDenied => {
                        ChatIpcError::capability_denied(Some(request.request_id))
                    }
                })?;
        return Ok(CommandResponse::new(
            request.request_id,
            BoundContextDto {
                context_id: context.context_id.to_string(),
                expires_at_epoch_seconds: context.expires_at,
                allowed_actions,
            },
        ));
    }
    let prepared = async {
        let context = manager
            .bind(projection, now)
            .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
        let allowed_actions =
            manager
                .allowed_actions(context.context_id, now)
                .map_err(|failure| match failure {
                    AuthorizationFailure::ContextInvalid => {
                        ChatIpcError::context_invalid(Some(request.request_id))
                    }
                    AuthorizationFailure::CapabilityDenied => {
                        ChatIpcError::capability_denied(Some(request.request_id))
                    }
                })?;
        ipc_runtime
            .stop_coordinator()
            .await
            .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
        if !ipc_runtime.binding_is_current(bind_generation) {
            return Err(ChatIpcError::request_cancelled(Some(request.request_id)));
        }
        chat_runtime
            .ensure_demo_fast_sidecar()
            .await
            .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
        if !ipc_runtime.binding_is_current(bind_generation) {
            return Err(ChatIpcError::request_cancelled(Some(request.request_id)));
        }
        app.state::<super::artifact_native::ArtifactNativeRuntime>()
            .invalidate_all();
        app.state::<super::artifact_video_native::ArtifactVideoNativeRuntime>()
            .invalidate_all();
        app.state::<super::artifact_file_native::ArtifactFileNativeRuntime>()
            .invalidate_all();
        if native_can_read_task {
            ipc_runtime
                .ensure_bound_sessions_resumed(&chat_runtime)
                .await
                .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
            if !ipc_runtime.binding_is_current(bind_generation) {
                return Err(ChatIpcError::request_cancelled(Some(request.request_id)));
            }
        }
        if native_can_read_task {
            let application = chat_runtime
                .local_conversation_application()
                .await
                .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
            if !ipc_runtime.binding_is_current(bind_generation) {
                return Err(ChatIpcError::request_cancelled(Some(request.request_id)));
            }
            ipc_runtime
                .ensure_coordinator(app, application, manager.clone())
                .await
                .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
            if !ipc_runtime.binding_is_current(bind_generation) {
                return Err(ChatIpcError::request_cancelled(Some(request.request_id)));
            }
        }
        Ok::<_, ChatIpcError>((context, allowed_actions))
    }
    .await;
    let (context, allowed_actions) = match prepared {
        Ok(prepared) => prepared,
        Err(error) => {
            let _ = ipc_runtime.stop_coordinator().await;
            let _ = manager.invalidate_all();
            ipc_runtime.invalidate_all();
            chat_runtime.invalidate_host_bridge().await;
            return Err(error);
        }
    };
    if !ipc_runtime.binding_is_current(bind_generation) {
        let _ = ipc_runtime.stop_coordinator().await;
        let _ = manager.invalidate_all();
        ipc_runtime.invalidate_all();
        return Err(ChatIpcError::request_cancelled(Some(request.request_id)));
    }
    Ok(CommandResponse::new(
        request.request_id,
        BoundContextDto {
            context_id: context.context_id.to_string(),
            expires_at_epoch_seconds: context.expires_at,
            allowed_actions,
        },
    ))
}

#[tauri::command]
pub async fn chat_list_projects_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<Vec<ProjectDto>>, ChatIpcError> {
    let request: CommandRequest<EmptyPayload> = decode_request(request)?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadProjects,
        request.request_id,
    )?;
    ipc_runtime.begin_read(request.request_id)?;
    let result = authorized.list_projects(request.context_id).await;
    let finished = ipc_runtime.finish_read(request.request_id);
    let projects = result.map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    finished?;
    Ok(CommandResponse::new(
        request.request_id,
        projects.into_iter().map(Into::into).collect(),
    ))
}

#[tauri::command]
pub async fn chat_pick_project_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
) -> Result<CommandResponse<Option<ProjectDto>>, ChatIpcError> {
    let request: CommandRequest<OperationOnlyPayload> = decode_request(request)?;
    validate_operation(request.payload.operation_id, request.request_id)?;
    let manager = chat_runtime
        .authorization_manager()
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::UseProject,
        request.request_id,
    )?;
    let project = chat_runtime
        .pick_project()
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    Ok(CommandResponse::new(
        request.request_id,
        project.map(Into::into),
    ))
}

#[tauri::command]
pub async fn chat_revalidate_project_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
) -> Result<CommandResponse<ProjectDto>, ChatIpcError> {
    let request: CommandRequest<ProjectOperationPayload> = decode_request(request)?;
    validate_operation(request.payload.operation_id, request.request_id)?;
    let manager = chat_runtime
        .authorization_manager()
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::UseProject,
        request.request_id,
    )?;
    let project = chat_runtime
        .revalidate_project(request.payload.project_id.to_string())
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    Ok(CommandResponse::new(request.request_id, project.into()))
}

#[tauri::command]
pub async fn chat_set_project_pinned_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
) -> Result<CommandResponse<OperationDto>, ChatIpcError> {
    let request: CommandRequest<SetProjectPinnedPayload> = decode_request(request)?;
    validate_operation(request.payload.operation_id, request.request_id)?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::PinProject,
        request.request_id,
    )?;
    authorized
        .set_project_pinned(
            request.context_id,
            request.payload.project_id,
            request.payload.pinned,
        )
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    Ok(CommandResponse::new(
        request.request_id,
        OperationDto {
            operation_id: request.payload.operation_id.to_string(),
        },
    ))
}

#[tauri::command]
pub async fn chat_remove_project_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
) -> Result<CommandResponse<OperationDto>, ChatIpcError> {
    let request: CommandRequest<ProjectOperationPayload> = decode_request(request)?;
    validate_operation(request.payload.operation_id, request.request_id)?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::RemoveProject,
        request.request_id,
    )?;
    authorized
        .remove_project(request.context_id, request.payload.project_id)
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    Ok(CommandResponse::new(
        request.request_id,
        OperationDto {
            operation_id: request.payload.operation_id.to_string(),
        },
    ))
}

#[tauri::command]
pub async fn chat_create_session_v1(
    request: Value,
    app: AppHandle,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<CreatedSessionDto>, ChatIpcError> {
    let request: CommandRequest<CreateSessionPayload> = decode_request(request)?;
    validate_input(&request.payload.input, request.request_id)?;
    validate_operation(request.payload.operation_id, request.request_id)?;
    let (application, authorized, manager) =
        applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::UseProject,
        request.request_id,
    )?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::CreateSession,
        request.request_id,
    )?;
    let pending = authorized
        .create_local_session(
            request.context_id,
            request.payload.project_id,
            request.payload.input,
            request.payload.operation_id,
        )
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    ipc_runtime
        .ensure_coordinator(app, application, manager)
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    Ok(CommandResponse::new(
        request.request_id,
        CreatedSessionDto {
            session_id: pending.session_id.to_string(),
            turn_id: pending.turn_id.to_string(),
            operation_id: pending.create_operation_id.to_string(),
        },
    ))
}

#[tauri::command]
pub async fn chat_submit_turn_v1(
    request: Value,
    app: AppHandle,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<CreatedSessionDto>, ChatIpcError> {
    let request: CommandRequest<SubmitTurnPayload> = decode_request(request)?;
    validate_input(&request.payload.input, request.request_id)?;
    validate_operation(request.payload.operation_id, request.request_id)?;
    let (application, authorized, manager) =
        applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::SubmitTurn,
        request.request_id,
    )?;
    let turn_id = authorized
        .enqueue_turn(
            request.context_id,
            request.payload.session_id,
            request.payload.input,
            request.payload.operation_id,
        )
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    ipc_runtime
        .ensure_coordinator(app, application, manager)
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    Ok(CommandResponse::new(
        request.request_id,
        CreatedSessionDto {
            session_id: request.payload.session_id.to_string(),
            turn_id: turn_id.to_string(),
            operation_id: request.payload.operation_id.to_string(),
        },
    ))
}

#[tauri::command]
pub async fn chat_pick_attachments_v2(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
    app: AppHandle,
) -> Result<CommandResponse<Vec<AttachmentDto>>, ChatIpcError> {
    let request: CommandRequest<PickAttachmentsPayload> = decode_request_v2(request)?;
    validate_operation(request.payload.operation_id, request.request_id)
        .map_err(ChatIpcError::v2)?;
    validate_remaining_capacity(request.payload.remaining_capacity, request.request_id)?;
    let draft_target = draft_target(request.payload.draft_target, request.request_id)?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id)
        .await
        .map_err(ChatIpcError::v2)?;
    authorize(
        &manager,
        request.context_id,
        draft_target_action(&draft_target),
        request.request_id,
    )
    .map_err(ChatIpcError::v2)?;
    let Some(paths) = attachment::pick_paths()
        .await
        .map_err(|error| map_attachment_import_error(error, request.request_id, 0))?
    else {
        return Ok(CommandResponse::new_v2(request.request_id, Vec::new()));
    };
    validate_attachment_batch_size(
        paths.len(),
        request.payload.remaining_capacity,
        request.request_id,
    )?;
    let now =
        unix_seconds().map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    let (prepared, mut import_events) = prepare_attachments(
        app,
        request.context_id,
        request.payload.operation_id,
        paths,
        now,
        request.payload.remaining_capacity,
        request.request_id,
    )
    .await?;
    let attachments = match authorized
        .store_attachments(
            request.context_id,
            prepared,
            request.payload.remaining_capacity,
            draft_target,
        )
        .await
    {
        Ok(attachments) => attachments,
        Err(error) => {
            import_events.emit_storage_failure();
            return Err(map_chat_error(error, Some(request.request_id))
                .v2()
                .with_attachment_item_count(import_events.item_count));
        }
    };
    let attachment_dtos = attachments
        .into_iter()
        .map(AttachmentDto::from)
        .collect::<Vec<_>>();
    import_events.emit_ready();
    Ok(CommandResponse::new_v2(request.request_id, attachment_dtos))
}

#[tauri::command]
pub async fn chat_import_attachments_v2(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
    app: AppHandle,
) -> Result<CommandResponse<Vec<AttachmentDto>>, ChatIpcError> {
    let request: CommandRequest<ImportAttachmentsPayload> = decode_request_v2(request)?;
    validate_operation(request.payload.operation_id, request.request_id)
        .map_err(ChatIpcError::v2)?;
    validate_attachment_batch_size(
        request.payload.paths.len(),
        request.payload.remaining_capacity,
        request.request_id,
    )?;
    let paths = validate_attachment_paths(&request.payload.paths, request.request_id)?;
    let draft_target = draft_target(request.payload.draft_target, request.request_id)?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id)
        .await
        .map_err(ChatIpcError::v2)?;
    authorize(
        &manager,
        request.context_id,
        draft_target_action(&draft_target),
        request.request_id,
    )
    .map_err(ChatIpcError::v2)?;
    let now =
        unix_seconds().map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    let remaining_capacity = request.payload.remaining_capacity;
    let (prepared, mut import_events) = prepare_attachments(
        app,
        request.context_id,
        request.payload.operation_id,
        paths,
        now,
        remaining_capacity,
        request.request_id,
    )
    .await?;
    let attachments = match authorized
        .store_attachments(
            request.context_id,
            prepared,
            remaining_capacity,
            draft_target,
        )
        .await
    {
        Ok(attachments) => attachments,
        Err(error) => {
            import_events.emit_storage_failure();
            return Err(map_chat_error(error, Some(request.request_id))
                .v2()
                .with_attachment_item_count(import_events.item_count));
        }
    };
    let attachment_dtos = attachments
        .into_iter()
        .map(AttachmentDto::from)
        .collect::<Vec<_>>();
    import_events.emit_ready();
    Ok(CommandResponse::new_v2(request.request_id, attachment_dtos))
}

#[tauri::command]
pub async fn chat_list_draft_attachments_v2(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
) -> Result<CommandResponse<Vec<AttachmentDto>>, ChatIpcError> {
    let request: CommandRequest<ListDraftAttachmentsPayload> = decode_request_v2(request)?;
    let draft_target = draft_target(request.payload.draft_target, request.request_id)?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id)
        .await
        .map_err(ChatIpcError::v2)?;
    authorize(
        &manager,
        request.context_id,
        draft_target_action(&draft_target),
        request.request_id,
    )
    .map_err(ChatIpcError::v2)?;
    let attachments = authorized
        .list_ready_attachments(request.context_id, draft_target)
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    Ok(CommandResponse::new_v2(
        request.request_id,
        attachments.into_iter().map(Into::into).collect(),
    ))
}

#[tauri::command]
pub async fn chat_remove_attachment_v2(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
) -> Result<CommandResponse<OperationDto>, ChatIpcError> {
    let request: CommandRequest<RemoveAttachmentPayload> = decode_request_v2(request)?;
    validate_operation(request.payload.operation_id, request.request_id)
        .map_err(ChatIpcError::v2)?;
    if request.payload.attachment_id.is_nil() {
        return Err(ChatIpcError::request_invalid(Some(request.request_id)).v2());
    }
    let draft_target = draft_target(request.payload.draft_target, request.request_id)?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id)
        .await
        .map_err(ChatIpcError::v2)?;
    authorize(
        &manager,
        request.context_id,
        draft_target_action(&draft_target),
        request.request_id,
    )
    .map_err(ChatIpcError::v2)?;
    authorized
        .remove_ready_attachment(
            request.context_id,
            request.payload.attachment_id,
            draft_target,
        )
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    Ok(CommandResponse::new_v2(
        request.request_id,
        OperationDto {
            operation_id: request.payload.operation_id.to_string(),
        },
    ))
}

#[tauri::command]
pub async fn chat_create_session_v2(
    request: Value,
    app: AppHandle,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<CreatedSessionDto>, ChatIpcError> {
    let request: CommandRequest<CreateSessionV2Payload> = decode_request_v2(request)?;
    validate_operation(request.payload.operation_id, request.request_id)
        .map_err(ChatIpcError::v2)?;
    let blocks = draft_content_blocks(request.payload.content_blocks, request.request_id)?;
    let (application, authorized, manager) = applications(&chat_runtime, request.request_id)
        .await
        .map_err(ChatIpcError::v2)?;
    let pending = authorized
        .create_local_session_multimodal(
            request.context_id,
            request.payload.project_id,
            blocks,
            request.payload.operation_id,
        )
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    ipc_runtime
        .ensure_coordinator(app, application, manager)
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    Ok(CommandResponse::new_v2(
        request.request_id,
        CreatedSessionDto {
            session_id: pending.session_id.to_string(),
            turn_id: pending.turn_id.to_string(),
            operation_id: pending.create_operation_id.to_string(),
        },
    ))
}

#[tauri::command]
pub async fn chat_submit_turn_v2(
    request: Value,
    app: AppHandle,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<CreatedSessionDto>, ChatIpcError> {
    let request: CommandRequest<SubmitTurnV2Payload> = decode_request_v2(request)?;
    validate_operation(request.payload.operation_id, request.request_id)
        .map_err(ChatIpcError::v2)?;
    let blocks = draft_content_blocks(request.payload.content_blocks, request.request_id)?;
    let (application, authorized, manager) = applications(&chat_runtime, request.request_id)
        .await
        .map_err(ChatIpcError::v2)?;
    let turn_id = authorized
        .enqueue_turn_multimodal(
            request.context_id,
            request.payload.session_id,
            blocks,
            request.payload.operation_id,
        )
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    ipc_runtime
        .ensure_coordinator(app, application, manager)
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    Ok(CommandResponse::new_v2(
        request.request_id,
        CreatedSessionDto {
            session_id: request.payload.session_id.to_string(),
            turn_id: turn_id.to_string(),
            operation_id: request.payload.operation_id.to_string(),
        },
    ))
}

#[tauri::command]
pub async fn chat_list_sessions_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<SessionPageDto>, ChatIpcError> {
    let request: CommandRequest<ListSessionsPayload> = decode_request(request)?;
    let now = unix_seconds().map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    let cursor = ipc_runtime.resolve_session_cursor(
        request.context_id,
        request.payload.cursor.as_deref(),
        now,
        request.request_id,
    )?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadSessions,
        request.request_id,
    )?;
    ipc_runtime.begin_read(request.request_id)?;
    let result = authorized
        .list_sessions(request.context_id, cursor, request.payload.limit)
        .await;
    let finished = ipc_runtime.finish_read(request.request_id);
    let page = result.map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    finished?;
    let SessionPage {
        sessions,
        next_cursor,
    } = page;
    let next_cursor = next_cursor
        .map(|cursor| {
            ipc_runtime.issue_cursor(request.context_id, CursorValue::Sessions(cursor), now)
        })
        .transpose()?;
    let data = SessionPageDto {
        sessions: sessions.into_iter().map(Into::into).collect(),
        next_cursor,
    };
    enforce_response_limit(&data, MAX_SESSION_PAGE_BYTES, request.request_id)?;
    Ok(CommandResponse::new(request.request_id, data))
}

#[tauri::command]
pub async fn chat_load_history_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<HistoryPageDto>, ChatIpcError> {
    let request: CommandRequest<SessionReadPayload> = decode_request(request)?;
    let now = unix_seconds().map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    let before = ipc_runtime.resolve_history_cursor(
        request.context_id,
        request.payload.session_id,
        request.payload.cursor.as_deref(),
        now,
        request.request_id,
    )?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadSessions,
        request.request_id,
    )?;
    ipc_runtime.begin_read(request.request_id)?;
    let result = authorized
        .load_history(
            request.context_id,
            request.payload.session_id,
            before,
            request.payload.limit,
        )
        .await;
    let finished = ipc_runtime.finish_read(request.request_id);
    let page = result.map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    finished?;
    let next_cursor = page
        .next_before_ordinal
        .map(|before| {
            ipc_runtime.issue_cursor(
                request.context_id,
                CursorValue::History {
                    session_id: request.payload.session_id,
                    before,
                },
                now,
            )
        })
        .transpose()?;
    let data = history_dto(page, next_cursor);
    enforce_response_limit(&data, MAX_HISTORY_PAGE_BYTES, request.request_id)?;
    Ok(CommandResponse::new(request.request_id, data))
}

#[tauri::command]
pub async fn chat_load_history_v2(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<HistoryPageDtoV2>, ChatIpcError> {
    let request: CommandRequest<SessionReadPayload> = decode_request_v2(request)?;
    let now =
        unix_seconds().map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    let before = ipc_runtime
        .resolve_history_cursor(
            request.context_id,
            request.payload.session_id,
            request.payload.cursor.as_deref(),
            now,
            request.request_id,
        )
        .map_err(ChatIpcError::v2)?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id)
        .await
        .map_err(ChatIpcError::v2)?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadSessions,
        request.request_id,
    )
    .map_err(ChatIpcError::v2)?;
    ipc_runtime
        .begin_read(request.request_id)
        .map_err(ChatIpcError::v2)?;
    let result = authorized
        .load_history(
            request.context_id,
            request.payload.session_id,
            before,
            request.payload.limit,
        )
        .await;
    let finished = ipc_runtime.finish_read(request.request_id);
    let page = result.map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    finished.map_err(ChatIpcError::v2)?;
    let next_cursor = page
        .next_before_ordinal
        .map(|before| {
            ipc_runtime.issue_cursor(
                request.context_id,
                CursorValue::History {
                    session_id: request.payload.session_id,
                    before,
                },
                now,
            )
        })
        .transpose()
        .map_err(ChatIpcError::v2)?;
    let message_ids = history_message_ids(&page);
    let projections = authorized
        .load_message_content_blocks(request.context_id, message_ids)
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    let data = history_dto_v2(page, next_cursor, projections)
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    enforce_response_limit(&data, MAX_HISTORY_PAGE_BYTES, request.request_id)
        .map_err(ChatIpcError::v2)?;
    Ok(CommandResponse::new_v2(request.request_id, data))
}

#[tauri::command]
pub async fn chat_load_history_v3(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<Value, ChatIpcError> {
    if request_schema_version(&request) == Some(CHAT_IPC_V6_SCHEMA_VERSION) {
        let request: CommandRequest<SessionReadPayload> = decode_request_v6(request)?;
        if !chat_runtime.feat137_streaming_enabled() {
            return Err(ChatIpcError::request_invalid(Some(request.request_id)).v6());
        }
        let now =
            unix_seconds().map_err(|error| map_chat_error(error, Some(request.request_id)).v6())?;
        let before = ipc_runtime
            .resolve_history_cursor(
                request.context_id,
                request.payload.session_id,
                request.payload.cursor.as_deref(),
                now,
                request.request_id,
            )
            .map_err(ChatIpcError::v6)?;
        let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id)
            .await
            .map_err(ChatIpcError::v6)?;
        authorize(
            &manager,
            request.context_id,
            ChatAction::ReadSessions,
            request.request_id,
        )
        .map_err(ChatIpcError::v6)?;
        ipc_runtime
            .begin_read(request.request_id)
            .map_err(ChatIpcError::v6)?;
        let result = load_bounded_feat137_history_snapshot(
            &authorized,
            request.context_id,
            request.payload.session_id,
            before,
            request.payload.limit,
            MAX_HISTORY_PAGE_BYTES,
            request.request_id,
        )
        .await;
        let finished = ipc_runtime.finish_read(request.request_id);
        let snapshot = result?;
        finished.map_err(ChatIpcError::v6)?;
        let next_cursor = snapshot
            .history
            .next_before_ordinal
            .map(|before| {
                ipc_runtime.issue_cursor(
                    request.context_id,
                    CursorValue::History {
                        session_id: request.payload.session_id,
                        before,
                    },
                    now,
                )
            })
            .transpose()
            .map_err(ChatIpcError::v6)?;
        let data = history_dto_v6(
            snapshot.history,
            next_cursor,
            snapshot.message_content_blocks,
            snapshot.artifacts,
            snapshot.feat134,
            snapshot.approvals,
        )
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v6())?;
        enforce_response_limit(&data, MAX_HISTORY_PAGE_BYTES, request.request_id)
            .map_err(ChatIpcError::v6)?;
        return serde_json::to_value(CommandResponse::new_v6(request.request_id, data))
            .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)).v6());
    }
    if request_schema_version(&request) == Some(CHAT_IPC_V5_SCHEMA_VERSION) {
        let request: CommandRequest<SessionReadPayload> = decode_request_v5(request)?;
        if !chat_runtime.feat136_streaming_enabled() {
            return Err(ChatIpcError::request_invalid(Some(request.request_id)).v5());
        }
        let now =
            unix_seconds().map_err(|error| map_chat_error(error, Some(request.request_id)).v5())?;
        let before = ipc_runtime
            .resolve_history_cursor(
                request.context_id,
                request.payload.session_id,
                request.payload.cursor.as_deref(),
                now,
                request.request_id,
            )
            .map_err(ChatIpcError::v5)?;
        let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id)
            .await
            .map_err(ChatIpcError::v5)?;
        authorize(
            &manager,
            request.context_id,
            ChatAction::ReadSessions,
            request.request_id,
        )
        .map_err(ChatIpcError::v5)?;
        ipc_runtime
            .begin_read(request.request_id)
            .map_err(ChatIpcError::v5)?;
        let result = load_bounded_feat136_history_snapshot(
            &authorized,
            request.context_id,
            request.payload.session_id,
            before,
            request.payload.limit,
            MAX_HISTORY_PAGE_BYTES,
            request.request_id,
        )
        .await;
        let finished = ipc_runtime.finish_read(request.request_id);
        let snapshot = result?;
        finished.map_err(ChatIpcError::v5)?;
        let next_cursor = snapshot
            .history
            .next_before_ordinal
            .map(|before| {
                ipc_runtime.issue_cursor(
                    request.context_id,
                    CursorValue::History {
                        session_id: request.payload.session_id,
                        before,
                    },
                    now,
                )
            })
            .transpose()
            .map_err(ChatIpcError::v5)?;
        let data = history_dto_v5(
            snapshot.history,
            next_cursor,
            snapshot.message_content_blocks,
            snapshot.artifacts,
            snapshot.feat134,
        )
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v5())?;
        enforce_response_limit(&data, MAX_HISTORY_PAGE_BYTES, request.request_id)
            .map_err(ChatIpcError::v5)?;
        return serde_json::to_value(CommandResponse::new_v5(request.request_id, data))
            .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)).v5());
    }
    if request_schema_version(&request) == Some(CHAT_IPC_V4_SCHEMA_VERSION) {
        let request: CommandRequest<SessionReadPayload> = decode_request_v4(request)?;
        if !chat_runtime.feat134_streaming_enabled() {
            return Err(ChatIpcError::request_invalid(Some(request.request_id)).v4());
        }
        let now =
            unix_seconds().map_err(|error| map_chat_error(error, Some(request.request_id)).v4())?;
        let before = ipc_runtime
            .resolve_history_cursor(
                request.context_id,
                request.payload.session_id,
                request.payload.cursor.as_deref(),
                now,
                request.request_id,
            )
            .map_err(ChatIpcError::v4)?;
        let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id)
            .await
            .map_err(ChatIpcError::v4)?;
        authorize(
            &manager,
            request.context_id,
            ChatAction::ReadSessions,
            request.request_id,
        )
        .map_err(ChatIpcError::v4)?;
        ipc_runtime
            .begin_read(request.request_id)
            .map_err(ChatIpcError::v4)?;
        let result = load_bounded_feat134_history_snapshot(
            &authorized,
            request.context_id,
            request.payload.session_id,
            before,
            request.payload.limit,
            MAX_HISTORY_PAGE_BYTES,
            request.request_id,
        )
        .await;
        let finished = ipc_runtime.finish_read(request.request_id);
        let snapshot = result?;
        finished.map_err(ChatIpcError::v4)?;
        let next_cursor = snapshot
            .history
            .next_before_ordinal
            .map(|before| {
                ipc_runtime.issue_cursor(
                    request.context_id,
                    CursorValue::History {
                        session_id: request.payload.session_id,
                        before,
                    },
                    now,
                )
            })
            .transpose()
            .map_err(ChatIpcError::v4)?;
        let data = history_dto_v4(
            snapshot.history,
            next_cursor,
            snapshot.message_content_blocks,
            snapshot.artifacts,
            snapshot.feat134,
        )
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v4())?;
        enforce_response_limit(&data, MAX_HISTORY_PAGE_BYTES, request.request_id)
            .map_err(ChatIpcError::v4)?;
        return serde_json::to_value(CommandResponse::new_v4(request.request_id, data))
            .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)).v4());
    }
    let request: CommandRequest<SessionReadPayload> = decode_request_v3(request)?;
    let now =
        unix_seconds().map_err(|error| map_chat_error(error, Some(request.request_id)).v3())?;
    let before = ipc_runtime
        .resolve_history_cursor(
            request.context_id,
            request.payload.session_id,
            request.payload.cursor.as_deref(),
            now,
            request.request_id,
        )
        .map_err(ChatIpcError::v3)?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id)
        .await
        .map_err(ChatIpcError::v3)?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadSessions,
        request.request_id,
    )
    .map_err(ChatIpcError::v3)?;
    ipc_runtime
        .begin_read(request.request_id)
        .map_err(ChatIpcError::v3)?;
    let result = authorized
        .load_history(
            request.context_id,
            request.payload.session_id,
            before,
            request.payload.limit,
        )
        .await;
    let finished = ipc_runtime.finish_read(request.request_id);
    let page = result.map_err(|error| map_chat_error(error, Some(request.request_id)).v3())?;
    finished.map_err(ChatIpcError::v3)?;
    let next_cursor = page
        .next_before_ordinal
        .map(|before| {
            ipc_runtime.issue_cursor(
                request.context_id,
                CursorValue::History {
                    session_id: request.payload.session_id,
                    before,
                },
                now,
            )
        })
        .transpose()
        .map_err(ChatIpcError::v3)?;
    let message_ids = history_message_ids(&page);
    let turn_ids = page.turns.iter().map(|turn| turn.turn_id).collect();
    let projections = authorized
        .load_message_content_blocks(request.context_id, message_ids)
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v3())?;
    let artifacts = authorized
        .load_artifacts_for_turns(request.context_id, turn_ids)
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v3())?;
    let data = history_dto_v3(page, next_cursor, projections, artifacts)
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v3())?;
    enforce_response_limit(&data, MAX_HISTORY_PAGE_BYTES, request.request_id)
        .map_err(ChatIpcError::v3)?;
    serde_json::to_value(CommandResponse::new_v3(request.request_id, data))
        .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)).v3())
}

#[tauri::command]
pub async fn chat_load_reasoning_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<Vec<ReasoningItemDto>>, ChatIpcError> {
    let request: CommandRequest<ReasoningPayload> = decode_request(request)?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadSessions,
        request.request_id,
    )?;
    ipc_runtime.begin_read(request.request_id)?;
    let result = authorized
        .load_reasoning(request.context_id, request.payload.turn_id)
        .await;
    let finished = ipc_runtime.finish_read(request.request_id);
    let items = result.map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    finished?;
    let data = reasoning_dto(items);
    enforce_response_limit(&data, MAX_REASONING_BYTES, request.request_id)?;
    Ok(CommandResponse::new(request.request_id, data))
}

#[tauri::command]
pub async fn chat_rename_session_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
) -> Result<CommandResponse<OperationDto>, ChatIpcError> {
    let request: CommandRequest<RenameSessionPayload> = decode_request(request)?;
    validate_operation(request.payload.operation_id, request.request_id)?;
    validate_title(&request.payload.title, request.request_id)?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::RenameSession,
        request.request_id,
    )?;
    authorized
        .rename_session(
            request.context_id,
            request.payload.session_id,
            request.payload.title,
        )
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    Ok(CommandResponse::new(
        request.request_id,
        OperationDto {
            operation_id: request.payload.operation_id.to_string(),
        },
    ))
}

#[tauri::command]
pub async fn chat_set_session_pinned_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
) -> Result<CommandResponse<OperationDto>, ChatIpcError> {
    let request: CommandRequest<SetSessionPinnedPayload> = decode_request(request)?;
    validate_operation(request.payload.operation_id, request.request_id)?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::PinSession,
        request.request_id,
    )?;
    authorized
        .set_session_pinned(
            request.context_id,
            request.payload.session_id,
            request.payload.pinned,
        )
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    Ok(CommandResponse::new(
        request.request_id,
        OperationDto {
            operation_id: request.payload.operation_id.to_string(),
        },
    ))
}

#[tauri::command]
pub async fn chat_interrupt_turn_v1(
    request: Value,
    app: AppHandle,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<CreatedSessionDto>, ChatIpcError> {
    let request: CommandRequest<SessionOperationPayload> = decode_request(request)?;
    validate_operation(request.payload.operation_id, request.request_id)?;
    let (application, authorized, manager) =
        applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::InterruptTurn,
        request.request_id,
    )?;
    let turn_id = authorized
        .interrupt_turn(
            request.context_id,
            request.payload.session_id,
            request.payload.operation_id,
        )
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    ipc_runtime
        .ensure_coordinator(app, application, manager)
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    Ok(CommandResponse::new(
        request.request_id,
        CreatedSessionDto {
            session_id: request.payload.session_id.to_string(),
            turn_id: turn_id.to_string(),
            operation_id: request.payload.operation_id.to_string(),
        },
    ))
}

#[tauri::command]
pub async fn chat_delete_session_v1(
    request: Value,
    app: AppHandle,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<CleanupStatusDto>, ChatIpcError> {
    let request: CommandRequest<SessionOperationPayload> = decode_request(request)?;
    validate_operation(request.payload.operation_id, request.request_id)?;
    let (application, authorized, manager) =
        applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::DeleteSession,
        request.request_id,
    )?;
    let status = authorized
        .begin_session_deletion(
            request.context_id,
            request.payload.session_id,
            request.payload.operation_id,
        )
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    ipc_runtime.inner.event_bridge.track_cleanup(
        request.context_id,
        request.payload.session_id,
        &status,
    )?;
    ipc_runtime
        .ensure_coordinator(app, application, manager)
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    Ok(CommandResponse::new(
        request.request_id,
        cleanup_dto(status),
    ))
}

#[tauri::command]
pub async fn chat_get_cleanup_status_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<Option<CleanupStatusDto>>, ChatIpcError> {
    let request: CommandRequest<CleanupStatusPayload> = decode_request(request)?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadCleanup,
        request.request_id,
    )?;
    ipc_runtime.begin_read(request.request_id)?;
    let result = authorized
        .deletion_status(request.context_id, request.payload.operation_id)
        .await;
    let finished = ipc_runtime.finish_read(request.request_id);
    let status = result.map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    finished?;
    Ok(CommandResponse::new(
        request.request_id,
        status.map(cleanup_dto),
    ))
}

#[tauri::command]
pub async fn chat_get_session_control_plane_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<ControlPlaneDto>, ChatIpcError> {
    let request: CommandRequest<SessionControlPlanePayload> = decode_request(request)?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadSessions,
        request.request_id,
    )?;
    ipc_runtime.begin_read(request.request_id)?;
    let result = authorized
        .public_task_control_plane_status(request.context_id, request.payload.session_id)
        .await;
    let finished = ipc_runtime.finish_read(request.request_id);
    let status = result.map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    finished?;
    Ok(CommandResponse::new(
        request.request_id,
        ControlPlaneDto::from_status(&status, chat_runtime.feat137_streaming_enabled()),
    ))
}

#[tauri::command]
pub async fn chat_resync_session_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<ResyncDto>, ChatIpcError> {
    let request: CommandRequest<SessionReadPayload> = decode_request(request)?;
    if request.payload.cursor.is_some() {
        return Err(ChatIpcError::request_invalid(Some(request.request_id)));
    }
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadSessions,
        request.request_id,
    )?;
    ipc_runtime.begin_read(request.request_id)?;
    let result = authorized
        .resync_session(
            request.context_id,
            request.payload.session_id,
            None,
            request.payload.limit,
        )
        .await;
    let finished = ipc_runtime.finish_read(request.request_id);
    let projection = result.map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    finished?;
    let next_cursor = projection
        .history
        .next_before_ordinal
        .map(|before| {
            ipc_runtime.issue_cursor(
                request.context_id,
                CursorValue::History {
                    session_id: request.payload.session_id,
                    before,
                },
                unix_seconds().map_err(|error| map_chat_error(error, Some(request.request_id)))?,
            )
        })
        .transpose()?;
    let cleanup = authorized
        .deletion_status_for_session(request.context_id, request.payload.session_id)
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    let data = ResyncDto {
        session: projection.session.into(),
        history: history_dto(projection.history, next_cursor),
        cleanup: cleanup.map(cleanup_dto),
    };
    enforce_response_limit(&data, MAX_RESYNC_BYTES, request.request_id)?;
    Ok(CommandResponse::new(request.request_id, data))
}

#[tauri::command]
pub async fn chat_resync_session_v2(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<Value, ChatIpcError> {
    if request_schema_version(&request) == Some(CHAT_IPC_V6_SCHEMA_VERSION) {
        let request: CommandRequest<SessionResyncV6Payload> = decode_request_v6(request)?;
        if !chat_runtime.feat137_streaming_enabled() || request.payload.cursor.is_some() {
            return Err(ChatIpcError::request_invalid(Some(request.request_id)).v6());
        }
        let (_, authorized, manager) = applications(&chat_runtime, request.request_id)
            .await
            .map_err(ChatIpcError::v6)?;
        authorize(
            &manager,
            request.context_id,
            ChatAction::ReadSessions,
            request.request_id,
        )
        .map_err(ChatIpcError::v6)?;
        if !ipc_runtime.inner.event_bridge.owns_subscription(
            request.context_id,
            request.payload.session_id,
            request.payload.subscription_id,
            CHAT_IPC_V6_SCHEMA_VERSION,
        ) {
            return Err(ChatIpcError::context_invalid(Some(request.request_id)).v6());
        }
        ipc_runtime
            .begin_read(request.request_id)
            .map_err(ChatIpcError::v6)?;
        let result = load_bounded_feat137_history_snapshot(
            &authorized,
            request.context_id,
            request.payload.session_id,
            None,
            request.payload.limit,
            MAX_V4_RESYNC_BYTES,
            request.request_id,
        )
        .await;
        let finished = ipc_runtime.finish_read(request.request_id);
        let snapshot = result?;
        finished.map_err(ChatIpcError::v6)?;
        let pending = match ipc_runtime
            .take_pending_approval_snapshot(
                request.context_id,
                request.payload.session_id,
                request.payload.subscription_id,
            )
            .map_err(ChatIpcError::v6)?
        {
            Some(snapshot) => snapshot,
            None => authorized
                .pending_approvals_v6(request.context_id, request.payload.session_id)
                .await
                .map_err(|error| map_chat_error(error, Some(request.request_id)).v6())?,
        };
        let next_cursor = snapshot
            .history
            .next_before_ordinal
            .map(|before| {
                ipc_runtime.issue_cursor(
                    request.context_id,
                    CursorValue::History {
                        session_id: request.payload.session_id,
                        before,
                    },
                    unix_seconds()
                        .map_err(|error| map_chat_error(error, Some(request.request_id)).v6())?,
                )
            })
            .transpose()
            .map_err(ChatIpcError::v6)?;
        let history = history_dto_v6(
            snapshot.history,
            next_cursor,
            snapshot.message_content_blocks,
            snapshot.artifacts,
            snapshot.feat134,
            snapshot.approvals,
        )
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v6())?;
        let cleanup = authorized
            .deletion_status_for_session(request.context_id, request.payload.session_id)
            .await
            .map_err(|error| map_chat_error(error, Some(request.request_id)).v6())?;
        let data = ResyncDtoV6 {
            session: snapshot.session.into(),
            history,
            cleanup: cleanup.map(cleanup_dto),
            pending_approval_snapshot: pending_approval_snapshot_dto(&pending),
        };
        enforce_response_limit(&data, MAX_V4_RESYNC_BYTES, request.request_id)
            .map_err(ChatIpcError::v6)?;
        return serde_json::to_value(CommandResponse::new_v6(request.request_id, data))
            .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)).v6());
    }
    if request_schema_version(&request) == Some(CHAT_IPC_V5_SCHEMA_VERSION) {
        let request: CommandRequest<SessionReadPayload> = decode_request_v5(request)?;
        if !chat_runtime.feat136_streaming_enabled() || request.payload.cursor.is_some() {
            return Err(ChatIpcError::request_invalid(Some(request.request_id)).v5());
        }
        let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id)
            .await
            .map_err(ChatIpcError::v5)?;
        authorize(
            &manager,
            request.context_id,
            ChatAction::ReadSessions,
            request.request_id,
        )
        .map_err(ChatIpcError::v5)?;
        ipc_runtime
            .begin_read(request.request_id)
            .map_err(ChatIpcError::v5)?;
        let result = load_bounded_feat136_history_snapshot(
            &authorized,
            request.context_id,
            request.payload.session_id,
            None,
            request.payload.limit,
            MAX_V4_RESYNC_BYTES,
            request.request_id,
        )
        .await;
        let finished = ipc_runtime.finish_read(request.request_id);
        let snapshot = result?;
        finished.map_err(ChatIpcError::v5)?;
        let next_cursor = snapshot
            .history
            .next_before_ordinal
            .map(|before| {
                ipc_runtime.issue_cursor(
                    request.context_id,
                    CursorValue::History {
                        session_id: request.payload.session_id,
                        before,
                    },
                    unix_seconds()
                        .map_err(|error| map_chat_error(error, Some(request.request_id)).v5())?,
                )
            })
            .transpose()
            .map_err(ChatIpcError::v5)?;
        let history = history_dto_v5(
            snapshot.history,
            next_cursor,
            snapshot.message_content_blocks,
            snapshot.artifacts,
            snapshot.feat134,
        )
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v5())?;
        let cleanup = authorized
            .deletion_status_for_session(request.context_id, request.payload.session_id)
            .await
            .map_err(|error| map_chat_error(error, Some(request.request_id)).v5())?;
        let data = ResyncDtoV5 {
            session: snapshot.session.into(),
            history,
            cleanup: cleanup.map(cleanup_dto),
        };
        enforce_response_limit(&data, MAX_V4_RESYNC_BYTES, request.request_id)
            .map_err(ChatIpcError::v5)?;
        return serde_json::to_value(CommandResponse::new_v5(request.request_id, data))
            .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)).v5());
    }
    if request_schema_version(&request) == Some(CHAT_IPC_V4_SCHEMA_VERSION) {
        let request: CommandRequest<SessionReadPayload> = decode_request_v4(request)?;
        if !chat_runtime.feat134_streaming_enabled() || request.payload.cursor.is_some() {
            return Err(ChatIpcError::request_invalid(Some(request.request_id)).v4());
        }
        let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id)
            .await
            .map_err(ChatIpcError::v4)?;
        authorize(
            &manager,
            request.context_id,
            ChatAction::ReadSessions,
            request.request_id,
        )
        .map_err(ChatIpcError::v4)?;
        ipc_runtime
            .begin_read(request.request_id)
            .map_err(ChatIpcError::v4)?;
        let result = load_bounded_feat134_history_snapshot(
            &authorized,
            request.context_id,
            request.payload.session_id,
            None,
            request.payload.limit,
            MAX_V4_RESYNC_BYTES,
            request.request_id,
        )
        .await;
        let finished = ipc_runtime.finish_read(request.request_id);
        let snapshot = result?;
        finished.map_err(ChatIpcError::v4)?;
        let next_cursor = snapshot
            .history
            .next_before_ordinal
            .map(|before| {
                ipc_runtime.issue_cursor(
                    request.context_id,
                    CursorValue::History {
                        session_id: request.payload.session_id,
                        before,
                    },
                    unix_seconds()
                        .map_err(|error| map_chat_error(error, Some(request.request_id)).v4())?,
                )
            })
            .transpose()
            .map_err(ChatIpcError::v4)?;
        let history = history_dto_v4(
            snapshot.history,
            next_cursor,
            snapshot.message_content_blocks,
            snapshot.artifacts,
            snapshot.feat134,
        )
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v4())?;
        let cleanup = authorized
            .deletion_status_for_session(request.context_id, request.payload.session_id)
            .await
            .map_err(|error| map_chat_error(error, Some(request.request_id)).v4())?;
        let data = ResyncDtoV4 {
            session: snapshot.session.into(),
            history,
            cleanup: cleanup.map(cleanup_dto),
        };
        enforce_response_limit(&data, MAX_V4_RESYNC_BYTES, request.request_id)
            .map_err(ChatIpcError::v4)?;
        return serde_json::to_value(CommandResponse::new_v4(request.request_id, data))
            .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)).v4());
    }
    let request: CommandRequest<SessionReadPayload> = decode_request_v2(request)?;
    if request.payload.cursor.is_some() {
        return Err(ChatIpcError::request_invalid(Some(request.request_id)).v2());
    }
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id)
        .await
        .map_err(ChatIpcError::v2)?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadSessions,
        request.request_id,
    )
    .map_err(ChatIpcError::v2)?;
    ipc_runtime
        .begin_read(request.request_id)
        .map_err(ChatIpcError::v2)?;
    let result = authorized
        .resync_session(
            request.context_id,
            request.payload.session_id,
            None,
            request.payload.limit,
        )
        .await;
    let finished = ipc_runtime.finish_read(request.request_id);
    let projection =
        result.map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    finished.map_err(ChatIpcError::v2)?;
    let next_cursor = projection
        .history
        .next_before_ordinal
        .map(|before| {
            ipc_runtime.issue_cursor(
                request.context_id,
                CursorValue::History {
                    session_id: request.payload.session_id,
                    before,
                },
                unix_seconds()
                    .map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?,
            )
        })
        .transpose()
        .map_err(ChatIpcError::v2)?;
    let message_ids = history_message_ids(&projection.history);
    let blocks = authorized
        .load_message_content_blocks(request.context_id, message_ids)
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    let history = history_dto_v2(projection.history, next_cursor, blocks)
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    let cleanup = authorized
        .deletion_status_for_session(request.context_id, request.payload.session_id)
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)).v2())?;
    let data = ResyncDtoV2 {
        session: projection.session.into(),
        history,
        cleanup: cleanup.map(cleanup_dto),
    };
    enforce_response_limit(&data, MAX_RESYNC_BYTES, request.request_id)
        .map_err(ChatIpcError::v2)?;
    serde_json::to_value(CommandResponse::new_v2(request.request_id, data))
        .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)).v2())
}

#[tauri::command]
pub async fn chat_decide_approval_v6(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
) -> Result<Value, ChatIpcError> {
    let request: CommandRequest<DecideApprovalV6Payload> = decode_request_v6(request)?;
    if !chat_runtime.feat134_streaming_enabled()
        || !chat_runtime.feat136_streaming_enabled()
        || !chat_runtime.feat137_streaming_enabled()
        || request.payload.session_id.is_nil()
        || request.payload.turn_id.is_nil()
        || request.payload.approval_request_id.is_nil()
        || request.payload.item_id.is_empty()
        || request.payload.item_id.chars().count() > 256
        || request.payload.item_id.len() > 1024
        || request.payload.item_id.contains(['\r', '\n', '\0'])
    {
        return Err(ChatIpcError::request_invalid(Some(request.request_id)).v6());
    }
    let (_, authorized, manager) = applications(&chat_runtime, request.request_id)
        .await
        .map_err(ChatIpcError::v6)?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::SubmitTurn,
        request.request_id,
    )
    .map_err(ChatIpcError::v6)?;
    let result = authorized
        .decide_approval_v6(
            request.context_id,
            request.payload.session_id,
            request.payload.turn_id,
            &request.payload.item_id,
            request.payload.approval_request_id,
            request.payload.decision,
        )
        .await
        .map_err(|failure| {
            ChatIpcError::approval_reconciliation_required(request.request_id, failure.issue()).v6()
        })?;
    let data = json!({
        "schemaVersion": CHAT_IPC_V6_SCHEMA_VERSION,
        "approvalRequestId": result.approval_request_id.to_string(),
        "decisionId": result.decision_id.to_string(),
        "streamId": result.stream_id.to_string(),
        "revision": 2,
        "decision": result.decision.as_str(),
        "outcome": result.outcome.as_str(),
        "resolvedAt": result.resolved_at,
    });
    serde_json::to_value(CommandResponse::new_v6(request.request_id, data)).map_err(|_| {
        ChatIpcError::approval_reconciliation_required(
            request.request_id,
            ApprovalIssue::InternalError,
        )
        .v6()
    })
}

#[tauri::command]
pub async fn chat_subscribe_session_v1(
    request: Value,
    app: AppHandle,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<Value, ChatIpcError> {
    if request_schema_version(&request) == Some(CHAT_IPC_V6_SCHEMA_VERSION) {
        let request: CommandRequest<SubscribePayload> = decode_request_v6(request)?;
        if !chat_runtime.feat137_streaming_enabled() {
            return Err(ChatIpcError::request_invalid(Some(request.request_id)).v6());
        }
        let (application, authorized, manager) = applications(&chat_runtime, request.request_id)
            .await
            .map_err(ChatIpcError::v6)?;
        authorize(
            &manager,
            request.context_id,
            ChatAction::ReadSessions,
            request.request_id,
        )
        .map_err(ChatIpcError::v6)?;
        authorized
            .resync_session(
                request.context_id,
                request.payload.session_id,
                None,
                Some(1),
            )
            .await
            .map_err(|error| map_chat_error(error, Some(request.request_id)).v6())?;
        let binding = authorized
            .public_task_control_plane_status(request.context_id, request.payload.session_id)
            .await
            .map_err(|error| map_chat_error(error, Some(request.request_id)).v6())?;
        if !binding.host_session_bound {
            return Err(ChatIpcError::temporarily_unavailable(Some(request.request_id)).v6());
        }
        ipc_runtime
            .ensure_coordinator(app, application, manager)
            .await
            .map_err(|error| map_chat_error(error, Some(request.request_id)).v6())?;
        let subscription_id = ipc_runtime
            .inner
            .event_bridge
            .subscribe(
                request.context_id,
                request.payload.session_id,
                CHAT_IPC_V6_SCHEMA_VERSION,
            )
            .map_err(ChatIpcError::v6)?;
        let pending = match authorized
            .pending_approvals_for_subscription_v6(request.context_id, request.payload.session_id)
            .await
        {
            Ok(snapshot) => snapshot,
            Err(error) => {
                ipc_runtime
                    .inner
                    .event_bridge
                    .unsubscribe(request.context_id, subscription_id);
                return Err(map_chat_error(error, Some(request.request_id)).v6());
            }
        };
        if let Err(error) = ipc_runtime.cache_pending_approval_snapshot(
            request.context_id,
            request.payload.session_id,
            subscription_id,
            pending.clone(),
        ) {
            ipc_runtime
                .inner
                .event_bridge
                .unsubscribe(request.context_id, subscription_id);
            return Err(error.v6());
        }
        return serde_json::to_value(CommandResponse::new_v6(
            request.request_id,
            SubscriptionDtoV6 {
                subscription_id: subscription_id.to_string(),
                pending_approval_snapshot: pending_approval_snapshot_dto(&pending),
            },
        ))
        .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)).v6());
    }
    if request_schema_version(&request) == Some(CHAT_IPC_V5_SCHEMA_VERSION) {
        let request: CommandRequest<SubscribePayload> = decode_request_v5(request)?;
        if !chat_runtime.feat136_streaming_enabled() {
            return Err(ChatIpcError::request_invalid(Some(request.request_id)).v5());
        }
        let (application, authorized, manager) = applications(&chat_runtime, request.request_id)
            .await
            .map_err(ChatIpcError::v5)?;
        authorize(
            &manager,
            request.context_id,
            ChatAction::ReadSessions,
            request.request_id,
        )
        .map_err(ChatIpcError::v5)?;
        authorized
            .resync_session(
                request.context_id,
                request.payload.session_id,
                None,
                Some(1),
            )
            .await
            .map_err(|error| map_chat_error(error, Some(request.request_id)).v5())?;
        ipc_runtime
            .ensure_coordinator(app, application, manager)
            .await
            .map_err(|error| map_chat_error(error, Some(request.request_id)).v5())?;
        let subscription_id = ipc_runtime
            .inner
            .event_bridge
            .subscribe(
                request.context_id,
                request.payload.session_id,
                CHAT_IPC_V5_SCHEMA_VERSION,
            )
            .map_err(ChatIpcError::v5)?;
        return serde_json::to_value(CommandResponse::new_v5(
            request.request_id,
            SubscriptionDto {
                subscription_id: subscription_id.to_string(),
            },
        ))
        .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)).v5());
    }
    if request_schema_version(&request) == Some(CHAT_IPC_V4_SCHEMA_VERSION) {
        let request: CommandRequest<SubscribePayload> = decode_request_v4(request)?;
        if !chat_runtime.feat134_streaming_enabled() {
            return Err(ChatIpcError::request_invalid(Some(request.request_id)).v4());
        }
        let (application, authorized, manager) = applications(&chat_runtime, request.request_id)
            .await
            .map_err(ChatIpcError::v4)?;
        authorize(
            &manager,
            request.context_id,
            ChatAction::ReadSessions,
            request.request_id,
        )
        .map_err(ChatIpcError::v4)?;
        authorized
            .resync_session(
                request.context_id,
                request.payload.session_id,
                None,
                Some(1),
            )
            .await
            .map_err(|error| map_chat_error(error, Some(request.request_id)).v4())?;
        ipc_runtime
            .ensure_coordinator(app, application, manager)
            .await
            .map_err(|error| map_chat_error(error, Some(request.request_id)).v4())?;
        let subscription_id = ipc_runtime
            .inner
            .event_bridge
            .subscribe(
                request.context_id,
                request.payload.session_id,
                CHAT_IPC_V4_SCHEMA_VERSION,
            )
            .map_err(ChatIpcError::v4)?;
        return serde_json::to_value(CommandResponse::new_v4(
            request.request_id,
            SubscriptionDto {
                subscription_id: subscription_id.to_string(),
            },
        ))
        .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)).v4());
    }
    let request: CommandRequest<SubscribePayload> = decode_request(request)?;
    let (application, authorized, manager) =
        applications(&chat_runtime, request.request_id).await?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadSessions,
        request.request_id,
    )?;
    authorized
        .resync_session(
            request.context_id,
            request.payload.session_id,
            None,
            Some(1),
        )
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    ipc_runtime
        .ensure_coordinator(app, application, manager)
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    let subscription_id = ipc_runtime.inner.event_bridge.subscribe(
        request.context_id,
        request.payload.session_id,
        CHAT_IPC_SCHEMA_VERSION,
    )?;
    serde_json::to_value(CommandResponse::new(
        request.request_id,
        SubscriptionDto {
            subscription_id: subscription_id.to_string(),
        },
    ))
    .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)))
}

#[tauri::command]
pub async fn chat_unsubscribe_session_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<CancelledDto>, ChatIpcError> {
    let request: CommandRequest<UnsubscribePayload> = decode_request(request)?;
    let manager = chat_runtime
        .authorization_manager()
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    let now = unix_seconds().map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    match manager.authorize_detailed(request.context_id, ChatAction::ReadSessions, now) {
        Ok(()) => {}
        Err(AuthorizationFailure::ContextInvalid) => {
            // Normal expiry/rebind cleanup is allowed only for the exact opaque
            // context/subscription ownership pair and never changes authorization.
            ipc_runtime
                .inner
                .event_bridge
                .unsubscribe(request.context_id, request.payload.subscription_id);
            ipc_runtime.discard_pending_approval_snapshot(
                request.context_id,
                request.payload.subscription_id,
            );
            return Err(ChatIpcError::context_invalid(Some(request.request_id)));
        }
        Err(AuthorizationFailure::CapabilityDenied) => {
            return Err(ChatIpcError::capability_denied(Some(request.request_id)));
        }
    }
    let cancelled = ipc_runtime
        .inner
        .event_bridge
        .unsubscribe(request.context_id, request.payload.subscription_id);
    ipc_runtime
        .discard_pending_approval_snapshot(request.context_id, request.payload.subscription_id);
    Ok(CommandResponse::new(
        request.request_id,
        CancelledDto { cancelled },
    ))
}

#[tauri::command]
pub async fn chat_cancel_request_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<CancelledDto>, ChatIpcError> {
    let request: CommandRequest<CancelPayload> = decode_request(request)?;
    let manager = chat_runtime
        .authorization_manager()
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadSessions,
        request.request_id,
    )?;
    let cancelled = ipc_runtime.cancel_read(request.payload.target_request_id)?;
    Ok(CommandResponse::new(
        request.request_id,
        CancelledDto { cancelled },
    ))
}
