mod config;
mod error;
mod keychain;
mod local_whitelist;
mod loopback;
mod oidc;
mod runtime;
mod secret;
mod synthetic_agent;
mod transport;

pub use config::NativeAuthConfig;
pub use error::{CommandError, NativeAuthError};
pub use keychain::{
    ProtectedKeychainStore, RefreshTokenBinding, RefreshTokenRecord, RefreshTokenStore,
    StoredRefreshToken,
};
pub(crate) use local_whitelist::LocalWhitelistConfig;
pub use oidc::{OidcClient, RefreshFailure};
pub use runtime::{AuthStatus, NativeAuthRuntime};
pub(crate) use runtime::{NativeProjectionError, NativePublicTaskOutcome};
pub use secret::SecretValue;
pub(crate) use synthetic_agent::local_whitelist_authorization_code_tokens;
#[cfg(any(test, feature = "feat126-s10-driver"))]
pub(crate) use synthetic_agent::synthetic_authorization_code_tokens;
#[cfg(feature = "feat126-s10-driver")]
pub(crate) use synthetic_agent::SyntheticLoginFailure;
#[cfg(not(feature = "feat126-s10-driver"))]
pub use transport::OperationResponse;
