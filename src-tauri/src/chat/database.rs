use super::error::ChatError;
use super::keychain::DatabaseKey;
use super::migrations;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const DATABASE_FILE_NAME: &str = "conversations.db";
const MAX_REASONING_PART_BYTES: usize = 64 * 1024;
const MAX_REASONING_ITEM_BYTES: usize = 128 * 1024;
const MAX_REASONING_TURN_BYTES: usize = 256 * 1024;
const MAX_REASONING_ITEMS: usize = 8;
const MAX_REASONING_PARTS: usize = 8;

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
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ProjectSummary {
    pub id: String,
    pub safe_name: String,
    pub pinned_at: Option<i64>,
    pub last_used_at: i64,
    pub available: bool,
}

pub struct ChatRepository {
    connection: Connection,
    database_path: PathBuf,
    scope: ChatScope,
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReasoningPart {
    pub content_index: usize,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReasoningItem {
    pub item_id: String,
    pub item_ordinal: usize,
    pub status: ReasoningStatus,
    pub reason_code: Option<String>,
    pub finalized_at_ms: i64,
    pub parts: Vec<ReasoningPart>,
}

impl ChatRepository {
    pub fn database_exists(chat_directory: &Path) -> bool {
        chat_directory.join(DATABASE_FILE_NAME).exists()
    }

    pub fn open(
        chat_directory: &Path,
        key: &DatabaseKey,
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
        let owned: bool = transaction
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
        let mut item_statement = self
            .connection
            .prepare(
                "SELECT item_id, item_ordinal, status, reason_code, finalized_at_ms
                 FROM chat_reasoning_items WHERE turn_id=?1 ORDER BY item_ordinal",
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let item_rows = item_statement
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
                ))
            })
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let mut items = Vec::with_capacity(item_rows.len());
        for (item_id, item_ordinal, status, reason_code, finalized_at_ms) in item_rows {
            let mut part_statement = self
                .connection
                .prepare(
                    "SELECT content_index, text FROM chat_reasoning_parts
                     WHERE turn_id=?1 AND item_id=?2 ORDER BY content_index",
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            let parts = part_statement
                .query_map(params![turn_id, item_id], |row| {
                    Ok(ReasoningPart {
                        content_index: usize::try_from(row.get::<_, i64>(0)?).map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                0,
                                rusqlite::types::Type::Integer,
                                Box::new(error),
                            )
                        })?,
                        text: row.get(1)?,
                    })
                })
                .map_err(|_| ChatError::DatabaseUnavailable)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            items.push(ReasoningItem {
                item_id,
                item_ordinal,
                status: parse_reasoning_status(&status)?,
                reason_code,
                finalized_at_ms,
                parts,
            });
        }
        Ok(items)
    }

    pub fn delete_session_local(&mut self, session_id: &str) -> Result<(), ChatError> {
        validate_uuid(session_id)?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
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
                "INSERT INTO chat_turns(id, session_id, operation_id, status) VALUES (?1, ?2, ?3, 'completed')",
                params![turn_id, session_id, Uuid::now_v7().to_string()],
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
    let mut turn_bytes = 0_usize;
    for (expected_ordinal, item) in items.iter().enumerate() {
        if item.item_id.trim().is_empty()
            || item.item_id.len() > 255
            || item.item_ordinal != expected_ordinal
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
            scope(),
        )
        .expect("open SQLCipher repository")
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
            ChatRepository::open(&chat, &DatabaseKey::from_bytes([3; 32]), scope()),
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
        let items = vec![ReasoningItem {
            item_id: "reasoning-item-1".to_owned(),
            item_ordinal: 0,
            status: ReasoningStatus::Complete,
            reason_code: None,
            finalized_at_ms: 1,
            parts: vec![ReasoningPart {
                content_index: 0,
                text: canary.to_owned(),
            }],
        }];
        repository
            .commit_reasoning(&turn_id, ReasoningStatus::Complete, None, &items)
            .unwrap();
        assert_eq!(repository.load_reasoning(&turn_id).unwrap(), items);

        let oversized = vec![ReasoningItem {
            item_id: "reasoning-item-2".to_owned(),
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
}
