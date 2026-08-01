use super::error::NativeAuthError;
use super::NativeAuthConfig;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub const KEYCHAIN_SERVICE: &str = "ai.yijie.desktop.auth";
const KEYCHAIN_ACCOUNT: &str = "refresh-token-family-v2";
const LEGACY_KEYCHAIN_ACCOUNT: &str = "refresh-token-family";
const REFRESH_TOKEN_SCHEMA_VERSION: u16 = 2;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RefreshTokenBinding {
    environment: String,
    issuer: String,
    client_id: String,
}

impl RefreshTokenBinding {
    pub fn from_config(config: &NativeAuthConfig) -> Self {
        Self {
            environment: config.environment.as_str().to_owned(),
            issuer: config.issuer.to_string(),
            client_id: config.client_id.clone(),
        }
    }
}

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
pub struct StoredRefreshToken {
    schema_version: u16,
    environment: String,
    issuer: String,
    client_id: String,
    pub refresh_token: String,
    pub issued_at_epoch_seconds: u64,
    pub last_used_at_epoch_seconds: u64,
    pub absolute_expires_at_epoch_seconds: u64,
}

impl std::fmt::Debug for StoredRefreshToken {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("StoredRefreshToken")
            .field("schema_version", &self.schema_version)
            .field("environment", &self.environment)
            .field("issuer", &"[BOUND]")
            .field("client_id", &"[BOUND]")
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

impl StoredRefreshToken {
    pub fn new(
        binding: &RefreshTokenBinding,
        refresh_token: String,
        issued_at_epoch_seconds: u64,
        last_used_at_epoch_seconds: u64,
        absolute_expires_at_epoch_seconds: u64,
    ) -> Self {
        Self {
            schema_version: REFRESH_TOKEN_SCHEMA_VERSION,
            environment: binding.environment.clone(),
            issuer: binding.issuer.clone(),
            client_id: binding.client_id.clone(),
            refresh_token,
            issued_at_epoch_seconds,
            last_used_at_epoch_seconds,
            absolute_expires_at_epoch_seconds,
        }
    }

    pub fn is_bound_to(&self, binding: &RefreshTokenBinding) -> bool {
        self.schema_version == REFRESH_TOKEN_SCHEMA_VERSION
            && self.environment == binding.environment
            && self.issuer == binding.issuer
            && self.client_id == binding.client_id
    }
}

#[derive(Debug)]
pub enum RefreshTokenRecord {
    Missing,
    Current(StoredRefreshToken),
    Incompatible,
}

#[async_trait]
pub trait RefreshTokenStore: Send + Sync {
    async fn save(&self, token: &StoredRefreshToken) -> Result<(), NativeAuthError>;
    async fn load(&self) -> Result<RefreshTokenRecord, NativeAuthError>;
    async fn delete(&self) -> Result<(), NativeAuthError>;
}

#[cfg(target_os = "macos")]
pub struct ProtectedKeychainStore {
    entry: std::sync::Arc<keyring_core::Entry>,
    legacy_entry: std::sync::Arc<keyring_core::Entry>,
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
        let legacy_entry = store
            .build(KEYCHAIN_SERVICE, LEGACY_KEYCHAIN_ACCOUNT, Some(&modifiers))
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)?;
        Ok(Self {
            entry: std::sync::Arc::new(entry),
            legacy_entry: std::sync::Arc::new(legacy_entry),
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

    async fn load(&self) -> Result<RefreshTokenRecord, NativeAuthError> {
        let entry = self.entry.clone();
        let current = tokio::task::spawn_blocking(move || entry.get_secret())
            .await
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)?;
        let legacy_entry = self.legacy_entry.clone();
        let legacy = tokio::task::spawn_blocking(move || legacy_entry.get_secret())
            .await
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)?;

        let current = current.map(Zeroizing::new);
        let legacy = legacy.map(Zeroizing::new);
        match (current, legacy) {
            (_, Ok(_legacy_secret)) => Ok(RefreshTokenRecord::Incompatible),
            (Ok(secret), Err(keyring_core::Error::NoEntry)) => {
                Ok(decode_refresh_token(secret.as_slice()))
            }
            (Err(keyring_core::Error::NoEntry), Err(keyring_core::Error::NoEntry)) => {
                Ok(RefreshTokenRecord::Missing)
            }
            (_, Err(_)) => Err(NativeAuthError::SecureStorageUnavailable),
        }
    }

