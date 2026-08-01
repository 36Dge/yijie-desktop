use super::{
    CommandError, NativeAuthConfig, NativeAuthError, OidcClient, ProtectedKeychainStore,
    RefreshFailure, RefreshTokenBinding, RefreshTokenRecord, RefreshTokenStore, SecretValue,
    StoredRefreshToken,
};
use crate::native_auth::loopback::LoopbackCallback;
use crate::native_auth::transport::{OperationResponse, OperationTransport};
use serde::Serialize;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use url::Url;

const REFRESH_BEFORE_EXPIRY: Duration = Duration::from_secs(2 * 60);
const REFRESH_IDLE_LIFETIME: u64 = 30 * 24 * 60 * 60;
const REFRESH_ABSOLUTE_LIFETIME: u64 = 90 * 24 * 60 * 60;
const CLOCK_SKEW_SECONDS: u64 = 5 * 60;

pub struct NativeAuthRuntime {
    mode: RuntimeMode,
}

enum RuntimeMode {
    Disabled,
    Invalid,
    Ready(Arc<AuthService>),
}

struct AuthService {
    oidc: OidcClient,
    binding: RefreshTokenBinding,
    store: Arc<dyn RefreshTokenStore>,
    transport: OperationTransport,
    access: Mutex<Option<AccessSession>>,
    storage_blocked: Mutex<bool>,
    login_lock: Mutex<()>,
    refresh_lock: Mutex<()>,
}

#[async_trait::async_trait]
trait RefreshRevoker: Send + Sync {
    async fn revoke_refresh(&self, refresh_token: &SecretValue);
}

#[async_trait::async_trait]
impl RefreshRevoker for OidcClient {
    async fn revoke_refresh(&self, refresh_token: &SecretValue) {
        self.revoke(refresh_token).await;
    }
}

struct AccessSession {
    token: SecretValue,
    expires_at: Instant,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthStatus {
    Disabled,
    SignedOut,
    SignedIn,
}

impl NativeAuthRuntime {
    pub fn from_environment() -> Self {
        let mode = match NativeAuthConfig::from_environment() {
            Ok(None) => RuntimeMode::Disabled,
            Err(_) => RuntimeMode::Invalid,
            Ok(Some(config)) => {
                let binding = RefreshTokenBinding::from_config(&config);
                match (
                    OidcClient::new(config.clone()),
                    ProtectedKeychainStore::new(),
                    OperationTransport::new(&config),
                ) {
                    (Ok(oidc), Ok(store), Ok(transport)) => {
                        RuntimeMode::Ready(Arc::new(AuthService {
                            oidc,
                            binding,
                            store: Arc::new(store),
                            transport,
                            access: Mutex::new(None),
                            storage_blocked: Mutex::new(false),
                            login_lock: Mutex::new(()),
                            refresh_lock: Mutex::new(()),
                        }))
                    }
                    _ => RuntimeMode::Invalid,
                }
            }
        };
        Self { mode }
    }

    pub async fn login(&self) -> Result<AuthStatus, CommandError> {
        self.service()?.login().await.map_err(CommandError::from)
    }

    pub async fn logout(&self) -> Result<AuthStatus, CommandError> {
        self.service()?.logout().await.map_err(CommandError::from)
    }

    pub async fn status(&self) -> Result<AuthStatus, CommandError> {
        match &self.mode {
            RuntimeMode::Disabled => Ok(AuthStatus::Disabled),
            RuntimeMode::Invalid => Err(CommandError::from(NativeAuthError::InvalidConfiguration)),
            RuntimeMode::Ready(service) => service.status().await.map_err(CommandError::from),
        }
    }

    pub async fn list_my_tenants(&self) -> Result<OperationResponse, CommandError> {
        let service = self.service()?;
        service.list_my_tenants().await.map_err(CommandError::from)
    }

    pub async fn get_my_capabilities(
        &self,
        tenant_id: &str,
    ) -> Result<OperationResponse, CommandError> {
        let service = self.service()?;
        service
            .get_my_capabilities(tenant_id)
            .await
            .map_err(CommandError::from)
    }

    fn service(&self) -> Result<&Arc<AuthService>, CommandError> {
        self.service_native().map_err(CommandError::from)
    }

