use serde::Serialize;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatError {
    Disabled,
    InvalidConfiguration,
    SecureStorageUnavailable,
    DatabaseKeyMissing,
    DatabaseUnsafe,
    DatabaseUnavailable,
    MigrationFailed,
    InvalidInput,
    NotFound,
    ScopeDenied,
    ProjectUnavailable,
    NativePickerUnavailable,
    SidecarUnavailable,
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
            Self::DatabaseUnavailable => "chat_database_unavailable",
            Self::MigrationFailed => "chat_migration_failed",
            Self::InvalidInput => "chat_invalid_input",
            Self::NotFound => "chat_not_found",
            Self::ScopeDenied => "chat_scope_denied",
            Self::ProjectUnavailable => "chat_project_unavailable",
            Self::NativePickerUnavailable => "chat_native_picker_unavailable",
            Self::SidecarUnavailable => "chat_sidecar_unavailable",
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
    }
}
