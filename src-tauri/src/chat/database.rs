use super::error::ChatError;
use super::keychain::{DatabaseKey, ReceiptKey};
use super::migrations;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
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

#[derive(Clone)]
pub struct ChatScope {
    owner_user_id: String,
    tenant_id: String,
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
    pub task_id: Uuid,
    pub project_id: Uuid,
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
    connection: Connection,
    database_path: PathBuf,
    scope: ChatScope,
    receipt_key: ReceiptKey,
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
                .map_err(|_| ChatError::DatabaseUnavailable)?;
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
        .map_err(|_| ChatError::DatabaseUnavailable)?;
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
        Ok(Self {
            connection,
            database_path,
            scope,
            receipt_key,
        })
    }

    pub fn schema_version(&self) -> Result<i64, ChatError> {
        self.connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|_| ChatError::DatabaseUnavailable)
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

    pub fn create_session_and_enqueue(
        &mut self,
        project_id: Uuid,
        input: &str,
        create_operation_id: Uuid,
    ) -> Result<PendingConversation, ChatError> {
        validate_non_nil(project_id)?;
        validate_non_nil(create_operation_id)?;
        validate_message(input)?;
        let now = unix_seconds()?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if let Some((stored_session_id, version, payload)) = transaction
            .query_row(
                "SELECT o.session_id, o.payload_version, o.encrypted_payload
                 FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
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
                    ))
                },
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
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
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            if payload.session_id.to_string() != stored_session_id
                || payload.task_id != payload.session_id
                || stored_project_and_input != Some((project_id.to_string(), input.to_owned()))
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
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if !project_exists {
            return Err(ChatError::NotFound);
        }
        let session_id = Uuid::now_v7();
        let task_id = session_id;
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
        transaction
            .commit()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
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
        let (session_id, project_id, version, payload): (String, String, i64, Vec<u8>) = self
            .connection
            .query_row(
                "SELECT s.id, s.project_id, o.payload_version, o.encrypted_payload
                 FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
                 WHERE o.operation_id=?1 AND o.kind='create_session' AND o.state='inflight'
                   AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .ok_or(ChatError::ConversationConflict)?;
        if version != OUTBOX_PAYLOAD_VERSION {
            return Err(ChatError::DatabaseUnavailable);
        }
        let payload: CreateSessionPayloadV1 = decode_payload(&payload)?;
        let parsed_session = parse_uuid_value(&session_id)?;
        if payload.session_id != parsed_session || payload.task_id != parsed_session {
            return Err(ChatError::DatabaseUnavailable);
        }
        Ok(CreateSessionDispatch {
            operation_id,
            session_id: parsed_session,
            task_id: payload.task_id,
            project_id: parse_uuid_value(&project_id)?,
        })
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
        let (session_id, state, version, payload): (String, String, i64, Vec<u8>) = transaction
            .query_row(
                "SELECT o.session_id, o.state, o.payload_version, o.encrypted_payload
                 FROM chat_outbox o JOIN chat_sessions s ON s.id=o.session_id
                 WHERE o.operation_id=?1 AND o.kind='create_session'
                   AND s.owner_user_id=?2 AND s.tenant_id=?3",
                params![
                    create_operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .ok_or(ChatError::NotFound)?;
        if version != OUTBOX_PAYLOAD_VERSION {
            return Err(ChatError::DatabaseUnavailable);
        }
        let create: CreateSessionPayloadV1 = decode_payload(&payload)?;
        if create.session_id.to_string() != session_id || create.task_id != task_id {
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
        let turn_payload = encode_payload(&StartTurnPayloadV1 {
            turn_id: create.turn_id,
            message_id: create.message_id,
        })?;
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
                    OUTBOX_PAYLOAD_VERSION,
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
                OUTBOX_PAYLOAD_VERSION,
                encode_payload(&StartTurnPayloadV1 {
                    turn_id: create.turn_id,
                    message_id: create.message_id,
                })?,
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
            Option<String>,
            Option<i64>,
            Option<String>,
        );
        let row: ActiveRow = self
            .connection
            .query_row(
                "SELECT s.id, t.id, t.operation_id, s.agent_session_id, s.runtime_thread_id,
                        t.runtime_turn_id, COALESCE(m.content, ''), c.stream_id, c.sequence, c.event_id
                 FROM chat_sessions s JOIN chat_turns t ON t.session_id=s.id
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
                    ))
                },
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .ok_or(ChatError::NotFound)?;
        let cursor = match (row.7, row.8, row.9) {
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
            task_id: parse_uuid_value(&row.0)?,
            turn_id: parse_uuid_value(&row.1)?,
            turn_operation_id: parse_uuid_value(&row.2)?,
            agent_session_id: parse_uuid_value(&row.3)?,
            codex_thread_id: parse_uuid_value(&row.4)?,
            runtime_turn_id: parse_uuid_value(&row.5)?,
            assistant_text: row.6,
            cursor,
        })
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
        ] {
            let query = format!("SELECT count(*) FROM {table} WHERE {column}=?1");
            let count: i64 = transaction
                .query_row(&query, [session_id], |row| row.get(0))
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            if count != 0 {
                return Err(ChatError::CleanupIncomplete);
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

    fn checkpoint_after_delete(&self) -> Result<(), ChatError> {
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

fn validate_message_output(value: &str) -> Result<(), ChatError> {
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

fn validate_cursor(cursor: &StoredEventCursor) -> Result<(), ChatError> {
    validate_non_nil(cursor.stream_id)?;
    validate_non_nil(cursor.event_id)?;
    if cursor.sequence == 0 || cursor.sequence > i64::MAX as u64 {
        return Err(ChatError::InvalidInput);
    }
    Ok(())
}

fn advance_cursor(
    transaction: &rusqlite::Transaction<'_>,
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

fn map_constraint_or_database(error: rusqlite::Error) -> ChatError {
    match error {
        rusqlite::Error::SqliteFailure(ref inner, _)
            if inner.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            ChatError::ConversationConflict
        }
        _ => ChatError::DatabaseUnavailable,
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
        .map_err(|_| ChatError::DatabaseUnavailable)?;
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
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if actual != expected {
            return Err(ChatError::DatabaseUnavailable);
        }
    }
    let journal_mode: String = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .map_err(|_| ChatError::DatabaseUnavailable)?;
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
        assert_eq!(dispatch.task_id, pending.task_id);
        let agent_session_id = Uuid::now_v7();
        let thread_id = Uuid::now_v7();
        repository
            .bind_host_session_and_enqueue_turn(
                create.operation_id,
                dispatch.task_id,
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
}
