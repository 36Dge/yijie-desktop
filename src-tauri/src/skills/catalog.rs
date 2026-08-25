use super::SkillRoots;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug)]
pub(super) struct SkillCatalog {
    pub revision: String,
    pub entries: Vec<SkillCatalogEntry>,
}

#[derive(Clone, Debug)]
pub(super) struct SkillCatalogEntry {
    pub id: String,
    pub runtime_name: String,
    pub category: String,
    pub order: u16,
    pub display_name: String,
    pub description: String,
    pub version: String,
    pub icon_key: String,
    pub risk_level: String,
    pub risk_reasons: Vec<String>,
    pub source_type: String,
    pub license_expression: String,
    pub execution_mode: String,
    pub network_access: String,
    pub filesystem_access: String,
    pub required_tools: Vec<String>,
    pub catalog_status: String,
    pub maintenance_status: String,
    pub archive_sha256: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CatalogError {
    Unavailable,
    Invalid,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BundleManifest {
    schema_version: u8,
    bundle_id: String,
    bundle_version: String,
    distribution_channel: String,
    source: BundleSource,
    skills: Vec<ManifestSkill>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BundleSource {
    repository: String,
    revision_kind: String,
    revision: String,
    tree_sha256: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestSkill {
    id: String,
    runtime_name: String,
    category: String,
    order: u16,
    display_name: String,
    description: String,
    version: String,
    entrypoint: String,
    icon: ManifestIcon,
    risk: ManifestRisk,
    provenance: ManifestProvenance,
    license: ManifestLicense,
    capabilities: ManifestCapabilities,
    archive: ManifestArchive,
    release: ManifestRelease,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestIcon {
    registry: String,
    key: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestRisk {
    level: String,
    reasons: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestProvenance {
    source_type: String,
    source_reference: String,
    source_version: String,
    source_sha256: String,
    review_status: String,
    reviewed_by: String,
    reviewed_at: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestLicense {
    expression: String,
    redistribution_status: String,
    authorization_scope: String,
    evidence_reference: String,
    reviewed_by: String,
    reviewed_at: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestCapabilities {
    execution_mode: String,
    network: String,
    filesystem: String,
    required_tools: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestArchive {
    path: String,
    sha256: String,
    compressed_size_bytes: u64,
    uncompressed_size_bytes: u64,
    file_count: u16,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestRelease {
    catalog_status: String,
    maintenance_status: String,
}

pub(super) fn load_catalog(roots: &SkillRoots) -> Result<SkillCatalog, CatalogError> {
    let manifest_path = roots.bundle_root.join("bundle-manifest.json");
    let metadata = fs::symlink_metadata(&manifest_path).map_err(|_| CatalogError::Unavailable)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > MAX_MANIFEST_BYTES
    {
        return Err(CatalogError::Invalid);
    }
    let bytes = fs::read(&manifest_path).map_err(|_| CatalogError::Unavailable)?;
    if bytes.len() as u64 != metadata.len() {
        return Err(CatalogError::Invalid);
    }
    let revision = format!("{:x}", Sha256::digest(&bytes));
    let manifest: BundleManifest =
        serde_json::from_slice(&bytes).map_err(|_| CatalogError::Invalid)?;
    validate_manifest(&manifest, &roots.bundle_root)?;

    let entries = manifest
        .skills
        .into_iter()
        .map(|skill| SkillCatalogEntry {
            id: skill.id,
            runtime_name: skill.runtime_name,
            category: skill.category,
            order: skill.order,
            display_name: skill.display_name,
            description: skill.description,
            version: skill.version,
            icon_key: skill.icon.key,
            risk_level: skill.risk.level,
            risk_reasons: skill.risk.reasons,
            source_type: skill.provenance.source_type,
            license_expression: skill.license.expression,
            execution_mode: skill.capabilities.execution_mode,
            network_access: skill.capabilities.network,
            filesystem_access: skill.capabilities.filesystem,
            required_tools: skill.capabilities.required_tools,
            catalog_status: skill.release.catalog_status,
            maintenance_status: skill.release.maintenance_status,
            archive_sha256: skill.archive.sha256,
        })
        .collect();
    Ok(SkillCatalog { revision, entries })
}

fn validate_manifest(manifest: &BundleManifest, bundle_root: &Path) -> Result<(), CatalogError> {
    if manifest.schema_version != 1
        || manifest.bundle_id != "yijie.desktop.skill-packages"
        || !valid_semantic_version(&manifest.bundle_version)
        || !matches!(
            manifest.distribution_channel.as_str(),
            "local-development" | "desktop-release"
        )
        || manifest.source.repository.is_empty()
        || !matches!(
            manifest.source.revision_kind.as_str(),
            "git-commit" | "working-tree"
        )
        || !valid_hex(&manifest.source.revision, 40)
        || !valid_hex(&manifest.source.tree_sha256, 64)
        || manifest.skills.is_empty()
        || manifest.skills.len() > 256
    {
        return Err(CatalogError::Invalid);
    }

    let mut ids = HashSet::with_capacity(manifest.skills.len());
    let mut runtime_names = HashSet::with_capacity(manifest.skills.len());
    for skill in &manifest.skills {
        if !ids.insert(skill.id.as_str())
            || !runtime_names.insert(skill.runtime_name.as_str())
            || !validate_skill(skill, &manifest.distribution_channel)
        {
            return Err(CatalogError::Invalid);
        }
        validate_archive(bundle_root, &skill.archive)?;
    }
    Ok(())
}

fn validate_skill(skill: &ManifestSkill, distribution_channel: &str) -> bool {
    valid_skill_id(&skill.id)
        && valid_runtime_name(&skill.runtime_name)
        && matches!(
            skill.category.as_str(),
            "sourcing-selection"
                | "market-research"
                | "content-marketing"
                | "traffic-advertising"
                | "store-operations"
        )
        && skill.order <= 10_000
        && bounded_text(&skill.display_name, 80)
        && bounded_text(&skill.description, 240)
        && valid_semantic_version(&skill.version)
        && skill.entrypoint == "SKILL.md"
        && skill.icon.registry == "yj-icon-v1"
        && valid_icon_key(&skill.icon.key)
        && matches!(
            skill.risk.level.as_str(),
            "low" | "medium" | "high" | "critical"
        )
        && (1..=8).contains(&skill.risk.reasons.len())
        && skill
            .risk
            .reasons
            .iter()
            .all(|value| bounded_text(value, 160))
        && matches!(
            skill.provenance.source_type.as_str(),
            "internal" | "partner" | "third-party"
        )
        && valid_relative_reference(&skill.provenance.source_reference)
        && valid_semantic_version(&skill.provenance.source_version)
        && valid_hex(&skill.provenance.source_sha256, 64)
        && skill.provenance.review_status == "verified"
        && bounded_text(&skill.provenance.reviewed_by, 128)
        && valid_date_time(&skill.provenance.reviewed_at)
        && bounded_text(&skill.license.expression, 128)
        && skill.license.redistribution_status == "verified"
        && matches!(
            skill.license.authorization_scope.as_str(),
            "local-development" | "desktop-distribution"
        )
        && (distribution_channel != "desktop-release"
            || skill.license.authorization_scope == "desktop-distribution")
        && valid_relative_reference(&skill.license.evidence_reference)
        && bounded_text(&skill.license.reviewed_by, 128)
        && valid_date_time(&skill.license.reviewed_at)
        && matches!(
            skill.capabilities.execution_mode.as_str(),
            "model-only" | "tool-assisted"
        )
        && matches!(
            skill.capabilities.network.as_str(),
            "none" | "optional" | "required"
        )
        && matches!(
            skill.capabilities.filesystem.as_str(),
            "none" | "read" | "write"
        )
        && skill.capabilities.required_tools.len() <= 32
        && (skill.capabilities.execution_mode != "model-only"
            || (skill.capabilities.network == "none"
                && skill.capabilities.filesystem == "none"
                && skill.capabilities.required_tools.is_empty()))
        && matches!(
            skill.release.catalog_status.as_str(),
            "installable" | "blocked"
        )
        && matches!(
            skill.release.maintenance_status.as_str(),
            "maintained" | "unmaintained"
        )
        && skill.archive.compressed_size_bytes > 0
        && skill.archive.compressed_size_bytes <= 67_108_864
        && skill.archive.uncompressed_size_bytes > 0
        && skill.archive.uncompressed_size_bytes <= 67_108_864
        && skill.archive.file_count > 0
        && skill.archive.file_count <= 2_048
}

fn validate_archive(bundle_root: &Path, archive: &ManifestArchive) -> Result<(), CatalogError> {
    if !valid_archive_path(&archive.path) || !valid_hex(&archive.sha256, 64) {
        return Err(CatalogError::Invalid);
    }
    let path = bundle_root.join(&archive.path);
    if !path.starts_with(bundle_root) {
        return Err(CatalogError::Invalid);
    }
    let metadata = fs::symlink_metadata(&path).map_err(|_| CatalogError::Unavailable)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() != archive.compressed_size_bytes
    {
        return Err(CatalogError::Invalid);
    }
    let bytes = fs::read(path).map_err(|_| CatalogError::Unavailable)?;
    if bytes.len() as u64 != archive.compressed_size_bytes
        || format!("{:x}", Sha256::digest(&bytes)) != archive.sha256
    {
        return Err(CatalogError::Invalid);
    }
    Ok(())
}

fn bounded_text(value: &str, maximum: usize) -> bool {
    !value.trim().is_empty() && value.len() <= maximum && !value.contains(['\0', '\r'])
}

fn valid_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn valid_skill_id(value: &str) -> bool {
    valid_segmented_lower(value, 3, 128, &['.', '-'], true)
}

fn valid_runtime_name(value: &str) -> bool {
    valid_segmented_lower(value, 1, 64, &['-'], false)
}

fn valid_segmented_lower(
    value: &str,
    minimum: usize,
    maximum: usize,
    separators: &[char],
    first_letter: bool,
) -> bool {
    if !(minimum..=maximum).contains(&value.len()) || !value.is_ascii() {
        return false;
    }
    if first_letter && !value.as_bytes()[0].is_ascii_lowercase() {
        return false;
    }
    value.split(separators).all(|part| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    })
}

fn valid_icon_key(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value.is_ascii()
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn valid_relative_reference(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && !value.starts_with('/')
        && !value.contains('\\')
        && !value.contains('\0')
        && !value.split('/').any(|part| part == "..")
}

fn valid_archive_path(value: &str) -> bool {
    value.starts_with("packages/")
        && value.ends_with(".zip")
        && valid_relative_reference(value)
        && value.len() <= 240
}

fn valid_date_time(value: &str) -> bool {
    value.len() >= 20 && value.len() <= 64 && value.ends_with('Z') && value.contains('T')
}

fn valid_semantic_version(value: &str) -> bool {
    let (without_build, build) = match value.split_once('+') {
        Some((head, tail)) if !tail.is_empty() && !tail.contains('+') => (head, Some(tail)),
        Some(_) => return false,
        None => (value, None),
    };
    let (core, prerelease) = match without_build.split_once('-') {
        Some((head, tail)) if !tail.is_empty() => (head, Some(tail)),
        Some(_) => return false,
        None => (without_build, None),
    };
    let parts = core.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts.into_iter().all(valid_number)
        && prerelease.is_none_or(|value| valid_identifiers(value, true))
        && build.is_none_or(|value| valid_identifiers(value, false))
}

fn valid_number(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && (value == "0" || !value.starts_with('0'))
}

fn valid_identifiers(value: &str, reject_numeric_leading_zero: bool) -> bool {
    value.split('.').all(|part| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            && (!reject_numeric_leading_zero
                || !part.bytes().all(|byte| byte.is_ascii_digit())
                || part == "0"
                || !part.starts_with('0'))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semantic_version_and_identifiers_are_closed() {
        for value in ["0.1.0", "1.2.3-alpha.1", "1.2.3+desktop.1"] {
            assert!(valid_semantic_version(value));
        }
        for value in ["01.0.0", "1.0", "1.0.0-01", "1.0.0+"] {
            assert!(!valid_semantic_version(value));
        }
        assert!(valid_skill_id("yijie.content-marketing.copywriting"));
        assert!(!valid_skill_id("../copywriting"));
    }
}
