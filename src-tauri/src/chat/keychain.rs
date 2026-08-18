use super::error::ChatError;
use crate::feat126_secure_storage::{
    EphemeralSecretFile, EphemeralSecretRole, Feat126SecureStorageProfile,
};
use std::sync::Arc;
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const DATABASE_KEYCHAIN_SERVICE: &str = "com.yijie.ai.chat-db";
pub const DATABASE_KEYCHAIN_ACCOUNT: &str = "default-v1";
pub const RECEIPT_KEYCHAIN_SERVICE: &str = "com.yijie.ai.chat-receipt";
pub const RECEIPT_KEYCHAIN_ACCOUNT: &str = "default-v1";

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct DatabaseKey([u8; 32]);

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct ReceiptKey([u8; 32]);

impl DatabaseKey {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn expose(&self) -> &[u8; 32] {
        &self.0
    }
}

impl std::fmt::Debug for DatabaseKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("DatabaseKey([REDACTED])")
    }
}

impl ReceiptKey {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub(crate) fn expose(&self) -> &[u8; 32] {
        &self.0
    }
}

impl std::fmt::Debug for ReceiptKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ReceiptKey([REDACTED])")
    }
}

pub trait DatabaseKeyStore: Send + Sync {
    fn load_or_create(&self, database_exists: bool) -> Result<DatabaseKey, ChatError>;
}

pub trait ReceiptKeyStore: Send + Sync {
    fn load_or_create(&self, database_exists: bool) -> Result<ReceiptKey, ChatError>;
}

pub enum ProtectedDatabaseKeyStore {
    Ephemeral(EphemeralSecretFile),
    #[cfg(target_os = "macos")]
    Protected(std::sync::Arc<keyring_core::Entry>),
}

pub enum ProtectedReceiptKeyStore {
    Ephemeral(EphemeralSecretFile),
    #[cfg(target_os = "macos")]
    Protected(std::sync::Arc<keyring_core::Entry>),
}

impl ProtectedDatabaseKeyStore {
    pub fn new(profile: Option<Arc<Feat126SecureStorageProfile>>) -> Result<Self, ChatError> {
        if let Some(secret) = profile
            .as_ref()
            .and_then(|profile| profile.ephemeral_secret_file(EphemeralSecretRole::ChatSqlcipher))
        {
            return Ok(Self::Ephemeral(secret));
        }
        #[cfg(target_os = "macos")]
        {
            use keyring_core::api::CredentialStoreApi;
            use std::collections::HashMap;

            let store = apple_native_keyring_store::protected::Store::new()
                .map_err(|_| ChatError::SecureStorageUnavailable)?;
            let modifiers = HashMap::from([("access-policy", "when-unlocked-this-device-only")]);
            let (service, account) = profile
                .as_deref()
                .map(|profile| {
                    let namespace = profile.database_namespace();
                    (namespace.service(), namespace.account())
                })
                .unwrap_or((DATABASE_KEYCHAIN_SERVICE, DATABASE_KEYCHAIN_ACCOUNT));
            let entry = store
                .build(service, account, Some(&modifiers))
                .map_err(|_| ChatError::SecureStorageUnavailable)?;
            Ok(Self::Protected(std::sync::Arc::new(entry)))
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = profile;
            Err(ChatError::SecureStorageUnavailable)
        }
    }
}

impl ProtectedReceiptKeyStore {
    pub fn new(profile: Option<Arc<Feat126SecureStorageProfile>>) -> Result<Self, ChatError> {
        if let Some(secret) = profile
            .as_ref()
            .and_then(|profile| profile.ephemeral_secret_file(EphemeralSecretRole::ReceiptHmac))
        {
            return Ok(Self::Ephemeral(secret));
        }
        #[cfg(target_os = "macos")]
        {
            use keyring_core::api::CredentialStoreApi;
            use std::collections::HashMap;

            let store = apple_native_keyring_store::protected::Store::new()
                .map_err(|_| ChatError::SecureStorageUnavailable)?;
            let modifiers = HashMap::from([("access-policy", "when-unlocked-this-device-only")]);
            let (service, account) = profile
                .as_deref()
                .map(|profile| {
                    let namespace = profile.receipt_namespace();
                    (namespace.service(), namespace.account())
                })
                .unwrap_or((RECEIPT_KEYCHAIN_SERVICE, RECEIPT_KEYCHAIN_ACCOUNT));
            let entry = store
                .build(service, account, Some(&modifiers))
                .map_err(|_| ChatError::SecureStorageUnavailable)?;
            Ok(Self::Protected(std::sync::Arc::new(entry)))
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = profile;
            Err(ChatError::SecureStorageUnavailable)
        }
    }
}

