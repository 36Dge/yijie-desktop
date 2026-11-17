//! Explicit local verification selector; no product permission or execution state.
use serde_json::Value;
use std::sync::OnceLock;
pub(crate) fn profile() -> &'static Value {
    static PROFILE: OnceLock<Value> = OnceLock::new();
    PROFILE.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../../contracts/market-local-acceptance.json"
        ))
        .expect("canonical local acceptance profile")
    })
}
pub(crate) fn label() -> Result<Option<String>, &'static str> {
    let label = std::env::var("YIJIE_MARKET_LOCAL_ACCEPTANCE").unwrap_or_default();
    if label.is_empty() {
        return Ok(None);
    }
    if !cfg!(feature = "kimi-k31-pro-candidate")
        || std::env::var("YIJIE_ENV").as_deref() != Ok("local")
        || std::env::var("YIJIE_LOCAL_PROFILE").as_deref() != Ok("demo_fast")
        || std::env::var("YIJIE_DEVELOPMENT_CLIENT").as_deref() != Ok("true")
        || !std::env::var("YIJIE_FEAT174_ACCEPTANCE")
            .unwrap_or_default()
            .is_empty()
        || label.len() > 48
        || label.starts_with('-')
        || !label
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err("invalid isolated market acceptance selector");
    }
    Ok(Some(label))
}
pub(crate) fn enabled() -> bool {
    label().is_ok_and(|v| v.is_some())
}
pub(crate) fn service_id() -> &'static str {
    profile()["provider"]["serviceId"]
        .as_str()
        .expect("service")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_catalog_reuses_the_normal_generated_contract() {
        let entry: super::super::generated::CatalogEntry =
            serde_json::from_value(profile()["catalogEntry"].clone()).unwrap();
        entry.validate().unwrap();
        assert_eq!(entry.service_id, service_id());
        assert_eq!(entry.auth_mode, super::super::generated::AuthMode::None);
        assert_eq!(profile()["release"], false);
    }
}
