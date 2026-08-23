use super::config::AuthEnvironment;
use super::{
    local_whitelist_authorization_code_tokens, CommandError, LocalWhitelistConfig,
    NativeAuthConfig, NativeAuthError, OidcClient, ProtectedKeychainStore, RefreshFailure,
    RefreshTokenBinding, RefreshTokenRecord, RefreshTokenStore, SecretValue, StoredRefreshToken,
};
use crate::feat126_secure_storage::Feat126SecureStorageProfile;
use crate::native_auth::loopback::LoopbackCallback;
use crate::native_auth::transport::{
    OperationResponse, OperationTransport, PublicTaskErrorCode, PublicTaskTransportOutcome,
};
#[cfg(feature = "feat126-s10-driver")]
use crate::native_auth::{synthetic_authorization_code_tokens, SyntheticLoginFailure};
use serde::{Deserialize, Serialize};
#[cfg(feature = "feat128-s10-runtime")]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use url::Url;

const REFRESH_BEFORE_EXPIRY: Duration = Duration::from_secs(2 * 60);
const REFRESH_IDLE_LIFETIME: u64 = 30 * 24 * 60 * 60;
const REFRESH_ABSOLUTE_LIFETIME: u64 = 90 * 24 * 60 * 60;
const CLOCK_SKEW_SECONDS: u64 = 5 * 60;
const CHAT_PROJECTION_MAX_LIFETIME_SECONDS: i64 = 5 * 60;
const CHAT_PROJECTION_MAX_CAPABILITIES: usize = 64;
const CHAT_PROJECTION_MAX_CAPABILITY_BYTES: usize = 128;

#[derive(Clone)]
pub(crate) struct NativeChatProjection {
    pub tenant_id: uuid::Uuid,
    pub authorization_revision: u64,
    pub expires_at: i64,
    pub capabilities: Vec<String>,
}