impl DatabaseKeyStore for ProtectedDatabaseKeyStore {
    fn load_or_create(&self, database_exists: bool) -> Result<DatabaseKey, ChatError> {
        match self {
            Self::Ephemeral(file) => match file.load().map_err(map_ephemeral_error)? {
                Some(secret) => decode_key(secret.as_slice()),
                None if database_exists => Err(ChatError::DatabaseKeyMissing),
                None => {
                    let mut bytes = [0_u8; 32];
                    getrandom::fill(&mut bytes).map_err(|_| ChatError::SecureStorageUnavailable)?;
                    if file.create(&bytes).is_err() {
                        bytes.zeroize();
                        return Err(ChatError::SecureStorageUnavailable);
                    }
                    Ok(DatabaseKey::from_bytes(bytes))
                }
            },
            #[cfg(target_os = "macos")]
            Self::Protected(entry) => match entry.get_secret() {
                Ok(secret) => decode_key(&secret),
                Err(keyring_core::Error::NoEntry) if database_exists => {
                    Err(ChatError::DatabaseKeyMissing)
                }
                Err(keyring_core::Error::NoEntry) => {
                    let mut bytes = [0_u8; 32];
                    getrandom::fill(&mut bytes).map_err(|_| ChatError::SecureStorageUnavailable)?;
                    if entry.set_secret(&bytes).is_err() {
                        bytes.zeroize();
                        return Err(ChatError::SecureStorageUnavailable);
                    }
                    Ok(DatabaseKey::from_bytes(bytes))
                }
                Err(_) => Err(ChatError::SecureStorageUnavailable),
            },
        }
    }
}

impl ReceiptKeyStore for ProtectedReceiptKeyStore {
    fn load_or_create(&self, database_exists: bool) -> Result<ReceiptKey, ChatError> {
        match self {
            Self::Ephemeral(file) => match file.load().map_err(map_ephemeral_error)? {
                Some(secret) => decode_receipt_key(secret.as_slice()),
                None if database_exists => Err(ChatError::DatabaseKeyMissing),
                None => {
                    let mut bytes = [0_u8; 32];
                    getrandom::fill(&mut bytes).map_err(|_| ChatError::SecureStorageUnavailable)?;
                    if file.create(&bytes).is_err() {
                        bytes.zeroize();
                        return Err(ChatError::SecureStorageUnavailable);
                    }
                    Ok(ReceiptKey::from_bytes(bytes))
                }
            },
            #[cfg(target_os = "macos")]
            Self::Protected(entry) => match entry.get_secret() {
                Ok(secret) => decode_receipt_key(&secret),
                Err(keyring_core::Error::NoEntry) if database_exists => {
                    Err(ChatError::DatabaseKeyMissing)
                }
                Err(keyring_core::Error::NoEntry) => {
                    let mut bytes = [0_u8; 32];
                    getrandom::fill(&mut bytes).map_err(|_| ChatError::SecureStorageUnavailable)?;
                    if entry.set_secret(&bytes).is_err() {
                        bytes.zeroize();
                        return Err(ChatError::SecureStorageUnavailable);
                    }
                    Ok(ReceiptKey::from_bytes(bytes))
                }
                Err(_) => Err(ChatError::SecureStorageUnavailable),
            },
        }
    }
}

fn map_ephemeral_error(_error: crate::feat126_secure_storage::SecureStorageError) -> ChatError {
    ChatError::SecureStorageUnavailable
}

fn decode_key(bytes: &[u8]) -> Result<DatabaseKey, ChatError> {
    let key: [u8; 32] = bytes
        .try_into()
        .map_err(|_| ChatError::SecureStorageUnavailable)?;
    Ok(DatabaseKey::from_bytes(key))
}

