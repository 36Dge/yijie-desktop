use super::application::{
    AuthorizedConversationApplication, ConversationApplication, ConversationCoordinator,
    CoordinatorOutcome, DispatchOutcome, LiveTurnProjection, TurnProjectionSink,
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
    HistoryPage, MessageContentBlockProjection, ProjectSummary, PublicTaskBindingState,
    PublicTaskControlPlaneStatus, ReasoningItem, ReasoningStatus, SessionPage, SessionPageCursor,
    SessionSummary, SessionTitleSource,
};
use super::{ChatError, ChatRuntime};
use crate::native_auth::{NativeAuthRuntime, NativeProjectionError};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fmt::{Debug, Formatter};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use uuid::Uuid;

pub const CHAT_IPC_SCHEMA_VERSION: u8 = 1;
pub const CHAT_IPC_V2_SCHEMA_VERSION: u8 = 2;
pub const CHAT_IPC_V3_SCHEMA_VERSION: u8 = 3;
pub const CHAT_EVENT_CHANNEL: &str = "yijie:chat:event:v1";
pub const CHAT_CONTROL_PLANE_EVENT_CHANNEL: &str = "yijie:chat:control-plane:event:v1";
pub const CHAT_ATTACHMENT_IMPORT_EVENT_CHANNEL: &str = "yijie:chat:attachment-import:event:v2";
const MAX_REQUEST_BYTES: usize = 128 * 1024;
const MAX_INPUT_BYTES: usize = 64 * 1024;
const MAX_TITLE_BYTES: usize = 1024;
const MAX_SESSION_PAGE_BYTES: usize = 512 * 1024;
const MAX_HISTORY_PAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_REASONING_BYTES: usize = 256 * 1024;
const MAX_RESYNC_BYTES: usize = 1280 * 1024;
const CURSOR_LIFETIME_SECONDS: i64 = 10 * 60;
const MAX_CURSOR_RECORDS: usize = 512;
const MAX_SUBSCRIPTIONS: usize = 8;
const MAX_EVENT_BATCH: usize = 64;
const MAX_EVENT_BATCH_BYTES: usize = 256 * 1024;
const MAX_ASSISTANT_APPEND_BYTES: usize = 64 * 1024;
const MAX_REASONING_APPEND_BYTES: usize = 16 * 1024;

#[derive(Clone)]
pub struct ChatIpcRuntime {
    inner: Arc<ChatIpcInner>,
}

struct ChatIpcInner {
    process_epoch: Uuid,
    cursors: StdMutex<HashMap<String, CursorRecord>>,
    reads: StdMutex<HashMap<Uuid, bool>>,
    event_bridge: ChatEventBridge,
    coordinator: Mutex<Option<ConversationCoordinator>>,
    bind_generation: AtomicU64,
    bind_gate: Mutex<()>,
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

impl ChatIpcRuntime {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(ChatIpcInner {
                process_epoch: Uuid::now_v7(),
                cursors: StdMutex::new(HashMap::new()),
                reads: StdMutex::new(HashMap::new()),
                event_bridge: ChatEventBridge::new(),
                coordinator: Mutex::new(None),
                bind_generation: AtomicU64::new(0),
                bind_gate: Mutex::new(()),
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

    async fn ensure_coordinator(
        &self,
        app: AppHandle,
        application: ConversationApplication,
        authorization: ChatAuthorizationManager,
    ) -> Result<(), ChatError> {
        self.inner
            .event_bridge
            .configure(app, authorization)
            .map_err(|_| ChatError::OrchestrationUnavailable)?;
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

    pub fn invalidate_all(&self) {
        self.inner.event_bridge.invalidate_all();
        if let Ok(mut cursors) = self.inner.cursors.lock() {
            cursors.clear();
        }
        if let Ok(mut reads) = self.inner.reads.lock() {
            reads.clear();
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
    subscriptions: HashMap<Uuid, SubscriptionRecord>,
    cleanup_sessions: HashMap<Uuid, Uuid>,
    control_plane_sequence: u64,
}

struct SubscriptionRecord {
    context_id: Uuid,
    session_id: Uuid,
    projection_sequence: u64,
    assistant_text: String,
    reasoning: HashMap<(usize, usize), String>,
    terminal: bool,
    blocked: bool,
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
                subscriptions: HashMap::new(),
                cleanup_sessions: HashMap::new(),
                control_plane_sequence: 0,
            })),
        }
    }

