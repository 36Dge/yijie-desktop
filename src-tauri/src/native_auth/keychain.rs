use super::error::NativeAuthError;
use super::NativeAuthConfig;
use crate::feat126_secure_storage::{
    EphemeralSecretFile, EphemeralSecretRole, Feat126SecureStorageProfile,
};
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

pub struct ProtectedKeychainStore {
    backend: RefreshTokenBackend,
}

enum RefreshTokenBackend {
    Ephemeral(EphemeralSecretFile),
    #[cfg(target_os = "macos")]
    Protected {
        entry: std::sync::Arc<keyring_core::Entry>,
        legacy_entry: Option<std::sync::Arc<keyring_core::Entry>>,
    },
}

impl ProtectedKeychainStore {
    pub(crate) fn new_with_test_profile(
        profile: Option<std::sync::Arc<Feat126SecureStorageProfile>>,
    ) -> Result<Self, NativeAuthError> {
        if let Some(secret) = profile
            .as_ref()
            .and_then(|profile| profile.ephemeral_secret_file(EphemeralSecretRole::NativeAuth))
        {
            return Ok(Self {
                backend: RefreshTokenBackend::Ephemeral(secret),
            });
        }
        #[cfg(target_os = "macos")]
        {
            use keyring_core::api::CredentialStoreApi;
            use std::collections::HashMap;

            let store = apple_native_keyring_store::protected::Store::new()
                .map_err(|_| NativeAuthError::SecureStorageUnavailable)?;
            let modifiers = HashMap::from([("access-policy", "when-unlocked-this-device-only")]);
            let (service, account) = profile
                .as_deref()
                .map(|profile| {
                    let namespace = profile.native_auth_namespace();
                    (namespace.service(), namespace.account())
                })
                .unwrap_or((KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT));
            let entry = store
                .build(service, account, Some(&modifiers))
                .map_err(|_| NativeAuthError::SecureStorageUnavailable)?;
            let legacy_entry = if profile.is_some() {
                None
            } else {
                Some(std::sync::Arc::new(
                    store
                        .build(KEYCHAIN_SERVICE, LEGACY_KEYCHAIN_ACCOUNT, Some(&modifiers))
                        .map_err(|_| NativeAuthError::SecureStorageUnavailable)?,
                ))
            };
            Ok(Self {
                backend: RefreshTokenBackend::Protected {
                    entry: std::sync::Arc::new(entry),
                    legacy_entry,
                },
            })
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = profile;
            Err(NativeAuthError::SecureStorageUnavailable)
        }
    }
}

#[async_trait]
impl RefreshTokenStore for ProtectedKeychainStore {
    async fn save(&self, token: &StoredRefreshToken) -> Result<(), NativeAuthError> {
        let encoded = Zeroizing::new(
            serde_json::to_vec(token).map_err(|_| NativeAuthError::SecureStorageUnavailable)?,
        );
        match &self.backend {
            RefreshTokenBackend::Ephemeral(file) => {
                let file = file.clone();
                tokio::task::spawn_blocking(move || file.replace(encoded.as_slice()))
                    .await
                    .map_err(|_| NativeAuthError::SecureStorageUnavailable)?
                    .map_err(|_| NativeAuthError::SecureStorageUnavailable)
            }
            #[cfg(target_os = "macos")]
            RefreshTokenBackend::Protected { entry, .. } => {
                let entry = entry.clone();
                tokio::task::spawn_blocking(move || entry.set_secret(encoded.as_slice()))
                    .await
                    .map_err(|_| NativeAuthError::SecureStorageUnavailable)?
                    .map_err(|_| NativeAuthError::SecureStorageUnavailable)
            }
        }
    }