    async fn delete(&self) -> Result<(), NativeAuthError> {
        let entry = self.entry.clone();
        let current = tokio::task::spawn_blocking(move || entry.delete_credential())
            .await
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)?;
        let legacy_entry = self.legacy_entry.clone();
        let legacy = tokio::task::spawn_blocking(move || legacy_entry.delete_credential())
            .await
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)?;
        match (current, legacy) {
            (
                Ok(()) | Err(keyring_core::Error::NoEntry),
                Ok(()) | Err(keyring_core::Error::NoEntry),
            ) => Ok(()),
            _ => Err(NativeAuthError::SecureStorageUnavailable),
        }
    }
}

fn decode_refresh_token(bytes: &[u8]) -> RefreshTokenRecord {
    match serde_json::from_slice(bytes) {
        Ok(token) => RefreshTokenRecord::Current(token),
        Err(_) => RefreshTokenRecord::Incompatible,
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
    fn persisted_envelope_is_versioned_bound_strict_and_redacted() {
        let binding = binding("production", "https://identity.example/", "client-a");
        let token = StoredRefreshToken::new(&binding, "refresh-secret".to_owned(), 10, 20, 30);
        assert!(!format!("{token:?}").contains("refresh-secret"));
        assert!(!format!("{token:?}").contains("https://identity.example/"));

        let encoded = serde_json::to_vec(&token).expect("serialize refresh envelope");
        assert!(matches!(
            decode_refresh_token(&encoded),
            RefreshTokenRecord::Current(_)
        ));

        let old = br#"{"refresh_token":"x","issued_at_epoch_seconds":1,"last_used_at_epoch_seconds":2,"absolute_expires_at_epoch_seconds":3}"#;
        assert!(matches!(
            decode_refresh_token(old),
            RefreshTokenRecord::Incompatible
        ));
        let unknown = br#"{"schema_version":2,"environment":"production","issuer":"https://identity.example/","client_id":"client-a","refresh_token":"x","issued_at_epoch_seconds":1,"last_used_at_epoch_seconds":2,"absolute_expires_at_epoch_seconds":3,"access_token":"forbidden"}"#;
        assert!(matches!(
            decode_refresh_token(unknown),
            RefreshTokenRecord::Incompatible
        ));
    }

    #[test]
    fn binding_rejects_version_environment_issuer_or_client_changes() {
        let expected_binding = binding("production", "https://identity.example/", "client-a");
        let mut token =
            StoredRefreshToken::new(&expected_binding, "refresh".to_owned(), 10, 20, 30);
        assert!(token.is_bound_to(&expected_binding));

        for changed in [
            binding("local-integration", "https://identity.example/", "client-a"),
            binding("production", "https://other.example/", "client-a"),
            binding("production", "https://identity.example/", "client-b"),
        ] {
            assert!(!token.is_bound_to(&changed));
        }
        token.schema_version += 1;
        assert!(!token.is_bound_to(&expected_binding));
    }

    #[test]
    fn keychain_namespace_is_fixed() {
        assert_eq!(KEYCHAIN_SERVICE, "ai.yijie.desktop.auth");
        assert_eq!(KEYCHAIN_ACCOUNT, "refresh-token-family-v2");
        assert_eq!(LEGACY_KEYCHAIN_ACCOUNT, "refresh-token-family");
    }

    fn binding(environment: &str, issuer: &str, client_id: &str) -> RefreshTokenBinding {
        RefreshTokenBinding {
            environment: environment.to_owned(),
            issuer: issuer.to_owned(),
            client_id: client_id.to_owned(),
        }
    }
}
