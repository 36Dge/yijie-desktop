use super::market_v2::{enabled, failure, host, validate_operation};
use super::market_v2_generated::{ErrorResponse, Operation};
use super::SkillRuntime;
use crate::chat::ChatRuntime;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{ipc::Channel, DragDropEvent, Manager, PhysicalPosition, State, Webview, WebviewEvent};
use uuid::Uuid;

pub(super) struct SkillFile {
    pub name: String,
    pub bytes: Vec<u8>,
    pub digest: String,
}

pub(super) async fn pick_file() -> Option<PathBuf> {
    rfd::AsyncFileDialog::new()
        .set_title("导入技能")
        .add_filter("技能 ZIP 或 SKILL.md", &["zip", "md"])
        .pick_file()
        .await
        .map(|file| file.path().to_owned())
}

pub(super) async fn read_file(path: PathBuf) -> Result<SkillFile, ErrorResponse> {
    tokio::task::spawn_blocking(move || {
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| failure("import_format_invalid", false))?
            .to_owned();
        let limit = if name.eq_ignore_ascii_case("SKILL.md") {
            1 << 20
        } else if name.to_ascii_lowercase().ends_with(".zip") {
            64 << 20
        } else {
            return Err(failure("import_format_invalid", false));
        };
        let unavailable = || failure("import_file_unavailable", true);
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)
            .map_err(|_| unavailable())?;
        let info = file.metadata().map_err(|_| unavailable())?;
        if !info.is_file() || info.len() == 0 || info.len() > limit {
            return Err(failure("import_too_large", false));
        }
        let mut bytes = Vec::with_capacity(info.len() as usize);
        file.take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| unavailable())?;
        if bytes.len() as u64 != info.len() {
            return Err(failure("import_file_changed", true));
        }
        let digest = format!("{:x}", Sha256::digest(&bytes));
        Ok(SkillFile {
            name,
            bytes,
            digest,
        })
    })
    .await
    .map_err(|_| failure("import_file_unavailable", true))?
}

#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ImportDrag {
    Over {
        position: PhysicalPosition<f64>,
    },
    Leave,
    Drop {
        position: PhysicalPosition<f64>,
        drop_id: String,
    },
}

#[derive(Serialize)]
pub(crate) struct ImportSelection {
    id: String,
    name: String,
}

struct Dialog {
    id: String,
    events: Channel<ImportDrag>,
    last_drop: Option<(String, Result<PathBuf, ErrorResponse>)>,
    preparing: bool,
    selected: Option<(String, Arc<SkillFile>)>,
}

impl Dialog {
    fn new(id: String, events: Channel<ImportDrag>) -> Self {
        Self {
            id,
            events,
            last_drop: None,
            preparing: false,
            selected: None,
        }
    }

    fn begin_choice(&mut self, drop_id: Option<String>) -> Result<Option<PathBuf>, ErrorResponse> {
        if self.preparing {
            return Err(failure("skill_busy", true));
        }
        let path = match drop_id {
            Some(id) => Some(
                self.last_drop
                    .take_if(|(key, _)| *key == id)
                    .ok_or_else(reselect)?
                    .1?,
            ),
            None => None,
        };
        self.preparing = true;
        Ok(path)
    }

    fn finish_choice(
        &mut self,
        result: Result<Option<SkillFile>, ErrorResponse>,
    ) -> Result<Option<ImportSelection>, ErrorResponse> {
        self.preparing = false;
        let Some(file) = result? else { return Ok(None) };
        let selection = ImportSelection {
            id: Uuid::now_v7().to_string(),
            name: file.name.clone(),
        };
        self.selected = Some((selection.id.clone(), Arc::new(file)));
        Ok(Some(selection))
    }

    fn selected_file(&self, selection_id: &str) -> Result<Arc<SkillFile>, ErrorResponse> {
        if self.preparing {
            return Err(failure("skill_busy", true));
        }
        self.selected
            .as_ref()
            .filter(|(id, _)| id == selection_id)
            .map(|(_, file)| Arc::clone(file))
            .ok_or_else(reselect)
    }
}

#[derive(Default)]
pub(crate) struct ImportDialogState(Mutex<Option<Dialog>>);

fn reselect() -> ErrorResponse {
    failure("source_reselection_required", true)
}

impl ImportDialogState {
    fn with_dialog<T>(
        &self,
        id: &str,
        action: impl FnOnce(&mut Dialog) -> Result<T, ErrorResponse>,
    ) -> Result<T, ErrorResponse> {
        let mut slot = self.0.lock().unwrap();
        action(
            slot.as_mut()
                .filter(|dialog| dialog.id == id)
                .ok_or_else(reselect)?,
        )
    }

    pub(crate) fn clear(&self) {
        *self.0.lock().unwrap() = None;
    }

    fn drag(&self, event: &DragDropEvent) {
        let (channel, message) = {
            let mut slot = self.0.lock().unwrap();
            let Some(dialog) = slot.as_mut() else { return };
            let message = match event {
                DragDropEvent::Enter { position, .. } | DragDropEvent::Over { position } => {
                    ImportDrag::Over {
                        position: *position,
                    }
                }
                DragDropEvent::Leave => ImportDrag::Leave,
                DragDropEvent::Drop { paths, position } => {
                    let drop_id = Uuid::now_v7().to_string();
                    let path = match paths.as_slice() {
                        [path] => Ok(path.clone()),
                        _ => Err(failure("import_multiple_files", false)),
                    };
                    // The UI hit-tests the position. Only this native drop receipt
                    // can be redeemed for the file, and only inside the same dialog.
                    dialog.last_drop = Some((drop_id.clone(), path));
                    ImportDrag::Drop {
                        position: *position,
                        drop_id,
                    }
                }
                _ => return,
            };
            (dialog.events.clone(), message)
        };
        let _ = channel.send(message);
    }
}

