use super::database::validate_project_path;
use super::error::ChatError;
use std::path::{Path, PathBuf};

pub struct ProjectSelection {
    pub canonical_path: PathBuf,
    pub bookmark: Vec<u8>,
}

#[cfg(target_os = "macos")]
pub async fn pick_project() -> Result<Option<ProjectSelection>, ChatError> {
    let selected = rfd::AsyncFileDialog::new()
        .set_title("选择聊天项目")
        .pick_folder()
        .await;
    let Some(selected) = selected else {
        return Ok(None);
    };
    create_selection(selected.path())
}

#[cfg(not(target_os = "macos"))]
pub async fn pick_project() -> Result<Option<ProjectSelection>, ChatError> {
    Err(ChatError::NativePickerUnavailable)
}

#[cfg(target_os = "macos")]
pub fn create_selection(path: &Path) -> Result<Option<ProjectSelection>, ChatError> {
    use objc2_foundation::{NSArray, NSString, NSURLBookmarkCreationOptions, NSURL};

    let canonical_path = validate_project_path(path)?;
    let path_string = canonical_path
        .to_str()
        .ok_or(ChatError::ProjectUnavailable)?;
    let ns_path = NSString::from_str(path_string);
    let url = NSURL::fileURLWithPath_isDirectory(&ns_path, true);
    let options = NSURLBookmarkCreationOptions::WithSecurityScope
        | NSURLBookmarkCreationOptions::SecurityScopeAllowOnlyReadAccess;
    let bookmark = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            options,
            None::<&NSArray<_>>,
            None,
        )
        .map_err(|_| ChatError::ProjectUnavailable)?;
    let length = bookmark.length();
    if length == 0 || length > 1024 * 1024 {
        return Err(ChatError::ProjectUnavailable);
    }
    let mut bytes = vec![0_u8; length];
    let pointer =
        std::ptr::NonNull::new(bytes.as_mut_ptr().cast()).ok_or(ChatError::ProjectUnavailable)?;
    unsafe { bookmark.getBytes_length(pointer, length) };
    Ok(Some(ProjectSelection {
        canonical_path,
        bookmark: bytes,
    }))
}

#[cfg(not(target_os = "macos"))]
pub fn create_selection(_path: &Path) -> Result<Option<ProjectSelection>, ChatError> {
    Err(ChatError::NativePickerUnavailable)
}

#[cfg(target_os = "macos")]
pub fn resolve_bookmark(bookmark: &[u8]) -> Result<ProjectSelection, ChatError> {
    use objc2::runtime::Bool;
    use objc2_foundation::{NSData, NSURLBookmarkResolutionOptions, NSURL};

    if bookmark.is_empty() || bookmark.len() > 1024 * 1024 {
        return Err(ChatError::InvalidInput);
    }
    let data = unsafe { NSData::dataWithBytes_length(bookmark.as_ptr().cast(), bookmark.len()) };
    let mut stale = Bool::NO;
    let options = NSURLBookmarkResolutionOptions::WithSecurityScope
        | NSURLBookmarkResolutionOptions::WithoutUI
        | NSURLBookmarkResolutionOptions::WithoutMounting;
    let url = unsafe {
        NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
            &data, options, None, &mut stale,
        )
    }
    .map_err(|_| ChatError::ProjectUnavailable)?;
    let started = unsafe { url.startAccessingSecurityScopedResource() };
    if !started {
        return Err(ChatError::ProjectUnavailable);
    }
    let result = (|| {
        let path = url.path().ok_or(ChatError::ProjectUnavailable)?;
        let canonical_path = validate_project_path(Path::new(&path.to_string()))?;
        let selection = create_selection(&canonical_path)?.ok_or(ChatError::ProjectUnavailable)?;
        if stale.as_bool() {
            return Ok(selection);
        }
        Ok(ProjectSelection {
            canonical_path,
            bookmark: bookmark.to_vec(),
        })
    })();
    unsafe { url.stopAccessingSecurityScopedResource() };
    result
}

#[cfg(not(target_os = "macos"))]
pub fn resolve_bookmark(_bookmark: &[u8]) -> Result<ProjectSelection, ChatError> {
    Err(ChatError::NativePickerUnavailable)
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn security_scoped_bookmark_round_trips_without_exposing_path_in_projection() {
        let root = std::env::temp_dir().join(format!("yijie-project-{}", Uuid::now_v7()));
        std::fs::create_dir(&root).unwrap();
        let selection = create_selection(&root)
            .expect("create bookmark")
            .expect("selection");
        assert!(!selection.bookmark.is_empty());
        let resolved = resolve_bookmark(&selection.bookmark).expect("resolve bookmark");
        assert_eq!(
            resolved.canonical_path,
            std::fs::canonicalize(&root).unwrap()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
