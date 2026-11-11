//! Locate an existing local copy of an authorized stored document. Publishing
//! keeps a durable blob, but its original workspace file can still be present.
//! A basename alone is never evidence: the complete content must match.
use super::artifact_file_native::canonical_file_extension;
use super::artifact_native::ArtifactNativeCode as Code;
use super::database::ChatRepository;
use super::document_preview_native::{authorize, read_source, DocumentSource};
use super::error::{map_sqlite_error, ChatError};
use super::ChatRuntime;
use rusqlite::params;
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_ENTRIES: usize = 4096;
const MAX_DEPTH: usize = 8;
const READ_BUDGET: u64 = 64 * 1024 * 1024;

impl ChatRepository {
    pub(super) fn document_workspace_root(&self, session: Uuid) -> Result<PathBuf, ChatError> {
        self.session_summary(session)?;
        let project: String = self.connection.query_row(
            "SELECT p.id FROM chat_projects p JOIN chat_sessions s ON s.project_id=p.id
             WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3
             AND p.owner_user_id=s.owner_user_id AND p.tenant_id=s.tenant_id AND p.removed_at IS NULL
             AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id)",
            params![session.to_string(), self.scope.owner_user_id, self.scope.tenant_id],
            |row| row.get(0),
        ).map_err(map_sqlite_error)?;
        self.resolve_schedule_project(&project)
    }
}

struct Fingerprint {
    name: String,
    extension: &'static str,
    size: u64,
    revision: String,
}

fn same_content(path: &Path, expected: &Fingerprint) -> bool {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW_ANY | libc::O_NONBLOCK | libc::O_CLOEXEC);
    }
    let Ok(file) = options.open(path) else {
        return false;
    };
    let Ok(metadata) = file.metadata() else {
        return false;
    };
    if !metadata.is_file() || metadata.len() != expected.size {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return false;
        }
    }
    let mut reader = file.take(expected.size + 1);
    let mut digest = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                total += count as u64;
                digest.update(&buffer[..count]);
            }
            Err(_) => return false,
        }
    }
    total == expected.size && format!("{:x}", digest.finalize()) == expected.revision
}

fn find_existing(root: &Path, expected: &Fingerprint) -> Result<PathBuf, Code> {
    if !root.is_absolute() || fs::canonicalize(root).ok().as_deref() != Some(root) {
        return Err(Code::Forbidden);
    }
    let mut directories = VecDeque::from([(root.to_path_buf(), 0_usize)]);
    let mut candidates = Vec::new();
    let mut entries = 0;
    let mut limited = false;
    while let Some((directory, depth)) = directories.pop_front() {
        if fs::canonicalize(&directory).ok().as_ref() != Some(&directory) {
            continue;
        }
        let Ok(children) = fs::read_dir(&directory) else {
            continue;
        };
        for child in children.flatten() {
            entries += 1;
            if entries > MAX_ENTRIES {
                limited = true;
                break;
            }
            let path = child.path();
            let Ok(kind) = child.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if depth < MAX_DEPTH {
                    directories.push_back((path, depth + 1));
                } else {
                    limited = true;
                }
            } else if kind.is_file() {
                let extension = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let compatible = extension == expected.extension
                    || (expected.extension == "md" && extension == "markdown")
                    || (expected.extension == "html" && extension == "htm");
                if compatible && child.metadata().is_ok_and(|m| m.len() == expected.size) {
                    candidates.push(path);
                }
            }
        }
        if entries > MAX_ENTRIES {
            break;
        }
    }
    // If equivalent copies exist, prefer the registered filename and then a
    // stable shortest workspace path. Every returned copy is independently read.
    candidates.sort_by_key(|path| {
        (
            path.file_name().and_then(|s| s.to_str()) != Some(expected.name.as_str()),
            path.components().count(),
            path.clone(),
        )
    });
    let mut budget = READ_BUDGET;
    #[cfg(debug_assertions)]
    let candidate_count = candidates.len();
    for candidate in candidates {
        if budget < expected.size {
            return Err(Code::LimitExceeded);
        }
        budget -= expected.size;
        if same_content(&candidate, expected)
            && fs::canonicalize(&candidate).ok().as_ref() == Some(&candidate)
        {
            if candidate
                .to_str()
                .is_none_or(|s| s.len() > 4096 || s.chars().any(char::is_control))
            {
                return Err(Code::InvalidRequest);
            }
            return Ok(candidate);
        }
    }
    #[cfg(debug_assertions)]
    eprintln!("YIJIE_DOCUMENT_LOCATION_DIAGNOSTIC stage=file-search candidates={candidate_count} limited={limited}");
    Err(if limited {
        Code::LimitExceeded
    } else {
        Code::NotFound
    })
}

