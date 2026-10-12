//! Safe expert catalog projections over the existing managed Skill runtime.
//! Callers own Native scope/admission authorization; no path/hash comes from UI.
use super::catalog::{SkillCatalog, SkillCatalogEntry};
use super::host::{validate_host_snapshot, SkillRuntime};
use crate::chat::experts::generated as wire;
use crate::chat::experts::store::ResolvedExpert;
use crate::chat::{ChatRuntime, HostManagedSkill, HostSkillSnapshot};

type Error = wire::ErrorCode;

impl SkillRuntime {
    pub(crate) fn expert_catalog_revision(&self) -> Result<&str, Error> {
        let catalog = self.catalog().map_err(|error| error.expert_error())?;
        if !catalog.entries.iter().any(|entry| entry.expert.is_some()) {
            return Err(Error::QualificationRequired);
        }
        Ok(&catalog.revision)
    }

    pub(crate) async fn expert_catalog(
        &self,
        chat: &ChatRuntime,
        can_manage: bool,
        execution_available: bool,
    ) -> Result<wire::CatalogSnapshot, Error> {
        self.expert_catalog_revision()?;
        let catalog = self.catalog().map_err(|error| error.expert_error())?;
        let host = self
            .host(chat)
            .await
            .map_err(|error| error.expert_error())?;
        let snapshot = host
            .list_managed_skills()
            .await
            .map_err(|_| Error::ResourceUnavailable)?;
        project_expert_catalog(catalog, &snapshot, can_manage, execution_available)
    }

    /// Resolve a trusted exact reference from Native metadata and the current
    /// Host receipt projection. Host re-hashes content before each actual apply
    /// or turn, so this view never grants a caller-provided role or file path.
    pub(crate) async fn expert_resolve(
        &self,
        chat: &ChatRuntime,
        selection: &wire::ExpertSelection,
    ) -> Result<ResolvedExpert, Error> {
        selection.validate().map_err(|_| Error::InvalidRequest)?;
        self.expert_catalog_revision()?;
        let catalog = self.catalog().map_err(|error| error.expert_error())?;
        let entry = find_expert(catalog, selection)?;
        let host = self
            .host(chat)
            .await
            .map_err(|error| error.expert_error())?;
        let snapshot = host
            .list_managed_skills()
            .await
            .map_err(|_| Error::ResourceUnavailable)?;
        validate_host_snapshot(catalog, &snapshot).map_err(|_| Error::ResourceUnavailable)?;
        let state = snapshot
            .skills
            .iter()
            .find(|state| state.id == entry.id)
            .ok_or(Error::ResourceUnavailable)?;
        if resource_state(entry, state).0 != wire::ResourceState::Ready {
            return Err(resource_state(entry, state)
                .1
                .unwrap_or(Error::ResourceUnavailable));
        }
        resolve_entry(entry)
    }
}

