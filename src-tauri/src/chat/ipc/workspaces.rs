//! Local-only workspace catalog and creation. Contract: docs/contracts/chat-workspaces-v1.md.
use super::*;
use crate::chat::{database::validate_project_path, native_project, RuntimeMode};
use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceDto {
    project: ProjectDto,
    path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceCatalog {
    root_path: String,
    workspaces: Vec<WorkspaceDto>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateWorkspacePayload {
    name: String,
}

#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
enum CreationStatus {
    Created,
    NameConflict,
    InvalidName,
    Unavailable,
}

#[derive(Serialize)]
pub(crate) struct WorkspaceCreation {
    status: CreationStatus,
    workspace: Option<WorkspaceDto>,
}

impl WorkspaceCreation {
    fn failed(status: CreationStatus) -> Self {
        Self {
            status,
            workspace: None,
        }
    }
}

fn workspace_name(raw: &str) -> Option<String> {
    let name: String = raw.trim().nfc().collect();
    if name.is_empty()
        || name.len() > 240
        || name.chars().count() > 80
        || name.starts_with('.')
        || name.ends_with('.')
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
    {
        return None;
    }
    Some(name)
}

fn root_path(home: &Path) -> Result<PathBuf, ChatError> {
    Ok(validate_project_path(home)?
        .join("Yijie")
        .join("Workspaces"))
}

fn prepare_root(home: &Path) -> Result<PathBuf, ChatError> {
    let mut path = validate_project_path(home)?;
    for component in ["Yijie", "Workspaces"] {
        path.push(component);
        match std::fs::DirBuilder::new().mode(0o700).create(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(ChatError::ProjectUnavailable),
        }
        if validate_project_path(&path)? != path {
            return Err(ChatError::ProjectUnavailable);
        }
    }
    Ok(path)
}

fn create_workspace(
    repository: &mut crate::chat::ChatRepository,
    home: &Path,
    raw_name: &str,
) -> Result<WorkspaceCreation, ChatError> {
    let Some(name) = workspace_name(raw_name) else {
        return Ok(WorkspaceCreation::failed(CreationStatus::InvalidName));
    };
    let directory = prepare_root(home)?.join(name);
    match std::fs::DirBuilder::new().mode(0o700).create(&directory) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Ok(WorkspaceCreation::failed(CreationStatus::NameConflict));
        }
        Err(_) => return Ok(WorkspaceCreation::failed(CreationStatus::Unavailable)),
    }
    // Keep the directory on registration failure. It may already contain user files.
    let registered = (|| {
        let selection =
            native_project::create_selection(&directory)?.ok_or(ChatError::ProjectUnavailable)?;
        if selection.canonical_path != directory {
            return Err(ChatError::ProjectUnavailable);
        }
        let path = selection
            .canonical_path
            .to_str()
            .ok_or(ChatError::ProjectUnavailable)?
            .to_owned();
        let project =
            repository.register_project(&selection.canonical_path, &selection.bookmark)?;
        Ok::<_, ChatError>(WorkspaceDto {
            project: project.into(),
            path: Some(path),
        })
    })();
    Ok(match registered {
        Ok(workspace) => WorkspaceCreation {
            status: CreationStatus::Created,
            workspace: Some(workspace),
        },
        Err(_) => WorkspaceCreation::failed(CreationStatus::Unavailable),
    })
}

