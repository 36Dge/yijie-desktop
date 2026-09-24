//! Native-only local candidate assembly. The launch descriptor selects storage,
//! never execution permission. Dispatch still needs a current explicit action.
use crate::chat::{
    database::{validate_project_path, ChatScope},
    error::ChatError,
};
use serde::Serialize;
use std::{
    os::unix::fs::{DirBuilderExt, PermissionsExt},
    path::{Path, PathBuf},
};

pub(crate) const FLAG: &str = "YIJIE_FEAT155_SCHEDULED_CANDIDATE";
pub(crate) const DAILY_FLAG: &str = "YIJIE_FEAT155_SCHEDULED_DAILY";
pub(crate) const CHILD_ENV: &str = "YIJIE_SCHEDULED_CANDIDATE";

// The existing daily parent may be 0755; retain its permissions and keys.
// New data directories are private, and every selected path is canonical.
pub(crate) fn prepare_daily_directory(base: &Path) -> Result<(), ChatError> {
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(base)
        .map_err(|_| ChatError::InvalidConfiguration)?;
    if validate_project_path(base)? != base {
        return Err(ChatError::InvalidConfiguration);
    }
    private_directory(&base.join("chat"))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Selection {
    Disabled,
    Daily,
    Isolated,
}
impl Selection {
    pub(crate) fn resolve(
        demo_fast: bool,
        isolated: Option<&str>,
        daily: Option<&str>,
    ) -> Result<Self, ChatError> {
        let flag = |value| match value {
            None | Some("false") => Ok(false),
            Some("true") if demo_fast => Ok(true),
            _ => Err(ChatError::InvalidConfiguration),
        };
        match (flag(isolated)?, flag(daily)?) {
            (false, false) => Ok(Self::Disabled),
            (true, false) => Ok(Self::Isolated),
            (false, true) => Ok(Self::Daily),
            (true, true) => Err(ChatError::InvalidConfiguration),
        }
    }
    pub(crate) fn enabled(self) -> bool {
        self != Self::Disabled
    }
    pub(crate) fn data_directory(self) -> &'static str {
        if self == Self::Isolated {
            "demo-fast-scheduled-candidate-v1"
        } else {
            "demo-fast-v1"
        }
    }
}
#[derive(Clone, Serialize)]
pub(crate) struct Launch {
    schema_version: u8,
    owner_user_id: String,
    tenant_id: String,
    workspace_root: PathBuf,
}
impl Launch {
    pub(crate) fn prepare(chat: &Path, scope: &ChatScope) -> Result<Self, ChatError> {
        scope.owner_uuid()?;
        scope.tenant_uuid()?;
        let mut path = validate_project_path(chat)?;
        for part in [
            "scheduled-workspaces",
            &scope.tenant_id,
            &scope.owner_user_id,
        ] {
            path.push(part);
            private_directory(&path)?;
        }
        Ok(Self {
            schema_version: 1,
            owner_user_id: scope.owner_user_id.clone(),
            tenant_id: scope.tenant_id.clone(),
            workspace_root: path,
        })
    }
    pub(crate) fn encode(&self) -> Result<String, ChatError> {
        serde_json::to_string(self).map_err(|_| ChatError::InvalidConfiguration)
    }
}
pub(crate) fn private_directory(path: &Path) -> Result<(), ChatError> {
    match std::fs::DirBuilder::new().mode(0o700).create(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(ChatError::InvalidConfiguration),
    }
    if validate_project_path(path)? != path
        || std::fs::metadata(path)
            .map_err(|_| ChatError::InvalidConfiguration)?
            .permissions()
            .mode()
            & 0o777
            != 0o700
    {
        return Err(ChatError::InvalidConfiguration);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn feat155_daily_selection_preserves_existing_data_and_requires_exact_native_profile() {
        let disabled = Selection::resolve(true, None, None).unwrap();
        let daily = Selection::resolve(true, None, Some("true")).unwrap();
        let isolated = Selection::resolve(true, Some("true"), None).unwrap();
        assert!(!disabled.enabled());
        assert!(daily.enabled() && isolated.enabled());
        assert_eq!(daily.data_directory(), disabled.data_directory());
        assert_ne!(daily.data_directory(), isolated.data_directory());
        for (demo, a, b) in [
            (false, None, Some("true")),
            (false, Some("true"), None),
            (true, Some("true"), Some("true")),
            (true, None, Some("TRUE")),
        ] {
            assert!(Selection::resolve(demo, a, b).is_err());
        }
    }
}