impl std::fmt::Debug for NativeChatProjection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("NativeChatProjection")
            .field("tenant_id", &"[RUST_BOUND]")
            .field("authorization_revision", &self.authorization_revision)
            .field("expires_at", &self.expires_at)
            .field("capability_count", &self.capabilities.len())
            .finish()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativeProjectionError {
    Unauthenticated,
    CapabilityDenied,
    Invalid,
    Unavailable,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CapabilityProjectionBody {
    schema_version: u64,
    tenant_id: String,
    authorization_revision: u64,
    expires_at: String,
    capabilities: Vec<String>,
}

#[derive(Clone)]
pub struct NativeAuthRuntime {
    mode: RuntimeMode,
    #[cfg(feature = "feat128-s10-runtime")]
    feat128_s10d_authority: Arc<AtomicBool>,
}

#[cfg(feature = "feat128-s10-runtime")]
const FEAT128_S10D_OWNER: &str = "12800000-0000-4000-8000-000000000001";
#[cfg(feature = "feat128-s10-runtime")]
const FEAT128_S10D_TENANT: &str = "12800000-0000-4000-8000-100000000001";
#[cfg(feature = "feat128-s10-runtime")]
const FEAT128_S10D_AUTHORIZATION_REVISION: u64 = 128;

#[derive(Clone)]
enum RuntimeMode {
    Disabled,
    Invalid,
    Ready(Arc<AuthService>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativePublicTaskOutcome {
    Bound(uuid::Uuid),
    BlockedAuth,
    Denied,
    RetryWait,
    Conflict,
    ProtocolError,
}

struct AuthService {
    oidc: OidcClient,
    binding: RefreshTokenBinding,
    store: Arc<dyn RefreshTokenStore>,
    transport: OperationTransport,
    access: Mutex<Option<AccessSession>>,
    local_whitelist: Option<LocalWhitelistConfig>,
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
    pub(crate) fn from_environment_with_test_profile(
        profile: Option<std::sync::Arc<Feat126SecureStorageProfile>>,
        secure_storage_invalid: bool,
    ) -> Self {
        if secure_storage_invalid {
            return Self {
                mode: RuntimeMode::Invalid,
                #[cfg(feature = "feat128-s10-runtime")]
                feat128_s10d_authority: Arc::new(AtomicBool::new(false)),
            };
        }
        let mode = match NativeAuthConfig::from_environment() {
            Ok(None) => RuntimeMode::Disabled,
            Err(_) => RuntimeMode::Invalid,
            Ok(Some(config)) => {
                if !test_storage_environment_allowed(profile.as_deref(), config.environment) {
                    return Self {
                        mode: RuntimeMode::Invalid,
                        #[cfg(feature = "feat128-s10-runtime")]
                        feat128_s10d_authority: Arc::new(AtomicBool::new(false)),
                    };
                }
                let local_whitelist =
                    match LocalWhitelistConfig::from_environment(config.environment) {
                        Ok(config) => config,
                        Err(_) => {
                            return Self {
                                mode: RuntimeMode::Invalid,
                                #[cfg(feature = "feat128-s10-runtime")]
                                feat128_s10d_authority: Arc::new(AtomicBool::new(false)),
                            }
                        }
                    };
                let binding = RefreshTokenBinding::from_config(&config);
                match (
                    OidcClient::new(config.clone()),
                    ProtectedKeychainStore::new_with_test_profile(profile.clone()),
                    OperationTransport::new(&config),
                ) {
                    (Ok(oidc), Ok(store), Ok(transport)) => {
                        RuntimeMode::Ready(Arc::new(AuthService {
                            oidc,
                            binding,
                            store: Arc::new(store),
                            transport,
                            access: Mutex::new(None),
                            local_whitelist,
                            storage_blocked: Mutex::new(false),
                            login_lock: Mutex::new(()),
                            refresh_lock: Mutex::new(()),
                        }))
                    }
                    _ => RuntimeMode::Invalid,
                }
            }
        };
        Self {
            mode,
            #[cfg(feature = "feat128-s10-runtime")]
            feat128_s10d_authority: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn login(&self) -> Result<AuthStatus, CommandError> {
        self.service()?.login().await.map_err(CommandError::from)
    }

    pub async fn local_whitelist_login(
        &self,
        username: &str,
        password: &str,
    ) -> Result<AuthStatus, CommandError> {
        self.service()?
            .local_whitelist_login(username, password)
            .await
            .map_err(CommandError::from)
    }

    pub async fn logout(&self) -> Result<AuthStatus, CommandError> {
        #[cfg(feature = "feat128-s10-runtime")]
        if self.feat128_s10d_authority.swap(false, Ordering::SeqCst) {
            return Ok(AuthStatus::SignedOut);
        }
        self.service()?.logout().await.map_err(CommandError::from)
    }

    pub async fn status(&self) -> Result<AuthStatus, CommandError> {
        #[cfg(feature = "feat128-s10-runtime")]
        if self.feat128_s10d_authority.load(Ordering::SeqCst) {
            return Ok(AuthStatus::SignedIn);
        }
        match &self.mode {
            RuntimeMode::Disabled => Ok(AuthStatus::Disabled),
            RuntimeMode::Invalid => Err(CommandError::from(NativeAuthError::InvalidConfiguration)),
            RuntimeMode::Ready(service) => service.status().await.map_err(CommandError::from),
        }
    }

    pub async fn list_my_tenants(&self) -> Result<OperationResponse, CommandError> {
        #[cfg(feature = "feat128-s10-runtime")]
        if self.feat128_s10d_authority.load(Ordering::SeqCst) {
            return Ok(feat128_s10d_tenants_response());
        }
        let service = self.service()?;
        service.list_my_tenants().await.map_err(CommandError::from)
    }

    pub async fn get_my_capabilities(
        &self,
        tenant_id: &str,
    ) -> Result<OperationResponse, CommandError> {
        #[cfg(feature = "feat128-s10-runtime")]
        if self.feat128_s10d_authority.load(Ordering::SeqCst) {
            return feat128_s10d_capabilities_response(tenant_id)
                .map_err(|_| CommandError::from(NativeAuthError::InvalidTenant));
        }
        let service = self.service()?;
        service
            .get_my_capabilities(tenant_id)
            .await
            .map_err(CommandError::from)
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub(crate) async fn feat126_s10_driver_login(&self) -> Result<AuthStatus, &'static str> {
        self.service_native()
            .map_err(|_| "driver_login_runtime_invalid")?
            .feat126_s10_driver_login()
            .await
    }

    pub(crate) async fn chat_projection(
        &self,
        tenant_selector: &str,
        now_epoch_seconds: i64,
    ) -> Result<NativeChatProjection, NativeProjectionError> {
        let tenant_id = parse_chat_tenant(tenant_selector)?;
        if now_epoch_seconds < 0 {
            return Err(NativeProjectionError::Invalid);
        }
        #[cfg(feature = "feat128-s10-runtime")]
        if self.feat128_s10d_authority.load(Ordering::SeqCst) {
            if tenant_selector != FEAT128_S10D_TENANT {
                return Err(NativeProjectionError::CapabilityDenied);
            }
            return Ok(NativeChatProjection {
                tenant_id,
                authorization_revision: FEAT128_S10D_AUTHORIZATION_REVISION,
                expires_at: now_epoch_seconds
                    .checked_add(240)
                    .ok_or(NativeProjectionError::Invalid)?,
                capabilities: feat128_s10d_capabilities(),
            });
        }
        let response = self
            .service_native()
            .map_err(map_projection_native_error)?
            .get_my_capabilities(tenant_selector)
            .await
            .map_err(map_projection_native_error)?;
        let observed_at = epoch_seconds()
            .ok()
            .and_then(|value| i64::try_from(value).ok())
            .ok_or(NativeProjectionError::Invalid)?;
        match response.status {
            200 => {}
            401 => return Err(NativeProjectionError::Unauthenticated),
            403 => return Err(NativeProjectionError::CapabilityDenied),
            400 => return Err(NativeProjectionError::Invalid),
            500 | 503 => return Err(NativeProjectionError::Unavailable),
            _ => return Err(NativeProjectionError::Invalid),
        }
        let body: CapabilityProjectionBody =
            serde_json::from_value(response.body).map_err(|_| NativeProjectionError::Invalid)?;
        let response_tenant = parse_chat_tenant(&body.tenant_id)?;
        let expires_at =
            parse_rfc3339_epoch_seconds(&body.expires_at).ok_or(NativeProjectionError::Invalid)?;
        if body.schema_version != 1
            || response_tenant != tenant_id
            || body.authorization_revision == 0
            || !valid_projection_window(now_epoch_seconds, observed_at, expires_at)
            || body.capabilities.is_empty()
            || body.capabilities.len() > CHAT_PROJECTION_MAX_CAPABILITIES
            || body.capabilities.iter().any(|capability| {
                capability.is_empty()
                    || capability.len() > CHAT_PROJECTION_MAX_CAPABILITY_BYTES
                    || !valid_capability_key(capability)
            })
        {
            return Err(NativeProjectionError::Invalid);
        }
        let mut capabilities = body.capabilities;
        capabilities.sort();
        capabilities.dedup();
        Ok(NativeChatProjection {
            tenant_id,
            authorization_revision: body.authorization_revision,
            expires_at,
            capabilities,
        })
    }

    pub(crate) async fn create_chat_public_task(
        &self,
        expected_owner_user_id: uuid::Uuid,
        expected_tenant_id: uuid::Uuid,
        expected_authorization_revision: u64,
        operation_id: uuid::Uuid,
        client_reference_id: uuid::Uuid,
    ) -> NativePublicTaskOutcome {
        if expected_owner_user_id.is_nil()
            || expected_tenant_id.is_nil()
            || expected_authorization_revision == 0
            || operation_id.is_nil()
            || client_reference_id.is_nil()
        {
            return NativePublicTaskOutcome::ProtocolError;
        }
        #[cfg(feature = "feat128-s10-runtime")]
        if self.feat128_s10d_authority.load(Ordering::SeqCst) {
            let owner = uuid::Uuid::parse_str(FEAT128_S10D_OWNER).ok();
            let tenant = uuid::Uuid::parse_str(FEAT128_S10D_TENANT).ok();
            return if owner == Some(expected_owner_user_id)
                && tenant == Some(expected_tenant_id)
                && expected_authorization_revision == FEAT128_S10D_AUTHORIZATION_REVISION
            {
                NativePublicTaskOutcome::Bound(client_reference_id)
            } else {
                NativePublicTaskOutcome::BlockedAuth
            };
        }
        let now = match epoch_seconds().and_then(|value| {
            i64::try_from(value).map_err(|_| NativeAuthError::AuthenticationFailed)
        }) {
            Ok(now) => now,
            Err(_) => return NativePublicTaskOutcome::RetryWait,
        };
        let projection = match self
            .chat_projection(&expected_tenant_id.hyphenated().to_string(), now)
            .await
        {
            Ok(projection) => projection,
            Err(NativeProjectionError::Unauthenticated) => {
                return NativePublicTaskOutcome::BlockedAuth
            }
            Err(NativeProjectionError::CapabilityDenied) => return NativePublicTaskOutcome::Denied,
            Err(NativeProjectionError::Unavailable) => return NativePublicTaskOutcome::RetryWait,
            Err(NativeProjectionError::Invalid) => return NativePublicTaskOutcome::ProtocolError,
        };
        if projection.tenant_id != expected_tenant_id
            || projection.authorization_revision != expected_authorization_revision
        {
            return NativePublicTaskOutcome::BlockedAuth;
        }
        if !projection
            .capabilities
            .iter()
            .any(|capability| capability == "task.create")
        {
            return NativePublicTaskOutcome::Denied;
        }
        let service = match self.service_native() {
            Ok(service) => service,
            Err(NativeAuthError::SignedOut | NativeAuthError::SessionExpired) => {
                return NativePublicTaskOutcome::BlockedAuth
            }
            Err(_) => return NativePublicTaskOutcome::RetryWait,
        };
        match service
            .create_public_task(expected_tenant_id, operation_id, client_reference_id)
            .await
        {
            Ok(PublicTaskTransportOutcome::Created(task))
                if task.tenant_id == expected_tenant_id
                    && task.created_by_user_id == expected_owner_user_id
                    && task.client_reference_id == client_reference_id =>
            {
                NativePublicTaskOutcome::Bound(task.id)
            }
            Ok(PublicTaskTransportOutcome::Created(_)) => NativePublicTaskOutcome::ProtocolError,
            Ok(PublicTaskTransportOutcome::Rejected {
                status: 401,
                code: PublicTaskErrorCode::Unauthenticated,
            }) => NativePublicTaskOutcome::BlockedAuth,
            Ok(PublicTaskTransportOutcome::Rejected {
                status: 403,
                code: PublicTaskErrorCode::AccessDenied,
            }) => NativePublicTaskOutcome::Denied,
            Ok(PublicTaskTransportOutcome::Rejected {
                status: 409,
                code: PublicTaskErrorCode::IdempotencyConflict,
            }) => NativePublicTaskOutcome::Conflict,
            Ok(PublicTaskTransportOutcome::Rejected {
                status: 500 | 503, ..
            }) => NativePublicTaskOutcome::RetryWait,
            Ok(PublicTaskTransportOutcome::Rejected { status: 400, .. }) => {
                NativePublicTaskOutcome::ProtocolError
            }
            Ok(PublicTaskTransportOutcome::Rejected { .. }) => {
                NativePublicTaskOutcome::ProtocolError
            }
            Err(NativeAuthError::SignedOut | NativeAuthError::SessionExpired) => {
                NativePublicTaskOutcome::BlockedAuth
            }
            Err(NativeAuthError::TransportFailed) => NativePublicTaskOutcome::RetryWait,
            Err(_) => NativePublicTaskOutcome::ProtocolError,
        }
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

    #[cfg(feature = "feat128-s10-runtime")]
    pub(crate) fn feat128_s10d_activate_authority(&self) -> Result<(), &'static str> {
        if self.feat128_s10d_authority.swap(true, Ordering::SeqCst) {
            return Err("runtime_authority_duplicate");
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) async fn from_test_oidc_tokens(
        config: NativeAuthConfig,
        oidc: OidcClient,
        tokens: super::oidc::IssuedTokens,
    ) -> Result<Self, NativeAuthError> {
        let binding = RefreshTokenBinding::from_config(&config);
        let now = epoch_seconds()?;
        let expires_at = Instant::now()
            .checked_add(tokens.expires_in)
            .ok_or(NativeAuthError::AuthenticationFailed)?;
        let absolute_expires_at_epoch_seconds = now
            .checked_add(REFRESH_ABSOLUTE_LIFETIME)
            .ok_or(NativeAuthError::AuthenticationFailed)?;
        let stored = StoredRefreshToken::new(
            &binding,
            tokens.refresh_token.expose().to_owned(),
            now,
            now,
            absolute_expires_at_epoch_seconds,
        );
        let store = Arc::new(TestRefreshTokenStore::new(&stored)?);
        let transport = OperationTransport::new(&config)?;
        Ok(Self {
            mode: RuntimeMode::Ready(Arc::new(AuthService {
                oidc,
                binding,
                store,
                transport,
                access: Mutex::new(Some(AccessSession {
                    token: tokens.access_token,
                    expires_at,
                })),
                local_whitelist: None,
                storage_blocked: Mutex::new(false),
                login_lock: Mutex::new(()),
                refresh_lock: Mutex::new(()),
            })),
            #[cfg(feature = "feat128-s10-runtime")]
            feat128_s10d_authority: Arc::new(AtomicBool::new(false)),
        })
    }
}

#[cfg(feature = "feat128-s10-runtime")]
fn feat128_s10d_capabilities() -> Vec<String> {
    vec![
        "task.create".to_owned(),
        "task.read".to_owned(),
        "workspace.use".to_owned(),
    ]
}

#[cfg(feature = "feat128-s10-runtime")]
fn feat128_s10d_tenants_response() -> OperationResponse {
    OperationResponse {
        status: 200,
        cache_control: "no-store".to_owned(),
        www_authenticate: None,
        retry_after: None,
        body: serde_json::json!({
            "tenants": [{
                "tenant_id": FEAT128_S10D_TENANT,
                "display_name": "Strict-local test tenant"
            }]
        }),
    }
}

#[cfg(feature = "feat128-s10-runtime")]
fn feat128_s10d_capabilities_response(tenant_id: &str) -> Result<OperationResponse, &'static str> {
    if tenant_id != FEAT128_S10D_TENANT {
        return Err("runtime_tenant_invalid");
    }
    let expires_at = epoch_seconds()
        .ok()
        .and_then(|now| now.checked_add(240))
        .and_then(format_rfc3339_utc)
        .ok_or("runtime_clock_invalid")?;
    Ok(OperationResponse {
        status: 200,
        cache_control: "no-store".to_owned(),
        www_authenticate: None,
        retry_after: None,
        body: serde_json::json!({
            "schema_version": 1,
            "tenant_id": FEAT128_S10D_TENANT,
            "authorization_revision": FEAT128_S10D_AUTHORIZATION_REVISION,
            "expires_at": expires_at,
            "capabilities": feat128_s10d_capabilities()
        }),
    })
}

#[cfg(feature = "feat128-s10-runtime")]
fn format_rfc3339_utc(epoch_seconds: u64) -> Option<String> {
    let seconds = i64::try_from(epoch_seconds).ok()?;
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let shifted = days.checked_add(719_468)?;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.checked_sub(era.checked_mul(146_097)?)?;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era.checked_add(era.checked_mul(400)?)?;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    if !(1970..=9999).contains(&year) {
        return None;
    }
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        day_seconds / 3_600,
        (day_seconds % 3_600) / 60,
        day_seconds % 60
    ))
}

#[cfg(test)]
struct TestRefreshTokenStore {
    encoded: std::sync::Mutex<Option<Vec<u8>>>,
}

#[cfg(test)]
impl TestRefreshTokenStore {
    fn new(token: &StoredRefreshToken) -> Result<Self, NativeAuthError> {
        Ok(Self {
            encoded: std::sync::Mutex::new(Some(
                serde_json::to_vec(token).map_err(|_| NativeAuthError::SecureStorageUnavailable)?,
            )),
        })
    }
}

#[cfg(test)]
#[async_trait::async_trait]
impl RefreshTokenStore for TestRefreshTokenStore {
    async fn save(&self, token: &StoredRefreshToken) -> Result<(), NativeAuthError> {
        let encoded =
            serde_json::to_vec(token).map_err(|_| NativeAuthError::SecureStorageUnavailable)?;
        *self
            .encoded
            .lock()
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)? = Some(encoded);
        Ok(())
    }

    async fn load(&self) -> Result<RefreshTokenRecord, NativeAuthError> {
        let guard = self
            .encoded
            .lock()
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)?;
        let Some(encoded) = guard.as_deref() else {
            return Ok(RefreshTokenRecord::Missing);
        };
        serde_json::from_slice(encoded)
            .map(RefreshTokenRecord::Current)
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)
    }

    async fn delete(&self) -> Result<(), NativeAuthError> {
        *self
            .encoded
            .lock()
            .map_err(|_| NativeAuthError::SecureStorageUnavailable)? = None;
        Ok(())
    }
}

