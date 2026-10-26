//! Fixed offline App identity. No alternate path or authorization authority.
pub(crate) const IDENTIFIER: &str = "com.yijie.ai.feat164-qualification-v1";

pub(crate) fn admitted(identifier: &str) -> bool {
    identifier != IDENTIFIER
        || (crate::chat::models::enabled()
            && std::env::var("YIJIE_FEAT155_SCHEDULED_CANDIDATE").as_deref() == Ok("true")
            && std::env::var("YIJIE_FEAT155_SCHEDULED_DAILY").as_deref() == Ok("false")
            && std::env::var("YIJIE_PERMISSION_VERIFICATION_BASE_URL").as_deref()
                == Ok("http://127.0.0.1:18083/v1"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn fixed_profile_matches_bundle_and_requires_offline_assembly() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.feat164-qualification.conf.json")).unwrap();
        assert_eq!(config["identifier"], super::IDENTIFIER);
        assert!(super::admitted("com.yijie.ai"));
        // This test runs without the dedicated offline App assembly.
        assert!(!super::admitted(super::IDENTIFIER));
    }
}
