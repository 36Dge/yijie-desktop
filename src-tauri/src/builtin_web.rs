//! Native-owned automatic retrieval delegation. Nothing here is a renderer IPC.
#[path = "contracts/builtin_web_generated.rs"]
#[allow(dead_code)]
pub(crate) mod wire;
use crate::{chat::connectors::control::MarketControl, native_auth::NativeAuthRuntime};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub(crate) fn valid(name: &str, value: &Value) -> bool {
    let Ok(mut schema) = serde_json::from_str::<Value>(wire::SCHEMA_JSON) else {
        return false;
    };
    schema["$ref"] = Value::String(format!("#/$defs/{name}"));
    jsonschema::options()
        .should_validate_formats(true)
        .build(&schema)
        .is_ok_and(|schema| schema.is_valid(value))
}
pub(crate) struct Delegation(pub(crate) Value);
impl std::fmt::Debug for Delegation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("WebDelegation([redacted])")
    }
}
pub(crate) enum MintResponse {
    Granted(Delegation),
    SessionExpired,
    Unavailable,
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
static OWNERS: OnceLock<Mutex<HashMap<String, tokio::sync::watch::Receiver<bool>>>> = OnceLock::new();

/// The existing sidecar stop closes the owner pipe. Keep Native alive until
/// its delegation task has completed the final service revocation request.
pub(crate) async fn wait_stopped(host: &str) -> bool {
    let finished = OWNERS
        .get_or_init(Default::default)
        .lock()
        .expect("web owners")
        .get(host)
        .cloned();
    let Some(mut finished) = finished else {
        return true;
    };
    tokio::time::timeout(Duration::from_secs(7), finished.wait_for(|done| *done))
        .await
        .is_ok_and(|result| result.is_ok())
}
async fn install(pipe: &MarketControl, process: &str, binding: &str, grant: &Delegation) -> bool {
    let id = Uuid::now_v7().to_string();
    let request = json!({"schemaVersion":1,"requestId":id,"method":"web_capability_install","payload":{"method":"web_capability_install","process_epoch":process,"binding_epoch":binding,"delegation":grant.0}});
    if !valid("WebControlRequest", &request) {
        return false;
    }
    pipe.request::<_, Value>(&id, &request)
        .await
        .is_ok_and(|reply| {
            valid("WebControlResponse", &reply)
                && reply["data"]["process_epoch"] == process
                && matches!(
                    reply["data"]["state"].as_str(),
                    Some("applied" | "already_applied")
                )
        })
}
async fn clear(pipe: &MarketControl, process: &str, binding: &str) {
    if !pipe.is_open() {
        return;
    }
    let id = Uuid::now_v7().to_string();
    let request = json!({"schemaVersion":1,"requestId":id,"method":"web_capability_clear","payload":{"method":"web_capability_clear","process_epoch":process,"binding_epoch":binding}});
    let _ = pipe.request::<_, Value>(&id, &request).await;
}
pub(crate) async fn start(
    auth: NativeAuthRuntime,
    pipe: MarketControl,
    host: String,
    process: String,
    tenant: Uuid,
) {
    if std::env::var("YIJIE_BUILTIN_WEB_ENABLED").ok().as_deref() == Some("false") {
        return;
    }
    let owners = OWNERS.get_or_init(Default::default);
    let (finished, receiver) = tokio::sync::watch::channel(false);
    {
        let mut owners = owners.lock().expect("web owners");
        if owners.contains_key(&host) {
            return;
        }
        owners.insert(host.clone(), receiver);
    }
    let mut binding = Uuid::now_v7();
    // A missing backend entitlement never prevents ordinary native web_search.
    let first = tokio::time::timeout(
        Duration::from_secs(5),
        auth.mint_builtin_web(tenant, binding),
    )
    .await
    .ok()
    .flatten();
    let mut current = None;
    if let Some(grant) = first {
        if install(&pipe, &process, &binding.to_string(), &grant).await {
            current = Some(grant)
        }
    }
    tokio::spawn(async move {
        let mut next = now_ms() + 60000;
        loop {
            if !pipe.is_open() {
                break;
            }
            if let Some(grant) = &current {
                next = grant.0["expires_at_unix_ms"]
                    .as_u64()
                    .unwrap_or(0)
                    .saturating_sub(60000)
            }
            if now_ms() >= next {
                let fresh = tokio::time::timeout(
                    Duration::from_secs(5),
                    auth.mint_builtin_web(tenant, binding),
                )
                .await
                .ok()
                .flatten();
                match fresh {
                    Some(grant) if install(&pipe, &process, &binding.to_string(), &grant).await => {
                        current = Some(grant)
                    }
                    _ => {
                        clear(&pipe, &process, &binding.to_string()).await;
                        if let Some(grant) = current.take() {
                            let _ = tokio::time::timeout(
                                Duration::from_secs(5),
                                auth.revoke_builtin_web(&grant),
                            )
                            .await;
                        }
                        binding = Uuid::now_v7();
                        next = now_ms() + 60000;
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        if let Some(grant) = current {
            let _ =
                tokio::time::timeout(Duration::from_secs(5), auth.revoke_builtin_web(&grant)).await;
        }
        finished.send_replace(true);
        owners.lock().expect("web owners").remove(&host);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_delegation_is_source_valid_and_redacted() {
        let grant = Delegation(
            json!({"binding_id":Uuid::now_v7(),"grant_id":Uuid::now_v7(),"bearer":"ordinary-native-web-delegation","expires_at_unix_ms":now_ms()+300000,"authorization_revision":1,"credential_revision":1,"audience":"builtin-web-retrieval/1"}),
        );
        assert!(valid("Delegation", &grant.0));
        assert_eq!(format!("{grant:?}"), "WebDelegation([redacted])");
        let request = json!({"schemaVersion":1,"requestId":Uuid::now_v7(),"method":"web_capability_install","payload":{"method":"web_capability_install","process_epoch":Uuid::now_v7(),"binding_epoch":Uuid::now_v7(),"delegation":grant.0}});
        assert!(valid("WebControlRequest", &request));
    }
    #[tokio::test]
    #[ignore="requires the normal owned local service; never executes search"]
    async fn feat175_demo_native_delegation(){
        let profile=crate::local_profile::LocalRuntimeProfile::from_environment().unwrap();
        assert!(profile.is_demo_fast());
        let auth=NativeAuthRuntime::from_environment_with_test_profile(None,false,profile);
        let grant=auth.mint_builtin_web(Uuid::parse_str(crate::local_profile::DEMO_FAST_TENANT_ID).unwrap(),Uuid::now_v7()).await.expect("normal Demo identity must mint the scoped delegation");
        assert!(valid("Delegation",&grant.0));
        auth.revoke_builtin_web(&grant).await;
    }
}