    fn service_native(&self) -> Result<&Arc<AuthService>, NativeAuthError> {
        match &self.mode {
            RuntimeMode::Disabled => Err(NativeAuthError::Disabled),
            RuntimeMode::Invalid => Err(NativeAuthError::InvalidConfiguration),
            RuntimeMode::Ready(service) => Ok(service),
        }
    }
}

impl AuthService {
    async fn list_my_tenants(&self) -> Result<OperationResponse, NativeAuthError> {
        let first_token = self.access_token(None).await?;
        let first = self.transport.list_my_tenants(&first_token).await?;
        if first.status != 401 {
            return Ok(first);
        }

        let retry_token = self.access_token(Some(&first_token)).await?;
        let retry = self.transport.list_my_tenants(&retry_token).await?;
        if retry.status == 401 && self.clear_rejected_session(&retry_token).await? {
            return Err(NativeAuthError::SignedOut);
        }
        Ok(retry)
    }

    async fn get_my_capabilities(
        &self,
        tenant_id: &str,
    ) -> Result<OperationResponse, NativeAuthError> {
        let first_token = self.access_token(None).await?;
        let first = self
            .transport
            .get_my_capabilities(tenant_id, &first_token)
            .await?;
        if first.status != 401 {
            return Ok(first);
        }

        let retry_token = self.access_token(Some(&first_token)).await?;
        let retry = self
            .transport
            .get_my_capabilities(tenant_id, &retry_token)
            .await?;
        if retry.status == 401 && self.clear_rejected_session(&retry_token).await? {
            return Err(NativeAuthError::SignedOut);
        }
        Ok(retry)
    }

    async fn login(&self) -> Result<AuthStatus, NativeAuthError> {
        let _login_guard = self
            .login_lock
            .try_lock()
            .map_err(|_| NativeAuthError::LoginInProgress)?;
        let callback = LoopbackCallback::bind().await?;
        let attempt = self.oidc.begin_login(callback.redirect_uri()).await?;
        open_system_browser(attempt.authorization_url.clone()).await?;
        let callback_code = callback
            .wait_for_code(
                attempt.expected_state.expose(),
                attempt.expected_issuer.as_str(),
            )
            .await?;
        let tokens = self.oidc.exchange_code(attempt, callback_code.code).await?;
        let issued_refresh = tokens.refresh_token.clone();
        let _refresh_guard = self.refresh_lock.lock().await;
        let now = match epoch_seconds() {
            Ok(now) => now,
            Err(error) => {
                self.oidc.revoke(&issued_refresh).await;
                return Err(error);
            }
        };
        let old_refresh = match self.load_bound_refresh().await {
            Ok(refresh) => refresh,
            Err(error) => {
                self.oidc.revoke(&issued_refresh).await;
                return Err(error);
            }
        };
        let absolute_expires_at_epoch_seconds = match now.checked_add(REFRESH_ABSOLUTE_LIFETIME) {
            Some(expires_at) => expires_at,
            None => {
                self.oidc.revoke(&issued_refresh).await;
                return Err(NativeAuthError::AuthenticationFailed);
            }
        };
        let stored = StoredRefreshToken::new(
            &self.binding,
            tokens.refresh_token.expose().to_owned(),
            now,
            now,
            absolute_expires_at_epoch_seconds,
        );
        if self.store.save(&stored).await.is_err() {
            self.oidc.revoke(&issued_refresh).await;
            let _ = self.clear_all().await;
            return Err(NativeAuthError::SecureStorageUnavailable);
        }

        let access_session = AccessSession {
            token: tokens.access_token,
            expires_at: Instant::now() + tokens.expires_in,
        };
        *self.access.lock().await = Some(access_session);
        *self.storage_blocked.lock().await = false;

        if let Some(previous) = old_refresh {
            let old = SecretValue::new(previous.refresh_token.clone());
            if !constant_time_equal(old.expose(), stored.refresh_token.as_str()) {
                self.oidc.revoke(&old).await;
            }
        }
        Ok(AuthStatus::SignedIn)
    }

    async fn logout(&self) -> Result<AuthStatus, NativeAuthError> {
        let _login_guard = self.login_lock.lock().await;
        let _refresh_guard = self.refresh_lock.lock().await;
        *self.storage_blocked.lock().await = true;
        *self.access.lock().await = None;
        let refresh = self.load_bound_refresh().await?;
        if let Some(refresh) = refresh {
            self.oidc
                .revoke(&SecretValue::new(refresh.refresh_token.clone()))
                .await;
        }
        self.store.delete().await?;
        Ok(AuthStatus::SignedOut)
    }

