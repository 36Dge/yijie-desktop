use super::attachment::{PreparedAttachment, MAX_ATTACHMENTS_PER_MESSAGE, MAX_FILE_CONTEXT_BYTES};
use super::error::{map_sqlite_error, ChatError};
use super::keychain::{DatabaseKey, ReceiptKey};
use super::migrations;
use base64::Engine;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
#[cfg(feature = "feat126-s10-driver")]
use std::sync::{Arc, Barrier};
#[cfg(feature = "feat126-s10-driver")]
use std::thread;
#[cfg(feature = "feat126-s10-driver")]
use std::time::{Duration, Instant};
use std::time::{SystemTime, UNIX_EPOCH};
use unicode_segmentation::UnicodeSegmentation;
use uuid::Uuid;

const DATABASE_FILE_NAME: &str = "conversations.db";
const MAX_REASONING_PART_BYTES: usize = 64 * 1024;
const MAX_REASONING_ITEM_BYTES: usize = 128 * 1024;
const MAX_REASONING_TURN_BYTES: usize = 256 * 1024;
const MAX_REASONING_ITEMS: usize = 8;
const MAX_REASONING_PARTS: usize = 8;
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const DEFAULT_PAGE_SIZE: usize = 20;
const MAX_PAGE_SIZE: usize = 50;
const OUTBOX_MAX_ATTEMPTS: i64 = 16;
const OUTBOX_PAYLOAD_VERSION: i64 = 1;
const DELETION_RECEIPT_TTL_SECONDS: i64 = 30 * 24 * 60 * 60;
#[cfg(feature = "feat126-s10-driver")]
const R8_SESSION_COUNT: u64 = 10_000;
#[cfg(feature = "feat126-s10-driver")]
const R8_TURN_COUNT: u64 = 500_000;
#[cfg(feature = "feat126-s10-driver")]
const R8_MESSAGE_COUNT: u64 = 1_000_000;
#[cfg(feature = "feat126-s10-driver")]
const R8_IDEMPOTENCY_PAIR_COUNT: u64 = 10_000;
#[cfg(feature = "feat126-s10-driver")]
const R8_IDEMPOTENCY_RETRY_TIMEOUT: Duration = Duration::from_secs(90);
#[cfg(feature = "feat126-s10-driver")]
const R8_IDEMPOTENCY_RETRY_DELAY: Duration = Duration::from_micros(100);

#[derive(Clone)]
pub struct ChatScope {
    pub(super) owner_user_id: String,
    pub(super) tenant_id: String,
}

impl ChatScope {
    pub fn new(owner_user_id: String, tenant_id: String) -> Result<Self, ChatError> {
        validate_uuid(&owner_user_id)?;
        validate_uuid(&tenant_id)?;
        Ok(Self {
            owner_user_id,
            tenant_id,
        })
    }

    pub(crate) fn tenant_uuid(&self) -> Result<Uuid, ChatError> {
        parse_uuid_value(&self.tenant_id)
    }

    pub(crate) fn owner_uuid(&self) -> Result<Uuid, ChatError> {
        parse_uuid_value(&self.owner_user_id)
    }
}

#[derive(Clone, Serialize, PartialEq, Eq)]
pub struct ProjectSummary {
    pub id: String,
    pub safe_name: String,
    pub pinned_at: Option<i64>,
    pub last_used_at: i64,
    pub available: bool,
}

