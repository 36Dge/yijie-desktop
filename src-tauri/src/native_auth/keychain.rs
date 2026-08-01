use super::error::NativeAuthError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub const KEYCHAIN_SERVICE: &str = "ai.yijie.desktop.auth";
const KEYCHAIN_ACCOUNT: &str = "refresh-token-family";

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
pub struct StoredRefreshToken {
    pub refresh_token: String,
    pub issued_at_epoch_seconds: u64,
    pub last_used_at_epoch_seconds: u64,
    pub absolute_expires_at_epoch_seconds: u64,
}

impl std::fmt::Debug for StoredRefreshToken {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("StoredRefreshToken")
            .field("refresh_token", &"[REDACTED]")
            .field("issued_at_epoch_seconds", &self.issued_at_epoch_seconds)
            .field(
                "last_used_at_epoch_seconds",
                &self.last_used_at_epoch_seconds,
            )
            .field(
                "absolute_expires_at_epoch_seconds",
                &self.absolute_expires_at_epoch_seconds,
            )
            .finish()
    }
}

#[async_trait]
pub trait RefreshTokenStore: Send + Sync {
    async fn save(&self, token: &StoredRefreshToken) -> Result<(), NativeAuthError>;
    async fn load(&self) -> Result<Option<StoredRefreshToken>, NativeAuthError>;
    async fn delete(&self) -> Result<(), NativeAuthError>;
}

#[cfg(target_os = "macos")]
pub struct ProtectedKeychainStore {
    entry: std::sync::Arc<keyring_core::Entry>,
}

#[cfg(target_os = "macos")]
impl ProtectedKeychainStore {
    pub fn new() -> Result<Self, NativeAuthError> {
        use keyring_core::api::CredentialStoreApi;
        use std::collections::HashMap;

        let store = apple_native_keyring_store::protected::Store::new()
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)?;
        let modifiers = HashMap::from([("access-policy", "when-unlocked-this-device-only")]);
        let entry = store
            .build(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, Some(&modifiers))
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)?;
        Ok(Self {
            entry: std::sync::Arc::new(entry),
        })
    }
}

#[cfg(target_os = "macos")]
#[async_trait]
impl RefreshTokenStore for ProtectedKeychainStore {
    async fn save(&self, token: &StoredRefreshToken) -> Result<(), NativeAuthError> {
        let encoded = Zeroizing::new(
            serde_json::to_vec(token).map_err(|_| NativeAuthError::SecureStorageUnavailable)?,
        );
        let entry = self.entry.clone();
        tokio::task::spawn_blocking(move || entry.set_secret(encoded.as_slice()))
            .await
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)?
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)
    }

    async fn load(&self) -> Result<Option<StoredRefreshToken>, NativeAuthError> {
        let entry = self.entry.clone();
        let result = tokio::task::spawn_blocking(move || entry.get_secret())
            .await
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)?;
        let secret = match result {
            Ok(value) => Zeroizing::new(value),
            Err(keyring_core::Error::NoEntry) => return Ok(None),
            Err(_) => return Err(NativeAuthError::SecureStorageUnavailable),
        };
        serde_json::from_slice(secret.as_slice())
            .map(Some)
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)
    }

    async fn delete(&self) -> Result<(), NativeAuthError> {
        let entry = self.entry.clone();
        let result = tokio::task::spawn_blocking(move || entry.delete_credential())
            .await
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)?;
        match result {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(_) => Err(NativeAuthError::SecureStorageUnavailable),
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub struct ProtectedKeychainStore;

#[cfg(not(target_os = "macos"))]
impl ProtectedKeychainStore {
    pub fn new() -> Result<Self, NativeAuthError> {
        Err(NativeAuthError::SecureStorageUnavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persisted_envelope_rejects_unknown_fields_and_redacts_debug() {
        let token = StoredRefreshToken {
            refresh_token: "refresh-secret".to_owned(),
            issued_at_epoch_seconds: 10,
            last_used_at_epoch_seconds: 20,
            absolute_expires_at_epoch_seconds: 30,
        };
        assert!(!format!("{token:?}").contains("refresh-secret"));

        let invalid = br#"{"refresh_token":"x","issued_at_epoch_seconds":1,"last_used_at_epoch_seconds":2,"absolute_expires_at_epoch_seconds":3,"access_token":"forbidden"}"#;
        assert!(serde_json::from_slice::<StoredRefreshToken>(invalid).is_err());
    }

    #[test]
    fn keychain_namespace_is_fixed() {
        assert_eq!(KEYCHAIN_SERVICE, "ai.yijie.desktop.auth");
        assert_eq!(KEYCHAIN_ACCOUNT, "refresh-token-family");
    }
}
