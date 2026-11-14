// Generated from skills/market-v2; DO NOT EDIT.
use serde::{Deserialize, Serialize};

fn optional_non_null<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Origin {
    #[serde(rename = "builtin")]
    Builtin,
    #[serde(rename = "user")]
    User,
    #[serde(rename = "unknown")]
    Unknown,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InstallState {
    #[serde(rename = "not_installed")]
    NotInstalled,
    #[serde(rename = "installed")]
    Installed,
    #[serde(rename = "partial")]
    Partial,
    #[serde(rename = "invalid")]
    Invalid,
    #[serde(rename = "unknown")]
    Unknown,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DependencyState {
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "missing")]
    Missing,
    #[serde(rename = "needs_authorization")]
    NeedsAuthorization,
    #[serde(rename = "unknown")]
    Unknown,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OperationState {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "complete")]
    Complete,
    #[serde(rename = "cancelled")]
    Cancelled,
    #[serde(rename = "needs_attention")]
    NeedsAttention,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MutationKind {
    #[serde(rename = "install")]
    Install,
    #[serde(rename = "enable")]
    Enable,
    #[serde(rename = "disable")]
    Disable,
    #[serde(rename = "uninstall")]
    Uninstall,
    #[serde(rename = "refresh")]
    Refresh,
    #[serde(rename = "rollback")]
    Rollback,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "FileEntryWire")]