impl std::fmt::Debug for ProjectSummary {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProjectSummary")
            .field("id", &self.id)
            .field("safe_name", &"[PROJECT_NAME]")
            .field("pinned_at", &self.pinned_at)
            .field("last_used_at", &self.last_used_at)
            .field("available", &self.available)
            .finish()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionTitleSource {
    Fallback,
    Model,
    User,
}

impl SessionTitleSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Fallback => "fallback",
            Self::Model => "model",
            Self::User => "user",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutboxKind {
    CreateSession,
    StartTurn,
    InterruptTurn,
    GenerateTitle,
    DeleteSession,
}

impl OutboxKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::CreateSession => "create_session",
            Self::StartTurn => "start_turn",
            Self::InterruptTurn => "interrupt_turn",
            Self::GenerateTitle => "generate_title",
            Self::DeleteSession => "delete_session",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutboxState {
    Pending,
    Inflight,
    Done,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PublicTaskBindingState {
    Pending,
    Inflight,
    Bound,
    BlockedAuth,
    RetryWait,
    Denied,
    Failed,
}

impl PublicTaskBindingState {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Inflight => "inflight",
            Self::Bound => "bound",
            Self::BlockedAuth => "blocked_auth",
            Self::RetryWait => "retry_wait",
            Self::Denied => "denied",
            Self::Failed => "failed",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublicTaskControlPlaneStatus {
    pub session_id: Uuid,
    pub state: PublicTaskBindingState,
    pub issue_code: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingConversation {
    pub session_id: Uuid,
    pub task_id: Uuid,
    pub turn_id: Uuid,
    pub create_operation_id: Uuid,
    pub turn_operation_id: Uuid,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaimedOutbox {
    pub operation_id: Uuid,
    pub session_id: Uuid,
    pub kind: OutboxKind,
    pub attempt_count: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreateSessionDispatch {
    pub operation_id: Uuid,
    pub session_id: Uuid,
    pub project_id: Uuid,
    pub client_reference_id: Uuid,
    pub public_task_id: Option<Uuid>,
    pub authorization_revision: u64,
}

#[derive(Clone, PartialEq, Eq)]
pub struct StartTurnDispatch {
    pub operation_id: Uuid,
    pub session_id: Uuid,
    pub turn_id: Uuid,
    pub agent_session_id: Uuid,
    pub input: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DraftContentBlock {
    Text(String),
    File(Uuid),
    Image(Uuid),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DraftTarget {
    New,
    Session(Uuid),
}

impl DraftTarget {
    fn kind(&self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Session(_) => "session",
        }
    }

    fn session_id(&self) -> Option<Uuid> {
        match self {
            Self::New => None,
            Self::Session(session_id) => Some(*session_id),
        }
    }
}

#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HostTurnInputBlock {
    Text {
        text: String,
    },
    File {
        attachment_id: Uuid,
        #[serde(rename = "name")]
        safe_name: String,
        media_type: String,
        size_bytes: usize,
        sha256: String,
        context_chunks: Vec<String>,
    },
    Image {
        attachment_id: Uuid,
        media_type: String,
        size_bytes: usize,
        sha256: String,
        data_url: String,
    },
}

impl std::fmt::Debug for HostTurnInputBlock {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Text { text } => formatter
                .debug_struct("Text")
                .field("utf8_bytes", &text.len())
                .finish(),
            Self::File {
                attachment_id,
                media_type,
                size_bytes,
                context_chunks,
                ..
            } => formatter
                .debug_struct("File")
                .field("attachment_id", attachment_id)
                .field("media_type", media_type)
                .field("size_bytes", size_bytes)
                .field("context_chunk_count", &context_chunks.len())
                .field(
                    "context_utf8_bytes",
                    &context_chunks.iter().map(String::len).sum::<usize>(),
                )
                .finish(),
            Self::Image {
                attachment_id,
                media_type,
                size_bytes,
                data_url,
                ..
            } => formatter
                .debug_struct("Image")
                .field("attachment_id", attachment_id)
                .field("media_type", media_type)
                .field("size_bytes", size_bytes)
                .field("data_url_bytes", &data_url.len())
                .finish(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StartTurnDispatchV2 {
    pub operation_id: Uuid,
    pub session_id: Uuid,
    pub turn_id: Uuid,
    pub agent_session_id: Uuid,
    pub content_blocks: Vec<HostTurnInputBlock>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AttachmentSummary {
    pub attachment_id: Uuid,
    pub kind: String,
    pub safe_name: String,
    pub media_type: String,
    pub byte_size: usize,
    pub state: String,
    pub expires_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MessageContentBlockProjection {
    Text {
        ordinal: usize,
        text: String,
    },
    Attachment {
        ordinal: usize,
        attachment: AttachmentSummary,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InterruptTurnDispatch {
    pub operation_id: Uuid,
    pub session_id: Uuid,
    pub turn_id: Uuid,
    pub agent_session_id: Uuid,
    pub runtime_turn_id: Uuid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CleanupSurfaceState {
    Pending,
    Complete,
    Incomplete,
    NotAttempted,
}

impl CleanupSurfaceState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Complete => "complete",
            Self::Incomplete => "incomplete",
            Self::NotAttempted => "not_attempted",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeletionStatus {
    pub operation_id: Uuid,
    pub desktop_state: CleanupSurfaceState,
    pub host_state: CleanupSurfaceState,
    pub runtime_state: CleanupSurfaceState,
    pub outcome_code: String,
    pub last_error_code: Option<String>,
    pub requested_at: i64,
    pub completed_at: Option<i64>,
    pub expires_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaimedDeletion {
    pub operation_id: Uuid,
    pub agent_session_id: Option<Uuid>,
    pub desktop_state: CleanupSurfaceState,
    pub host_state: CleanupSurfaceState,
    pub runtime_state: CleanupSurfaceState,
    pub attempt_count: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecoverySnapshot {
    pub active_session_ids: Vec<Uuid>,
    pub deletions: Vec<DeletionStatus>,
}

#[cfg(feature = "feat126-s10-driver")]
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Feat126ResumeCandidate {
    pub task_id: Uuid,
    pub agent_session_id: Uuid,
    pub codex_thread_id: Uuid,
}

impl std::fmt::Debug for StartTurnDispatch {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("StartTurnDispatch")
            .field("operation_id", &self.operation_id)
            .field("session_id", &self.session_id)
            .field("turn_id", &self.turn_id)
            .field("agent_session_id", &self.agent_session_id)
            .field("input_utf8_bytes", &self.input.len())
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredEventCursor {
    pub stream_id: Uuid,
    pub sequence: u64,
    pub event_id: Uuid,
}

#[derive(Clone, PartialEq, Eq)]
pub struct ActiveTurnContext {
    pub session_id: Uuid,
    pub task_id: Uuid,
    pub turn_id: Uuid,
    pub turn_operation_id: Uuid,
    pub agent_session_id: Uuid,
    pub codex_thread_id: Uuid,
    pub runtime_turn_id: Uuid,
    pub assistant_text: String,
    pub cursor: Option<StoredEventCursor>,
}

impl std::fmt::Debug for ActiveTurnContext {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ActiveTurnContext")
            .field("session_id", &self.session_id)
            .field("task_id", &self.task_id)
            .field("turn_id", &self.turn_id)
            .field("turn_operation_id", &self.turn_operation_id)
            .field("agent_session_id", &self.agent_session_id)
            .field("codex_thread_id", &self.codex_thread_id)
            .field("runtime_turn_id", &self.runtime_turn_id)
            .field("assistant_utf8_bytes", &self.assistant_text.len())
            .field("cursor", &self.cursor)
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionPageCursor {
    pinned_at: Option<i64>,
    last_activity_at: i64,
    session_id: Uuid,
}

#[derive(Clone, PartialEq, Eq)]
pub struct SessionSummary {
    pub session_id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub title_source: SessionTitleSource,
    pub pinned_at: Option<i64>,
    pub last_activity_at: i64,
    pub latest_turn_status: Option<String>,
    pub project_available: bool,
}

impl std::fmt::Debug for SessionSummary {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SessionSummary")
            .field("session_id", &self.session_id)
            .field("project_id", &self.project_id)
            .field("title_utf8_bytes", &self.title.len())
            .field("title_source", &self.title_source)
            .field("pinned_at", &self.pinned_at)
            .field("last_activity_at", &self.last_activity_at)
            .field("latest_turn_status", &self.latest_turn_status)
            .field("project_available", &self.project_available)
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionPage {
    pub sessions: Vec<SessionSummary>,
    pub next_cursor: Option<SessionPageCursor>,
}

#[derive(Clone, PartialEq, Eq)]
pub struct HistoryMessage {
    pub message_id: Uuid,
    pub role: String,
    pub content: String,
    pub status: String,
    pub ordinal: u64,
    pub created_at: i64,
}

impl std::fmt::Debug for HistoryMessage {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HistoryMessage")
            .field("message_id", &self.message_id)
            .field("role", &self.role)
            .field("content_utf8_bytes", &self.content.len())
            .field("status", &self.status)
            .field("ordinal", &self.ordinal)
            .field("created_at", &self.created_at)
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HistoryReasoningMetadata {
    pub item_id: String,
    pub item_ordinal: usize,
    pub status: ReasoningStatus,
    pub reason_code: Option<String>,
    pub total_bytes: usize,
    pub part_count: usize,
    pub finalized_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HistoryTurn {
    pub turn_id: Uuid,
    pub runtime_turn_id: Option<Uuid>,
    pub status: String,
    pub terminal_at: Option<i64>,
    pub reasoning_status: String,
    pub reasoning_reason_code: Option<String>,
    pub messages: Vec<HistoryMessage>,
    pub reasoning: Vec<HistoryReasoningMetadata>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HistoryPage {
    pub turns: Vec<HistoryTurn>,
    pub next_before_ordinal: Option<u64>,
}

#[derive(Clone, PartialEq, Eq)]
pub struct TurnProgress {
    pub local_turn_id: Uuid,
    pub assistant_text: String,
    pub cursor: StoredEventCursor,
}

impl std::fmt::Debug for TurnProgress {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TurnProgress")
            .field("local_turn_id", &self.local_turn_id)
            .field("assistant_utf8_bytes", &self.assistant_text.len())
            .field("cursor", &self.cursor)
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct TerminalTurnCommit {
    pub local_turn_id: Uuid,
    pub terminal_status: String,
    pub terminal_at: i64,
    pub assistant_text: String,
    pub cursor: StoredEventCursor,
    pub reasoning_status: ReasoningStatus,
    pub reasoning_reason_code: Option<String>,
    pub reasoning_items: Vec<ReasoningItem>,
}

impl std::fmt::Debug for TerminalTurnCommit {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TerminalTurnCommit")
            .field("local_turn_id", &self.local_turn_id)
            .field("terminal_status", &self.terminal_status)
            .field("terminal_at", &self.terminal_at)
            .field("assistant_utf8_bytes", &self.assistant_text.len())
            .field("cursor", &self.cursor)
            .field("reasoning_status", &self.reasoning_status)
            .field("reasoning_reason_code", &self.reasoning_reason_code)
            .field("reasoning_item_count", &self.reasoning_items.len())
            .finish()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateSessionPayloadV1 {
    session_id: Uuid,
    task_id: Uuid,
    turn_id: Uuid,
    turn_operation_id: Uuid,
    message_id: Uuid,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StartTurnPayloadV1 {
    turn_id: Uuid,
    message_id: Uuid,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateSessionPayloadV2 {
    session_id: Uuid,
    task_id: Uuid,
    turn_id: Uuid,
    turn_operation_id: Uuid,
    message_id: Uuid,
    block_digest: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StartTurnPayloadV2 {
    turn_id: Uuid,
    message_id: Uuid,
    block_digest: String,
}

struct CreatePayloadIdentity {
    session_id: Uuid,
    task_id: Uuid,
    turn_id: Uuid,
    turn_operation_id: Uuid,
    message_id: Uuid,
    block_digest: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct InterruptTurnPayloadV1 {
    turn_id: Uuid,
    runtime_turn_id: Uuid,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct DeletionRetryIdsV1 {
    session_id: Uuid,
    agent_session_id: Option<Uuid>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TitlePayloadV1 {
    session_id: Uuid,
}

pub struct ChatRepository {
    pub(super) connection: Connection,
    pub(super) database_path: PathBuf,
    pub(super) scope: ChatScope,
    receipt_key: ReceiptKey,
    attachment_checkpoint_pending: bool,
}

#[cfg(feature = "feat126-s10-driver")]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct R8ProbeProjection {
    pub schema_version: u8,
    pub status: &'static str,
    pub metadata_p95_ms: u64,
    pub history_p95_ms: u64,
    pub reducer_observations: u64,
    pub session_count: u64,
    pub message_count: u64,
    pub idempotency_pairs: u64,
    pub duplicate_count: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReasoningStatus {
    Complete,
    Incomplete,
    Unavailable,
}

impl ReasoningStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Incomplete => "incomplete",
            Self::Unavailable => "unavailable",
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct ReasoningPart {
    pub content_index: usize,
    pub text: String,
}

impl std::fmt::Debug for ReasoningPart {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ReasoningPart")
            .field("content_index", &self.content_index)
            .field("utf8_bytes", &self.text.len())
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct ReasoningItem {
    pub item_id: String,
    pub item_ordinal: usize,
    pub status: ReasoningStatus,
    pub reason_code: Option<String>,
    pub finalized_at_ms: i64,
    pub parts: Vec<ReasoningPart>,
}

impl std::fmt::Debug for ReasoningItem {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ReasoningItem")
            .field("item_id", &self.item_id)
            .field("item_ordinal", &self.item_ordinal)
            .field("status", &self.status)
            .field("reason_code", &self.reason_code)
            .field("finalized_at_ms", &self.finalized_at_ms)
            .field("part_count", &self.parts.len())
            .finish()
    }
}

impl ChatRepository {
    pub fn database_exists(chat_directory: &Path) -> bool {
        chat_directory.join(DATABASE_FILE_NAME).exists()
    }

    pub fn deletion_identity_exists(
        chat_directory: &Path,
        key: &DatabaseKey,
    ) -> Result<bool, ChatError> {
        let database_path = chat_directory.join(DATABASE_FILE_NAME);
        if !database_path.exists() {
            return Ok(false);
        }
        validate_owner_only_file(&database_path)?;
        let connection =
            Connection::open_with_flags(&database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(map_sqlite_error)?;
        apply_raw_key(&connection, key)?;
        connection
            .query_row("SELECT count(*) FROM sqlite_schema", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let jobs_table: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema
                 WHERE type='table' AND name='chat_deletion_jobs')",
                [],
                |row| row.get(0),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if !jobs_table {
            return Ok(false);
        }
        connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM chat_deletion_jobs)
                     OR EXISTS(SELECT 1 FROM chat_deletion_receipts)",
                [],
                |row| row.get(0),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)
    }

    pub fn open(
        chat_directory: &Path,
        key: &DatabaseKey,
        receipt_key: ReceiptKey,
        scope: ChatScope,
    ) -> Result<Self, ChatError> {
        prepare_chat_directory(chat_directory)?;
        let database_path = chat_directory.join(DATABASE_FILE_NAME);
        prepare_database_file(&database_path)?;
        let mut connection = Connection::open_with_flags(
            &database_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .map_err(map_sqlite_error)?;
        apply_raw_key(&connection, key)?;
        connection
            .query_row("SELECT count(*) FROM sqlite_schema", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        configure_connection(&connection)?;
        migrations::validate_embedded_migrations()?;
        migrations::migrate(&mut connection)?;
        protect_database_files(&database_path)?;
        let mut repository = Self {
            connection,
            database_path,
            scope,
            receipt_key,
            // A prior process may have committed attachment cleanup and exited before
            // truncating WAL. Every open proves that no stale attachment frames remain.
            attachment_checkpoint_pending: true,
        };
        repository.expire_attachments_all_scopes(unix_seconds()?)?;
        repository.purge_expired_artifacts(unix_seconds()?)?;
        Ok(repository)
    }

    pub fn schema_version(&self) -> Result<i64, ChatError> {
        self.connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(map_sqlite_error)
    }

    pub fn probe_storage(&mut self) -> Result<(), ChatError> {
        let integrity: String = self
            .connection
            .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
            .map_err(map_sqlite_error)?;
        if integrity != "ok" {
            return Err(ChatError::DatabaseCorrupt);
        }
        let transaction = self.connection.transaction().map_err(map_sqlite_error)?;
        transaction
            .execute(
                "UPDATE chat_schema_migrations SET applied_at=applied_at WHERE version=1",
                [],
            )
            .map_err(map_sqlite_error)?;
        transaction.rollback().map_err(map_sqlite_error)
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub fn run_r8_probe_at(
        chat_directory: &Path,
        scope: ChatScope,
    ) -> Result<R8ProbeProjection, ChatError> {
        let result = (|| {
            let mut scale = ChatRepository::open(
                &chat_directory.join("scale"),
                &DatabaseKey::from_bytes([0x41; 32]),
                ReceiptKey::from_bytes([0x42; 32]),
                scope.clone(),
            )?;
            let mut idempotency = ChatRepository::open(
                &chat_directory.join("idempotency"),
                &DatabaseKey::from_bytes([0x43; 32]),
                ReceiptKey::from_bytes([0x44; 32]),
                scope,
            )?;
            let scale_projection = scale.run_r8_scale_probe()?;
            let duplicate_count = idempotency.run_r8_idempotency_probe()?;
            let reducer_observations = super::application::run_r8_reducer_probe()?;
            let session_count = scale
                .connection
                .query_row("SELECT count(*) FROM chat_sessions", [], |row| {
                    row.get::<_, i64>(0)
                })
                .map_err(map_sqlite_error)
                .and_then(|value| {
                    u64::try_from(value).map_err(|_| ChatError::DatabaseUnavailable)
                })?;
            let message_count = scale
                .connection
                .query_row("SELECT count(*) FROM chat_messages", [], |row| {
                    row.get::<_, i64>(0)
                })
                .map_err(map_sqlite_error)
                .and_then(|value| {
                    u64::try_from(value).map_err(|_| ChatError::DatabaseUnavailable)
                })?;
            let turn_count = scale
                .connection
                .query_row("SELECT count(*) FROM chat_turns", [], |row| {
                    row.get::<_, i64>(0)
                })
                .map_err(map_sqlite_error)
                .and_then(|value| {
                    u64::try_from(value).map_err(|_| ChatError::DatabaseUnavailable)
                })?;
            if session_count != R8_SESSION_COUNT
                || turn_count != R8_TURN_COUNT
                || message_count != R8_MESSAGE_COUNT
            {
                return Err(ChatError::DatabaseUnavailable);
            }
            drop(scale);
            drop(idempotency);
            Ok(R8ProbeProjection {
                schema_version: 1,
                status: "passed",
                metadata_p95_ms: scale_projection.0,
                history_p95_ms: scale_projection.1,
                reducer_observations,
                session_count,
                message_count,
                idempotency_pairs: R8_IDEMPOTENCY_PAIR_COUNT,
                duplicate_count,
            })
        })();
        let cleanup = if chat_directory.exists() {
            fs::remove_dir_all(chat_directory).map_err(|_| ChatError::DatabaseUnsafe)
        } else {
            Ok(())
        };
        match (result, cleanup) {
            (Ok(projection), Ok(())) => Ok(projection),
            (Err(error), _) => Err(error),
            (Ok(_), Err(error)) => Err(error),
        }
    }

    #[cfg(feature = "feat126-s10-driver")]
    fn run_r8_scale_probe(&mut self) -> Result<(u64, u64), ChatError> {
        let project_id = Uuid::from_u128(0x1000).to_string();
        let owner = self.scope.owner_user_id.clone();
        let tenant = self.scope.tenant_id.clone();
        let now = 1_i64;
        self.connection
            .execute(
                "INSERT OR IGNORE INTO chat_projects(id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at)
                 VALUES (?1, ?2, ?3, 'synthetic', ?4, ?5, ?6)",
                params![project_id, owner, tenant, "a".repeat(64), vec![1_u8], now],
            )
            .map_err(map_sqlite_error)?;
        let transaction = self.connection.transaction().map_err(map_sqlite_error)?;
        transaction
            .execute(
                "WITH RECURSIVE numbers(n) AS (
                   SELECT 0 UNION ALL SELECT n + 1 FROM numbers WHERE n < 9999
                 )
                 INSERT INTO chat_sessions(
                   id, owner_user_id, tenant_id, project_id, title, title_source,
                   title_job_status, created_at, last_activity_at
                 )
                 SELECT printf('%08x-0000-4000-8000-%012x', 1048576 + n, n), ?1, ?2, ?3,
                        'synthetic', 'fallback', 'not_started', ?4, ?4
                 FROM numbers",
                params![&owner, &tenant, &project_id, now],
            )
            .map_err(map_sqlite_error)?;
        transaction
            .execute(
                "WITH RECURSIVE
                   sessions(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM sessions WHERE n < 9999),
                   ordinals(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM ordinals WHERE n < 49)
                 INSERT INTO chat_turns(id, session_id, operation_id, status, terminal_at)
                 SELECT printf('%08x-0000-4000-8001-%012x', 2097152 + sessions.n * 50 + ordinals.n, sessions.n * 50 + ordinals.n),
                        printf('%08x-0000-4000-8000-%012x', 1048576 + sessions.n, sessions.n),
                        printf('%08x-0000-4000-8002-%012x', 4194304 + sessions.n * 50 + ordinals.n, sessions.n * 50 + ordinals.n),
                        'completed', ?1
                 FROM sessions CROSS JOIN ordinals",
                [now],
            )
            .map_err(map_sqlite_error)?;
        transaction
            .execute(
                "WITH RECURSIVE
                   sessions(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM sessions WHERE n < 9999),
                   ordinals(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM ordinals WHERE n < 49)
                 INSERT INTO chat_messages(id, session_id, turn_id, role, content, status, ordinal, created_at)
                 SELECT printf('%08x-0000-4000-8003-%012x', 3145728 + sessions.n * 100 + ordinals.n * 2, sessions.n * 100 + ordinals.n * 2),
                        printf('%08x-0000-4000-8000-%012x', 1048576 + sessions.n, sessions.n),
                        printf('%08x-0000-4000-8001-%012x', 2097152 + sessions.n * 50 + ordinals.n, sessions.n * 50 + ordinals.n),
                        'user', 'synthetic', 'committed', ordinals.n * 2, ?1
                 FROM sessions CROSS JOIN ordinals",
                [now],
            )
            .map_err(map_sqlite_error)?;
        transaction
            .execute(
                "WITH RECURSIVE
                   sessions(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM sessions WHERE n < 9999),
                   ordinals(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM ordinals WHERE n < 49)
                 INSERT INTO chat_messages(id, session_id, turn_id, role, content, status, ordinal, created_at)
                 SELECT printf('%08x-0000-4000-8004-%012x', 5242880 + sessions.n * 100 + ordinals.n * 2, sessions.n * 100 + ordinals.n * 2 + 1),
                        printf('%08x-0000-4000-8000-%012x', 1048576 + sessions.n, sessions.n),
                        printf('%08x-0000-4000-8001-%012x', 2097152 + sessions.n * 50 + ordinals.n, sessions.n * 50 + ordinals.n),
                        'assistant', 'synthetic', 'committed', ordinals.n * 2 + 1, ?1
                 FROM sessions CROSS JOIN ordinals",
                [now],
            )
            .map_err(map_sqlite_error)?;
        transaction.commit().map_err(map_sqlite_error)?;
        let mut metadata_runs = Vec::with_capacity(30);
        let mut history_runs = Vec::with_capacity(30);
        let probe_session = Uuid::parse_str("00100000-0000-4000-8000-000000000000")
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        for _ in 0..30 {
            let started = Instant::now();
            if self.list_sessions(None, Some(50))?.sessions.len() > 50 {
                return Err(ChatError::DatabaseUnavailable);
            }
            metadata_runs.push(started.elapsed());
            let started = Instant::now();
            let page = self.load_history(probe_session, None, Some(50))?;
            let message_count = page
                .turns
                .iter()
                .map(|turn| turn.messages.len())
                .sum::<usize>();
            if page.turns.len() != 50 || message_count != 100 {
                return Err(ChatError::DatabaseUnavailable);
            }
            history_runs.push(started.elapsed());
        }
        metadata_runs.sort_unstable();
        history_runs.sort_unstable();
        let p95 = |runs: &[Duration]| -> u64 {
            let index = ((runs.len() * 95).div_ceil(100)).saturating_sub(1);
            runs.get(index).copied().unwrap_or_default().as_millis() as u64
        };
        Ok((p95(&metadata_runs), p95(&history_runs)))
    }

    #[cfg(feature = "feat126-s10-driver")]
    fn run_r8_idempotency_probe(&mut self) -> Result<u64, ChatError> {
        let project_id = Uuid::from_u128(0x5000).to_string();
        let project = Uuid::from_u128(0x5000);
        let now = 1_i64;
        self.connection
            .execute(
                "INSERT OR IGNORE INTO chat_projects(id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at)
                 VALUES (?1, ?2, ?3, 'synthetic', ?4, ?5, ?6)",
                params![project_id, self.scope.owner_user_id, self.scope.tenant_id, "b".repeat(64), vec![1_u8], now],
            )
            .map_err(map_sqlite_error)?;
        let database_directory = self
            .database_path
            .parent()
            .ok_or(ChatError::DatabaseUnavailable)?
            .to_path_buf();
        let left_repository = ChatRepository::open(
            &database_directory,
            &DatabaseKey::from_bytes([0x43; 32]),
            ReceiptKey::from_bytes([0x44; 32]),
            self.scope.clone(),
        )?;
        let right_repository = ChatRepository::open(
            &database_directory,
            &DatabaseKey::from_bytes([0x43; 32]),
            ReceiptKey::from_bytes([0x44; 32]),
            self.scope.clone(),
        )?;
        let left_barrier = Arc::new(Barrier::new(3));
        let right_barrier = Arc::clone(&left_barrier);
        let start_barrier = Arc::clone(&left_barrier);
        let left = thread::spawn(move || {
            Self::run_r8_idempotency_worker(
                left_repository,
                0,
                R8_IDEMPOTENCY_PAIR_COUNT as u128,
                left_barrier,
                project,
            )
        });
        let right = thread::spawn(move || {
            Self::run_r8_idempotency_worker(
                right_repository,
                0,
                R8_IDEMPOTENCY_PAIR_COUNT as u128,
                right_barrier,
                project,
            )
        });
        start_barrier.wait();
        let left_duplicates = left.join().map_err(|_| ChatError::DatabaseUnavailable)??;
        let right_duplicates = right.join().map_err(|_| ChatError::DatabaseUnavailable)??;
        if left_duplicates != right_duplicates {
            return Err(ChatError::DatabaseUnavailable);
        }
        let created: i64 = self
            .connection
            .query_row(
                "SELECT count(*) FROM chat_sessions WHERE project_id=?1",
                [project.to_string()],
                |row| row.get(0),
            )
            .map_err(map_sqlite_error)?;
        if created != i64::try_from(R8_IDEMPOTENCY_PAIR_COUNT).unwrap_or_default() {
            return Err(ChatError::DatabaseUnavailable);
        }
        Ok(0)
    }

    #[cfg(feature = "feat126-s10-driver")]
    fn run_r8_idempotency_worker(
        mut repository: ChatRepository,
        start: u128,
        count: u128,
        barrier: Arc<Barrier>,
        project: Uuid,
    ) -> Result<Vec<(Uuid, Uuid)>, ChatError> {
        let mut results = Vec::with_capacity(count as usize);
        barrier.wait();
        let retry_deadline = Instant::now() + R8_IDEMPOTENCY_RETRY_TIMEOUT;
        for index in start..start + count {
            let operation_id = Uuid::from_u128(0x6000 + index);
            let pending = retry_r8_sqlite_busy_until(
                retry_deadline,
                || {
                    repository.create_session_and_enqueue_with_authority(
                        project,
                        "synthetic idempotency probe",
                        operation_id,
                        1,
                    )
                },
                Instant::now,
                thread::sleep,
            )?;
            results.push((pending.session_id, pending.turn_id));
        }
        Ok(results)
    }

    pub fn register_project(
        &mut self,
        canonical_path: &Path,
        bookmark: &[u8],
    ) -> Result<ProjectSummary, ChatError> {
        let canonical = validate_project_path(canonical_path)?;
        if bookmark.is_empty() || bookmark.len() > 1024 * 1024 {
            return Err(ChatError::InvalidInput);
        }
        let safe_name = canonical
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.trim().is_empty() && name.len() <= 255)
            .ok_or(ChatError::ProjectUnavailable)?;
        let canonical_hash = path_hash(&canonical);
        let now = unix_seconds()?;
        let existing: Option<String> = self
            .connection
            .query_row(
                "SELECT id FROM chat_projects WHERE owner_user_id=?1 AND tenant_id=?2 AND canonical_hash=?3",
                params![self.scope.owner_user_id, self.scope.tenant_id, canonical_hash],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let id = existing.unwrap_or_else(|| Uuid::now_v7().to_string());
        self.connection
            .execute(
                "INSERT INTO chat_projects(id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at, removed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)
                 ON CONFLICT(owner_user_id, tenant_id, canonical_hash) DO UPDATE SET
                   safe_name=excluded.safe_name, bookmark_ref=excluded.bookmark_ref,
                   last_used_at=excluded.last_used_at, removed_at=NULL",
                params![id, self.scope.owner_user_id, self.scope.tenant_id, safe_name, canonical_hash, bookmark, now],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        Ok(ProjectSummary {
            id,
            safe_name: safe_name.to_owned(),
            pinned_at: None,
            last_used_at: now,
            available: true,
        })
    }

    pub fn project_bookmark(&self, project_id: &str) -> Result<Vec<u8>, ChatError> {
        validate_uuid(project_id)?;
        self.connection
            .query_row(
                "SELECT bookmark_ref FROM chat_projects
                 WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND removed_at IS NULL",
                params![project_id, self.scope.owner_user_id, self.scope.tenant_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .ok_or(ChatError::NotFound)
    }

    pub fn refresh_project(
        &mut self,
        project_id: &str,
        canonical_path: &Path,
        bookmark: &[u8],
    ) -> Result<ProjectSummary, ChatError> {
        validate_uuid(project_id)?;
        let canonical = validate_project_path(canonical_path)?;
        let safe_name = canonical
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.trim().is_empty() && name.len() <= 255)
            .ok_or(ChatError::ProjectUnavailable)?;
        if bookmark.is_empty() || bookmark.len() > 1024 * 1024 {
            return Err(ChatError::InvalidInput);
        }
        let now = unix_seconds()?;
        let changed = self
            .connection
            .execute(
                "UPDATE chat_projects SET safe_name=?1, canonical_hash=?2, bookmark_ref=?3, last_used_at=?4
                 WHERE id=?5 AND owner_user_id=?6 AND tenant_id=?7 AND removed_at IS NULL",
                params![safe_name, path_hash(&canonical), bookmark, now, project_id, self.scope.owner_user_id, self.scope.tenant_id],
            )
            .map_err(|_| ChatError::ProjectUnavailable)?;
        if changed != 1 {
            return Err(ChatError::NotFound);
        }
        Ok(ProjectSummary {
            id: project_id.to_owned(),
            safe_name: safe_name.to_owned(),
            pinned_at: None,
            last_used_at: now,
            available: true,
        })
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectSummary>, ChatError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, safe_name, pinned_at, last_used_at FROM chat_projects
                 WHERE owner_user_id=?1 AND tenant_id=?2 AND removed_at IS NULL
                 ORDER BY pinned_at IS NULL ASC, pinned_at DESC, last_used_at DESC, id DESC",
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let rows = statement
            .query_map(
                params![self.scope.owner_user_id, self.scope.tenant_id],
                |row| {
                    Ok(ProjectSummary {
                        id: row.get(0)?,
                        safe_name: row.get(1)?,
                        pinned_at: row.get(2)?,
                        last_used_at: row.get(3)?,
                        available: true,
                    })
                },
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ChatError::DatabaseUnavailable)
    }

    pub fn remove_project(&mut self, project_id: &str) -> Result<(), ChatError> {
        validate_uuid(project_id)?;
        let changed = self
            .connection
            .execute(
                "UPDATE chat_projects SET removed_at=?1, pinned_at=NULL
                 WHERE id=?2 AND owner_user_id=?3 AND tenant_id=?4 AND removed_at IS NULL",
                params![
                    unix_seconds()?,
                    project_id,
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::NotFound);
        }
        Ok(())
    }

    pub fn set_project_pinned(
        &mut self,
        project_id: Uuid,
        pinned: bool,
        now: i64,
    ) -> Result<(), ChatError> {
        validate_non_nil(project_id)?;
        if now < 0 {
            return Err(ChatError::InvalidInput);
        }
        let changed = self
            .connection
            .execute(
                "UPDATE chat_projects
                 SET pinned_at=CASE
                   WHEN ?1 THEN COALESCE(pinned_at, ?2)
                   ELSE NULL
                 END
                 WHERE id=?3 AND owner_user_id=?4 AND tenant_id=?5 AND removed_at IS NULL",
                params![
                    pinned,
                    now,
                    project_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::NotFound);
        }
        Ok(())
    }

    pub fn store_attachment(
        &mut self,
        attachment: PreparedAttachment,
        draft_target: DraftTarget,
    ) -> Result<AttachmentSummary, ChatError> {
        self.store_attachments(vec![attachment], 1, draft_target)?
            .pop()
            .ok_or(ChatError::DatabaseUnavailable)
    }

    pub fn store_attachments(
        &mut self,
        attachments: Vec<PreparedAttachment>,
        remaining_capacity: usize,
        draft_target: DraftTarget,
    ) -> Result<Vec<AttachmentSummary>, ChatError> {
        if !(1..=MAX_ATTACHMENTS_PER_MESSAGE).contains(&remaining_capacity)
            || attachments.is_empty()
            || attachments.len() > remaining_capacity
            || attachments.len() > MAX_ATTACHMENTS_PER_MESSAGE
        {
            return Err(ChatError::InvalidInput);
        }
        let imported_at = attachments[0].imported_at;
        if attachments
            .iter()
            .any(|attachment| attachment.imported_at != imported_at)
        {
            return Err(ChatError::InvalidInput);
        }
        self.expire_attachments(imported_at)?;
        let transaction = self.connection.transaction().map_err(map_sqlite_error)?;
        validate_draft_target(
            &transaction,
            &self.scope.owner_user_id,
            &self.scope.tenant_id,
            &draft_target,
        )?;
        let existing = count_ready_attachments_for_target(
            &transaction,
            &self.scope.owner_user_id,
            &self.scope.tenant_id,
            &draft_target,
            imported_at,
        )?;
        if existing
            .checked_add(attachments.len())
            .is_none_or(|count| count > MAX_ATTACHMENTS_PER_MESSAGE)
        {
            return Err(ChatError::InvalidInput);
        }
        let mut draft_ordinal = next_draft_attachment_ordinal(
            &transaction,
            &self.scope.owner_user_id,
            &self.scope.tenant_id,
            &draft_target,
        )?;
        let mut summaries = Vec::with_capacity(attachments.len());
        for attachment in attachments {
            summaries.push(insert_attachment(
                &transaction,
                &self.scope.owner_user_id,
                &self.scope.tenant_id,
                attachment,
                &draft_target,
                draft_ordinal,
            )?);
            draft_ordinal = draft_ordinal
                .checked_add(1)
                .ok_or(ChatError::DatabaseUnavailable)?;
        }
        transaction.commit().map_err(map_sqlite_error)?;
        Ok(summaries)
    }

    pub fn list_ready_attachments(
        &mut self,
        draft_target: DraftTarget,
    ) -> Result<Vec<AttachmentSummary>, ChatError> {
        let now = unix_seconds()?;
        self.expire_attachments(now)?;
        validate_draft_target(
            &self.connection,
            &self.scope.owner_user_id,
            &self.scope.tenant_id,
            &draft_target,
        )?;
        let target_kind = draft_target.kind();
        let target_session_id = draft_target.session_id().map(|value| value.to_string());
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, kind, safe_name, media_type, byte_size, state, expires_at
                 FROM chat_attachments
                 WHERE owner_user_id=?1 AND tenant_id=?2
                   AND state='ready' AND message_id IS NULL AND expires_at>?3
                   AND draft_target_kind=?4
                   AND ((?4='new' AND draft_session_id IS NULL)
                     OR (?4='session' AND draft_session_id=?5))
                 ORDER BY draft_ordinal ASC LIMIT 10",
            )
            .map_err(map_sqlite_error)?;
        let attachments = statement
            .query_map(
                params![
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                    now,
                    target_kind,
                    target_session_id,
                ],
                |row| {
                    let attachment_id = row.get::<_, String>(0)?;
                    let byte_size = row.get::<_, i64>(4)?;
                    Ok((
                        attachment_id,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        byte_size,
                        row.get::<_, String>(5)?,
                        row.get::<_, i64>(6)?,
                    ))
                },
            )
            .map_err(map_sqlite_error)?
            .map(|row| {
                let (attachment_id, kind, safe_name, media_type, byte_size, state, expires_at) =
                    row.map_err(map_sqlite_error)?;
                Ok(AttachmentSummary {
                    attachment_id: parse_uuid_value(&attachment_id)?,
                    kind,
                    safe_name,
                    media_type,
                    byte_size: usize::try_from(byte_size)
                        .map_err(|_| ChatError::DatabaseUnavailable)?,
                    state,
                    expires_at,
                })
            })
            .collect();
        attachments
    }

    pub fn remove_ready_attachment(
        &mut self,
        attachment_id: Uuid,
        draft_target: DraftTarget,
    ) -> Result<(), ChatError> {
        validate_non_nil(attachment_id)?;
        validate_draft_target(
            &self.connection,
            &self.scope.owner_user_id,
            &self.scope.tenant_id,
            &draft_target,
        )?;
        let target_kind = draft_target.kind();
        let target_session_id = draft_target.session_id().map(|value| value.to_string());
        let transaction = self.connection.transaction().map_err(map_sqlite_error)?;
        let changed = transaction
            .execute(
                "DELETE FROM chat_attachments
                 WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3
                   AND state='ready' AND message_id IS NULL
                   AND draft_target_kind=?4
                   AND ((?4='new' AND draft_session_id IS NULL)
                     OR (?4='session' AND draft_session_id=?5))",
                params![
                    attachment_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                    target_kind,
                    target_session_id,
                ],
            )
            .map_err(map_sqlite_error)?;
        if changed == 1 {
            transaction.commit().map_err(map_sqlite_error)?;
            self.attachment_checkpoint_pending = true;
            self.checkpoint_attachment_cleanup()?;
            return Ok(());
        }
        let exists_in_scope = transaction
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM chat_attachments
                   WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3
                 )",
                params![
                    attachment_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                ],
                |row| row.get::<_, bool>(0),
            )
            .map_err(map_sqlite_error)?;
        transaction.commit().map_err(map_sqlite_error)?;
        if exists_in_scope {
            Err(ChatError::ConversationConflict)
        } else {
            self.checkpoint_attachment_cleanup()?;
            Ok(())
        }
    }

    pub fn expire_attachments(&mut self, now: i64) -> Result<usize, ChatError> {
        if now < 0 {
            return Err(ChatError::InvalidInput);
        }
        let transaction = self.connection.transaction().map_err(map_sqlite_error)?;
        let deleted_chunks = transaction
            .execute(
                "DELETE FROM chat_attachment_chunks
                 WHERE attachment_id IN (
                   SELECT id FROM chat_attachments
                   WHERE owner_user_id=?1 AND tenant_id=?2 AND expires_at<=?3
                     AND state IN ('ready', 'bound')
                 )",
                params![self.scope.owner_user_id, self.scope.tenant_id, now],
            )
            .map_err(map_sqlite_error)?;
        let expired = transaction
            .execute(
                "UPDATE chat_attachments
                 SET state='expired', content_blob=NULL
                 WHERE owner_user_id=?1 AND tenant_id=?2 AND expires_at<=?3
                   AND state='bound' AND message_id IS NOT NULL",
                params![self.scope.owner_user_id, self.scope.tenant_id, now],
            )
            .map_err(map_sqlite_error)?;
        let deleted_ready = transaction
            .execute(
                "DELETE FROM chat_attachments
                 WHERE owner_user_id=?1 AND tenant_id=?2 AND expires_at<=?3
                   AND state='ready' AND message_id IS NULL",
                params![self.scope.owner_user_id, self.scope.tenant_id, now],
            )
            .map_err(map_sqlite_error)?;
        transaction.commit().map_err(map_sqlite_error)?;
        if deleted_chunks > 0 || expired > 0 || deleted_ready > 0 {
            self.attachment_checkpoint_pending = true;
        }
        self.checkpoint_attachment_cleanup()?;
        expired
            .checked_add(deleted_ready)
            .ok_or(ChatError::DatabaseUnavailable)
    }

    fn expire_attachments_all_scopes(&mut self, now: i64) -> Result<usize, ChatError> {
        if now < 0 {
            return Err(ChatError::InvalidInput);
        }
        let transaction = self.connection.transaction().map_err(map_sqlite_error)?;
        let deleted_chunks = transaction
            .execute(
                "DELETE FROM chat_attachment_chunks
                 WHERE attachment_id IN (
                   SELECT id FROM chat_attachments
                   WHERE expires_at<=?1 AND state IN ('ready', 'bound')
                 )",
                [now],
            )
            .map_err(map_sqlite_error)?;
        let expired_bound = transaction
            .execute(
                "UPDATE chat_attachments
                 SET state='expired', content_blob=NULL
                 WHERE expires_at<=?1 AND state='bound' AND message_id IS NOT NULL",
                [now],
            )
            .map_err(map_sqlite_error)?;
        let deleted_ready = transaction
            .execute(
                "DELETE FROM chat_attachments
                 WHERE expires_at<=?1 AND state='ready' AND message_id IS NULL",
                [now],
            )
            .map_err(map_sqlite_error)?;
        transaction.commit().map_err(map_sqlite_error)?;
        if deleted_chunks > 0 || expired_bound > 0 || deleted_ready > 0 {
            self.attachment_checkpoint_pending = true;
        }
        self.checkpoint_attachment_cleanup()?;
        expired_bound
            .checked_add(deleted_ready)
            .ok_or(ChatError::DatabaseUnavailable)
    }

    pub fn load_message_content_blocks(
        &mut self,
        message_ids: Vec<Uuid>,
    ) -> Result<Vec<(Uuid, Vec<MessageContentBlockProjection>)>, ChatError> {
        if message_ids.len() > 100 || message_ids.iter().any(Uuid::is_nil) {
            return Err(ChatError::InvalidInput);
        }
        self.expire_attachments(unix_seconds()?)?;
        let mut result = Vec::with_capacity(message_ids.len());
        for message_id in message_ids {
            let mut statement = self
                .connection
                .prepare(
                    "SELECT b.block_ordinal, b.block_type, b.text_content,
                            a.id, a.kind, a.safe_name, a.media_type, a.byte_size,
                            a.state, a.expires_at
                     FROM chat_message_content_blocks b
                     JOIN chat_messages m ON m.id=b.message_id
                     JOIN chat_sessions s ON s.id=m.session_id
                     LEFT JOIN chat_attachments a ON a.id=b.attachment_id
                     WHERE b.message_id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3
                     ORDER BY b.block_ordinal ASC",
                )
                .map_err(map_sqlite_error)?;
            type BlockRow = (
                i64,
                String,
                Option<String>,
                Option<String>,
                Option<String>,
                Option<String>,
                Option<String>,
                Option<i64>,
                Option<String>,
                Option<i64>,
            );
            let rows = statement
                .query_map(
                    params![
                        message_id.to_string(),
                        self.scope.owner_user_id,
                        self.scope.tenant_id,
                    ],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get(5)?,
                            row.get(6)?,
                            row.get(7)?,
                            row.get(8)?,
                            row.get(9)?,
                        ))
                    },
                )
                .map_err(map_sqlite_error)?
                .collect::<rusqlite::Result<Vec<BlockRow>>>()
                .map_err(map_sqlite_error)?;
            let mut blocks = Vec::with_capacity(rows.len());
            for row in rows {
                let ordinal = usize::try_from(row.0).map_err(|_| ChatError::DatabaseUnavailable)?;
                match row.1.as_str() {
                    "text" => blocks.push(MessageContentBlockProjection::Text {
                        ordinal,
                        text: row.2.ok_or(ChatError::DatabaseUnavailable)?,
                    }),
                    "file" | "image" => {
                        let attachment_id = parse_uuid_value(
                            row.3.as_deref().ok_or(ChatError::DatabaseUnavailable)?,
                        )?;
                        let kind = row.4.ok_or(ChatError::DatabaseUnavailable)?;
                        if kind != row.1 {
                            return Err(ChatError::DatabaseUnavailable);
                        }
                        blocks.push(MessageContentBlockProjection::Attachment {
                            ordinal,
                            attachment: AttachmentSummary {
                                attachment_id,
                                kind,
                                safe_name: row.5.ok_or(ChatError::DatabaseUnavailable)?,
                                media_type: row.6.ok_or(ChatError::DatabaseUnavailable)?,
                                byte_size: usize::try_from(
                                    row.7.ok_or(ChatError::DatabaseUnavailable)?,
                                )
                                .map_err(|_| ChatError::DatabaseUnavailable)?,
                                state: row.8.ok_or(ChatError::DatabaseUnavailable)?,
                                expires_at: row.9.ok_or(ChatError::DatabaseUnavailable)?,
                            },
                        });
                    }
                    _ => return Err(ChatError::DatabaseUnavailable),
                }
            }
            result.push((message_id, blocks));
        }
        Ok(result)
    }

    pub fn create_session_and_enqueue(
        &mut self,
        project_id: Uuid,
        input: &str,
        create_operation_id: Uuid,
    ) -> Result<PendingConversation, ChatError> {
        self.create_session_and_enqueue_with_authority(project_id, input, create_operation_id, 1)
    }

    pub fn create_session_and_enqueue_with_authority(
        &mut self,
        project_id: Uuid,
        input: &str,
        create_operation_id: Uuid,
        authorization_revision: u64,
    ) -> Result<PendingConversation, ChatError> {
        validate_non_nil(project_id)?;
        validate_non_nil(create_operation_id)?;
        if authorization_revision == 0 {
            return Err(ChatError::InvalidInput);
        }
        validate_message(input)?;
        let now = unix_seconds()?;
        let transaction = self.connection.transaction().map_err(map_sqlite_error)?;
        if let Some((stored_session_id, version, payload, stored_revision)) = transaction
            .query_row(
                "SELECT o.session_id, o.payload_version, o.encrypted_payload, b.authorization_revision
                 FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
                 JOIN chat_public_task_bindings b ON b.session_id=s.id
                 WHERE o.operation_id=?1 AND o.kind='create_session'
                   AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    create_operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(map_sqlite_error)?
        {
            if version != OUTBOX_PAYLOAD_VERSION {
                return Err(ChatError::DatabaseUnavailable);
            }
            let payload: CreateSessionPayloadV1 = decode_payload(&payload)?;
            let stored_project_and_input: Option<(String, String)> = transaction
                .query_row(
                    "SELECT s.project_id, m.content
                     FROM chat_sessions s JOIN chat_messages m
                       ON m.id=?1 AND m.session_id=s.id AND m.role='user'
                     WHERE s.id=?2",
                    params![payload.message_id.to_string(), stored_session_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(map_sqlite_error)?;
            if payload.session_id.to_string() != stored_session_id
                || payload.task_id != payload.session_id
                || stored_project_and_input != Some((project_id.to_string(), input.to_owned()))
                || stored_revision != i64::try_from(authorization_revision).map_err(|_| ChatError::InvalidInput)?
            {
                return Err(ChatError::ConversationConflict);
            }
            return Ok(PendingConversation {
                session_id: payload.session_id,
                task_id: payload.task_id,
                turn_id: payload.turn_id,
                create_operation_id,
                turn_operation_id: payload.turn_operation_id,
            });
        }
        let project_exists: bool = transaction
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM chat_projects
                   WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND removed_at IS NULL
                 )",
                params![
                    project_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| row.get(0),
            )
            .map_err(map_sqlite_error)?;
        if !project_exists {
            return Err(ChatError::NotFound);
        }
        let session_id = Uuid::now_v7();
        let task_id = session_id;
        let client_reference_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        let turn_operation_id = Uuid::now_v7();
        let message_id = Uuid::now_v7();
        let title = fallback_title(input);
        transaction
            .execute(
                "INSERT INTO chat_sessions(
                   id, owner_user_id, tenant_id, project_id, title, title_source,
                   title_job_status, created_at, last_activity_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'fallback', 'not_started', ?6, ?6)",
                params![
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                    project_id.to_string(),
                    title,
                    now
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction
            .execute(
                "INSERT INTO chat_public_task_bindings(
                   session_id, client_reference_id, create_operation_id, host_operation_id,
                   state, authorization_revision, attempt_count, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?3, 'pending', ?4, 0, ?5, ?5)",
                params![
                    session_id.to_string(),
                    client_reference_id.to_string(),
                    create_operation_id.to_string(),
                    i64::try_from(authorization_revision).map_err(|_| ChatError::InvalidInput)?,
                    now
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, status)
                 VALUES (?1, ?2, ?3, 'queued')",
                params![
                    turn_id.to_string(),
                    session_id.to_string(),
                    turn_operation_id.to_string()
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction
            .execute(
                "INSERT INTO chat_messages(id, session_id, turn_id, role, content, status, ordinal, created_at)
                 VALUES (?1, ?2, ?3, 'user', ?4, 'committed', 0, ?5)",
                params![
                    message_id.to_string(),
                    session_id.to_string(),
                    turn_id.to_string(),
                    input,
                    now
                ],
            )
            .map_err(map_constraint_or_database)?;
        let payload = encode_payload(&CreateSessionPayloadV1 {
            session_id,
            task_id,
            turn_id,
            turn_operation_id,
            message_id,
        })?;
        transaction
            .execute(
                "INSERT INTO chat_outbox(
                   operation_id, session_id, kind, state, attempt_count, next_attempt_at,
                   payload_version, encrypted_payload
                 ) VALUES (?1, ?2, 'create_session', 'pending', 0, ?3, ?4, ?5)",
                params![
                    create_operation_id.to_string(),
                    session_id.to_string(),
                    now,
                    OUTBOX_PAYLOAD_VERSION,
                    payload
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction.commit().map_err(map_sqlite_error)?;
        Ok(PendingConversation {
            session_id,
            task_id,
            turn_id,
            create_operation_id,
            turn_operation_id,
        })
    }

    pub fn create_session_and_enqueue_multimodal(
        &mut self,
        project_id: Uuid,
        blocks: &[DraftContentBlock],
        create_operation_id: Uuid,
        authorization_revision: u64,
    ) -> Result<PendingConversation, ChatError> {
        validate_non_nil(project_id)?;
        validate_non_nil(create_operation_id)?;
        validate_draft_blocks(blocks)?;
        if authorization_revision == 0 {
            return Err(ChatError::InvalidInput);
        }
        let now = unix_seconds()?;
        self.expire_attachments(now)?;
        let text_projection = draft_text_projection(blocks);
        let transaction = self.connection.transaction().map_err(map_sqlite_error)?;
        if let Some((stored_session_id, version, payload, stored_revision)) = transaction
            .query_row(
                "SELECT o.session_id, o.payload_version, o.encrypted_payload, b.authorization_revision
                 FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
                 JOIN chat_public_task_bindings b ON b.session_id=s.id
                 WHERE o.operation_id=?1 AND o.kind='create_session'
                   AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    create_operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(map_sqlite_error)?
        {
            if version != 2 {
                return Err(ChatError::ConversationConflict);
            }
            let payload: CreateSessionPayloadV2 = decode_payload(&payload)?;
            let stored_project: Option<String> = transaction
                .query_row(
                    "SELECT project_id FROM chat_sessions WHERE id=?1",
                    [&stored_session_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(map_sqlite_error)?;
            if payload.session_id.to_string() != stored_session_id
                || payload.task_id != payload.session_id
                || stored_project.as_deref() != Some(project_id.to_string().as_str())
                || stored_revision
                    != i64::try_from(authorization_revision)
                        .map_err(|_| ChatError::InvalidInput)?
                || !draft_matches_stored_blocks(&transaction, payload.message_id, blocks)?
                || stored_content_block_digest(&transaction, payload.message_id)?
                    != payload.block_digest
            {
                return Err(ChatError::ConversationConflict);
            }
            return Ok(PendingConversation {
                session_id: payload.session_id,
                task_id: payload.task_id,
                turn_id: payload.turn_id,
                create_operation_id,
                turn_operation_id: payload.turn_operation_id,
            });
        }
        let project_exists: bool = transaction
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM chat_projects
                   WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND removed_at IS NULL
                 )",
                params![
                    project_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| row.get(0),
            )
            .map_err(map_sqlite_error)?;
        if !project_exists {
            return Err(ChatError::NotFound);
        }
        let title_source = if text_projection.trim().is_empty() {
            first_attachment_name(
                &transaction,
                &self.scope.owner_user_id,
                &self.scope.tenant_id,
                &DraftTarget::New,
                blocks,
                now,
            )?
            .unwrap_or_else(|| "新任务".to_owned())
        } else {
            text_projection.clone()
        };
        let session_id = Uuid::now_v7();
        let task_id = session_id;
        let client_reference_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        let turn_operation_id = Uuid::now_v7();
        let message_id = Uuid::now_v7();
        transaction
            .execute(
                "INSERT INTO chat_sessions(
                   id, owner_user_id, tenant_id, project_id, title, title_source,
                   title_job_status, created_at, last_activity_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'fallback', 'not_started', ?6, ?6)",
                params![
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                    project_id.to_string(),
                    fallback_title(&title_source),
                    now,
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction
            .execute(
                "INSERT INTO chat_public_task_bindings(
                   session_id, client_reference_id, create_operation_id, host_operation_id,
                   state, authorization_revision, attempt_count, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?3, 'pending', ?4, 0, ?5, ?5)",
                params![
                    session_id.to_string(),
                    client_reference_id.to_string(),
                    create_operation_id.to_string(),
                    i64::try_from(authorization_revision).map_err(|_| ChatError::InvalidInput)?,
                    now,
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, status)
                 VALUES (?1, ?2, ?3, 'queued')",
                params![
                    turn_id.to_string(),
                    session_id.to_string(),
                    turn_operation_id.to_string(),
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction
            .execute(
                "INSERT INTO chat_messages(id, session_id, turn_id, role, content, status, ordinal, created_at)
                 VALUES (?1, ?2, ?3, 'user', ?4, 'committed', 0, ?5)",
                params![
                    message_id.to_string(),
                    session_id.to_string(),
                    turn_id.to_string(),
                    text_projection,
                    now,
                ],
            )
            .map_err(map_constraint_or_database)?;
        let block_digest = bind_draft_blocks(
            &transaction,
            &self.scope.owner_user_id,
            &self.scope.tenant_id,
            &DraftTarget::New,
            message_id,
            blocks,
            now,
        )?;
        let payload = encode_payload(&CreateSessionPayloadV2 {
            session_id,
            task_id,
            turn_id,
            turn_operation_id,
            message_id,
            block_digest,
        })?;
        transaction
            .execute(
                "INSERT INTO chat_outbox(
                   operation_id, session_id, kind, state, attempt_count, next_attempt_at,
                   payload_version, encrypted_payload
                 ) VALUES (?1, ?2, 'create_session', 'pending', 0, ?3, 2, ?4)",
                params![
                    create_operation_id.to_string(),
                    session_id.to_string(),
                    now,
                    payload,
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction.commit().map_err(map_sqlite_error)?;
        Ok(PendingConversation {
            session_id,
            task_id,
            turn_id,
            create_operation_id,
            turn_operation_id,
        })
    }

    pub fn enqueue_turn(
        &mut self,
        session_id: Uuid,
        input: &str,
        operation_id: Uuid,
    ) -> Result<Uuid, ChatError> {
        validate_non_nil(session_id)?;
        validate_non_nil(operation_id)?;
        validate_message(input)?;
        let now = unix_seconds()?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if let Some((turn_id, stored_input)) = transaction
            .query_row(
                "SELECT t.id, m.content
                 FROM chat_turns t JOIN chat_sessions s ON s.id=t.session_id
                 JOIN chat_messages m ON m.turn_id=t.id AND m.role='user'
                 WHERE t.operation_id=?1 AND t.session_id=?2
                   AND s.owner_user_id=?3 AND s.tenant_id=?4",
                params![
                    operation_id.to_string(),
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
        {
            if stored_input != input {
                return Err(ChatError::ConversationConflict);
            }
            return parse_uuid_value(&turn_id);
        }
        let session_ready: bool = transaction
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM chat_sessions s JOIN chat_projects p ON p.id=s.project_id
                   WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3
                     AND s.agent_session_id IS NOT NULL AND s.runtime_thread_id IS NOT NULL
                     AND p.removed_at IS NULL
                     AND NOT EXISTS(
                       SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id
                     )
                 )",
                params![
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| row.get(0),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if !session_ready {
            return Err(ChatError::ConversationConflict);
        }
        let turn_id = Uuid::now_v7();
        let message_id = Uuid::now_v7();
        let ordinal: i64 = transaction
            .query_row(
                "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM chat_messages WHERE session_id=?1",
                [session_id.to_string()],
                |row| row.get(0),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, status)
                 VALUES (?1, ?2, ?3, 'queued')",
                params![
                    turn_id.to_string(),
                    session_id.to_string(),
                    operation_id.to_string()
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction
            .execute(
                "INSERT INTO chat_messages(id, session_id, turn_id, role, content, status, ordinal, created_at)
                 VALUES (?1, ?2, ?3, 'user', ?4, 'committed', ?5, ?6)",
                params![
                    message_id.to_string(),
                    session_id.to_string(),
                    turn_id.to_string(),
                    input,
                    ordinal,
                    now
                ],
            )
            .map_err(map_constraint_or_database)?;
        let payload = encode_payload(&StartTurnPayloadV1 {
            turn_id,
            message_id,
        })?;
        transaction
            .execute(
                "INSERT INTO chat_outbox(
                   operation_id, session_id, kind, state, attempt_count, next_attempt_at,
                   payload_version, encrypted_payload
                 ) VALUES (?1, ?2, 'start_turn', 'pending', 0, ?3, ?4, ?5)",
                params![
                    operation_id.to_string(),
                    session_id.to_string(),
                    now,
                    OUTBOX_PAYLOAD_VERSION,
                    payload
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        Ok(turn_id)
    }

    pub fn enqueue_turn_multimodal(
        &mut self,
        session_id: Uuid,
        blocks: &[DraftContentBlock],
        operation_id: Uuid,
    ) -> Result<Uuid, ChatError> {
        validate_non_nil(session_id)?;
        validate_non_nil(operation_id)?;
        validate_draft_blocks(blocks)?;
        let now = unix_seconds()?;
        self.expire_attachments(now)?;
        let text_projection = draft_text_projection(blocks);
        let transaction = self.connection.transaction().map_err(map_sqlite_error)?;
        if let Some((turn_id, version, payload)) = transaction
            .query_row(
                "SELECT t.id, o.payload_version, o.encrypted_payload
                 FROM chat_turns t JOIN chat_sessions s ON s.id=t.session_id
                 JOIN chat_outbox o ON o.operation_id=t.operation_id
                 WHERE t.operation_id=?1 AND t.session_id=?2
                   AND s.owner_user_id=?3 AND s.tenant_id=?4",
                params![
                    operation_id.to_string(),
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(map_sqlite_error)?
        {
            if version != 2 {
                return Err(ChatError::ConversationConflict);
            }
            let payload: StartTurnPayloadV2 = decode_payload(&payload)?;
            if payload.turn_id.to_string() != turn_id
                || !draft_matches_stored_blocks(&transaction, payload.message_id, blocks)?
                || stored_content_block_digest(&transaction, payload.message_id)?
                    != payload.block_digest
            {
                return Err(ChatError::ConversationConflict);
            }
            return parse_uuid_value(&turn_id);
        }
        let session_ready: bool = transaction
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM chat_sessions s JOIN chat_projects p ON p.id=s.project_id
                   WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3
                     AND s.agent_session_id IS NOT NULL AND s.runtime_thread_id IS NOT NULL
                     AND p.removed_at IS NULL
                     AND NOT EXISTS(
                       SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id
                     )
                 )",
                params![
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                ],
                |row| row.get(0),
            )
            .map_err(map_sqlite_error)?;
        if !session_ready {
            return Err(ChatError::ConversationConflict);
        }
        let turn_id = Uuid::now_v7();
        let message_id = Uuid::now_v7();
        let ordinal: i64 = transaction
            .query_row(
                "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM chat_messages WHERE session_id=?1",
                [session_id.to_string()],
                |row| row.get(0),
            )
            .map_err(map_sqlite_error)?;
        transaction
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, status)
                 VALUES (?1, ?2, ?3, 'queued')",
                params![
                    turn_id.to_string(),
                    session_id.to_string(),
                    operation_id.to_string(),
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction
            .execute(
                "INSERT INTO chat_messages(id, session_id, turn_id, role, content, status, ordinal, created_at)
                 VALUES (?1, ?2, ?3, 'user', ?4, 'committed', ?5, ?6)",
                params![
                    message_id.to_string(),
                    session_id.to_string(),
                    turn_id.to_string(),
                    text_projection,
                    ordinal,
                    now,
                ],
            )
            .map_err(map_constraint_or_database)?;
        let block_digest = bind_draft_blocks(
            &transaction,
            &self.scope.owner_user_id,
            &self.scope.tenant_id,
            &DraftTarget::Session(session_id),
            message_id,
            blocks,
            now,
        )?;
        let payload = encode_payload(&StartTurnPayloadV2 {
            turn_id,
            message_id,
            block_digest,
        })?;
        transaction
            .execute(
                "INSERT INTO chat_outbox(
                   operation_id, session_id, kind, state, attempt_count, next_attempt_at,
                   payload_version, encrypted_payload
                 ) VALUES (?1, ?2, 'start_turn', 'pending', 0, ?3, 2, ?4)",
                params![
                    operation_id.to_string(),
                    session_id.to_string(),
                    now,
                    payload
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction.commit().map_err(map_sqlite_error)?;
        Ok(turn_id)
    }

    pub fn claim_next_conversation_outbox(
        &mut self,
        now: i64,
        lease_seconds: i64,
    ) -> Result<Option<ClaimedOutbox>, ChatError> {
        if now < 0 || !(1..=300).contains(&lease_seconds) {
            return Err(ChatError::InvalidInput);
        }
        let lease_expires_at = now
            .checked_add(lease_seconds)
            .ok_or(ChatError::InvalidInput)?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .execute(
                "UPDATE chat_public_task_bindings
                 SET state='failed', lease_expires_at=NULL, next_attempt_at=NULL,
                     last_error_code='chat_temporarily_unavailable', updated_at=?1
                 WHERE create_operation_id IN (
                   SELECT operation_id FROM chat_outbox
                   WHERE kind='create_session' AND attempt_count>=?2
                     AND (state='pending' OR (state='inflight' AND next_attempt_at IS NOT NULL AND next_attempt_at<=?1))
                 ) AND state!='bound'",
                params![now, OUTBOX_MAX_ATTEMPTS],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .execute(
                "UPDATE chat_outbox SET state='failed', next_attempt_at=NULL
                 WHERE kind IN ('create_session', 'start_turn', 'interrupt_turn')
                   AND attempt_count >= ?1
                   AND (state='pending' OR (state='inflight' AND next_attempt_at IS NOT NULL AND next_attempt_at<=?2))",
                params![OUTBOX_MAX_ATTEMPTS, now],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let row: Option<(String, String, String, i64)> = transaction
            .query_row(
                "SELECT o.operation_id, o.session_id, o.kind, o.attempt_count
                 FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
                 WHERE s.owner_user_id=?1 AND s.tenant_id=?2
                   AND o.kind IN ('create_session', 'start_turn', 'interrupt_turn')
                   AND (o.kind!='create_session' OR EXISTS(
                     SELECT 1 FROM chat_public_task_bindings b
                     WHERE b.create_operation_id=o.operation_id
                       AND b.state IN ('pending', 'inflight', 'bound', 'retry_wait')
                   ))
                   AND (o.kind='interrupt_turn' OR NOT EXISTS(
                     SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=o.session_id
                   ))
                   AND o.attempt_count < ?3
                   AND ((o.state='pending' AND (o.next_attempt_at IS NULL OR o.next_attempt_at<=?4))
                     OR (o.state='inflight' AND o.next_attempt_at IS NOT NULL AND o.next_attempt_at<=?4))
                 ORDER BY COALESCE(o.next_attempt_at, 0), o.operation_id
                 LIMIT 1",
                params![
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                    OUTBOX_MAX_ATTEMPTS,
                    now
                ],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let Some((operation_id, session_id, kind, attempt_count)) = row else {
            transaction
                .commit()
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            return Ok(None);
        };
        let changed = transaction
            .execute(
                "UPDATE chat_outbox
                 SET state='inflight', attempt_count=attempt_count+1, next_attempt_at=?1
                 WHERE operation_id=?2 AND attempt_count=?3
                   AND ((state='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?4))
                     OR (state='inflight' AND next_attempt_at IS NOT NULL AND next_attempt_at<=?4))",
                params![lease_expires_at, operation_id, attempt_count, now],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::ConversationConflict);
        }
        if kind == "create_session" {
            transaction
                .execute(
                    "UPDATE chat_public_task_bindings
                     SET state='inflight', attempt_count=attempt_count+1,
                         lease_expires_at=?1, next_attempt_at=NULL, last_error_code=NULL,
                         updated_at=?2
                     WHERE create_operation_id=?3 AND state IN ('pending', 'inflight', 'retry_wait')",
                    params![lease_expires_at, now, operation_id],
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?;
        }
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        Ok(Some(ClaimedOutbox {
            operation_id: parse_uuid_value(&operation_id)?,
            session_id: parse_uuid_value(&session_id)?,
            kind: parse_outbox_kind(&kind)?,
            attempt_count: u8::try_from(attempt_count + 1)
                .map_err(|_| ChatError::DatabaseUnavailable)?,
        }))
    }

    pub fn load_create_session_dispatch(
        &self,
        operation_id: Uuid,
    ) -> Result<CreateSessionDispatch, ChatError> {
        validate_non_nil(operation_id)?;
        let (
            session_id,
            project_id,
            version,
            payload,
            client_reference_id,
            public_task_id,
            authorization_revision,
            binding_state,
        ): (
            String,
            String,
            i64,
            Vec<u8>,
            String,
            Option<String>,
            i64,
            String,
        ) = self
            .connection
            .query_row(
                "SELECT s.id, s.project_id, o.payload_version, o.encrypted_payload,
                        b.client_reference_id, b.public_task_id, b.authorization_revision, b.state
                 FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
                 JOIN chat_public_task_bindings b ON b.session_id=s.id
                 WHERE o.operation_id=?1 AND o.kind='create_session' AND o.state='inflight'
                   AND b.create_operation_id=o.operation_id
                   AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .ok_or(ChatError::ConversationConflict)?;
        let payload = decode_create_payload(version, &payload)?;
        let parsed_session = parse_uuid_value(&session_id)?;
        if payload.session_id != parsed_session
            || payload.task_id != parsed_session
            || authorization_revision <= 0
            || !matches!(binding_state.as_str(), "inflight" | "bound")
            || (binding_state == "bound") != public_task_id.is_some()
        {
            return Err(ChatError::DatabaseUnavailable);
        }
        Ok(CreateSessionDispatch {
            operation_id,
            session_id: parsed_session,
            project_id: parse_uuid_value(&project_id)?,
            client_reference_id: parse_uuid_value(&client_reference_id)?,
            public_task_id: public_task_id
                .map(|value| parse_uuid_value(&value))
                .transpose()?,
            authorization_revision: u64::try_from(authorization_revision)
                .map_err(|_| ChatError::DatabaseUnavailable)?,
        })
    }

    pub fn bind_public_task(
        &mut self,
        create_operation_id: Uuid,
        public_task_id: Uuid,
        now: i64,
    ) -> Result<PublicTaskControlPlaneStatus, ChatError> {
        validate_non_nil(create_operation_id)?;
        validate_non_nil(public_task_id)?;
        if now < 0 {
            return Err(ChatError::InvalidInput);
        }
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let row: Option<(String, String, Option<String>)> = transaction
            .query_row(
                "SELECT b.session_id, b.state, b.public_task_id
                 FROM chat_public_task_bindings b
                 JOIN chat_sessions s ON s.id=b.session_id
                 WHERE b.create_operation_id=?1
                   AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    create_operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let (session_id, state, existing_public_task_id) = row.ok_or(ChatError::NotFound)?;
        if transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM chat_deletion_jobs WHERE session_id=?1)",
                [&session_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?
        {
            return Err(ChatError::ConversationConflict);
        }
        if state == "bound" {
            let public_task_id = public_task_id.to_string();
            if existing_public_task_id.as_deref() != Some(public_task_id.as_str()) {
                return Err(ChatError::ConversationConflict);
            }
        } else if state == "inflight" {
            let changed = transaction
                .execute(
                    "UPDATE chat_public_task_bindings
                     SET public_task_id=?1, state='bound', lease_expires_at=NULL,
                         next_attempt_at=NULL, last_error_code=NULL, updated_at=?2, bound_at=?2
                     WHERE create_operation_id=?3 AND state='inflight'",
                    params![
                        public_task_id.to_string(),
                        now,
                        create_operation_id.to_string()
                    ],
                )
                .map_err(map_constraint_or_database)?;
            if changed != 1 {
                return Err(ChatError::ConversationConflict);
            }
        } else {
            return Err(ChatError::ConversationConflict);
        }
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        Ok(PublicTaskControlPlaneStatus {
            session_id: parse_uuid_value(&session_id)?,
            state: PublicTaskBindingState::Bound,
            issue_code: None,
        })
    }

    pub fn transition_public_task_binding(
        &mut self,
        create_operation_id: Uuid,
        state: PublicTaskBindingState,
        issue_code: &str,
        next_attempt_at: Option<i64>,
        now: i64,
    ) -> Result<PublicTaskControlPlaneStatus, ChatError> {
        validate_non_nil(create_operation_id)?;
        if now < 0
            || !matches!(
                state,
                PublicTaskBindingState::BlockedAuth
                    | PublicTaskBindingState::RetryWait
                    | PublicTaskBindingState::Denied
                    | PublicTaskBindingState::Failed
            )
            || !matches!(
                issue_code,
                "chat_unauthenticated"
                    | "chat_capability_denied"
                    | "chat_temporarily_unavailable"
                    | "chat_conflict"
                    | "chat_protocol_error"
            )
            || (state == PublicTaskBindingState::RetryWait) != next_attempt_at.is_some()
            || next_attempt_at.is_some_and(|value| value <= now)
        {
            return Err(ChatError::InvalidInput);
        }
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let session_id: String = transaction
            .query_row(
                "SELECT b.session_id FROM chat_public_task_bindings b
                 JOIN chat_sessions s ON s.id=b.session_id
                 WHERE b.create_operation_id=?1 AND b.state='inflight'
                   AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    create_operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .ok_or(ChatError::ConversationConflict)?;
        let outbox_state = if state == PublicTaskBindingState::RetryWait {
            "pending"
        } else {
            "failed"
        };
        transaction
            .execute(
                "UPDATE chat_public_task_bindings
                 SET state=?1, lease_expires_at=NULL, next_attempt_at=?2,
                     last_error_code=?3, updated_at=?4
                 WHERE create_operation_id=?5 AND state='inflight'",
                params![
                    state.as_str(),
                    next_attempt_at,
                    issue_code,
                    now,
                    create_operation_id.to_string()
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction
            .execute(
                "UPDATE chat_outbox SET state=?1, next_attempt_at=?2
                 WHERE operation_id=?3 AND kind='create_session' AND state='inflight'",
                params![
                    outbox_state,
                    next_attempt_at,
                    create_operation_id.to_string()
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        Ok(PublicTaskControlPlaneStatus {
            session_id: parse_uuid_value(&session_id)?,
            state,
            issue_code: Some(issue_code.to_owned()),
        })
    }

    pub fn public_task_control_plane_status(
        &self,
        session_id: Uuid,
    ) -> Result<PublicTaskControlPlaneStatus, ChatError> {
        validate_non_nil(session_id)?;
        let row: Option<(String, Option<String>)> = self
            .connection
            .query_row(
                "SELECT b.state, b.last_error_code
                 FROM chat_public_task_bindings b
                 JOIN chat_sessions s ON s.id=b.session_id
                 WHERE b.session_id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let (state, issue_code) = row.ok_or(ChatError::NotFound)?;
        Ok(PublicTaskControlPlaneStatus {
            session_id,
            state: parse_public_task_binding_state(&state)?,
            issue_code,
        })
    }

    pub fn resume_blocked_public_tasks(
        &mut self,
        authorization_revision: u64,
        now: i64,
    ) -> Result<usize, ChatError> {
        if authorization_revision == 0 || now < 0 {
            return Err(ChatError::InvalidInput);
        }
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let changed = transaction
            .execute(
                "UPDATE chat_public_task_bindings
                 SET state='pending', authorization_revision=?1, attempt_count=0,
                     lease_expires_at=NULL, next_attempt_at=NULL, last_error_code=NULL,
                     updated_at=?2
                 WHERE state='blocked_auth' AND session_id IN (
                   SELECT id FROM chat_sessions WHERE owner_user_id=?3 AND tenant_id=?4
                 ) AND NOT EXISTS(
                   SELECT 1 FROM chat_deletion_jobs d
                   WHERE d.session_id=chat_public_task_bindings.session_id
                 )",
                params![
                    i64::try_from(authorization_revision).map_err(|_| ChatError::InvalidInput)?,
                    now,
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .execute(
                "UPDATE chat_outbox SET state='pending', attempt_count=0, next_attempt_at=?1
                 WHERE kind='create_session' AND operation_id IN (
                   SELECT create_operation_id FROM chat_public_task_bindings
                   WHERE state='pending' AND authorization_revision=?2
                 )",
                params![
                    now,
                    i64::try_from(authorization_revision).map_err(|_| ChatError::InvalidInput)?
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        Ok(changed)
    }

    pub fn bind_host_session_and_enqueue_turn(
        &mut self,
        create_operation_id: Uuid,
        task_id: Uuid,
        agent_session_id: Uuid,
        codex_thread_id: Uuid,
    ) -> Result<(), ChatError> {
        for value in [
            create_operation_id,
            task_id,
            agent_session_id,
            codex_thread_id,
        ] {
            validate_non_nil(value)?;
        }
        let now = unix_seconds()?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let (session_id, state, version, payload, bound_public_task_id): (
            String,
            String,
            i64,
            Vec<u8>,
            String,
        ) = transaction
            .query_row(
                "SELECT o.session_id, o.state, o.payload_version, o.encrypted_payload,
                        b.public_task_id
                 FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
                 JOIN chat_public_task_bindings b ON b.session_id=s.id
                 WHERE o.operation_id=?1 AND o.kind='create_session'
                   AND b.create_operation_id=o.operation_id AND b.state='bound'
                   AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    create_operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .ok_or(ChatError::NotFound)?;
        let create = decode_create_payload(version, &payload)?;
        if create.session_id.to_string() != session_id
            || parse_uuid_value(&bound_public_task_id)? != task_id
        {
            return Err(ChatError::ConversationConflict);
        }
        let existing: (Option<String>, Option<String>) = transaction
            .query_row(
                "SELECT agent_session_id, runtime_thread_id FROM chat_sessions WHERE id=?1",
                [&session_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if existing
            .0
            .as_deref()
            .is_some_and(|value| value != agent_session_id.to_string())
            || existing
                .1
                .as_deref()
                .is_some_and(|value| value != codex_thread_id.to_string())
        {
            return Err(ChatError::ConversationConflict);
        }
        transaction
            .execute(
                "UPDATE chat_sessions SET agent_session_id=?1, runtime_thread_id=?2
                 WHERE id=?3",
                params![
                    agent_session_id.to_string(),
                    codex_thread_id.to_string(),
                    session_id
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction
            .execute(
                "UPDATE chat_outbox SET state='done', next_attempt_at=NULL
                 WHERE operation_id=?1 AND state IN ('inflight', 'done')",
                [create_operation_id.to_string()],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let turn_payload = encode_start_turn_payload(&create)?;
        transaction
            .execute(
                "INSERT INTO chat_outbox(
                   operation_id, session_id, kind, state, attempt_count, next_attempt_at,
                   payload_version, encrypted_payload
                 ) VALUES (?1, ?2, 'start_turn', 'pending', 0, ?3, ?4, ?5)
                 ON CONFLICT(operation_id) DO NOTHING",
                params![
                    create.turn_operation_id.to_string(),
                    session_id,
                    now,
                    version,
                    turn_payload
                ],
            )
            .map_err(map_constraint_or_database)?;
        let actual: Option<(String, String, i64, Vec<u8>)> = transaction
            .query_row(
                "SELECT session_id, kind, payload_version, encrypted_payload
                 FROM chat_outbox WHERE operation_id=?1",
                [create.turn_operation_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if actual
            != Some((
                session_id,
                OutboxKind::StartTurn.as_str().to_owned(),
                version,
                encode_start_turn_payload(&create)?,
            ))
        {
            return Err(ChatError::ConversationConflict);
        }
        if state == "failed" {
            return Err(ChatError::ConversationConflict);
        }
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)
    }

    pub fn load_start_turn_dispatch(
        &self,
        operation_id: Uuid,
    ) -> Result<StartTurnDispatch, ChatError> {
        validate_non_nil(operation_id)?;
        let row: Option<(String, String, String, i64, Vec<u8>, String)> = self
            .connection
            .query_row(
                "SELECT o.session_id, s.agent_session_id, t.id, o.payload_version,
                        o.encrypted_payload, m.content
                 FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
                 JOIN chat_turns t ON t.operation_id=o.operation_id AND t.session_id=s.id
                 JOIN chat_messages m ON m.turn_id=t.id AND m.role='user'
                 WHERE o.operation_id=?1 AND o.kind='start_turn' AND o.state='inflight'
                   AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let (session_id, agent_session_id, turn_id, version, payload, input) =
            row.ok_or(ChatError::ConversationConflict)?;
        if version != OUTBOX_PAYLOAD_VERSION {
            return Err(ChatError::DatabaseUnavailable);
        }
        let payload: StartTurnPayloadV1 = decode_payload(&payload)?;
        let parsed_turn = parse_uuid_value(&turn_id)?;
        if payload.turn_id != parsed_turn {
            return Err(ChatError::DatabaseUnavailable);
        }
        validate_message(&input)?;
        Ok(StartTurnDispatch {
            operation_id,
            session_id: parse_uuid_value(&session_id)?,
            turn_id: parsed_turn,
            agent_session_id: parse_uuid_value(&agent_session_id)?,
            input,
        })
    }

    pub fn start_turn_payload_version(&self, operation_id: Uuid) -> Result<i64, ChatError> {
        validate_non_nil(operation_id)?;
        self.connection
            .query_row(
                "SELECT o.payload_version
                 FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
                 WHERE o.operation_id=?1 AND o.kind='start_turn' AND o.state='inflight'
                   AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(map_sqlite_error)?
            .ok_or(ChatError::ConversationConflict)
    }

    pub fn load_start_turn_dispatch_v2(
        &mut self,
        operation_id: Uuid,
    ) -> Result<StartTurnDispatchV2, ChatError> {
        validate_non_nil(operation_id)?;
        let now = unix_seconds()?;
        self.expire_attachments(now)?;
        let row: Option<(String, String, String, i64, Vec<u8>, String)> = self
            .connection
            .query_row(
                "SELECT o.session_id, s.agent_session_id, t.id, o.payload_version,
                        o.encrypted_payload, m.id
                 FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
                 JOIN chat_turns t ON t.operation_id=o.operation_id AND t.session_id=s.id
                 JOIN chat_messages m ON m.turn_id=t.id AND m.role='user'
                 WHERE o.operation_id=?1 AND o.kind='start_turn' AND o.state='inflight'
                   AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .optional()
            .map_err(map_sqlite_error)?;
        let (session_id, agent_session_id, turn_id, version, payload, message_id) =
            row.ok_or(ChatError::ConversationConflict)?;
        if version != 2 {
            return Err(ChatError::DatabaseUnavailable);
        }
        let payload: StartTurnPayloadV2 = decode_payload(&payload)?;
        let parsed_turn = parse_uuid_value(&turn_id)?;
        let parsed_message = parse_uuid_value(&message_id)?;
        if payload.turn_id != parsed_turn
            || payload.message_id != parsed_message
            || payload.block_digest.len() != 64
            || stored_content_block_digest(&self.connection, parsed_message)?
                != payload.block_digest
        {
            return Err(ChatError::DatabaseUnavailable);
        }
        let query_text: String = self
            .connection
            .query_row(
                "SELECT content FROM chat_messages WHERE id=?1",
                [message_id.clone()],
                |row| row.get(0),
            )
            .map_err(map_sqlite_error)?;
        let query_terms = lexical_terms(&query_text);
        type StoredBlockRow = (
            i64,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<i64>,
            Option<String>,
            Option<Vec<u8>>,
            Option<i64>,
        );
        let rows = {
            let mut statement = self
                .connection
                .prepare(
                    "SELECT b.block_ordinal, b.block_type, b.text_content, a.id,
                            a.safe_name, a.media_type, a.byte_size, a.sha256,
                            a.content_blob, a.expires_at
                     FROM chat_message_content_blocks b
                     LEFT JOIN chat_attachments a ON a.id=b.attachment_id
                     WHERE b.message_id=?1 ORDER BY b.block_ordinal ASC",
                )
                .map_err(map_sqlite_error)?;
            let rows = statement
                .query_map([message_id.clone()], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                        row.get(9)?,
                    ))
                })
                .map_err(map_sqlite_error)?
                .collect::<rusqlite::Result<Vec<StoredBlockRow>>>()
                .map_err(map_sqlite_error)?;
            rows
        };
        if rows.is_empty() || rows.len() > 16 {
            return Err(ChatError::DatabaseUnavailable);
        }
        let mut remaining_file_blocks = rows.iter().filter(|row| row.1 == "file").count();
        let mut content_blocks = Vec::with_capacity(rows.len());
        let mut image_bytes = 0_usize;
        let mut file_context_bytes = 0_usize;
        for (expected_ordinal, row) in rows.into_iter().enumerate() {
            if usize::try_from(row.0).map_err(|_| ChatError::DatabaseUnavailable)?
                != expected_ordinal
            {
                return Err(ChatError::DatabaseUnavailable);
            }
            match row.1.as_str() {
                "text" => {
                    let text = row.2.ok_or(ChatError::DatabaseUnavailable)?;
                    validate_message(&text)?;
                    content_blocks.push(HostTurnInputBlock::Text { text });
                }
                "file" => {
                    if remaining_file_blocks == 0 {
                        return Err(ChatError::DatabaseUnavailable);
                    }
                    let attachment_id =
                        parse_uuid_value(row.3.as_deref().ok_or(ChatError::DatabaseUnavailable)?)?;
                    if row.9.ok_or(ChatError::DatabaseUnavailable)? <= now {
                        return Err(ChatError::NotFound);
                    }
                    let remaining_context_bytes =
                        MAX_FILE_CONTEXT_BYTES.saturating_sub(file_context_bytes);
                    let file_context_budget = remaining_context_bytes / remaining_file_blocks;
                    remaining_file_blocks -= 1;
                    let context_chunks = select_attachment_context(
                        &self.connection,
                        attachment_id,
                        &query_terms,
                        file_context_budget,
                    )?;
                    if context_chunks.is_empty() {
                        return Err(ChatError::NotFound);
                    }
                    let context_bytes = context_chunks.iter().map(String::len).sum::<usize>();
                    file_context_bytes = file_context_bytes
                        .checked_add(context_bytes)
                        .ok_or(ChatError::InvalidInput)?;
                    content_blocks.push(HostTurnInputBlock::File {
                        attachment_id,
                        safe_name: row.4.ok_or(ChatError::DatabaseUnavailable)?,
                        media_type: row.5.ok_or(ChatError::DatabaseUnavailable)?,
                        size_bytes: usize::try_from(row.6.ok_or(ChatError::DatabaseUnavailable)?)
                            .map_err(|_| ChatError::DatabaseUnavailable)?,
                        sha256: row.7.ok_or(ChatError::DatabaseUnavailable)?,
                        context_chunks,
                    });
                }
                "image" => {
                    let attachment_id =
                        parse_uuid_value(row.3.as_deref().ok_or(ChatError::DatabaseUnavailable)?)?;
                    if row.9.ok_or(ChatError::DatabaseUnavailable)? <= now {
                        return Err(ChatError::NotFound);
                    }
                    let media_type = row.5.ok_or(ChatError::DatabaseUnavailable)?;
                    let declared_size =
                        usize::try_from(row.6.ok_or(ChatError::DatabaseUnavailable)?)
                            .map_err(|_| ChatError::DatabaseUnavailable)?;
                    let expected_digest = row.7.ok_or(ChatError::DatabaseUnavailable)?;
                    let bytes = row.8.ok_or(ChatError::NotFound)?;
                    if bytes.len() != declared_size
                        || format!("{:x}", Sha256::digest(&bytes)) != expected_digest
                    {
                        return Err(ChatError::DatabaseUnavailable);
                    }
                    image_bytes = image_bytes
                        .checked_add(bytes.len())
                        .ok_or(ChatError::InvalidInput)?;
                    if image_bytes > super::attachment::MAX_ATTACHMENT_BYTES {
                        return Err(ChatError::InvalidInput);
                    }
                    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
                    content_blocks.push(HostTurnInputBlock::Image {
                        attachment_id,
                        media_type: media_type.clone(),
                        size_bytes: declared_size,
                        sha256: expected_digest,
                        data_url: format!("data:{media_type};base64,{encoded}"),
                    });
                }
                _ => return Err(ChatError::DatabaseUnavailable),
            }
        }
        Ok(StartTurnDispatchV2 {
            operation_id,
            session_id: parse_uuid_value(&session_id)?,
            turn_id: parsed_turn,
            agent_session_id: parse_uuid_value(&agent_session_id)?,
            content_blocks,
        })
    }

    pub fn enqueue_interrupt(
        &mut self,
        session_id: Uuid,
        operation_id: Uuid,
    ) -> Result<Uuid, ChatError> {
        validate_non_nil(session_id)?;
        validate_non_nil(operation_id)?;
        let now = unix_seconds()?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if let Some((stored_session_id, version, payload)) = transaction
            .query_row(
                "SELECT o.session_id, o.payload_version, o.encrypted_payload
                 FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
                 WHERE o.operation_id=?1 AND o.kind='interrupt_turn'
                   AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
        {
            if stored_session_id != session_id.to_string() || version != OUTBOX_PAYLOAD_VERSION {
                return Err(ChatError::ConversationConflict);
            }
            let payload: InterruptTurnPayloadV1 = decode_payload(&payload)?;
            return Ok(payload.turn_id);
        }
        let active: Option<(String, String)> = transaction
            .query_row(
                "SELECT t.id, t.runtime_turn_id
                 FROM chat_turns t JOIN chat_sessions s ON s.id=t.session_id
                 WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3
                   AND t.status IN ('streaming', 'stopping')",
                params![
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let (turn_id, runtime_turn_id) = active.ok_or(ChatError::ConversationConflict)?;
        let turn_id = parse_uuid_value(&turn_id)?;
        let runtime_turn_id = parse_uuid_value(&runtime_turn_id)?;
        transaction
            .execute(
                "UPDATE chat_turns SET status='stopping'
                 WHERE id=?1 AND status IN ('streaming', 'stopping')",
                [turn_id.to_string()],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .execute(
                "INSERT INTO chat_outbox(
                   operation_id, session_id, kind, state, attempt_count, next_attempt_at,
                   payload_version, encrypted_payload
                 ) VALUES (?1, ?2, 'interrupt_turn', 'pending', 0, ?3, ?4, ?5)",
                params![
                    operation_id.to_string(),
                    session_id.to_string(),
                    now,
                    OUTBOX_PAYLOAD_VERSION,
                    encode_payload(&InterruptTurnPayloadV1 {
                        turn_id,
                        runtime_turn_id,
                    })?
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        Ok(turn_id)
    }

    pub fn load_interrupt_dispatch(
        &self,
        operation_id: Uuid,
    ) -> Result<InterruptTurnDispatch, ChatError> {
        validate_non_nil(operation_id)?;
        let row: Option<(String, String, i64, Vec<u8>)> = self
            .connection
            .query_row(
                "SELECT o.session_id, s.agent_session_id, o.payload_version, o.encrypted_payload
                 FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
                 WHERE o.operation_id=?1 AND o.kind='interrupt_turn' AND o.state='inflight'
                   AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let (session_id, agent_session_id, version, payload) =
            row.ok_or(ChatError::ConversationConflict)?;
        if version != OUTBOX_PAYLOAD_VERSION {
            return Err(ChatError::DatabaseUnavailable);
        }
        let payload: InterruptTurnPayloadV1 = decode_payload(&payload)?;
        Ok(InterruptTurnDispatch {
            operation_id,
            session_id: parse_uuid_value(&session_id)?,
            turn_id: payload.turn_id,
            agent_session_id: parse_uuid_value(&agent_session_id)?,
            runtime_turn_id: payload.runtime_turn_id,
        })
    }

    pub fn complete_interrupt(&mut self, operation_id: Uuid) -> Result<(), ChatError> {
        validate_non_nil(operation_id)?;
        let changed = self
            .connection
            .execute(
                "UPDATE chat_outbox SET state='done', next_attempt_at=NULL
                 WHERE operation_id=?1 AND kind='interrupt_turn' AND state IN ('inflight', 'done')
                   AND EXISTS(
                     SELECT 1 FROM chat_sessions s WHERE s.id=chat_outbox.session_id
                       AND s.owner_user_id=?2 AND s.tenant_id=?3
                   )",
                params![
                    operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::ConversationConflict);
        }
        Ok(())
    }

    pub fn finalize_interrupted_without_stream(
        &mut self,
        operation_id: Uuid,
        terminal_at: i64,
    ) -> Result<(), ChatError> {
        validate_non_nil(operation_id)?;
        if terminal_at < 0 {
            return Err(ChatError::InvalidInput);
        }
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let row: Option<(String, i64, Vec<u8>)> = transaction
            .query_row(
                "SELECT o.session_id, o.payload_version, o.encrypted_payload
                 FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
                 WHERE o.operation_id=?1 AND o.kind='interrupt_turn'
                   AND o.state IN ('inflight', 'done')
                   AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let (session_id, version, payload) = row.ok_or(ChatError::NotFound)?;
        if version != OUTBOX_PAYLOAD_VERSION {
            return Err(ChatError::DatabaseUnavailable);
        }
        let payload: InterruptTurnPayloadV1 = decode_payload(&payload)?;
        transaction
            .execute(
                "UPDATE chat_messages SET status='committed'
                 WHERE turn_id=?1 AND role='assistant' AND status='pending'",
                [payload.turn_id.to_string()],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let changed = transaction
            .execute(
                "UPDATE chat_turns SET status='interrupted', terminal_at=?1,
                   reasoning_status='unavailable', reasoning_reason_code='turn_interrupted'
                 WHERE id=?2 AND runtime_turn_id=?3 AND status IN ('streaming', 'stopping')",
                params![
                    terminal_at,
                    payload.turn_id.to_string(),
                    payload.runtime_turn_id.to_string()
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::ConversationConflict);
        }
        transaction
            .execute(
                "UPDATE chat_outbox SET state='done', next_attempt_at=NULL
                 WHERE operation_id IN (?1, (
                   SELECT operation_id FROM chat_turns WHERE id=?2
                 ))",
                params![operation_id.to_string(), payload.turn_id.to_string()],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .execute(
                "UPDATE chat_sessions SET last_activity_at=?1 WHERE id=?2",
                params![terminal_at, session_id],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)
    }

    pub fn suspend_started_turn_retry(
        &mut self,
        operation_id: Uuid,
        runtime_turn_id: Uuid,
    ) -> Result<(), ChatError> {
        validate_non_nil(operation_id)?;
        validate_non_nil(runtime_turn_id)?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let row: Option<(String, String, Option<String>)> = transaction
            .query_row(
                "SELECT t.id, t.status, t.runtime_turn_id
                 FROM chat_turns t JOIN chat_sessions s ON s.id=t.session_id
                 JOIN chat_outbox o ON o.operation_id=t.operation_id
                 WHERE t.operation_id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3
                   AND o.kind='start_turn' AND o.state IN ('inflight', 'done')",
                params![
                    operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let (turn_id, status, existing_runtime_turn) = row.ok_or(ChatError::NotFound)?;
        if existing_runtime_turn
            .as_deref()
            .is_some_and(|value| value != runtime_turn_id.to_string())
            || !matches!(status.as_str(), "queued" | "streaming")
        {
            return Err(ChatError::ConversationConflict);
        }
        transaction
            .execute(
                "UPDATE chat_turns SET runtime_turn_id=?1, status='streaming' WHERE id=?2",
                params![runtime_turn_id.to_string(), turn_id],
            )
            .map_err(map_constraint_or_database)?;
        transaction
            .execute(
                "UPDATE chat_outbox SET state='inflight', next_attempt_at=NULL
                 WHERE operation_id=?1",
                [operation_id.to_string()],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let assistant_exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM chat_messages WHERE turn_id=?1 AND role='assistant')",
                [&turn_id],
                |row| row.get(0),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if !assistant_exists {
            let session_id: String = transaction
                .query_row(
                    "SELECT session_id FROM chat_turns WHERE id=?1",
                    [&turn_id],
                    |row| row.get(0),
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            let ordinal: i64 = transaction
                .query_row(
                    "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM chat_messages WHERE session_id=?1",
                    [&session_id],
                    |row| row.get(0),
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            transaction
                .execute(
                    "INSERT INTO chat_messages(
                       id, session_id, turn_id, role, content, status, ordinal, created_at
                     ) VALUES (?1, ?2, ?3, 'assistant', '', 'pending', ?4, ?5)",
                    params![
                        Uuid::now_v7().to_string(),
                        session_id,
                        turn_id,
                        ordinal,
                        unix_seconds()?
                    ],
                )
                .map_err(map_constraint_or_database)?;
        }
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)
    }

    pub fn reschedule_outbox(
        &mut self,
        operation_id: Uuid,
        next_attempt_at: i64,
    ) -> Result<(), ChatError> {
        validate_non_nil(operation_id)?;
        if next_attempt_at < 0 {
            return Err(ChatError::InvalidInput);
        }
        let changed = self
            .connection
            .execute(
                "UPDATE chat_outbox SET state='pending', next_attempt_at=?1
                 WHERE operation_id=?2 AND state='inflight' AND attempt_count < ?3
                   AND EXISTS(
                     SELECT 1 FROM chat_sessions s
                     WHERE s.id=chat_outbox.session_id
                       AND s.owner_user_id=?4 AND s.tenant_id=?5
                   )",
                params![
                    next_attempt_at,
                    operation_id.to_string(),
                    OUTBOX_MAX_ATTEMPTS,
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::ConversationConflict);
        }
        Ok(())
    }

    pub fn fail_outbox(&mut self, operation_id: Uuid) -> Result<(), ChatError> {
        validate_non_nil(operation_id)?;
        let changed = self
            .connection
            .execute(
                "UPDATE chat_outbox SET state='failed', next_attempt_at=NULL
                 WHERE operation_id=?1 AND state IN ('pending', 'inflight')
                   AND EXISTS(
                     SELECT 1 FROM chat_sessions s
                     WHERE s.id=chat_outbox.session_id
                       AND s.owner_user_id=?2 AND s.tenant_id=?3
                   )",
                params![
                    operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::ConversationConflict);
        }
        Ok(())
    }

    pub fn active_turn_context(&self, session_id: Uuid) -> Result<ActiveTurnContext, ChatError> {
        validate_non_nil(session_id)?;
        type ActiveRow = (
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            Option<String>,
            Option<i64>,
            Option<String>,
        );
        let row: ActiveRow = self
            .connection
            .query_row(
                "SELECT s.id, b.public_task_id, t.id, t.operation_id, s.agent_session_id, s.runtime_thread_id,
                        t.runtime_turn_id, COALESCE(m.content, ''), c.stream_id, c.sequence, c.event_id
                 FROM chat_sessions s JOIN chat_turns t ON t.session_id=s.id
                 JOIN chat_public_task_bindings b ON b.session_id=s.id AND b.state='bound'
                 LEFT JOIN chat_messages m ON m.turn_id=t.id AND m.role='assistant'
                 LEFT JOIN chat_event_cursors c ON c.session_id=s.id
                 WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3
                   AND t.status IN ('streaming', 'stopping')",
                params![
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                        row.get(9)?,
                        row.get(10)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .ok_or(ChatError::NotFound)?;
        let cursor = match (row.8, row.9, row.10) {
            (Some(stream_id), Some(sequence), Some(event_id)) => Some(StoredEventCursor {
                stream_id: parse_uuid_value(&stream_id)?,
                sequence: u64::try_from(sequence).map_err(|_| ChatError::DatabaseUnavailable)?,
                event_id: parse_uuid_value(&event_id)?,
            }),
            (None, None, None) => None,
            _ => return Err(ChatError::DatabaseUnavailable),
        };
        Ok(ActiveTurnContext {
            session_id: parse_uuid_value(&row.0)?,
            task_id: parse_uuid_value(&row.1)?,
            turn_id: parse_uuid_value(&row.2)?,
            turn_operation_id: parse_uuid_value(&row.3)?,
            agent_session_id: parse_uuid_value(&row.4)?,
            codex_thread_id: parse_uuid_value(&row.5)?,
            runtime_turn_id: parse_uuid_value(&row.6)?,
            assistant_text: row.7,
            cursor,
        })
    }

    pub fn clear_event_cursor_after_stream_change(
        &mut self,
        session_id: Uuid,
        expected: &StoredEventCursor,
    ) -> Result<(), ChatError> {
        validate_non_nil(session_id)?;
        validate_cursor(expected)?;
        let changed = self
            .connection
            .execute(
                "DELETE FROM chat_event_cursors
                 WHERE session_id=?1 AND stream_id=?2 AND sequence=?3 AND event_id=?4
                   AND EXISTS (
                     SELECT 1 FROM chat_sessions s JOIN chat_turns t ON t.session_id=s.id
                     WHERE s.id=?1 AND s.owner_user_id=?5 AND s.tenant_id=?6
                       AND t.status IN ('streaming', 'stopping')
                   )",
                params![
                    session_id.to_string(),
                    expected.stream_id.to_string(),
                    i64::try_from(expected.sequence).map_err(|_| ChatError::InvalidInput)?,
                    expected.event_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::ConversationConflict);
        }
        Ok(())
    }

    pub fn persist_turn_progress(&mut self, progress: &TurnProgress) -> Result<(), ChatError> {
        validate_non_nil(progress.local_turn_id)?;
        validate_message_output(&progress.assistant_text)?;
        validate_cursor(&progress.cursor)?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let session_id: String = transaction
            .query_row(
                "SELECT t.session_id FROM chat_turns t JOIN chat_sessions s ON s.id=t.session_id
                 WHERE t.id=?1 AND t.status IN ('streaming', 'stopping')
                   AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    progress.local_turn_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .ok_or(ChatError::ConversationConflict)?;
        let changed = transaction
            .execute(
                "UPDATE chat_messages SET content=?1
                 WHERE turn_id=?2 AND role='assistant' AND status='pending'",
                params![progress.assistant_text, progress.local_turn_id.to_string()],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::DatabaseUnavailable);
        }
        advance_cursor(&transaction, &session_id, &progress.cursor)?;
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)
    }

    pub fn commit_terminal_turn(&mut self, terminal: &TerminalTurnCommit) -> Result<(), ChatError> {
        validate_non_nil(terminal.local_turn_id)?;
        validate_message_output(&terminal.assistant_text)?;
        validate_cursor(&terminal.cursor)?;
        if terminal.terminal_at < 0
            || !matches!(
                terminal.terminal_status.as_str(),
                "completed" | "interrupted" | "failed"
            )
        {
            return Err(ChatError::InvalidInput);
        }
        validate_reasoning(
            terminal.reasoning_status,
            terminal.reasoning_reason_code.as_deref(),
            &terminal.reasoning_items,
        )?;
        if terminal.terminal_status != "completed"
            && terminal.reasoning_status == ReasoningStatus::Complete
        {
            return Err(ChatError::InvalidInput);
        }
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let (session_id, operation_id, current_status): (String, String, String) = transaction
            .query_row(
                "SELECT t.session_id, t.operation_id, t.status
                 FROM chat_turns t JOIN chat_sessions s ON s.id=t.session_id
                 WHERE t.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    terminal.local_turn_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .ok_or(ChatError::NotFound)?;
        if !matches!(current_status.as_str(), "streaming" | "stopping") {
            return Err(ChatError::ConversationConflict);
        }
        let message_status = if terminal.terminal_status == "failed" {
            "failed"
        } else {
            "committed"
        };
        let changed = transaction
            .execute(
                "UPDATE chat_messages SET content=?1, status=?2
                 WHERE turn_id=?3 AND role='assistant' AND status='pending'",
                params![
                    terminal.assistant_text,
                    message_status,
                    terminal.local_turn_id.to_string()
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::DatabaseUnavailable);
        }
        transaction
            .execute(
                "UPDATE chat_turns
                 SET status=?1, terminal_at=?2, reasoning_status=?3, reasoning_reason_code=?4
                 WHERE id=?5",
                params![
                    terminal.terminal_status,
                    terminal.terminal_at,
                    terminal.reasoning_status.as_str(),
                    terminal.reasoning_reason_code,
                    terminal.local_turn_id.to_string()
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        replace_reasoning(
            &transaction,
            &terminal.local_turn_id.to_string(),
            &terminal.reasoning_items,
        )?;
        advance_cursor(&transaction, &session_id, &terminal.cursor)?;
        let closed = transaction
            .execute(
                "UPDATE chat_outbox SET state='done', next_attempt_at=NULL
                 WHERE operation_id=?1 AND kind='start_turn' AND state='inflight'",
                [&operation_id],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if closed != 1 {
            return Err(ChatError::ConversationConflict);
        }
        transaction
            .execute(
                "UPDATE chat_sessions SET last_activity_at=?1 WHERE id=?2",
                params![terminal.terminal_at, session_id],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)
    }

    pub fn list_sessions(
        &self,
        cursor: Option<&SessionPageCursor>,
        requested_limit: Option<usize>,
    ) -> Result<SessionPage, ChatError> {
        let limit = page_size(requested_limit)?;
        let (cursor_pinned, cursor_activity, cursor_id) = match cursor {
            Some(cursor) => (
                cursor.pinned_at,
                Some(cursor.last_activity_at),
                Some(cursor.session_id.to_string()),
            ),
            None => (None, None, None),
        };
        let mut statement = self
            .connection
            .prepare(
                "SELECT s.id, s.project_id, s.title, s.title_source, s.pinned_at,
                        s.last_activity_at,
                        (SELECT t.status FROM chat_turns t WHERE t.session_id=s.id
                         ORDER BY t.rowid DESC LIMIT 1),
                        p.removed_at IS NULL
                 FROM chat_sessions s JOIN chat_projects p ON p.id=s.project_id
                 WHERE s.owner_user_id=?1 AND s.tenant_id=?2
                   AND (
                     ?3 IS NULL
                     OR (?4 IS NOT NULL AND (
                       (s.pinned_at IS NOT NULL AND (
                         s.pinned_at < ?4
                         OR (s.pinned_at = ?4 AND s.last_activity_at < ?3)
                         OR (s.pinned_at = ?4 AND s.last_activity_at = ?3 AND s.id < ?5)
                       ))
                       OR s.pinned_at IS NULL
                     ))
                     OR (?4 IS NULL AND s.pinned_at IS NULL AND (
                       s.last_activity_at < ?3
                       OR (s.last_activity_at = ?3 AND s.id < ?5)
                     ))
                   )
                 ORDER BY s.pinned_at IS NULL ASC, s.pinned_at DESC,
                          s.last_activity_at DESC, s.id DESC
                 LIMIT ?6",
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let rows = statement
            .query_map(
                params![
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                    cursor_activity,
                    cursor_pinned,
                    cursor_id,
                    i64::try_from(limit + 1).map_err(|_| ChatError::InvalidInput)?
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<i64>>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, bool>(7)?,
                    ))
                },
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let has_more = rows.len() > limit;
        let mut sessions = rows
            .into_iter()
            .take(limit)
            .map(
                |(
                    session_id,
                    project_id,
                    title,
                    title_source,
                    pinned_at,
                    last_activity_at,
                    latest_turn_status,
                    project_available,
                )| {
                    Ok(SessionSummary {
                        session_id: parse_uuid_value(&session_id)?,
                        project_id: parse_uuid_value(&project_id)?,
                        title,
                        title_source: parse_title_source(&title_source)?,
                        pinned_at,
                        last_activity_at,
                        latest_turn_status,
                        project_available,
                    })
                },
            )
            .collect::<Result<Vec<_>, ChatError>>()?;
        let next_cursor = if has_more {
            sessions.last().map(|session| SessionPageCursor {
                pinned_at: session.pinned_at,
                last_activity_at: session.last_activity_at,
                session_id: session.session_id,
            })
        } else {
            None
        };
        Ok(SessionPage {
            sessions: std::mem::take(&mut sessions),
            next_cursor,
        })
    }

    pub fn session_summary(&self, session_id: Uuid) -> Result<SessionSummary, ChatError> {
        validate_non_nil(session_id)?;
        type SummaryRow = (
            String,
            String,
            String,
            Option<i64>,
            i64,
            Option<String>,
            bool,
        );
        let row: SummaryRow = self
            .connection
            .query_row(
                "SELECT s.project_id, s.title, s.title_source, s.pinned_at,
                        s.last_activity_at,
                        (SELECT t.status FROM chat_turns t WHERE t.session_id=s.id
                         ORDER BY t.rowid DESC LIMIT 1),
                        p.removed_at IS NULL
                 FROM chat_sessions s JOIN chat_projects p ON p.id=s.project_id
                 WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .ok_or(ChatError::NotFound)?;
        Ok(SessionSummary {
            session_id,
            project_id: parse_uuid_value(&row.0)?,
            title: row.1,
            title_source: parse_title_source(&row.2)?,
            pinned_at: row.3,
            last_activity_at: row.4,
            latest_turn_status: row.5,
            project_available: row.6,
        })
    }

    pub fn load_history(
        &self,
        session_id: Uuid,
        before_ordinal: Option<u64>,
        requested_limit: Option<usize>,
    ) -> Result<HistoryPage, ChatError> {
        validate_non_nil(session_id)?;
        let limit = page_size(requested_limit)?;
        let before = before_ordinal
            .map(|value| i64::try_from(value).map_err(|_| ChatError::InvalidInput))
            .transpose()?
            .unwrap_or(i64::MAX);
        let owned: bool = self
            .connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM chat_sessions
                   WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3
                 )",
                params![
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| row.get(0),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if !owned {
            return Err(ChatError::NotFound);
        }
        let turn_limit = i64::try_from(limit + 1).map_err(|_| ChatError::InvalidInput)?;
        let mut turn_statement = self
            .connection
            .prepare(
                "SELECT t.id, t.runtime_turn_id, t.status, t.terminal_at,
                        t.reasoning_status, t.reasoning_reason_code, MAX(m.ordinal) AS page_ordinal
                 FROM chat_turns t JOIN chat_messages m ON m.turn_id=t.id
                 WHERE t.session_id=?1
                 GROUP BY t.id
                 HAVING page_ordinal < ?2
                 ORDER BY page_ordinal DESC, t.id DESC
                 LIMIT ?3",
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let rows = turn_statement
            .query_map(params![session_id.to_string(), before, turn_limit], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            })
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let has_more = rows.len() > limit;
        let selected = rows.into_iter().take(limit).collect::<Vec<_>>();
        let mut turns = selected
            .iter()
            .map(
                |(
                    turn_id,
                    runtime_turn_id,
                    status,
                    terminal_at,
                    reasoning_status,
                    reasoning_reason_code,
                    _,
                )| {
                    Ok(HistoryTurn {
                        turn_id: parse_uuid_value(turn_id)?,
                        runtime_turn_id: runtime_turn_id
                            .as_deref()
                            .map(parse_uuid_value)
                            .transpose()?,
                        status: status.clone(),
                        terminal_at: *terminal_at,
                        reasoning_status: reasoning_status.clone(),
                        reasoning_reason_code: reasoning_reason_code.clone(),
                        messages: Vec::new(),
                        reasoning: Vec::new(),
                    })
                },
            )
            .collect::<Result<Vec<_>, ChatError>>()?;
        if !turns.is_empty() {
            let turn_ids = turns
                .iter()
                .map(|turn| turn.turn_id.to_string())
                .collect::<Vec<_>>();
            load_history_messages(&self.connection, &turn_ids, &mut turns)?;
            load_history_reasoning_metadata(&self.connection, &turn_ids, &mut turns)?;
        }
        turns.reverse();
        let next_before_ordinal = if has_more {
            selected.last().and_then(|row| u64::try_from(row.6).ok())
        } else {
            None
        };
        Ok(HistoryPage {
            turns,
            next_before_ordinal,
        })
    }

    pub fn enqueue_title_job(
        &mut self,
        session_id: Uuid,
        operation_id: Uuid,
    ) -> Result<bool, ChatError> {
        validate_non_nil(session_id)?;
        validate_non_nil(operation_id)?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let row: Option<(String, String)> = transaction
            .query_row(
                "SELECT title_source, title_job_status FROM chat_sessions
                 WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3",
                params![
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let (source, status) = row.ok_or(ChatError::NotFound)?;
        if source == SessionTitleSource::User.as_str() || status == "cancelled" {
            return Ok(false);
        }
        let existing: Option<String> = transaction
            .query_row(
                "SELECT session_id FROM chat_outbox
                 WHERE operation_id=?1 AND kind='generate_title'",
                [operation_id.to_string()],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if let Some(existing_session) = existing {
            if existing_session != session_id.to_string() {
                return Err(ChatError::ConversationConflict);
            }
            return Ok(true);
        }
        let prior_attempts: i64 = transaction
            .query_row(
                "SELECT count(*) FROM chat_outbox
                 WHERE session_id=?1 AND kind='generate_title'",
                [session_id.to_string()],
                |row| row.get(0),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if prior_attempts >= 2 {
            return Err(ChatError::ConversationConflict);
        }
        transaction
            .execute(
                "INSERT INTO chat_outbox(
                   operation_id, session_id, kind, state, attempt_count, next_attempt_at,
                   payload_version, encrypted_payload
                 ) VALUES (?1, ?2, 'generate_title', 'pending', 0, NULL, ?3, ?4)",
                params![
                    operation_id.to_string(),
                    session_id.to_string(),
                    OUTBOX_PAYLOAD_VERSION,
                    encode_payload(&TitlePayloadV1 { session_id })?
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction
            .execute(
                "UPDATE chat_sessions SET title_job_status='pending' WHERE id=?1",
                [session_id.to_string()],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        Ok(true)
    }

    pub fn apply_model_title(
        &mut self,
        session_id: Uuid,
        operation_id: Uuid,
        title: &str,
    ) -> Result<bool, ChatError> {
        validate_non_nil(session_id)?;
        validate_non_nil(operation_id)?;
        validate_model_title(title)?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let job_state: Option<String> = transaction
            .query_row(
                "SELECT o.state FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
                 WHERE o.operation_id=?1 AND o.session_id=?2 AND o.kind='generate_title'
                   AND s.owner_user_id=?3 AND s.tenant_id=?4",
                params![
                    operation_id.to_string(),
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let job_state = job_state.ok_or(ChatError::ConversationConflict)?;
        let (current_title, current_source): (String, String) = transaction
            .query_row(
                "SELECT title, title_source FROM chat_sessions WHERE id=?1",
                [session_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if current_source == SessionTitleSource::User.as_str() {
            return Ok(false);
        }
        if job_state == "done" {
            return Ok(
                current_source == SessionTitleSource::Model.as_str() && current_title == title
            );
        }
        if !matches!(job_state.as_str(), "pending" | "inflight") {
            return Ok(false);
        }
        let applied = transaction
            .execute(
                "UPDATE chat_sessions
                 SET title=?1, title_source='model', title_job_status='completed'
                 WHERE id=?2 AND owner_user_id=?3 AND tenant_id=?4
                   AND title_source!='user' AND title_job_status='pending'",
                params![
                    title,
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?
            == 1;
        transaction
            .execute(
                "UPDATE chat_outbox SET state=?1, next_attempt_at=NULL WHERE operation_id=?2",
                params![
                    if applied { "done" } else { "failed" },
                    operation_id.to_string()
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        Ok(applied)
    }

    pub fn rename_session(&mut self, session_id: Uuid, title: &str) -> Result<(), ChatError> {
        validate_non_nil(session_id)?;
        validate_user_title(title)?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let changed = transaction
            .execute(
                "UPDATE chat_sessions
                 SET title=?1, title_source='user', title_job_status='cancelled'
                 WHERE id=?2 AND owner_user_id=?3 AND tenant_id=?4",
                params![
                    title.trim(),
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::NotFound);
        }
        transaction
            .execute(
                "UPDATE chat_outbox SET state='failed', next_attempt_at=NULL
                 WHERE session_id=?1 AND kind='generate_title' AND state IN ('pending', 'inflight')",
                [session_id.to_string()],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)
    }

    pub fn set_session_pinned(
        &mut self,
        session_id: Uuid,
        pinned: bool,
        now: i64,
    ) -> Result<(), ChatError> {
        validate_non_nil(session_id)?;
        if now < 0 {
            return Err(ChatError::InvalidInput);
        }
        let changed = self
            .connection
            .execute(
                "UPDATE chat_sessions
                 SET pinned_at=CASE WHEN ?1 THEN COALESCE(pinned_at, ?2) ELSE NULL END
                 WHERE id=?3 AND owner_user_id=?4 AND tenant_id=?5
                   AND NOT EXISTS(
                     SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=chat_sessions.id
                   )",
                params![
                    pinned,
                    now,
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::NotFound);
        }
        Ok(())
    }

    pub fn outbox_state(&self, operation_id: Uuid) -> Result<OutboxState, ChatError> {
        validate_non_nil(operation_id)?;
        let state: String = self
            .connection
            .query_row(
                "SELECT o.state FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
                 WHERE o.operation_id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .ok_or(ChatError::NotFound)?;
        parse_outbox_state(&state)
    }

    pub fn commit_reasoning(
        &mut self,
        turn_id: &str,
        turn_status: ReasoningStatus,
        turn_reason_code: Option<&str>,
        items: &[ReasoningItem],
    ) -> Result<(), ChatError> {
        validate_uuid(turn_id)?;
        validate_reasoning(turn_status, turn_reason_code, items)?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let stored_turn: Option<(String, Option<i64>)> = transaction
            .query_row(
                "SELECT t.status, t.terminal_at
                 FROM chat_turns t JOIN chat_sessions s ON s.id=t.session_id
                 WHERE t.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![turn_id, self.scope.owner_user_id, self.scope.tenant_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let (stored_status, terminal_at) = stored_turn.ok_or(ChatError::NotFound)?;
        if terminal_at.is_none()
            || !matches!(
                stored_status.as_str(),
                "completed" | "interrupted" | "failed"
            )
            || (stored_status != "completed" && turn_status == ReasoningStatus::Complete)
        {
            return Err(ChatError::InvalidInput);
        }
        transaction
            .execute(
                "DELETE FROM chat_reasoning_items WHERE turn_id=?1",
                [turn_id],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        for item in items {
            let total_bytes: usize = item.parts.iter().map(|part| part.text.len()).sum();
            transaction
                .execute(
                    "INSERT INTO chat_reasoning_items(turn_id, item_id, item_ordinal, status, reason_code, total_bytes, finalized_at_ms)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![turn_id, item.item_id, item.item_ordinal as i64, item.status.as_str(), item.reason_code, total_bytes as i64, item.finalized_at_ms],
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            for part in &item.parts {
                transaction
                    .execute(
                        "INSERT INTO chat_reasoning_parts(turn_id, item_id, content_index, text, byte_count)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![turn_id, item.item_id, part.content_index as i64, part.text, part.text.len() as i64],
                    )
                    .map_err(|_| ChatError::DatabaseUnavailable)?;
            }
        }
        transaction
            .execute(
                "UPDATE chat_turns SET reasoning_status=?1, reasoning_reason_code=?2 WHERE id=?3",
                params![turn_status.as_str(), turn_reason_code, turn_id],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)
    }

    pub fn load_reasoning(&self, turn_id: &str) -> Result<Vec<ReasoningItem>, ChatError> {
        validate_uuid(turn_id)?;
        let owned: bool = self
            .connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM chat_turns t JOIN chat_sessions s ON s.id=t.session_id
                   WHERE t.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3
                 )",
                params![turn_id, self.scope.owner_user_id, self.scope.tenant_id],
                |row| row.get(0),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if !owned {
            return Err(ChatError::NotFound);
        }
        let mut statement = self
            .connection
            .prepare(
                "SELECT i.item_id, i.item_ordinal, i.status, i.reason_code, i.finalized_at_ms,
                        p.content_index, p.text
                 FROM chat_reasoning_items i
                 LEFT JOIN chat_reasoning_parts p
                   ON p.turn_id=i.turn_id AND p.item_id=i.item_id
                 WHERE i.turn_id=?1
                 ORDER BY i.item_ordinal, p.content_index",
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let rows = statement
            .query_map([turn_id], |row| {
                let status: String = row.get(2)?;
                Ok((
                    row.get::<_, String>(0)?,
                    usize::try_from(row.get::<_, i64>(1)?).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            1,
                            rusqlite::types::Type::Integer,
                            Box::new(error),
                        )
                    })?,
                    status,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            })
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let mut items: Vec<ReasoningItem> = Vec::with_capacity(rows.len());
        for (item_id, item_ordinal, status, reason_code, finalized_at_ms, content_index, text) in
            rows
        {
            if items.last().is_none_or(|item| item.item_id != item_id) {
                items.push(ReasoningItem {
                    item_id: item_id.clone(),
                    item_ordinal,
                    status: parse_reasoning_status(&status)?,
                    reason_code,
                    finalized_at_ms,
                    parts: Vec::new(),
                });
            }
            match (content_index, text) {
                (Some(index), Some(text)) => items
                    .last_mut()
                    .expect("reasoning item exists")
                    .parts
                    .push(ReasoningPart {
                        content_index: usize::try_from(index)
                            .map_err(|_| ChatError::DatabaseUnavailable)?,
                        text,
                    }),
                (None, None) => {}
                _ => return Err(ChatError::DatabaseUnavailable),
            }
        }
        Ok(items)
    }

    pub fn begin_session_deletion(
        &mut self,
        session_id: Uuid,
        operation_id: Uuid,
        now: i64,
    ) -> Result<DeletionStatus, ChatError> {
        validate_non_nil(session_id)?;
        validate_non_nil(operation_id)?;
        if now < 0 {
            return Err(ChatError::InvalidInput);
        }
        let keyed_hash = scoped_session_hash(
            &self.receipt_key,
            &self.scope.owner_user_id,
            &self.scope.tenant_id,
            session_id,
        );
        if let Some(status) = self.deletion_status(operation_id)? {
            let stored_hash: Option<String> = self
                .connection
                .query_row(
                    "SELECT keyed_session_hash FROM chat_deletion_jobs WHERE operation_id=?1
                     UNION ALL
                     SELECT keyed_session_hash FROM chat_deletion_receipts WHERE operation_id=?1
                     LIMIT 1",
                    [operation_id.to_string()],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            if stored_hash.as_deref() != Some(keyed_hash.as_str()) {
                return Err(ChatError::ConversationConflict);
            }
            return Ok(status);
        }
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let session: Option<Option<String>> = transaction
            .query_row(
                "SELECT agent_session_id FROM chat_sessions
                 WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3",
                params![
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let agent_session_id = session.ok_or(ChatError::NotFound)?;
        let agent_session_id = agent_session_id
            .map(|value| parse_uuid_value(&value))
            .transpose()?;
        let active: Option<(String, String, Option<String>)> = transaction
            .query_row(
                "SELECT id, status, runtime_turn_id FROM chat_turns
                 WHERE session_id=?1 AND status IN ('queued', 'streaming', 'stopping')",
                [session_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if active
            .as_ref()
            .is_some_and(|(_, status, _)| status == "queued")
        {
            let uncertain_create: bool = transaction
                .query_row(
                    "SELECT EXISTS(
                       SELECT 1 FROM chat_outbox WHERE session_id=?1
                         AND kind='create_session' AND state='inflight'
                     )",
                    [session_id.to_string()],
                    |row| row.get(0),
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            if uncertain_create {
                return Err(ChatError::ConversationConflict);
            }
            transaction
                .execute(
                    "UPDATE chat_outbox SET state='failed', next_attempt_at=NULL
                     WHERE session_id=?1 AND kind IN ('create_session', 'start_turn')
                       AND state IN ('pending', 'inflight')",
                    [session_id.to_string()],
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            transaction
                .execute(
                    "UPDATE chat_turns SET status='interrupted', terminal_at=?1,
                       reasoning_status='unavailable', reasoning_reason_code='turn_interrupted'
                     WHERE session_id=?2 AND status='queued'",
                    params![now, session_id.to_string()],
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?;
        }
        let host_initial = if agent_session_id.is_some() {
            CleanupSurfaceState::Pending
        } else {
            CleanupSurfaceState::Complete
        };
        transaction
            .execute(
                "INSERT INTO chat_deletion_jobs(
                   operation_id, session_id, keyed_session_hash, encrypted_retry_ids,
                   desktop_state, host_state, runtime_state, requested_at, updated_at,
                   lease_expires_at, next_attempt_at, attempt_count, outcome_code, last_error_code
                 ) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?5, ?6, ?6, 0, ?6, 0, 'pending', NULL)",
                params![
                    operation_id.to_string(),
                    session_id.to_string(),
                    keyed_hash,
                    encode_payload(&DeletionRetryIdsV1 {
                        session_id,
                        agent_session_id
                    })?,
                    host_initial.as_str(),
                    now
                ],
            )
            .map_err(map_constraint_or_database)?;
        if let Some((turn_id, status, Some(runtime_turn_id))) = active {
            if matches!(status.as_str(), "streaming" | "stopping") {
                let turn_id = parse_uuid_value(&turn_id)?;
                let runtime_turn_id = parse_uuid_value(&runtime_turn_id)?;
                transaction
                    .execute(
                        "UPDATE chat_turns SET status='stopping' WHERE id=?1",
                        [turn_id.to_string()],
                    )
                    .map_err(|_| ChatError::DatabaseUnavailable)?;
                transaction
                    .execute(
                        "INSERT INTO chat_outbox(
                           operation_id, session_id, kind, state, attempt_count,
                           next_attempt_at, payload_version, encrypted_payload
                         ) VALUES (?1, ?2, 'interrupt_turn', 'pending', 0, ?3, ?4, ?5)",
                        params![
                            operation_id.to_string(),
                            session_id.to_string(),
                            now,
                            OUTBOX_PAYLOAD_VERSION,
                            encode_payload(&InterruptTurnPayloadV1 {
                                turn_id,
                                runtime_turn_id
                            })?
                        ],
                    )
                    .map_err(map_constraint_or_database)?;
            }
        }
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        self.deletion_status(operation_id)?
            .ok_or(ChatError::DatabaseUnavailable)
    }

    pub fn claim_next_deletion(
        &mut self,
        now: i64,
        lease_seconds: i64,
    ) -> Result<Option<ClaimedDeletion>, ChatError> {
        if now < 0 || !(1..=300).contains(&lease_seconds) {
            return Err(ChatError::InvalidInput);
        }
        let lease_expires_at = now
            .checked_add(lease_seconds)
            .ok_or(ChatError::InvalidInput)?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .execute(
                "UPDATE chat_deletion_jobs
                 SET desktop_state='incomplete', host_state=CASE
                       WHEN host_state='complete' THEN host_state ELSE 'incomplete' END,
                     runtime_state=CASE
                       WHEN runtime_state='complete' THEN runtime_state ELSE 'incomplete' END,
                     outcome_code='retry_limit_exceeded', updated_at=?1, lease_expires_at=0
                 WHERE attempt_count>=?2 AND outcome_code='pending'",
                params![now, OUTBOX_MAX_ATTEMPTS],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        type DeletionRow = (String, i64, Vec<u8>, String, String, String, i64);
        let row: Option<DeletionRow> = transaction
            .query_row(
                "SELECT operation_id, 1, encrypted_retry_ids, desktop_state,
                        host_state, runtime_state, attempt_count
                 FROM chat_deletion_jobs d
                 WHERE d.session_id IS NOT NULL AND d.attempt_count<?1
                   AND d.next_attempt_at<=?2
                   AND (d.lease_expires_at=0 OR d.lease_expires_at<=?2)
                   AND d.outcome_code='pending'
                   AND NOT EXISTS(
                     SELECT 1 FROM chat_turns t WHERE t.session_id=d.session_id
                       AND t.status IN ('queued', 'streaming', 'stopping')
                   )
                 ORDER BY d.next_attempt_at, d.operation_id LIMIT 1",
                params![OUTBOX_MAX_ATTEMPTS, now],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let Some((operation_id, version, payload, desktop, host, runtime, attempts)) = row else {
            transaction
                .commit()
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            return Ok(None);
        };
        if version != OUTBOX_PAYLOAD_VERSION {
            return Err(ChatError::DatabaseUnavailable);
        }
        let payload: DeletionRetryIdsV1 = decode_payload(&payload)?;
        let changed = transaction
            .execute(
                "UPDATE chat_deletion_jobs
                 SET attempt_count=attempt_count+1, lease_expires_at=?1, updated_at=?2
                 WHERE operation_id=?3 AND attempt_count=?4
                   AND (lease_expires_at=0 OR lease_expires_at<=?2)",
                params![lease_expires_at, now, operation_id, attempts],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::ConversationConflict);
        }
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        Ok(Some(ClaimedDeletion {
            operation_id: parse_uuid_value(&operation_id)?,
            agent_session_id: payload.agent_session_id,
            desktop_state: parse_cleanup_surface_state(&desktop)?,
            host_state: parse_cleanup_surface_state(&host)?,
            runtime_state: parse_cleanup_surface_state(&runtime)?,
            attempt_count: u8::try_from(attempts + 1)
                .map_err(|_| ChatError::DatabaseUnavailable)?,
        }))
    }

    pub fn record_cleanup_surfaces(
        &mut self,
        operation_id: Uuid,
        host_state: CleanupSurfaceState,
        runtime_state: CleanupSurfaceState,
        outcome_code: &str,
        next_attempt_at: i64,
    ) -> Result<(), ChatError> {
        validate_non_nil(operation_id)?;
        validate_outcome_code(outcome_code)?;
        if next_attempt_at < 0 {
            return Err(ChatError::InvalidInput);
        }
        let changed = self
            .connection
            .execute(
                "UPDATE chat_deletion_jobs
                 SET host_state=?1, runtime_state=?2, outcome_code='pending', last_error_code=?3,
                     updated_at=?4, next_attempt_at=?5, lease_expires_at=0
                 WHERE operation_id=?6 AND outcome_code='pending'",
                params![
                    host_state.as_str(),
                    runtime_state.as_str(),
                    outcome_code,
                    unix_seconds()?,
                    next_attempt_at,
                    operation_id.to_string()
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::ConversationConflict);
        }
        Ok(())
    }

    pub fn reschedule_deletion(
        &mut self,
        operation_id: Uuid,
        next_attempt_at: i64,
    ) -> Result<(), ChatError> {
        validate_non_nil(operation_id)?;
        if next_attempt_at < 0 {
            return Err(ChatError::InvalidInput);
        }
        let changed = self
            .connection
            .execute(
                "UPDATE chat_deletion_jobs SET lease_expires_at=0, next_attempt_at=?1,
                   updated_at=?2 WHERE operation_id=?3 AND outcome_code='pending'",
                params![next_attempt_at, unix_seconds()?, operation_id.to_string()],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::ConversationConflict);
        }
        Ok(())
    }

    pub fn complete_local_deletion(&mut self, operation_id: Uuid) -> Result<(), ChatError> {
        validate_non_nil(operation_id)?;
        let row: Option<(String, String, String, Vec<u8>)> = self
            .connection
            .query_row(
                "SELECT host_state, runtime_state, desktop_state, encrypted_retry_ids
                 FROM chat_deletion_jobs WHERE operation_id=?1 AND outcome_code='pending'",
                [operation_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let (host, runtime, desktop, payload) = row.ok_or(ChatError::NotFound)?;
        if parse_cleanup_surface_state(&host)? != CleanupSurfaceState::Complete
            || parse_cleanup_surface_state(&runtime)? != CleanupSurfaceState::Complete
        {
            return Err(ChatError::CleanupIncomplete);
        }
        let retry: DeletionRetryIdsV1 = decode_payload(&payload)?;
        if parse_cleanup_surface_state(&desktop)? != CleanupSurfaceState::Complete {
            let exists: bool = self
                .connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM chat_sessions
                     WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3)",
                    params![
                        retry.session_id.to_string(),
                        self.scope.owner_user_id,
                        self.scope.tenant_id
                    ],
                    |row| row.get(0),
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            if exists {
                self.delete_session_local(&retry.session_id.to_string())?;
            } else {
                self.checkpoint_after_delete()?;
            }
            self.connection
                .execute(
                    "UPDATE chat_deletion_jobs SET desktop_state='complete', updated_at=?1
                     WHERE operation_id=?2",
                    params![unix_seconds()?, operation_id.to_string()],
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?;
        }
        Ok(())
    }

    pub fn finalize_deletion_receipt(
        &mut self,
        operation_id: Uuid,
        completed_at: i64,
    ) -> Result<DeletionStatus, ChatError> {
        validate_non_nil(operation_id)?;
        if completed_at < 0 {
            return Err(ChatError::InvalidInput);
        }
        if let Some(status) = self.deletion_status(operation_id)? {
            if status.completed_at.is_some() {
                return Ok(status);
            }
        }
        let expires_at = completed_at
            .checked_add(DELETION_RECEIPT_TTL_SECONDS)
            .ok_or(ChatError::InvalidInput)?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let row: Option<(String, String, String, String, i64)> = transaction
            .query_row(
                "SELECT keyed_session_hash, desktop_state, host_state, runtime_state, requested_at
                 FROM chat_deletion_jobs WHERE operation_id=?1 AND outcome_code='pending'",
                [operation_id.to_string()],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let (keyed_hash, desktop, host, runtime, requested_at) = row.ok_or(ChatError::NotFound)?;
        if [desktop.as_str(), host.as_str(), runtime.as_str()]
            .iter()
            .any(|state| *state != "complete")
        {
            return Err(ChatError::CleanupIncomplete);
        }
        transaction
            .execute(
                "INSERT INTO chat_deletion_receipts(
                   operation_id, keyed_session_hash, desktop_state, host_state, runtime_state,
                   outcome, outcome_code, requested_at, completed_at, expires_at, schema_version
                 ) VALUES (?1, ?2, 'complete', 'complete', 'complete', 'complete',
                           'cleanup_complete', ?3, ?4, ?5, 1)",
                params![
                    operation_id.to_string(),
                    keyed_hash,
                    requested_at,
                    completed_at,
                    expires_at
                ],
            )
            .map_err(map_constraint_or_database)?;
        transaction
            .execute(
                "DELETE FROM chat_deletion_jobs WHERE operation_id=?1",
                [operation_id.to_string()],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        self.deletion_status(operation_id)?
            .ok_or(ChatError::DatabaseUnavailable)
    }

    pub fn deletion_status(&self, operation_id: Uuid) -> Result<Option<DeletionStatus>, ChatError> {
        validate_non_nil(operation_id)?;
        type StatusRow = (
            String,
            String,
            String,
            String,
            Option<String>,
            i64,
            Option<i64>,
            Option<i64>,
        );
        let row: Option<StatusRow> = self
            .connection
            .query_row(
                "SELECT desktop_state, host_state, runtime_state, outcome_code, last_error_code,
                        requested_at, NULL, NULL
                 FROM chat_deletion_jobs WHERE operation_id=?1
                 UNION ALL
                 SELECT desktop_state, host_state, runtime_state, outcome_code, NULL,
                        requested_at, completed_at, expires_at
                 FROM chat_deletion_receipts WHERE operation_id=?1
                 LIMIT 1",
                [operation_id.to_string()],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        row.map(
            |(
                desktop,
                host,
                runtime,
                code,
                last_error_code,
                requested_at,
                completed_at,
                expires_at,
            )| {
                Ok(DeletionStatus {
                    operation_id,
                    desktop_state: parse_cleanup_surface_state(&desktop)?,
                    host_state: parse_cleanup_surface_state(&host)?,
                    runtime_state: parse_cleanup_surface_state(&runtime)?,
                    outcome_code: code,
                    last_error_code,
                    requested_at,
                    completed_at,
                    expires_at,
                })
            },
        )
        .transpose()
    }

    pub fn deletion_status_for_session(
        &self,
        session_id: Uuid,
    ) -> Result<Option<DeletionStatus>, ChatError> {
        validate_non_nil(session_id)?;
        let keyed_hash = scoped_session_hash(
            &self.receipt_key,
            &self.scope.owner_user_id,
            &self.scope.tenant_id,
            session_id,
        );
        let operation_id: Option<String> = self
            .connection
            .query_row(
                "SELECT operation_id FROM chat_deletion_jobs
                 WHERE session_id=?1 AND keyed_session_hash=?2
                 UNION ALL
                 SELECT operation_id FROM chat_deletion_receipts
                 WHERE keyed_session_hash=?2
                 LIMIT 1",
                params![session_id.to_string(), keyed_hash],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        operation_id
            .map(|operation_id| parse_uuid_value(&operation_id))
            .transpose()?
            .map(|operation_id| self.deletion_status(operation_id))
            .transpose()
            .map(Option::flatten)
    }

    pub fn recovery_snapshot(&self) -> Result<RecoverySnapshot, ChatError> {
        let active_session_ids = {
            let mut statement = self
                .connection
                .prepare(
                    "SELECT DISTINCT s.id FROM chat_sessions s JOIN chat_turns t ON t.session_id=s.id
                     WHERE s.owner_user_id=?1 AND s.tenant_id=?2
                       AND t.status IN ('streaming', 'stopping') ORDER BY s.id",
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            let collected = statement
                .query_map(
                    params![self.scope.owner_user_id, self.scope.tenant_id],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?
                .map(|value| parse_uuid_value(&value.map_err(|_| ChatError::DatabaseUnavailable)?))
                .collect::<Result<Vec<_>, ChatError>>()?;
            collected
        };
        let operation_ids = {
            let mut statement = self
                .connection
                .prepare(
                    "SELECT operation_id FROM chat_deletion_jobs ORDER BY requested_at, operation_id",
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            let collected = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|_| ChatError::DatabaseUnavailable)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            collected
        };
        let deletions = operation_ids
            .into_iter()
            .map(|operation_id| {
                let operation_id = parse_uuid_value(&operation_id)?;
                self.deletion_status(operation_id)?
                    .ok_or(ChatError::DatabaseUnavailable)
            })
            .collect::<Result<Vec<_>, ChatError>>()?;
        Ok(RecoverySnapshot {
            active_session_ids,
            deletions,
        })
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub(crate) fn feat126_resume_candidates(
        &self,
    ) -> Result<Vec<Feat126ResumeCandidate>, ChatError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT b.public_task_id, s.agent_session_id, s.runtime_thread_id
                 FROM chat_sessions s
                 JOIN chat_public_task_bindings b ON b.session_id=s.id AND b.state='bound'
                 WHERE s.owner_user_id=?1 AND s.tenant_id=?2
                   AND s.agent_session_id IS NOT NULL AND s.runtime_thread_id IS NOT NULL
                 ORDER BY s.id",
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let candidates = statement
            .query_map(
                params![self.scope.owner_user_id, self.scope.tenant_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .map(|row| {
                let (task_id, agent_session_id, codex_thread_id) =
                    row.map_err(|_| ChatError::DatabaseUnavailable)?;
                Ok(Feat126ResumeCandidate {
                    task_id: parse_uuid_value(&task_id)?,
                    agent_session_id: parse_uuid_value(&agent_session_id)?,
                    codex_thread_id: parse_uuid_value(&codex_thread_id)?,
                })
            })
            .collect();
        candidates
    }

    pub fn purge_expired_deletion_receipts(&mut self, now: i64) -> Result<usize, ChatError> {
        if now < 0 {
            return Err(ChatError::InvalidInput);
        }
        self.connection
            .execute(
                "DELETE FROM chat_deletion_receipts WHERE expires_at<=?1",
                [now],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)
    }

    pub fn delete_session_local(&mut self, session_id: &str) -> Result<(), ChatError> {
        validate_uuid(session_id)?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let message_ids = {
            let mut statement = transaction
                .prepare("SELECT id FROM chat_messages WHERE session_id=?1 ORDER BY id")
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            let rows = statement
                .query_map([session_id], |row| row.get::<_, String>(0))
                .map_err(|_| ChatError::DatabaseUnavailable)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            rows
        };
        let attachment_ids = {
            let mut statement = transaction
                .prepare(
                    "SELECT DISTINCT a.id
                     FROM chat_attachments a
                     LEFT JOIN chat_messages m ON m.id=a.message_id
                     WHERE m.session_id=?1 OR a.draft_session_id=?1
                     ORDER BY a.id",
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            let rows = statement
                .query_map([session_id], |row| row.get::<_, String>(0))
                .map_err(|_| ChatError::DatabaseUnavailable)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            rows
        };
        let turn_ids = {
            let mut statement = transaction
                .prepare("SELECT id FROM chat_turns WHERE session_id=?1")
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            let collected = statement
                .query_map([session_id], |row| row.get::<_, String>(0))
                .map_err(|_| ChatError::DatabaseUnavailable)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            collected
        };
        let artifact_ids = {
            let mut statement = transaction
                .prepare("SELECT artifact_id FROM chat_output_artifacts WHERE session_id=?1")
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            let result = statement
                .query_map([session_id], |row| row.get::<_, String>(0))
                .map_err(|_| ChatError::DatabaseUnavailable)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            result
        };
        let changed = transaction
            .execute(
                "DELETE FROM chat_sessions WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3",
                params![session_id, self.scope.owner_user_id, self.scope.tenant_id],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if changed != 1 {
            return Err(ChatError::NotFound);
        }
        for (table, column) in [
            ("chat_sessions", "id"),
            ("chat_messages", "session_id"),
            ("chat_turns", "session_id"),
            ("chat_event_cursors", "session_id"),
            ("chat_outbox", "session_id"),
            ("chat_public_task_bindings", "session_id"),
            ("chat_output_artifacts", "session_id"),
        ] {
            let query = format!("SELECT count(*) FROM {table} WHERE {column}=?1");
            let count: i64 = transaction
                .query_row(&query, [session_id], |row| row.get(0))
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            if count != 0 {
                return Err(ChatError::CleanupIncomplete);
            }
        }
        for artifact_id in artifact_ids {
            for (table, column) in [
                ("chat_output_artifacts", "artifact_id"),
                ("chat_artifact_cleanup_receipts", "artifact_id"),
            ] {
                let query = format!("SELECT count(*) FROM {table} WHERE {column}=?1");
                let count: i64 = transaction
                    .query_row(&query, [artifact_id.as_str()], |row| row.get(0))
                    .map_err(|_| ChatError::DatabaseUnavailable)?;
                if count != 0 {
                    return Err(ChatError::CleanupIncomplete);
                }
            }
        }
        for turn_id in turn_ids {
            for table in ["chat_reasoning_items", "chat_reasoning_parts"] {
                let query = format!("SELECT count(*) FROM {table} WHERE turn_id=?1");
                let count: i64 = transaction
                    .query_row(&query, [turn_id.as_str()], |row| row.get(0))
                    .map_err(|_| ChatError::DatabaseUnavailable)?;
                if count != 0 {
                    return Err(ChatError::CleanupIncomplete);
                }
            }
        }
        for message_id in message_ids {
            for (table, column) in [
                ("chat_messages", "id"),
                ("chat_message_content_blocks", "message_id"),
            ] {
                let query = format!("SELECT count(*) FROM {table} WHERE {column}=?1");
                let count: i64 = transaction
                    .query_row(&query, [message_id.as_str()], |row| row.get(0))
                    .map_err(|_| ChatError::DatabaseUnavailable)?;
                if count != 0 {
                    return Err(ChatError::CleanupIncomplete);
                }
            }
        }
        for attachment_id in attachment_ids {
            for (table, column) in [
                ("chat_attachments", "id"),
                ("chat_attachment_chunks", "attachment_id"),
            ] {
                let query = format!("SELECT count(*) FROM {table} WHERE {column}=?1");
                let count: i64 = transaction
                    .query_row(&query, [attachment_id.as_str()], |row| row.get(0))
                    .map_err(|_| ChatError::DatabaseUnavailable)?;
                if count != 0 {
                    return Err(ChatError::CleanupIncomplete);
                }
            }
        }
        let foreign_key_violation: Option<String> = transaction
            .query_row(
                "SELECT \"table\" FROM pragma_foreign_key_check LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if foreign_key_violation.is_some() {
            return Err(ChatError::CleanupIncomplete);
        }
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        self.checkpoint_after_delete()
    }

    pub(super) fn checkpoint_after_delete(&self) -> Result<(), ChatError> {
        let secure_delete: i64 = self
            .connection
            .query_row("PRAGMA secure_delete", [], |row| row.get(0))
            .map_err(|_| ChatError::CleanupIncomplete)?;
        if secure_delete != 1 {
            return Err(ChatError::CleanupIncomplete);
        }
        let (busy, _, _): (i64, i64, i64) = self
            .connection
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(|_| ChatError::CleanupIncomplete)?;
        if busy != 0 {
            return Err(ChatError::CleanupIncomplete);
        }
        let wal = PathBuf::from(format!("{}-wal", self.database_path.to_string_lossy()));
        if wal.exists()
            && wal
                .metadata()
                .map_err(|_| ChatError::CleanupIncomplete)?
                .len()
                != 0
        {
            return Err(ChatError::CleanupIncomplete);
        }
        protect_database_files(&self.database_path)
    }

    fn checkpoint_attachment_cleanup(&mut self) -> Result<(), ChatError> {
        if !self.attachment_checkpoint_pending {
            return Ok(());
        }
        self.checkpoint_after_delete()?;
        self.attachment_checkpoint_pending = false;
        Ok(())
    }

    #[cfg(test)]
    fn insert_test_conversation(
        &mut self,
        project_id: &str,
        session_id: &str,
        turn_id: &str,
        canary: &str,
    ) {
        let now = unix_seconds().unwrap();
        self.connection
            .execute(
                "INSERT INTO chat_sessions(id, owner_user_id, tenant_id, project_id, title, title_source, title_job_status, created_at, last_activity_at)
                 VALUES (?1, ?2, ?3, ?4, 'Synthetic', 'fallback', 'not_started', ?5, ?5)",
                params![session_id, self.scope.owner_user_id, self.scope.tenant_id, project_id, now],
            )
            .unwrap();
        self.connection
            .execute(
                "INSERT INTO chat_messages(id, session_id, role, content, status, ordinal, created_at)
                 VALUES (?1, ?2, 'user', ?3, 'committed', 0, ?4)",
                params![Uuid::now_v7().to_string(), session_id, canary, now],
            )
            .unwrap();
        self.connection
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, status, terminal_at) VALUES (?1, ?2, ?3, 'completed', ?4)",
                params![turn_id, session_id, Uuid::now_v7().to_string(), now],
            )
            .unwrap();
    }
}

fn validate_reasoning(
    turn_status: ReasoningStatus,
    turn_reason_code: Option<&str>,
    items: &[ReasoningItem],
) -> Result<(), ChatError> {
    if items.len() > MAX_REASONING_ITEMS {
        return Err(ChatError::InvalidInput);
    }
    match turn_status {
        ReasoningStatus::Complete if turn_reason_code.is_some() || items.is_empty() => {
            return Err(ChatError::InvalidInput);
        }
        ReasoningStatus::Incomplete | ReasoningStatus::Unavailable
            if !valid_reason_code(turn_reason_code) =>
        {
            return Err(ChatError::InvalidInput);
        }
        _ => {}
    }
    if turn_status == ReasoningStatus::Incomplete && items.is_empty() {
        return Err(ChatError::InvalidInput);
    }
    let has_incomplete = items
        .iter()
        .any(|item| item.status == ReasoningStatus::Incomplete);
    let has_unavailable = items
        .iter()
        .any(|item| item.status == ReasoningStatus::Unavailable);
    let aggregate_consistent = match turn_status {
        ReasoningStatus::Complete => items
            .iter()
            .all(|item| item.status == ReasoningStatus::Complete),
        ReasoningStatus::Incomplete => {
            has_incomplete
                && !has_unavailable
                && items.iter().any(|item| {
                    item.status == ReasoningStatus::Incomplete
                        && item.reason_code.as_deref() == turn_reason_code
                })
        }
        ReasoningStatus::Unavailable => {
            items.is_empty()
                || (has_unavailable
                    && items.iter().any(|item| {
                        item.status == ReasoningStatus::Unavailable
                            && item.reason_code.as_deref() == turn_reason_code
                    }))
        }
    };
    if !aggregate_consistent {
        return Err(ChatError::InvalidInput);
    }
    let mut turn_bytes = 0_usize;
    for (expected_ordinal, item) in items.iter().enumerate() {
        if item.item_id.trim().is_empty()
            || item.item_id.len() > 255
            || item.item_ordinal != expected_ordinal
            || item.finalized_at_ms < 0
            || item.parts.len() > MAX_REASONING_PARTS
        {
            return Err(ChatError::InvalidInput);
        }
        let total_bytes: usize = item.parts.iter().map(|part| part.text.len()).sum();
        match item.status {
            ReasoningStatus::Complete
                if item.reason_code.is_some() || item.parts.is_empty() || total_bytes == 0 =>
            {
                return Err(ChatError::InvalidInput);
            }
            ReasoningStatus::Incomplete
                if !valid_reason_code(item.reason_code.as_deref())
                    || item.parts.is_empty()
                    || total_bytes == 0 =>
            {
                return Err(ChatError::InvalidInput);
            }
            ReasoningStatus::Unavailable
                if !valid_reason_code(item.reason_code.as_deref())
                    || !item.parts.is_empty()
                    || total_bytes != 0 =>
            {
                return Err(ChatError::InvalidInput);
            }
            _ => {}
        }
        if total_bytes > MAX_REASONING_ITEM_BYTES {
            return Err(ChatError::InvalidInput);
        }
        for (expected_index, part) in item.parts.iter().enumerate() {
            if part.content_index != expected_index
                || part.text.is_empty()
                || part.text.len() > MAX_REASONING_PART_BYTES
            {
                return Err(ChatError::InvalidInput);
            }
        }
        turn_bytes = turn_bytes
            .checked_add(total_bytes)
            .ok_or(ChatError::InvalidInput)?;
    }
    if turn_bytes > MAX_REASONING_TURN_BYTES {
        return Err(ChatError::InvalidInput);
    }
    Ok(())
}

fn encode_payload<T: Serialize>(payload: &T) -> Result<Vec<u8>, ChatError> {
    serde_json::to_vec(payload).map_err(|_| ChatError::DatabaseUnavailable)
}

fn decode_payload<T: for<'de> Deserialize<'de>>(payload: &[u8]) -> Result<T, ChatError> {
    serde_json::from_slice(payload).map_err(|_| ChatError::DatabaseUnavailable)
}

fn decode_create_payload(version: i64, payload: &[u8]) -> Result<CreatePayloadIdentity, ChatError> {
    match version {
        OUTBOX_PAYLOAD_VERSION => {
            let payload: CreateSessionPayloadV1 = decode_payload(payload)?;
            Ok(CreatePayloadIdentity {
                session_id: payload.session_id,
                task_id: payload.task_id,
                turn_id: payload.turn_id,
                turn_operation_id: payload.turn_operation_id,
                message_id: payload.message_id,
                block_digest: None,
            })
        }
        2 => {
            let payload: CreateSessionPayloadV2 = decode_payload(payload)?;
            if payload.block_digest.len() != 64 {
                return Err(ChatError::DatabaseUnavailable);
            }
            Ok(CreatePayloadIdentity {
                session_id: payload.session_id,
                task_id: payload.task_id,
                turn_id: payload.turn_id,
                turn_operation_id: payload.turn_operation_id,
                message_id: payload.message_id,
                block_digest: Some(payload.block_digest),
            })
        }
        _ => Err(ChatError::DatabaseUnavailable),
    }
}

fn encode_start_turn_payload(payload: &CreatePayloadIdentity) -> Result<Vec<u8>, ChatError> {
    match payload.block_digest.as_ref() {
        Some(block_digest) => encode_payload(&StartTurnPayloadV2 {
            turn_id: payload.turn_id,
            message_id: payload.message_id,
            block_digest: block_digest.clone(),
        }),
        None => encode_payload(&StartTurnPayloadV1 {
            turn_id: payload.turn_id,
            message_id: payload.message_id,
        }),
    }
}

fn insert_attachment(
    transaction: &Transaction<'_>,
    owner_user_id: &str,
    tenant_id: &str,
    attachment: PreparedAttachment,
    draft_target: &DraftTarget,
    draft_ordinal: i64,
) -> Result<AttachmentSummary, ChatError> {
    let PreparedAttachment {
        id,
        kind,
        safe_name,
        media_type,
        byte_size,
        sha256,
        imported_at,
        expires_at,
        content,
        chunks,
    } = attachment;
    if id.is_nil()
        || byte_size == 0
        || byte_size > super::attachment::MAX_ATTACHMENT_BYTES
        || content.len() != byte_size
        || sha256 != format!("{:x}", Sha256::digest(&content))
        || expires_at != imported_at + super::attachment::ATTACHMENT_TTL_SECONDS
        || chunks.len() > 128
        || (kind.as_str() == "file" && chunks.is_empty())
        || (kind.as_str() == "image" && !chunks.is_empty())
        || draft_ordinal < 0
        || chunks
            .iter()
            .any(|chunk| chunk.trim().is_empty() || chunk.len() > 16 * 1024)
    {
        return Err(ChatError::InvalidInput);
    }
    let target_kind = draft_target.kind();
    let target_session_id = draft_target.session_id().map(|value| value.to_string());
    transaction
        .execute(
            "INSERT INTO chat_attachments(
               id, owner_user_id, tenant_id, kind, safe_name, media_type, byte_size,
               sha256, state, imported_at, expires_at, content_blob,
               draft_target_kind, draft_session_id, draft_ordinal
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ready', ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                id.to_string(),
                owner_user_id,
                tenant_id,
                kind.as_str(),
                safe_name,
                media_type,
                i64::try_from(byte_size).map_err(|_| ChatError::InvalidInput)?,
                sha256,
                imported_at,
                expires_at,
                content,
                target_kind,
                target_session_id,
                draft_ordinal,
            ],
        )
        .map_err(map_constraint_or_database)?;
    for (ordinal, chunk) in chunks.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO chat_attachment_chunks(
                   attachment_id, chunk_ordinal, content, byte_count
                 ) VALUES (?1, ?2, ?3, ?4)",
                params![
                    id.to_string(),
                    i64::try_from(ordinal).map_err(|_| ChatError::InvalidInput)?,
                    chunk,
                    i64::try_from(chunk.len()).map_err(|_| ChatError::InvalidInput)?,
                ],
            )
            .map_err(map_constraint_or_database)?;
    }
    Ok(AttachmentSummary {
        attachment_id: id,
        kind: kind.as_str().to_owned(),
        safe_name,
        media_type,
        byte_size,
        state: "ready".to_owned(),
        expires_at,
    })
}

fn validate_draft_target(
    connection: &Connection,
    owner_user_id: &str,
    tenant_id: &str,
    draft_target: &DraftTarget,
) -> Result<(), ChatError> {
    let DraftTarget::Session(session_id) = draft_target else {
        return Ok(());
    };
    validate_non_nil(*session_id)?;
    let exists = connection
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM chat_sessions s
               WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3
                 AND NOT EXISTS(
                   SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id
                 )
             )",
            params![session_id.to_string(), owner_user_id, tenant_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(map_sqlite_error)?;
    if exists {
        Ok(())
    } else {
        Err(ChatError::NotFound)
    }
}

fn count_ready_attachments_for_target(
    connection: &Connection,
    owner_user_id: &str,
    tenant_id: &str,
    draft_target: &DraftTarget,
    now: i64,
) -> Result<usize, ChatError> {
    let target_kind = draft_target.kind();
    let target_session_id = draft_target.session_id().map(|value| value.to_string());
    let count = connection
        .query_row(
            "SELECT count(*) FROM chat_attachments
             WHERE owner_user_id=?1 AND tenant_id=?2
               AND state='ready' AND message_id IS NULL AND expires_at>?3
               AND draft_target_kind=?4
               AND ((?4='new' AND draft_session_id IS NULL)
                 OR (?4='session' AND draft_session_id=?5))",
            params![
                owner_user_id,
                tenant_id,
                now,
                target_kind,
                target_session_id,
            ],
            |row| row.get::<_, i64>(0),
        )
        .map_err(map_sqlite_error)?;
    usize::try_from(count).map_err(|_| ChatError::DatabaseUnavailable)
}

fn next_draft_attachment_ordinal(
    connection: &Connection,
    owner_user_id: &str,
    tenant_id: &str,
    draft_target: &DraftTarget,
) -> Result<i64, ChatError> {
    let target_kind = draft_target.kind();
    let target_session_id = draft_target.session_id().map(|value| value.to_string());
    let maximum = connection
        .query_row(
            "SELECT MAX(draft_ordinal) FROM chat_attachments
             WHERE owner_user_id=?1 AND tenant_id=?2
               AND state='ready' AND message_id IS NULL
               AND draft_target_kind=?3
               AND ((?3='new' AND draft_session_id IS NULL)
                 OR (?3='session' AND draft_session_id=?4))",
            params![owner_user_id, tenant_id, target_kind, target_session_id,],
            |row| row.get::<_, Option<i64>>(0),
        )
        .map_err(map_sqlite_error)?;
    maximum
        .unwrap_or(-1)
        .checked_add(1)
        .ok_or(ChatError::DatabaseUnavailable)
}

fn validate_draft_blocks(blocks: &[DraftContentBlock]) -> Result<(), ChatError> {
    if blocks.is_empty() || blocks.len() > 16 {
        return Err(ChatError::InvalidInput);
    }
    let mut attachment_ids = HashSet::new();
    let mut attachment_count = 0_usize;
    let mut total_text_bytes = 0_usize;
    for block in blocks {
        match block {
            DraftContentBlock::Text(text) => {
                validate_message(text)?;
                total_text_bytes = total_text_bytes
                    .checked_add(text.len())
                    .ok_or(ChatError::InvalidInput)?;
            }
            DraftContentBlock::File(id) | DraftContentBlock::Image(id) => {
                validate_non_nil(*id)?;
                attachment_count += 1;
                if !attachment_ids.insert(*id) {
                    return Err(ChatError::InvalidInput);
                }
            }
        }
    }
    if attachment_count > MAX_ATTACHMENTS_PER_MESSAGE || total_text_bytes > MAX_MESSAGE_BYTES {
        return Err(ChatError::InvalidInput);
    }
    Ok(())
}

fn draft_text_projection(blocks: &[DraftContentBlock]) -> String {
    blocks
        .iter()
        .filter_map(|block| match block {
            DraftContentBlock::Text(text) => Some(text.as_str()),
            DraftContentBlock::File(_) | DraftContentBlock::Image(_) => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn first_attachment_name(
    transaction: &Transaction<'_>,
    owner_user_id: &str,
    tenant_id: &str,
    draft_target: &DraftTarget,
    blocks: &[DraftContentBlock],
    now: i64,
) -> Result<Option<String>, ChatError> {
    let Some(id) = blocks.iter().find_map(|block| match block {
        DraftContentBlock::File(id) | DraftContentBlock::Image(id) => Some(*id),
        DraftContentBlock::Text(_) => None,
    }) else {
        return Ok(None);
    };
    let target_kind = draft_target.kind();
    let target_session_id = draft_target.session_id().map(|value| value.to_string());
    transaction
        .query_row(
            "SELECT safe_name FROM chat_attachments
             WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3
               AND state='ready' AND message_id IS NULL AND expires_at>?4
               AND draft_target_kind=?5
               AND ((?5='new' AND draft_session_id IS NULL)
                 OR (?5='session' AND draft_session_id=?6))",
            params![
                id.to_string(),
                owner_user_id,
                tenant_id,
                now,
                target_kind,
                target_session_id,
            ],
            |row| row.get(0),
        )
        .optional()
        .map_err(map_sqlite_error)
}

fn bind_draft_blocks(
    transaction: &Transaction<'_>,
    owner_user_id: &str,
    tenant_id: &str,
    draft_target: &DraftTarget,
    message_id: Uuid,
    blocks: &[DraftContentBlock],
    now: i64,
) -> Result<String, ChatError> {
    validate_draft_blocks(blocks)?;
    validate_draft_target(transaction, owner_user_id, tenant_id, draft_target)?;
    let target_kind = draft_target.kind();
    let target_session_id = draft_target.session_id().map(|value| value.to_string());
    let mut image_bytes = 0_usize;
    for (ordinal, block) in blocks.iter().enumerate() {
        match block {
            DraftContentBlock::Text(text) => {
                transaction
                    .execute(
                        "INSERT INTO chat_message_content_blocks(
                           message_id, block_ordinal, block_type, text_content
                         ) VALUES (?1, ?2, 'text', ?3)",
                        params![
                            message_id.to_string(),
                            i64::try_from(ordinal).map_err(|_| ChatError::InvalidInput)?,
                            text,
                        ],
                    )
                    .map_err(map_constraint_or_database)?;
            }
            DraftContentBlock::File(id) | DraftContentBlock::Image(id) => {
                let expected_kind = match block {
                    DraftContentBlock::File(_) => "file",
                    DraftContentBlock::Image(_) => "image",
                    DraftContentBlock::Text(_) => unreachable!(),
                };
                let row: Option<(String, i64)> = transaction
                    .query_row(
                        "SELECT kind, byte_size FROM chat_attachments
                         WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3
                           AND state='ready' AND message_id IS NULL AND expires_at>?4
                           AND draft_target_kind=?5
                           AND ((?5='new' AND draft_session_id IS NULL)
                             OR (?5='session' AND draft_session_id=?6))",
                        params![
                            id.to_string(),
                            owner_user_id,
                            tenant_id,
                            now,
                            target_kind,
                            target_session_id,
                        ],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .optional()
                    .map_err(map_sqlite_error)?;
                let (kind, byte_size) = row.ok_or(ChatError::NotFound)?;
                if kind != expected_kind {
                    return Err(ChatError::InvalidInput);
                }
                if expected_kind == "image" {
                    image_bytes = image_bytes
                        .checked_add(
                            usize::try_from(byte_size)
                                .map_err(|_| ChatError::DatabaseUnavailable)?,
                        )
                        .ok_or(ChatError::InvalidInput)?;
                    if image_bytes > super::attachment::MAX_ATTACHMENT_BYTES {
                        return Err(ChatError::InvalidInput);
                    }
                } else {
                    let has_context: bool = transaction
                        .query_row(
                            "SELECT EXISTS(
                               SELECT 1 FROM chat_attachment_chunks WHERE attachment_id=?1
                             )",
                            [id.to_string()],
                            |row| row.get(0),
                        )
                        .map_err(map_sqlite_error)?;
                    if !has_context {
                        return Err(ChatError::InvalidInput);
                    }
                }
                let changed = transaction
                    .execute(
                        "UPDATE chat_attachments
                         SET state='bound', message_id=?1,
                           draft_target_kind=NULL, draft_session_id=NULL, draft_ordinal=NULL
                         WHERE id=?2 AND owner_user_id=?3 AND tenant_id=?4
                           AND state='ready' AND message_id IS NULL AND expires_at>?5
                           AND draft_target_kind=?6
                           AND ((?6='new' AND draft_session_id IS NULL)
                             OR (?6='session' AND draft_session_id=?7))",
                        params![
                            message_id.to_string(),
                            id.to_string(),
                            owner_user_id,
                            tenant_id,
                            now,
                            target_kind,
                            target_session_id,
                        ],
                    )
                    .map_err(map_constraint_or_database)?;
                if changed != 1 {
                    return Err(ChatError::ConversationConflict);
                }
                transaction
                    .execute(
                        "INSERT INTO chat_message_content_blocks(
                           message_id, block_ordinal, block_type, attachment_id
                         ) VALUES (?1, ?2, ?3, ?4)",
                        params![
                            message_id.to_string(),
                            i64::try_from(ordinal).map_err(|_| ChatError::InvalidInput)?,
                            expected_kind,
                            id.to_string(),
                        ],
                    )
                    .map_err(map_constraint_or_database)?;
            }
        }
    }
    stored_content_block_digest(transaction, message_id)
}

fn stored_content_block_digest(
    connection: &Connection,
    message_id: Uuid,
) -> Result<String, ChatError> {
    let mut statement = connection
        .prepare(
            "SELECT b.block_ordinal, b.block_type, COALESCE(b.text_content, ''),
                    COALESCE(b.attachment_id, ''), COALESCE(a.sha256, '')
             FROM chat_message_content_blocks b
             LEFT JOIN chat_attachments a ON a.id=b.attachment_id
             WHERE b.message_id=?1 ORDER BY b.block_ordinal ASC",
        )
        .map_err(map_sqlite_error)?;
    let rows = statement
        .query_map([message_id.to_string()], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(map_sqlite_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(map_sqlite_error)?;
    if rows.is_empty() {
        return Err(ChatError::DatabaseUnavailable);
    }
    let mut digest = Sha256::new();
    for (ordinal, kind, text, attachment_id, attachment_digest) in rows {
        digest.update(ordinal.to_be_bytes());
        digest.update([0]);
        digest.update(kind.as_bytes());
        digest.update([0]);
        digest.update(text.as_bytes());
        digest.update([0]);
        digest.update(attachment_id.as_bytes());
        digest.update([0]);
        digest.update(attachment_digest.as_bytes());
        digest.update([0xff]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn draft_matches_stored_blocks(
    connection: &Connection,
    message_id: Uuid,
    blocks: &[DraftContentBlock],
) -> Result<bool, ChatError> {
    let mut statement = connection
        .prepare(
            "SELECT block_type, text_content, attachment_id
             FROM chat_message_content_blocks
             WHERE message_id=?1 ORDER BY block_ordinal ASC",
        )
        .map_err(map_sqlite_error)?;
    let stored = statement
        .query_map([message_id.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(map_sqlite_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(map_sqlite_error)?;
    if stored.len() != blocks.len() {
        return Ok(false);
    }
    for (stored, requested) in stored.iter().zip(blocks) {
        let matches = match requested {
            DraftContentBlock::Text(text) => {
                stored.0 == "text"
                    && stored.1.as_deref() == Some(text.as_str())
                    && stored.2.is_none()
            }
            DraftContentBlock::File(id) => {
                stored.0 == "file"
                    && stored.1.is_none()
                    && stored.2.as_deref() == Some(id.to_string().as_str())
            }
            DraftContentBlock::Image(id) => {
                stored.0 == "image"
                    && stored.1.is_none()
                    && stored.2.as_deref() == Some(id.to_string().as_str())
            }
        };
        if !matches {
            return Ok(false);
        }
    }
    Ok(true)
}

fn lexical_terms(value: &str) -> HashSet<String> {
    value
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.chars().count() >= 2)
        .map(|term| term.to_lowercase())
        .take(256)
        .collect()
}

fn select_attachment_context(
    connection: &Connection,
    attachment_id: Uuid,
    query_terms: &HashSet<String>,
    byte_budget: usize,
) -> Result<Vec<String>, ChatError> {
    if byte_budget == 0 {
        return Err(ChatError::InvalidInput);
    }
    let mut statement = connection
        .prepare(
            "SELECT c.chunk_ordinal, c.content
             FROM chat_attachment_chunks c JOIN chat_attachments a ON a.id=c.attachment_id
             WHERE c.attachment_id=?1 AND a.state='bound'
             ORDER BY c.chunk_ordinal ASC",
        )
        .map_err(map_sqlite_error)?;
    let mut chunks = statement
        .query_map([attachment_id.to_string()], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(map_sqlite_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(map_sqlite_error)?
        .into_iter()
        .map(|(ordinal, content)| {
            let content_terms = lexical_terms(&content);
            let score = if query_terms.is_empty() {
                0
            } else {
                query_terms.intersection(&content_terms).count()
            };
            (ordinal, score, content)
        })
        .collect::<Vec<_>>();
    chunks.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    let mut selected = Vec::new();
    let mut used = 0_usize;
    for (ordinal, _, content) in chunks {
        if selected.len() >= 32 {
            break;
        }
        let separator = usize::from(!selected.is_empty());
        if used + separator >= byte_budget {
            break;
        }
        let available = byte_budget - used - separator;
        let piece = truncate_utf8_for_budget(&content, available);
        if piece.is_empty() {
            continue;
        }
        used += separator + piece.len();
        selected.push((ordinal, piece.to_owned()));
        if used >= byte_budget {
            break;
        }
    }
    selected.sort_by_key(|entry| entry.0);
    Ok(selected.into_iter().map(|entry| entry.1).collect())
}

fn truncate_utf8_for_budget(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut boundary = max_bytes;
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    &value[..boundary]
}

fn parse_uuid_value(value: &str) -> Result<Uuid, ChatError> {
    let parsed = Uuid::parse_str(value).map_err(|_| ChatError::DatabaseUnavailable)?;
    if parsed.is_nil() {
        return Err(ChatError::DatabaseUnavailable);
    }
    Ok(parsed)
}

fn validate_non_nil(value: Uuid) -> Result<(), ChatError> {
    if value.is_nil() {
        Err(ChatError::InvalidInput)
    } else {
        Ok(())
    }
}

fn parse_outbox_kind(value: &str) -> Result<OutboxKind, ChatError> {
    match value {
        "create_session" => Ok(OutboxKind::CreateSession),
        "start_turn" => Ok(OutboxKind::StartTurn),
        "interrupt_turn" => Ok(OutboxKind::InterruptTurn),
        "generate_title" => Ok(OutboxKind::GenerateTitle),
        "delete_session" => Ok(OutboxKind::DeleteSession),
        _ => Err(ChatError::DatabaseUnavailable),
    }
}

fn parse_outbox_state(value: &str) -> Result<OutboxState, ChatError> {
    match value {
        "pending" => Ok(OutboxState::Pending),
        "inflight" => Ok(OutboxState::Inflight),
        "done" => Ok(OutboxState::Done),
        "failed" => Ok(OutboxState::Failed),
        _ => Err(ChatError::DatabaseUnavailable),
    }
}

fn parse_public_task_binding_state(value: &str) -> Result<PublicTaskBindingState, ChatError> {
    match value {
        "pending" => Ok(PublicTaskBindingState::Pending),
        "inflight" => Ok(PublicTaskBindingState::Inflight),
        "bound" => Ok(PublicTaskBindingState::Bound),
        "blocked_auth" => Ok(PublicTaskBindingState::BlockedAuth),
        "retry_wait" => Ok(PublicTaskBindingState::RetryWait),
        "denied" => Ok(PublicTaskBindingState::Denied),
        "failed" => Ok(PublicTaskBindingState::Failed),
        _ => Err(ChatError::DatabaseUnavailable),
    }
}

fn parse_cleanup_surface_state(value: &str) -> Result<CleanupSurfaceState, ChatError> {
    match value {
        "pending" => Ok(CleanupSurfaceState::Pending),
        "complete" => Ok(CleanupSurfaceState::Complete),
        "incomplete" => Ok(CleanupSurfaceState::Incomplete),
        "not_attempted" => Ok(CleanupSurfaceState::NotAttempted),
        _ => Err(ChatError::DatabaseUnavailable),
    }
}

fn validate_outcome_code(value: &str) -> Result<(), ChatError> {
    if value.is_empty()
        || value.len() > 128
        || value.contains('\0')
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(ChatError::InvalidInput);
    }
    Ok(())
}

fn parse_title_source(value: &str) -> Result<SessionTitleSource, ChatError> {
    match value {
        "fallback" => Ok(SessionTitleSource::Fallback),
        "model" => Ok(SessionTitleSource::Model),
        "user" => Ok(SessionTitleSource::User),
        _ => Err(ChatError::DatabaseUnavailable),
    }
}

fn page_size(requested: Option<usize>) -> Result<usize, ChatError> {
    let limit = requested.unwrap_or(DEFAULT_PAGE_SIZE);
    if limit == 0 || limit > MAX_PAGE_SIZE {
        return Err(ChatError::InvalidInput);
    }
    Ok(limit)
}

fn validate_message(value: &str) -> Result<(), ChatError> {
    if value.trim().is_empty() || value.len() > MAX_MESSAGE_BYTES || value.contains('\0') {
        return Err(ChatError::InvalidInput);
    }
    Ok(())
}

pub(super) fn validate_message_output(value: &str) -> Result<(), ChatError> {
    if value.len() > MAX_MESSAGE_BYTES || value.contains('\0') {
        return Err(ChatError::InvalidInput);
    }
    Ok(())
}

fn fallback_title(input: &str) -> String {
    let safe = input
        .chars()
        .map(|character| {
            if contains_forbidden_title_character(&character.to_string()) {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    let collapsed = safe.split_whitespace().collect::<Vec<_>>().join(" ");
    let title = collapsed.graphemes(true).take(40).collect::<String>();
    if title.is_empty() {
        "新任务".to_owned()
    } else {
        title
    }
}

fn validate_user_title(value: &str) -> Result<(), ChatError> {
    let trimmed = value.trim();
    let graphemes = trimmed.graphemes(true).count();
    if trimmed.is_empty() || graphemes > 80 || contains_forbidden_title_character(trimmed) {
        return Err(ChatError::InvalidInput);
    }
    Ok(())
}

fn validate_model_title(value: &str) -> Result<(), ChatError> {
    use unicode_normalization::UnicodeNormalization;

    let graphemes = value.graphemes(true).count();
    if value.is_empty()
        || value.trim() != value
        || graphemes > 40
        || value.nfc().collect::<String>() != value
        || contains_forbidden_title_character(value)
        || value
            .chars()
            .any(|character| matches!(character, '<' | '>' | '`' | '[' | ']' | '{' | '}'))
    {
        return Err(ChatError::InvalidInput);
    }
    Ok(())
}

fn contains_forbidden_title_character(value: &str) -> bool {
    value.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '\u{061c}'
                    | '\u{200e}'
                    | '\u{200f}'
                    | '\u{202a}'..='\u{202e}'
                    | '\u{2066}'..='\u{2069}'
            )
    })
}

pub(super) fn validate_cursor(cursor: &StoredEventCursor) -> Result<(), ChatError> {
    validate_non_nil(cursor.stream_id)?;
    validate_non_nil(cursor.event_id)?;
    if cursor.sequence == 0 || cursor.sequence > i64::MAX as u64 {
        return Err(ChatError::InvalidInput);
    }
    Ok(())
}

pub(super) fn advance_cursor(
    transaction: &rusqlite::Connection,
    session_id: &str,
    cursor: &StoredEventCursor,
) -> Result<(), ChatError> {
    let existing: Option<(String, i64, String)> = transaction
        .query_row(
            "SELECT stream_id, sequence, event_id FROM chat_event_cursors WHERE session_id=?1",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| ChatError::DatabaseUnavailable)?;
    if let Some((stream_id, sequence, event_id)) = existing {
        if stream_id != cursor.stream_id.to_string() {
            return Err(ChatError::ConversationConflict);
        }
        let cursor_sequence =
            i64::try_from(cursor.sequence).map_err(|_| ChatError::InvalidInput)?;
        if sequence == cursor_sequence && event_id == cursor.event_id.to_string() {
            return Ok(());
        }
        if cursor_sequence <= sequence {
            return Err(ChatError::ConversationConflict);
        }
        transaction
            .execute(
                "UPDATE chat_event_cursors SET sequence=?1, event_id=?2 WHERE session_id=?3",
                params![cursor_sequence, cursor.event_id.to_string(), session_id],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
    } else {
        transaction
            .execute(
                "INSERT INTO chat_event_cursors(session_id, stream_id, sequence, event_id)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    session_id,
                    cursor.stream_id.to_string(),
                    i64::try_from(cursor.sequence).map_err(|_| ChatError::InvalidInput)?,
                    cursor.event_id.to_string()
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
    }
    Ok(())
}

fn replace_reasoning(
    transaction: &rusqlite::Transaction<'_>,
    turn_id: &str,
    items: &[ReasoningItem],
) -> Result<(), ChatError> {
    transaction
        .execute(
            "DELETE FROM chat_reasoning_items WHERE turn_id=?1",
            [turn_id],
        )
        .map_err(|_| ChatError::DatabaseUnavailable)?;
    for item in items {
        let total_bytes: usize = item.parts.iter().map(|part| part.text.len()).sum();
        transaction
            .execute(
                "INSERT INTO chat_reasoning_items(
                   turn_id, item_id, item_ordinal, status, reason_code, total_bytes, finalized_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    turn_id,
                    item.item_id,
                    item.item_ordinal as i64,
                    item.status.as_str(),
                    item.reason_code,
                    total_bytes as i64,
                    item.finalized_at_ms
                ],
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        for part in &item.parts {
            transaction
                .execute(
                    "INSERT INTO chat_reasoning_parts(
                       turn_id, item_id, content_index, text, byte_count
                     ) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        turn_id,
                        item.item_id,
                        part.content_index as i64,
                        part.text,
                        part.text.len() as i64
                    ],
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?;
        }
    }
    Ok(())
}

fn load_history_messages(
    connection: &Connection,
    turn_ids: &[String],
    turns: &mut [HistoryTurn],
) -> Result<(), ChatError> {
    let placeholders = std::iter::repeat_n("?", turn_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT turn_id, id, role, content, status, ordinal, created_at
         FROM chat_messages WHERE turn_id IN ({placeholders})
         ORDER BY ordinal"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|_| ChatError::DatabaseUnavailable)?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(turn_ids.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .map_err(|_| ChatError::DatabaseUnavailable)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| ChatError::DatabaseUnavailable)?;
    for (turn_id, message_id, role, content, status, ordinal, created_at) in rows {
        let turn_id = parse_uuid_value(&turn_id)?;
        let turn = turns
            .iter_mut()
            .find(|turn| turn.turn_id == turn_id)
            .ok_or(ChatError::DatabaseUnavailable)?;
        turn.messages.push(HistoryMessage {
            message_id: parse_uuid_value(&message_id)?,
            role,
            content,
            status,
            ordinal: u64::try_from(ordinal).map_err(|_| ChatError::DatabaseUnavailable)?,
            created_at,
        });
    }
    Ok(())
}

fn load_history_reasoning_metadata(
    connection: &Connection,
    turn_ids: &[String],
    turns: &mut [HistoryTurn],
) -> Result<(), ChatError> {
    let placeholders = std::iter::repeat_n("?", turn_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT i.turn_id, i.item_id, i.item_ordinal, i.status, i.reason_code,
                i.total_bytes, i.finalized_at_ms, count(p.content_index)
         FROM chat_reasoning_items i
         LEFT JOIN chat_reasoning_parts p
           ON p.turn_id=i.turn_id AND p.item_id=i.item_id
         WHERE i.turn_id IN ({placeholders})
         GROUP BY i.turn_id, i.item_id
         ORDER BY i.turn_id, i.item_ordinal"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|_| ChatError::DatabaseUnavailable)?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(turn_ids.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
            ))
        })
        .map_err(|_| ChatError::DatabaseUnavailable)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| ChatError::DatabaseUnavailable)?;
    for (
        turn_id,
        item_id,
        item_ordinal,
        status,
        reason_code,
        total_bytes,
        finalized_at_ms,
        part_count,
    ) in rows
    {
        let turn_id = parse_uuid_value(&turn_id)?;
        let turn = turns
            .iter_mut()
            .find(|turn| turn.turn_id == turn_id)
            .ok_or(ChatError::DatabaseUnavailable)?;
        turn.reasoning.push(HistoryReasoningMetadata {
            item_id,
            item_ordinal: usize::try_from(item_ordinal)
                .map_err(|_| ChatError::DatabaseUnavailable)?,
            status: parse_reasoning_status(&status)?,
            reason_code,
            total_bytes: usize::try_from(total_bytes)
                .map_err(|_| ChatError::DatabaseUnavailable)?,
            part_count: usize::try_from(part_count).map_err(|_| ChatError::DatabaseUnavailable)?,
            finalized_at_ms,
        });
    }
    Ok(())
}

#[cfg(feature = "feat126-s10-driver")]
fn retry_r8_sqlite_busy_until<T, F, N, S>(
    deadline: Instant,
    mut operation: F,
    mut now: N,
    mut sleep: S,
) -> Result<T, ChatError>
where
    F: FnMut() -> Result<T, ChatError>,
    N: FnMut() -> Instant,
    S: FnMut(Duration),
{
    let mut retrying = false;
    loop {
        if retrying && deadline.saturating_duration_since(now()).is_zero() {
            return Err(ChatError::DatabaseBusy);
        }
        match operation() {
            Ok(value) => return Ok(value),
            Err(error @ ChatError::DatabaseBusy) => {
                let remaining = deadline.saturating_duration_since(now());
                if remaining <= R8_IDEMPOTENCY_RETRY_DELAY {
                    return Err(error);
                }
                sleep(R8_IDEMPOTENCY_RETRY_DELAY);
                retrying = true;
            }
            Err(error) => return Err(error),
        }
    }
}

fn map_constraint_or_database(error: rusqlite::Error) -> ChatError {
    match error {
        rusqlite::Error::SqliteFailure(ref inner, _)
            if inner.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            ChatError::ConversationConflict
        }
        error => map_sqlite_error(error),
    }
}

fn valid_reason_code(value: Option<&str>) -> bool {
    matches!(
        value,
        Some(
            "reasoning_not_emitted"
                | "turn_interrupted"
                | "stream_gap"
                | "runtime_error"
                | "limit_exceeded"
                | "protocol_error"
                | "host_shutdown"
        )
    )
}

fn parse_reasoning_status(value: &str) -> Result<ReasoningStatus, ChatError> {
    match value {
        "complete" => Ok(ReasoningStatus::Complete),
        "incomplete" => Ok(ReasoningStatus::Incomplete),
        "unavailable" => Ok(ReasoningStatus::Unavailable),
        _ => Err(ChatError::DatabaseUnavailable),
    }
}

pub fn validate_project_path(path: &Path) -> Result<PathBuf, ChatError> {
    if !path.is_absolute() {
        return Err(ChatError::InvalidInput);
    }
    let original = fs::symlink_metadata(path).map_err(|_| ChatError::ProjectUnavailable)?;
    if original.file_type().is_symlink() || !original.is_dir() {
        return Err(ChatError::ProjectUnavailable);
    }
    let canonical = fs::canonicalize(path).map_err(|_| ChatError::ProjectUnavailable)?;
    let canonical_metadata =
        fs::symlink_metadata(&canonical).map_err(|_| ChatError::ProjectUnavailable)?;
    if canonical_metadata.file_type().is_symlink()
        || !canonical_metadata.is_dir()
        || canonical_metadata.uid() != unsafe { libc::geteuid() }
    {
        return Err(ChatError::ProjectUnavailable);
    }
    Ok(canonical)
}

fn prepare_chat_directory(path: &Path) -> Result<(), ChatError> {
    if path.exists() {
        validate_owner_only_directory(path)?;
    } else {
        fs::create_dir_all(path).map_err(|_| ChatError::DatabaseUnsafe)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| ChatError::DatabaseUnsafe)?;
        validate_owner_only_directory(path)?;
    }
    exclude_from_backup(path)?;
    Ok(())
}

fn prepare_database_file(path: &Path) -> Result<(), ChatError> {
    match fs::symlink_metadata(path) {
        Ok(_) => validate_owner_only_file(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(path)
                .map_err(|_| ChatError::DatabaseUnsafe)?;
            validate_owner_only_file(path)
        }
        Err(_) => Err(ChatError::DatabaseUnsafe),
    }
}

fn validate_owner_only_directory(path: &Path) -> Result<(), ChatError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| ChatError::DatabaseUnsafe)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o077 != 0
    {
        return Err(ChatError::DatabaseUnsafe);
    }
    Ok(())
}

fn validate_owner_only_file(path: &Path) -> Result<(), ChatError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| ChatError::DatabaseUnsafe)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o077 != 0
        || metadata.nlink() != 1
    {
        return Err(ChatError::DatabaseUnsafe);
    }
    Ok(())
}

fn apply_raw_key(connection: &Connection, key: &DatabaseKey) -> Result<(), ChatError> {
    let result = unsafe {
        rusqlite::ffi::sqlite3_key_v2(
            connection.handle(),
            std::ptr::null(),
            key.expose().as_ptr().cast(),
            key.expose().len() as i32,
        )
    };
    if result != rusqlite::ffi::SQLITE_OK {
        return Err(ChatError::DatabaseUnavailable);
    }
    Ok(())
}

fn configure_connection(connection: &Connection) -> Result<(), ChatError> {
    connection
        .execute_batch(
            "PRAGMA cipher_memory_security=ON;
             PRAGMA foreign_keys=ON;
             PRAGMA journal_mode=WAL;
             PRAGMA synchronous=FULL;
             PRAGMA fullfsync=ON;
             PRAGMA checkpoint_fullfsync=ON;
             PRAGMA secure_delete=ON;
             PRAGMA busy_timeout=5000;
             PRAGMA wal_autocheckpoint=1000;
             PRAGMA journal_size_limit=1048576;
             PRAGMA trusted_schema=OFF;",
        )
        .map_err(map_sqlite_error)?;
    for (pragma, expected) in [
        ("foreign_keys", 1_i64),
        ("synchronous", 2),
        ("fullfsync", 1),
        ("checkpoint_fullfsync", 1),
        ("secure_delete", 1),
        ("busy_timeout", 5000),
        ("wal_autocheckpoint", 1000),
        ("journal_size_limit", 1048576),
        ("trusted_schema", 0),
    ] {
        let query = format!("PRAGMA {pragma}");
        let actual: i64 = connection
            .query_row(&query, [], |row| row.get(0))
            .map_err(map_sqlite_error)?;
        if actual != expected {
            return Err(ChatError::DatabaseUnavailable);
        }
    }
    let journal_mode: String = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .map_err(map_sqlite_error)?;
    if !journal_mode.eq_ignore_ascii_case("wal") {
        return Err(ChatError::DatabaseUnavailable);
    }
    Ok(())
}

fn protect_database_files(database_path: &Path) -> Result<(), ChatError> {
    for path in [
        database_path.to_path_buf(),
        PathBuf::from(format!("{}-wal", database_path.to_string_lossy())),
        PathBuf::from(format!("{}-shm", database_path.to_string_lossy())),
    ] {
        if path.exists() {
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
                .map_err(|_| ChatError::DatabaseUnsafe)?;
            validate_owner_only_file(&path)?;
            exclude_from_backup(&path)?;
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn exclude_from_backup(path: &Path) -> Result<(), ChatError> {
    use objc2_foundation::{NSNumber, NSString, NSURLIsExcludedFromBackupKey, NSURL};

    let path = path.to_str().ok_or(ChatError::DatabaseUnsafe)?;
    let string = NSString::from_str(path);
    let url = NSURL::fileURLWithPath(&string);
    let value = NSNumber::numberWithBool(true);
    unsafe { url.setResourceValue_forKey_error(Some(&value), NSURLIsExcludedFromBackupKey) }
        .map_err(|_| ChatError::DatabaseUnsafe)?;
    let mut confirmed = None;
    unsafe { url.getResourceValue_forKey_error(&mut confirmed, NSURLIsExcludedFromBackupKey) }
        .map_err(|_| ChatError::DatabaseUnsafe)?;
    let confirmed = confirmed
        .as_deref()
        .and_then(|object| object.downcast_ref::<NSNumber>())
        .is_some_and(NSNumber::boolValue);
    if !confirmed {
        return Err(ChatError::DatabaseUnsafe);
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn exclude_from_backup(_path: &Path) -> Result<(), ChatError> {
    Ok(())
}

fn validate_uuid(value: &str) -> Result<(), ChatError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| ChatError::InvalidInput)
}

fn path_hash(path: &Path) -> String {
    format!("{:x}", Sha256::digest(path.as_os_str().as_encoded_bytes()))
}

fn scoped_session_hash(
    receipt_key: &ReceiptKey,
    owner_user_id: &str,
    tenant_id: &str,
    session_id: Uuid,
) -> String {
    let message = format!("v1\0{owner_user_id}\0{tenant_id}\0{session_id}");
    let digest = hmac_sha256(receipt_key.expose(), message.as_bytes());
    format!("{digest:x}")
}

fn hmac_sha256(key: &[u8; 32], message: &[u8]) -> sha2::digest::Output<Sha256> {
    const BLOCK_BYTES: usize = 64;
    let mut inner_pad = [0x36_u8; BLOCK_BYTES];
    let mut outer_pad = [0x5c_u8; BLOCK_BYTES];
    for (index, byte) in key.iter().enumerate() {
        inner_pad[index] ^= byte;
        outer_pad[index] ^= byte;
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner_digest = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);
    outer.finalize()
}

fn unix_seconds() -> Result<i64, ChatError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .map_err(|_| ChatError::DatabaseUnavailable)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn scope() -> ChatScope {
        ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap()
    }

    fn open_repository(root: &Path, key_byte: u8) -> ChatRepository {
        ChatRepository::open(
            &root.join("chat"),
            &DatabaseKey::from_bytes([key_byte; 32]),
            ReceiptKey::from_bytes([key_byte.wrapping_add(1); 32]),
            scope(),
        )
        .expect("open SQLCipher repository")
    }

    fn open_repository_for_scope(root: &Path, key_byte: u8, scope: ChatScope) -> ChatRepository {
        ChatRepository::open(
            &root.join("chat"),
            &DatabaseKey::from_bytes([key_byte; 32]),
            ReceiptKey::from_bytes([key_byte.wrapping_add(1); 32]),
            scope,
        )
        .expect("open scoped SQLCipher repository")
    }

    fn register_synthetic_project(repository: &mut ChatRepository, root: &Path) -> Uuid {
        let project_path = root.join(format!("project-{}", Uuid::now_v7()));
        fs::create_dir(&project_path).unwrap();
        Uuid::parse_str(
            &repository
                .register_project(&project_path, b"synthetic-bookmark")
                .unwrap()
                .id,
        )
        .unwrap()
    }

    fn bind_and_accept_first_turn(
        repository: &mut ChatRepository,
        pending: &PendingConversation,
        now: i64,
    ) -> (Uuid, Uuid) {
        let create = repository
            .claim_next_conversation_outbox(now.max(unix_seconds().unwrap()), 30)
            .unwrap()
            .expect("create outbox");
        assert_eq!(create.operation_id, pending.create_operation_id);
        let dispatch = repository
            .load_create_session_dispatch(create.operation_id)
            .unwrap();
        assert_eq!(dispatch.public_task_id, None);
        let public_task_id = Uuid::now_v7();
        repository
            .bind_public_task(create.operation_id, public_task_id, now)
            .unwrap();
        repository
            .reschedule_outbox(create.operation_id, now)
            .unwrap();
        let create = repository
            .claim_next_conversation_outbox(now.max(unix_seconds().unwrap()), 30)
            .unwrap()
            .expect("bound create outbox");
        let dispatch = repository
            .load_create_session_dispatch(create.operation_id)
            .unwrap();
        assert_eq!(dispatch.public_task_id, Some(public_task_id));
        let agent_session_id = Uuid::now_v7();
        let thread_id = Uuid::now_v7();
        repository
            .bind_host_session_and_enqueue_turn(
                create.operation_id,
                public_task_id,
                agent_session_id,
                thread_id,
            )
            .unwrap();
        let turn = repository
            .claim_next_conversation_outbox(now.max(unix_seconds().unwrap()), 30)
            .unwrap()
            .expect("turn outbox");
        assert_eq!(turn.operation_id, pending.turn_operation_id);
        let turn_dispatch = repository
            .load_start_turn_dispatch(turn.operation_id)
            .unwrap();
        assert_eq!(turn_dispatch.input, "首条消息");
        let runtime_turn_id = Uuid::now_v7();
        repository
            .suspend_started_turn_retry(turn.operation_id, runtime_turn_id)
            .unwrap();
        (agent_session_id, thread_id)
    }

    fn commit_synthetic_terminal(
        repository: &mut ChatRepository,
        session_id: Uuid,
        stream_id: Uuid,
        sequence: u64,
        answer: &str,
    ) {
        let context = repository.active_turn_context(session_id).unwrap();
        repository
            .persist_turn_progress(&TurnProgress {
                local_turn_id: context.turn_id,
                assistant_text: answer.to_owned(),
                cursor: StoredEventCursor {
                    stream_id,
                    sequence,
                    event_id: Uuid::now_v7(),
                },
            })
            .unwrap();
        repository
            .commit_terminal_turn(&TerminalTurnCommit {
                local_turn_id: context.turn_id,
                terminal_status: "completed".to_owned(),
                terminal_at: unix_seconds().unwrap(),
                assistant_text: answer.to_owned(),
                cursor: StoredEventCursor {
                    stream_id,
                    sequence: sequence + 1,
                    event_id: Uuid::now_v7(),
                },
                reasoning_status: ReasoningStatus::Unavailable,
                reasoning_reason_code: Some("reasoning_not_emitted".to_owned()),
                reasoning_items: Vec::new(),
            })
            .unwrap();
    }

    #[test]
    fn sqlcipher_file_permissions_pragmas_and_wrong_key_fail_closed() {
        let root = std::env::temp_dir().join(format!("yijie-chat-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let repository = open_repository(&root, 7);
        assert_eq!(
            repository.schema_version().unwrap(),
            migrations::LATEST_SCHEMA_VERSION
        );
        let database_path = root.join("chat").join(DATABASE_FILE_NAME);
        let metadata = fs::symlink_metadata(&database_path).unwrap();
        assert_eq!(metadata.mode() & 0o077, 0);
        drop(repository);

        let wrong = ChatRepository::open(
            &root.join("chat"),
            &DatabaseKey::from_bytes([8; 32]),
            ReceiptKey::from_bytes([9; 32]),
            scope(),
        );
        assert!(matches!(wrong, Err(ChatError::DatabaseUnavailable)));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unsafe_database_path_and_project_paths_fail_closed() {
        let root = std::env::temp_dir().join(format!("yijie-chat-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let chat = root.join("chat");
        fs::create_dir(&chat).unwrap();
        fs::set_permissions(&chat, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(matches!(
            ChatRepository::open(
                &chat,
                &DatabaseKey::from_bytes([3; 32]),
                ReceiptKey::from_bytes([4; 32]),
                scope(),
            ),
            Err(ChatError::DatabaseUnsafe)
        ));
        assert_eq!(
            validate_project_path(Path::new("relative")),
            Err(ChatError::InvalidInput)
        );
        let real = root.join("real-project");
        fs::create_dir(&real).unwrap();
        let link = root.join("linked-project");
        symlink(&real, &link).unwrap();
        assert_eq!(
            validate_project_path(&link),
            Err(ChatError::ProjectUnavailable)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reasoning_is_terminal_transactional_bounded_and_cascades_on_delete() {
        let root = std::env::temp_dir().join(format!("yijie-chat-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let mut repository = open_repository(&root, 11);
        let project_path = root.join("project");
        fs::create_dir(&project_path).unwrap();
        let project = repository
            .register_project(&project_path, b"synthetic-bookmark")
            .unwrap();
        let session_id = Uuid::now_v7().to_string();
        let turn_id = Uuid::now_v7().to_string();
        let canary = "FEAT126-RAW-REASONING-CANARY";
        repository.insert_test_conversation(&project.id, &session_id, &turn_id, canary);
        let items = vec![
            ReasoningItem {
                item_id: "reasoning-item-1".to_owned(),
                item_ordinal: 0,
                status: ReasoningStatus::Complete,
                reason_code: None,
                finalized_at_ms: 1,
                parts: vec![
                    ReasoningPart {
                        content_index: 0,
                        text: canary.to_owned(),
                    },
                    ReasoningPart {
                        content_index: 1,
                        text: "synthetic second part".to_owned(),
                    },
                ],
            },
            ReasoningItem {
                item_id: "reasoning-item-2".to_owned(),
                item_ordinal: 1,
                status: ReasoningStatus::Complete,
                reason_code: None,
                finalized_at_ms: 2,
                parts: vec![ReasoningPart {
                    content_index: 0,
                    text: "synthetic second item".to_owned(),
                }],
            },
        ];
        repository
            .commit_reasoning(&turn_id, ReasoningStatus::Complete, None, &items)
            .unwrap();
        assert_eq!(repository.load_reasoning(&turn_id).unwrap(), items);

        let nonterminal_turn = Uuid::now_v7().to_string();
        repository.connection.execute(
			"INSERT INTO chat_turns(id, session_id, operation_id, status) VALUES (?1, ?2, ?3, 'streaming')",
			params![nonterminal_turn, session_id, Uuid::now_v7().to_string()],
		).unwrap();
        assert_eq!(
            repository.commit_reasoning(&nonterminal_turn, ReasoningStatus::Complete, None, &items),
            Err(ChatError::InvalidInput)
        );
        let mut inconsistent = items.clone();
        inconsistent[1].status = ReasoningStatus::Incomplete;
        inconsistent[1].reason_code = Some("stream_gap".to_owned());
        assert_eq!(
            repository.commit_reasoning(&turn_id, ReasoningStatus::Complete, None, &inconsistent),
            Err(ChatError::InvalidInput)
        );
        assert_eq!(repository.load_reasoning(&turn_id).unwrap(), items);

        let oversized = vec![ReasoningItem {
            item_id: "reasoning-item-oversize".to_owned(),
            item_ordinal: 0,
            status: ReasoningStatus::Complete,
            reason_code: None,
            finalized_at_ms: 2,
            parts: vec![ReasoningPart {
                content_index: 0,
                text: "x".repeat(MAX_REASONING_PART_BYTES + 1),
            }],
        }];
        assert_eq!(
            repository.commit_reasoning(&turn_id, ReasoningStatus::Complete, None, &oversized),
            Err(ChatError::InvalidInput)
        );
        assert_eq!(repository.load_reasoning(&turn_id).unwrap(), items);

        repository.delete_session_local(&session_id).unwrap();
        assert_eq!(
            repository.load_reasoning(&turn_id),
            Err(ChatError::NotFound)
        );
        drop(repository);
        let bytes = fs::read(root.join("chat").join(DATABASE_FILE_NAME)).unwrap();
        assert!(!bytes
            .windows(canary.len())
            .any(|window| window == canary.as_bytes()));
        let wal = root.join("chat").join(format!("{DATABASE_FILE_NAME}-wal"));
        assert!(!wal.exists() || fs::metadata(&wal).unwrap().len() == 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn project_repository_is_scope_bound_and_remove_never_deletes_directory() {
        let root = std::env::temp_dir().join(format!("yijie-chat-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let mut repository = open_repository(&root, 13);
        let project_path = root.join("project");
        fs::create_dir(&project_path).unwrap();
        fs::write(project_path.join("keep.txt"), "keep").unwrap();
        let project = repository
            .register_project(&project_path, b"synthetic-bookmark")
            .unwrap();
        assert_eq!(repository.list_projects().unwrap().len(), 1);

        let cross_scope_session = repository.connection.execute(
            "INSERT INTO chat_sessions(id, owner_user_id, tenant_id, project_id, title, title_source, title_job_status, created_at, last_activity_at)
             VALUES (?1, ?2, ?3, ?4, 'Synthetic', 'fallback', 'not_started', 1, 1)",
            params![
                Uuid::now_v7().to_string(),
                Uuid::now_v7().to_string(),
                repository.scope.tenant_id,
                project.id
            ],
        );
        assert!(cross_scope_session.is_err());

        repository.remove_project(&project.id).unwrap();
        assert!(repository.list_projects().unwrap().is_empty());
        assert_eq!(
            fs::read_to_string(project_path.join("keep.txt")).unwrap(),
            "keep"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn session_outbox_is_idempotent_recoverable_and_terminal_commit_is_atomic() {
        let root = std::env::temp_dir().join(format!("yijie-chat-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let mut repository = open_repository(&root, 17);
        let project_id = register_synthetic_project(&mut repository, &root);
        let create_operation_id = Uuid::now_v7();
        let pending = repository
            .create_session_and_enqueue(project_id, "首条消息", create_operation_id)
            .unwrap();
        assert_eq!(
            repository
                .create_session_and_enqueue(project_id, "首条消息", create_operation_id)
                .unwrap(),
            pending
        );
        assert_eq!(
            repository.create_session_and_enqueue(
                project_id,
                "同一幂等键的不同正文",
                create_operation_id
            ),
            Err(ChatError::ConversationConflict)
        );
        assert_eq!(
            repository
                .connection
                .query_row("SELECT count(*) FROM chat_sessions", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        let now = unix_seconds().unwrap();
        bind_and_accept_first_turn(&mut repository, &pending, now);
        let context = repository.active_turn_context(pending.session_id).unwrap();
        let persisted_public_task_id: String = repository
            .connection
            .query_row(
                "SELECT public_task_id FROM chat_public_task_bindings WHERE session_id=?1",
                [pending.session_id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(context.task_id.to_string(), persisted_public_task_id);
        assert_ne!(context.task_id, pending.session_id);
        assert!(context.assistant_text.is_empty());
        assert_eq!(
            repository.outbox_state(pending.turn_operation_id).unwrap(),
            OutboxState::Inflight
        );
        let stream_id = Uuid::now_v7();
        let reasoning = vec![ReasoningItem {
            item_id: "reasoning-1".to_owned(),
            item_ordinal: 0,
            status: ReasoningStatus::Complete,
            reason_code: None,
            finalized_at_ms: 1,
            parts: vec![ReasoningPart {
                content_index: 0,
                text: "合成推理".to_owned(),
            }],
        }];
        repository
            .persist_turn_progress(&TurnProgress {
                local_turn_id: pending.turn_id,
                assistant_text: "合成回答".to_owned(),
                cursor: StoredEventCursor {
                    stream_id,
                    sequence: 1,
                    event_id: Uuid::now_v7(),
                },
            })
            .unwrap();
        repository
            .commit_terminal_turn(&TerminalTurnCommit {
                local_turn_id: pending.turn_id,
                terminal_status: "completed".to_owned(),
                terminal_at: now,
                assistant_text: "合成回答".to_owned(),
                cursor: StoredEventCursor {
                    stream_id,
                    sequence: 2,
                    event_id: Uuid::now_v7(),
                },
                reasoning_status: ReasoningStatus::Complete,
                reasoning_reason_code: None,
                reasoning_items: reasoning.clone(),
            })
            .unwrap();
        assert_eq!(
            repository.outbox_state(pending.turn_operation_id).unwrap(),
            OutboxState::Done
        );
        assert_eq!(
            repository
                .load_reasoning(&pending.turn_id.to_string())
                .unwrap(),
            reasoning
        );
        let history = repository
            .load_history(pending.session_id, None, None)
            .unwrap();
        assert_eq!(history.turns.len(), 1);
        assert_eq!(history.turns[0].messages.len(), 2);
        assert_eq!(history.turns[0].messages[1].content, "合成回答");
        assert_eq!(history.turns[0].reasoning[0].total_bytes, "合成推理".len());
        let sessions = repository.list_sessions(None, None).unwrap();
        assert_eq!(sessions.sessions.len(), 1);
        assert_eq!(
            sessions.sessions[0].latest_turn_status.as_deref(),
            Some("completed")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn expired_outbox_lease_recovers_after_restart_without_creating_duplicate_rows() {
        let root = std::env::temp_dir().join(format!("yijie-chat-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let chat_scope = scope();
        let mut repository = open_repository_for_scope(&root, 19, chat_scope.clone());
        let project_id = register_synthetic_project(&mut repository, &root);
        let operation_id = Uuid::now_v7();
        repository
            .create_session_and_enqueue(project_id, "恢复消息", operation_id)
            .unwrap();
        let now = unix_seconds().unwrap();
        let first = repository
            .claim_next_conversation_outbox(now, 30)
            .unwrap()
            .unwrap();
        assert_eq!(first.attempt_count, 1);
        let first_dispatch = repository
            .load_create_session_dispatch(operation_id)
            .unwrap();
        assert_eq!(first_dispatch.operation_id, operation_id);
        assert_eq!(first_dispatch.public_task_id, None);
        assert_eq!(first_dispatch.authorization_revision, 1);
        let client_reference_id = first_dispatch.client_reference_id;
        drop(repository);

        let mut reopened = open_repository_for_scope(&root, 19, chat_scope);
        assert!(reopened
            .claim_next_conversation_outbox(now + 29, 30)
            .unwrap()
            .is_none());
        let recovered = reopened
            .claim_next_conversation_outbox(now + 30, 30)
            .unwrap()
            .unwrap();
        assert_eq!(recovered.operation_id, operation_id);
        assert_eq!(recovered.attempt_count, 2);
        let recovered_dispatch = reopened.load_create_session_dispatch(operation_id).unwrap();
        assert_eq!(recovered_dispatch.client_reference_id, client_reference_id);
        assert_eq!(recovered_dispatch.operation_id, operation_id);
        assert_eq!(recovered_dispatch.public_task_id, None);
        assert_eq!(
            reopened
                .connection
                .query_row("SELECT count(*) FROM chat_sessions", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn public_task_binding_recovery_is_authority_bound_and_delete_wins_late_response() {
        let root = std::env::temp_dir().join(format!("yijie-s10p3-binding-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let chat_scope = scope();
        let mut repository = open_repository_for_scope(&root, 31, chat_scope.clone());
        let project_id = register_synthetic_project(&mut repository, &root);
        let operation_id = Uuid::now_v7();
        let pending = repository
            .create_session_and_enqueue_with_authority(
                project_id,
                "仅保存在 SQLCipher 的本地正文",
                operation_id,
                7,
            )
            .unwrap();
        let now = unix_seconds().unwrap();
        repository
            .claim_next_conversation_outbox(now, 30)
            .unwrap()
            .unwrap();
        let dispatch = repository
            .load_create_session_dispatch(operation_id)
            .unwrap();
        assert_eq!(dispatch.authorization_revision, 7);
        assert_eq!(dispatch.operation_id, operation_id);
        assert_eq!(dispatch.public_task_id, None);

        let blocked = repository
            .transition_public_task_binding(
                operation_id,
                PublicTaskBindingState::BlockedAuth,
                "chat_unauthenticated",
                None,
                now,
            )
            .unwrap();
        assert_eq!(blocked.session_id, pending.session_id);
        assert_eq!(blocked.state, PublicTaskBindingState::BlockedAuth);
        assert!(repository
            .claim_next_conversation_outbox(now + 30, 30)
            .unwrap()
            .is_none());
        assert_eq!(
            repository.resume_blocked_public_tasks(8, now + 1).unwrap(),
            1
        );
        let resumed = repository
            .claim_next_conversation_outbox(now + 1, 30)
            .unwrap()
            .unwrap();
        assert_eq!(resumed.operation_id, operation_id);
        let resumed_dispatch = repository
            .load_create_session_dispatch(operation_id)
            .unwrap();
        assert_eq!(resumed_dispatch.authorization_revision, 8);
        assert_eq!(
            resumed_dispatch.client_reference_id,
            dispatch.client_reference_id
        );

        repository
            .transition_public_task_binding(
                operation_id,
                PublicTaskBindingState::RetryWait,
                "chat_temporarily_unavailable",
                Some(now + 60),
                now + 2,
            )
            .unwrap();
        let deletion_operation = Uuid::now_v7();
        repository
            .begin_session_deletion(pending.session_id, deletion_operation, now + 3)
            .unwrap();
        assert_eq!(
            repository.bind_public_task(operation_id, Uuid::now_v7(), now + 4),
            Err(ChatError::ConversationConflict)
        );
        repository
            .delete_session_local(&pending.session_id.to_string())
            .unwrap();
        assert_eq!(
            repository.public_task_control_plane_status(pending.session_id),
            Err(ChatError::NotFound)
        );

        drop(repository);
        let foreign_scope = scope();
        let reopened = open_repository_for_scope(&root, 31, foreign_scope);
        assert_eq!(
            reopened.public_task_control_plane_status(pending.session_id),
            Err(ChatError::NotFound)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn public_task_retry_budget_fails_closed_without_starting_host() {
        let root = std::env::temp_dir().join(format!("yijie-s10p3-budget-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let mut repository = open_repository(&root, 32);
        let project_id = register_synthetic_project(&mut repository, &root);
        let operation_id = Uuid::now_v7();
        let pending = repository
            .create_session_and_enqueue(project_id, "本地正文 canary", operation_id)
            .unwrap();
        let now = unix_seconds().unwrap();
        repository
            .connection
            .execute(
                "UPDATE chat_outbox SET attempt_count=?1, state='pending', next_attempt_at=?2
                 WHERE operation_id=?3",
                params![OUTBOX_MAX_ATTEMPTS, now, operation_id.to_string()],
            )
            .unwrap();
        repository
            .connection
            .execute(
                "UPDATE chat_public_task_bindings SET attempt_count=?1, state='pending'
                 WHERE create_operation_id=?2",
                params![OUTBOX_MAX_ATTEMPTS, operation_id.to_string()],
            )
            .unwrap();

        assert!(repository
            .claim_next_conversation_outbox(now, 30)
            .unwrap()
            .is_none());
        assert_eq!(
            repository.outbox_state(operation_id).unwrap(),
            OutboxState::Failed
        );
        assert_eq!(
            repository
                .public_task_control_plane_status(pending.session_id)
                .unwrap(),
            PublicTaskControlPlaneStatus {
                session_id: pending.session_id,
                state: PublicTaskBindingState::Failed,
                issue_code: Some("chat_temporarily_unavailable".to_owned()),
            }
        );
        assert_eq!(
            repository
                .connection
                .query_row(
                    "SELECT count(*) FROM chat_sessions WHERE agent_session_id IS NOT NULL",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn history_pages_by_turn_and_user_title_wins_every_late_model_result() {
        let root = std::env::temp_dir().join(format!("yijie-chat-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let mut repository = open_repository(&root, 23);
        let project_id = register_synthetic_project(&mut repository, &root);
        let pending = repository
            .create_session_and_enqueue(project_id, "首条消息", Uuid::now_v7())
            .unwrap();
        let now = unix_seconds().unwrap();
        bind_and_accept_first_turn(&mut repository, &pending, now);
        let stream_id = Uuid::now_v7();
        commit_synthetic_terminal(&mut repository, pending.session_id, stream_id, 1, "回答一");
        for (index, input) in ["第二条", "第三条"].into_iter().enumerate() {
            let operation_id = Uuid::now_v7();
            repository
                .enqueue_turn(pending.session_id, input, operation_id)
                .unwrap();
            let claimed = repository
                .claim_next_conversation_outbox(unix_seconds().unwrap(), 30)
                .unwrap()
                .unwrap();
            assert_eq!(claimed.operation_id, operation_id);
            repository
                .suspend_started_turn_retry(operation_id, Uuid::now_v7())
                .unwrap();
            commit_synthetic_terminal(
                &mut repository,
                pending.session_id,
                stream_id,
                3 + (index as u64 * 2),
                if index == 0 { "回答二" } else { "回答三" },
            );
        }
        let first = repository
            .load_history(pending.session_id, None, Some(2))
            .unwrap();
        assert_eq!(first.turns.len(), 2);
        assert_eq!(first.turns[0].messages[0].content, "第二条");
        assert_eq!(first.turns[1].messages[0].content, "第三条");
        let second = repository
            .load_history(pending.session_id, first.next_before_ordinal, Some(2))
            .unwrap();
        assert_eq!(second.turns.len(), 1);
        assert_eq!(second.turns[0].messages[0].content, "首条消息");
        assert_eq!(
            repository.load_history(pending.session_id, None, Some(51)),
            Err(ChatError::InvalidInput)
        );

        let activity_before_rename = repository
            .session_summary(pending.session_id)
            .unwrap()
            .last_activity_at;
        let title_operation = Uuid::now_v7();
        assert!(repository
            .enqueue_title_job(pending.session_id, title_operation)
            .unwrap());
        repository
            .rename_session(pending.session_id, "  人工标题  ")
            .unwrap();
        assert!(!repository
            .apply_model_title(pending.session_id, title_operation, "迟到模型标题")
            .unwrap());
        let session = repository
            .list_sessions(None, None)
            .unwrap()
            .sessions
            .remove(0);
        assert_eq!(session.title, "人工标题");
        assert_eq!(session.title_source, SessionTitleSource::User);
        assert_eq!(
            session.last_activity_at, activity_before_rename,
            "rename must not change activity ordering"
        );

        let model_pending = repository
            .create_session_and_enqueue(project_id, "模型标题会话", Uuid::now_v7())
            .unwrap();
        let model_operation = Uuid::now_v7();
        assert!(repository
            .enqueue_title_job(model_pending.session_id, model_operation)
            .unwrap());
        assert_eq!(
            repository.apply_model_title(
                model_pending.session_id,
                model_operation,
                "<script>unsafe</script>"
            ),
            Err(ChatError::InvalidInput)
        );
        assert!(repository
            .apply_model_title(model_pending.session_id, model_operation, "安全模型标题")
            .unwrap());
        assert!(repository
            .apply_model_title(model_pending.session_id, model_operation, "安全模型标题")
            .unwrap());
        repository
            .rename_session(model_pending.session_id, "最终人工标题")
            .unwrap();
        assert!(!repository
            .apply_model_title(model_pending.session_id, model_operation, "安全模型标题")
            .unwrap());

        let capped_pending = repository
            .create_session_and_enqueue(project_id, "标题调用上限", Uuid::now_v7())
            .unwrap();
        for _ in 0..2 {
            let operation = Uuid::now_v7();
            assert!(repository
                .enqueue_title_job(capped_pending.session_id, operation)
                .unwrap());
            repository.fail_outbox(operation).unwrap();
        }
        assert_eq!(
            repository.enqueue_title_job(capped_pending.session_id, Uuid::now_v7()),
            Err(ChatError::ConversationConflict)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn session_project_actions_are_idempotent_and_remove_blocks_new_turns() {
        let root = std::env::temp_dir().join(format!("yijie-s7c-actions-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let mut repository = open_repository(&root, 27);
        let project_id = register_synthetic_project(&mut repository, &root);
        let pending = repository
            .create_session_and_enqueue(project_id, "首条消息", Uuid::now_v7())
            .unwrap();
        let now = unix_seconds().unwrap();
        bind_and_accept_first_turn(&mut repository, &pending, now);
        commit_synthetic_terminal(
            &mut repository,
            pending.session_id,
            Uuid::now_v7(),
            1,
            "回答",
        );

        repository
            .set_project_pinned(project_id, true, now + 1)
            .unwrap();
        repository
            .set_project_pinned(project_id, true, now + 2)
            .unwrap();
        assert_eq!(
            repository.list_projects().unwrap()[0].pinned_at,
            Some(now + 1)
        );
        repository
            .set_session_pinned(pending.session_id, true, now + 3)
            .unwrap();
        repository
            .set_session_pinned(pending.session_id, true, now + 4)
            .unwrap();
        assert_eq!(
            repository
                .session_summary(pending.session_id)
                .unwrap()
                .pinned_at,
            Some(now + 3)
        );
        repository.remove_project(&project_id.to_string()).unwrap();
        assert_eq!(
            repository.enqueue_turn(pending.session_id, "被移除后发送", Uuid::now_v7()),
            Err(ChatError::ConversationConflict)
        );
        assert_eq!(
            repository.set_project_pinned(project_id, true, now + 5),
            Err(ChatError::NotFound)
        );
        assert!(root
            .join(format!("project-{project_id}"))
            .parent()
            .is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn interrupt_is_operation_idempotent_and_restart_recovery_is_explicit() {
        let root = std::env::temp_dir().join(format!("yijie-s7c-interrupt-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let chat_scope = scope();
        let mut repository = open_repository_for_scope(&root, 28, chat_scope.clone());
        let project_id = register_synthetic_project(&mut repository, &root);
        let pending = repository
            .create_session_and_enqueue(project_id, "首条消息", Uuid::now_v7())
            .unwrap();
        let now = unix_seconds().unwrap();
        bind_and_accept_first_turn(&mut repository, &pending, now);
        let operation_id = Uuid::now_v7();
        let turn_id = repository
            .enqueue_interrupt(pending.session_id, operation_id)
            .unwrap();
        assert_eq!(
            repository
                .enqueue_interrupt(pending.session_id, operation_id)
                .unwrap(),
            turn_id
        );
        let claimed = repository
            .claim_next_conversation_outbox(unix_seconds().unwrap(), 30)
            .unwrap()
            .unwrap();
        assert_eq!(claimed.kind, OutboxKind::InterruptTurn);
        let dispatch = repository.load_interrupt_dispatch(operation_id).unwrap();
        assert_eq!(dispatch.turn_id, turn_id);
        drop(repository);

        let mut reopened = open_repository_for_scope(&root, 28, chat_scope);
        let recovery = reopened.recovery_snapshot().unwrap();
        assert_eq!(recovery.active_session_ids, vec![pending.session_id]);
        reopened
            .finalize_interrupted_without_stream(operation_id, now + 1)
            .unwrap();
        assert!(reopened
            .recovery_snapshot()
            .unwrap()
            .active_session_ids
            .is_empty());
        assert_eq!(
            reopened.outbox_state(operation_id).unwrap(),
            OutboxState::Done
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deletion_and_start_turn_share_one_atomic_session_lease() {
        let root = std::env::temp_dir().join(format!("yijie-s7c-lease-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let mut repository = open_repository(&root, 30);
        let project_id = register_synthetic_project(&mut repository, &root);
        let pending = repository
            .create_session_and_enqueue(project_id, "首条消息", Uuid::now_v7())
            .unwrap();
        let now = unix_seconds().unwrap();
        bind_and_accept_first_turn(&mut repository, &pending, now);
        let delete_operation = Uuid::now_v7();
        repository
            .begin_session_deletion(pending.session_id, delete_operation, now)
            .unwrap();
        assert!(repository.claim_next_deletion(now, 30).unwrap().is_none());
        assert_eq!(
            repository.enqueue_turn(pending.session_id, "竞态发送", Uuid::now_v7()),
            Err(ChatError::ConversationConflict)
        );
        let interrupt = repository
            .claim_next_conversation_outbox(now, 30)
            .unwrap()
            .unwrap();
        assert_eq!(interrupt.operation_id, delete_operation);
        assert_eq!(interrupt.kind, OutboxKind::InterruptTurn);
        repository
            .finalize_interrupted_without_stream(delete_operation, now + 1)
            .unwrap();
        assert_eq!(
            repository
                .claim_next_deletion(now + 1, 30)
                .unwrap()
                .unwrap()
                .operation_id,
            delete_operation
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deletion_saga_recovers_and_leaves_only_content_free_expiring_receipt() {
        let root = std::env::temp_dir().join(format!("yijie-s7c-delete-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let chat_scope = scope();
        let mut repository = open_repository_for_scope(&root, 29, chat_scope.clone());
        let project_id = register_synthetic_project(&mut repository, &root);
        let pending = repository
            .create_session_and_enqueue(project_id, "首条消息", Uuid::now_v7())
            .unwrap();
        let now = unix_seconds().unwrap();
        let (agent_session_id, _) = bind_and_accept_first_turn(&mut repository, &pending, now);
        commit_synthetic_terminal(
            &mut repository,
            pending.session_id,
            Uuid::now_v7(),
            1,
            "删除回答 canary",
        );
        let operation_id = Uuid::now_v7();
        let status = repository
            .begin_session_deletion(pending.session_id, operation_id, now + 1)
            .unwrap();
        assert_eq!(status.desktop_state, CleanupSurfaceState::Pending);
        assert_eq!(status.host_state, CleanupSurfaceState::Pending);
        assert_eq!(
            repository
                .deletion_status_for_session(pending.session_id)
                .unwrap(),
            Some(status.clone())
        );
        let claimed = repository
            .claim_next_deletion(now + 1, 30)
            .unwrap()
            .unwrap();
        assert_eq!(claimed.agent_session_id, Some(agent_session_id));
        repository
            .record_cleanup_surfaces(
                operation_id,
                CleanupSurfaceState::Complete,
                CleanupSurfaceState::Complete,
                "cleanup_complete",
                now + 1,
            )
            .unwrap();
        repository.complete_local_deletion(operation_id).unwrap();
        drop(repository);
        assert!(ChatRepository::deletion_identity_exists(
            &root.join("chat"),
            &DatabaseKey::from_bytes([29; 32])
        )
        .unwrap());

        let mut reopened = open_repository_for_scope(&root, 29, chat_scope);
        let recovery = reopened.recovery_snapshot().unwrap();
        assert!(recovery.active_session_ids.is_empty());
        assert_eq!(recovery.deletions.len(), 1);
        assert_eq!(
            reopened
                .deletion_status_for_session(pending.session_id)
                .unwrap()
                .map(|status| status.operation_id),
            Some(operation_id)
        );
        let receipt = reopened
            .finalize_deletion_receipt(operation_id, now + 2)
            .unwrap();
        assert_eq!(receipt.outcome_code, "cleanup_complete");
        assert_eq!(receipt.completed_at, Some(now + 2));
        assert_eq!(
            receipt.expires_at,
            Some(now + 2 + DELETION_RECEIPT_TTL_SECONDS)
        );
        assert!(reopened.recovery_snapshot().unwrap().deletions.is_empty());
        assert_eq!(
            reopened
                .deletion_status_for_session(pending.session_id)
                .unwrap(),
            Some(receipt.clone())
        );
        assert_eq!(
            reopened
                .connection
                .query_row("SELECT count(*) FROM chat_sessions", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        let receipt_columns = reopened
            .connection
            .prepare("PRAGMA table_info(chat_deletion_receipts)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert!(!receipt_columns.iter().any(|column| column == "session_id"));
        assert!(!format!("{receipt:?}").contains(&pending.session_id.to_string()));
        assert_eq!(
            reopened
                .purge_expired_deletion_receipts(now + 2 + DELETION_RECEIPT_TTL_SECONDS)
                .unwrap(),
            1
        );
        assert_eq!(reopened.deletion_status(operation_id).unwrap(), None);
        assert_eq!(
            reopened
                .deletion_status_for_session(pending.session_id)
                .unwrap(),
            None
        );
        drop(reopened);
        assert!(!ChatRepository::deletion_identity_exists(
            &root.join("chat"),
            &DatabaseKey::from_bytes([29; 32])
        )
        .unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ready_attachment_removal_is_scoped_idempotent_and_cascades_chunks() {
        let root = std::env::temp_dir().join(format!("yijie-feat127-remove-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let primary_scope = scope();
        let mut repository = open_repository_for_scope(&root, 43, primary_scope.clone());
        let imported_at = unix_seconds().unwrap();
        let ready = crate::chat::attachment::prepare_bytes(
            "remove-me.txt".to_owned(),
            b"indexed attachment context".to_vec(),
            imported_at,
        )
        .unwrap();
        let ready_id = ready.id;
        repository
            .store_attachments(vec![ready], 1, DraftTarget::New)
            .unwrap();
        assert_eq!(
            repository
                .connection
                .query_row("SELECT count(*) FROM chat_attachments", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            1
        );
        assert_eq!(
            repository
                .connection
                .query_row("SELECT count(*) FROM chat_attachment_chunks", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            1
        );

        let mut foreign = open_repository_for_scope(&root, 43, scope());
        foreign
            .remove_ready_attachment(ready_id, DraftTarget::New)
            .unwrap();
        drop(foreign);
        assert_eq!(
            repository
                .connection
                .query_row("SELECT count(*) FROM chat_attachments", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            1,
            "foreign scopes must neither learn about nor delete the attachment"
        );

        repository
            .remove_ready_attachment(ready_id, DraftTarget::New)
            .unwrap();
        let wal = root.join("chat").join(format!("{DATABASE_FILE_NAME}-wal"));
        assert!(!wal.exists() || fs::metadata(&wal).unwrap().len() == 0);
        repository
            .remove_ready_attachment(ready_id, DraftTarget::New)
            .unwrap();
        for table in ["chat_attachments", "chat_attachment_chunks"] {
            let count = repository
                .connection
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table} must be empty after removal");
        }

        let first = crate::chat::attachment::prepare_bytes(
            "first.txt".to_owned(),
            b"first".to_vec(),
            imported_at,
        )
        .unwrap();
        let second = crate::chat::attachment::prepare_bytes(
            "second.txt".to_owned(),
            b"second".to_vec(),
            imported_at,
        )
        .unwrap();
        assert_eq!(
            repository.store_attachments(vec![first, second], 1, DraftTarget::New),
            Err(ChatError::InvalidInput)
        );
        assert_eq!(
            repository
                .connection
                .query_row("SELECT count(*) FROM chat_attachments", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0,
            "over-capacity batches must not write rows"
        );

        let project_id = register_synthetic_project(&mut repository, &root);
        let bound = crate::chat::attachment::prepare_bytes(
            "bound.txt".to_owned(),
            b"bound attachment context".to_vec(),
            imported_at,
        )
        .unwrap();
        let bound_id = bound.id;
        let expires_at = bound.expires_at;
        repository
            .store_attachments(vec![bound], 1, DraftTarget::New)
            .unwrap();
        let expiring_ready = crate::chat::attachment::prepare_bytes(
            "ready-expiry.txt".to_owned(),
            b"ready expiry private context".to_vec(),
            imported_at,
        )
        .unwrap();
        let expiring_ready_id = expiring_ready.id;
        repository
            .store_attachments(vec![expiring_ready], 1, DraftTarget::New)
            .unwrap();
        let attachment_only = repository
            .create_session_and_enqueue_multimodal(
                project_id,
                &[DraftContentBlock::File(bound_id)],
                Uuid::now_v7(),
                1,
            )
            .unwrap();
        assert_eq!(
            repository
                .connection
                .query_row(
                    "SELECT title FROM chat_sessions WHERE id=?1",
                    [attachment_only.session_id.to_string()],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "bound.txt"
        );
        assert_eq!(
            repository.remove_ready_attachment(bound_id, DraftTarget::New),
            Err(ChatError::ConversationConflict)
        );
        assert_eq!(repository.expire_attachments(expires_at - 1).unwrap(), 0);
        assert_eq!(
            repository
                .connection
                .query_row(
                    "SELECT state, content_blob IS NOT NULL FROM chat_attachments WHERE id=?1",
                    [bound_id.to_string()],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?)),
                )
                .unwrap(),
            ("bound".to_owned(), true)
        );
        assert_eq!(repository.expire_attachments(expires_at).unwrap(), 2);
        assert_eq!(repository.expire_attachments(expires_at + 1).unwrap(), 0);
        assert!(!repository
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM chat_attachments WHERE id=?1)",
                [expiring_ready_id.to_string()],
                |row| row.get::<_, bool>(0),
            )
            .unwrap());
        assert!(!wal.exists() || fs::metadata(&wal).unwrap().len() == 0);
        assert_eq!(
            repository.remove_ready_attachment(bound_id, DraftTarget::New),
            Err(ChatError::ConversationConflict)
        );

        drop(repository);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn draft_attachment_targets_survive_reopen_and_bind_only_to_their_composer() {
        let root =
            std::env::temp_dir().join(format!("yijie-feat127-draft-targets-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let primary_scope = scope();
        let mut repository = open_repository_for_scope(&root, 49, primary_scope.clone());
        let project_id = register_synthetic_project(&mut repository, &root);
        let seed = repository
            .create_session_and_enqueue(project_id, "首条消息", Uuid::now_v7())
            .unwrap();
        let now = unix_seconds().unwrap();
        bind_and_accept_first_turn(&mut repository, &seed, now);
        commit_synthetic_terminal(
            &mut repository,
            seed.session_id,
            Uuid::now_v7(),
            1,
            "seed complete",
        );

        let imported_at = unix_seconds().unwrap();
        let new_draft = crate::chat::attachment::prepare_bytes(
            "new-draft.txt".to_owned(),
            b"new composer context".to_vec(),
            imported_at,
        )
        .unwrap();
        let new_draft_id = new_draft.id;
        repository
            .store_attachment(new_draft, DraftTarget::New)
            .unwrap();
        let session_draft = crate::chat::attachment::prepare_bytes(
            "session-draft.txt".to_owned(),
            b"session composer context".to_vec(),
            imported_at,
        )
        .unwrap();
        let session_draft_id = session_draft.id;
        repository
            .store_attachment(session_draft, DraftTarget::Session(seed.session_id))
            .unwrap();
        drop(repository);

        let mut reopened = open_repository_for_scope(&root, 49, primary_scope.clone());
        assert_eq!(
            reopened
                .list_ready_attachments(DraftTarget::New)
                .unwrap()
                .into_iter()
                .map(|attachment| attachment.attachment_id)
                .collect::<Vec<_>>(),
            vec![new_draft_id]
        );
        assert_eq!(
            reopened
                .list_ready_attachments(DraftTarget::Session(seed.session_id))
                .unwrap()
                .into_iter()
                .map(|attachment| attachment.attachment_id)
                .collect::<Vec<_>>(),
            vec![session_draft_id]
        );
        assert_eq!(
            reopened.remove_ready_attachment(new_draft_id, DraftTarget::Session(seed.session_id),),
            Err(ChatError::ConversationConflict)
        );
        assert_eq!(
            reopened.remove_ready_attachment(session_draft_id, DraftTarget::New),
            Err(ChatError::ConversationConflict)
        );

        let mut foreign = open_repository_for_scope(&root, 49, scope());
        assert!(foreign
            .list_ready_attachments(DraftTarget::New)
            .unwrap()
            .is_empty());
        assert_eq!(
            foreign.list_ready_attachments(DraftTarget::Session(seed.session_id)),
            Err(ChatError::NotFound)
        );
        drop(foreign);

        assert_eq!(
            reopened.create_session_and_enqueue_multimodal(
                project_id,
                &[DraftContentBlock::File(session_draft_id)],
                Uuid::now_v7(),
                1,
            ),
            Err(ChatError::NotFound)
        );
        assert_eq!(
            reopened.enqueue_turn_multimodal(
                seed.session_id,
                &[DraftContentBlock::File(new_draft_id)],
                Uuid::now_v7(),
            ),
            Err(ChatError::NotFound)
        );

        let attachment_only = reopened
            .create_session_and_enqueue_multimodal(
                project_id,
                &[DraftContentBlock::File(new_draft_id)],
                Uuid::now_v7(),
                1,
            )
            .unwrap();
        reopened
            .enqueue_turn_multimodal(
                seed.session_id,
                &[DraftContentBlock::File(session_draft_id)],
                Uuid::now_v7(),
            )
            .unwrap();
        for attachment_id in [new_draft_id, session_draft_id] {
            let state = reopened
                .connection
                .query_row(
                    "SELECT state, message_id IS NOT NULL,
                       draft_target_kind IS NULL, draft_session_id IS NULL
                     FROM chat_attachments WHERE id=?1",
                    [attachment_id.to_string()],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, bool>(1)?,
                            row.get::<_, bool>(2)?,
                            row.get::<_, bool>(3)?,
                        ))
                    },
                )
                .unwrap();
            assert_eq!(state, ("bound".to_owned(), true, true, true));
        }
        assert!(reopened
            .list_ready_attachments(DraftTarget::New)
            .unwrap()
            .is_empty());
        assert!(reopened
            .list_ready_attachments(DraftTarget::Session(seed.session_id))
            .unwrap()
            .is_empty());

        drop(reopened);
        let mut reopened = open_repository_for_scope(&root, 49, primary_scope);
        let attachment_only_summary = reopened
            .session_summary(attachment_only.session_id)
            .unwrap();
        assert_eq!(attachment_only_summary.title, "new-draft.txt");
        assert_eq!(
            attachment_only_summary.title_source,
            SessionTitleSource::Fallback
        );

        for (session_id, attachment_id, safe_name) in [
            (attachment_only.session_id, new_draft_id, "new-draft.txt"),
            (seed.session_id, session_draft_id, "session-draft.txt"),
        ] {
            let message_id = reopened
                .connection
                .query_row(
                    "SELECT message_id FROM chat_attachments WHERE id=?1",
                    [attachment_id.to_string()],
                    |row| row.get::<_, String>(0),
                )
                .unwrap();
            let message_id = Uuid::parse_str(&message_id).unwrap();
            let history = reopened.load_history(session_id, None, Some(20)).unwrap();
            assert!(history
                .turns
                .iter()
                .flat_map(|turn| turn.messages.iter())
                .any(|message| message.message_id == message_id));
            let blocks = reopened
                .load_message_content_blocks(vec![message_id])
                .unwrap();
            assert!(matches!(
                blocks.as_slice(),
                [(projected_message_id, projected_blocks)]
                    if *projected_message_id == message_id
                        && matches!(projected_blocks.as_slice(), [
                            MessageContentBlockProjection::Attachment { ordinal: 0, attachment }
                        ] if attachment.attachment_id == attachment_id
                            && attachment.safe_name == safe_name
                            && attachment.state == "bound")
            ));
        }

        reopened
            .delete_session_local(&seed.session_id.to_string())
            .unwrap();
        reopened
            .delete_session_local(&attachment_only.session_id.to_string())
            .unwrap();
        for table in [
            "chat_attachments",
            "chat_attachment_chunks",
            "chat_message_content_blocks",
        ] {
            let count = reopened
                .connection
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table} must cascade on permanent deletion");
        }
        drop(reopened);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn draft_attachment_ordinals_preserve_same_second_import_order_across_reopen() {
        let root = std::env::temp_dir().join(format!(
            "yijie-feat127-draft-order-reopen-{}",
            Uuid::now_v7()
        ));
        fs::create_dir(&root).unwrap();
        let primary_scope = scope();
        let mut repository = open_repository_for_scope(&root, 50, primary_scope.clone());
        let imported_at = unix_seconds().unwrap();
        let expected = [
            (
                Uuid::parse_str("ffffffff-ffff-4fff-bfff-fffffffffff1").unwrap(),
                "first.txt",
            ),
            (
                Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap(),
                "second.txt",
            ),
            (
                Uuid::parse_str("88888888-8888-4888-8888-888888888883").unwrap(),
                "third.txt",
            ),
        ];
        let attachments = expected
            .iter()
            .map(|(id, safe_name)| {
                let mut attachment = crate::chat::attachment::prepare_bytes(
                    (*safe_name).to_owned(),
                    format!("context for {safe_name}").into_bytes(),
                    imported_at,
                )
                .unwrap();
                attachment.id = *id;
                attachment
            })
            .collect::<Vec<_>>();
        repository
            .store_attachments(attachments, expected.len(), DraftTarget::New)
            .unwrap();

        let stored = {
            let mut statement = repository
                .connection
                .prepare(
                    "SELECT id, imported_at, draft_ordinal FROM chat_attachments
                     WHERE draft_target_kind='new' ORDER BY draft_ordinal",
                )
                .unwrap();
            statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        };
        assert_eq!(
            stored,
            expected
                .iter()
                .enumerate()
                .map(|(ordinal, (id, _))| {
                    (id.to_string(), imported_at, i64::try_from(ordinal).unwrap())
                })
                .collect::<Vec<_>>()
        );
        drop(repository);

        let mut reopened = open_repository_for_scope(&root, 50, primary_scope);
        let restored = reopened.list_ready_attachments(DraftTarget::New).unwrap();
        assert_eq!(
            restored
                .iter()
                .map(|attachment| attachment.attachment_id)
                .collect::<Vec<_>>(),
            expected.iter().map(|(id, _)| *id).collect::<Vec<_>>()
        );
        assert_eq!(
            restored
                .iter()
                .map(|attachment| attachment.safe_name.as_str())
                .collect::<Vec<_>>(),
            expected
                .iter()
                .map(|(_, safe_name)| *safe_name)
                .collect::<Vec<_>>()
        );
        drop(reopened);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn draft_attachment_ordinals_are_target_scoped_and_append_after_removal() {
        let root = std::env::temp_dir().join(format!(
            "yijie-feat127-draft-order-targets-{}",
            Uuid::now_v7()
        ));
        fs::create_dir(&root).unwrap();
        let mut repository = open_repository(&root, 51);
        let project_id = register_synthetic_project(&mut repository, &root);
        let session_id = repository
            .create_session_and_enqueue(project_id, "seed", Uuid::now_v7())
            .unwrap()
            .session_id;
        let imported_at = unix_seconds().unwrap();
        let prepare = |safe_name: &str| {
            crate::chat::attachment::prepare_bytes(
                safe_name.to_owned(),
                format!("context for {safe_name}").into_bytes(),
                imported_at,
            )
            .unwrap()
        };
        let new_first = prepare("new-first.txt");
        let new_first_id = new_first.id;
        let new_second = prepare("new-second.txt");
        let new_second_id = new_second.id;
        repository
            .store_attachments(vec![new_first, new_second], 2, DraftTarget::New)
            .unwrap();
        let session_first = prepare("session-first.txt");
        let session_first_id = session_first.id;
        let session_second = prepare("session-second.txt");
        let session_second_id = session_second.id;
        repository
            .store_attachments(
                vec![session_first, session_second],
                2,
                DraftTarget::Session(session_id),
            )
            .unwrap();

        for (attachment_id, expected_ordinal) in [
            (new_first_id, 0_i64),
            (new_second_id, 1),
            (session_first_id, 0),
            (session_second_id, 1),
        ] {
            assert_eq!(
                repository
                    .connection
                    .query_row(
                        "SELECT draft_ordinal FROM chat_attachments WHERE id=?1",
                        [attachment_id.to_string()],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                expected_ordinal
            );
        }

        repository
            .remove_ready_attachment(new_first_id, DraftTarget::New)
            .unwrap();
        let new_third = prepare("new-third.txt");
        let new_third_id = new_third.id;
        repository
            .store_attachment(new_third, DraftTarget::New)
            .unwrap();

        assert_eq!(
            repository
                .list_ready_attachments(DraftTarget::New)
                .unwrap()
                .into_iter()
                .map(|attachment| attachment.attachment_id)
                .collect::<Vec<_>>(),
            vec![new_second_id, new_third_id]
        );
        assert_eq!(
            repository
                .list_ready_attachments(DraftTarget::Session(session_id))
                .unwrap()
                .into_iter()
                .map(|attachment| attachment.attachment_id)
                .collect::<Vec<_>>(),
            vec![session_first_id, session_second_id]
        );
        assert_eq!(
            repository
                .connection
                .query_row(
                    "SELECT draft_ordinal FROM chat_attachments WHERE id=?1",
                    [new_third_id.to_string()],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );
        drop(repository);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn two_large_files_share_the_remaining_context_budget_fairly() {
        let root = std::env::temp_dir().join(format!("yijie-feat127-context-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let mut repository = open_repository(&root, 45);
        let project_id = register_synthetic_project(&mut repository, &root);
        let imported_at = unix_seconds().unwrap();
        let alpha = crate::chat::attachment::prepare_bytes(
            "alpha.txt".to_owned(),
            "alpha context ".repeat(50_000).into_bytes(),
            imported_at,
        )
        .unwrap();
        let beta = crate::chat::attachment::prepare_bytes(
            "beta.txt".to_owned(),
            "beta context ".repeat(50_000).into_bytes(),
            imported_at,
        )
        .unwrap();
        let alpha_id = alpha.id;
        let beta_id = beta.id;
        repository
            .store_attachments(vec![alpha, beta], 2, DraftTarget::New)
            .unwrap();
        let pending = repository
            .create_session_and_enqueue_multimodal(
                project_id,
                &[
                    DraftContentBlock::Text("compare alpha and beta context".to_owned()),
                    DraftContentBlock::File(alpha_id),
                    DraftContentBlock::File(beta_id),
                ],
                Uuid::now_v7(),
                1,
            )
            .unwrap();
        let now = unix_seconds().unwrap();
        let create = repository
            .claim_next_conversation_outbox(now.max(unix_seconds().unwrap()), 30)
            .unwrap()
            .unwrap();
        assert_eq!(create.operation_id, pending.create_operation_id);
        let public_task_id = Uuid::now_v7();
        repository
            .bind_public_task(create.operation_id, public_task_id, now)
            .unwrap();
        repository
            .reschedule_outbox(create.operation_id, now)
            .unwrap();
        let create = repository
            .claim_next_conversation_outbox(now.max(unix_seconds().unwrap()), 30)
            .unwrap()
            .unwrap();
        repository
            .bind_host_session_and_enqueue_turn(
                create.operation_id,
                public_task_id,
                Uuid::now_v7(),
                Uuid::now_v7(),
            )
            .unwrap();
        let turn = repository
            .claim_next_conversation_outbox(now.max(unix_seconds().unwrap()), 30)
            .unwrap()
            .unwrap();
        let dispatch = repository
            .load_start_turn_dispatch_v2(turn.operation_id)
            .unwrap();
        let context_bytes = dispatch
            .content_blocks
            .iter()
            .filter_map(|block| match block {
                HostTurnInputBlock::File { context_chunks, .. } => {
                    Some(context_chunks.iter().map(String::len).sum::<usize>())
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(context_bytes.len(), 2);
        assert!(context_bytes
            .iter()
            .all(|bytes| *bytes > 100 * 1024 && *bytes <= MAX_FILE_CONTEXT_BYTES / 2));
        assert!(context_bytes.iter().sum::<usize>() <= MAX_FILE_CONTEXT_BYTES);
        assert!(context_bytes[0].abs_diff(context_bytes[1]) <= 8 * 1024);

        drop(repository);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn repository_startup_expires_attachments_across_all_scopes_and_truncates_wal() {
        let root = std::env::temp_dir().join(format!("yijie-feat127-ttl-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let primary_scope = scope();
        let mut repository = open_repository_for_scope(&root, 46, primary_scope.clone());
        let project_id = register_synthetic_project(&mut repository, &root);
        let imported_at = unix_seconds().unwrap();
        let bound = crate::chat::attachment::prepare_bytes(
            "bound-expiry.txt".to_owned(),
            b"bound expiry private context".to_vec(),
            imported_at,
        )
        .unwrap();
        let bound_id = bound.id;
        repository
            .store_attachments(vec![bound], 1, DraftTarget::New)
            .unwrap();
        repository
            .create_session_and_enqueue_multimodal(
                project_id,
                &[DraftContentBlock::File(bound_id)],
                Uuid::now_v7(),
                1,
            )
            .unwrap();

        let mut foreign = open_repository_for_scope(&root, 46, scope());
        let ready = crate::chat::attachment::prepare_bytes(
            "foreign-ready-expiry.txt".to_owned(),
            b"foreign ready private context".to_vec(),
            imported_at,
        )
        .unwrap();
        let ready_id = ready.id;
        foreign
            .store_attachments(vec![ready], 1, DraftTarget::New)
            .unwrap();
        drop(foreign);

        let expires_at = unix_seconds().unwrap() - 1;
        let expired_imported_at = expires_at - crate::chat::attachment::ATTACHMENT_TTL_SECONDS;
        assert_eq!(
            repository
                .connection
                .execute(
                    "UPDATE chat_attachments SET imported_at=?1, expires_at=?2
                     WHERE id IN (?3, ?4)",
                    params![
                        expired_imported_at,
                        expires_at,
                        bound_id.to_string(),
                        ready_id.to_string(),
                    ],
                )
                .unwrap(),
            2
        );
        drop(repository);

        let reopened = open_repository_for_scope(&root, 46, primary_scope);
        assert_eq!(
            reopened
                .connection
                .query_row(
                    "SELECT state, content_blob IS NULL FROM chat_attachments WHERE id=?1",
                    [bound_id.to_string()],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?)),
                )
                .unwrap(),
            ("expired".to_owned(), true)
        );
        assert!(!reopened
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM chat_attachments WHERE id=?1)",
                [ready_id.to_string()],
                |row| row.get::<_, bool>(0),
            )
            .unwrap());
        assert_eq!(
            reopened
                .connection
                .query_row("SELECT count(*) FROM chat_attachment_chunks", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
        assert_eq!(
            reopened
                .connection
                .query_row("PRAGMA secure_delete", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
        let wal = root.join("chat").join(format!("{DATABASE_FILE_NAME}-wal"));
        assert!(!wal.exists() || fs::metadata(&wal).unwrap().len() == 0);

        drop(reopened);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn attachment_checkpoint_retries_after_busy_even_when_no_rows_change() {
        let root =
            std::env::temp_dir().join(format!("yijie-feat127-checkpoint-retry-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let mut repository = open_repository(&root, 47);
        let now = unix_seconds().unwrap();
        let attachment = crate::chat::attachment::prepare_bytes(
            "checkpoint-retry.txt".to_owned(),
            b"private attachment bytes held by a WAL reader".to_vec(),
            now,
        )
        .unwrap();
        let attachment_id = attachment.id;
        repository
            .store_attachment(attachment, DraftTarget::New)
            .unwrap();
        repository
            .connection
            .execute(
                "UPDATE chat_attachments
                 SET imported_at=?1, expires_at=?2 WHERE id=?3",
                params![
                    now - crate::chat::attachment::ATTACHMENT_TTL_SECONDS - 1,
                    now - 1,
                    attachment_id.to_string(),
                ],
            )
            .unwrap();

        let blocker = Connection::open_with_flags(
            &repository.database_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        apply_raw_key(&blocker, &DatabaseKey::from_bytes([47; 32])).unwrap();
        blocker.execute_batch("BEGIN").unwrap();
        let retained: Vec<u8> = blocker
            .query_row(
                "SELECT content_blob FROM chat_attachments WHERE id=?1",
                [attachment_id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!retained.is_empty());
        repository
            .connection
            .execute_batch("PRAGMA busy_timeout=0;")
            .unwrap();

        assert_eq!(
            repository.expire_attachments(now),
            Err(ChatError::CleanupIncomplete)
        );
        assert!(repository.attachment_checkpoint_pending);
        blocker.execute_batch("COMMIT").unwrap();

        assert_eq!(repository.expire_attachments(now).unwrap(), 0);
        assert!(!repository.attachment_checkpoint_pending);
        let wal = PathBuf::from(format!(
            "{}-wal",
            repository.database_path.to_string_lossy()
        ));
        assert!(!wal.exists() || wal.metadata().unwrap().len() == 0);

        drop(blocker);
        drop(repository);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_pending_checkpoint_truncates_wal_after_cleanup_already_committed() {
        let root = std::env::temp_dir().join(format!(
            "yijie-feat127-checkpoint-reopen-{}",
            Uuid::now_v7()
        ));
        fs::create_dir(&root).unwrap();
        let mut repository = open_repository(&root, 48);
        let now = unix_seconds().unwrap();
        let attachment = crate::chat::attachment::prepare_bytes(
            "checkpoint-reopen.txt".to_owned(),
            b"private bytes committed to WAL before a simulated process exit".to_vec(),
            now,
        )
        .unwrap();
        let attachment_id = attachment.id;
        repository
            .store_attachment(attachment, DraftTarget::New)
            .unwrap();

        let transaction = repository.connection.transaction().unwrap();
        transaction
            .execute(
                "DELETE FROM chat_attachment_chunks WHERE attachment_id=?1",
                [attachment_id.to_string()],
            )
            .unwrap();
        transaction
            .execute(
                "DELETE FROM chat_attachments WHERE id=?1",
                [attachment_id.to_string()],
            )
            .unwrap();
        transaction.commit().unwrap();
        let wal = PathBuf::from(format!(
            "{}-wal",
            repository.database_path.to_string_lossy()
        ));
        assert!(wal.exists() && wal.metadata().unwrap().len() > 0);
        assert!(!repository
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM chat_attachments WHERE id=?1)",
                [attachment_id.to_string()],
                |row| row.get::<_, bool>(0),
            )
            .unwrap());

        // ChatRepository::open initializes this flag before running the all-scope expiry pass.
        repository.attachment_checkpoint_pending = true;
        assert_eq!(repository.expire_attachments_all_scopes(now).unwrap(), 0);
        assert!(!wal.exists() || wal.metadata().unwrap().len() == 0);

        drop(repository);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn multimodal_blocks_bind_atomically_dispatch_v2_and_expire_content() {
        let root = std::env::temp_dir().join(format!("yijie-feat127-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let primary_scope = scope();
        let mut repository = open_repository_for_scope(&root, 44, primary_scope.clone());
        let project_id = register_synthetic_project(&mut repository, &root);
        let imported_at = unix_seconds().unwrap();
        let file = crate::chat::attachment::prepare_bytes(
            "quarterly-total.csv".to_owned(),
            b"quarter,total\nQ1,42".to_vec(),
            imported_at,
        )
        .unwrap();
        let image_bytes = crate::chat::attachment::test_image_bytes("png");
        let image_size = image_bytes.len();
        let image = crate::chat::attachment::prepare_bytes(
            "chart.png".to_owned(),
            image_bytes,
            imported_at,
        )
        .unwrap();
        let file_id = file.id;
        let image_id = image.id;
        let summaries = repository
            .store_attachments(
                vec![file, image],
                MAX_ATTACHMENTS_PER_MESSAGE,
                DraftTarget::New,
            )
            .unwrap();
        assert_eq!(summaries.len(), 2);
        let expires_at = summaries[0].expires_at;
        let blocks = vec![
            DraftContentBlock::Text("Compare quarterly total with the chart".to_owned()),
            DraftContentBlock::File(file_id),
            DraftContentBlock::Image(image_id),
        ];
        let operation_id = Uuid::now_v7();
        let pending = repository
            .create_session_and_enqueue_multimodal(project_id, &blocks, operation_id, 7)
            .unwrap();
        assert_eq!(
            repository
                .create_session_and_enqueue_multimodal(project_id, &blocks, operation_id, 7)
                .unwrap(),
            pending
        );
        let changed_blocks = vec![
            DraftContentBlock::Text("different".to_owned()),
            DraftContentBlock::File(file_id),
            DraftContentBlock::Image(image_id),
        ];
        assert_eq!(
            repository.create_session_and_enqueue_multimodal(
                project_id,
                &changed_blocks,
                operation_id,
                7,
            ),
            Err(ChatError::ConversationConflict)
        );

        drop(repository);
        let mut repository = open_repository_for_scope(&root, 44, primary_scope);
        let persisted_history = repository
            .load_history(pending.session_id, None, Some(20))
            .unwrap();
        let persisted_message_id = persisted_history.turns[0].messages[0].message_id;
        let persisted_blocks = repository
            .load_message_content_blocks(vec![persisted_message_id])
            .unwrap();
        assert!(matches!(
            persisted_blocks.as_slice(),
            [(message_id, blocks)]
                if *message_id == persisted_message_id
                    && matches!(blocks.as_slice(), [
                        MessageContentBlockProjection::Text { ordinal: 0, .. },
                        MessageContentBlockProjection::Attachment { ordinal: 1, attachment: persisted_file },
                        MessageContentBlockProjection::Attachment { ordinal: 2, attachment: persisted_image },
                    ] if persisted_file.attachment_id == file_id
                        && persisted_file.safe_name == "quarterly-total.csv"
                        && persisted_file.state == "bound"
                        && persisted_image.attachment_id == image_id
                        && persisted_image.safe_name == "chart.png"
                        && persisted_image.state == "bound")
        ));

        let now = unix_seconds().unwrap();
        let create = repository
            .claim_next_conversation_outbox(now.max(unix_seconds().unwrap()), 30)
            .unwrap()
            .unwrap();
        let public_task_id = Uuid::now_v7();
        repository
            .bind_public_task(create.operation_id, public_task_id, now)
            .unwrap();
        repository
            .reschedule_outbox(create.operation_id, now)
            .unwrap();
        let create = repository
            .claim_next_conversation_outbox(now.max(unix_seconds().unwrap()), 30)
            .unwrap()
            .unwrap();
        repository
            .bind_host_session_and_enqueue_turn(
                create.operation_id,
                public_task_id,
                Uuid::now_v7(),
                Uuid::now_v7(),
            )
            .unwrap();
        let turn = repository
            .claim_next_conversation_outbox(now.max(unix_seconds().unwrap()), 30)
            .unwrap()
            .unwrap();
        assert_eq!(
            repository.start_turn_payload_version(turn.operation_id),
            Ok(2)
        );
        let dispatch = repository
            .load_start_turn_dispatch_v2(turn.operation_id)
            .unwrap();
        assert_eq!(dispatch.content_blocks.len(), 3);
        assert!(matches!(
            &dispatch.content_blocks[0],
            HostTurnInputBlock::Text { text }
                if text == "Compare quarterly total with the chart"
        ));
        assert!(matches!(
            &dispatch.content_blocks[1],
            HostTurnInputBlock::File {
                attachment_id,
                safe_name,
                media_type,
                size_bytes: 19,
                context_chunks,
                ..
            } if *attachment_id == file_id
                && safe_name == "quarterly-total.csv"
                && media_type == "text/csv"
                && context_chunks == &["quarter,total Q1,42"]
        ));
        assert!(matches!(
            &dispatch.content_blocks[2],
            HostTurnInputBlock::Image {
                attachment_id,
                media_type,
                size_bytes,
                data_url,
                ..
            } if *attachment_id == image_id
                && media_type == "image/png"
                && *size_bytes == image_size
                && data_url.starts_with("data:image/png;base64,")
        ));

        assert_eq!(repository.expire_attachments(expires_at).unwrap(), 2);
        let wal = root.join("chat").join(format!("{DATABASE_FILE_NAME}-wal"));
        assert!(!wal.exists() || fs::metadata(&wal).unwrap().len() == 0);
        assert_eq!(
            repository
                .connection
                .query_row(
                    "SELECT count(*) FROM chat_attachments
                     WHERE state='expired' AND content_blob IS NULL",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );
        assert_eq!(
            repository
                .connection
                .query_row("SELECT count(*) FROM chat_attachment_chunks", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
        let history = repository
            .load_history(pending.session_id, None, Some(1))
            .unwrap();
        let message_id = history.turns[0].messages[0].message_id;
        let projected = repository
            .load_message_content_blocks(vec![message_id])
            .unwrap();
        assert!(matches!(
            &projected[0].1[1],
            MessageContentBlockProjection::Attachment { attachment, .. }
                if attachment.state == "expired"
        ));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn debug_projections_never_emit_message_title_project_or_reasoning_bodies() {
        let canary = "FEAT126-S7B-PRIVATE-CANARY";
        let message = HistoryMessage {
            message_id: Uuid::now_v7(),
            role: "assistant".to_owned(),
            content: canary.to_owned(),
            status: "committed".to_owned(),
            ordinal: 1,
            created_at: 1,
        };
        let reasoning = ReasoningItem {
            item_id: "reasoning".to_owned(),
            item_ordinal: 0,
            status: ReasoningStatus::Complete,
            reason_code: None,
            finalized_at_ms: 1,
            parts: vec![ReasoningPart {
                content_index: 0,
                text: canary.to_owned(),
            }],
        };
        let session = SessionSummary {
            session_id: Uuid::now_v7(),
            project_id: Uuid::now_v7(),
            title: canary.to_owned(),
            title_source: SessionTitleSource::User,
            pinned_at: None,
            last_activity_at: 1,
            latest_turn_status: Some("completed".to_owned()),
            project_available: true,
        };
        let project = ProjectSummary {
            id: Uuid::now_v7().to_string(),
            safe_name: canary.to_owned(),
            pinned_at: None,
            last_used_at: 1,
            available: true,
        };
        for debug in [
            format!("{message:?}"),
            format!("{reasoning:?}"),
            format!("{session:?}"),
            format!("{project:?}"),
        ] {
            assert!(!debug.contains(canary));
        }
    }

    #[cfg(feature = "feat126-s10-driver")]
    #[test]
    fn r8_restart_candidates_preserve_exact_persisted_host_identity_after_terminal_turn() {
        let root = std::env::temp_dir().join(format!("feat126-r8-resume-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let mut repository = open_repository(&root, 42);
        let project_id = register_synthetic_project(&mut repository, &root);
        let pending = repository
            .create_session_and_enqueue(project_id, "首条消息", Uuid::now_v7())
            .unwrap();
        let now = unix_seconds().unwrap();
        let (agent_session_id, codex_thread_id) =
            bind_and_accept_first_turn(&mut repository, &pending, now);
        let task_id = repository
            .active_turn_context(pending.session_id)
            .unwrap()
            .task_id;
        repository
            .commit_terminal_turn(&TerminalTurnCommit {
                local_turn_id: pending.turn_id,
                terminal_status: "failed".to_owned(),
                terminal_at: now,
                assistant_text: String::new(),
                cursor: StoredEventCursor {
                    stream_id: Uuid::now_v7(),
                    sequence: 1,
                    event_id: Uuid::now_v7(),
                },
                reasoning_status: ReasoningStatus::Unavailable,
                reasoning_reason_code: Some("reasoning_not_emitted".to_owned()),
                reasoning_items: Vec::new(),
            })
            .unwrap();

        assert_eq!(
            repository.feat126_resume_candidates().unwrap(),
            vec![Feat126ResumeCandidate {
                task_id,
                agent_session_id,
                codex_thread_id,
            }]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(feature = "feat126-s10-driver")]
    #[test]
    fn r8_database_retry_uses_busy_taxonomy_and_one_monotonic_deadline() {
        use std::cell::Cell;

        let started = Instant::now();
        let now = Cell::new(started);
        let calls = Cell::new(0_u8);
        let slept = Cell::new(Duration::ZERO);
        let value = retry_r8_sqlite_busy_until(
            started + Duration::from_micros(300),
            || {
                calls.set(calls.get() + 1);
                if calls.get() <= 2 {
                    Err(ChatError::DatabaseBusy)
                } else {
                    Ok(7_u8)
                }
            },
            || now.get(),
            |duration| {
                slept.set(slept.get() + duration);
                now.set(now.get() + duration);
            },
        )
        .unwrap();
        assert_eq!(value, 7);
        assert_eq!(calls.get(), 3);
        assert_eq!(slept.get(), Duration::from_micros(200));

        for terminal in [
            ChatError::ConversationConflict,
            ChatError::DatabaseUnavailable,
        ] {
            let calls = Cell::new(0_u8);
            let result = retry_r8_sqlite_busy_until(
                started + Duration::from_secs(1),
                || {
                    calls.set(calls.get() + 1);
                    Err::<(), _>(terminal)
                },
                || started,
                |_| panic!("terminal database failures must not sleep"),
            );
            assert_eq!(result, Err(terminal));
            assert_eq!(calls.get(), 1);
        }

        let now = Cell::new(started);
        let calls = Cell::new(0_u8);
        let result = retry_r8_sqlite_busy_until(
            started + Duration::from_micros(150),
            || {
                calls.set(calls.get() + 1);
                Err::<(), _>(ChatError::DatabaseBusy)
            },
            || now.get(),
            |duration| now.set(now.get() + duration),
        );
        assert_eq!(result, Err(ChatError::DatabaseBusy));
        assert_eq!(calls.get(), 2);
        assert_eq!(now.get(), started + Duration::from_micros(100));

        let now = Cell::new(started);
        let calls = Cell::new(0_u8);
        let result = retry_r8_sqlite_busy_until(
            started + Duration::from_micros(300),
            || {
                calls.set(calls.get() + 1);
                Err::<(), _>(ChatError::DatabaseBusy)
            },
            || now.get(),
            |duration| now.set(now.get() + duration + Duration::from_micros(300)),
        );
        assert_eq!(result, Err(ChatError::DatabaseBusy));
        assert_eq!(calls.get(), 1);
    }

    #[cfg(feature = "feat126-s10-driver")]
    #[test]
    fn r8_native_probe_measures_the_frozen_scale_without_content_projection() {
        let root = std::env::temp_dir().join(format!("feat126-r8-probe-{}", Uuid::now_v7()));
        let projection = ChatRepository::run_r8_probe_at(&root, scope()).unwrap();
        assert_eq!(projection.schema_version, 1);
        assert_eq!(projection.status, "passed");
        assert!(projection.metadata_p95_ms <= 200);
        assert!(projection.history_p95_ms <= 300);
        assert_eq!(projection.reducer_observations, 10_000);
        assert_eq!(projection.session_count, 10_000);
        assert_eq!(projection.message_count, 1_000_000);
        assert_eq!(projection.idempotency_pairs, 10_000);
        assert_eq!(projection.duplicate_count, 0);
        assert!(!root.exists());
        let encoded = serde_json::to_string(&projection).unwrap();
        assert!(!encoded.contains("synthetic idempotency probe"));
    }
}
