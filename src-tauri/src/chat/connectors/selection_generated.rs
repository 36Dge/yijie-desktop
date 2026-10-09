// Generated from market-selection source; DO NOT EDIT.
pub use super::generated::SelectionRef;
pub use crate::chat::models_generated::ProfileId;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
fn optional_non_null<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}
fn required_nullable<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d)
}
fn canonical_id(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && s != "00000000-0000-0000-0000-000000000000"
        && b.iter().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                *c == b'-'
            } else {
                c.is_ascii_digit() || (*c >= b'a' && *c <= b'f')
            }
        })
}
pub type CanonicalId = String;
pub type ModelRevision = i64;
pub type SelectionDigest = String;
pub type Selection = Vec<SelectionRef>;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ModelIntentWire")]
pub struct ModelIntent {
    pub profile_id: ProfileId,
    pub expected_revision: ModelRevision,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ModelIntentWire {
    pub profile_id: ProfileId,
    pub expected_revision: ModelRevision,
}
impl TryFrom<ModelIntentWire> for ModelIntent {
    type Error = &'static str;
    fn try_from(w: ModelIntentWire) -> Result<Self, Self::Error> {
        let v = Self {
            profile_id: w.profile_id,
            expected_revision: w.expected_revision,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ModelIntent {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_expected_revision = &self.expected_revision;
            if *value_expected_revision < 0 {
                return Err("invalid selection integer");
            }
            if *value_expected_revision > 9007199254740991 {
                return Err("invalid selection integer");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for ModelIntent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ModelIntent([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "TextInputWire")]
pub struct TextInput {
    pub r#type: String,
    pub text: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TextInputWire {
    pub r#type: String,
    pub text: String,
}
impl TryFrom<TextInputWire> for TextInput {
    type Error = &'static str;
    fn try_from(w: TextInputWire) -> Result<Self, Self::Error> {
        let v = Self {
            r#type: w.r#type,
            text: w.text,
        };
        v.validate()?;
        Ok(v)
    }
}
impl TextInput {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_type = &self.r#type;
            if value_type != "text" {
                return Err("invalid selection constant");
            }
        }
        {
            let value_text = &self.text;
            if value_text.chars().count() < 1 {
                return Err("invalid selection text");
            }
            if value_text.chars().count() > 1048576 {
                return Err("invalid selection text");
            }
            if value_text.trim().is_empty() {
                return Err("blank selection input");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for TextInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TextInput([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "FileInputWire")]
pub struct FileInput {
    pub r#type: String,
    pub attachment_id: CanonicalId,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileInputWire {
    pub r#type: String,
    pub attachment_id: CanonicalId,
}
impl TryFrom<FileInputWire> for FileInput {
    type Error = &'static str;
    fn try_from(w: FileInputWire) -> Result<Self, Self::Error> {
        let v = Self {
            r#type: w.r#type,
            attachment_id: w.attachment_id,
        };
        v.validate()?;
        Ok(v)
    }
}
impl FileInput {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_type = &self.r#type;
            if value_type != "file" {
                return Err("invalid selection constant");
            }
        }
        {
            let value_attachment_id = &self.attachment_id;
            if !canonical_id(value_attachment_id) {
                return Err("invalid selection UUID");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for FileInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("FileInput([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ImageInputWire")]
pub struct ImageInput {
    pub r#type: String,
    pub attachment_id: CanonicalId,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImageInputWire {
    pub r#type: String,
    pub attachment_id: CanonicalId,
}
impl TryFrom<ImageInputWire> for ImageInput {
    type Error = &'static str;
    fn try_from(w: ImageInputWire) -> Result<Self, Self::Error> {
        let v = Self {
            r#type: w.r#type,
            attachment_id: w.attachment_id,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ImageInput {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_type = &self.r#type;
            if value_type != "image" {
                return Err("invalid selection constant");
            }
        }
        {
            let value_attachment_id = &self.attachment_id;
            if !canonical_id(value_attachment_id) {
                return Err("invalid selection UUID");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for ImageInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ImageInput([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ContentBlock {
    Text(TextInput),
    File(FileInput),
    Image(ImageInput),
}
impl ContentBlock {
    pub fn validate(&self) -> Result<(), &'static str> {
        match self {
            Self::Text(v) => v.validate(),
            Self::File(v) => v.validate(),
            Self::Image(v) => v.validate(),
        }
    }
}
impl std::fmt::Debug for ContentBlock {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ContentBlock([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SubmitPayloadWire")]
pub struct SubmitPayload {
    pub operation_id: CanonicalId,
    #[serde(deserialize_with = "required_nullable")]
    pub project_id: Option<CanonicalId>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub session_id: Option<CanonicalId>,
    pub content_blocks: Vec<ContentBlock>,
    pub intent: ModelIntent,
    pub selection: Selection,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmitPayloadWire {
    pub operation_id: CanonicalId,
    #[serde(deserialize_with = "required_nullable")]
    pub project_id: Option<CanonicalId>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub session_id: Option<CanonicalId>,
    pub content_blocks: Vec<ContentBlock>,
    pub intent: ModelIntent,
    pub selection: Selection,
}
impl TryFrom<SubmitPayloadWire> for SubmitPayload {
    type Error = &'static str;
    fn try_from(w: SubmitPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            operation_id: w.operation_id,
            project_id: w.project_id,
            session_id: w.session_id,
            content_blocks: w.content_blocks,
            intent: w.intent,
            selection: w.selection,
        };
        v.validate()?;
        Ok(v)
    }
}
impl SubmitPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid selection UUID");
            }
        }
        {
            let value_project_id = &self.project_id;
            value_project_id
                .as_ref()
                .map(|value| -> Result<(), &'static str> {
                    if !canonical_id(value) {
                        return Err("invalid selection UUID");
                    }
                    Ok(())
                })
                .transpose()?;
        }
        self.session_id
            .as_ref()
            .map(|value_session_id| -> Result<(), &'static str> {
                if !canonical_id(value_session_id) {
                    return Err("invalid selection UUID");
                }
                Ok(())
            })
            .transpose()?;
        {
            let value_content_blocks = &self.content_blocks;
            if value_content_blocks.is_empty() {
                return Err("invalid selection array");
            }
            if value_content_blocks.len() > 16 {
                return Err("invalid selection array");
            }
            for value in value_content_blocks.iter() {
                value.validate()?;
            }
        }
        {
            let value_intent = &self.intent;
            value_intent.validate()?;
        }
        {
            let value_selection = &self.selection;
            validate_selection(value_selection)?;
        }
        if self.session_id.is_some() && self.project_id.is_some() {
            return Err("existing session cannot change project");
        }
        if self
            .content_blocks
            .iter()
            .filter(|b| !matches!(b, ContentBlock::Text(_)))
            .count()
            > 10
        {
            return Err("too many attachment references");
        }
        Ok(())
    }
}
impl std::fmt::Debug for SubmitPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SubmitPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SelectionSnapshotWire")]
pub struct SelectionSnapshot {
    pub schema_version: i64,
    pub turn_operation_id: CanonicalId,
    pub selection: Selection,
    pub selection_digest: SelectionDigest,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelectionSnapshotWire {
    pub schema_version: i64,
    pub turn_operation_id: CanonicalId,
    pub selection: Selection,
    pub selection_digest: SelectionDigest,
}
impl TryFrom<SelectionSnapshotWire> for SelectionSnapshot {
    type Error = &'static str;
    fn try_from(w: SelectionSnapshotWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            turn_operation_id: w.turn_operation_id,
            selection: w.selection,
            selection_digest: w.selection_digest,
        };
        v.validate()?;
        Ok(v)
    }
}
impl SelectionSnapshot {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid selection constant");
            }
        }
        {
            let value_turn_operation_id = &self.turn_operation_id;
            if !canonical_id(value_turn_operation_id) {
                return Err("invalid selection UUID");
            }
        }
        {
            let value_selection = &self.selection;
            validate_selection(value_selection)?;
        }
        {
            let value_selection_digest = &self.selection_digest;
            if value_selection_digest.len() != 64
                || !value_selection_digest
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("invalid selection digest");
            }
        }
        if self
            .selection
            .windows(2)
            .any(|w| w[0].installation_id >= w[1].installation_id)
        {
            return Err("selection snapshot is not canonical");
        }
        if selection_digest(&self.turn_operation_id, &self.selection)? != self.selection_digest {
            return Err("selection snapshot digest mismatch");
        }
        Ok(())
    }
}
impl std::fmt::Debug for SelectionSnapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SelectionSnapshot([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SubmissionReceiptWire")]
pub struct SubmissionReceipt {
    pub outcome: String,
    pub session_id: CanonicalId,
    pub local_turn_id: CanonicalId,
    pub submission_operation_id: CanonicalId,
    pub turn_operation_id: CanonicalId,
    pub selection_digest: SelectionDigest,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmissionReceiptWire {
    pub outcome: String,
    pub session_id: CanonicalId,
    pub local_turn_id: CanonicalId,
    pub submission_operation_id: CanonicalId,
    pub turn_operation_id: CanonicalId,
    pub selection_digest: SelectionDigest,
}
impl TryFrom<SubmissionReceiptWire> for SubmissionReceipt {
    type Error = &'static str;
    fn try_from(w: SubmissionReceiptWire) -> Result<Self, Self::Error> {
        let v = Self {
            outcome: w.outcome,
            session_id: w.session_id,
            local_turn_id: w.local_turn_id,
            submission_operation_id: w.submission_operation_id,
            turn_operation_id: w.turn_operation_id,
            selection_digest: w.selection_digest,
        };
        v.validate()?;
        Ok(v)
    }
}
impl SubmissionReceipt {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_outcome = &self.outcome;
            if value_outcome != "local_durable_accepted" {
                return Err("invalid selection constant");
            }
        }
        {
            let value_session_id = &self.session_id;
            if !canonical_id(value_session_id) {
                return Err("invalid selection UUID");
            }
        }
        {
            let value_local_turn_id = &self.local_turn_id;
            if !canonical_id(value_local_turn_id) {
                return Err("invalid selection UUID");
            }
        }
        {
            let value_submission_operation_id = &self.submission_operation_id;
            if !canonical_id(value_submission_operation_id) {
                return Err("invalid selection UUID");
            }
        }
        {
            let value_turn_operation_id = &self.turn_operation_id;
            if !canonical_id(value_turn_operation_id) {
                return Err("invalid selection UUID");
            }
        }
        {
            let value_selection_digest = &self.selection_digest;
            if value_selection_digest.len() != 64
                || !value_selection_digest
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("invalid selection digest");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for SubmissionReceipt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SubmissionReceipt([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SubmitRequestWire")]
pub struct SubmitRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: SubmitPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmitRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: SubmitPayload,
}
impl TryFrom<SubmitRequestWire> for SubmitRequest {
    type Error = &'static str;
    fn try_from(w: SubmitRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            context_id: w.context_id,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl SubmitRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid selection constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid selection UUID");
            }
        }
        {
            let value_context_id = &self.context_id;
            if !canonical_id(value_context_id) {
                return Err("invalid selection UUID");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for SubmitRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SubmitRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SubmitResponseWire")]
pub struct SubmitResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: SubmissionReceipt,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmitResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: SubmissionReceipt,
}
impl TryFrom<SubmitResponseWire> for SubmitResponse {
    type Error = &'static str;
    fn try_from(w: SubmitResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl SubmitResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid selection constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid selection UUID");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for SubmitResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SubmitResponse([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorCode {
    #[serde(rename = "invalid_request")]
    InvalidRequest,
    #[serde(rename = "context_invalid")]
    ContextInvalid,
    #[serde(rename = "permission_denied")]
    PermissionDenied,
    #[serde(rename = "not_found")]
    NotFound,
    #[serde(rename = "request_conflict")]
    RequestConflict,
    #[serde(rename = "selection_stale")]
    SelectionStale,
    #[serde(rename = "execution_unavailable")]
    ExecutionUnavailable,
    #[serde(rename = "temporarily_unavailable")]
    TemporarilyUnavailable,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ErrorWire")]
pub struct Error {
    pub schema_version: i64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub request_id: Option<CanonicalId>,
    pub code: ErrorCode,
    pub retryable: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ErrorWire {
    pub schema_version: i64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub request_id: Option<CanonicalId>,
    pub code: ErrorCode,
    pub retryable: bool,
}
impl TryFrom<ErrorWire> for Error {
    type Error = &'static str;
    fn try_from(w: ErrorWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            code: w.code,
            retryable: w.retryable,
        };
        v.validate()?;
        Ok(v)
    }
}
impl Error {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid selection constant");
            }
        }
        self.request_id
            .as_ref()
            .map(|value_request_id| -> Result<(), &'static str> {
                if !canonical_id(value_request_id) {
                    return Err("invalid selection UUID");
                }
                Ok(())
            })
            .transpose()?;
        Ok(())
    }
}
impl std::fmt::Debug for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Error([redacted])")
    }
}
pub fn validate_selection(refs: &[SelectionRef]) -> Result<(), &'static str> {
    if refs.len() > 58 {
        return Err("too many connector references");
    }
    for (i, r) in refs.iter().enumerate() {
        r.validate()?;
        if refs[..i]
            .iter()
            .any(|p| p.installation_id == r.installation_id)
        {
            return Err("duplicate connector installation");
        }
    }
    Ok(())
}
pub fn canonical_selection_bytes(
    turn_operation_id: &str,
    refs: &[SelectionRef],
) -> Result<Vec<u8>, &'static str> {
    if !canonical_id(turn_operation_id) {
        return Err("invalid turn operation UUID");
    }
    validate_selection(refs)?;
    let mut sorted = refs.iter().collect::<Vec<_>>();
    sorted.sort_by(|a, b| a.installation_id.cmp(&b.installation_id));
    let mut text = format!(
        "yijie.market-selection/v1\n{}\n{}\n",
        turn_operation_id,
        sorted.len()
    );
    for r in sorted {
        text.push_str(&format!(
            "{} {} {}\n",
            r.installation_id, r.revision, r.generation
        ));
    }
    Ok(text.into_bytes())
}
pub fn selection_digest(
    turn_operation_id: &str,
    refs: &[SelectionRef],
) -> Result<String, &'static str> {
    Ok(format!(
        "{:x}",
        Sha256::digest(canonical_selection_bytes(turn_operation_id, refs)?)
    ))
}
pub fn freeze_selection(
    turn_operation_id: String,
    mut selection: Vec<SelectionRef>,
) -> Result<SelectionSnapshot, &'static str> {
    let digest = selection_digest(&turn_operation_id, &selection)?;
    selection.sort_by(|a, b| a.installation_id.cmp(&b.installation_id));
    Ok(SelectionSnapshot {
        schema_version: 1,
        turn_operation_id,
        selection,
        selection_digest: digest,
    })
}