    fn configure(&self, app: AppHandle, authorization: ChatAuthorizationManager) -> Result<(), ()> {
        let mut state = self.inner.lock().map_err(|_| ())?;
        state.app = Some(app);
        state.authorization = Some(authorization);
        Ok(())
    }

    fn subscribe(&self, context_id: Uuid, session_id: Uuid) -> Result<Uuid, ChatIpcError> {
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
                context_id,
                session_id,
                projection_sequence: 0,
                assistant_text: String::new(),
                reasoning: HashMap::new(),
                terminal: false,
                blocked: false,
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

    fn invalidate_all(&self) {
        let (app, events) = match self.inner.lock() {
            Ok(mut state) => {
                let app = state.app.clone();
                let events = state
                    .subscriptions
                    .drain()
                    .map(|(subscription_id, mut record)| {
                        record.projection_sequence += 1;
                        event_envelope(
                            subscription_id,
                            &record,
                            None,
                            "context_invalidated",
                            json!({"reason":"authority_changed"}),
                        )
                    })
                    .collect::<Vec<_>>();
                state.cleanup_sessions.clear();
                (app, events)
            }
            Err(_) => return,
        };
        if let Some(app) = app {
            for event in events {
                let _ = app.emit(CHAT_EVENT_CHANNEL, event);
            }
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
                if record.context_id == context_id && record.session_id == session_id {
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
            let authorized = state.subscriptions.values().any(|record| {
                record.session_id == projection.session_id
                    && authorization
                        .authorize_detailed(record.context_id, ChatAction::ReadSessions, now)
                        .is_ok()
            });
            if !authorized {
                return Ok(());
            }
            state.control_plane_sequence = state
                .control_plane_sequence
                .checked_add(1)
                .ok_or(ChatError::OrchestrationUnavailable)?;
            (
                app,
                ControlPlaneEventDto::from_status(state.control_plane_sequence, projection),
            )
        };
        app.emit(CHAT_CONTROL_PLANE_EVENT_CHANNEL, event)
            .map_err(|_| ChatError::OrchestrationUnavailable)
    }
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
                    (record.session_id == projection.session_id).then_some(*id)
                })
                .collect::<Vec<_>>();
            for subscription_id in subscription_ids {
                let Some(record) = state.subscriptions.get_mut(&subscription_id) else {
                    continue;
                };
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

    fn publish_coordinator(&self, outcome: &CoordinatorOutcome) -> Result<(), ChatError> {
        if let CoordinatorOutcome::Dispatched(DispatchOutcome::ControlPlaneChanged(status)) =
            outcome
        {
            return self.publish_control_plane(status);
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
                if record.session_id == session_id {
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
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatEventEnvelope {
    schema_version: u8,
    subscription_id: String,
    context_id: String,
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    turn_id: Option<String>,
    projection_sequence: String,
    event_id: String,
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
        schema_version: CHAT_IPC_SCHEMA_VERSION,
        subscription_id: subscription_id.to_string(),
        context_id: record.context_id.to_string(),
        session_id: record.session_id.to_string(),
        turn_id: turn_id.map(|id| id.to_string()),
        projection_sequence: record.projection_sequence.to_string(),
        event_id: Uuid::now_v7().to_string(),
        kind,
        payload,
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

    fn v2(mut self) -> Self {
        self.schema_version = CHAT_IPC_V2_SCHEMA_VERSION;
        self
    }

    fn v3(mut self) -> Self {
        self.schema_version = CHAT_IPC_V3_SCHEMA_VERSION;
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
    fn from_status(status: &PublicTaskControlPlaneStatus) -> Self {
        let projected_state = match status.state {
            PublicTaskBindingState::Pending | PublicTaskBindingState::Inflight => "pending",
            PublicTaskBindingState::Bound => "bound",
            PublicTaskBindingState::BlockedAuth => "blocked_auth",
            PublicTaskBindingState::RetryWait => "retry_wait",
            PublicTaskBindingState::Denied => "denied",
            PublicTaskBindingState::Failed => "failed",
        };
        let (retryable, recovery) = match status.state {
            PublicTaskBindingState::Pending | PublicTaskBindingState::Bound => (false, "none"),
            PublicTaskBindingState::Inflight | PublicTaskBindingState::RetryWait => (true, "retry"),
            PublicTaskBindingState::BlockedAuth => (false, "sign_in"),
            PublicTaskBindingState::Denied => (false, "none"),
            PublicTaskBindingState::Failed => (false, "resync"),
        };
        Self {
            session_id: status.session_id.to_string(),
            state: projected_state,
            issue_code: status.issue_code.clone(),
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
    fn from_status(sequence: u64, status: &PublicTaskControlPlaneStatus) -> Self {
        let projection = ControlPlaneDto::from_status(status);
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
        ChatError::NotFound => {
            ChatIpcError::new(request_id, "chat_resource_not_found", false, "reload")
        }
        ChatError::ProjectUnavailable | ChatError::NativePickerUnavailable => ChatIpcError::new(
            request_id,
            "chat_project_invalid",
            false,
            "reselect_project",
        ),
        ChatError::ConversationConflict => ChatIpcError::conflict(request_id),
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
    chat_runtime: State<'_, ChatRuntime>,
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
    Ok(CommandResponse::new(
        request.request_id,
        chat_runtime.request_local_recovery().await,
    ))
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
    use crate::chat::{LiveReasoningProjection, ReasoningPart};

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
        };
        let control_response: Value = serde_json::from_str(include_str!(
            "../../fixtures/chat-ipc-v1/control-plane-response.json"
        ))
        .unwrap();
        assert_eq!(
            serde_json::to_value(CommandResponse::new(
                request_id,
                ControlPlaneDto::from_status(&control_status),
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
                },
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
            context_id: Uuid::parse_str("019c1a00-0000-7000-8000-000000000003").unwrap(),
            session_id: Uuid::parse_str(session_id).unwrap(),
            projection_sequence: 0,
            assistant_text: String::new(),
            reasoning: HashMap::new(),
            terminal: false,
            blocked: false,
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
            context_id,
            session_id,
            projection_sequence: 0,
            assistant_text: String::new(),
            reasoning: HashMap::new(),
            terminal: false,
            blocked: false,
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

#[tauri::command]
pub async fn chat_bind_context_v1(
    request: Value,
    app: AppHandle,
    auth_runtime: State<'_, NativeAuthRuntime>,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
    artifact_native_runtime: State<'_, super::artifact_native::ArtifactNativeRuntime>,
) -> Result<CommandResponse<BoundContextDto>, ChatIpcError> {
    let request = decode_bind_request(request)?;
    let bind_generation = ipc_runtime.begin_binding();
    let now = unix_seconds().map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    let native = auth_runtime
        .chat_projection(&request.payload.tenant_selector, now)
        .await
        .map_err(|error| map_native_projection_error(error, request.request_id))?;
    let native_authorization_revision = native.authorization_revision;
    let native_can_create_task = native
        .capabilities
        .iter()
        .any(|capability| capability == "task.create");
    let manager = chat_runtime
        .authorization_manager()
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
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
    let context = manager
        .bind(projection, now)
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    artifact_native_runtime.invalidate_all();
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
        .configure(app.clone(), manager.clone())
        .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)))?;
    ipc_runtime.invalidate_all();
    if let Ok(application) = chat_runtime.local_conversation_application().await {
        ipc_runtime
            .ensure_coordinator(app, application, manager.clone())
            .await
            .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    }
    let allowed_actions = manager
        .allowed_actions(context.context_id, now)
        .map_err(|failure| match failure {
            AuthorizationFailure::ContextInvalid => {
                ChatIpcError::context_invalid(Some(request.request_id))
            }
            AuthorizationFailure::CapabilityDenied => {
                ChatIpcError::capability_denied(Some(request.request_id))
            }
        })?;
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
) -> Result<CommandResponse<HistoryPageDtoV3>, ChatIpcError> {
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
    Ok(CommandResponse::new_v3(request.request_id, data))
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
        ControlPlaneDto::from_status(&status),
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
) -> Result<CommandResponse<ResyncDtoV2>, ChatIpcError> {
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
    Ok(CommandResponse::new_v2(request.request_id, data))
}

#[tauri::command]
pub async fn chat_subscribe_session_v1(
    request: Value,
    app: AppHandle,
    chat_runtime: State<'_, ChatRuntime>,
    ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<CommandResponse<SubscriptionDto>, ChatIpcError> {
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
    let subscription_id = ipc_runtime
        .inner
        .event_bridge
        .subscribe(request.context_id, request.payload.session_id)?;
    Ok(CommandResponse::new(
        request.request_id,
        SubscriptionDto {
            subscription_id: subscription_id.to_string(),
        },
    ))
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
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadSessions,
        request.request_id,
    )?;
    let cancelled = ipc_runtime
        .inner
        .event_bridge
        .unsubscribe(request.context_id, request.payload.subscription_id);
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
