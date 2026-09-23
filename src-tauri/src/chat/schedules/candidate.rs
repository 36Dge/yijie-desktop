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
pub(crate) const CHILD_ENV: &str = "YIJIE_SCHEDULED_CANDIDATE";
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