fn test_storage_environment_allowed(
    profile: Option<&Feat126SecureStorageProfile>,
    environment: AuthEnvironment,
) -> bool {
    !profile.is_some_and(Feat126SecureStorageProfile::uses_ephemeral_backend)
        || environment == AuthEnvironment::LocalIntegration
}

fn map_projection_native_error(error: NativeAuthError) -> NativeProjectionError {
    match error {
        NativeAuthError::SignedOut | NativeAuthError::SessionExpired => {
            NativeProjectionError::Unauthenticated
        }
        NativeAuthError::InvalidTenant | NativeAuthError::ResponseRejected => {
            NativeProjectionError::Invalid
        }
        NativeAuthError::Disabled
        | NativeAuthError::InvalidConfiguration
        | NativeAuthError::LoginInProgress
        | NativeAuthError::CallbackRejected
        | NativeAuthError::AuthenticationFailed
        | NativeAuthError::SecureStorageUnavailable
        | NativeAuthError::TransportFailed => NativeProjectionError::Unavailable,
    }
}

fn parse_chat_tenant(value: &str) -> Result<uuid::Uuid, NativeProjectionError> {
    let parsed = uuid::Uuid::parse_str(value).map_err(|_| NativeProjectionError::Invalid)?;
    if parsed.is_nil() || parsed.hyphenated().to_string() != value {
        return Err(NativeProjectionError::Invalid);
    }
    Ok(parsed)
}

