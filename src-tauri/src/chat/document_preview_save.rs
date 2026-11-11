//! Save the original, already scoped document through the existing system
//! picker and atomic writer. No renderer-supplied destination or file bytes.
use super::artifact_file_native::{
    atomic_save_file_bytes, canonical_file_save_name, normalized_file_target,
    pick_native_file_save_target, validate_file_for_save,
};
use super::artifact_native::ArtifactNativeCode as Code;
use super::document_preview_native::{authorize, read_source, DocumentSource, StoredDocument};
use super::ChatRuntime;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tokio::sync::Semaphore;
use uuid::Uuid;

static SAVE_DIALOG: Semaphore = Semaphore::const_new(1);

fn checked_name(document: &StoredDocument, revision: &str) -> Result<String, Code> {
    if revision.len() != 64
        || !revision
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(Code::InvalidRequest);
    }
    if document.revision != revision {
        return Err(Code::IntegrityFailed);
    }
    validate_file_for_save(&document.mime, &document.bytes)?;
    canonical_file_save_name(Some(&document.name), &document.mime)
}

pub(super) async fn save(
    runtime: &ChatRuntime,
    context: Uuid,
    source: &DocumentSource,
    revision: &str,
    desktop: Option<PathBuf>,
    process_epoch: Uuid,
) -> Result<&'static str, Code> {
    let _dialog = SAVE_DIALOG.try_acquire().map_err(|_| Code::Conflict)?;
    let first = read_source(runtime, context, source, desktop.clone()).await?;
    let name = checked_name(&first, revision)?;
    let mime = first.mime.clone();
    drop(first);
    let Some(selected) = pick_native_file_save_target(&name, &mime).await? else {
        return Ok("cancelled");
    };
    let target = normalized_file_target(&selected, &mime)?;
    // Closing the dialog does not extend the authority or preserve an old copy:
    // re-read the same source and require the revision that was previewed.
    let second = read_source(runtime, context, source, desktop).await?;
    if checked_name(&second, revision)? != name || second.mime != mime {
        return Err(Code::IntegrityFailed);
    }
    authorize(runtime, context)?;
    tokio::task::spawn_blocking(move || {
        let digest: [u8; 32] = Sha256::digest(&second.bytes).into();
        atomic_save_file_bytes(
            &target,
            &second.mime,
            &second.bytes,
            second.bytes.len(),
            digest,
            process_epoch,
        )
    })
    .await
    .map_err(|_| Code::Unavailable)??;
    Ok("saved")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document() -> StoredDocument {
        let bytes = b"# West Lake\nA normal document.\n".to_vec();
        StoredDocument {
            name: "West Lake.md".into(),
            mime: "text/markdown".into(),
            revision: format!("{:x}", Sha256::digest(&bytes)),
            bytes,
            expires: i64::MAX,
        }
    }

    #[test]
    fn normal_save_preserves_name_and_requires_the_previewed_revision() {
        let document = document();
        assert_eq!(
            checked_name(&document, &document.revision).unwrap(),
            "West Lake.md"
        );
        let newer_revision = format!("{:x}", Sha256::digest(b"Updated document"));
        assert!(matches!(
            checked_name(&document, &newer_revision),
            Err(Code::IntegrityFailed)
        ));
    }

    #[test]
    fn normal_document_copy_uses_the_existing_atomic_writer() {
        let document = document();
        let root = std::env::temp_dir().join(format!("yijie-document-save-{}", Uuid::now_v7()));
        std::fs::create_dir(&root).unwrap();
        let target = normalized_file_target(&root.join("West Lake"), &document.mime).unwrap();
        let digest: [u8; 32] = Sha256::digest(&document.bytes).into();
        atomic_save_file_bytes(
            &target,
            &document.mime,
            &document.bytes,
            document.bytes.len(),
            digest,
            Uuid::now_v7(),
        )
        .unwrap();
        assert_eq!(std::fs::read(target).unwrap(), document.bytes);
        std::fs::remove_dir_all(root).unwrap();
    }
}
