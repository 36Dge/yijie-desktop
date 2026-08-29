use serde::Serialize;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatError {
    Disabled,
    InvalidConfiguration,
    SecureStorageUnavailable,
    DatabaseKeyMissing,
    DatabaseUnsafe,
    DatabaseBusy,
    DatabaseUnavailable,
    DatabaseReadOnly,
    DatabaseFull,
    DatabaseCorrupt,
    MigrationFailed,
    InvalidInput,
    NotFound,
    ScopeDenied,
    ProjectUnavailable,
    NativePickerUnavailable,
    SidecarUnavailable,
    ConversationConflict,
    OrchestrationUnavailable,
    ProjectionLimitExceeded,
    ProjectionReconciliationFailed,
    CleanupIncomplete,
}

impl ChatError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Disabled => "chat_disabled",
            Self::InvalidConfiguration => "chat_invalid_configuration",
            Self::SecureStorageUnavailable => "chat_secure_storage_unavailable",
            Self::DatabaseKeyMissing => "chat_database_key_missing",
            Self::DatabaseUnsafe => "chat_database_unsafe",
            Self::DatabaseBusy => "chat_database_unavailable",
            Self::DatabaseUnavailable => "chat_database_unavailable",
            Self::DatabaseReadOnly => "chat_database_read_only",
            Self::DatabaseFull => "chat_database_full",
            Self::DatabaseCorrupt => "chat_database_corrupt",
            Self::MigrationFailed => "chat_migration_failed",
            Self::InvalidInput => "chat_invalid_input",
            Self::NotFound => "chat_not_found",
            Self::ScopeDenied => "chat_scope_denied",
            Self::ProjectUnavailable => "chat_project_unavailable",
            Self::NativePickerUnavailable => "chat_native_picker_unavailable",
            Self::SidecarUnavailable => "chat_sidecar_unavailable",
            Self::ConversationConflict => "chat_conversation_conflict",
            Self::OrchestrationUnavailable => "chat_orchestration_unavailable",
            Self::ProjectionLimitExceeded => "chat_limit_exceeded",
            Self::ProjectionReconciliationFailed => "chat_conversation_conflict",
            Self::CleanupIncomplete => "chat_cleanup_incomplete",
        }
    }
}

impl Display for ChatError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for ChatError {}

pub(crate) fn map_sqlite_error(error: rusqlite::Error) -> ChatError {
    match error.sqlite_error_code() {
        Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked) => {
            ChatError::DatabaseBusy
        }
        Some(rusqlite::ErrorCode::ReadOnly) => ChatError::DatabaseReadOnly,
        Some(rusqlite::ErrorCode::DiskFull) => ChatError::DatabaseFull,
        Some(rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase) => {
            ChatError::DatabaseCorrupt
        }
        _ => ChatError::DatabaseUnavailable,
    }
}

#[derive(Debug, Serialize)]
pub struct ChatCommandError {
    pub code: &'static str,
}

impl From<ChatError> for ChatCommandError {
    fn from(value: ChatError) -> Self {
        Self { code: value.code() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_errors_have_only_stable_content_free_codes() {
        let encoded = serde_json::to_string(&ChatCommandError::from(ChatError::DatabaseUnsafe))
            .expect("serialize command error");
        assert_eq!(encoded, r#"{"code":"chat_database_unsafe"}"#);
        let busy = serde_json::to_string(&ChatCommandError::from(ChatError::DatabaseBusy))
            .expect("serialize busy command error");
        assert_eq!(busy, r#"{"code":"chat_database_unavailable"}"#);
    }

    #[test]
    fn sqlite_storage_failures_map_to_closed_content_free_states() {
        for (code, expected) in [
            (rusqlite::ffi::SQLITE_BUSY, ChatError::DatabaseBusy),
            (rusqlite::ffi::SQLITE_LOCKED, ChatError::DatabaseBusy),
            (rusqlite::ffi::SQLITE_READONLY, ChatError::DatabaseReadOnly),
            (rusqlite::ffi::SQLITE_FULL, ChatError::DatabaseFull),
            (rusqlite::ffi::SQLITE_CORRUPT, ChatError::DatabaseCorrupt),
            (rusqlite::ffi::SQLITE_NOTADB, ChatError::DatabaseCorrupt),
        ] {
            let error = rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(code), None);
            assert_eq!(map_sqlite_error(error), expected);
        }
    }
}