pub struct FileEntry {
    pub path: String,
    pub sha256: String,
    pub bytes: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileEntryWire {
    pub path: String,
    pub sha256: String,
    pub bytes: i64,
}
impl TryFrom<FileEntryWire> for FileEntry {
    type Error = &'static str;
    fn try_from(w: FileEntryWire) -> Result<Self, Self::Error> {
        let v = Self {
            path: w.path,
            sha256: w.sha256,
            bytes: w.bytes,
        };
        v.validate()?;
        Ok(v)
    }
}
impl FileEntry {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_path = &self.path;
            if value_path.chars().count() > 1024 {
                return Err("invalid broker text");
            }
        }
        {
            let value_sha256 = &self.sha256;
            if value_sha256.chars().count() < 64 {
                return Err("invalid broker text");
            }
            if value_sha256.chars().count() > 64 {
                return Err("invalid broker text");
            }
            if value_sha256.len() != 64
                || !value_sha256
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("invalid digest");
            }
        }
        {
            let value_bytes = &self.bytes;
            if *value_bytes < 0 {
                return Err("invalid broker number");
            }
            if *value_bytes > 67108864 {
                return Err("invalid broker number");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for FileEntry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("FileEntry([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "CatalogSourceWire")]
pub struct CatalogSource {
    pub id: String,
    #[serde(rename = "content_version")]
    pub content_version: String,
    #[serde(rename = "content_sha256")]
    pub content_sha256: String,
    #[serde(rename = "source_revision")]
    pub source_revision: String,
    #[serde(rename = "native_package_version")]
    pub native_package_version: String,
    #[serde(rename = "plugin_name")]
    pub plugin_name: String,
    #[serde(rename = "display_name")]
    pub display_name: String,
    pub description: String,
    pub category: String,
    pub order: i64,
    #[serde(rename = "icon_key")]
    pub icon_key: String,
    #[serde(rename = "required_tools")]
    pub required_tools: Vec<String>,
    #[serde(rename = "source_path")]
    pub source_path: String,
    pub files: Vec<FileEntry>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogSourceWire {
    pub id: String,
    #[serde(rename = "content_version")]
    pub content_version: String,
    #[serde(rename = "content_sha256")]
    pub content_sha256: String,
    #[serde(rename = "source_revision")]
    pub source_revision: String,
    #[serde(rename = "native_package_version")]
    pub native_package_version: String,
    #[serde(rename = "plugin_name")]
    pub plugin_name: String,
    #[serde(rename = "display_name")]
    pub display_name: String,
    pub description: String,
    pub category: String,
    pub order: i64,
    #[serde(rename = "icon_key")]
    pub icon_key: String,
    #[serde(rename = "required_tools")]
    pub required_tools: Vec<String>,
    #[serde(rename = "source_path")]
    pub source_path: String,
    pub files: Vec<FileEntry>,
}
impl TryFrom<CatalogSourceWire> for CatalogSource {
    type Error = &'static str;
    fn try_from(w: CatalogSourceWire) -> Result<Self, Self::Error> {
        let v = Self {
            id: w.id,
            content_version: w.content_version,
            content_sha256: w.content_sha256,
            source_revision: w.source_revision,
            native_package_version: w.native_package_version,
            plugin_name: w.plugin_name,
            display_name: w.display_name,
            description: w.description,
            category: w.category,
            order: w.order,
            icon_key: w.icon_key,
            required_tools: w.required_tools,
            source_path: w.source_path,
            files: w.files,
        };
        v.validate()?;
        Ok(v)
    }
}
impl CatalogSource {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_id = &self.id;
            if value_id.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_id.chars().count() > 256 {
                return Err("invalid broker text");
            }
        }
        {
            let value_content_version = &self.content_version;
            if value_content_version.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_content_version.chars().count() > 64 {
                return Err("invalid broker text");
            }
        }
        {
            let value_content_sha256 = &self.content_sha256;
            if value_content_sha256.chars().count() < 64 {
                return Err("invalid broker text");
            }
            if value_content_sha256.chars().count() > 64 {
                return Err("invalid broker text");
            }
            if value_content_sha256.len() != 64
                || !value_content_sha256
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("invalid digest");
            }
        }
        {
            let value_source_revision = &self.source_revision;
            if value_source_revision.chars().count() < 64 {
                return Err("invalid broker text");
            }
            if value_source_revision.chars().count() > 64 {
                return Err("invalid broker text");
            }
            if value_source_revision.len() != 64
                || !value_source_revision
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("invalid digest");
            }
        }
        {
            let value_native_package_version = &self.native_package_version;
            if value_native_package_version.chars().count() > 64 {
                return Err("invalid broker text");
            }
        }
        {
            let value_plugin_name = &self.plugin_name;
            if value_plugin_name.chars().count() > 128 {
                return Err("invalid broker text");
            }
        }
        {
            let value_display_name = &self.display_name;
            if value_display_name.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_display_name.chars().count() > 256 {
                return Err("invalid broker text");
            }
        }
        {
            let value_description = &self.description;
            if value_description.chars().count() > 4096 {
                return Err("invalid broker text");
            }
        }
        {
            let value_category = &self.category;
            if value_category.chars().count() > 64 {
                return Err("invalid broker text");
            }
        }
        {
            let value_order = &self.order;
            if *value_order < 0 {
                return Err("invalid broker number");
            }
        }
        {
            let value_icon_key = &self.icon_key;
            if value_icon_key.chars().count() > 64 {
                return Err("invalid broker text");
            }
        }
        {
            let value_required_tools = &self.required_tools;
            if value_required_tools.len() > 128 {
                return Err("invalid broker collection");
            }
            for item in value_required_tools.iter() {
                if item.chars().count() > 256 {
                    return Err("invalid broker text");
                }
            }
        }
        {
            let value_source_path = &self.source_path;
            if value_source_path.chars().count() > 1024 {
                return Err("invalid broker text");
            }
        }
        {
            let value_files = &self.files;
            if value_files.len() > 2048 {
                return Err("invalid broker collection");
            }
            for item in value_files.iter() {
                item.validate()?;
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for CatalogSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CatalogSource([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "BundleWire")]
pub struct Bundle {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    #[serde(rename = "marketplace_name")]
    pub marketplace_name: String,
    pub skills: Vec<CatalogSource>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BundleWire {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    #[serde(rename = "marketplace_name")]
    pub marketplace_name: String,
    pub skills: Vec<CatalogSource>,
}
impl TryFrom<BundleWire> for Bundle {
    type Error = &'static str;
    fn try_from(w: BundleWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            marketplace_name: w.marketplace_name,
            skills: w.skills,
        };
        v.validate()?;
        Ok(v)
    }
}
impl Bundle {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 2 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_marketplace_name = &self.marketplace_name;
            if value_marketplace_name != "yijie-builtin" {
                return Err("invalid broker constant");
            }
        }
        {
            let value_skills = &self.skills;
            if value_skills.len() > 512 {
                return Err("invalid broker collection");
            }
            for item in value_skills.iter() {
                item.validate()?;
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for Bundle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Bundle([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SkillWire")]
pub struct Skill {
    pub id: String,
    pub version: String,
    #[serde(rename = "runtime_name")]
    pub runtime_name: String,
    #[serde(rename = "display_name")]
    pub display_name: String,
    pub description: String,
    pub category: String,
    pub order: i64,
    #[serde(rename = "icon_key")]
    pub icon_key: String,
    pub origin: Origin,
    #[serde(rename = "installation_state")]
    pub installation_state: InstallState,
    pub enabled: bool,
    #[serde(rename = "runtime_visible")]
    pub runtime_visible: bool,
    pub retired: bool,
    #[serde(rename = "dependency_state")]
    pub dependency_state: DependencyState,
    #[serde(rename = "required_tools")]
    pub required_tools: Vec<String>,
    pub epoch: i64,
    #[serde(rename = "failure_code")]
    pub failure_code: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SkillWire {
    pub id: String,
    pub version: String,
    #[serde(rename = "runtime_name")]
    pub runtime_name: String,
    #[serde(rename = "display_name")]
    pub display_name: String,
    pub description: String,
    pub category: String,
    pub order: i64,
    #[serde(rename = "icon_key")]
    pub icon_key: String,
    pub origin: Origin,
    #[serde(rename = "installation_state")]
    pub installation_state: InstallState,
    pub enabled: bool,
    #[serde(rename = "runtime_visible")]
    pub runtime_visible: bool,
    pub retired: bool,
    #[serde(rename = "dependency_state")]
    pub dependency_state: DependencyState,
    #[serde(rename = "required_tools")]
    pub required_tools: Vec<String>,
    pub epoch: i64,
    #[serde(rename = "failure_code")]
    pub failure_code: String,
}
impl TryFrom<SkillWire> for Skill {
    type Error = &'static str;
    fn try_from(w: SkillWire) -> Result<Self, Self::Error> {
        let v = Self {
            id: w.id,
            version: w.version,
            runtime_name: w.runtime_name,
            display_name: w.display_name,
            description: w.description,
            category: w.category,
            order: w.order,
            icon_key: w.icon_key,
            origin: w.origin,
            installation_state: w.installation_state,
            enabled: w.enabled,
            runtime_visible: w.runtime_visible,
            retired: w.retired,
            dependency_state: w.dependency_state,
            required_tools: w.required_tools,
            epoch: w.epoch,
            failure_code: w.failure_code,
        };
        v.validate()?;
        Ok(v)
    }
}
impl Skill {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_id = &self.id;
            if value_id.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_id.chars().count() > 256 {
                return Err("invalid broker text");
            }
        }
        {
            let value_version = &self.version;
            if value_version.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_version.chars().count() > 64 {
                return Err("invalid broker text");
            }
        }
        {
            let value_runtime_name = &self.runtime_name;
            if value_runtime_name.chars().count() > 512 {
                return Err("invalid broker text");
            }
        }
        {
            let value_display_name = &self.display_name;
            if value_display_name.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_display_name.chars().count() > 256 {
                return Err("invalid broker text");
            }
        }
        {
            let value_description = &self.description;
            if value_description.chars().count() > 4096 {
                return Err("invalid broker text");
            }
        }
        {
            let value_category = &self.category;
            if value_category.chars().count() > 64 {
                return Err("invalid broker text");
            }
        }
        {
            let value_order = &self.order;
            if *value_order < 0 {
                return Err("invalid broker number");
            }
        }
        {
            let value_icon_key = &self.icon_key;
            if value_icon_key.chars().count() > 64 {
                return Err("invalid broker text");
            }
        }
        {
            let value_required_tools = &self.required_tools;
            if value_required_tools.len() > 128 {
                return Err("invalid broker collection");
            }
            for item in value_required_tools.iter() {
                if item.chars().count() > 256 {
                    return Err("invalid broker text");
                }
            }
        }
        {
            let value_epoch = &self.epoch;
            if *value_epoch < 0 {
                return Err("invalid broker number");
            }
        }
        {
            let value_failure_code = &self.failure_code;
            if value_failure_code.chars().count() > 128 {
                return Err("invalid broker text");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for Skill {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Skill([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "CatalogWire")]
pub struct Catalog {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    pub revision: String,
    pub skills: Vec<Skill>,
    pub operations: Vec<PendingOperation>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub notice: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogWire {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    pub revision: String,
    pub skills: Vec<Skill>,
    pub operations: Vec<PendingOperation>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub notice: Option<String>,
}
impl TryFrom<CatalogWire> for Catalog {
    type Error = &'static str;
    fn try_from(w: CatalogWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            revision: w.revision,
            skills: w.skills,
            operations: w.operations,
            notice: w.notice,
        };
        v.validate()?;
        Ok(v)
    }
}
impl Catalog {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 2 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_revision = &self.revision;
            if value_revision.chars().count() < 64 {
                return Err("invalid broker text");
            }
            if value_revision.chars().count() > 64 {
                return Err("invalid broker text");
            }
            if value_revision.len() != 64
                || !value_revision
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("invalid digest");
            }
        }
        {
            let value_skills = &self.skills;
            if value_skills.len() > 1024 {
                return Err("invalid broker collection");
            }
            for item in value_skills.iter() {
                item.validate()?;
            }
        }
        {
            let value_operations = &self.operations;
            if value_operations.len() > 512 {
                return Err("invalid broker collection");
            }
            for item in value_operations.iter() {
                item.validate()?;
            }
        }
        self.notice
            .as_ref()
            .map(|value_notice| -> Result<(), &'static str> {
                if value_notice.chars().count() > 256 {
                    return Err("invalid broker text");
                }
                Ok(())
            })
            .transpose()?;
        Ok(())
    }
}
impl std::fmt::Debug for Catalog {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Catalog([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "MutationWire")]
pub struct Mutation {
    #[serde(rename = "operation_id")]
    pub operation_id: String,
    #[serde(rename = "skill_id")]
    pub skill_id: String,
    pub kind: MutationKind,
    #[serde(rename = "expected_epoch")]
    pub expected_epoch: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MutationWire {
    #[serde(rename = "operation_id")]
    pub operation_id: String,
    #[serde(rename = "skill_id")]
    pub skill_id: String,
    pub kind: MutationKind,
    #[serde(rename = "expected_epoch")]
    pub expected_epoch: i64,
}
impl TryFrom<MutationWire> for Mutation {
    type Error = &'static str;
    fn try_from(w: MutationWire) -> Result<Self, Self::Error> {
        let v = Self {
            operation_id: w.operation_id,
            skill_id: w.skill_id,
            kind: w.kind,
            expected_epoch: w.expected_epoch,
        };
        v.validate()?;
        Ok(v)
    }
}
impl Mutation {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if value_operation_id.chars().count() < 36 {
                return Err("invalid broker text");
            }
            if value_operation_id.chars().count() > 36 {
                return Err("invalid broker text");
            }
            if value_operation_id.len() != 36
                || !value_operation_id.bytes().enumerate().all(|(i, b)| {
                    if [8, 13, 18, 23].contains(&i) {
                        b == b'-'
                    } else {
                        b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
                    }
                })
            {
                return Err("invalid operation identity");
            }
            if value_operation_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_skill_id = &self.skill_id;
            if value_skill_id.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_skill_id.chars().count() > 256 {
                return Err("invalid broker text");
            }
        }
        {
            let value_expected_epoch = &self.expected_epoch;
            if *value_expected_epoch < 0 {
                return Err("invalid broker number");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for Mutation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Mutation([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ImportRequestWire")]
pub struct ImportRequest {
    #[serde(rename = "operation_id")]
    pub operation_id: String,
    #[serde(rename = "file_name")]
    pub file_name: String,
    pub format: String,
    pub sha256: String,
    pub bytes: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportRequestWire {
    #[serde(rename = "operation_id")]
    pub operation_id: String,
    #[serde(rename = "file_name")]
    pub file_name: String,
    pub format: String,
    pub sha256: String,
    pub bytes: i64,
}
impl TryFrom<ImportRequestWire> for ImportRequest {
    type Error = &'static str;
    fn try_from(w: ImportRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            operation_id: w.operation_id,
            file_name: w.file_name,
            format: w.format,
            sha256: w.sha256,
            bytes: w.bytes,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ImportRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if value_operation_id.chars().count() < 36 {
                return Err("invalid broker text");
            }
            if value_operation_id.chars().count() > 36 {
                return Err("invalid broker text");
            }
            if value_operation_id.len() != 36
                || !value_operation_id.bytes().enumerate().all(|(i, b)| {
                    if [8, 13, 18, 23].contains(&i) {
                        b == b'-'
                    } else {
                        b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
                    }
                })
            {
                return Err("invalid operation identity");
            }
            if value_operation_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_file_name = &self.file_name;
            if value_file_name.chars().count() > 256 {
                return Err("invalid broker text");
            }
        }
        {
            let value_format = &self.format;
            if !["zip", "markdown"].contains(&value_format.as_str()) {
                return Err("invalid broker enum");
            }
        }
        {
            let value_sha256 = &self.sha256;
            if value_sha256.chars().count() < 64 {
                return Err("invalid broker text");
            }
            if value_sha256.chars().count() > 64 {
                return Err("invalid broker text");
            }
            if value_sha256.len() != 64
                || !value_sha256
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("invalid digest");
            }
        }
        {
            let value_bytes = &self.bytes;
            if *value_bytes < 1 {
                return Err("invalid broker number");
            }
            if *value_bytes > 67108864 {
                return Err("invalid broker number");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for ImportRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ImportRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "OperationWire")]
pub struct Operation {
    #[serde(rename = "operation_id")]
    pub operation_id: String,
    pub state: OperationState,
    #[serde(rename = "skill_id")]
    pub skill_id: String,
    pub epoch: i64,
    #[serde(rename = "error_code")]
    pub error_code: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub catalog: Option<Catalog>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OperationWire {
    #[serde(rename = "operation_id")]
    pub operation_id: String,
    pub state: OperationState,
    #[serde(rename = "skill_id")]
    pub skill_id: String,
    pub epoch: i64,
    #[serde(rename = "error_code")]
    pub error_code: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub catalog: Option<Catalog>,
}
impl TryFrom<OperationWire> for Operation {
    type Error = &'static str;
    fn try_from(w: OperationWire) -> Result<Self, Self::Error> {
        let v = Self {
            operation_id: w.operation_id,
            state: w.state,
            skill_id: w.skill_id,
            epoch: w.epoch,
            error_code: w.error_code,
            catalog: w.catalog,
        };
        v.validate()?;
        Ok(v)
    }
}
impl Operation {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if value_operation_id.chars().count() < 36 {
                return Err("invalid broker text");
            }
            if value_operation_id.chars().count() > 36 {
                return Err("invalid broker text");
            }
            if value_operation_id.len() != 36
                || !value_operation_id.bytes().enumerate().all(|(i, b)| {
                    if [8, 13, 18, 23].contains(&i) {
                        b == b'-'
                    } else {
                        b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
                    }
                })
            {
                return Err("invalid operation identity");
            }
            if value_operation_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_skill_id = &self.skill_id;
            if value_skill_id.chars().count() > 256 {
                return Err("invalid broker text");
            }
        }
        {
            let value_epoch = &self.epoch;
            if *value_epoch < 0 {
                return Err("invalid broker number");
            }
        }
        {
            let value_error_code = &self.error_code;
            if value_error_code.chars().count() > 128 {
                return Err("invalid broker text");
            }
        }
        self.catalog
            .as_ref()
            .map(|value_catalog| -> Result<(), &'static str> {
                value_catalog.validate()?;
                Ok(())
            })
            .transpose()?;
        Ok(())
    }
}
impl std::fmt::Debug for Operation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Operation([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ErrorResponseWire")]
pub struct ErrorResponse {
    pub code: String,
    pub retryable: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ErrorResponseWire {
    pub code: String,
    pub retryable: bool,
}
impl TryFrom<ErrorResponseWire> for ErrorResponse {
    type Error = &'static str;
    fn try_from(w: ErrorResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            code: w.code,
            retryable: w.retryable,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ErrorResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_code = &self.code;
            if value_code.chars().count() > 128 {
                return Err("invalid broker text");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for ErrorResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ErrorResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PendingOperationWire")]
pub struct PendingOperation {
    #[serde(rename = "operation_id")]
    pub operation_id: String,
    pub state: OperationState,
    #[serde(rename = "skill_id")]
    pub skill_id: String,
    pub epoch: i64,
    #[serde(rename = "error_code")]
    pub error_code: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PendingOperationWire {
    #[serde(rename = "operation_id")]
    pub operation_id: String,
    pub state: OperationState,
    #[serde(rename = "skill_id")]
    pub skill_id: String,
    pub epoch: i64,
    #[serde(rename = "error_code")]
    pub error_code: String,
}
impl TryFrom<PendingOperationWire> for PendingOperation {
    type Error = &'static str;
    fn try_from(w: PendingOperationWire) -> Result<Self, Self::Error> {
        let v = Self {
            operation_id: w.operation_id,
            state: w.state,
            skill_id: w.skill_id,
            epoch: w.epoch,
            error_code: w.error_code,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PendingOperation {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if value_operation_id.chars().count() < 36 {
                return Err("invalid broker text");
            }
            if value_operation_id.chars().count() > 36 {
                return Err("invalid broker text");
            }
            if value_operation_id.len() != 36
                || !value_operation_id.bytes().enumerate().all(|(i, b)| {
                    if [8, 13, 18, 23].contains(&i) {
                        b == b'-'
                    } else {
                        b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
                    }
                })
            {
                return Err("invalid operation identity");
            }
            if value_operation_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_skill_id = &self.skill_id;
            if value_skill_id.chars().count() > 256 {
                return Err("invalid broker text");
            }
        }
        {
            let value_epoch = &self.epoch;
            if *value_epoch < 0 {
                return Err("invalid broker number");
            }
        }
        {
            let value_error_code = &self.error_code;
            if value_error_code.chars().count() > 128 {
                return Err("invalid broker text");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for PendingOperation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PendingOperation([redacted])")
    }
}

pub const MAX_CATALOG_RESPONSE_BYTES: usize = 268435456;
