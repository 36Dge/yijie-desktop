//! Compile-time gated FEAT-126 S10BO1 driver.
//!
//! This module is intentionally private to the non-publishable test build. It
//! returns a closed projection consumed by the local orchestrator and never
//! exposes bearer tokens, tenant authority, filesystem paths, or credentials
//! to the WebView.

use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::feat126_secure_storage::Feat126SecureStorageProfile;

const PROFILE: &str = "feat-126-s10-local-lab";
const MASTER_ENV: &str = "YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED";
const DRIVER_ENV: &str = "YIJIE_FEAT126_S10_DRIVER_ENABLED";
const EPHEMERAL_ENV: &str = "YIJIE_FEAT126_S10_EPHEMERAL_SECRET_BACKEND_ENABLED";
const RUN_ENV: &str = "YIJIE_FEAT126_S10_RUN_ID";
const NONCE_ENV: &str = "YIJIE_FEAT126_S10_DRIVER_NONCE";
const FIXED_PROJECT_ID: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693f99";

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct DriverProjection {
    pub schema_version: u8,
    pub message_kind: &'static str,
    pub run_id: String,
    pub nonce: String,
    pub sequence: u64,
    pub profile: &'static str,
    pub project: FixedProjectProjection,
    pub authorization: PkceProjection,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct FixedProjectProjection {
    pub id: &'static str,
    pub capability: &'static str,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PkceProjection {
    pub flow: &'static str,
    pub method: &'static str,
    pub code_challenge: String,
}

pub fn synthetic_authorization(run_id: &str) -> Result<PkceProjection, &'static str> {
    let parsed = Uuid::parse_str(run_id).map_err(|_| "run_id_invalid")?;
    if parsed.is_nil() || parsed.to_string() != run_id || parsed.get_version_num() != 4 {
        return Err("run_id_invalid");
    }
    let _authorization_code = Zeroizing::new(format!("synthetic-code-{run_id}"));
    let verifier = format!("feat126-pkce-verifier-{run_id}");
    let digest = Sha256::digest(verifier.as_bytes());
    Ok(PkceProjection {
        flow: "authorization_code",
        method: "S256",
        code_challenge: base64_url(&digest),
    })
}

pub fn build_projection(run_id: &str, nonce: &str) -> Result<DriverProjection, &'static str> {
    let authorization = synthetic_authorization(run_id)?;
    let parsed_nonce = Uuid::parse_str(nonce).map_err(|_| "nonce_invalid")?;
    if parsed_nonce.is_nil() || parsed_nonce.to_string() != nonce {
        return Err("nonce_invalid");
    }
    Ok(DriverProjection {
        schema_version: 1,
        message_kind: "component_ready",
        run_id: run_id.to_owned(),
        nonce: nonce.to_owned(),
        sequence: 1,
        profile: PROFILE,
        project: FixedProjectProjection {
            id: FIXED_PROJECT_ID,
            capability: "local_only",
        },
        authorization,
    })
}

#[tauri::command]
pub fn feat126_s10_driver_probe() -> Result<DriverProjection, String> {
    if std::env::var(MASTER_ENV).as_deref() != Ok("true")
        || std::env::var(DRIVER_ENV).as_deref() != Ok("true")
        || std::env::var(EPHEMERAL_ENV).as_deref() != Ok("true")
    {
        return Err("driver_not_enabled".to_owned());
    }
    let run_id = std::env::var(RUN_ENV).map_err(|_| "run_id_invalid".to_owned())?;
    let nonce = std::env::var(NONCE_ENV).map_err(|_| "nonce_invalid".to_owned())?;
    let profile = Feat126SecureStorageProfile::from_environment()
        .map_err(|_| "driver_profile_invalid".to_owned())?
        .ok_or_else(|| "driver_profile_invalid".to_owned())?;
    if profile.run_id() != run_id || profile.validate_fixed_project().is_err() {
        return Err("driver_project_invalid".to_owned());
    }
    build_projection(&run_id, &nonce).map_err(str::to_owned)
}

fn base64_url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::with_capacity((bytes.len() * 4).div_ceil(3));
    let mut index = 0;
    while index < bytes.len() {
        let first = bytes[index] as u32;
        let second = bytes.get(index + 1).copied().unwrap_or(0) as u32;
        let third = bytes.get(index + 2).copied().unwrap_or(0) as u32;
        let block = (first << 16) | (second << 8) | third;
        output.push(ALPHABET[((block >> 18) & 63) as usize] as char);
        output.push(ALPHABET[((block >> 12) & 63) as usize] as char);
        if index + 1 < bytes.len() {
            output.push(ALPHABET[((block >> 6) & 63) as usize] as char);
        }
        if index + 2 < bytes.len() {
            output.push(ALPHABET[(block & 63) as usize] as char);
        }
        index += 3;
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUN_ID: &str = "019fbd88-cbc3-4bf1-934d-7b05cd693f80";
    const NONCE: &str = "019fbd88-cbc3-4bf1-934d-7b05cd693f81";

    #[test]
    fn projection_is_closed_and_content_free() {
        let projection = build_projection(RUN_ID, NONCE).unwrap();
        assert_eq!(projection.project.id, FIXED_PROJECT_ID);
        assert_eq!(projection.authorization.method, "S256");
        let encoded = serde_json::to_string(&projection).unwrap();
        for forbidden in ["bearer", "tenant", "path", "secret", "dsn", "payload"] {
            assert!(!encoded.to_ascii_lowercase().contains(forbidden));
        }
    }

    #[test]
    fn invalid_authority_fails_closed() {
        assert_eq!(build_projection("not-a-run", NONCE), Err("run_id_invalid"));
        assert_eq!(
            build_projection(RUN_ID, "not-a-nonce"),
            Err("nonce_invalid")
        );
    }
}