    async fn load(&self) -> Result<RefreshTokenRecord, NativeAuthError> {
        match &self.backend {
            RefreshTokenBackend::Ephemeral(file) => {
                let file = file.clone();
                let secret = tokio::task::spawn_blocking(move || file.load())
                    .await
                    .map_err(|_| NativeAuthError::SecureStorageUnavailable)?
                    .map_err(|_| NativeAuthError::SecureStorageUnavailable)?;
                Ok(match secret {
                    Some(secret) => decode_refresh_token(secret.as_slice()),
                    None => RefreshTokenRecord::Missing,
                })
            }
            #[cfg(target_os = "macos")]
            RefreshTokenBackend::Protected {
                entry,
                legacy_entry,
            } => {
                let entry = entry.clone();
                let current = tokio::task::spawn_blocking(move || entry.get_secret())
                    .await
                    .map_err(|_| NativeAuthError::SecureStorageUnavailable)?;
                let current = current.map(Zeroizing::new);
                let Some(legacy_entry) = legacy_entry.clone() else {
                    return match current {
                        Ok(secret) => Ok(decode_refresh_token(secret.as_slice())),
                        Err(keyring_core::Error::NoEntry) => Ok(RefreshTokenRecord::Missing),
                        Err(_) => Err(NativeAuthError::SecureStorageUnavailable),
                    };
                };
                let legacy = tokio::task::spawn_blocking(move || legacy_entry.get_secret())
                    .await
                    .map_err(|_| NativeAuthError::SecureStorageUnavailable)?
                    .map(Zeroizing::new);
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
        }
    }

    async fn delete(&self) -> Result<(), NativeAuthError> {
        match &self.backend {
            RefreshTokenBackend::Ephemeral(file) => {
                let file = file.clone();
                tokio::task::spawn_blocking(move || file.delete())
                    .await
                    .map_err(|_| NativeAuthError::SecureStorageUnavailable)?
                    .map_err(|_| NativeAuthError::SecureStorageUnavailable)
            }
            #[cfg(target_os = "macos")]
            RefreshTokenBackend::Protected {
                entry,
                legacy_entry,
            } => {
                let entry = entry.clone();
                let current = tokio::task::spawn_blocking(move || entry.delete_credential())
                    .await
                    .map_err(|_| NativeAuthError::SecureStorageUnavailable)?;
                let Some(legacy_entry) = legacy_entry.clone() else {
                    return match current {
                        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
                        Err(_) => Err(NativeAuthError::SecureStorageUnavailable),
                    };
                };
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
    }
}

fn decode_refresh_token(bytes: &[u8]) -> RefreshTokenRecord {
    match serde_json::from_slice(bytes) {
        Ok(token) => RefreshTokenRecord::Current(token),
        Err(_) => RefreshTokenRecord::Incompatible,
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

    #[tokio::test]
    async fn ephemeral_native_auth_uses_strict_envelope_without_legacy_fallback() {
        let (root, profile) = crate::feat126_secure_storage::ephemeral_test_profile();
        let binding = binding(
            "local-integration",
            "https://localhost:9443/realms/yijie",
            "yijie-desktop-local",
        );
        let mut synthetic_refresh_bytes = [0_u8; 32];
        getrandom::fill(&mut synthetic_refresh_bytes).unwrap();
        let synthetic_refresh = synthetic_refresh_bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let token = StoredRefreshToken::new(&binding, synthetic_refresh.clone(), 10, 20, 30);
        let store = ProtectedKeychainStore::new_with_test_profile(Some(profile.clone())).unwrap();
        assert!(matches!(
            store.load().await.unwrap(),
            RefreshTokenRecord::Missing
        ));
        store.save(&token).await.unwrap();

        let restarted =
            ProtectedKeychainStore::new_with_test_profile(Some(profile.clone())).unwrap();
        match restarted.load().await.unwrap() {
            RefreshTokenRecord::Current(loaded) => {
                assert!(loaded.is_bound_to(&binding));
                assert_eq!(loaded.refresh_token, synthetic_refresh);
            }
            _ => panic!("expected strict current refresh token"),
        }
        let mut rotated_refresh_bytes = [0_u8; 32];
        getrandom::fill(&mut rotated_refresh_bytes).unwrap();
        let rotated_refresh = rotated_refresh_bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let rotated = StoredRefreshToken::new(&binding, rotated_refresh.clone(), 40, 50, 60);
        restarted.save(&rotated).await.unwrap();
        match restarted.load().await.unwrap() {
            RefreshTokenRecord::Current(loaded) => {
                assert_eq!(loaded.refresh_token, rotated_refresh);
            }
            _ => panic!("expected rotated strict refresh token"),
        }
        restarted.delete().await.unwrap();
        assert!(matches!(
            restarted.load().await.unwrap(),
            RefreshTokenRecord::Missing
        ));
        crate::feat126_secure_storage::cleanup_ephemeral_test_profile(&profile).unwrap();
        assert!(!root.exists());
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "S7 local integration: mutates and then removes an isolated synthetic Keychain item"]
    fn protected_data_keychain_s7_round_trip() {
        use keyring_core::api::CredentialStoreApi;
        use std::collections::HashMap;

        const SMOKE_SERVICE: &str = "ai.yijie.desktop.auth.s7-smoke";
        const SMOKE_ACCOUNT: &str = "protected-store-round-trip";
        const SMOKE_SECRET: &[u8] = b"synthetic-keychain-probe";

        let store = apple_native_keyring_store::protected::Store::new()
            .expect("create Protected Data Keychain store");
        let modifiers = HashMap::from([("access-policy", "when-unlocked-this-device-only")]);
        let entry = store
            .build(SMOKE_SERVICE, SMOKE_ACCOUNT, Some(&modifiers))
            .expect("build isolated S7 Keychain entry");

        let set_result = entry.set_secret(SMOKE_SECRET);
        let loaded = set_result
            .as_ref()
            .ok()
            .and_then(|_| entry.get_secret().ok());
        let delete_result = entry.delete_credential();

        set_result.expect("write isolated S7 Keychain entry");
        assert_eq!(loaded.as_deref(), Some(SMOKE_SECRET));
        delete_result.expect("remove isolated S7 Keychain entry");
    }

    fn binding(environment: &str, issuer: &str, client_id: &str) -> RefreshTokenBinding {
        RefreshTokenBinding {
            environment: environment.to_owned(),
            issuer: issuer.to_owned(),
            client_id: client_id.to_owned(),
        }
    }
}