fn valid_capability_key(value: &str) -> bool {
    let mut segments = value.split('.');
    let mut count = 0_usize;
    for segment in &mut segments {
        count += 1;
        let mut characters = segment.chars();
        if !characters
            .next()
            .is_some_and(|character| character.is_ascii_lowercase())
            || !characters.all(|character| {
                character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
            })
        {
            return false;
        }
    }
    count >= 2
}

fn valid_projection_window(requested_at: i64, observed_at: i64, expires_at: i64) -> bool {
    requested_at >= 0
        && observed_at >= requested_at
        && expires_at > observed_at
        && observed_at
            .checked_add(CHAT_PROJECTION_MAX_LIFETIME_SECONDS)
            .is_some_and(|maximum| expires_at <= maximum)
}

fn parse_rfc3339_epoch_seconds(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return None;
    }
    let year = parse_decimal(bytes.get(0..4)?)?;
    let month = parse_decimal(bytes.get(5..7)?)?;
    let day = parse_decimal(bytes.get(8..10)?)?;
    let hour = parse_decimal(bytes.get(11..13)?)?;
    let minute = parse_decimal(bytes.get(14..16)?)?;
    let second = parse_decimal(bytes.get(17..19)?)?;
    if year < 1970
        || !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(year, month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let mut index = 19_usize;
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        let fraction_start = index;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) && index - fraction_start < 9 {
            index += 1;
        }
        if index == fraction_start || bytes.get(index).is_some_and(u8::is_ascii_digit) {
            return None;
        }
    }
    let offset_seconds = if bytes.get(index) == Some(&b'Z') && index + 1 == bytes.len() {
        0_i64
    } else {
        let sign = match bytes.get(index) {
            Some(b'+') => 1_i64,
            Some(b'-') => -1_i64,
            _ => return None,
        };
        if index + 6 != bytes.len() || bytes.get(index + 3) != Some(&b':') {
            return None;
        }
        let offset_hour = parse_decimal(bytes.get(index + 1..index + 3)?)?;
        let offset_minute = parse_decimal(bytes.get(index + 4..index + 6)?)?;
        if offset_hour > 23 || offset_minute > 59 {
            return None;
        }
        sign * i64::from(offset_hour * 3600 + offset_minute * 60)
    };
    let days = days_from_civil(year, month, day)?;
    days.checked_mul(86_400)?
        .checked_add(i64::from(hour * 3600 + minute * 60 + second))?
        .checked_sub(offset_seconds)
}