fn decode_receipt_key(bytes: &[u8]) -> Result<ReceiptKey, ChatError> {
    let key: [u8; 32] = bytes
        .try_into()
        .map_err(|_| ChatError::SecureStorageUnavailable)?;
    Ok(ReceiptKey::from_bytes(key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_debug_is_redacted_and_namespaces_are_separate() {
        let key = DatabaseKey::from_bytes([7; 32]);
        let receipt = ReceiptKey::from_bytes([8; 32]);
        assert_eq!(format!("{key:?}"), "DatabaseKey([REDACTED])");
        assert_eq!(format!("{receipt:?}"), "ReceiptKey([REDACTED])");
        assert_ne!(DATABASE_KEYCHAIN_SERVICE, RECEIPT_KEYCHAIN_SERVICE);
        assert_eq!(DATABASE_KEYCHAIN_ACCOUNT, "default-v1");
        assert_eq!(RECEIPT_KEYCHAIN_ACCOUNT, "default-v1");
    }

    #[test]
    fn malformed_key_is_rejected_without_echoing_it() {
        let error = decode_key(b"secret-canary").expect_err("short key must fail");
        assert_eq!(error, ChatError::SecureStorageUnavailable);
        assert!(!error.to_string().contains("secret-canary"));
        assert!(matches!(
            decode_receipt_key(b"receipt-canary"),
            Err(ChatError::SecureStorageUnavailable)
        ));
    }

    #[test]
    fn ephemeral_chat_keys_are_random_separate_and_restart_stable() {
        let (root, profile) = crate::feat126_secure_storage::ephemeral_test_profile();
        let database = ProtectedDatabaseKeyStore::new(Some(profile.clone())).unwrap();
        let receipt = ProtectedReceiptKeyStore::new(Some(profile.clone())).unwrap();
        let first_database = database.load_or_create(false).unwrap();
        let first_receipt = receipt.load_or_create(false).unwrap();
        assert_ne!(first_database.expose(), first_receipt.expose());

        let restarted_database = ProtectedDatabaseKeyStore::new(Some(profile.clone())).unwrap();
        let restarted_receipt = ProtectedReceiptKeyStore::new(Some(profile.clone())).unwrap();
        assert_eq!(
            restarted_database.load_or_create(true).unwrap().expose(),
            first_database.expose()
        );
        assert_eq!(
            restarted_receipt.load_or_create(true).unwrap().expose(),
            first_receipt.expose()
        );
        crate::feat126_secure_storage::cleanup_ephemeral_test_profile(&profile).unwrap();
        assert!(!root.exists());
    }

    #[tokio::test]
    async fn ephemeral_keys_reopen_the_same_sqlcipher_database() {
        let (root, profile) = crate::feat126_secure_storage::ephemeral_test_profile();
        let chat_directory = profile.desktop_app_data().join("chat");
        let owner = uuid::Uuid::now_v7().to_string();
        let tenant = uuid::Uuid::now_v7().to_string();
        let first = crate::chat::worker::DatabaseWorker::start(
            chat_directory.clone(),
            crate::chat::database::ChatScope::new(owner.clone(), tenant.clone()).unwrap(),
            Box::new(ProtectedDatabaseKeyStore::new(Some(profile.clone())).unwrap()),
            Box::new(ProtectedReceiptKeyStore::new(Some(profile.clone())).unwrap()),
        )
        .unwrap();
        let first_version = first.schema_version().await.unwrap();
        let first_thread = first.thread_lifetime_probe();
        assert!(first_thread.upgrade().is_some());
        drop(first);
        assert!(first_thread.upgrade().is_none());

        let restarted = crate::chat::worker::DatabaseWorker::start(
            chat_directory.clone(),
            crate::chat::database::ChatScope::new(owner, tenant).unwrap(),
            Box::new(ProtectedDatabaseKeyStore::new(Some(profile.clone())).unwrap()),
            Box::new(ProtectedReceiptKeyStore::new(Some(profile.clone())).unwrap()),
        )
        .unwrap();
        assert_eq!(restarted.schema_version().await.unwrap(), first_version);
        let restarted_thread = restarted.thread_lifetime_probe();
        assert!(restarted_thread.upgrade().is_some());
        drop(restarted);
        assert!(restarted_thread.upgrade().is_none());
        std::fs::remove_dir_all(chat_directory).unwrap();
        crate::feat126_secure_storage::cleanup_ephemeral_test_profile(&profile).unwrap();
        assert!(!root.exists());
    }
}
