//! App-owned, versioned first-use progress. This is not an installation receipt;
//! Host remains the only installer and authority for enabled/runtime state.
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub(super) const STARTER_SKILLS: [&str; 7] = [
    "yijie.sourcing-selection.sales-negotiator",
    "yijie.content-marketing.copywriting",
    "yijie.content-marketing.social-media-content-creator",
    "yijie.content-marketing.xiaohongshu-content-creator",
    "yijie.traffic-advertising.amazon-listing-expert",
    "yijie.traffic-advertising.ecommerce-seo-optimizer",
    "yijie.store-operations.invoice-generator",
];

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StarterProgress {
    version: u8,
    completed: BTreeSet<String>,
}

impl StarterProgress {
    fn path(install_root: &Path) -> io::Result<PathBuf> {
        let parent = install_root
            .parent()
            .ok_or_else(|| io::Error::other("missing skill root"))?;
        Ok(parent.join("starter-skills-v1.json"))
    }

    pub(super) fn load(install_root: &Path) -> io::Result<Self> {
        let path = Self::path(install_root)?;
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(Self {
                    version: 1,
                    completed: BTreeSet::new(),
                });
            }
            Err(error) => return Err(error),
            Ok(metadata) if !metadata.is_file() || metadata.len() > 8192 => {
                return Err(io::Error::other("invalid starter skill progress"));
            }
            Ok(_) => {}
        }
        let progress: Self = serde_json::from_slice(&fs::read(path)?)?;
        if progress.version != 1 {
            return Err(io::Error::other("unsupported starter skill progress"));
        }
        Ok(progress)
    }

    pub(super) fn contains(&self, id: &str) -> bool {
        self.completed.contains(id)
    }

    pub(super) fn complete(&mut self, install_root: &Path, id: &str) -> io::Result<()> {
        if !STARTER_SKILLS.contains(&id) || self.contains(id) {
            return Ok(());
        }
        self.completed.insert(id.to_owned());
        let path = Self::path(install_root)?;
        let temporary =
            path.with_file_name(format!(".starter-skills-{}.tmp", uuid::Uuid::now_v7()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let result = (|| {
            let mut file = options.open(&temporary)?;
            file.write_all(&serde_json::to_vec(self)?)?;
            file.sync_all()?;
            fs::rename(&temporary, &path)?;
            // Persist the rename before releasing the operation lock.
            fs::File::open(
                path.parent()
                    .ok_or_else(|| io::Error::other("missing progress parent"))?,
            )?
            .sync_all()
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
            self.completed.remove(id);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starter_progress_resumes_partial_initialization_and_preserves_removal() {
        let root =
            std::env::temp_dir().join(format!("yijie-starter-skills-{}", uuid::Uuid::now_v7()));
        let installed = root.join("installed");
        fs::create_dir_all(&installed).unwrap();
        let mut progress = StarterProgress::load(&installed).unwrap();
        assert!(!progress.contains(STARTER_SKILLS[0]));
        progress.complete(&installed, STARTER_SKILLS[0]).unwrap();
        let mut resumed = StarterProgress::load(&installed).unwrap();
        assert!(resumed.contains(STARTER_SKILLS[0]));
        assert!(!resumed.contains(STARTER_SKILLS[1]));
        // A handled item stays complete even when no installation exists.
        resumed.complete(&installed, STARTER_SKILLS[0]).unwrap();
        for id in STARTER_SKILLS {
            resumed.complete(&installed, id).unwrap();
        }
        assert_eq!(
            StarterProgress::load(&installed).unwrap().completed.len(),
            7
        );
        fs::remove_dir_all(root).unwrap();
    }
}