    async fn status(&self) -> Result<AuthStatus, NativeAuthError> {
        if *self.storage_blocked.lock().await {
            return Ok(AuthStatus::SignedOut);
        }
        if self.access.lock().await.is_some() {
            return Ok(AuthStatus::SignedIn);
        }
        let _refresh_guard = self.refresh_lock.lock().await;
        if *self.storage_blocked.lock().await {
            return Ok(AuthStatus::SignedOut);
        }
        if self.access.lock().await.is_some() {
            return Ok(AuthStatus::SignedIn);
        }
        let Some(stored) = self.load_bound_refresh().await? else {
            return Ok(AuthStatus::SignedOut);
        };
        let now = epoch_seconds()?;
        if validate_stored_refresh(&stored, now).is_err() {
            let _ = self.clear_all().await;
            return Ok(AuthStatus::SignedOut);
        }
        Ok(AuthStatus::SignedIn)
    }

    async fn access_token(
        &self,
        rejected_token: Option<&SecretValue>,
    ) -> Result<SecretValue, NativeAuthError> {
        if *self.storage_blocked.lock().await {
            return Err(NativeAuthError::SignedOut);
        }
        if rejected_token.is_none() {
            if let Some(token) = self.usable_access_token().await {
                return Ok(token);
            }
        }

        let _refresh_guard = self.refresh_lock.lock().await;
        if *self.storage_blocked.lock().await {
            return Err(NativeAuthError::SignedOut);
        }
        if let Some(token) = self.usable_access_token().await {
            match rejected_token {
                None => return Ok(token),
                Some(rejected) if !constant_time_equal(token.expose(), rejected.expose()) => {
                    return Ok(token);
                }
                Some(_) => {}
            }
        }

        let mut stored = self
            .load_bound_refresh()
            .await?
            .ok_or(NativeAuthError::SignedOut)?;
        let now = epoch_seconds()?;
        if validate_stored_refresh(&stored, now).is_err() {
            self.clear_all().await?;
            return Err(NativeAuthError::SessionExpired);
        }

        let current_refresh = SecretValue::new(stored.refresh_token.clone());
        let tokens = match self.oidc.refresh(&current_refresh).await {
            Ok(tokens) => tokens,
            Err(RefreshFailure::InvalidGrant) => {
                self.revoke_and_clear_refresh(&self.oidc, &current_refresh)
                    .await?;
                return Err(NativeAuthError::SignedOut);
            }
            Err(RefreshFailure::Failed) => return Err(NativeAuthError::TransportFailed),
        };

        let rotated_refresh = tokens.refresh_token.clone();
        stored.refresh_token = tokens.refresh_token.expose().to_owned();
        stored.last_used_at_epoch_seconds = now;
        self.save_rotated_refresh(&self.oidc, &stored, &rotated_refresh)
            .await?;
        let access = tokens.access_token.clone();
        *self.access.lock().await = Some(AccessSession {
            token: tokens.access_token,
            expires_at: Instant::now() + tokens.expires_in,
        });
        Ok(access)
    }

    async fn usable_access_token(&self) -> Option<SecretValue> {
        let guard = self.access.lock().await;
        guard.as_ref().and_then(|session| {
            if session.expires_at.saturating_duration_since(Instant::now()) > REFRESH_BEFORE_EXPIRY
            {
                Some(session.token.clone())
            } else {
                None
            }
        })
    }

    async fn clear_all(&self) -> Result<(), NativeAuthError> {
        *self.storage_blocked.lock().await = true;
        *self.access.lock().await = None;
        self.store.delete().await
    }

    async fn revoke_and_clear_refresh<R: RefreshRevoker + ?Sized>(
        &self,
        revoker: &R,
        refresh_token: &SecretValue,
    ) -> Result<(), NativeAuthError> {
        revoker.revoke_refresh(refresh_token).await;
        self.clear_all().await
    }

    async fn save_rotated_refresh<R: RefreshRevoker + ?Sized>(
        &self,
        revoker: &R,
        stored: &StoredRefreshToken,
        rotated_refresh: &SecretValue,
    ) -> Result<(), NativeAuthError> {
        if self.store.save(stored).await.is_err() {
            let _ = self
                .revoke_and_clear_refresh(revoker, rotated_refresh)
                .await;
            return Err(NativeAuthError::SecureStorageUnavailable);
        }
        Ok(())
    }