pub(crate) fn on_webview_event(webview: &Webview, event: &WebviewEvent) {
    if webview.label() == "main" {
        if let WebviewEvent::DragDrop(event) = event {
            webview.state::<ImportDialogState>().drag(event);
        }
    }
}

fn require_main(webview: &Webview) -> Result<(), ErrorResponse> {
    if webview.label() == "main" && enabled() {
        Ok(())
    } else {
        Err(failure("capability_denied", false))
    }
}

#[tauri::command]
pub(crate) fn skills_open_import_v2(
    webview: Webview,
    dialog_id: String,
    events: Channel<ImportDrag>,
    state: State<'_, ImportDialogState>,
    runtime: State<'_, SkillRuntime>,
) -> Result<(), ErrorResponse> {
    require_main(&webview)?;
    validate_operation(&dialog_id)?;
    runtime
        .catalog()
        .map_err(|_| failure("skill_resource_unavailable", false))?;
    *state.0.lock().unwrap() = Some(Dialog::new(dialog_id, events));
    Ok(())
}

#[tauri::command]
pub(crate) fn skills_close_import_v2(
    webview: Webview,
    dialog_id: String,
    state: State<'_, ImportDialogState>,
) -> Result<(), ErrorResponse> {
    require_main(&webview)?;
    let mut slot = state.0.lock().unwrap();
    if slot.as_ref().is_some_and(|dialog| dialog.id == dialog_id) {
        *slot = None;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn skills_prepare_import_v2(
    webview: Webview,
    dialog_id: String,
    drop_id: Option<String>,
    state: State<'_, ImportDialogState>,
) -> Result<Option<ImportSelection>, ErrorResponse> {
    require_main(&webview)?;
    let dropped = state.with_dialog(&dialog_id, |dialog| dialog.begin_choice(drop_id))?;
    let path = match dropped {
        Some(path) => Some(path),
        None => pick_file().await,
    };
    let result = match path {
        Some(path) => read_file(path).await.map(Some),
        None => Ok(None),
    };
    state.with_dialog(&dialog_id, |dialog| dialog.finish_choice(result))
}

#[tauri::command]
pub(crate) async fn skills_confirm_import_v2(
    webview: Webview,
    dialog_id: String,
    selection_id: String,
    state: State<'_, ImportDialogState>,
    runtime: State<'_, SkillRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<Operation, ErrorResponse> {
    require_main(&webview)?;
    let file = state.with_dialog(&dialog_id, |dialog| dialog.selected_file(&selection_id))?;
    // Each selection keeps its operation identity and original bytes across retries.
    host(&runtime, &chat)
        .await?
        .skill_market_import(&selection_id, &file.name, &file.digest, file.bytes.clone())
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn dropped_skill_is_bound_to_its_bytes_until_replaced_or_closed() {
        let root = std::env::temp_dir().join(Uuid::now_v7().to_string());
        std::fs::create_dir(&root).unwrap();
        let path = root.join("SKILL.md");
        let original = b"---\nname: ordinary-example\ndescription: Example skill\n---\n";
        std::fs::write(&path, original).unwrap();
        let state = ImportDialogState::default();
        let dialog_id = Uuid::now_v7().to_string();
        let (sender, receiver) = std::sync::mpsc::channel();
        let events = Channel::new(move |body| {
            let tauri::ipc::InvokeResponseBody::Json(json) = body else {
                panic!("expected a JSON drop event");
            };
            sender.send(json).unwrap();
            Ok(())
        });
        *state.0.lock().unwrap() = Some(Dialog::new(dialog_id.clone(), events));
        state.drag(&DragDropEvent::Drop {
            paths: vec![path.clone()],
            position: PhysicalPosition::new(80.0, 90.0),
        });
        let event: serde_json::Value = serde_json::from_str(&receiver.try_recv().unwrap()).unwrap();
        let receipt = event["dropId"].as_str().unwrap();
        assert_eq!(
            event,
            serde_json::json!({
                "type": "drop", "position": { "x": 80.0, "y": 90.0 }, "dropId": receipt
            })
        );
        let from_drop = state
            .with_dialog(&dialog_id, |dialog| {
                dialog.begin_choice(Some(receipt.to_owned()))
            })
            .unwrap()
            .unwrap();
        let first = read_file(from_drop).await.unwrap();
        let selection = state
            .with_dialog(&dialog_id, |dialog| dialog.finish_choice(Ok(Some(first))))
            .unwrap()
            .unwrap();
        assert_eq!(selection.name, "SKILL.md");

        std::fs::write(&path, b"Updated example description").unwrap();
        state
            .with_dialog(&dialog_id, |dialog| {
                assert!(dialog.begin_choice(None)?.is_none());
                assert!(dialog.finish_choice(Ok(None))?.is_none());
                let retained = dialog.selected_file(&selection.id)?;
                assert_eq!(retained.bytes, original);
                assert_eq!(retained.digest, format!("{:x}", Sha256::digest(original)));
                Ok(())
            })
            .unwrap();
        let replacement = read_file(path.clone()).await.unwrap();
        state
            .with_dialog(&dialog_id, |dialog| {
                let second = dialog.finish_choice(Ok(Some(replacement)))?.unwrap();
                assert_ne!(second.id, selection.id);
                assert!(dialog.selected_file(&selection.id).is_err());
                assert!(dialog.selected_file(&second.id).is_ok());
                Ok(())
            })
            .unwrap();
        state.clear();
        assert!(state.with_dialog(&dialog_id, |_| Ok(())).is_err());
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