pub(super) async fn locate(
    runtime: &ChatRuntime,
    context: Uuid,
    source: &DocumentSource,
    revision: &str,
) -> Result<PathBuf, Code> {
    let (session, _, _) = source.stored_ids().ok_or(Code::InvalidRequest)?;
    let stored = read_source(runtime, context, source, None).await?;
    if stored.revision != revision {
        return Err(Code::IntegrityFailed);
    }
    let expected = Fingerprint {
        name: stored.name,
        extension: canonical_file_extension(&stored.mime).ok_or(Code::Unsupported)?,
        size: stored.bytes.len() as u64,
        revision: stored.revision,
    };
    drop(stored.bytes);
    let database = runtime.database().await.map_err(|_| Code::Unavailable)?;
    let root = database
        .call(move |repo| repo.document_workspace_root(session))
        .await
        .map_err(|_error| {
            #[cfg(debug_assertions)]
            eprintln!("YIJIE_DOCUMENT_LOCATION_DIAGNOSTIC stage=workspace code={_error}");
            Code::NotFound
        })?;
    let path = tokio::task::spawn_blocking(move || find_existing(&root, &expected))
        .await
        .map_err(|_| Code::Unavailable)??;
    authorize(runtime, context)?;
    let source = source.clone();
    let revision = revision.to_owned();
    let now = super::document_preview_native::now()?;
    if !database
        .call(move |repo| repo.document_preview_current(source, revision, now))
        .await
        .map_err(|_| Code::Unavailable)?
    {
        return Err(Code::Expired);
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn locates_the_existing_nested_version_by_bytes_not_just_the_name() {
        let root = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("yijie-location-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        fs::create_dir(root.join("outputs")).unwrap();
        let bytes = b"The current version of a normal document.";
        let expected = Fingerprint {
            name: "report.txt".into(),
            extension: "txt",
            size: bytes.len() as u64,
            revision: format!("{:x}", Sha256::digest(bytes)),
        };
        fs::write(root.join("report.txt"), vec![b'x'; bytes.len()]).unwrap();
        let current = root.join("outputs/registered-version.txt");
        fs::write(&current, bytes).unwrap();
        assert_eq!(find_existing(&root, &expected).unwrap(), current);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn prefers_the_registered_name_among_verified_equivalent_copies() {
        let root = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("yijie-location-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let bytes = b"Normal document";
        let expected = Fingerprint {
            name: "report.md".into(),
            extension: "md",
            size: bytes.len() as u64,
            revision: format!("{:x}", Sha256::digest(bytes)),
        };
        fs::write(root.join("copy.md"), bytes).unwrap();
        fs::write(root.join("report.md"), bytes).unwrap();
        assert_eq!(
            find_existing(&root, &expected).unwrap(),
            root.join("report.md")
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn a_missing_local_copy_does_not_create_a_file_or_invent_a_path() {
        let root = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("yijie-location-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let expected = Fingerprint {
            name: "report.txt".into(),
            extension: "txt",
            size: 5,
            revision: format!("{:x}", Sha256::digest(b"hello")),
        };
        assert!(matches!(
            find_existing(&root, &expected),
            Err(Code::NotFound)
        ));
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }
}
