use super::error::ChatError;
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

#[cfg(target_os = "macos")]
pub struct ProtectedDatabaseKeyStore {
    entry: std::sync::Arc<keyring_core::Entry>,
}

#[cfg(target_os = "macos")]
pub struct ProtectedReceiptKeyStore {
    entry: std::sync::Arc<keyring_core::Entry>,
}

#[cfg(target_os = "macos")]
impl ProtectedDatabaseKeyStore {
    pub fn new() -> Result<Self, ChatError> {
        use keyring_core::api::CredentialStoreApi;
        use std::collections::HashMap;

        let store = apple_native_keyring_store::protected::Store::new()
            .map_err(|_| ChatError::SecureStorageUnavailable)?;
        let modifiers = HashMap::from([("access-policy", "when-unlocked-this-device-only")]);
        let entry = store
            .build(
                DATABASE_KEYCHAIN_SERVICE,
                DATABASE_KEYCHAIN_ACCOUNT,
                Some(&modifiers),
            )
            .map_err(|_| ChatError::SecureStorageUnavailable)?;
        Ok(Self {
            entry: std::sync::Arc::new(entry),
        })
    }
}

#[cfg(target_os = "macos")]
impl ProtectedReceiptKeyStore {
    pub fn new() -> Result<Self, ChatError> {
        use keyring_core::api::CredentialStoreApi;
        use std::collections::HashMap;

        let store = apple_native_keyring_store::protected::Store::new()
            .map_err(|_| ChatError::SecureStorageUnavailable)?;
        let modifiers = HashMap::from([("access-policy", "when-unlocked-this-device-only")]);
        let entry = store
            .build(
                RECEIPT_KEYCHAIN_SERVICE,
                RECEIPT_KEYCHAIN_ACCOUNT,
                Some(&modifiers),
            )
            .map_err(|_| ChatError::SecureStorageUnavailable)?;
        Ok(Self {
            entry: std::sync::Arc::new(entry),
        })
    }
}

#[cfg(target_os = "macos")]
impl DatabaseKeyStore for ProtectedDatabaseKeyStore {
    fn load_or_create(&self, database_exists: bool) -> Result<DatabaseKey, ChatError> {
        match self.entry.get_secret() {
            Ok(secret) => decode_key(&secret),
            Err(keyring_core::Error::NoEntry) if database_exists => {
                Err(ChatError::DatabaseKeyMissing)
            }
            Err(keyring_core::Error::NoEntry) => {
                let mut bytes = [0_u8; 32];
                getrandom::fill(&mut bytes).map_err(|_| ChatError::SecureStorageUnavailable)?;
                if self.entry.set_secret(&bytes).is_err() {
                    bytes.zeroize();
                    return Err(ChatError::SecureStorageUnavailable);
                }
                Ok(DatabaseKey::from_bytes(bytes))
            }
            Err(_) => Err(ChatError::SecureStorageUnavailable),
        }
    }
}

#[cfg(target_os = "macos")]
impl ReceiptKeyStore for ProtectedReceiptKeyStore {
    fn load_or_create(&self, database_exists: bool) -> Result<ReceiptKey, ChatError> {
        match self.entry.get_secret() {
            Ok(secret) => decode_receipt_key(&secret),
            Err(keyring_core::Error::NoEntry) if database_exists => {
                Err(ChatError::DatabaseKeyMissing)
            }
            Err(keyring_core::Error::NoEntry) => {
                let mut bytes = [0_u8; 32];
                getrandom::fill(&mut bytes).map_err(|_| ChatError::SecureStorageUnavailable)?;
                if self.entry.set_secret(&bytes).is_err() {
                    bytes.zeroize();
                    return Err(ChatError::SecureStorageUnavailable);
                }
                Ok(ReceiptKey::from_bytes(bytes))
            }
            Err(_) => Err(ChatError::SecureStorageUnavailable),
        }
    }
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

#[cfg(not(target_os = "macos"))]
pub struct ProtectedDatabaseKeyStore;

#[cfg(not(target_os = "macos"))]
pub struct ProtectedReceiptKeyStore;

#[cfg(not(target_os = "macos"))]
impl ProtectedDatabaseKeyStore {
    pub fn new() -> Result<Self, ChatError> {
        Err(ChatError::SecureStorageUnavailable)
    }
}

#[cfg(not(target_os = "macos"))]
impl DatabaseKeyStore for ProtectedDatabaseKeyStore {
    fn load_or_create(&self, _database_exists: bool) -> Result<DatabaseKey, ChatError> {
        Err(ChatError::SecureStorageUnavailable)
    }
}

#[cfg(not(target_os = "macos"))]
impl ProtectedReceiptKeyStore {
    pub fn new() -> Result<Self, ChatError> {
        Err(ChatError::SecureStorageUnavailable)
    }
}

#[cfg(not(target_os = "macos"))]
impl ReceiptKeyStore for ProtectedReceiptKeyStore {
    fn load_or_create(&self, _database_exists: bool) -> Result<ReceiptKey, ChatError> {
        Err(ChatError::SecureStorageUnavailable)
    }
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
}
