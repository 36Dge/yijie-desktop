//! Fixed deployment identities. No alternate path or execution authority.
pub(crate) const IDENTIFIER: &str = "com.yijie.ai.feat164-qualification-v1";

pub(crate) const DAILY_IDENTIFIER: &str = "com.yijie.ai";

pub(crate) fn daily_selected() -> bool {
    std::env::var("YIJIE_FEAT164_DAILY").as_deref() == Ok("true")
}

fn daily_profile(
    identifier: &str,
    models: bool,
    candidate: bool,
    qualification: bool,
    isolated: bool,
    daily: bool,
) -> bool {
    identifier == DAILY_IDENTIFIER && models && candidate && !qualification && !isolated && daily
}

pub(crate) fn daily_admitted(identifier: &str) -> bool {
    daily_selected()
        && daily_profile(
            identifier,
            crate::chat::models::enabled(),
            crate::chat::models::v2_enabled(),
            std::env::var("YIJIE_FEAT164_QUALIFICATION")
                .ok()
                .is_some_and(|value| value != "false"),
            std::env::var("YIJIE_FEAT155_SCHEDULED_CANDIDATE").as_deref() != Ok("false"),
            std::env::var("YIJIE_FEAT155_SCHEDULED_DAILY").as_deref() == Ok("true"),
        )
}

pub(crate) fn admitted(identifier: &str) -> bool {
    if !matches!(
        std::env::var("YIJIE_FEAT164_DAILY").ok().as_deref(),
        None | Some("false") | Some("true")
    ) {
        return false;
    }
    if daily_selected() {
        return daily_admitted(identifier);
    }
    // A K31 daily binary cannot silently use the legacy daily assembly.
    if identifier == DAILY_IDENTIFIER && cfg!(feature = "kimi-k31-pro-candidate") {
        return false;
    }
    (identifier != IDENTIFIER
        && std::env::var("YIJIE_FEAT164_QUALIFICATION").as_deref() != Ok("true"))
        || (identifier == IDENTIFIER
            && crate::chat::models::enabled()
            && std::env::var("YIJIE_FEAT155_SCHEDULED_CANDIDATE").as_deref() == Ok("true")
            && std::env::var("YIJIE_FEAT155_SCHEDULED_DAILY").as_deref() == Ok("false")
            && std::env::var("YIJIE_PERMISSION_VERIFICATION_BASE_URL").as_deref()
                == Ok("http://127.0.0.1:18083/v1"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn feat164_daily_identity_and_flags_are_closed() {
        for models in [false, true] {
            for candidate in [false, true] {
                for qualification in [false, true] {
                    for isolated in [false, true] {
                        for daily in [false, true] {
                            assert_eq!(
                                super::daily_profile(
                                    super::DAILY_IDENTIFIER,
                                    models,
                                    candidate,
                                    qualification,
                                    isolated,
                                    daily
                                ),
                                models && candidate && !qualification && !isolated && daily
                            );
                        }
                    }
                }
            }
        }
        for id in [
            super::IDENTIFIER,
            "com.yijie.ai.feat164-kimi-k31-r1",
            "future",
        ] {
            assert!(!super::daily_profile(id, true, true, false, false, true));
        }
    }
    #[test]
    fn fixed_profile_matches_bundle_and_requires_offline_assembly() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.feat164-qualification.conf.json")).unwrap();
        assert_eq!(config["identifier"], super::IDENTIFIER);
        assert_eq!(
            super::admitted("com.yijie.ai"),
            !cfg!(feature = "kimi-k31-pro-candidate") && !super::daily_selected()
        );
        // This test runs without the dedicated offline App assembly.
        assert!(!super::admitted(super::IDENTIFIER));
    }
}