fn parse_decimal(bytes: &[u8]) -> Option<u32> {
    if bytes.is_empty() || !bytes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    bytes.iter().try_fold(0_u32, |value, digit| {
        value.checked_mul(10)?.checked_add(u32::from(*digit - b'0'))
    })
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year.is_multiple_of(400) || (year.is_multiple_of(4) && !year.is_multiple_of(100)) => {
            29
        }
        2 => 28,
        _ => 0,
    }
}

fn days_from_civil(year: u32, month: u32, day: u32) -> Option<i64> {
    let year = i64::from(year) - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let shifted_month = i64::from(month) + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era.checked_mul(146_097)?
        .checked_add(day_of_era)?
        .checked_sub(719_468)
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

    async fn create_public_task(
        &self,
        tenant_id: uuid::Uuid,
        operation_id: uuid::Uuid,
        client_reference_id: uuid::Uuid,
    ) -> Result<PublicTaskTransportOutcome, NativeAuthError> {
        let first_token = self.access_token(None).await?;
        let first = self
            .transport
            .create_task_v2(tenant_id, operation_id, client_reference_id, &first_token)
            .await?;
        if !matches!(
            first,
            PublicTaskTransportOutcome::Rejected { status: 401, .. }
        ) {
            return Ok(first);
        }

        let retry_token = self.access_token(Some(&first_token)).await?;
        let retry = self
            .transport
            .create_task_v2(tenant_id, operation_id, client_reference_id, &retry_token)
            .await?;
        if matches!(
            retry,
            PublicTaskTransportOutcome::Rejected { status: 401, .. }
        ) && self.clear_rejected_session(&retry_token).await?
        {
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
        self.install_issued_tokens(tokens).await
    }

    async fn local_whitelist_login(
        &self,
        username: &str,
        password: &str,
    ) -> Result<AuthStatus, NativeAuthError> {
        let config = self
            .local_whitelist
            .as_ref()
            .ok_or(NativeAuthError::Disabled)?;
        let _login_guard = self
            .login_lock
            .try_lock()
            .map_err(|_| NativeAuthError::LoginInProgress)?;
        let backend_password = config.backend_password(username, password)?;
        let tokens =
            local_whitelist_authorization_code_tokens(&self.oidc, backend_password.as_str())
                .await
                .map_err(|_| NativeAuthError::AuthenticationFailed)?;
        // The backend password is only needed to complete the synthetic OIDC
        // exchange. Do not keep it alive while tokens are persisted/installed.
        drop(backend_password);
        self.install_issued_tokens(tokens).await
    }

    #[cfg(feature = "feat126-s10-driver")]
    async fn feat126_s10_driver_login(&self) -> Result<AuthStatus, &'static str> {
        let _login_guard = self
            .login_lock
            .try_lock()
            .map_err(|_| "driver_login_concurrent")?;
        let tokens = synthetic_authorization_code_tokens(&self.oidc)
            .await
            .map_err(SyntheticLoginFailure::failure_class)?;
        self.install_issued_tokens(tokens).await.map_err(|error| {
            if error == NativeAuthError::SecureStorageUnavailable {
                "driver_login_storage_failed"
            } else {
                "driver_login_session_failed"
            }
        })
    }

    async fn install_issued_tokens(
        &self,
        tokens: super::oidc::IssuedTokens,
    ) -> Result<AuthStatus, NativeAuthError> {
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

    #[test]
    fn ephemeral_secret_profile_is_rejected_for_production_auth() {
        let (root, profile) = crate::feat126_secure_storage::ephemeral_test_profile();
        assert!(test_storage_environment_allowed(
            Some(&profile),
            AuthEnvironment::LocalIntegration
        ));
        assert!(!test_storage_environment_allowed(
            Some(&profile),
            AuthEnvironment::Production
        ));
        crate::feat126_secure_storage::cleanup_ephemeral_test_profile(&profile).unwrap();
        assert!(!root.exists());
    }

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
            local_whitelist: None,
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
    fn chat_projection_time_and_capability_parsing_is_strict() {
        assert_eq!(
            parse_rfc3339_epoch_seconds("2026-08-03T12:34:56Z"),
            Some(1_785_760_496)
        );
        assert_eq!(
            parse_rfc3339_epoch_seconds("2026-08-03T20:34:56+08:00"),
            Some(1_785_760_496)
        );
        assert_eq!(
            parse_rfc3339_epoch_seconds("2024-02-29T00:00:00.123456789Z"),
            Some(1_709_164_800)
        );
        for invalid in [
            "2026-02-29T00:00:00Z",
            "2026-08-03 12:34:56Z",
            "2026-08-03T12:34:60Z",
            "2026-08-03T12:34:56.1234567890Z",
            "2026-08-03T12:34:56+24:00",
        ] {
            assert_eq!(parse_rfc3339_epoch_seconds(invalid), None, "{invalid}");
        }
        assert!(valid_capability_key("task.read"));
        assert!(valid_capability_key("workspace.use"));
        assert!(!valid_capability_key("task"));
        assert!(!valid_capability_key("Task.read"));
        assert!(!valid_capability_key("task..read"));
    }

    #[test]
    fn chat_projection_window_uses_response_observation_time() {
        let requested_at = 1_785_760_496;
        let observed_at = requested_at + 1;
        assert!(valid_projection_window(
            requested_at,
            observed_at,
            requested_at + CHAT_PROJECTION_MAX_LIFETIME_SECONDS + 1,
        ));
        assert!(!valid_projection_window(
            requested_at,
            observed_at,
            observed_at + CHAT_PROJECTION_MAX_LIFETIME_SECONDS + 1,
        ));
        assert!(!valid_projection_window(
            requested_at,
            requested_at - 1,
            requested_at + CHAT_PROJECTION_MAX_LIFETIME_SECONDS,
        ));
        assert!(!valid_projection_window(
            requested_at,
            observed_at,
            observed_at
        ));
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
