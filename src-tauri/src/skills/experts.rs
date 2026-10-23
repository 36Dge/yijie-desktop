//! Safe expert catalog projections over the existing managed Skill runtime.
//! Callers own Native scope/admission authorization; no path/hash comes from UI.
use super::catalog::{SkillCatalog, SkillCatalogEntry};
use super::host::{validate_host_snapshot, SkillRuntime};
use crate::chat::experts::generated as wire;
use crate::chat::experts::store::ResolvedExpert;
use crate::chat::{ChatRuntime, HostManagedSkill, HostSkillSnapshot};

type Error = wire::ErrorCode;

impl SkillRuntime {
    /// Presentation metadata only; reading it never installs resources or starts Host.
    pub(crate) fn expert_developer(
        &self,
        selection: &wire::ExpertSelection,
    ) -> Result<wire::DeveloperInfo, Error> {
        selection.validate().map_err(|_| Error::InvalidRequest)?;
        self.expert_catalog_revision()?;
        let catalog = self.catalog().map_err(|error| error.expert_error())?;
        project_expert_developer(catalog, selection)
    }

    /// Only reviewed versions in distinct managed installation directories may
    /// coexist. Unknown retained references remain protected by the store.
    pub(crate) fn expert_coexisting_refs(
        &self,
        selection: &wire::ExpertSelection,
    ) -> Result<Vec<wire::ExpertRef>, Error> {
        let catalog = self.catalog().map_err(|error| error.expert_error())?;
        let selected = find_expert(catalog, selection)?;
        catalog
            .entries
            .iter()
            .filter(|entry| {
                entry.id != selected.id
                    && entry
                        .expert
                        .as_ref()
                        .is_some_and(|metadata| metadata.expert_id == selection.expert_id)
            })
            .map(|entry| resolve_entry(entry).map(|resolved| resolved.reference))
            .collect()
    }
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

fn project_expert_developer(
    catalog: &SkillCatalog,
    selection: &wire::ExpertSelection,
) -> Result<wire::DeveloperInfo, Error> {
    find_expert(catalog, selection)?;
    Ok(wire::DeveloperInfo {
        expert: selection.clone(),
        name: "易界 AI".into(),
    })
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
                && entry.version == selection.version
        })
        .ok_or_else(|| {
            if catalog.entries.iter().any(|entry| {
                entry
                    .expert
                    .as_ref()
                    .is_some_and(|value| value.expert_id == selection.expert_id)
            }) {
                Error::VersionUnavailable
            } else {
                Error::NotFound
            }
        })?;
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
        // Keep old versions resolvable for retained bindings while presenting
        // one current card. Use SemVer precedence, not string ordering.
        let version =
            semver::Version::parse(&entry.version).map_err(|_| Error::ResourceUnavailable)?;
        if catalog.entries.iter().any(|other| {
            other
                .expert
                .as_ref()
                .is_some_and(|value| value.expert_id == metadata.expert_id)
                && semver::Version::parse(&other.version).is_ok_and(|other| other > version)
        }) {
            continue;
        }
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
    experts.sort_by_key(|entry| {
        catalog
            .entries
            .iter()
            .find(|candidate| {
                candidate
                    .expert
                    .as_ref()
                    .is_some_and(|metadata| metadata.expert_id == entry.display.expert_id)
                    && candidate.version == entry.display.version
            })
            .map(|candidate| candidate.order)
            .unwrap_or(u16::MAX)
    });
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
        assert_eq!(catalog.entries.len(), 75);
        assert!(
            load_catalog(&roots).is_err(),
            "ordinary v2 loader must retain its original authority"
        );
        let snapshot = HostSkillSnapshot {
            catalog_revision: catalog.revision.clone(),
            scanned_at: "2026-10-16T00:00:00Z".into(),
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
        let expected = [
            ("chuhaijiang-tiktok-shop-operations-expert", "0.1.0"),
            ("linkfox-expert-aigc-imagegen-mannequin-to-model", "0.1.0"),
            ("linkfox-expert-aigc-videogen-viral-replicate", "0.1.0"),
            ("linkfox-expert-aigc-videogen-sale", "0.1.0"),
            ("moss-industry-research", "0.1.1"),
            ("equity-research", "0.1.2"),
            ("strategy-backtest-expert", "0.1.1"),
            ("linkfox-expert-1688-sourcing-expert", "0.1.0"),
            ("market-researcher", "0.1.0"),
            ("product-management", "0.1.0"),
            ("novel-creator", "0.1.0"),
            ("data-analyst-pro", "0.1.2"),
            ("ui-designer", "0.1.1"),
            ("tb-tm-ops-expert", "0.1.3"),
            ("pdd-ops-expert", "0.1.3"),
            ("tradebuddy-baojia", "0.1.0"),
            ("report-viz-expert", "0.1.1"),
            ("jd-ops-expert", "0.1.3"),
            ("xiaohongshu-copywriter", "0.1.1"),
            ("agentgrid-comic-storyboard-director", "0.1.0"),
            ("cross-border-ecommerce-operations-expert", "0.1.1"),
        ];
        assert_eq!(safe.experts.len(), expected.len());
        assert_eq!(
            safe.experts
                .iter()
                .map(|entry| (
                    entry.display.expert_id.as_str(),
                    entry.display.version.as_str()
                ))
                .collect::<std::collections::BTreeSet<_>>(),
            expected.into_iter().collect()
        );
        assert!(safe.can_manage && safe.execution_available);
        for (expert_id, version) in expected {
            let entry = find_expert(
                &catalog,
                &wire::ExpertSelection {
                    expert_id: expert_id.into(),
                    version: version.into(),
                },
            )
            .unwrap();
            let selection = wire::ExpertSelection {
                expert_id: expert_id.into(),
                version: version.into(),
            };
            let developer = project_expert_developer(&catalog, &selection).unwrap();
            developer.validate().unwrap();
            assert_eq!(developer.expert, selection);
            assert_eq!(developer.name, "易界 AI");
            let resolved = resolve_entry(entry).unwrap();
            let projected = safe
                .experts
                .iter()
                .find(|item| item.display.expert_id == expert_id)
                .unwrap();
            assert_eq!(projected.state, wire::ResourceState::Ready);
            assert!(projected.error_code.is_none());
            assert_eq!(resolved.reference.expert_id, expert_id);
            assert_eq!(resolved.reference.version, version);
            assert_eq!(resolved.display, projected.display);
        }
        let raw = serde_json::to_string(&safe).unwrap();
        for private_field in [
            "archiveSha256",
            "roleSha256",
            "knowledgeManifestSha256",
            "ROLE.md",
            "references/",
            "scripts/",
            "source_dir",
            "install_root",
        ] {
            assert!(!raw.contains(private_field));
        }
        let entry = find_expert(
            &catalog,
            &wire::ExpertSelection {
                expert_id: "jd-ops-expert".into(),
                version: "0.1.3".into(),
            },
        )
        .unwrap();
        let resolved = resolve_entry(entry).unwrap();
        // These are the retained jd@0.1.3 identities from the previous daily
        // bundle; adding experts must not invalidate existing history bindings.
        assert_eq!(
            resolved.reference.archive_sha256,
            "baa8c8550b8b82b5f1be7bcfc59693c8920ff438fa854e84450936685e3d3b80"
        );
        assert_eq!(
            resolved.reference.role_sha256,
            "a644bf12c4573895d3e6edc7b7a619cc95cc429c910260a5ef16b5f2bce7b6f5"
        );
        assert_eq!(
            resolved.reference.knowledge_manifest_sha256,
            "b0718d43a248bdf4dbcebec5623932266a87e7e4f78aad3dbe01e250b6545d08"
        );
    }
}
