use serde::Serialize;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeAuthError {
    Disabled,
    InvalidConfiguration,
    LoginInProgress,
    CallbackRejected,
    AuthenticationFailed,
    SignedOut,
    SecureStorageUnavailable,
    SessionExpired,
    InvalidTenant,
    TransportFailed,
    ResponseRejected,
}

impl NativeAuthError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Disabled => "native_auth_disabled",
            Self::InvalidConfiguration => "native_auth_configuration_invalid",
            Self::LoginInProgress => "native_auth_login_in_progress",
            Self::CallbackRejected => "native_auth_callback_rejected",
            Self::AuthenticationFailed => "native_auth_failed",
            Self::SignedOut => "native_auth_signed_out",
            Self::SecureStorageUnavailable => "native_auth_secure_storage_unavailable",
            Self::SessionExpired => "native_auth_session_expired",
            Self::InvalidTenant => "native_auth_tenant_invalid",
            Self::TransportFailed => "native_auth_transport_failed",
            Self::ResponseRejected => "native_auth_response_rejected",
        }
    }

    const fn message(self) -> &'static str {
        match self {
            Self::Disabled => "Native authentication is not enabled.",
            Self::InvalidConfiguration => "Native authentication configuration is invalid.",
            Self::LoginInProgress => "A native login is already in progress.",
            Self::CallbackRejected => "The authentication callback was rejected.",
            Self::AuthenticationFailed => "Authentication could not be completed.",
            Self::SignedOut => "Sign in is required.",
            Self::SecureStorageUnavailable => "Secure credential storage is unavailable.",
            Self::SessionExpired => "The authentication session has expired.",
            Self::InvalidTenant => "The tenant identifier is invalid.",
            Self::TransportFailed => "The requested operation could not be completed.",
            Self::ResponseRejected => "The service response was rejected.",
        }
    }
}

impl Display for NativeAuthError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message())
    }
}

impl std::error::Error for NativeAuthError {}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: &'static str,
}

impl From<NativeAuthError> for CommandError {
    fn from(error: NativeAuthError) -> Self {
        Self {
            code: error.code(),
            message: error.message(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_errors_never_serialize_internal_details() {
        let error = CommandError::from(NativeAuthError::AuthenticationFailed);
        let encoded = serde_json::to_string(&error).expect("serialize command error");

        assert_eq!(
            encoded,
            r#"{"code":"native_auth_failed","message":"Authentication could not be completed."}"#
        );
    }
}
