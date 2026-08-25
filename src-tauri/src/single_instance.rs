use std::fs::{File, OpenOptions};
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};

const LOCK_FILE_NAME: &str = "com.yijie.ai.desktop.instance.lock";

#[derive(Debug)]
pub(crate) enum AcquireError {
    AlreadyRunning,
    UnsafeLockFile,
    Unavailable,
}

pub(crate) struct Guard {
    _file: File,
}

pub(crate) fn acquire() -> Result<Guard, AcquireError> {
    acquire_at(user_cache_directory()?.join(LOCK_FILE_NAME))
}

fn user_cache_directory() -> Result<PathBuf, AcquireError> {
    // `_CS_DARWIN_USER_CACHE_DIR` is a stable per-user directory. Unlike the Darwin
    // temp directory, macOS does not periodically remove inactive files from it.
    // SAFETY: a null buffer with length zero is the documented size query.
    let required =
        unsafe { libc::confstr(libc::_CS_DARWIN_USER_CACHE_DIR, std::ptr::null_mut(), 0) };
    if required < 2 || required > libc::PATH_MAX as usize {
        return Err(AcquireError::Unavailable);
    }

    let mut bytes = vec![0_u8; required];
    // SAFETY: `bytes` is writable for exactly `required` bytes and confstr writes a
    // trailing NUL when the supplied buffer is large enough.
    let written = unsafe {
        libc::confstr(
            libc::_CS_DARWIN_USER_CACHE_DIR,
            bytes.as_mut_ptr().cast(),
            bytes.len(),
        )
    };
    if written != required || bytes.last() != Some(&0) {
        return Err(AcquireError::Unavailable);
    }

    bytes.pop();
    let path = PathBuf::from(std::ffi::OsStr::from_bytes(&bytes));
    validate_private_directory(&path)?;
    Ok(path)
}

fn validate_private_directory(path: &Path) -> Result<(), AcquireError> {
    if !path.is_absolute() {
        return Err(AcquireError::UnsafeLockFile);
    }
    let metadata = path
        .symlink_metadata()
        .map_err(|_| AcquireError::Unavailable)?;
    // SAFETY: `geteuid` takes no arguments and has no memory-safety preconditions.
    let effective_uid = unsafe { libc::geteuid() };
    if !metadata.file_type().is_dir()
        || metadata.uid() != effective_uid
        || metadata.mode() & 0o077 != 0
    {
        return Err(AcquireError::UnsafeLockFile);
    }
    Ok(())
}

fn acquire_at(path: PathBuf) -> Result<Guard, AcquireError> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(&path)
        .map_err(classify_open_error)?;
    validate_lock_file(&file)?;

    // SAFETY: `file` owns a live file descriptor for the lifetime of `Guard`.
    // `flock` does not dereference pointers and the operation is non-blocking.
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result == 0 {
        return Ok(Guard { _file: file });
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::EWOULDBLOCK) {
        Err(AcquireError::AlreadyRunning)
    } else {
        Err(AcquireError::Unavailable)
    }
}

fn classify_open_error(error: io::Error) -> AcquireError {
    if error.raw_os_error() == Some(libc::ELOOP) {
        AcquireError::UnsafeLockFile
    } else {
        AcquireError::Unavailable
    }
}

fn validate_lock_file(file: &File) -> Result<(), AcquireError> {
    let metadata = file.metadata().map_err(|_| AcquireError::Unavailable)?;
    // SAFETY: `geteuid` takes no arguments and has no memory-safety preconditions.
    let effective_uid = unsafe { libc::geteuid() };
    if !metadata.file_type().is_file()
        || metadata.uid() != effective_uid
        || metadata.nlink() != 1
        || metadata.mode() & 0o077 != 0
    {
        return Err(AcquireError::UnsafeLockFile);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::{symlink, PermissionsExt};

    fn test_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "com.yijie.ai.desktop.{label}.{}.lock",
            uuid::Uuid::now_v7()
        ))
    }

    fn remove(path: &Path) {
        let _ = fs::remove_file(path);
    }

    #[test]
    fn second_instance_is_rejected_until_the_first_exits() {
        let path = test_path("exclusive");
        let first = acquire_at(path.clone()).expect("first instance lock");
        assert!(matches!(
            acquire_at(path.clone()),
            Err(AcquireError::AlreadyRunning)
        ));
        drop(first);
        let replacement = acquire_at(path.clone()).expect("replacement instance lock");
        drop(replacement);
        remove(&path);
    }

    #[test]
    fn unsafe_existing_lock_file_is_rejected() {
        let path = test_path("permissions");
        fs::write(&path, b"").expect("create lock file");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644))
            .expect("widen lock permissions");
        assert!(matches!(
            acquire_at(path.clone()),
            Err(AcquireError::UnsafeLockFile)
        ));
        remove(&path);
    }

    #[test]
    fn symlink_lock_path_is_rejected() {
        let target = test_path("symlink-target");
        let link = test_path("symlink-link");
        fs::write(&target, b"").expect("create symlink target");
        symlink(&target, &link).expect("create lock symlink");
        assert!(matches!(
            acquire_at(link.clone()),
            Err(AcquireError::UnsafeLockFile)
        ));
        remove(&link);
        remove(&target);
    }

    #[test]
    fn hard_link_lock_path_is_rejected() {
        let target = test_path("hardlink-target");
        let link = test_path("hardlink-link");
        fs::write(&target, b"").expect("create hard-link target");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600))
            .expect("secure hard-link target");
        fs::hard_link(&target, &link).expect("create hard link");
        assert!(matches!(
            acquire_at(link.clone()),
            Err(AcquireError::UnsafeLockFile)
        ));
        remove(&link);
        remove(&target);
    }
}