    async fn clear_rejected_session(
        &self,
        rejected_token: &SecretValue,
    ) -> Result<bool, NativeAuthError> {
        let _refresh_guard = self.refresh_lock.lock().await;
        if let Some(current) = self.access.lock().await.as_ref() {
            if !constant_time_equal(current.token.expose(), rejected_token.expose()) {
                return Ok(false);
            }
        }
        self.clear_all().await?;
        Ok(true)
    }

    async fn load_bound_refresh(&self) -> Result<Option<StoredRefreshToken>, NativeAuthError> {
        match self.store.load().await? {
            RefreshTokenRecord::Missing => Ok(None),
            RefreshTokenRecord::Current(stored) if stored.is_bound_to(&self.binding) => {
                Ok(Some(stored))
            }
            RefreshTokenRecord::Current(_) | RefreshTokenRecord::Incompatible => {
                *self.storage_blocked.lock().await = true;
                *self.access.lock().await = None;
                self.store.delete().await?;
                Ok(None)
            }
        }
    }
}

async fn open_system_browser(url: Url) -> Result<(), NativeAuthError> {
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    tokio::task::spawn_blocking(move || webbrowser::open(url.as_str()))
        .await
        .map_err(|_| NativeAuthError::AuthenticationFailed)?
        .map_err(|_| NativeAuthError::AuthenticationFailed)
}

fn epoch_seconds() -> Result<u64, NativeAuthError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| NativeAuthError::AuthenticationFailed)
}

fn validate_stored_refresh(stored: &StoredRefreshToken, now: u64) -> Result<(), NativeAuthError> {
    if stored.refresh_token.is_empty()
        || stored.refresh_token.len() > 16 * 1024
        || stored.issued_at_epoch_seconds > stored.last_used_at_epoch_seconds
        || stored.last_used_at_epoch_seconds > now.saturating_add(CLOCK_SKEW_SECONDS)
        || stored.absolute_expires_at_epoch_seconds <= now
        || stored
            .absolute_expires_at_epoch_seconds
            .saturating_sub(stored.issued_at_epoch_seconds)
            > REFRESH_ABSOLUTE_LIFETIME
        || now.saturating_sub(stored.last_used_at_epoch_seconds) > REFRESH_IDLE_LIFETIME
    {
        return Err(NativeAuthError::SessionExpired);
    }
    Ok(())
}