fn find_expert<'a>(
    catalog: &'a SkillCatalog,
    selection: &wire::ExpertSelection,
) -> Result<&'a SkillCatalogEntry, Error> {
    let entry = catalog
        .entries
        .iter()
        .find(|entry| {
            entry
                .expert
                .as_ref()
                .is_some_and(|metadata| metadata.expert_id == selection.expert_id)
        })
        .ok_or(Error::NotFound)?;
    if entry.version != selection.version {
        return Err(Error::VersionUnavailable);
    }
    Ok(entry)
}
fn resolve_entry(entry: &SkillCatalogEntry) -> Result<ResolvedExpert, Error> {
    let metadata = entry.expert.as_ref().ok_or(Error::NotFound)?;
    let reference = wire::ExpertRef {
        expert_id: metadata.expert_id.clone(),
        version: entry.version.clone(),
        archive_sha256: entry
            .archive_sha256
            .clone()
            .ok_or(Error::ResourceUnavailable)?,
        role_sha256: metadata.role_resource.sha256.clone(),
        knowledge_manifest_sha256: wire::knowledge_manifest_digest(&metadata.knowledge_resources)
            .map_err(|_| Error::ResourceUnavailable)?,
    };
    reference
        .validate()
        .map_err(|_| Error::ResourceUnavailable)?;
    let display = wire::ExpertDisplay {
        expert_id: metadata.expert_id.clone(),
        version: entry.version.clone(),
        display_name: entry.display_name.clone(),
        subtitle: metadata.subtitle.clone(),
        icon_key: entry.icon_key.clone(),
    };
    display.validate().map_err(|_| Error::ResourceUnavailable)?;
    Ok(ResolvedExpert { reference, display })
}
fn resource_state(
    entry: &SkillCatalogEntry,
    state: &HostManagedSkill,
) -> (wire::ResourceState, Option<Error>) {
    if state.runtime_visible {
        return (
            wire::ResourceState::Incompatible,
            Some(Error::UnsupportedCapability),
        );
    }
    match state.installation_status.as_str() {
        "not_installed" => (wire::ResourceState::Available, None),
        "installed" if state.version != entry.version => (
            wire::ResourceState::Incompatible,
            Some(Error::VersionUnavailable),
        ),
        "installed" if state.enabled => (wire::ResourceState::Ready, None),
        _ => (
            wire::ResourceState::Unavailable,
            Some(Error::ResourceUnavailable),
        ),
    }
}
fn project_expert_catalog(
    catalog: &SkillCatalog,
    snapshot: &HostSkillSnapshot,
    can_manage: bool,
    execution_available: bool,
) -> Result<wire::CatalogSnapshot, Error> {
    validate_host_snapshot(catalog, snapshot).map_err(|_| Error::ResourceUnavailable)?;
    let mut experts = Vec::new();
    for entry in catalog
        .entries
        .iter()
        .filter(|entry| entry.expert.is_some())
    {
        let metadata = entry.expert.as_ref().ok_or(Error::ResourceUnavailable)?;
        let state = snapshot
            .skills
            .iter()
            .find(|state| state.id == entry.id)
            .ok_or(Error::ResourceUnavailable)?;
        let (state, error_code) = resource_state(entry, state);
        experts.push(wire::CatalogEntry {
            display: resolve_entry(entry)?.display,
            description: entry.description.clone(),
            platform: metadata.platform.clone(),
            tags: metadata.tags.clone(),
            quick_prompts: metadata.quick_prompts.clone(),
            knowledge_summary: metadata.knowledge_summary.clone(),
            state,
            error_code,
            operation: None,
        });
    }
    let result = wire::CatalogSnapshot {
        experts,
        can_manage,
        execution_available,
    };
    result.validate().map_err(|_| Error::ResourceUnavailable)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills::catalog::{load_catalog, load_expert_catalog};
    use crate::skills::host::merge_snapshot;
    use crate::skills::SkillRoots;
    use std::path::PathBuf;

    #[test]
    fn feat158_actual_candidate_projects_separate_safe_catalog_and_exact_reference() {
        let Some(bundle_root) = std::env::var_os("YIJIE_DESKTOP_EXPERT_BUNDLE_TEST_ROOT") else {
            return;
        };
        let roots = SkillRoots {
            bundle_root: PathBuf::from(bundle_root),
            install_root: PathBuf::new(),
        };
        let catalog = load_expert_catalog(&roots).expect("reviewed local v3 candidate");
        assert_eq!(catalog.entries.len(), 39);
        assert!(
            load_catalog(&roots).is_err(),
            "ordinary v2 loader must retain its original authority"
        );
        let snapshot = HostSkillSnapshot {
            catalog_revision: catalog.revision.clone(),
            scanned_at: "2026-10-11T00:00:00Z".into(),
            skills: catalog
                .entries
                .iter()
                .map(|entry| HostManagedSkill {
                    id: entry.id.clone(),
                    runtime_name: entry.runtime_name.clone(),
                    version: entry.version.clone(),
                    catalog_status: entry.catalog_status.clone(),
                    catalog_blocked_reason: entry.catalog_blocked_reason.clone(),
                    maintenance_status: entry.maintenance_status.clone(),
                    capability_readiness: "ready".into(),
                    installation_status: "installed".into(),
                    enabled: true,
                    runtime_visible: entry.expert.is_none(),
                    failure_code: String::new(),
                })
                .collect(),
        };
        let ordinary = merge_snapshot(&catalog, snapshot.clone()).unwrap();
        assert_eq!(
            serde_json::to_value(ordinary).unwrap()["skills"]
                .as_array()
                .unwrap()
                .len(),
            38
        );
        let safe = project_expert_catalog(&catalog, &snapshot, true, true).unwrap();
        assert_eq!(safe.experts.len(), 1);
        assert_eq!(safe.experts[0].state, wire::ResourceState::Ready);
        let raw = serde_json::to_string(&safe).unwrap();
        for private_field in [
            "archiveSha256",
            "roleSha256",
            "knowledgeManifestSha256",
            "ROLE.md",
            "references/",
        ] {
            assert!(!raw.contains(private_field));
        }
        let entry = find_expert(
            &catalog,
            &wire::ExpertSelection {
                expert_id: "jd-ops-expert".into(),
                version: "0.1.0".into(),
            },
        )
        .unwrap();
        let resolved = resolve_entry(entry).unwrap();
        assert_eq!(
            resolved.reference.role_sha256,
            "7173636f07506ce525c15af7b6fc29b564536c3be41798ac614714a26b4c70f0"
        );
        assert_eq!(
            resolved.reference.knowledge_manifest_sha256,
            "a9a8b3fd47188e66e0d5489ccbdebd2e60c643f34fde92502eaa3a76958cb483"
        );
    }
}