fn catalog(
    repository: &crate::chat::ChatRepository,
    home: &Path,
) -> Result<WorkspaceCatalog, ChatError> {
    let root_path = root_path(home)?
        .to_str()
        .ok_or(ChatError::ProjectUnavailable)?
        .to_owned();
    let projects = repository.list_projects()?;
    if projects.len() > 256 {
        return Err(ChatError::ProjectionLimitExceeded);
    }
    let workspaces = projects
        .into_iter()
        .map(|mut project| {
            let path = repository
                .project_bookmark(&project.id)
                .ok()
                .and_then(|bookmark| native_project::resolve_bookmark(&bookmark).ok())
                .and_then(|selection| selection.canonical_path.to_str().map(str::to_owned));
            project.available = path.is_some();
            WorkspaceDto {
                project: project.into(),
                path,
            }
        })
        .collect();
    Ok(WorkspaceCatalog {
        root_path,
        workspaces,
    })
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use crate::chat::{
        keychain::{DatabaseKey, ReceiptKey},
        ChatRepository, ChatScope,
    };

    fn repository(home: &Path, scope: ChatScope) -> ChatRepository {
        ChatRepository::open(
            &home.join("app-data"),
            &DatabaseKey::from_bytes([81; 32]),
            ReceiptKey::from_bytes([82; 32]),
            scope,
        )
        .unwrap()
    }

    #[test]
    fn workspace_names_accept_chinese_trim_and_normalize() {
        assert_eq!(workspace_name("  市场调研  "), Some("市场调研".into()));
        assert_eq!(workspace_name("Cafe\u{301}"), Some("Café".into()));
        assert_eq!(workspace_name(" "), None);
        assert_eq!(workspace_name(&"长".repeat(81)), None);
    }

    #[test]
    fn named_workspace_round_trips_and_never_overwrites_existing_directory() {
        let temporary =
            std::env::temp_dir().join(format!("yijie-workspace-test-{}", Uuid::now_v7()));
        std::fs::create_dir(&temporary).unwrap();
        let home = std::fs::canonicalize(&temporary).unwrap();
        let scope = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
        let mut repo = repository(&home, scope.clone());
        assert_eq!(
            create_workspace(&mut repo, &home, " ").unwrap().status,
            CreationStatus::InvalidName
        );
        assert!(!home.join("Yijie").exists());
        let result = create_workspace(&mut repo, &home, "市场调研").unwrap();
        assert_eq!(result.status, CreationStatus::Created);
        let workspace = result.workspace.unwrap();
        assert_eq!(workspace.project.safe_name, "市场调研");
        let expected = home.join("Yijie/Workspaces/市场调研");
        assert_eq!(workspace.path.as_deref(), expected.to_str());
        std::fs::write(expected.join("notes.txt"), "ordinary user notes").unwrap();
        assert_eq!(
            create_workspace(&mut repo, &home, "市场调研")
                .unwrap()
                .status,
            CreationStatus::NameConflict
        );
        assert_eq!(
            std::fs::read_to_string(expected.join("notes.txt")).unwrap(),
            "ordinary user notes"
        );
        assert_eq!(repo.list_projects().unwrap().len(), 1);
        drop(repo);
        let repo = repository(&home, scope);
        let listing = catalog(&repo, &home).unwrap();
        assert_eq!(listing.workspaces.len(), 1);
        assert_eq!(
            listing.workspaces[0].project.project_id,
            workspace.project.project_id
        );
        assert_eq!(listing.workspaces[0].path, workspace.path);
        assert!(listing.workspaces[0].project.available);
        drop(repo);
        let other_scope =
            ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
        let other = repository(&home, other_scope);
        assert!(catalog(&other, &home).unwrap().workspaces.is_empty());
        drop(other);
        std::fs::remove_dir_all(temporary).unwrap();
    }
}

#[tauri::command]
pub(crate) async fn chat_workspace_catalog_v1(
    request: Value,
    app: AppHandle,
    chat_runtime: State<'_, ChatRuntime>,
) -> Result<CommandResponse<WorkspaceCatalog>, ChatIpcError> {
    let request: CommandRequest<EmptyPayload> = decode_request(request)?;
    let manager = chat_runtime
        .authorization_manager()
        .map_err(|e| map_chat_error(e, Some(request.request_id)))?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadProjects,
        request.request_id,
    )?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::UseProject,
        request.request_id,
    )?;
    let home = app
        .path()
        .home_dir()
        .map_err(|_| map_chat_error(ChatError::ProjectUnavailable, Some(request.request_id)))?;
    let worker = chat_runtime
        .database()
        .await
        .map_err(|e| map_chat_error(e, Some(request.request_id)))?;
    let read_manager = manager.clone();
    let result = worker
        .call(move |repository| {
            read_manager
                .authorize_detailed(
                    request.context_id,
                    ChatAction::ReadProjects,
                    unix_seconds()?,
                )
                .map_err(|_| ChatError::ScopeDenied)?;
            read_manager
                .authorize_detailed(request.context_id, ChatAction::UseProject, unix_seconds()?)
                .map_err(|_| ChatError::ScopeDenied)?;
            catalog(repository, &home)
        })
        .await
        .map_err(|e| map_chat_error(e, Some(request.request_id)))?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::UseProject,
        request.request_id,
    )?;
    Ok(CommandResponse::new(request.request_id, result))
}

#[tauri::command]
pub(crate) async fn chat_create_workspace_v1(
    request: Value,
    app: AppHandle,
    chat_runtime: State<'_, ChatRuntime>,
) -> Result<CommandResponse<WorkspaceCreation>, ChatIpcError> {
    let request: CommandRequest<CreateWorkspacePayload> = decode_request(request)?;
    let manager = chat_runtime
        .authorization_manager()
        .map_err(|e| map_chat_error(e, Some(request.request_id)))?;
    authorize(
        &manager,
        request.context_id,
        ChatAction::UseProject,
        request.request_id,
    )?;
    if !matches!(&chat_runtime.mode, RuntimeMode::Local(config) if config.secure_storage.is_none())
    {
        return Ok(CommandResponse::new(
            request.request_id,
            WorkspaceCreation::failed(CreationStatus::Unavailable),
        ));
    }
    let home = app
        .path()
        .home_dir()
        .map_err(|_| map_chat_error(ChatError::ProjectUnavailable, Some(request.request_id)))?;
    let worker = chat_runtime
        .database()
        .await
        .map_err(|e| map_chat_error(e, Some(request.request_id)))?;
    let result = worker
        .call(move |repository| {
            manager
                .authorize_detailed(request.context_id, ChatAction::UseProject, unix_seconds()?)
                .map_err(|_| ChatError::ScopeDenied)?;
            create_workspace(repository, &home, &request.payload.name)
        })
        .await
        .map_err(|e| map_chat_error(e, Some(request.request_id)))?;
    Ok(CommandResponse::new(request.request_id, result))
}
