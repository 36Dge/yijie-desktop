use super::{
    CommandError, NativeAuthConfig, NativeAuthError, OidcClient, ProtectedKeychainStore,
    RefreshFailure, RefreshTokenStore, SecretValue, StoredRefreshToken,
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
    store: Arc<dyn RefreshTokenStore>,
    transport: OperationTransport,
    access: Mutex<Option<AccessSession>>,
    storage_blocked: Mutex<bool>,
    login_lock: Mutex<()>,
    refresh_lock: Mutex<()>,
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
            Ok(Some(config)) => match (
                OidcClient::new(config.clone()),
                ProtectedKeychainStore::new(),
                OperationTransport::new(&config),
            ) {
                (Ok(oidc), Ok(store), Ok(transport)) => RuntimeMode::Ready(Arc::new(AuthService {
                    oidc,
                    store: Arc::new(store),
                    transport,
                    access: Mutex::new(None),
                    storage_blocked: Mutex::new(false),
                    login_lock: Mutex::new(()),
                    refresh_lock: Mutex::new(()),
                })),
                _ => RuntimeMode::Invalid,
            },
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
        if retry.status == 401 {
            self.clear_all().await?;
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
        if retry.status == 401 {
            self.clear_all().await?;
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
        let old_refresh = match self.store.load().await {
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
        let stored = StoredRefreshToken {
            refresh_token: tokens.refresh_token.expose().to_owned(),
            issued_at_epoch_seconds: now,
            last_used_at_epoch_seconds: now,
            absolute_expires_at_epoch_seconds,
        };
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
        let refresh = self.store.load().await?;
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
        let Some(stored) = self.store.load().await? else {
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

        let mut stored = self.store.load().await?.ok_or(NativeAuthError::SignedOut)?;
        let now = epoch_seconds()?;
        if validate_stored_refresh(&stored, now).is_err() {
            self.clear_all().await?;
            return Err(NativeAuthError::SessionExpired);
        }

        let current_refresh = SecretValue::new(stored.refresh_token.clone());
        let tokens = match self.oidc.refresh(&current_refresh).await {
            Ok(tokens) => tokens,
            Err(RefreshFailure::InvalidGrant) => {
                self.clear_all().await?;
                return Err(NativeAuthError::SignedOut);
            }
            Err(RefreshFailure::Failed) => return Err(NativeAuthError::TransportFailed),
        };

        stored.refresh_token = tokens.refresh_token.expose().to_owned();
        stored.last_used_at_epoch_seconds = now;
        if self.store.save(&stored).await.is_err() {
            let _ = self.clear_all().await;
            return Err(NativeAuthError::SecureStorageUnavailable);
        }
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

    fn stored(now: u64) -> StoredRefreshToken {
        StoredRefreshToken {
            refresh_token: "refresh".to_owned(),
            issued_at_epoch_seconds: now - 10,
            last_used_at_epoch_seconds: now - 5,
            absolute_expires_at_epoch_seconds: now + 10,
        }
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
    async fn browser_boundary_rejects_non_https_before_opening() {
        let result = open_system_browser(Url::parse("http://127.0.0.1/login").unwrap()).await;
        assert_eq!(result, Err(NativeAuthError::InvalidConfiguration));
    }
}