fn constant_time_equal(left: &str, right: &str) -> bool {
    use sha2::{Digest, Sha256};
    use subtle::ConstantTimeEq;

    Sha256::digest(left.as_bytes())
        .ct_eq(&Sha256::digest(right.as_bytes()))
        .unwrap_u8()
        == 1
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Mutex as StdMutex;

    struct TestStore {
        record: StdMutex<Option<RefreshTokenRecord>>,
        deletes: AtomicUsize,
        save_fails: AtomicBool,
    }

    #[async_trait]
    impl RefreshTokenStore for TestStore {
        async fn save(&self, _token: &StoredRefreshToken) -> Result<(), NativeAuthError> {
            if self.save_fails.load(Ordering::Relaxed) {
                Err(NativeAuthError::SecureStorageUnavailable)
            } else {
                Ok(())
            }
        }

        async fn load(&self) -> Result<RefreshTokenRecord, NativeAuthError> {
            Ok(self
                .record
                .lock()
                .expect("test record lock")
                .take()
                .unwrap_or(RefreshTokenRecord::Missing))
        }

        async fn delete(&self) -> Result<(), NativeAuthError> {
            self.deletes.fetch_add(1, Ordering::Relaxed);
            Ok(())
        }
    }

    struct TestRevoker {
        revoked: StdMutex<Vec<String>>,
    }

    #[async_trait]
    impl RefreshRevoker for TestRevoker {
        async fn revoke_refresh(&self, refresh_token: &SecretValue) {
            self.revoked
                .lock()
                .expect("test revocation lock")
                .push(refresh_token.expose().to_owned());
        }
    }

    fn config(client_id: &str) -> NativeAuthConfig {
        let values = HashMap::from([
            ("YIJIE_DESKTOP_NATIVE_AUTH_ENABLED", "true"),
            ("YIJIE_DESKTOP_OIDC_ISSUER", "https://identity.example/"),
            (
                "YIJIE_DESKTOP_OIDC_AUTHORIZATION_ENDPOINT",
                "https://identity.example/oauth/authorize",
            ),
            (
                "YIJIE_DESKTOP_OIDC_TOKEN_ENDPOINT",
                "https://identity.example/oauth/token",
            ),
            (
                "YIJIE_DESKTOP_OIDC_JWKS_URI",
                "https://identity.example/.well-known/jwks.json",
            ),
            (
                "YIJIE_DESKTOP_OIDC_REVOCATION_ENDPOINT",
                "https://identity.example/oauth/revoke",
            ),
            ("YIJIE_DESKTOP_OIDC_CLIENT_ID", client_id),
            ("YIJIE_DESKTOP_API_ORIGIN", "https://api.example/"),
        ]);
        NativeAuthConfig::from_test_lookup(|name| values.get(name).map(|value| (*value).to_owned()))
            .expect("valid config")
            .expect("enabled config")
    }

    fn service(record: RefreshTokenRecord) -> (AuthService, Arc<TestStore>) {
        let config = config("client-a");
        let store = Arc::new(TestStore {
            record: StdMutex::new(Some(record)),
            deletes: AtomicUsize::new(0),
            save_fails: AtomicBool::new(false),
        });
        let service = AuthService {
            oidc: OidcClient::new(config.clone()).expect("OIDC client"),
            binding: RefreshTokenBinding::from_config(&config),
            store: store.clone(),
            transport: OperationTransport::new(&config).expect("operation transport"),
            access: Mutex::new(None),
            storage_blocked: Mutex::new(false),
            login_lock: Mutex::new(()),
            refresh_lock: Mutex::new(()),
        };
        (service, store)
    }

    fn stored(now: u64) -> StoredRefreshToken {
        StoredRefreshToken::new(
            &RefreshTokenBinding::from_config(&config("client-a")),
            "refresh".to_owned(),
            now - 10,
            now - 5,
            now + 10,
        )
    }

    #[test]
    fn refresh_lifecycle_accepts_only_unexpired_consistent_envelopes() {
        let now = 10_000_000;
        assert!(validate_stored_refresh(&stored(now), now).is_ok());

        let mut idle = stored(now);
        idle.last_used_at_epoch_seconds = now - REFRESH_IDLE_LIFETIME - 1;
        idle.issued_at_epoch_seconds = idle.last_used_at_epoch_seconds;
        assert_eq!(
            validate_stored_refresh(&idle, now),
            Err(NativeAuthError::SessionExpired)
        );

        let mut absolute = stored(now);
        absolute.absolute_expires_at_epoch_seconds = now;
        assert_eq!(
            validate_stored_refresh(&absolute, now),
            Err(NativeAuthError::SessionExpired)
        );

        let mut extended = stored(now);
        extended.absolute_expires_at_epoch_seconds =
            extended.issued_at_epoch_seconds + REFRESH_ABSOLUTE_LIFETIME + 1;
        assert_eq!(
            validate_stored_refresh(&extended, now),
            Err(NativeAuthError::SessionExpired)
        );
    }

    #[test]
    fn refresh_comparison_does_not_depend_on_length_or_early_exit() {
        assert!(constant_time_equal("refresh", "refresh"));
        assert!(!constant_time_equal("refresh-a", "refresh-b"));
        assert!(!constant_time_equal("short", "a much longer secret"));
    }

    #[tokio::test]
    async fn incompatible_or_mismatched_records_are_deleted_without_becoming_refreshable() {
        let (incompatible_service, incompatible_store) = service(RefreshTokenRecord::Incompatible);
        assert!(incompatible_service
            .load_bound_refresh()
            .await
            .expect("purge incompatible")
            .is_none());
        assert_eq!(incompatible_store.deletes.load(Ordering::Relaxed), 1);
        assert!(*incompatible_service.storage_blocked.lock().await);

        let mismatched = StoredRefreshToken::new(
            &RefreshTokenBinding::from_config(&config("client-b")),
            "must-not-be-sent".to_owned(),
            1,
            2,
            3,
        );
        let (mismatched_service, mismatched_store) =
            service(RefreshTokenRecord::Current(mismatched));
        assert!(mismatched_service
            .load_bound_refresh()
            .await
            .expect("purge mismatched")
            .is_none());
        assert_eq!(mismatched_store.deletes.load(Ordering::Relaxed), 1);
        assert!(*mismatched_service.storage_blocked.lock().await);
    }

    #[tokio::test]
    async fn exactly_bound_record_remains_available_without_deletion() {
        let record = stored(10_000_000);
        let (service, store) = service(RefreshTokenRecord::Current(record));
        assert!(service
            .load_bound_refresh()
            .await
            .expect("load matching")
            .is_some());
        assert_eq!(store.deletes.load(Ordering::Relaxed), 0);
        assert!(!*service.storage_blocked.lock().await);
    }

    #[tokio::test]
    async fn rejected_access_token_cannot_delete_a_concurrently_refreshed_session() {
        let (service, store) = service(RefreshTokenRecord::Missing);
        let service = Arc::new(service);
        *service.access.lock().await = Some(AccessSession {
            token: SecretValue::new("rejected-access".to_owned()),
            expires_at: Instant::now() + Duration::from_secs(600),
        });

        let refresh_guard = service.refresh_lock.lock().await;
        let invalidating_service = service.clone();
        let invalidation = tokio::spawn(async move {
            invalidating_service
                .clear_rejected_session(&SecretValue::new("rejected-access".to_owned()))
                .await
        });
        tokio::task::yield_now().await;
        *service.access.lock().await = Some(AccessSession {
            token: SecretValue::new("new-access".to_owned()),
            expires_at: Instant::now() + Duration::from_secs(600),
        });
        drop(refresh_guard);

        assert!(!invalidation
            .await
            .expect("invalidation task")
            .expect("compare-and-clear"));
        assert_eq!(store.deletes.load(Ordering::Relaxed), 0);
        assert!(!*service.storage_blocked.lock().await);
        assert!(constant_time_equal(
            service
                .access
                .lock()
                .await
                .as_ref()
                .expect("concurrently refreshed access")
                .token
                .expose(),
            "new-access",
        ));
    }

    #[tokio::test]
    async fn current_rejected_access_token_is_cleared_under_the_refresh_lock() {
        let (service, store) = service(RefreshTokenRecord::Missing);
        *service.access.lock().await = Some(AccessSession {
            token: SecretValue::new("rejected-access".to_owned()),
            expires_at: Instant::now() + Duration::from_secs(600),
        });

        assert!(service
            .clear_rejected_session(&SecretValue::new("rejected-access".to_owned()))
            .await
            .expect("clear rejected session"));
        assert_eq!(store.deletes.load(Ordering::Relaxed), 1);
        assert!(*service.storage_blocked.lock().await);
        assert!(service.access.lock().await.is_none());
    }

    #[tokio::test]
    async fn invalid_refresh_cleanup_revokes_current_token_and_clears_session() {
        let (service, store) = service(RefreshTokenRecord::Missing);
        *service.access.lock().await = Some(AccessSession {
            token: SecretValue::new("access".to_owned()),
            expires_at: Instant::now() + Duration::from_secs(600),
        });
        let revoker = TestRevoker {
            revoked: StdMutex::new(Vec::new()),
        };

        service
            .revoke_and_clear_refresh(&revoker, &SecretValue::new("current-refresh".to_owned()))
            .await
            .expect("revoke invalid refresh and clear session");

        assert_eq!(
            *revoker.revoked.lock().expect("test revocation lock"),
            vec!["current-refresh".to_owned()]
        );
        assert_eq!(store.deletes.load(Ordering::Relaxed), 1);
        assert!(*service.storage_blocked.lock().await);
        assert!(service.access.lock().await.is_none());
    }

    #[tokio::test]
    async fn rotated_refresh_save_failure_revokes_new_token_and_clears_session() {
        let (service, store) = service(RefreshTokenRecord::Missing);
        store.save_fails.store(true, Ordering::Relaxed);
        *service.access.lock().await = Some(AccessSession {
            token: SecretValue::new("access".to_owned()),
            expires_at: Instant::now() + Duration::from_secs(600),
        });
        let revoker = TestRevoker {
            revoked: StdMutex::new(Vec::new()),
        };

        let result = service
            .save_rotated_refresh(
                &revoker,
                &stored(10_000_000),
                &SecretValue::new("rotated-refresh".to_owned()),
            )
            .await;

        assert_eq!(result, Err(NativeAuthError::SecureStorageUnavailable));
        assert_eq!(
            *revoker.revoked.lock().expect("test revocation lock"),
            vec!["rotated-refresh".to_owned()]
        );
        assert_eq!(store.deletes.load(Ordering::Relaxed), 1);
        assert!(*service.storage_blocked.lock().await);
        assert!(service.access.lock().await.is_none());
    }

    #[tokio::test]
    async fn browser_boundary_rejects_non_https_before_opening() {
        let result = open_system_browser(Url::parse("http://127.0.0.1/login").unwrap()).await;
        assert_eq!(result, Err(NativeAuthError::InvalidConfiguration));
    }
}
