const ENVIRONMENT: &str = "YIJIE_ENV";
const PROFILE: &str = "YIJIE_LOCAL_PROFILE";
const LOCAL_ENVIRONMENT: &str = "local";
const DEMO_FAST_PROFILE: &str = "demo_fast";

pub(crate) const DEMO_FAST_OWNER_USER_ID: &str = "12500000-0000-4000-8000-000000000001";
pub(crate) const DEMO_FAST_TENANT_ID: &str = "12500000-0000-4000-8000-100000000001";
pub(crate) const DEMO_FAST_AUTHORIZATION_REVISION: u64 = 1;
pub(crate) const DEMO_FAST_PROJECTION_TTL_SECONDS: u64 = 240;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum LocalRuntimeProfile {
    #[default]
    Standard,
    DemoFast,
}

impl LocalRuntimeProfile {
    pub(crate) fn from_environment() -> Result<Self, &'static str> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    pub(crate) const fn is_demo_fast(self) -> bool {
        matches!(self, Self::DemoFast)
    }

    fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, &'static str> {
        let environment = lookup(ENVIRONMENT);
        let profile = lookup(PROFILE);
        match (environment.as_deref(), profile.as_deref()) {
            (Some(LOCAL_ENVIRONMENT), Some(DEMO_FAST_PROFILE)) => Ok(Self::DemoFast),
            (_, None | Some("")) => Ok(Self::Standard),
            _ => Err("local_runtime_profile_invalid"),
        }
    }
}

pub(crate) fn demo_fast_capabilities() -> Vec<String> {
    vec![
        "knowledge.read".to_owned(),
        "plugin.manage".to_owned(),
        "plugin.read".to_owned(),
        "schedule.read".to_owned(),
        "store.read".to_owned(),
        "task.create".to_owned(),
        "task.read".to_owned(),
        "workspace.use".to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn parse(values: &[(&str, &str)]) -> Result<LocalRuntimeProfile, &'static str> {
        let values = values
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect::<HashMap<_, _>>();
        LocalRuntimeProfile::from_lookup(|name| values.get(name).cloned())
    }

    #[test]
    fn demo_fast_requires_the_exact_local_conjunction() {
        assert_eq!(
            parse(&[(ENVIRONMENT, "local"), (PROFILE, "demo_fast")]),
            Ok(LocalRuntimeProfile::DemoFast)
        );
        assert_eq!(parse(&[]), Ok(LocalRuntimeProfile::Standard));
        assert_eq!(
            parse(&[(ENVIRONMENT, "local")]),
            Ok(LocalRuntimeProfile::Standard)
        );
        for values in [
            vec![(ENVIRONMENT, "production"), (PROFILE, "demo_fast")],
            vec![(ENVIRONMENT, "local"), (PROFILE, "DEMO_FAST")],
            vec![(ENVIRONMENT, "LOCAL"), (PROFILE, "demo_fast")],
            vec![(ENVIRONMENT, "local"), (PROFILE, "production_hardened")],
        ] {
            assert_eq!(parse(&values), Err("local_runtime_profile_invalid"));
        }
    }
}
