//! Normal storage fixtures follow the same compiled model family as the client.
//! Historical/rollback fixtures keep their explicitly named old schemas.
use crate::chat::{migrations, models};
use rusqlite::Connection;

pub(super) fn active_profile() -> &'static str {
    if models::schema_version() == 2 {
        "kimi-k3-1-pro-max-v1"
    } else {
        "kimi-k3-max-v1"
    }
}

pub(super) fn migrate_active_store(db: &mut Connection, legacy_target: i64) {
    let target = if models::schema_version() == 2 {
        legacy_target.max(migrations::KIMI_K31_SCHEMA_VERSION)
    } else {
        legacy_target
    };
    migrations::migrate_to_target(db, target).unwrap();
}

/// Run environment-dependent admission tests in the real test executable, so
/// enabling the local model profile never races unrelated feature-off tests.
/// This follows the existing secure-storage subprocess fixture mechanism.
#[cfg(feature = "kimi-k31-pro-candidate")]
pub(super) fn run_in_current_model_environment(test_name: &str) -> bool {
    run_in_model_environment(test_name, false)
}

#[cfg(feature = "kimi-k31-pro-candidate")]
pub(super) fn run_in_model_environment(test_name: &str, execution_paused: bool) -> bool {
    const CHILD: &str = "YIJIE_TEST_MODEL_ENVIRONMENT";
    // libtest omits the crate prefix included by module_path!(). Verify the
    // exact target exists: a zero-test child must never count as validation.
    let test_name = test_name
        .strip_prefix(concat!(env!("CARGO_CRATE_NAME"), "::"))
        .unwrap_or(test_name);
    if std::env::var(CHILD).as_deref() == Ok(test_name) {
        assert!(models::enabled());
        return false;
    }
    let executable = std::env::current_exe().unwrap();
    let listing = std::process::Command::new(&executable)
        .args(["--exact", test_name, "--list"])
        .output()
        .unwrap();
    assert!(listing.status.success());
    assert!(
        String::from_utf8(listing.stdout)
            .unwrap()
            .lines()
            .any(|line| line == format!("{test_name}: test")),
        "unknown test: {test_name}"
    );
    let status = std::process::Command::new(executable)
        .args(["--exact", test_name, "--nocapture"])
        .env(CHILD, test_name)
        .env("YIJIE_ENV", "local")
        .env("YIJIE_LOCAL_PROFILE", "demo_fast")
        .env("YIJIE_CHAT_MODELS_ENABLED", "true")
        .env("YIJIE_KIMI_K31_PRO_CANDIDATE", "true")
        .env(
            "YIJIE_KIMI_K31_EXECUTION_PAUSED",
            if execution_paused { "true" } else { "false" },
        )
        .status()
        .unwrap();
    assert!(
        status.success(),
        "configured model admission test failed: {test_name}"
    );
    true
}
