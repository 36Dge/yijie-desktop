use super::attachment::validate_image_content;
use super::database::{
    advance_cursor, validate_cursor, validate_message_output, ChatRepository, TurnProgress,
};
use super::error::{map_sqlite_error, ChatError};
use super::host_bridge::HostBridge;
use super::host_domain::{
    HostArtifactEventV3, HostBridgeError, HostBridgeErrorKind, HostErrorCode,
};
use super::worker::DatabaseWorker;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::fmt::{Debug, Formatter};
use std::io::{Read, Seek, SeekFrom, Write};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::time::{sleep, Duration};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

pub const ARTIFACT_RETENTION_SECONDS: i64 = 7 * 24 * 60 * 60;
pub const MAX_ARTIFACTS_PER_TURN: usize = 12;
pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_ARTIFACT_BYTES: usize = 64 * 1024 * 1024;
const MAX_UNKNOWN_REPORT_PAYLOAD_BYTES: usize = 128 * 1024;
const MAX_UNKNOWN_REPORT_DEPTH: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArtifactKind {
    Image,
    Video,
    File,
    Report,
}

impl ArtifactKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Video => "video",
            Self::File => "file",
            Self::Report => "report",
        }
    }

    fn parse(value: &str) -> Result<Self, ChatError> {
        match value {
            "image" => Ok(Self::Image),
            "video" => Ok(Self::Video),
            "file" => Ok(Self::File),
            "report" => Ok(Self::Report),
            _ => Err(ChatError::DatabaseUnavailable),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArtifactProvenance {
    Synthetic,
    Provider,
    Tool,
}

impl ArtifactProvenance {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Synthetic => "synthetic",
            Self::Provider => "provider",
            Self::Tool => "tool",
        }
    }

    fn parse(value: &str) -> Result<Self, ChatError> {
        match value {
            "synthetic" => Ok(Self::Synthetic),
            "provider" => Ok(Self::Provider),
            "tool" => Ok(Self::Tool),
            _ => Err(ChatError::DatabaseUnavailable),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArtifactManifest {
    pub artifact_id: Uuid,
    pub agent_session_id: Uuid,
    pub local_session_id: Uuid,
    pub local_turn_id: Uuid,
    pub kind: ArtifactKind,
    pub provenance: ArtifactProvenance,
    pub ordinal: usize,
    pub display_name: Option<String>,
    pub media_type: String,
    pub size_bytes: usize,
    pub sha256: String,
    pub content_href: String,
    pub poster_href: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArtifactIdentity {
    pub artifact_id: Uuid,
    pub local_session_id: Uuid,
    pub local_turn_id: Uuid,
    pub kind: ArtifactKind,
    pub provenance: ArtifactProvenance,
    pub ordinal: usize,
    pub display_name: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) struct ReadyImageIdentity {
    pub owner_user_id: Uuid,
    pub tenant_id: Uuid,
    pub session_id: Uuid,
    pub turn_id: Uuid,
    pub artifact_id: Uuid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReadyImageReadError {
    NotFound,
    NotReady,
    Expired,
    Unsupported,
    Integrity,
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct ReadyImageContent {
    pub identity: ReadyImageIdentity,
    pub display_name: Option<String>,
    pub media_type: &'static str,
    pub size_bytes: usize,
    pub sha256: [u8; 32],
    pub bytes: Vec<u8>,
}

pub(crate) type ReadyVideoIdentity = ReadyImageIdentity;
pub(crate) type ReadyVideoReadError = ReadyImageReadError;
pub(crate) type ReadyFileIdentity = ReadyImageIdentity;
pub(crate) type ReadyReportIdentity = ReadyImageIdentity;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReadyFileReadError {
    NotFound,
    NotReady,
    Expired,
    Unsupported,
    Integrity,
    LimitExceeded,
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct ReadyVideoContent {
    pub identity: ReadyVideoIdentity,
    pub display_name: Option<String>,
    pub media_type: &'static str,
    pub size_bytes: usize,
    pub sha256: [u8; 32],
    pub bytes: Vec<u8>,
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct ReadyFileContent {
    pub identity: ReadyFileIdentity,
    pub display_name: Option<String>,
    pub media_type: &'static str,
    pub size_bytes: usize,
    pub sha256: [u8; 32],
    pub revision: i64,
    pub bytes: Vec<u8>,
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct ReadyReportContent {
    pub identity: ReadyReportIdentity,
    pub display_name: Option<String>,
    pub media_type: &'static str,
    pub size_bytes: usize,
    pub sha256: [u8; 32],
    pub revision: i64,
    pub bytes: Vec<u8>,
}

pub(crate) type ReadyReportReadError = ReadyFileReadError;

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct ReadyVideoRangeContent {
    pub identity: ReadyVideoIdentity,
    pub size_bytes: usize,
    pub sha256: [u8; 32],
    pub bytes: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ReadyVideoRangeRequest {
    pub session_id: Uuid,
    pub turn_id: Uuid,
    pub artifact_id: Uuid,
    pub now: i64,
    pub expected_size: usize,
    pub expected_sha256: [u8; 32],
    pub start: usize,
    pub length: usize,
}

impl Debug for ReadyVideoRangeContent {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ReadyVideoRangeContent")
            .field("identity", &self.identity)
            .field("size_bytes", &self.size_bytes)
            .field("content", &"[REDACTED]")
            .finish()
    }
}

impl Debug for ReadyVideoContent {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ReadyVideoContent")
            .field("identity", &self.identity)
            .field("display_name", &self.display_name)
            .field("media_type", &self.media_type)
            .field("size_bytes", &self.size_bytes)
            .field("content", &"[REDACTED]")
            .finish()
    }
}

impl Debug for ReadyFileContent {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ReadyFileContent")
            .field("identity", &self.identity)
            .field("display_name", &self.display_name)
            .field("media_type", &self.media_type)
            .field("size_bytes", &self.size_bytes)
            .field("content", &"[REDACTED]")
            .finish()
    }
}

impl Debug for ReadyReportContent {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ReadyReportContent")
            .field("identity", &self.identity)
            .field("display_name", &self.display_name)
            .field("media_type", &self.media_type)
            .field("size_bytes", &self.size_bytes)
            .field("content", &"[REDACTED]")
            .finish()
    }
}

impl Debug for ReadyImageContent {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ReadyImageContent")
            .field("identity", &self.identity)
            .field("display_name", &self.display_name)
            .field("media_type", &self.media_type)
            .field("size_bytes", &self.size_bytes)
            .field("content", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArtifactProgressStage {
    Generating,
    Processing,
    Finalizing,
}

impl ArtifactProgressStage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Generating => "generating",
            Self::Processing => "processing",
            Self::Finalizing => "finalizing",
        }
    }

    fn rank(self) -> u8 {
        match self {
            Self::Generating => 0,
            Self::Processing => 1,
            Self::Finalizing => 2,
        }
    }

    fn parse(value: &str) -> Result<Self, ChatError> {
        match value {
            "generating" => Ok(Self::Generating),
            "processing" => Ok(Self::Processing),
            "finalizing" => Ok(Self::Finalizing),
            _ => Err(ChatError::DatabaseUnavailable),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum ArtifactEventV3 {
    Started(ArtifactIdentity),
    Progress {
        identity: ArtifactIdentity,
        stage: Option<ArtifactProgressStage>,
        progress_percent: Option<f64>,
    },
    Completed(ArtifactManifest),
    Failed {
        identity: ArtifactIdentity,
        error_code: String,
        retryable: bool,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireArtifactEnvelopeV3 {
    schema_version: u8,
    event_id: Uuid,
    stream_id: Uuid,
    sequence: u64,
    occurred_at: String,
    trace_id: Option<String>,
    request_id: Option<String>,
    tenant_id: Option<String>,
    user_id: Option<String>,
    task_id: Uuid,
    agent_session_id: Uuid,
    codex_thread_id: Uuid,
    turn_id: Uuid,
    item_id: Option<String>,
    event_type: String,
    terminal: bool,
    payload: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireArtifactStarted {
    artifact_id: Uuid,
    kind: String,
    provenance: String,
    status: String,
    ordinal: usize,
    display_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireArtifactProgress {
    artifact_id: Uuid,
    kind: String,
    provenance: String,
    status: String,
    ordinal: usize,
    stage: Option<String>,
    progress_percent: Option<f64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireArtifactCompleted {
    artifact_id: Uuid,
    kind: String,
    provenance: String,
    status: String,
    ordinal: usize,
    display_name: Option<String>,
    media_type: String,
    size_bytes: usize,
    sha256: String,
    content_href: String,
    poster_href: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireArtifactFailed {
    artifact_id: Uuid,
    kind: String,
    provenance: String,
    status: String,
    ordinal: usize,
    error_code: String,
    retryable: bool,
    message: Option<String>,
}

#[derive(Clone)]
pub struct DownloadedResource {
    pub media_type: String,
    pub size_bytes: usize,
    pub sha256: String,
    pub bytes: Vec<u8>,
}

impl std::fmt::Debug for DownloadedResource {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DownloadedResource")
            .field("media_type", &self.media_type)
            .field("size_bytes", &self.size_bytes)
            .field("sha256", &"[DIGEST]")
            .field("bytes", &"[ARTIFACT_BYTES]")
            .finish()
    }
}

#[derive(Clone, Debug)]
pub struct DownloadedArtifact {
    pub content: DownloadedResource,
    pub poster: Option<DownloadedResource>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ArtifactProjection {
    pub artifact_id: Uuid,
    pub turn_id: Uuid,
    pub kind: ArtifactKind,
    pub provenance: ArtifactProvenance,
    pub state: String,
    pub ordinal: usize,
    pub progress_stage: Option<ArtifactProgressStage>,
    pub progress_percent: Option<f64>,
    pub display_name: Option<String>,
    pub media_type: Option<String>,
    pub size_bytes: Option<usize>,
    pub local_committed_at: Option<i64>,
    pub expires_at: Option<i64>,
    pub has_poster: bool,
    pub error_code: Option<String>,
    pub retryable: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArtifactCommit {
    pub artifact_id: Uuid,
    pub ack_id: Uuid,
    pub local_committed_at: i64,
    pub expires_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredArtifactCommit {
    pub commit: ArtifactCommit,
    pub host_acknowledged: bool,
    pub expired: bool,
}

#[derive(Clone, Debug)]
pub struct PendingArtifactAcknowledgement {
    pub manifest: ArtifactManifest,
    pub commit: ArtifactCommit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransferDisposition {
    Fetch,
    AlreadyCommitted,
}

struct ArtifactIdentityRow {
    kind: String,
    provenance: String,
    state: String,
    ordinal: i64,
    display_name: Option<String>,
    progress_stage: Option<String>,
    progress_percent: Option<f64>,
    session_id: String,
    turn_id: String,
}

struct ArtifactTransferRow {
    kind: String,
    provenance: String,
    state: String,
    ordinal: i64,
    display_name: Option<String>,
    media_type: Option<String>,
    size_bytes: Option<i64>,
    sha256: Option<String>,
}

impl ArtifactIdentityRow {
    fn matches_wire_identity(&self, identity: &ArtifactIdentity) -> bool {
        self.kind == identity.kind.as_str()
            && self.provenance == identity.provenance.as_str()
            && usize::try_from(self.ordinal).ok() == Some(identity.ordinal)
            && self.session_id == identity.local_session_id.to_string()
            && self.turn_id == identity.local_turn_id.to_string()
    }

    fn matches_identity(&self, identity: &ArtifactIdentity) -> bool {
        self.matches_wire_identity(identity) && self.display_name == identity.display_name
    }
}

#[derive(Clone)]
pub struct ArtifactTransferService {
    host: Arc<HostBridge>,
    database: DatabaseWorker,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArtifactTransferOutcome {
    pub commit: ArtifactCommit,
    pub host_acknowledged: bool,
}

impl ArtifactTransferService {
    pub(super) fn new(host: Arc<HostBridge>, database: DatabaseWorker) -> Self {
        Self { host, database }
    }

    pub async fn transfer_completed(
        &self,
        manifest: ArtifactManifest,
    ) -> Result<ArtifactTransferOutcome, ChatError> {
        match self
            .database
            .begin_artifact_transfer(manifest.clone())
            .await?
        {
            TransferDisposition::AlreadyCommitted => {
                let stored = self.database.artifact_commit(manifest.clone()).await?;
                let host_acknowledged = if stored.host_acknowledged || stored.expired {
                    stored.host_acknowledged
                } else {
                    self.acknowledge_committed(&manifest, &stored.commit)
                        .await
                        .unwrap_or(false)
                };
                return Ok(ArtifactTransferOutcome {
                    commit: stored.commit,
                    host_acknowledged,
                });
            }
            TransferDisposition::Fetch => {}
        }
        let downloaded = self.download_with_retry(&manifest).await?;
        let local_committed_at = unix_seconds()?;
        let commit = self
            .database
            .commit_artifact(
                manifest.clone(),
                downloaded,
                local_committed_at,
                Uuid::now_v7(),
            )
            .await?;
        let host_acknowledged = self
            .acknowledge_committed(&manifest, &commit)
            .await
            .unwrap_or(false);
        Ok(ArtifactTransferOutcome {
            commit,
            host_acknowledged,
        })
    }

    pub async fn ingest_event(
        &self,
        event: ArtifactEventV3,
    ) -> Result<Option<ArtifactTransferOutcome>, ChatError> {
        match event {
            ArtifactEventV3::Started(identity) => {
                self.database.record_artifact_started(identity).await?;
                Ok(None)
            }
            ArtifactEventV3::Progress {
                identity,
                stage,
                progress_percent,
            } => {
                self.database
                    .record_artifact_progress(identity, stage, progress_percent)
                    .await?;
                Ok(None)
            }
            ArtifactEventV3::Completed(manifest) => {
                self.transfer_completed(manifest).await.map(Some)
            }
            ArtifactEventV3::Failed {
                identity,
                error_code,
                retryable,
            } => {
                self.database
                    .record_artifact_failed(identity, error_code, retryable)
                    .await?;
                Ok(None)
            }
        }
    }

    pub async fn transfer_completed_with_cursor(
        &self,
        manifest: ArtifactManifest,
        progress: TurnProgress,
    ) -> Result<ArtifactTransferOutcome, ChatError> {
        match self
            .database
            .begin_artifact_transfer(manifest.clone())
            .await?
        {
            TransferDisposition::AlreadyCommitted => {
                let stored = self
                    .database
                    .commit_existing_artifact_cursor(progress, manifest.clone())
                    .await?;
                let host_acknowledged = if stored.host_acknowledged || stored.expired {
                    stored.host_acknowledged
                } else {
                    self.acknowledge_committed(&manifest, &stored.commit)
                        .await
                        .unwrap_or(false)
                };
                return Ok(ArtifactTransferOutcome {
                    commit: stored.commit,
                    host_acknowledged,
                });
            }
            TransferDisposition::Fetch => {}
        }
        let downloaded = match self.download_with_retry(&manifest).await {
            Ok(downloaded) => downloaded,
            Err(error) => {
                let error_code = if matches!(
                    error,
                    ChatError::InvalidConfiguration | ChatError::ConversationConflict
                ) {
                    "integrity_failed"
                } else {
                    "resource_unavailable"
                };
                self.database
                    .commit_artifact_failure_with_cursor(
                        progress,
                        artifact_identity_from_manifest(&manifest),
                        error_code.to_owned(),
                        error_code == "resource_unavailable",
                    )
                    .await?;
                return Err(error);
            }
        };
        let local_committed_at = unix_seconds()?;
        let commit = self
            .database
            .commit_artifact_with_cursor(
                manifest.clone(),
                downloaded,
                local_committed_at,
                Uuid::now_v7(),
                progress,
            )
            .await?;
        let host_acknowledged = self
            .acknowledge_committed(&manifest, &commit)
            .await
            .unwrap_or(false);
        Ok(ArtifactTransferOutcome {
            commit,
            host_acknowledged,
        })
    }

    pub async fn recover_pending_acknowledgements(&self) -> Result<usize, ChatError> {
        let pending = self.database.pending_artifact_acknowledgements().await?;
        let mut acknowledged = 0_usize;
        for item in pending {
            if self
                .acknowledge_committed(&item.manifest, &item.commit)
                .await
                .unwrap_or(false)
            {
                acknowledged += 1;
            }
        }
        Ok(acknowledged)
    }

    pub async fn acknowledge_committed(
        &self,
        manifest: &ArtifactManifest,
        commit: &ArtifactCommit,
    ) -> Result<bool, ChatError> {
        let timestamp = format_utc_timestamp(commit.local_committed_at)?;
        let acknowledgement = self
            .host
            .acknowledge_artifact(manifest, commit, &timestamp)
            .await
            .map_err(map_host_transfer_error)?;
        self.database
            .mark_artifact_acknowledged(
                acknowledgement.artifact_id,
                acknowledgement.ack_id,
                unix_seconds()?,
            )
            .await?;
        Ok(true)
    }

    pub async fn purge_expired(&self, now: i64) -> Result<usize, ChatError> {
        self.database.purge_expired_artifacts(now).await
    }

    async fn download_with_retry(
        &self,
        manifest: &ArtifactManifest,
    ) -> Result<DownloadedArtifact, ChatError> {
        let mut delay = Duration::from_millis(100);
        for attempt in 0..3 {
            match self.host.download_artifact(manifest).await {
                Ok(downloaded) => return Ok(downloaded),
                Err(error) if attempt < 2 && retryable_host_error(&error) => {
                    sleep(delay).await;
                    delay = delay.saturating_mul(2);
                }
                Err(error) => return Err(map_host_transfer_error(error)),
            }
        }
        Err(ChatError::OrchestrationUnavailable)
    }
}

fn artifact_identity_from_manifest(manifest: &ArtifactManifest) -> ArtifactIdentity {
    ArtifactIdentity {
        artifact_id: manifest.artifact_id,
        local_session_id: manifest.local_session_id,
        local_turn_id: manifest.local_turn_id,
        kind: manifest.kind,
        provenance: manifest.provenance,
        ordinal: manifest.ordinal,
        display_name: manifest.display_name.clone(),
    }
}

impl ArtifactManifest {
    pub fn validate(&self) -> Result<(), ChatError> {
        if self.artifact_id.is_nil()
            || self.agent_session_id.is_nil()
            || self.local_session_id.is_nil()
            || self.local_turn_id.is_nil()
            || self.ordinal >= MAX_ARTIFACTS_PER_TURN
            || !valid_sha256(&self.sha256)
            || !(1..=max_bytes(self.kind)).contains(&self.size_bytes)
            || !media_type_matches(self.kind, &self.media_type)
            || self
                .display_name
                .as_deref()
                .is_some_and(|name| !valid_safe_name(name))
        {
            return Err(ChatError::InvalidInput);
        }
        let content = format!(
            "/v3/agent-sessions/{}/artifacts/{}/content",
            self.agent_session_id, self.artifact_id
        );
        if self.content_href != content {
            return Err(ChatError::InvalidInput);
        }
        match (&self.kind, &self.poster_href) {
            (ArtifactKind::Video, Some(href))
                if href
                    == &format!(
                        "/v3/agent-sessions/{}/artifacts/{}/poster",
                        self.agent_session_id, self.artifact_id
                    ) => {}
            (ArtifactKind::Video, None) => {}
            (_, None) => {}
            _ => return Err(ChatError::InvalidInput),
        }
        Ok(())
    }
}

impl ArtifactIdentity {
    fn validate(&self) -> Result<(), ChatError> {
        if self.artifact_id.is_nil()
            || self.local_session_id.is_nil()
            || self.local_turn_id.is_nil()
            || self.ordinal >= MAX_ARTIFACTS_PER_TURN
            || self
                .display_name
                .as_deref()
                .is_some_and(|name| !valid_safe_name(name))
        {
            return Err(ChatError::InvalidInput);
        }
        Ok(())
    }
}

pub fn decode_artifact_event_v3(
    bytes: &[u8],
    expected_agent_session_id: Uuid,
    expected_runtime_turn_id: Uuid,
    local_session_id: Uuid,
    local_turn_id: Uuid,
) -> Result<ArtifactEventV3, ChatError> {
    if bytes.is_empty()
        || bytes.len() > 1024 * 1024
        || [
            expected_agent_session_id,
            expected_runtime_turn_id,
            local_session_id,
            local_turn_id,
        ]
        .iter()
        .any(Uuid::is_nil)
    {
        return Err(ChatError::InvalidInput);
    }
    let wire: WireArtifactEnvelopeV3 =
        serde_json::from_slice(bytes).map_err(|_| ChatError::InvalidInput)?;
    if wire.schema_version != 3
        || wire.event_id.is_nil()
        || wire.stream_id.is_nil()
        || wire.sequence == 0
        || wire.task_id.is_nil()
        || wire.agent_session_id != expected_agent_session_id
        || wire.codex_thread_id.is_nil()
        || wire.turn_id != expected_runtime_turn_id
        || wire.terminal
        || !valid_rfc3339_utc(&wire.occurred_at)
        || [
            wire.trace_id.as_deref(),
            wire.request_id.as_deref(),
            wire.tenant_id.as_deref(),
            wire.user_id.as_deref(),
            wire.item_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        .any(|value| !safe_wire_context(value, 256))
    {
        return Err(ChatError::InvalidInput);
    }
    decode_artifact_event_envelope_v3(
        &HostArtifactEventV3 {
            schema_version: 3,
            cursor: super::host_domain::HostEventCursor {
                stream_id: wire.stream_id,
                sequence: wire.sequence,
            },
            event_type: wire.event_type,
            event_id: wire.event_id,
            task_id: wire.task_id,
            agent_session_id: wire.agent_session_id,
            codex_thread_id: wire.codex_thread_id,
            turn_id: wire.turn_id,
            occurred_at: wire.occurred_at,
            payload: wire.payload,
        },
        expected_agent_session_id,
        expected_runtime_turn_id,
        local_session_id,
        local_turn_id,
    )
}

pub fn decode_artifact_event_envelope_v3(
    wire: &HostArtifactEventV3,
    expected_agent_session_id: Uuid,
    expected_runtime_turn_id: Uuid,
    local_session_id: Uuid,
    local_turn_id: Uuid,
) -> Result<ArtifactEventV3, ChatError> {
    if !matches!(wire.schema_version, 3..=6)
        || wire.event_id.is_nil()
        || wire.cursor.stream_id.is_nil()
        || wire.cursor.sequence == 0
        || wire.task_id.is_nil()
        || wire.agent_session_id != expected_agent_session_id
        || wire.codex_thread_id.is_nil()
        || wire.turn_id != expected_runtime_turn_id
        || !valid_rfc3339_utc(&wire.occurred_at)
        || [
            expected_agent_session_id,
            expected_runtime_turn_id,
            local_session_id,
            local_turn_id,
        ]
        .iter()
        .any(Uuid::is_nil)
    {
        return Err(ChatError::InvalidInput);
    }
    match wire.event_type.as_str() {
        "item.artifact.started" => {
            let payload: WireArtifactStarted = serde_json::from_value(wire.payload.clone())
                .map_err(|_| ChatError::InvalidInput)?;
            if payload.status != "in_progress" {
                return Err(ChatError::InvalidInput);
            }
            if payload
                .display_name
                .as_deref()
                .is_some_and(|value| !valid_wire_safe_name(value, wire.schema_version))
            {
                return Err(ChatError::InvalidInput);
            }
            let identity = ArtifactIdentity {
                artifact_id: payload.artifact_id,
                local_session_id,
                local_turn_id,
                kind: parse_wire_kind(&payload.kind)?,
                provenance: parse_wire_provenance(&payload.provenance)?,
                ordinal: payload.ordinal,
                display_name: payload.display_name,
            };
            identity.validate()?;
            Ok(ArtifactEventV3::Started(identity))
        }
        "item.artifact.progress" => {
            let payload: WireArtifactProgress = serde_json::from_value(wire.payload.clone())
                .map_err(|_| ChatError::InvalidInput)?;
            if payload.status != "in_progress"
                || payload.stage.is_none() && payload.progress_percent.is_none()
                || payload
                    .progress_percent
                    .is_some_and(|value| !value.is_finite() || !(0.0..=100.0).contains(&value))
            {
                return Err(ChatError::InvalidInput);
            }
            let stage = payload
                .stage
                .as_deref()
                .map(|value| match value {
                    "generating" => Ok(ArtifactProgressStage::Generating),
                    "processing" => Ok(ArtifactProgressStage::Processing),
                    "finalizing" => Ok(ArtifactProgressStage::Finalizing),
                    _ => Err(ChatError::InvalidInput),
                })
                .transpose()?;
            let identity = ArtifactIdentity {
                artifact_id: payload.artifact_id,
                local_session_id,
                local_turn_id,
                kind: parse_wire_kind(&payload.kind)?,
                provenance: parse_wire_provenance(&payload.provenance)?,
                ordinal: payload.ordinal,
                display_name: None,
            };
            identity.validate()?;
            Ok(ArtifactEventV3::Progress {
                identity,
                stage,
                progress_percent: payload.progress_percent,
            })
        }
        "item.artifact.completed" => {
            let payload: WireArtifactCompleted = serde_json::from_value(wire.payload.clone())
                .map_err(|_| ChatError::InvalidInput)?;
            if payload.status != "ready" {
                return Err(ChatError::InvalidInput);
            }
            if payload
                .display_name
                .as_deref()
                .is_some_and(|value| !valid_wire_safe_name(value, wire.schema_version))
            {
                return Err(ChatError::InvalidInput);
            }
            let manifest = ArtifactManifest {
                artifact_id: payload.artifact_id,
                agent_session_id: wire.agent_session_id,
                local_session_id,
                local_turn_id,
                kind: parse_wire_kind(&payload.kind)?,
                provenance: parse_wire_provenance(&payload.provenance)?,
                ordinal: payload.ordinal,
                display_name: payload.display_name,
                media_type: payload.media_type,
                size_bytes: payload.size_bytes,
                sha256: payload.sha256,
                content_href: payload.content_href,
                poster_href: payload.poster_href,
            };
            manifest.validate()?;
            Ok(ArtifactEventV3::Completed(manifest))
        }
        "item.artifact.failed" => {
            let payload: WireArtifactFailed = serde_json::from_value(wire.payload.clone())
                .map_err(|_| ChatError::InvalidInput)?;
            if payload.status != "failed"
                || payload.message.as_deref().is_some_and(|value| {
                    if wire.schema_version >= 5 {
                        !safe_wire_context_chars_bytes(value, 512, 2_048)
                    } else {
                        !safe_wire_context(value, 512)
                    }
                })
            {
                return Err(ChatError::InvalidInput);
            }
            let identity = ArtifactIdentity {
                artifact_id: payload.artifact_id,
                local_session_id,
                local_turn_id,
                kind: parse_wire_kind(&payload.kind)?,
                provenance: parse_wire_provenance(&payload.provenance)?,
                ordinal: payload.ordinal,
                display_name: None,
            };
            identity.validate()?;
            Ok(ArtifactEventV3::Failed {
                identity,
                error_code: payload.error_code,
                retryable: payload.retryable,
            })
        }
        _ => Err(ChatError::InvalidInput),
    }
}

pub(super) fn load_artifacts_for_turns_from_connection(
    connection: &Connection,
    scope: &super::database::ChatScope,
    turn_ids: &[Uuid],
) -> Result<Vec<ArtifactProjection>, ChatError> {
    if turn_ids.is_empty() {
        return Ok(Vec::new());
    }
    if turn_ids.len() > 50 || turn_ids.iter().any(Uuid::is_nil) {
        return Err(ChatError::InvalidInput);
    }
    let placeholders = std::iter::repeat_n("?", turn_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT a.artifact_id, a.turn_id, a.kind, a.provenance, a.state, a.ordinal,
                a.progress_stage, a.progress_percent,
                a.display_name, a.media_type, a.byte_size, a.local_committed_at, a.expires_at,
                a.poster_media_type IS NOT NULL, a.error_code, a.retryable
         FROM chat_output_artifacts a
         JOIN chat_sessions s ON s.id=a.session_id
         WHERE a.turn_id IN ({placeholders})
           AND a.owner_user_id=? AND a.tenant_id=?
           AND s.owner_user_id=a.owner_user_id AND s.tenant_id=a.tenant_id
         ORDER BY a.turn_id, a.ordinal"
    );
    let mut values = turn_ids.iter().map(Uuid::to_string).collect::<Vec<_>>();
    values.push(scope.owner_user_id.clone());
    values.push(scope.tenant_id.clone());
    let mut statement = connection.prepare(&sql).map_err(map_sqlite_error)?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(values.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<f64>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<i64>>(10)?,
                row.get::<_, Option<i64>>(11)?,
                row.get::<_, Option<i64>>(12)?,
                row.get::<_, bool>(13)?,
                row.get::<_, Option<String>>(14)?,
                row.get::<_, Option<bool>>(15)?,
            ))
        })
        .map_err(map_sqlite_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(map_sqlite_error)?;
    rows.into_iter()
        .map(
            |(
                artifact_id,
                turn_id,
                kind,
                provenance,
                state,
                ordinal,
                progress_stage,
                progress_percent,
                display_name,
                media_type,
                size_bytes,
                local_committed_at,
                expires_at,
                has_poster,
                error_code,
                retryable,
            )| {
                Ok(ArtifactProjection {
                    artifact_id: parse_uuid(&artifact_id)?,
                    turn_id: parse_uuid(&turn_id)?,
                    kind: ArtifactKind::parse(&kind)?,
                    provenance: ArtifactProvenance::parse(&provenance)?,
                    state,
                    ordinal: usize::try_from(ordinal)
                        .map_err(|_| ChatError::DatabaseUnavailable)?,
                    progress_stage: progress_stage
                        .as_deref()
                        .map(ArtifactProgressStage::parse)
                        .transpose()?,
                    progress_percent,
                    display_name,
                    media_type,
                    size_bytes: size_bytes
                        .map(usize::try_from)
                        .transpose()
                        .map_err(|_| ChatError::DatabaseUnavailable)?,
                    local_committed_at,
                    expires_at,
                    has_poster,
                    error_code,
                    retryable,
                })
            },
        )
        .collect()
}

impl ChatRepository {
    pub fn commit_artifact_event_progress(
        &mut self,
        progress: &TurnProgress,
        event: &ArtifactEventV3,
    ) -> Result<(), ChatError> {
        if matches!(event, ArtifactEventV3::Completed(_)) {
            return Err(ChatError::InvalidInput);
        }
        self.connection
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(map_sqlite_error)?;
        let result = (|| {
            persist_turn_progress_on_connection(&self.connection, &self.scope, progress)?;
            match event {
                ArtifactEventV3::Started(identity) => self.record_artifact_started(identity),
                ArtifactEventV3::Progress {
                    identity,
                    stage,
                    progress_percent,
                } => self.record_artifact_progress(identity, *stage, *progress_percent),
                ArtifactEventV3::Failed {
                    identity,
                    error_code,
                    retryable,
                } => self.record_artifact_failed(identity, error_code, *retryable),
                ArtifactEventV3::Completed(_) => Err(ChatError::InvalidInput),
            }
        })();
        finish_manual_transaction(&self.connection, result)
    }

    pub fn commit_artifact_failure_with_cursor(
        &mut self,
        progress: &TurnProgress,
        identity: &ArtifactIdentity,
        error_code: &str,
        retryable: bool,
    ) -> Result<(), ChatError> {
        self.commit_artifact_event_progress(
            progress,
            &ArtifactEventV3::Failed {
                identity: identity.clone(),
                error_code: error_code.to_owned(),
                retryable,
            },
        )
    }

    pub fn commit_existing_artifact_cursor(
        &mut self,
        progress: &TurnProgress,
        manifest: &ArtifactManifest,
    ) -> Result<StoredArtifactCommit, ChatError> {
        self.connection
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(map_sqlite_error)?;
        let result = (|| {
            persist_turn_progress_on_connection(&self.connection, &self.scope, progress)?;
            self.artifact_commit(manifest)
        })();
        finish_manual_transaction(&self.connection, result)
    }

    fn require_owned_artifact_turn(
        &self,
        session_id: Uuid,
        turn_id: Uuid,
    ) -> Result<(), ChatError> {
        let owned: bool = self
            .connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM chat_turns t
                   JOIN chat_sessions s ON s.id=t.session_id
                   WHERE t.id=?1 AND s.id=?2 AND s.owner_user_id=?3 AND s.tenant_id=?4
                 )",
                params![
                    turn_id.to_string(),
                    session_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| row.get(0),
            )
            .map_err(map_sqlite_error)?;
        owned.then_some(()).ok_or(ChatError::NotFound)
    }

    fn artifact_identity_row(
        &self,
        artifact_id: Uuid,
    ) -> Result<Option<ArtifactIdentityRow>, ChatError> {
        self.connection
            .query_row(
                "SELECT kind, provenance, state, ordinal, display_name, progress_stage, progress_percent,
                        session_id, turn_id
                 FROM chat_output_artifacts
                 WHERE artifact_id=?1 AND owner_user_id=?2 AND tenant_id=?3",
                params![
                    artifact_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| {
                    Ok(ArtifactIdentityRow {
                        kind: row.get(0)?,
                        provenance: row.get(1)?,
                        state: row.get(2)?,
                        ordinal: row.get(3)?,
                        display_name: row.get(4)?,
                        progress_stage: row.get(5)?,
                        progress_percent: row.get(6)?,
                        session_id: row.get(7)?,
                        turn_id: row.get(8)?,
                    })
                },
            )
            .optional()
            .map_err(map_sqlite_error)
    }

    pub fn record_artifact_started(
        &mut self,
        identity: &ArtifactIdentity,
    ) -> Result<(), ChatError> {
        identity.validate()?;
        self.require_owned_artifact_turn(identity.local_session_id, identity.local_turn_id)?;
        let existing = self.artifact_identity_row(identity.artifact_id)?;
        if let Some(existing) = existing {
            if existing.matches_identity(identity) && existing.state == "announced" {
                return Ok(());
            }
            return Err(ChatError::ConversationConflict);
        }
        self.connection
            .execute(
                "INSERT INTO chat_output_artifacts(
                   artifact_id, owner_user_id, tenant_id, session_id, turn_id,
                   kind, provenance, state, ordinal, display_name
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'announced', ?8, ?9)",
                params![
                    identity.artifact_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                    identity.local_session_id.to_string(),
                    identity.local_turn_id.to_string(),
                    identity.kind.as_str(),
                    identity.provenance.as_str(),
                    i64::try_from(identity.ordinal).map_err(|_| ChatError::InvalidInput)?,
                    identity.display_name,
                ],
            )
            .map_err(|_| ChatError::ConversationConflict)?;
        Ok(())
    }

    pub fn record_artifact_progress(
        &mut self,
        identity: &ArtifactIdentity,
        stage: Option<ArtifactProgressStage>,
        progress_percent: Option<f64>,
    ) -> Result<(), ChatError> {
        identity.validate()?;
        if stage.is_none() && progress_percent.is_none()
            || progress_percent
                .is_some_and(|value| !value.is_finite() || !(0.0..=100.0).contains(&value))
        {
            return Err(ChatError::InvalidInput);
        }
        let existing = self
            .artifact_identity_row(identity.artifact_id)?
            .ok_or(ChatError::NotFound)?;
        if !existing.matches_wire_identity(identity) {
            return Err(ChatError::ConversationConflict);
        }
        if progress_percent
            .zip(existing.progress_percent)
            .is_some_and(|(next, previous)| next < previous)
        {
            return Err(ChatError::ConversationConflict);
        }
        if stage
            .zip(existing.progress_stage.as_deref())
            .and_then(|(next, previous)| {
                ArtifactProgressStage::parse(previous)
                    .ok()
                    .map(|previous| (next, previous))
            })
            .is_some_and(|(next, previous)| next.rank() < previous.rank())
        {
            return Err(ChatError::ConversationConflict);
        }
        let next = match stage {
            Some(ArtifactProgressStage::Generating) => "generating",
            Some(ArtifactProgressStage::Processing | ArtifactProgressStage::Finalizing) => {
                "processing"
            }
            None if existing.state == "announced" => "generating",
            None => existing.state.as_str(),
        };
        let valid = matches!(
            (existing.state.as_str(), next),
            ("announced", "generating" | "processing")
                | ("generating", "generating" | "processing")
                | ("processing", "processing")
        );
        if !valid {
            return Err(ChatError::ConversationConflict);
        }
        self.connection
            .execute(
                "UPDATE chat_output_artifacts SET state=?1,
                   progress_stage=COALESCE(?2, progress_stage),
                   progress_percent=COALESCE(?3, progress_percent)
                 WHERE artifact_id=?4 AND owner_user_id=?5 AND tenant_id=?6",
                params![
                    next,
                    stage.map(ArtifactProgressStage::as_str),
                    progress_percent,
                    identity.artifact_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
            )
            .map_err(map_sqlite_error)?;
        Ok(())
    }

    pub fn record_artifact_failed(
        &mut self,
        identity: &ArtifactIdentity,
        error_code: &str,
        retryable: bool,
    ) -> Result<(), ChatError> {
        identity.validate()?;
        if !matches!(
            error_code,
            "generation_failed"
                | "unsupported_provider"
                | "resource_unavailable"
                | "limit_exceeded"
                | "integrity_failed"
                | "protocol_error"
                | "turn_interrupted"
                | "host_shutdown"
        ) {
            return Err(ChatError::InvalidInput);
        }
        let existing = self
            .artifact_identity_row(identity.artifact_id)?
            .ok_or(ChatError::NotFound)?;
        if !existing.matches_wire_identity(identity) {
            return Err(ChatError::ConversationConflict);
        }
        let next = if error_code == "turn_interrupted" {
            "cancelled"
        } else {
            "failed"
        };
        if matches!(existing.state.as_str(), "failed" | "cancelled") {
            let terminal: Option<(String, bool)> = self
                .connection
                .query_row(
                    "SELECT error_code, retryable FROM chat_output_artifacts
                     WHERE artifact_id=?1 AND owner_user_id=?2 AND tenant_id=?3",
                    params![
                        identity.artifact_id.to_string(),
                        self.scope.owner_user_id,
                        self.scope.tenant_id
                    ],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(map_sqlite_error)?;
            return if terminal == Some((error_code.to_owned(), retryable)) && existing.state == next
            {
                Ok(())
            } else {
                Err(ChatError::ConversationConflict)
            };
        }
        if matches!(existing.state.as_str(), "ready" | "expired") {
            return Err(ChatError::ConversationConflict);
        }
        self.connection
            .execute(
                "UPDATE chat_output_artifacts SET
                   state=?1, content_blob=NULL, poster_blob=NULL,
                   progress_stage=NULL, progress_percent=NULL,
                   local_committed_at=NULL, expires_at=NULL,
                   ack_id=NULL, ack_state=NULL, acknowledged_at=NULL,
                   error_code=?2, retryable=?3
                 WHERE artifact_id=?4 AND owner_user_id=?5 AND tenant_id=?6",
                params![
                    next,
                    error_code,
                    retryable,
                    identity.artifact_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
            )
            .map_err(map_sqlite_error)?;
        Ok(())
    }

    pub fn cancel_inflight_artifacts(
        &mut self,
        session_id: Uuid,
        turn_id: Uuid,
    ) -> Result<usize, ChatError> {
        if session_id.is_nil() || turn_id.is_nil() {
            return Err(ChatError::InvalidInput);
        }
        self.require_owned_artifact_turn(session_id, turn_id)?;
        self.connection
            .execute(
                "UPDATE chat_output_artifacts SET
                   state='cancelled', content_blob=NULL, poster_blob=NULL,
                   progress_stage=NULL, progress_percent=NULL,
                   local_committed_at=NULL, expires_at=NULL,
                   ack_id=NULL, ack_state=NULL, acknowledged_at=NULL,
                   error_code='turn_interrupted', retryable=0
                 WHERE owner_user_id=?1 AND tenant_id=?2 AND session_id=?3 AND turn_id=?4
                   AND state IN ('announced', 'generating', 'processing', 'transferring')",
                params![
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                    session_id.to_string(),
                    turn_id.to_string()
                ],
            )
            .map_err(map_sqlite_error)
    }

    pub fn begin_artifact_transfer(
        &mut self,
        manifest: &ArtifactManifest,
    ) -> Result<TransferDisposition, ChatError> {
        manifest.validate()?;
        self.require_owned_artifact_turn(manifest.local_session_id, manifest.local_turn_id)?;
        let existing = self
            .connection
            .query_row(
                "SELECT kind, provenance, state, ordinal, display_name, media_type, byte_size, sha256
                     FROM chat_output_artifacts
                     WHERE artifact_id=?1 AND owner_user_id=?2 AND tenant_id=?3",
                params![
                    manifest.artifact_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| {
                    Ok(ArtifactTransferRow {
                        kind: row.get(0)?,
                        provenance: row.get(1)?,
                        state: row.get(2)?,
                        ordinal: row.get(3)?,
                        display_name: row.get(4)?,
                        media_type: row.get(5)?,
                        size_bytes: row.get(6)?,
                        sha256: row.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(map_sqlite_error)?;
        if let Some(existing) = existing {
            let identity_matches = existing.kind == manifest.kind.as_str()
                && existing.provenance == manifest.provenance.as_str()
                && usize::try_from(existing.ordinal).ok() == Some(manifest.ordinal)
                && existing.display_name == manifest.display_name;
            if !identity_matches {
                return Err(ChatError::ConversationConflict);
            }
            return match existing.state.as_str() {
                "announced" | "generating" | "processing" => {
                    if existing.media_type.is_some()
                        || existing.size_bytes.is_some()
                        || existing.sha256.is_some()
                    {
                        return Err(ChatError::ConversationConflict);
                    }
                    self.connection
                        .execute(
                            "UPDATE chat_output_artifacts SET
                               state='transferring', media_type=?1, byte_size=?2, sha256=?3
                             WHERE artifact_id=?4 AND owner_user_id=?5 AND tenant_id=?6",
                            params![
                                manifest.media_type,
                                i64::try_from(manifest.size_bytes)
                                    .map_err(|_| ChatError::InvalidInput)?,
                                manifest.sha256,
                                manifest.artifact_id.to_string(),
                                self.scope.owner_user_id,
                                self.scope.tenant_id
                            ],
                        )
                        .map_err(map_sqlite_error)?;
                    Ok(TransferDisposition::Fetch)
                }
                "transferring" | "ready" | "expired"
                    if existing.media_type.as_deref() == Some(manifest.media_type.as_str())
                        && existing
                            .size_bytes
                            .and_then(|value| usize::try_from(value).ok())
                            == Some(manifest.size_bytes)
                        && existing.sha256.as_deref() == Some(manifest.sha256.as_str()) =>
                {
                    if existing.state == "transferring" {
                        Ok(TransferDisposition::Fetch)
                    } else {
                        Ok(TransferDisposition::AlreadyCommitted)
                    }
                }
                _ => Err(ChatError::ConversationConflict),
            };
        }
        Err(ChatError::NotFound)
    }

    pub fn commit_artifact(
        &mut self,
        manifest: &ArtifactManifest,
        downloaded: &DownloadedArtifact,
        local_committed_at: i64,
        ack_id: Uuid,
    ) -> Result<ArtifactCommit, ChatError> {
        self.commit_artifact_internal(manifest, downloaded, local_committed_at, ack_id, None)
    }

    pub fn commit_artifact_with_cursor(
        &mut self,
        manifest: &ArtifactManifest,
        downloaded: &DownloadedArtifact,
        local_committed_at: i64,
        ack_id: Uuid,
        progress: &TurnProgress,
    ) -> Result<ArtifactCommit, ChatError> {
        self.commit_artifact_internal(
            manifest,
            downloaded,
            local_committed_at,
            ack_id,
            Some(progress),
        )
    }

    fn commit_artifact_internal(
        &mut self,
        manifest: &ArtifactManifest,
        downloaded: &DownloadedArtifact,
        local_committed_at: i64,
        ack_id: Uuid,
        progress: Option<&TurnProgress>,
    ) -> Result<ArtifactCommit, ChatError> {
        manifest.validate()?;
        validate_downloaded(manifest, downloaded)?;
        if local_committed_at < 0 || ack_id.is_nil() {
            return Err(ChatError::InvalidInput);
        }
        let expires_at = local_committed_at
            .checked_add(ARTIFACT_RETENTION_SECONDS)
            .ok_or(ChatError::InvalidInput)?;
        let transaction = self.connection.transaction().map_err(map_sqlite_error)?;
        if let Some(progress) = progress {
            persist_turn_progress_on_connection(&transaction, &self.scope, progress)?;
        }
        let row_id: i64 = transaction
            .query_row(
                "SELECT rowid FROM chat_output_artifacts
                 WHERE artifact_id=?1 AND owner_user_id=?2 AND tenant_id=?3
                   AND session_id=?4 AND turn_id=?5 AND state='transferring'
                   AND kind=?6 AND provenance=?7 AND ordinal=?8
                   AND media_type=?9 AND byte_size=?10 AND sha256=?11",
                params![
                    manifest.artifact_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                    manifest.local_session_id.to_string(),
                    manifest.local_turn_id.to_string(),
                    manifest.kind.as_str(),
                    manifest.provenance.as_str(),
                    i64::try_from(manifest.ordinal).map_err(|_| ChatError::InvalidInput)?,
                    manifest.media_type,
                    i64::try_from(manifest.size_bytes).map_err(|_| ChatError::InvalidInput)?,
                    manifest.sha256,
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(map_sqlite_error)?
            .ok_or(ChatError::ConversationConflict)?;
        let poster = downloaded.poster.as_ref();
        let changed = transaction
            .execute(
                "UPDATE chat_output_artifacts SET
                   state='ready', progress_stage=NULL, progress_percent=NULL,
                   content_blob=zeroblob(?1),
                   poster_media_type=?2, poster_byte_size=?3, poster_sha256=?4,
                   poster_blob=CASE WHEN ?3 IS NULL THEN NULL ELSE zeroblob(?3) END,
                   local_committed_at=?5, expires_at=?6,
                   ack_id=?7, ack_state='pending', acknowledged_at=NULL
                 WHERE rowid=?8 AND state='transferring'",
                params![
                    i64::try_from(downloaded.content.bytes.len())
                        .map_err(|_| ChatError::InvalidInput)?,
                    poster.map(|value| value.media_type.as_str()),
                    poster
                        .map(|value| i64::try_from(value.bytes.len()))
                        .transpose()
                        .map_err(|_| ChatError::InvalidInput)?,
                    poster.map(|value| value.sha256.as_str()),
                    local_committed_at,
                    expires_at,
                    ack_id.to_string(),
                    row_id,
                ],
            )
            .map_err(map_sqlite_error)?;
        if changed != 1 {
            return Err(ChatError::ConversationConflict);
        }
        {
            let mut blob = transaction
                .blob_open(
                    "main",
                    "chat_output_artifacts",
                    "content_blob",
                    row_id,
                    false,
                )
                .map_err(map_sqlite_error)?;
            blob.write_all(&downloaded.content.bytes)
                .map_err(|_| ChatError::DatabaseUnavailable)?;
        }
        if let Some(poster) = poster {
            let mut blob = transaction
                .blob_open(
                    "main",
                    "chat_output_artifacts",
                    "poster_blob",
                    row_id,
                    false,
                )
                .map_err(map_sqlite_error)?;
            blob.write_all(&poster.bytes)
                .map_err(|_| ChatError::DatabaseUnavailable)?;
        }
        transaction.commit().map_err(map_sqlite_error)?;
        Ok(ArtifactCommit {
            artifact_id: manifest.artifact_id,
            ack_id,
            local_committed_at,
            expires_at,
        })
    }

    pub fn artifact_commit(
        &self,
        manifest: &ArtifactManifest,
    ) -> Result<StoredArtifactCommit, ChatError> {
        manifest.validate()?;
        let row: Option<(String, String, i64, i64, String)> = self
            .connection
            .query_row(
                "SELECT ack_id, ack_state, local_committed_at, expires_at, state
                 FROM chat_output_artifacts
                 WHERE artifact_id=?1 AND owner_user_id=?2 AND tenant_id=?3
                   AND session_id=?4 AND turn_id=?5 AND kind=?6 AND provenance=?7
                   AND ordinal=?8 AND media_type=?9 AND byte_size=?10 AND sha256=?11
                   AND state IN ('ready', 'expired')",
                params![
                    manifest.artifact_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                    manifest.local_session_id.to_string(),
                    manifest.local_turn_id.to_string(),
                    manifest.kind.as_str(),
                    manifest.provenance.as_str(),
                    i64::try_from(manifest.ordinal).map_err(|_| ChatError::InvalidInput)?,
                    manifest.media_type,
                    i64::try_from(manifest.size_bytes).map_err(|_| ChatError::InvalidInput)?,
                    manifest.sha256,
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .optional()
            .map_err(map_sqlite_error)?;
        let (ack_id, ack_state, local_committed_at, expires_at, state) =
            row.ok_or(ChatError::NotFound)?;
        Ok(StoredArtifactCommit {
            commit: ArtifactCommit {
                artifact_id: manifest.artifact_id,
                ack_id: parse_uuid(&ack_id)?,
                local_committed_at,
                expires_at,
            },
            host_acknowledged: ack_state == "acknowledged",
            expired: state == "expired",
        })
    }

    pub fn mark_artifact_acknowledged(
        &mut self,
        artifact_id: Uuid,
        ack_id: Uuid,
        acknowledged_at: i64,
    ) -> Result<(), ChatError> {
        if artifact_id.is_nil() || ack_id.is_nil() || acknowledged_at < 0 {
            return Err(ChatError::InvalidInput);
        }
        let changed = self
            .connection
            .execute(
                "UPDATE chat_output_artifacts
                 SET ack_state='acknowledged', acknowledged_at=COALESCE(acknowledged_at, ?1)
                 WHERE artifact_id=?2 AND owner_user_id=?3 AND tenant_id=?4
                   AND state='ready' AND ack_id=?5 AND ack_state IN ('pending', 'acknowledged')",
                params![
                    acknowledged_at,
                    artifact_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                    ack_id.to_string()
                ],
            )
            .map_err(map_sqlite_error)?;
        if changed != 1 {
            return Err(ChatError::NotFound);
        }
        Ok(())
    }

    pub fn pending_artifact_acknowledgements(
        &self,
        limit: usize,
    ) -> Result<Vec<PendingArtifactAcknowledgement>, ChatError> {
        if !(1..=64).contains(&limit) {
            return Err(ChatError::InvalidInput);
        }
        type PendingRow = (
            String,
            String,
            String,
            String,
            String,
            i64,
            Option<String>,
            String,
            i64,
            String,
            bool,
            String,
            String,
            i64,
            i64,
        );
        let mut statement = self
            .connection
            .prepare(
                "SELECT a.artifact_id, a.session_id, a.turn_id, a.kind, a.provenance,
                        a.ordinal, a.display_name, a.media_type, a.byte_size, a.sha256,
                        a.poster_media_type IS NOT NULL, s.agent_session_id,
                        a.ack_id, a.local_committed_at, a.expires_at
                 FROM chat_output_artifacts a
                 JOIN chat_sessions s ON s.id=a.session_id
                 WHERE a.owner_user_id=?1 AND a.tenant_id=?2
                   AND a.state='ready' AND a.ack_state='pending'
                 ORDER BY a.local_committed_at, a.artifact_id
                 LIMIT ?3",
            )
            .map_err(map_sqlite_error)?;
        let rows = statement
            .query_map(
                params![
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                    i64::try_from(limit).map_err(|_| ChatError::InvalidInput)?
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                        row.get(9)?,
                        row.get(10)?,
                        row.get(11)?,
                        row.get(12)?,
                        row.get(13)?,
                        row.get(14)?,
                    ))
                },
            )
            .map_err(map_sqlite_error)?
            .collect::<rusqlite::Result<Vec<PendingRow>>>()
            .map_err(map_sqlite_error)?;
        rows.into_iter()
            .map(
                |(
                    artifact_id,
                    session_id,
                    turn_id,
                    kind,
                    provenance,
                    ordinal,
                    display_name,
                    media_type,
                    byte_size,
                    sha256,
                    has_poster,
                    agent_session_id,
                    ack_id,
                    local_committed_at,
                    expires_at,
                )| {
                    let artifact_id = parse_uuid(&artifact_id)?;
                    let agent_session_id = parse_uuid(&agent_session_id)?;
                    let manifest = ArtifactManifest {
                        artifact_id,
                        agent_session_id,
                        local_session_id: parse_uuid(&session_id)?,
                        local_turn_id: parse_uuid(&turn_id)?,
                        kind: ArtifactKind::parse(&kind)?,
                        provenance: ArtifactProvenance::parse(&provenance)?,
                        ordinal: usize::try_from(ordinal)
                            .map_err(|_| ChatError::DatabaseUnavailable)?,
                        display_name,
                        media_type,
                        size_bytes: usize::try_from(byte_size)
                            .map_err(|_| ChatError::DatabaseUnavailable)?,
                        sha256,
                        content_href: format!(
                            "/v3/agent-sessions/{agent_session_id}/artifacts/{artifact_id}/content"
                        ),
                        poster_href: has_poster.then(|| {
                            format!(
                                "/v3/agent-sessions/{agent_session_id}/artifacts/{artifact_id}/poster"
                            )
                        }),
                    };
                    manifest.validate()?;
                    Ok(PendingArtifactAcknowledgement {
                        manifest,
                        commit: ArtifactCommit {
                            artifact_id,
                            ack_id: parse_uuid(&ack_id)?,
                            local_committed_at,
                            expires_at,
                        },
                    })
                },
            )
            .collect()
    }

    pub(crate) fn read_ready_image(
        &self,
        session_id: Uuid,
        turn_id: Uuid,
        artifact_id: Uuid,
        now: i64,
    ) -> Result<Result<ReadyImageContent, ReadyImageReadError>, ChatError> {
        if session_id.is_nil() || turn_id.is_nil() || artifact_id.is_nil() || now < 0 {
            return Ok(Err(ReadyImageReadError::NotFound));
        }
        type ReadyRow = (
            i64,
            String,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<i64>,
            Option<String>,
            Option<i64>,
            Option<i64>,
        );
        let row: Option<ReadyRow> = self
            .connection
            .query_row(
                "SELECT a.rowid, a.owner_user_id, a.tenant_id, a.state, a.kind,
                        a.display_name, a.media_type, a.byte_size, a.sha256, a.expires_at,
                        length(a.content_blob)
                 FROM chat_output_artifacts a
                 JOIN chat_sessions s ON s.id=a.session_id
                 JOIN chat_turns t ON t.id=a.turn_id AND t.session_id=s.id
                 WHERE a.artifact_id=?1 AND a.session_id=?2 AND a.turn_id=?3
                   AND a.owner_user_id=?4 AND a.tenant_id=?5
                   AND s.owner_user_id=a.owner_user_id AND s.tenant_id=a.tenant_id",
                params![
                    artifact_id.to_string(),
                    session_id.to_string(),
                    turn_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                        row.get(9)?,
                        row.get(10)?,
                    ))
                },
            )
            .optional()
            .map_err(map_sqlite_error)?;
        let Some((
            row_id,
            owner_user_id,
            tenant_id,
            state,
            kind,
            display_name,
            media_type,
            size_bytes,
            sha256,
            expires_at,
            blob_length,
        )) = row
        else {
            return Ok(Err(ReadyImageReadError::NotFound));
        };
        if state == "expired" || expires_at.is_some_and(|value| value <= now) {
            return Ok(Err(ReadyImageReadError::Expired));
        }
        if state != "ready" {
            return Ok(Err(ReadyImageReadError::NotReady));
        }
        if kind != "image" {
            return Ok(Err(ReadyImageReadError::Unsupported));
        }
        let media_type = match media_type.as_deref() {
            Some("image/png") => "image/png",
            Some("image/jpeg") => "image/jpeg",
            Some("image/webp") => "image/webp",
            _ => return Ok(Err(ReadyImageReadError::Unsupported)),
        };
        let Some(size_bytes) = size_bytes.and_then(|value| usize::try_from(value).ok()) else {
            return Ok(Err(ReadyImageReadError::Integrity));
        };
        if !(1..=MAX_IMAGE_BYTES).contains(&size_bytes)
            || blob_length.and_then(|value| usize::try_from(value).ok()) != Some(size_bytes)
            || display_name
                .as_deref()
                .is_some_and(|value| !valid_safe_name(value))
        {
            return Ok(Err(ReadyImageReadError::Integrity));
        }
        let Some(expected_sha256) = sha256.as_deref().and_then(decode_sha256) else {
            return Ok(Err(ReadyImageReadError::Integrity));
        };
        let owner_user_id = parse_uuid(&owner_user_id)?;
        let tenant_id = parse_uuid(&tenant_id)?;
        let mut bytes = vec![0_u8; size_bytes];
        {
            let mut blob = self
                .connection
                .blob_open(
                    "main",
                    "chat_output_artifacts",
                    "content_blob",
                    row_id,
                    true,
                )
                .map_err(map_sqlite_error)?;
            blob.read_exact(&mut bytes)
                .map_err(|_| ChatError::DatabaseUnavailable)?;
        }
        let actual_sha256: [u8; 32] = Sha256::digest(&bytes).into();
        if !bool::from(subtle::ConstantTimeEq::ct_eq(
            actual_sha256.as_slice(),
            expected_sha256.as_slice(),
        )) || validate_image_content(media_type, &bytes).is_err()
        {
            return Ok(Err(ReadyImageReadError::Integrity));
        }
        Ok(Ok(ReadyImageContent {
            identity: ReadyImageIdentity {
                owner_user_id,
                tenant_id,
                session_id,
                turn_id,
                artifact_id,
            },
            display_name,
            media_type,
            size_bytes,
            sha256: expected_sha256,
            bytes,
        }))
    }

    pub(crate) fn read_ready_video(
        &self,
        session_id: Uuid,
        turn_id: Uuid,
        artifact_id: Uuid,
        now: i64,
    ) -> Result<Result<ReadyVideoContent, ReadyVideoReadError>, ChatError> {
        if session_id.is_nil() || turn_id.is_nil() || artifact_id.is_nil() || now < 0 {
            return Ok(Err(ReadyVideoReadError::NotFound));
        }
        type ReadyRow = (
            i64,
            String,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<i64>,
            Option<String>,
            Option<i64>,
            Option<i64>,
        );
        let row: Option<ReadyRow> = self
            .connection
            .query_row(
                "SELECT a.rowid, a.owner_user_id, a.tenant_id, a.state, a.kind,
                        a.display_name, a.media_type, a.byte_size, a.sha256, a.expires_at,
                        length(a.content_blob)
                 FROM chat_output_artifacts a
                 JOIN chat_sessions s ON s.id=a.session_id
                 JOIN chat_turns t ON t.id=a.turn_id AND t.session_id=s.id
                 WHERE a.artifact_id=?1 AND a.session_id=?2 AND a.turn_id=?3
                   AND a.owner_user_id=?4 AND a.tenant_id=?5
                   AND s.owner_user_id=a.owner_user_id AND s.tenant_id=a.tenant_id",
                params![
                    artifact_id.to_string(),
                    session_id.to_string(),
                    turn_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                        row.get(9)?,
                        row.get(10)?,
                    ))
                },
            )
            .optional()
            .map_err(map_sqlite_error)?;
        let Some((
            row_id,
            owner_user_id,
            tenant_id,
            state,
            kind,
            display_name,
            media_type,
            size_bytes,
            sha256,
            expires_at,
            blob_length,
        )) = row
        else {
            return Ok(Err(ReadyVideoReadError::NotFound));
        };
        if state == "expired" || expires_at.is_some_and(|value| value <= now) {
            return Ok(Err(ReadyVideoReadError::Expired));
        }
        if state != "ready" {
            return Ok(Err(ReadyVideoReadError::NotReady));
        }
        if kind != "video" || media_type.as_deref() != Some("video/mp4") {
            return Ok(Err(ReadyVideoReadError::Unsupported));
        }
        let Some(size_bytes) = size_bytes.and_then(|value| usize::try_from(value).ok()) else {
            return Ok(Err(ReadyVideoReadError::Integrity));
        };
        if !(1..=MAX_ARTIFACT_BYTES).contains(&size_bytes)
            || blob_length.and_then(|value| usize::try_from(value).ok()) != Some(size_bytes)
            || display_name
                .as_deref()
                .is_some_and(|value| !valid_safe_name(value))
        {
            return Ok(Err(ReadyVideoReadError::Integrity));
        }
        let Some(expected_sha256) = sha256.as_deref().and_then(decode_sha256) else {
            return Ok(Err(ReadyVideoReadError::Integrity));
        };
        let owner_user_id = parse_uuid(&owner_user_id)?;
        let tenant_id = parse_uuid(&tenant_id)?;
        let mut bytes = vec![0_u8; size_bytes];
        {
            let mut blob = self
                .connection
                .blob_open(
                    "main",
                    "chat_output_artifacts",
                    "content_blob",
                    row_id,
                    true,
                )
                .map_err(map_sqlite_error)?;
            blob.read_exact(&mut bytes)
                .map_err(|_| ChatError::DatabaseUnavailable)?;
        }
        let actual_sha256: [u8; 32] = Sha256::digest(&bytes).into();
        if !bool::from(subtle::ConstantTimeEq::ct_eq(
            actual_sha256.as_slice(),
            expected_sha256.as_slice(),
        )) || super::artifact_video_native::validate_mp4(&bytes).is_err()
        {
            return Ok(Err(ReadyVideoReadError::Integrity));
        }
        Ok(Ok(ReadyVideoContent {
            identity: ReadyVideoIdentity {
                owner_user_id,
                tenant_id,
                session_id,
                turn_id,
                artifact_id,
            },
            display_name,
            media_type: "video/mp4",
            size_bytes,
            sha256: expected_sha256,
            bytes,
        }))
    }

    pub(crate) fn read_ready_file(
        &self,
        session_id: Uuid,
        turn_id: Uuid,
        artifact_id: Uuid,
        now: i64,
        max_bytes: usize,
    ) -> Result<Result<ReadyFileContent, ReadyFileReadError>, ChatError> {
        if session_id.is_nil()
            || turn_id.is_nil()
            || artifact_id.is_nil()
            || now < 0
            || !(1..=MAX_ARTIFACT_BYTES).contains(&max_bytes)
        {
            return Ok(Err(ReadyFileReadError::NotFound));
        }
        type ReadyRow = (
            i64,
            String,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<i64>,
            Option<String>,
            Option<i64>,
            Option<i64>,
            Option<i64>,
        );
        let row: Option<ReadyRow> = self
            .connection
            .query_row(
                "SELECT a.rowid, a.owner_user_id, a.tenant_id, a.state, a.kind,
                        a.display_name, a.media_type, a.byte_size, a.sha256, a.expires_at,
                        a.local_committed_at, length(a.content_blob)
                 FROM chat_output_artifacts a
                 JOIN chat_sessions s ON s.id=a.session_id
                 JOIN chat_turns t ON t.id=a.turn_id AND t.session_id=s.id
                 WHERE a.artifact_id=?1 AND a.session_id=?2 AND a.turn_id=?3
                   AND a.owner_user_id=?4 AND a.tenant_id=?5
                   AND s.owner_user_id=a.owner_user_id AND s.tenant_id=a.tenant_id",
                params![
                    artifact_id.to_string(),
                    session_id.to_string(),
                    turn_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                        row.get(9)?,
                        row.get(10)?,
                        row.get(11)?,
                    ))
                },
            )
            .optional()
            .map_err(map_sqlite_error)?;
        let Some((
            row_id,
            owner_user_id,
            tenant_id,
            state,
            kind,
            display_name,
            media_type,
            size_bytes,
            sha256,
            expires_at,
            revision,
            blob_length,
        )) = row
        else {
            return Ok(Err(ReadyFileReadError::NotFound));
        };
        if state == "expired" || expires_at.is_some_and(|value| value <= now) {
            return Ok(Err(ReadyFileReadError::Expired));
        }
        if state != "ready" {
            return Ok(Err(ReadyFileReadError::NotReady));
        }
        if kind != "file" {
            return Ok(Err(ReadyFileReadError::Unsupported));
        }
        let media_type = match media_type.as_deref() {
            Some("text/plain") => "text/plain",
            Some("text/csv") => "text/csv",
            Some("application/json") => "application/json",
            Some("application/pdf") => "application/pdf",
            Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") => {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            }
            _ => return Ok(Err(ReadyFileReadError::Unsupported)),
        };
        let Some(size_bytes) = size_bytes.and_then(|value| usize::try_from(value).ok()) else {
            return Ok(Err(ReadyFileReadError::Integrity));
        };
        let Some(revision) = revision.filter(|value| *value >= 0) else {
            return Ok(Err(ReadyFileReadError::Integrity));
        };
        if !(1..=MAX_ARTIFACT_BYTES).contains(&size_bytes) {
            return Ok(Err(ReadyFileReadError::Integrity));
        }
        if size_bytes > max_bytes {
            return Ok(Err(ReadyFileReadError::LimitExceeded));
        }
        if blob_length.and_then(|value| usize::try_from(value).ok()) != Some(size_bytes)
            || display_name
                .as_deref()
                .is_some_and(|value| !valid_safe_name(value))
        {
            return Ok(Err(ReadyFileReadError::Integrity));
        }
        let Some(expected_sha256) = sha256.as_deref().and_then(decode_sha256) else {
            return Ok(Err(ReadyFileReadError::Integrity));
        };
        let owner_user_id = parse_uuid(&owner_user_id)?;
        let tenant_id = parse_uuid(&tenant_id)?;
        let mut bytes = vec![0_u8; size_bytes];
        {
            let mut blob = self
                .connection
                .blob_open(
                    "main",
                    "chat_output_artifacts",
                    "content_blob",
                    row_id,
                    true,
                )
                .map_err(map_sqlite_error)?;
            blob.read_exact(&mut bytes)
                .map_err(|_| ChatError::DatabaseUnavailable)?;
        }
        let actual_sha256: [u8; 32] = Sha256::digest(&bytes).into();
        if !bool::from(subtle::ConstantTimeEq::ct_eq(
            actual_sha256.as_slice(),
            expected_sha256.as_slice(),
        )) {
            return Ok(Err(ReadyFileReadError::Integrity));
        }
        Ok(Ok(ReadyFileContent {
            identity: ReadyFileIdentity {
                owner_user_id,
                tenant_id,
                session_id,
                turn_id,
                artifact_id,
            },
            display_name,
            media_type,
            size_bytes,
            sha256: expected_sha256,
            revision,
            bytes,
        }))
    }

    pub(crate) fn read_ready_report(
        &self,
        session_id: Uuid,
        turn_id: Uuid,
        artifact_id: Uuid,
        now: i64,
        max_bytes: usize,
    ) -> Result<Result<ReadyReportContent, ReadyReportReadError>, ChatError> {
        if session_id.is_nil()
            || turn_id.is_nil()
            || artifact_id.is_nil()
            || now < 0
            || !(1..=MAX_ARTIFACT_BYTES).contains(&max_bytes)
        {
            return Ok(Err(ReadyReportReadError::NotFound));
        }
        type ReadyRow = (
            i64,
            String,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<i64>,
            Option<String>,
            Option<i64>,
            Option<i64>,
            Option<i64>,
        );
        let row: Option<ReadyRow> = self
            .connection
            .query_row(
                "SELECT a.rowid, a.owner_user_id, a.tenant_id, a.state, a.kind,
                        a.display_name, a.media_type, a.byte_size, a.sha256, a.expires_at,
                        a.local_committed_at, length(a.content_blob)
                 FROM chat_output_artifacts a
                 JOIN chat_sessions s ON s.id=a.session_id
                 JOIN chat_turns t ON t.id=a.turn_id AND t.session_id=s.id
                 WHERE a.artifact_id=?1 AND a.session_id=?2 AND a.turn_id=?3
                   AND a.owner_user_id=?4 AND a.tenant_id=?5
                   AND s.owner_user_id=a.owner_user_id AND s.tenant_id=a.tenant_id",
                params![
                    artifact_id.to_string(),
                    session_id.to_string(),
                    turn_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                        row.get(9)?,
                        row.get(10)?,
                        row.get(11)?,
                    ))
                },
            )
            .optional()
            .map_err(map_sqlite_error)?;
        let Some((
            row_id,
            owner_user_id,
            tenant_id,
            state,
            kind,
            display_name,
            media_type,
            size_bytes,
            sha256,
            expires_at,
            revision,
            blob_length,
        )) = row
        else {
            return Ok(Err(ReadyReportReadError::NotFound));
        };
        if state == "expired" || expires_at.is_some_and(|value| value <= now) {
            return Ok(Err(ReadyReportReadError::Expired));
        }
        if state != "ready" {
            return Ok(Err(ReadyReportReadError::NotReady));
        }
        if kind != "report" {
            return Ok(Err(ReadyReportReadError::Unsupported));
        }
        let media_type = match media_type.as_deref() {
            Some("application/vnd.yijie.report+json;version=1") => {
                "application/vnd.yijie.report+json;version=1"
            }
            _ => return Ok(Err(ReadyReportReadError::Unsupported)),
        };
        let Some(size_bytes) = size_bytes.and_then(|value| usize::try_from(value).ok()) else {
            return Ok(Err(ReadyReportReadError::Integrity));
        };
        let Some(revision) = revision.filter(|value| *value >= 0) else {
            return Ok(Err(ReadyReportReadError::Integrity));
        };
        if !(1..=MAX_ARTIFACT_BYTES).contains(&size_bytes) {
            return Ok(Err(ReadyReportReadError::Integrity));
        }
        if size_bytes > max_bytes {
            return Ok(Err(ReadyReportReadError::LimitExceeded));
        }
        if blob_length.and_then(|value| usize::try_from(value).ok()) != Some(size_bytes)
            || display_name
                .as_deref()
                .is_some_and(|value| !valid_safe_name(value))
        {
            return Ok(Err(ReadyReportReadError::Integrity));
        }
        let Some(expected_sha256) = sha256.as_deref().and_then(decode_sha256) else {
            return Ok(Err(ReadyReportReadError::Integrity));
        };
        let owner_user_id = parse_uuid(&owner_user_id)?;
        let tenant_id = parse_uuid(&tenant_id)?;
        let mut bytes = vec![0_u8; size_bytes];
        {
            let mut blob = self
                .connection
                .blob_open(
                    "main",
                    "chat_output_artifacts",
                    "content_blob",
                    row_id,
                    true,
                )
                .map_err(map_sqlite_error)?;
            blob.read_exact(&mut bytes)
                .map_err(|_| ChatError::DatabaseUnavailable)?;
        }
        let actual_sha256: [u8; 32] = Sha256::digest(&bytes).into();
        if !bool::from(subtle::ConstantTimeEq::ct_eq(
            actual_sha256.as_slice(),
            expected_sha256.as_slice(),
        )) || validate_report_document(&bytes).is_err()
        {
            return Ok(Err(ReadyReportReadError::Integrity));
        }
        Ok(Ok(ReadyReportContent {
            identity: ReadyReportIdentity {
                owner_user_id,
                tenant_id,
                session_id,
                turn_id,
                artifact_id,
            },
            display_name,
            media_type,
            size_bytes,
            sha256: expected_sha256,
            revision,
            bytes,
        }))
    }

    pub(crate) fn read_ready_video_range(
        &self,
        request: ReadyVideoRangeRequest,
    ) -> Result<Result<ReadyVideoRangeContent, ReadyVideoReadError>, ChatError> {
        if request.session_id.is_nil()
            || request.turn_id.is_nil()
            || request.artifact_id.is_nil()
            || request.now < 0
            || request.expected_size == 0
            || request.expected_size > MAX_ARTIFACT_BYTES
            || request.start > request.expected_size
            || request
                .start
                .checked_add(request.length)
                .is_none_or(|end| end > request.expected_size)
        {
            return Ok(Err(ReadyVideoReadError::NotFound));
        }
        type ReadyRow = (
            i64,
            String,
            String,
            String,
            String,
            Option<String>,
            Option<i64>,
            Option<String>,
            Option<i64>,
            Option<i64>,
        );
        let row: Option<ReadyRow> = self
            .connection
            .query_row(
                "SELECT a.rowid, a.owner_user_id, a.tenant_id, a.state, a.kind,
                        a.media_type, a.byte_size, a.sha256, a.expires_at,
                        length(a.content_blob)
                 FROM chat_output_artifacts a
                 JOIN chat_sessions s ON s.id=a.session_id
                 JOIN chat_turns t ON t.id=a.turn_id AND t.session_id=s.id
                 WHERE a.artifact_id=?1 AND a.session_id=?2 AND a.turn_id=?3
                   AND a.owner_user_id=?4 AND a.tenant_id=?5
                   AND s.owner_user_id=a.owner_user_id AND s.tenant_id=a.tenant_id",
                params![
                    request.artifact_id.to_string(),
                    request.session_id.to_string(),
                    request.turn_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id,
                ],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                        row.get(9)?,
                    ))
                },
            )
            .optional()
            .map_err(map_sqlite_error)?;
        let Some((
            row_id,
            owner_user_id,
            tenant_id,
            state,
            kind,
            media_type,
            size_bytes,
            sha256,
            expires_at,
            blob_length,
        )) = row
        else {
            return Ok(Err(ReadyVideoReadError::NotFound));
        };
        if state == "expired" || expires_at.is_some_and(|value| value <= request.now) {
            return Ok(Err(ReadyVideoReadError::Expired));
        }
        if state != "ready" {
            return Ok(Err(ReadyVideoReadError::NotReady));
        }
        if kind != "video" || media_type.as_deref() != Some("video/mp4") {
            return Ok(Err(ReadyVideoReadError::Unsupported));
        }
        let Some(size_bytes) = size_bytes.and_then(|value| usize::try_from(value).ok()) else {
            return Ok(Err(ReadyVideoReadError::Integrity));
        };
        let Some(manifest_sha256) = sha256.as_deref().and_then(decode_sha256) else {
            return Ok(Err(ReadyVideoReadError::Integrity));
        };
        if size_bytes != request.expected_size
            || manifest_sha256 != request.expected_sha256
            || blob_length.and_then(|value| usize::try_from(value).ok())
                != Some(request.expected_size)
        {
            return Ok(Err(ReadyVideoReadError::Integrity));
        }
        let owner_user_id = parse_uuid(&owner_user_id)?;
        let tenant_id = parse_uuid(&tenant_id)?;
        let mut bytes = vec![0_u8; request.length];
        if request.length > 0 {
            let mut blob = self
                .connection
                .blob_open(
                    "main",
                    "chat_output_artifacts",
                    "content_blob",
                    row_id,
                    true,
                )
                .map_err(map_sqlite_error)?;
            blob.seek(SeekFrom::Start(
                u64::try_from(request.start).map_err(|_| ChatError::InvalidInput)?,
            ))
            .map_err(|_| ChatError::DatabaseUnavailable)?;
            blob.read_exact(&mut bytes)
                .map_err(|_| ChatError::DatabaseUnavailable)?;
        }
        Ok(Ok(ReadyVideoRangeContent {
            identity: ReadyVideoIdentity {
                owner_user_id,
                tenant_id,
                session_id: request.session_id,
                turn_id: request.turn_id,
                artifact_id: request.artifact_id,
            },
            size_bytes,
            sha256: manifest_sha256,
            bytes,
        }))
    }

    pub fn load_artifacts_for_turns(
        &self,
        turn_ids: &[Uuid],
    ) -> Result<Vec<ArtifactProjection>, ChatError> {
        load_artifacts_for_turns_from_connection(&self.connection, &self.scope, turn_ids)
    }

    pub fn purge_expired_artifacts(&mut self, now: i64) -> Result<usize, ChatError> {
        if now < 0 {
            return Err(ChatError::InvalidInput);
        }
        let transaction = self.connection.transaction().map_err(map_sqlite_error)?;
        let ids = {
            let mut statement = transaction
                .prepare(
                    "SELECT artifact_id FROM chat_output_artifacts
                     WHERE owner_user_id=?1 AND tenant_id=?2
                       AND state='ready' AND expires_at<=?3",
                )
                .map_err(map_sqlite_error)?;
            let result = statement
                .query_map(
                    params![self.scope.owner_user_id, self.scope.tenant_id, now],
                    |row| row.get::<_, String>(0),
                )
                .map_err(map_sqlite_error)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(map_sqlite_error)?;
            result
        };
        for artifact_id in &ids {
            transaction
                .execute(
                    "UPDATE chat_output_artifacts
                     SET state='expired', content_blob=NULL, poster_blob=NULL
                     WHERE artifact_id=?1 AND state='ready'",
                    [artifact_id],
                )
                .map_err(map_sqlite_error)?;
            transaction
                .execute(
                    "INSERT INTO chat_artifact_cleanup_receipts(
                       artifact_id, outcome_code, completed_at, schema_version
                     ) VALUES (?1, 'retention_expired', ?2, 1)
                     ON CONFLICT(artifact_id) DO UPDATE SET
                       completed_at=chat_artifact_cleanup_receipts.completed_at",
                    params![artifact_id, now],
                )
                .map_err(map_sqlite_error)?;
        }
        transaction.commit().map_err(map_sqlite_error)?;
        if !ids.is_empty() {
            self.checkpoint_after_delete()?;
        }
        Ok(ids.len())
    }
}

fn persist_turn_progress_on_connection(
    connection: &rusqlite::Connection,
    scope: &super::database::ChatScope,
    progress: &TurnProgress,
) -> Result<(), ChatError> {
    if progress.local_turn_id.is_nil() {
        return Err(ChatError::InvalidInput);
    }
    validate_message_output(&progress.assistant_text)?;
    validate_cursor(&progress.cursor)?;
    let session_id: String = connection
        .query_row(
            "SELECT t.session_id FROM chat_turns t JOIN chat_sessions s ON s.id=t.session_id
             WHERE t.id=?1 AND t.status IN ('streaming', 'stopping')
               AND s.owner_user_id=?2 AND s.tenant_id=?3",
            params![
                progress.local_turn_id.to_string(),
                scope.owner_user_id,
                scope.tenant_id
            ],
            |row| row.get(0),
        )
        .optional()
        .map_err(map_sqlite_error)?
        .ok_or(ChatError::ConversationConflict)?;
    let changed = connection
        .execute(
            "UPDATE chat_messages SET content=?1
             WHERE turn_id=?2 AND role='assistant' AND status='pending'",
            params![progress.assistant_text, progress.local_turn_id.to_string()],
        )
        .map_err(map_sqlite_error)?;
    if changed != 1 {
        return Err(ChatError::DatabaseUnavailable);
    }
    advance_cursor(connection, &session_id, &progress.cursor)
}

fn finish_manual_transaction<T>(
    connection: &rusqlite::Connection,
    result: Result<T, ChatError>,
) -> Result<T, ChatError> {
    match result {
        Ok(value) => match connection.execute_batch("COMMIT") {
            Ok(()) => Ok(value),
            Err(error) => {
                let _ = connection.execute_batch("ROLLBACK");
                Err(map_sqlite_error(error))
            }
        },
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

fn validate_downloaded(
    manifest: &ArtifactManifest,
    downloaded: &DownloadedArtifact,
) -> Result<(), ChatError> {
    validate_resource(
        manifest.kind,
        &manifest.media_type,
        manifest.size_bytes,
        &manifest.sha256,
        &downloaded.content,
    )?;
    match (&manifest.poster_href, &downloaded.poster) {
        (None, None) => {}
        (Some(_), Some(poster)) if manifest.kind == ArtifactKind::Video => {
            if !matches!(
                poster.media_type.as_str(),
                "image/png" | "image/jpeg" | "image/webp"
            ) || poster.size_bytes > MAX_IMAGE_BYTES
                || validate_image_content(&poster.media_type, &poster.bytes).is_err()
            {
                return Err(ChatError::InvalidInput);
            }
            validate_resource_bytes(poster)?;
        }
        _ => return Err(ChatError::InvalidInput),
    }
    validate_kind_content(
        manifest.kind,
        &manifest.media_type,
        &downloaded.content.bytes,
    )
}

fn validate_resource(
    kind: ArtifactKind,
    expected_media_type: &str,
    expected_size: usize,
    expected_sha256: &str,
    resource: &DownloadedResource,
) -> Result<(), ChatError> {
    if resource.media_type != expected_media_type
        || resource.size_bytes != expected_size
        || resource.sha256 != expected_sha256
        || resource.bytes.len() > max_bytes(kind)
    {
        return Err(ChatError::InvalidInput);
    }
    validate_resource_bytes(resource)
}

fn validate_resource_bytes(resource: &DownloadedResource) -> Result<(), ChatError> {
    if resource.bytes.len() != resource.size_bytes
        || !valid_sha256(&resource.sha256)
        || format!("{:x}", Sha256::digest(&resource.bytes)) != resource.sha256
    {
        return Err(ChatError::InvalidInput);
    }
    Ok(())
}

fn validate_kind_content(
    kind: ArtifactKind,
    media_type: &str,
    bytes: &[u8],
) -> Result<(), ChatError> {
    let valid = match kind {
        ArtifactKind::Image => validate_image_content(media_type, bytes).is_ok(),
        ArtifactKind::Video => {
            bytes.len() >= 12
                && bytes.get(4..8) == Some(b"ftyp")
                && bytes[8..12].iter().all(u8::is_ascii)
        }
        ArtifactKind::File => match media_type {
            "text/plain" | "text/csv" => std::str::from_utf8(bytes)
                .map(|text| !text.contains('\0'))
                .unwrap_or(false),
            "application/json" => serde_json::from_slice::<Value>(bytes).is_ok(),
            "application/pdf" => bytes.starts_with(b"%PDF-") && bytes.ends_with(b"%%EOF"),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => {
                bytes.starts_with(b"PK\x03\x04")
            }
            _ => false,
        },
        ArtifactKind::Report => validate_report_document(bytes).is_ok(),
    };
    valid.then_some(()).ok_or(ChatError::InvalidInput)
}

pub(super) fn validate_report_document(bytes: &[u8]) -> Result<(), ChatError> {
    let document: Value = serde_json::from_slice(bytes).map_err(|_| ChatError::InvalidInput)?;
    let root = document.as_object().ok_or(ChatError::InvalidInput)?;
    exact_keys(
        root,
        &["schema_version", "title", "generated_at", "sections"],
        &["source_time"],
    )?;
    if root.get("schema_version").and_then(Value::as_u64) != Some(1)
        || !safe_text(root.get("title"), 1, 200)
        || !safe_timestamp(root.get("generated_at"))
        || root
            .get("source_time")
            .is_some_and(|value| !safe_timestamp(Some(value)))
    {
        return Err(ChatError::InvalidInput);
    }
    let sections = root
        .get("sections")
        .and_then(Value::as_array)
        .filter(|sections| sections.len() <= 64)
        .ok_or(ChatError::InvalidInput)?;
    for section in sections {
        let envelope = section.as_object().ok_or(ChatError::InvalidInput)?;
        exact_keys(envelope, &["id", "type", "required", "payload"], &[])?;
        envelope
            .get("id")
            .and_then(Value::as_str)
            .filter(|value| valid_report_identifier(value, true))
            .ok_or(ChatError::InvalidInput)?;
        let section_type = envelope
            .get("type")
            .and_then(Value::as_str)
            .filter(|value| (1..=64).contains(&value.chars().count()))
            .ok_or(ChatError::InvalidInput)?;
        let required = envelope
            .get("required")
            .and_then(Value::as_bool)
            .ok_or(ChatError::InvalidInput)?;
        let payload = envelope.get("payload").ok_or(ChatError::InvalidInput)?;
        if matches!(
            section_type,
            "summary" | "metrics" | "paragraph" | "table" | "chart" | "callout"
        ) {
            validate_known_report_section(section_type, payload)?;
        } else if required
            || serde_json::to_vec(payload)
                .map(|encoded| encoded.len() > MAX_UNKNOWN_REPORT_PAYLOAD_BYTES)
                .unwrap_or(true)
            || json_depth(payload) > MAX_UNKNOWN_REPORT_DEPTH
        {
            return Err(ChatError::InvalidInput);
        }
    }
    Ok(())
}

fn validate_known_report_section(kind: &str, payload: &Value) -> Result<(), ChatError> {
    let object = payload.as_object().ok_or(ChatError::InvalidInput)?;
    match kind {
        "summary" | "paragraph" => {
            exact_keys(object, &["text"], &["heading"])?;
            if !safe_text(object.get("text"), 0, 16_384)
                || object
                    .get("heading")
                    .is_some_and(|value| !safe_text(Some(value), 0, 16_384))
            {
                return Err(ChatError::InvalidInput);
            }
        }
        "metrics" => {
            exact_keys(object, &["items"], &[])?;
            let items = object
                .get("items")
                .and_then(Value::as_array)
                .filter(|items| (1..=32).contains(&items.len()))
                .ok_or(ChatError::InvalidInput)?;
            for item in items {
                let item = item.as_object().ok_or(ChatError::InvalidInput)?;
                exact_keys(item, &["label", "value"], &["unit"])?;
                if !safe_text(item.get("label"), 1, 80)
                    || !matches!(
                        item.get("value"),
                        Some(Value::Number(_)) | Some(Value::String(_))
                    )
                    || item
                        .get("value")
                        .and_then(Value::as_str)
                        .is_some_and(|value| value.chars().count() > 128 || contains_markup(value))
                    || item
                        .get("unit")
                        .is_some_and(|value| !safe_text(Some(value), 0, 32))
                {
                    return Err(ChatError::InvalidInput);
                }
            }
        }
        "table" => validate_table_section(object)?,
        "chart" => validate_chart_section(object)?,
        "callout" => {
            exact_keys(object, &["tone", "text"], &["title"])?;
            if !matches!(
                object.get("tone").and_then(Value::as_str),
                Some("info" | "success" | "warning" | "error")
            ) || !safe_text(object.get("text"), 0, 16_384)
                || object
                    .get("title")
                    .is_some_and(|value| !safe_text(Some(value), 0, 16_384))
            {
                return Err(ChatError::InvalidInput);
            }
        }
        _ => return Err(ChatError::InvalidInput),
    }
    Ok(())
}

fn validate_table_section(object: &Map<String, Value>) -> Result<(), ChatError> {
    exact_keys(object, &["columns", "rows"], &["caption"])?;
    if object
        .get("caption")
        .is_some_and(|value| !safe_text(Some(value), 0, 16_384))
    {
        return Err(ChatError::InvalidInput);
    }
    let columns = object
        .get("columns")
        .and_then(Value::as_array)
        .filter(|values| (1..=32).contains(&values.len()))
        .ok_or(ChatError::InvalidInput)?;
    for column in columns {
        let column = column.as_object().ok_or(ChatError::InvalidInput)?;
        exact_keys(column, &["key", "label"], &[])?;
        column
            .get("key")
            .and_then(Value::as_str)
            .filter(|value| valid_report_identifier(value, false))
            .ok_or(ChatError::InvalidInput)?;
        if !safe_text(column.get("label"), 1, 80) {
            return Err(ChatError::InvalidInput);
        }
    }
    let rows = object
        .get("rows")
        .and_then(Value::as_array)
        .filter(|rows| rows.len() <= 1000)
        .ok_or(ChatError::InvalidInput)?;
    for row in rows {
        let row = row
            .as_object()
            .filter(|row| row.len() <= 32)
            .ok_or(ChatError::InvalidInput)?;
        for (key, value) in row {
            if !valid_report_identifier(key, false)
                || !matches!(
                    value,
                    Value::String(_) | Value::Number(_) | Value::Bool(_) | Value::Null
                )
                || value
                    .as_str()
                    .is_some_and(|text| text.chars().count() > 4096 || contains_markup(text))
            {
                return Err(ChatError::InvalidInput);
            }
        }
    }
    Ok(())
}

fn validate_chart_section(object: &Map<String, Value>) -> Result<(), ChatError> {
    exact_keys(object, &["chart_type", "labels", "series"], &["title"])?;
    if object
        .get("title")
        .is_some_and(|value| !safe_text(Some(value), 0, 16_384))
        || !matches!(
            object.get("chart_type").and_then(Value::as_str),
            Some("bar" | "line" | "pie")
        )
    {
        return Err(ChatError::InvalidInput);
    }
    let labels = object
        .get("labels")
        .and_then(Value::as_array)
        .filter(|values| (1..=128).contains(&values.len()))
        .ok_or(ChatError::InvalidInput)?;
    if labels.iter().any(|value| !safe_text(Some(value), 0, 128)) {
        return Err(ChatError::InvalidInput);
    }
    let series = object
        .get("series")
        .and_then(Value::as_array)
        .filter(|values| (1..=16).contains(&values.len()))
        .ok_or(ChatError::InvalidInput)?;
    for item in series {
        let item = item.as_object().ok_or(ChatError::InvalidInput)?;
        exact_keys(item, &["name", "values"], &[])?;
        let values = item
            .get("values")
            .and_then(Value::as_array)
            .filter(|values| (1..=128).contains(&values.len()))
            .ok_or(ChatError::InvalidInput)?;
        if !safe_text(item.get("name"), 1, 80) || values.iter().any(|value| !value.is_number()) {
            return Err(ChatError::InvalidInput);
        }
    }
    Ok(())
}

fn exact_keys(
    object: &Map<String, Value>,
    required: &[&str],
    optional: &[&str],
) -> Result<(), ChatError> {
    if required.iter().any(|key| !object.contains_key(*key))
        || object
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return Err(ChatError::InvalidInput);
    }
    Ok(())
}

fn safe_text(value: Option<&Value>, minimum: usize, maximum: usize) -> bool {
    value
        .and_then(Value::as_str)
        .map(|value| {
            (minimum..=maximum).contains(&value.chars().count()) && !contains_markup(value)
        })
        .unwrap_or(false)
}

fn contains_markup(value: &str) -> bool {
    value.contains('<') || value.contains('>')
}

fn safe_timestamp(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .map(valid_rfc3339_utc)
        .unwrap_or(false)
}

fn valid_rfc3339_utc(value: &str) -> bool {
    if value.len() < 20
        || value.as_bytes().get(4) != Some(&b'-')
        || value.as_bytes().get(7) != Some(&b'-')
        || !matches!(value.as_bytes().get(10), Some(b'T' | b't'))
        || value.as_bytes().get(13) != Some(&b':')
        || value.as_bytes().get(16) != Some(&b':')
    {
        return false;
    }
    let digits = |range: std::ops::Range<usize>| {
        value
            .as_bytes()
            .get(range)
            .is_some_and(|part| part.iter().all(u8::is_ascii_digit))
    };
    if !digits(0..4)
        || !digits(5..7)
        || !digits(8..10)
        || !digits(11..13)
        || !digits(14..16)
        || !digits(17..19)
    {
        return false;
    }
    let number =
        |range: std::ops::Range<usize>| value.get(range).and_then(|part| part.parse::<u32>().ok());
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        number(0..4),
        number(5..7),
        number(8..10),
        number(11..13),
        number(14..16),
        number(17..19),
    ) else {
        return false;
    };
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let maximum_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    if year == 0 || day == 0 || day > maximum_day || hour > 23 || minute > 59 || second > 59 {
        return false;
    }
    let zone_start = if matches!(value.as_bytes().last(), Some(b'Z' | b'z')) {
        value.len() - 1
    } else {
        let start = value.len().saturating_sub(6);
        if !matches!(value.as_bytes().get(start), Some(b'+' | b'-'))
            || value.as_bytes().get(start + 3) != Some(&b':')
            || !digits(start + 1..start + 3)
            || !digits(start + 4..start + 6)
            || number(start + 1..start + 3).is_none_or(|offset_hour| offset_hour > 23)
            || number(start + 4..start + 6).is_none_or(|offset_minute| offset_minute > 59)
        {
            return false;
        }
        start
    };
    if zone_start == 19 {
        return true;
    }
    value.as_bytes().get(19) == Some(&b'.')
        && value
            .as_bytes()
            .get(20..zone_start)
            .is_some_and(|fraction| !fraction.is_empty() && fraction.iter().all(u8::is_ascii_digit))
}

fn valid_report_identifier(value: &str, allow_dash: bool) -> bool {
    (1..=64).contains(&value.len())
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || byte == b'_'
                || (allow_dash && byte == b'-')
        })
}

fn json_depth(value: &Value) -> usize {
    match value {
        Value::Array(values) => 1 + values.iter().map(json_depth).max().unwrap_or(0),
        Value::Object(values) => 1 + values.values().map(json_depth).max().unwrap_or(0),
        _ => 1,
    }
}

fn max_bytes(kind: ArtifactKind) -> usize {
    match kind {
        ArtifactKind::Image => MAX_IMAGE_BYTES,
        ArtifactKind::Video | ArtifactKind::File | ArtifactKind::Report => MAX_ARTIFACT_BYTES,
    }
}

fn media_type_matches(kind: ArtifactKind, value: &str) -> bool {
    match kind {
        ArtifactKind::Image => matches!(value, "image/png" | "image/jpeg" | "image/webp"),
        ArtifactKind::Video => value == "video/mp4",
        ArtifactKind::File => matches!(
            value,
            "text/plain"
                | "text/csv"
                | "application/json"
                | "application/pdf"
                | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        ArtifactKind::Report => value == "application/vnd.yijie.report+json;version=1",
    }
}

fn valid_safe_name(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= 255
        && value.len() <= 1_020
        && value.trim() == value
        && value != "."
        && value != ".."
        && !value
            .chars()
            .any(|character| character.is_control() || matches!(character, '/' | '\\'))
        && value.nfc().collect::<String>() == value
}

fn valid_wire_safe_name(value: &str, schema_version: u8) -> bool {
    valid_safe_name(value)
        && if schema_version >= 5 {
            value.chars().count() <= 255 && value.len() <= 1_020
        } else {
            value.len() <= 255
        }
}

fn decode_sha256(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return None;
    }
    let mut decoded = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let high = char::from(pair[0]).to_digit(16)?;
        let low = char::from(pair[1]).to_digit(16)?;
        decoded[index] = u8::try_from((high << 4) | low).ok()?;
    }
    Some(decoded)
}

fn parse_wire_kind(value: &str) -> Result<ArtifactKind, ChatError> {
    ArtifactKind::parse(value).map_err(|_| ChatError::InvalidInput)
}

fn parse_wire_provenance(value: &str) -> Result<ArtifactProvenance, ChatError> {
    ArtifactProvenance::parse(value).map_err(|_| ChatError::InvalidInput)
}

fn safe_wire_context(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && !value.contains('\0')
        && !value.contains('\r')
        && !value.contains('\n')
}

fn safe_wire_context_chars_bytes(value: &str, max_chars: usize, max_bytes: usize) -> bool {
    value.chars().count() <= max_chars && safe_wire_context(value, max_bytes)
}

pub(crate) fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn parse_uuid(value: &str) -> Result<Uuid, ChatError> {
    Uuid::parse_str(value)
        .ok()
        .filter(|value| !value.is_nil())
        .ok_or(ChatError::DatabaseUnavailable)
}

fn retryable_host_error(error: &HostBridgeError) -> bool {
    matches!(
        error.kind(),
        HostBridgeErrorKind::Transport
            | HostBridgeErrorKind::NotReady
            | HostBridgeErrorKind::TokenUnavailable
    )
}

fn map_host_transfer_error(error: HostBridgeError) -> ChatError {
    if error.code() == Some(HostErrorCode::SessionNotFound) {
        return ChatError::NotFound;
    }
    match error.kind() {
        HostBridgeErrorKind::InvalidConfiguration
        | HostBridgeErrorKind::InstanceMismatch
        | HostBridgeErrorKind::Protocol => ChatError::InvalidConfiguration,
        HostBridgeErrorKind::Disabled => ChatError::Disabled,
        HostBridgeErrorKind::TokenUnavailable => ChatError::SecureStorageUnavailable,
        _ => ChatError::OrchestrationUnavailable,
    }
}

fn unix_seconds() -> Result<i64, ChatError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_secs()).ok())
        .ok_or(ChatError::InvalidInput)
}

fn format_utc_timestamp(seconds: i64) -> Result<String, ChatError> {
    if seconds < 0 {
        return Err(ChatError::InvalidInput);
    }
    let days = seconds / 86_400;
    let seconds_of_day = seconds % 86_400;
    let (year, month, day) = civil_from_days(days)?;
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    Ok(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z"
    ))
}

fn civil_from_days(days_since_epoch: i64) -> Result<(i64, i64, i64), ChatError> {
    let z = days_since_epoch
        .checked_add(719_468)
        .ok_or(ChatError::InvalidInput)?;
    let era = z / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    if !(0..=9_999).contains(&year) {
        return Err(ChatError::InvalidInput);
    }
    Ok((year, month, day))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::{ChatScope, DatabaseKey, ReceiptKey};
    use rusqlite::params;
    use std::fs;

    #[test]
    fn report_adapter_accepts_unknown_optional_and_rejects_required_or_markup() {
        let optional = br#"{
          "schema_version":1,"title":"Safe","generated_at":"2026-08-20T00:00:00Z",
          "sections":[{"id":"future","type":"future_widget","required":false,"payload":{"opaque":[1,2,3]}}]
        }"#;
        validate_report_document(optional).unwrap();

        let required = br#"{
          "schema_version":1,"title":"Safe","generated_at":"2026-08-20T00:00:00Z",
          "sections":[{"id":"future","type":"future_widget","required":true,"payload":{}}]
        }"#;
        assert_eq!(
            validate_report_document(required),
            Err(ChatError::InvalidInput)
        );

        let markup = br#"{
          "schema_version":1,"title":"<script>","generated_at":"2026-08-20T00:00:00Z","sections":[]
        }"#;
        assert_eq!(
            validate_report_document(markup),
            Err(ChatError::InvalidInput)
        );

        let invalid_timestamp = br#"{
          "schema_version":1,"title":"Safe","generated_at":"2026-02-30T25:00:00Z","sections":[]
        }"#;
        assert_eq!(
            validate_report_document(invalid_timestamp),
            Err(ChatError::InvalidInput)
        );
        assert!(valid_rfc3339_utc("2024-02-29T23:59:59.123Z"));
        assert!(valid_rfc3339_utc(
            "2024-02-29T23:59:59.12345678901234567890-07:30"
        ));
    }

    #[test]
    fn report_adapter_accepts_all_schema_valid_cardinality_and_datetime_forms() {
        let title = "报".repeat(200);
        let document = serde_json::json!({
            "schema_version": 1,
            "title": title,
            "generated_at": "2026-08-20T10:00:00+08:00",
            "sections": [
                {
                    "id": "duplicate",
                    "type": "summary",
                    "required": true,
                    "payload": { "text": "first" }
                },
                {
                    "id": "duplicate",
                    "type": "table",
                    "required": false,
                    "payload": {
                        "columns": [
                            { "key": "value", "label": "First" },
                            { "key": "value", "label": "Second" }
                        ],
                        "rows": [{ "value": 1 }]
                    }
                },
                {
                    "id": "chart",
                    "type": "chart",
                    "required": false,
                    "payload": {
                        "chart_type": "line",
                        "labels": ["Q1", "Q2"],
                        "series": [{ "name": "Total", "values": [42] }]
                    }
                }
            ]
        });
        validate_report_document(&serde_json::to_vec(&document).unwrap()).unwrap();
    }

    #[test]
    fn ready_report_reader_is_scope_state_type_size_digest_revision_and_schema_bound() {
        let root = std::env::temp_dir().join(format!("yijie-report-reader-{}", Uuid::now_v7()));
        let owner = Uuid::now_v7();
        let tenant = Uuid::now_v7();
        let scope = ChatScope::new(owner.to_string(), tenant.to_string()).unwrap();
        let project_id = Uuid::now_v7();
        let session_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        let artifact_id = Uuid::now_v7();
        let agent_session_id = Uuid::now_v7();
        let database_key = DatabaseKey::from_bytes([0x41; 32]);
        let receipt_key = ReceiptKey::from_bytes([0x42; 32]);
        let mut repository =
            ChatRepository::open(&root, &database_key, receipt_key, scope).unwrap();
        repository
            .connection
            .execute(
                "INSERT INTO chat_projects(
                   id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at
                 ) VALUES (?1, ?2, ?3, 'fixture', ?4, ?5, 1)",
                params![
                    project_id.to_string(),
                    owner.to_string(),
                    tenant.to_string(),
                    "b".repeat(64),
                    vec![1_u8]
                ],
            )
            .unwrap();
        repository
            .connection
            .execute(
                "INSERT INTO chat_sessions(
                   id, owner_user_id, tenant_id, project_id, title, title_source,
                   title_job_status, created_at, last_activity_at
                 ) VALUES (?1, ?2, ?3, ?4, 'fixture', 'fallback', 'not_started', 1, 1)",
                params![
                    session_id.to_string(),
                    owner.to_string(),
                    tenant.to_string(),
                    project_id.to_string()
                ],
            )
            .unwrap();
        repository
            .connection
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, status)
                 VALUES (?1, ?2, ?3, 'completed')",
                params![
                    turn_id.to_string(),
                    session_id.to_string(),
                    Uuid::now_v7().to_string()
                ],
            )
            .unwrap();
        let content = br#"{"schema_version":1,"title":"Safe","generated_at":"2026-08-20T10:00:00+08:00","sections":[]}"#.to_vec();
        let digest = format!("{:x}", Sha256::digest(&content));
        let identity = ArtifactIdentity {
            artifact_id,
            local_session_id: session_id,
            local_turn_id: turn_id,
            kind: ArtifactKind::Report,
            provenance: ArtifactProvenance::Synthetic,
            ordinal: 0,
            display_name: Some("report.json".to_owned()),
        };
        let manifest = ArtifactManifest {
            artifact_id,
            agent_session_id,
            local_session_id: session_id,
            local_turn_id: turn_id,
            kind: ArtifactKind::Report,
            provenance: ArtifactProvenance::Synthetic,
            ordinal: 0,
            display_name: identity.display_name.clone(),
            media_type: "application/vnd.yijie.report+json;version=1".to_owned(),
            size_bytes: content.len(),
            sha256: digest.clone(),
            content_href: format!(
                "/v3/agent-sessions/{agent_session_id}/artifacts/{artifact_id}/content"
            ),
            poster_href: None,
        };
        repository.record_artifact_started(&identity).unwrap();
        assert_eq!(
            repository.begin_artifact_transfer(&manifest).unwrap(),
            TransferDisposition::Fetch
        );
        repository
            .commit_artifact(
                &manifest,
                &DownloadedArtifact {
                    content: DownloadedResource {
                        media_type: manifest.media_type.clone(),
                        size_bytes: content.len(),
                        sha256: digest,
                        bytes: content.clone(),
                    },
                    poster: None,
                },
                100,
                Uuid::now_v7(),
            )
            .unwrap();
        let ready = repository
            .read_ready_report(session_id, turn_id, artifact_id, 101, MAX_ARTIFACT_BYTES)
            .unwrap()
            .unwrap();
        assert_eq!(ready.bytes, content);
        assert_eq!(ready.revision, 100);
        assert_eq!(
            repository
                .read_ready_report(session_id, turn_id, artifact_id, 101, content.len() - 1)
                .unwrap(),
            Err(ReadyReportReadError::LimitExceeded)
        );
        assert_eq!(
            repository
                .read_ready_report(
                    Uuid::now_v7(),
                    turn_id,
                    artifact_id,
                    101,
                    MAX_ARTIFACT_BYTES,
                )
                .unwrap(),
            Err(ReadyReportReadError::NotFound)
        );
        repository
            .connection
            .execute("PRAGMA ignore_check_constraints=ON", [])
            .unwrap();
        for (column, invalid, restored, expected) in [
            (
                "state",
                "processing",
                "ready",
                ReadyReportReadError::NotReady,
            ),
            ("kind", "file", "report", ReadyReportReadError::Unsupported),
            (
                "media_type",
                "application/json",
                "application/vnd.yijie.report+json;version=1",
                ReadyReportReadError::Unsupported,
            ),
        ] {
            repository
                .connection
                .execute(
                    &format!("UPDATE chat_output_artifacts SET {column}=?1 WHERE artifact_id=?2"),
                    params![invalid, artifact_id.to_string()],
                )
                .unwrap();
            assert_eq!(
                repository
                    .read_ready_report(session_id, turn_id, artifact_id, 101, MAX_ARTIFACT_BYTES,)
                    .unwrap(),
                Err(expected)
            );
            repository
                .connection
                .execute(
                    &format!("UPDATE chat_output_artifacts SET {column}=?1 WHERE artifact_id=?2"),
                    params![restored, artifact_id.to_string()],
                )
                .unwrap();
        }
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET sha256=?1 WHERE artifact_id=?2",
                params!["0".repeat(64), artifact_id.to_string()],
            )
            .unwrap();
        assert_eq!(
            repository
                .read_ready_report(session_id, turn_id, artifact_id, 101, MAX_ARTIFACT_BYTES,)
                .unwrap(),
            Err(ReadyReportReadError::Integrity)
        );
        let invalid = br#"{"schema_version":1,"title":"<unsafe>","generated_at":"2026-08-20T02:00:00Z","sections":[]}"#.to_vec();
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts
                 SET content_blob=?1, byte_size=?2, sha256=?3
                 WHERE artifact_id=?4",
                params![
                    invalid,
                    invalid.len() as i64,
                    format!("{:x}", Sha256::digest(&invalid)),
                    artifact_id.to_string()
                ],
            )
            .unwrap();
        assert_eq!(
            repository
                .read_ready_report(session_id, turn_id, artifact_id, 101, MAX_ARTIFACT_BYTES,)
                .unwrap(),
            Err(ReadyReportReadError::Integrity)
        );
        repository
            .connection
            .execute("PRAGMA ignore_check_constraints=OFF", [])
            .unwrap();
        drop(repository);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn manifest_rejects_cross_session_or_noncanonical_resources() {
        let manifest = ArtifactManifest {
            artifact_id: Uuid::now_v7(),
            agent_session_id: Uuid::now_v7(),
            local_session_id: Uuid::now_v7(),
            local_turn_id: Uuid::now_v7(),
            kind: ArtifactKind::File,
            provenance: ArtifactProvenance::Synthetic,
            ordinal: 0,
            display_name: Some("safe.csv".to_owned()),
            media_type: "text/csv".to_owned(),
            size_bytes: 1,
            sha256: "a".repeat(64),
            content_href: "/v3/agent-sessions/foreign/artifacts/foreign/content".to_owned(),
            poster_href: None,
        };
        assert_eq!(manifest.validate(), Err(ChatError::InvalidInput));
    }

    #[test]
    fn utc_commit_timestamp_is_canonical_without_a_clock_dependency() {
        assert_eq!(format_utc_timestamp(0).unwrap(), "1970-01-01T00:00:00Z");
        assert_eq!(
            format_utc_timestamp(1_777_507_200).unwrap(),
            "2026-04-30T00:00:00Z"
        );
    }

    #[test]
    fn v3_wire_adapter_is_closed_scope_bound_and_never_accepts_provider_drift() {
        let agent_session_id = Uuid::now_v7();
        let runtime_turn_id = Uuid::now_v7();
        let local_session_id = Uuid::now_v7();
        let local_turn_id = Uuid::now_v7();
        let artifact_id = Uuid::now_v7();
        let envelope = serde_json::json!({
            "schema_version": 3,
            "event_id": Uuid::now_v7(),
            "stream_id": Uuid::now_v7(),
            "sequence": 1,
            "occurred_at": "2026-08-20T00:00:00Z",
            "task_id": Uuid::now_v7(),
            "agent_session_id": agent_session_id,
            "codex_thread_id": Uuid::now_v7(),
            "turn_id": runtime_turn_id,
            "event_type": "item.artifact.started",
            "terminal": false,
            "payload": {
                "artifact_id": artifact_id,
                "kind": "image",
                "provenance": "synthetic",
                "status": "in_progress",
                "ordinal": 0,
                "display_name": "synthetic.png"
            }
        });
        let decoded = decode_artifact_event_v3(
            &serde_json::to_vec(&envelope).unwrap(),
            agent_session_id,
            runtime_turn_id,
            local_session_id,
            local_turn_id,
        )
        .unwrap();
        let ArtifactEventV3::Started(identity) = decoded else {
            panic!("started event expected");
        };
        assert_eq!(identity.artifact_id, artifact_id);
        assert_eq!(identity.provenance, ArtifactProvenance::Synthetic);

        let mut foreign = envelope.clone();
        foreign["agent_session_id"] = serde_json::json!(Uuid::now_v7());
        assert_eq!(
            decode_artifact_event_v3(
                &serde_json::to_vec(&foreign).unwrap(),
                agent_session_id,
                runtime_turn_id,
                local_session_id,
                local_turn_id,
            ),
            Err(ChatError::InvalidInput)
        );
        let mut drift = envelope;
        drift["payload"]["provenance"] = serde_json::json!("unknown-provider");
        assert_eq!(
            decode_artifact_event_v3(
                &serde_json::to_vec(&drift).unwrap(),
                agent_session_id,
                runtime_turn_id,
                local_session_id,
                local_turn_id,
            ),
            Err(ChatError::InvalidInput)
        );
    }

    #[test]
    fn feat136_v5_artifact_text_limits_count_chars_and_keep_v4_wire_bounds() {
        let agent_session_id = Uuid::now_v7();
        let runtime_turn_id = Uuid::now_v7();
        let local_session_id = Uuid::now_v7();
        let local_turn_id = Uuid::now_v7();
        let artifact_id = Uuid::now_v7();
        let mut wire = HostArtifactEventV3 {
            schema_version: 5,
            cursor: super::super::host_domain::HostEventCursor::new(Uuid::now_v7(), 1).unwrap(),
            event_type: "item.artifact.started".to_owned(),
            event_id: Uuid::now_v7(),
            task_id: Uuid::now_v7(),
            agent_session_id,
            codex_thread_id: Uuid::now_v7(),
            turn_id: runtime_turn_id,
            occurred_at: "2026-08-29T00:00:00Z".to_owned(),
            payload: serde_json::json!({
                "artifact_id": artifact_id,
                "kind": "image",
                "provenance": "synthetic",
                "status": "in_progress",
                "ordinal": 0,
                "display_name": "图".repeat(255)
            }),
        };
        assert!(decode_artifact_event_envelope_v3(
            &wire,
            agent_session_id,
            runtime_turn_id,
            local_session_id,
            local_turn_id,
        )
        .is_ok());

        wire.schema_version = 4;
        assert!(decode_artifact_event_envelope_v3(
            &wire,
            agent_session_id,
            runtime_turn_id,
            local_session_id,
            local_turn_id,
        )
        .is_err());
        wire.schema_version = 5;
        wire.payload["display_name"] = serde_json::json!("图".repeat(256));
        assert!(decode_artifact_event_envelope_v3(
            &wire,
            agent_session_id,
            runtime_turn_id,
            local_session_id,
            local_turn_id,
        )
        .is_err());
        wire.payload["display_name"] = serde_json::json!(".");
        assert!(decode_artifact_event_envelope_v3(
            &wire,
            agent_session_id,
            runtime_turn_id,
            local_session_id,
            local_turn_id,
        )
        .is_err());

        wire.event_type = "item.artifact.failed".to_owned();
        wire.payload = serde_json::json!({
            "artifact_id": artifact_id,
            "kind": "image",
            "provenance": "synthetic",
            "status": "failed",
            "ordinal": 0,
            "error_code": "generation_failed",
            "retryable": false,
            "message": "错".repeat(512)
        });
        assert!(decode_artifact_event_envelope_v3(
            &wire,
            agent_session_id,
            runtime_turn_id,
            local_session_id,
            local_turn_id,
        )
        .is_ok());
        wire.schema_version = 4;
        assert!(decode_artifact_event_envelope_v3(
            &wire,
            agent_session_id,
            runtime_turn_id,
            local_session_id,
            local_turn_id,
        )
        .is_err());
        wire.schema_version = 5;
        wire.payload["message"] = serde_json::json!("错".repeat(513));
        assert!(decode_artifact_event_envelope_v3(
            &wire,
            agent_session_id,
            runtime_turn_id,
            local_session_id,
            local_turn_id,
        )
        .is_err());
    }

    #[test]
    fn sqlcipher_commit_ack_reopen_expiry_receipt_and_delete_are_atomic() {
        let root = std::env::temp_dir().join(format!("yijie-feat128-artifact-{}", Uuid::now_v7()));
        let owner = Uuid::now_v7();
        let tenant = Uuid::now_v7();
        let scope = ChatScope::new(owner.to_string(), tenant.to_string()).unwrap();
        let database_key = DatabaseKey::from_bytes([0x31; 32]);
        let receipt_key = ReceiptKey::from_bytes([0x32; 32]);
        let project_id = Uuid::now_v7();
        let session_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        let artifact_id = Uuid::now_v7();
        let agent_session_id = Uuid::now_v7();
        let content = b"name,value\nalpha,1\n".to_vec();
        let digest = format!("{:x}", Sha256::digest(&content));
        let manifest = ArtifactManifest {
            artifact_id,
            agent_session_id,
            local_session_id: session_id,
            local_turn_id: turn_id,
            kind: ArtifactKind::File,
            provenance: ArtifactProvenance::Synthetic,
            ordinal: 0,
            display_name: Some("synthetic.csv".to_owned()),
            media_type: "text/csv".to_owned(),
            size_bytes: content.len(),
            sha256: digest.clone(),
            content_href: format!(
                "/v3/agent-sessions/{agent_session_id}/artifacts/{artifact_id}/content"
            ),
            poster_href: None,
        };
        let identity = ArtifactIdentity {
            artifact_id,
            local_session_id: session_id,
            local_turn_id: turn_id,
            kind: ArtifactKind::File,
            provenance: ArtifactProvenance::Synthetic,
            ordinal: 0,
            display_name: Some("synthetic.csv".to_owned()),
        };
        let mut repository =
            ChatRepository::open(&root, &database_key, receipt_key.clone(), scope.clone()).unwrap();
        repository
            .connection
            .execute(
                "INSERT INTO chat_projects(
                   id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at
                 ) VALUES (?1, ?2, ?3, 'fixture', ?4, ?5, 1)",
                params![
                    project_id.to_string(),
                    owner.to_string(),
                    tenant.to_string(),
                    "a".repeat(64),
                    vec![1_u8]
                ],
            )
            .unwrap();
        repository
            .connection
            .execute(
                "INSERT INTO chat_sessions(
                   id, owner_user_id, tenant_id, project_id, title, title_source,
                   title_job_status, created_at, last_activity_at
                 ) VALUES (?1, ?2, ?3, ?4, 'fixture', 'fallback', 'not_started', 1, 1)",
                params![
                    session_id.to_string(),
                    owner.to_string(),
                    tenant.to_string(),
                    project_id.to_string()
                ],
            )
            .unwrap();
        repository
            .connection
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, status)
                 VALUES (?1, ?2, ?3, 'completed')",
                params![
                    turn_id.to_string(),
                    session_id.to_string(),
                    Uuid::now_v7().to_string()
                ],
            )
            .unwrap();

        repository.record_artifact_started(&identity).unwrap();
        repository.record_artifact_started(&identity).unwrap();
        repository
            .record_artifact_progress(
                &identity,
                Some(ArtifactProgressStage::Generating),
                Some(25.0),
            )
            .unwrap();
        repository
            .record_artifact_progress(
                &identity,
                Some(ArtifactProgressStage::Processing),
                Some(75.0),
            )
            .unwrap();
        repository
            .record_artifact_progress(
                &identity,
                Some(ArtifactProgressStage::Finalizing),
                Some(80.0),
            )
            .unwrap();
        assert_eq!(
            repository.record_artifact_progress(
                &identity,
                Some(ArtifactProgressStage::Processing),
                Some(90.0),
            ),
            Err(ChatError::ConversationConflict)
        );
        assert_eq!(
            repository
                .load_artifacts_for_turns(&[turn_id])
                .unwrap()
                .first()
                .and_then(|artifact| artifact.progress_stage),
            Some(ArtifactProgressStage::Finalizing)
        );
        assert_eq!(
            repository.begin_artifact_transfer(&manifest).unwrap(),
            TransferDisposition::Fetch
        );
        let ack_id = Uuid::now_v7();
        let committed_at = unix_seconds().unwrap();
        let commit = repository
            .commit_artifact(
                &manifest,
                &DownloadedArtifact {
                    content: DownloadedResource {
                        media_type: manifest.media_type.clone(),
                        size_bytes: content.len(),
                        sha256: digest,
                        bytes: content.clone(),
                    },
                    poster: None,
                },
                committed_at,
                ack_id,
            )
            .unwrap();
        assert_eq!(commit.expires_at, committed_at + ARTIFACT_RETENTION_SECONDS);
        let ready_file = repository
            .read_ready_file(
                session_id,
                turn_id,
                artifact_id,
                committed_at + 1,
                MAX_ARTIFACT_BYTES,
            )
            .unwrap()
            .unwrap();
        assert_eq!(ready_file.media_type, "text/csv");
        assert_eq!(ready_file.bytes, content);
        assert_eq!(ready_file.revision, committed_at);
        assert_eq!(
            repository
                .read_ready_file(
                    session_id,
                    turn_id,
                    artifact_id,
                    committed_at + 1,
                    content.len() - 1,
                )
                .unwrap(),
            Err(ReadyFileReadError::LimitExceeded)
        );
        assert_eq!(
            repository
                .read_ready_file(
                    Uuid::now_v7(),
                    turn_id,
                    artifact_id,
                    committed_at + 1,
                    MAX_ARTIFACT_BYTES,
                )
                .unwrap(),
            Err(ReadyFileReadError::NotFound)
        );
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET owner_user_id=?1 WHERE artifact_id=?2",
                params![Uuid::now_v7().to_string(), artifact_id.to_string()],
            )
            .unwrap();
        assert_eq!(
            repository
                .read_ready_file(
                    session_id,
                    turn_id,
                    artifact_id,
                    committed_at + 1,
                    MAX_ARTIFACT_BYTES,
                )
                .unwrap(),
            Err(ReadyFileReadError::NotFound)
        );
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET owner_user_id=?1 WHERE artifact_id=?2",
                params![owner.to_string(), artifact_id.to_string()],
            )
            .unwrap();
        repository
            .connection
            .execute("PRAGMA ignore_check_constraints=ON", [])
            .unwrap();
        for (column, invalid, expected) in [
            ("state", "processing", ReadyFileReadError::NotReady),
            ("kind", "report", ReadyFileReadError::Unsupported),
            (
                "media_type",
                "text/markdown",
                ReadyFileReadError::Unsupported,
            ),
        ] {
            repository
                .connection
                .execute(
                    &format!("UPDATE chat_output_artifacts SET {column}=?1 WHERE artifact_id=?2"),
                    params![invalid, artifact_id.to_string()],
                )
                .unwrap();
            assert_eq!(
                repository
                    .read_ready_file(
                        session_id,
                        turn_id,
                        artifact_id,
                        committed_at + 1,
                        MAX_ARTIFACT_BYTES,
                    )
                    .unwrap(),
                Err(expected)
            );
            let restored = match column {
                "state" => "ready",
                "kind" => "file",
                "media_type" => "text/csv",
                _ => unreachable!(),
            };
            repository
                .connection
                .execute(
                    &format!("UPDATE chat_output_artifacts SET {column}=?1 WHERE artifact_id=?2"),
                    params![restored, artifact_id.to_string()],
                )
                .unwrap();
        }
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET byte_size=byte_size+1 WHERE artifact_id=?1",
                [artifact_id.to_string()],
            )
            .unwrap();
        assert_eq!(
            repository
                .read_ready_file(
                    session_id,
                    turn_id,
                    artifact_id,
                    committed_at + 1,
                    MAX_ARTIFACT_BYTES,
                )
                .unwrap(),
            Err(ReadyFileReadError::Integrity)
        );
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET byte_size=?1, sha256=?2 WHERE artifact_id=?3",
                params![
                    content.len() as i64,
                    "0".repeat(64),
                    artifact_id.to_string()
                ],
            )
            .unwrap();
        assert_eq!(
            repository
                .read_ready_file(
                    session_id,
                    turn_id,
                    artifact_id,
                    committed_at + 1,
                    MAX_ARTIFACT_BYTES,
                )
                .unwrap(),
            Err(ReadyFileReadError::Integrity)
        );
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET sha256=?1 WHERE artifact_id=?2",
                params![
                    format!("{:x}", Sha256::digest(&content)),
                    artifact_id.to_string()
                ],
            )
            .unwrap();
        repository
            .connection
            .execute("PRAGMA ignore_check_constraints=OFF", [])
            .unwrap();
        assert_eq!(
            repository.begin_artifact_transfer(&manifest).unwrap(),
            TransferDisposition::AlreadyCommitted
        );
        assert_eq!(
            repository.artifact_commit(&manifest).unwrap(),
            StoredArtifactCommit {
                commit: commit.clone(),
                host_acknowledged: false,
                expired: false,
            }
        );
        repository
            .mark_artifact_acknowledged(artifact_id, ack_id, committed_at + 1)
            .unwrap();
        assert!(
            repository
                .artifact_commit(&manifest)
                .unwrap()
                .host_acknowledged
        );
        let cancelled = ArtifactIdentity {
            artifact_id: Uuid::now_v7(),
            local_session_id: session_id,
            local_turn_id: turn_id,
            kind: ArtifactKind::Report,
            provenance: ArtifactProvenance::Synthetic,
            ordinal: 1,
            display_name: None,
        };
        repository.record_artifact_started(&cancelled).unwrap();
        repository
            .record_artifact_failed(&cancelled, "turn_interrupted", false)
            .unwrap();
        repository
            .record_artifact_failed(&cancelled, "turn_interrupted", false)
            .unwrap();
        let stored: Vec<u8> = repository
            .connection
            .query_row(
                "SELECT content_blob FROM chat_output_artifacts WHERE artifact_id=?1",
                [artifact_id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, content);
        drop(repository);

        let mut reopened = ChatRepository::open(&root, &database_key, receipt_key, scope).unwrap();
        let ready = reopened.load_artifacts_for_turns(&[turn_id]).unwrap();
        assert_eq!(ready.len(), 2);
        assert_eq!(ready[0].state, "ready");
        assert_eq!(ready[1].state, "cancelled");
        assert_eq!(ready[0].expires_at, Some(commit.expires_at));
        assert_eq!(
            reopened.purge_expired_artifacts(commit.expires_at).unwrap(),
            1
        );
        let expired = reopened.load_artifacts_for_turns(&[turn_id]).unwrap();
        assert_eq!(expired[0].state, "expired");
        assert_eq!(
            reopened
                .read_ready_file(
                    session_id,
                    turn_id,
                    artifact_id,
                    commit.expires_at,
                    MAX_ARTIFACT_BYTES,
                )
                .unwrap(),
            Err(ReadyFileReadError::Expired)
        );
        assert!(reopened
            .connection
            .query_row(
                "SELECT content_blob IS NULL FROM chat_output_artifacts WHERE artifact_id=?1",
                [artifact_id.to_string()],
                |row| row.get::<_, bool>(0),
            )
            .unwrap());
        assert_eq!(
            reopened
                .connection
                .query_row(
                    "SELECT outcome_code FROM chat_artifact_cleanup_receipts WHERE artifact_id=?1",
                    [artifact_id.to_string()],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "retention_expired"
        );
        assert_eq!(
            reopened
                .purge_expired_artifacts(commit.expires_at + 1)
                .unwrap(),
            0
        );
        reopened
            .delete_session_local(&session_id.to_string())
            .unwrap();
        assert_eq!(
            reopened
                .connection
                .query_row("SELECT count(*) FROM chat_output_artifacts", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
        drop(reopened);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn ready_image_reader_is_scope_state_type_and_integrity_bound() {
        let root =
            std::env::temp_dir().join(format!("yijie-feat128-native-image-{}", Uuid::now_v7()));
        let owner = Uuid::now_v7();
        let tenant = Uuid::now_v7();
        let scope = ChatScope::new(owner.to_string(), tenant.to_string()).unwrap();
        let project_id = Uuid::now_v7();
        let session_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        let artifact_id = Uuid::now_v7();
        let agent_session_id = Uuid::now_v7();
        let content = crate::chat::attachment::test_image_bytes("png");
        let digest = format!("{:x}", Sha256::digest(&content));
        let database_key = DatabaseKey::from_bytes([0x41; 32]);
        let receipt_key = ReceiptKey::from_bytes([0x42; 32]);
        let mut repository =
            ChatRepository::open(&root, &database_key, receipt_key, scope).unwrap();
        repository
            .connection
            .execute(
                "INSERT INTO chat_projects(
                   id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at
                 ) VALUES (?1, ?2, ?3, 'fixture', ?4, ?5, 1)",
                params![
                    project_id.to_string(),
                    owner.to_string(),
                    tenant.to_string(),
                    "b".repeat(64),
                    vec![1_u8]
                ],
            )
            .unwrap();
        repository
            .connection
            .execute(
                "INSERT INTO chat_sessions(
                   id, owner_user_id, tenant_id, project_id, title, title_source,
                   title_job_status, created_at, last_activity_at
                 ) VALUES (?1, ?2, ?3, ?4, 'fixture', 'fallback', 'not_started', 1, 1)",
                params![
                    session_id.to_string(),
                    owner.to_string(),
                    tenant.to_string(),
                    project_id.to_string()
                ],
            )
            .unwrap();
        repository
            .connection
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, status)
                 VALUES (?1, ?2, ?3, 'completed')",
                params![
                    turn_id.to_string(),
                    session_id.to_string(),
                    Uuid::now_v7().to_string()
                ],
            )
            .unwrap();
        let manifest = ArtifactManifest {
            artifact_id,
            agent_session_id,
            local_session_id: session_id,
            local_turn_id: turn_id,
            kind: ArtifactKind::Image,
            provenance: ArtifactProvenance::Synthetic,
            ordinal: 0,
            display_name: Some("synthetic.png".to_owned()),
            media_type: "image/png".to_owned(),
            size_bytes: content.len(),
            sha256: digest.clone(),
            content_href: format!(
                "/v3/agent-sessions/{agent_session_id}/artifacts/{artifact_id}/content"
            ),
            poster_href: None,
        };
        let identity = ArtifactIdentity {
            artifact_id,
            local_session_id: session_id,
            local_turn_id: turn_id,
            kind: ArtifactKind::Image,
            provenance: ArtifactProvenance::Synthetic,
            ordinal: 0,
            display_name: Some("synthetic.png".to_owned()),
        };
        repository.record_artifact_started(&identity).unwrap();
        assert_eq!(
            repository
                .read_ready_image(session_id, turn_id, artifact_id, 999)
                .unwrap(),
            Err(ReadyImageReadError::NotReady)
        );
        repository.begin_artifact_transfer(&manifest).unwrap();
        repository
            .commit_artifact(
                &manifest,
                &DownloadedArtifact {
                    content: DownloadedResource {
                        media_type: "image/png".to_owned(),
                        size_bytes: content.len(),
                        sha256: digest.clone(),
                        bytes: content.clone(),
                    },
                    poster: None,
                },
                1_000,
                Uuid::now_v7(),
            )
            .unwrap();
        let ready = repository
            .read_ready_image(session_id, turn_id, artifact_id, 1_001)
            .unwrap()
            .unwrap();
        assert_eq!(ready.bytes, content);
        assert_eq!(ready.media_type, "image/png");
        assert_eq!(
            repository
                .read_ready_image(Uuid::now_v7(), turn_id, artifact_id, 1_001)
                .unwrap(),
            Err(ReadyImageReadError::NotFound)
        );
        assert_eq!(
            repository
                .read_ready_image(session_id, Uuid::now_v7(), artifact_id, 1_001)
                .unwrap(),
            Err(ReadyImageReadError::NotFound)
        );
        assert_eq!(
            repository
                .read_ready_image(session_id, turn_id, Uuid::now_v7(), 1_001)
                .unwrap(),
            Err(ReadyImageReadError::NotFound)
        );
        assert_eq!(
            repository
                .read_ready_image(
                    session_id,
                    turn_id,
                    artifact_id,
                    1_000 + ARTIFACT_RETENTION_SECONDS
                )
                .unwrap(),
            Err(ReadyImageReadError::Expired)
        );

        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET owner_user_id=?1 WHERE artifact_id=?2",
                params![Uuid::now_v7().to_string(), artifact_id.to_string()],
            )
            .unwrap();
        assert_eq!(
            repository
                .read_ready_image(session_id, turn_id, artifact_id, 1_001)
                .unwrap(),
            Err(ReadyImageReadError::NotFound)
        );
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET owner_user_id=?1 WHERE artifact_id=?2",
                params![owner.to_string(), artifact_id.to_string()],
            )
            .unwrap();
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET kind='file' WHERE artifact_id=?1",
                [artifact_id.to_string()],
            )
            .unwrap();
        assert_eq!(
            repository
                .read_ready_image(session_id, turn_id, artifact_id, 1_001)
                .unwrap(),
            Err(ReadyImageReadError::Unsupported)
        );
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET kind='image', media_type='image/gif' WHERE artifact_id=?1",
                [artifact_id.to_string()],
            )
            .unwrap();
        assert_eq!(
            repository
                .read_ready_image(session_id, turn_id, artifact_id, 1_001)
                .unwrap(),
            Err(ReadyImageReadError::Unsupported)
        );
        repository
            .connection
            .execute("PRAGMA ignore_check_constraints=ON", [])
            .unwrap();
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET media_type='image/png', byte_size=byte_size+1 WHERE artifact_id=?1",
                [artifact_id.to_string()],
            )
            .unwrap();
        assert_eq!(
            repository
                .read_ready_image(session_id, turn_id, artifact_id, 1_001)
                .unwrap(),
            Err(ReadyImageReadError::Integrity)
        );
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET byte_size=?1, sha256=?2 WHERE artifact_id=?3",
                params![
                    content.len() as i64,
                    "0".repeat(64),
                    artifact_id.to_string()
                ],
            )
            .unwrap();
        repository
            .connection
            .execute("PRAGMA ignore_check_constraints=OFF", [])
            .unwrap();
        assert_eq!(
            repository
                .read_ready_image(session_id, turn_id, artifact_id, 1_001)
                .unwrap(),
            Err(ReadyImageReadError::Integrity)
        );
        let corrupt = vec![0_u8; content.len() + 1];
        let corrupt_digest = format!("{:x}", Sha256::digest(&corrupt));
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts
                 SET content_blob=zeroblob(byte_size+1), byte_size=byte_size+1, sha256=?1
                 WHERE artifact_id=?2",
                params![corrupt_digest, artifact_id.to_string()],
            )
            .unwrap();
        assert_eq!(
            repository
                .read_ready_image(session_id, turn_id, artifact_id, 1_001)
                .unwrap(),
            Err(ReadyImageReadError::Integrity)
        );
        drop(repository);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ready_video_reader_is_scope_state_type_size_digest_and_mp4_bound() {
        let root =
            std::env::temp_dir().join(format!("yijie-feat128-native-video-{}", Uuid::now_v7()));
        let owner = Uuid::now_v7();
        let tenant = Uuid::now_v7();
        let scope = ChatScope::new(owner.to_string(), tenant.to_string()).unwrap();
        let project_id = Uuid::now_v7();
        let session_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        let artifact_id = Uuid::now_v7();
        let agent_session_id = Uuid::now_v7();
        let content = crate::chat::artifact_video_native::test_mp4_bytes();
        let digest = format!("{:x}", Sha256::digest(&content));
        let database_key = DatabaseKey::from_bytes([0x51; 32]);
        let receipt_key = ReceiptKey::from_bytes([0x52; 32]);
        let mut repository =
            ChatRepository::open(&root, &database_key, receipt_key, scope).unwrap();
        repository
            .connection
            .execute(
                "INSERT INTO chat_projects(
                   id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at
                 ) VALUES (?1, ?2, ?3, 'fixture', ?4, ?5, 1)",
                params![
                    project_id.to_string(),
                    owner.to_string(),
                    tenant.to_string(),
                    "c".repeat(64),
                    vec![1_u8]
                ],
            )
            .unwrap();
        repository
            .connection
            .execute(
                "INSERT INTO chat_sessions(
                   id, owner_user_id, tenant_id, project_id, title, title_source,
                   title_job_status, created_at, last_activity_at
                 ) VALUES (?1, ?2, ?3, ?4, 'fixture', 'fallback', 'not_started', 1, 1)",
                params![
                    session_id.to_string(),
                    owner.to_string(),
                    tenant.to_string(),
                    project_id.to_string()
                ],
            )
            .unwrap();
        repository
            .connection
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, status)
                 VALUES (?1, ?2, ?3, 'completed')",
                params![
                    turn_id.to_string(),
                    session_id.to_string(),
                    Uuid::now_v7().to_string()
                ],
            )
            .unwrap();
        let manifest = ArtifactManifest {
            artifact_id,
            agent_session_id,
            local_session_id: session_id,
            local_turn_id: turn_id,
            kind: ArtifactKind::Video,
            provenance: ArtifactProvenance::Synthetic,
            ordinal: 0,
            display_name: Some("synthetic.mp4".to_owned()),
            media_type: "video/mp4".to_owned(),
            size_bytes: content.len(),
            sha256: digest.clone(),
            content_href: format!(
                "/v3/agent-sessions/{agent_session_id}/artifacts/{artifact_id}/content"
            ),
            poster_href: None,
        };
        let identity = ArtifactIdentity {
            artifact_id,
            local_session_id: session_id,
            local_turn_id: turn_id,
            kind: ArtifactKind::Video,
            provenance: ArtifactProvenance::Synthetic,
            ordinal: 0,
            display_name: Some("synthetic.mp4".to_owned()),
        };
        repository.record_artifact_started(&identity).unwrap();
        assert_eq!(
            repository
                .read_ready_video(session_id, turn_id, artifact_id, 999)
                .unwrap(),
            Err(ReadyVideoReadError::NotReady)
        );
        repository.begin_artifact_transfer(&manifest).unwrap();
        repository
            .commit_artifact(
                &manifest,
                &DownloadedArtifact {
                    content: DownloadedResource {
                        media_type: "video/mp4".to_owned(),
                        size_bytes: content.len(),
                        sha256: digest.clone(),
                        bytes: content.clone(),
                    },
                    poster: None,
                },
                1_000,
                Uuid::now_v7(),
            )
            .unwrap();
        let ready = repository
            .read_ready_video(session_id, turn_id, artifact_id, 1_001)
            .unwrap()
            .unwrap();
        assert_eq!(ready.bytes, content);
        assert_eq!(ready.media_type, "video/mp4");
        let expected_sha256: [u8; 32] = Sha256::digest(&content).into();
        let range = repository
            .read_ready_video_range(ReadyVideoRangeRequest {
                session_id,
                turn_id,
                artifact_id,
                now: 1_001,
                expected_size: content.len(),
                expected_sha256,
                start: 10,
                length: 20,
            })
            .unwrap()
            .unwrap();
        assert_eq!(range.bytes, content[10..30]);
        assert_eq!(
            repository
                .read_ready_video_range(ReadyVideoRangeRequest {
                    session_id,
                    turn_id,
                    artifact_id,
                    now: 1_001,
                    expected_size: content.len(),
                    expected_sha256: [0; 32],
                    start: 0,
                    length: 1,
                })
                .unwrap(),
            Err(ReadyVideoReadError::Integrity)
        );
        assert_eq!(
            repository
                .read_ready_video(Uuid::now_v7(), turn_id, artifact_id, 1_001)
                .unwrap(),
            Err(ReadyVideoReadError::NotFound)
        );
        assert_eq!(
            repository
                .read_ready_video(session_id, Uuid::now_v7(), artifact_id, 1_001)
                .unwrap(),
            Err(ReadyVideoReadError::NotFound)
        );
        assert_eq!(
            repository
                .read_ready_video(
                    session_id,
                    turn_id,
                    artifact_id,
                    1_000 + ARTIFACT_RETENTION_SECONDS,
                )
                .unwrap(),
            Err(ReadyVideoReadError::Expired)
        );
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET kind='file' WHERE artifact_id=?1",
                [artifact_id.to_string()],
            )
            .unwrap();
        assert_eq!(
            repository
                .read_ready_video(session_id, turn_id, artifact_id, 1_001)
                .unwrap(),
            Err(ReadyVideoReadError::Unsupported)
        );
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET kind='video', media_type='video/webm' WHERE artifact_id=?1",
                [artifact_id.to_string()],
            )
            .unwrap();
        assert_eq!(
            repository
                .read_ready_video(session_id, turn_id, artifact_id, 1_001)
                .unwrap(),
            Err(ReadyVideoReadError::Unsupported)
        );
        repository
            .connection
            .execute("PRAGMA ignore_check_constraints=ON", [])
            .unwrap();
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET media_type='video/mp4', byte_size=byte_size+1 WHERE artifact_id=?1",
                [artifact_id.to_string()],
            )
            .unwrap();
        assert_eq!(
            repository
                .read_ready_video(session_id, turn_id, artifact_id, 1_001)
                .unwrap(),
            Err(ReadyVideoReadError::Integrity)
        );
        repository
            .connection
            .execute(
                "UPDATE chat_output_artifacts SET byte_size=?1, sha256=?2 WHERE artifact_id=?3",
                params![
                    content.len() as i64,
                    "0".repeat(64),
                    artifact_id.to_string()
                ],
            )
            .unwrap();
        repository
            .connection
            .execute("PRAGMA ignore_check_constraints=OFF", [])
            .unwrap();
        assert_eq!(
            repository
                .read_ready_video(session_id, turn_id, artifact_id, 1_001)
                .unwrap(),
            Err(ReadyVideoReadError::Integrity)
        );
        drop(repository);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn artifact_state_assistant_projection_and_v3_cursor_commit_or_rollback_together() {
        let root = std::env::temp_dir().join(format!("yijie-s10b-atomic-{}", Uuid::now_v7()));
        let owner = Uuid::now_v7();
        let tenant = Uuid::now_v7();
        let project_id = Uuid::now_v7();
        let session_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        let operation_id = Uuid::now_v7();
        let agent_session_id = Uuid::now_v7();
        let runtime_thread_id = Uuid::now_v7();
        let runtime_turn_id = Uuid::now_v7();
        let artifact_id = Uuid::now_v7();
        let stream_id = Uuid::now_v7();
        let scope = ChatScope::new(owner.to_string(), tenant.to_string()).unwrap();
        let mut repository = ChatRepository::open(
            &root,
            &DatabaseKey::from_bytes([0x51; 32]),
            ReceiptKey::from_bytes([0x52; 32]),
            scope,
        )
        .unwrap();
        repository.connection.execute(
            "INSERT INTO chat_projects(id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at)
             VALUES (?1, ?2, ?3, 'fixture', ?4, ?5, 1)",
            params![project_id.to_string(), owner.to_string(), tenant.to_string(), "a".repeat(64), vec![1_u8]],
        ).unwrap();
        repository.connection.execute(
            "INSERT INTO chat_sessions(id, owner_user_id, tenant_id, project_id, title, title_source,
               title_job_status, created_at, last_activity_at, agent_session_id, runtime_thread_id)
             VALUES (?1, ?2, ?3, ?4, 'fixture', 'fallback', 'not_started', 1, 1, ?5, ?6)",
            params![session_id.to_string(), owner.to_string(), tenant.to_string(), project_id.to_string(), agent_session_id.to_string(), runtime_thread_id.to_string()],
        ).unwrap();
        repository
            .connection
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, runtime_turn_id, status)
             VALUES (?1, ?2, ?3, ?4, 'streaming')",
                params![
                    turn_id.to_string(),
                    session_id.to_string(),
                    operation_id.to_string(),
                    runtime_turn_id.to_string()
                ],
            )
            .unwrap();
        repository.connection.execute(
            "INSERT INTO chat_messages(id, session_id, turn_id, role, content, status, ordinal, created_at)
             VALUES (?1, ?2, ?3, 'assistant', '', 'pending', 0, 1)",
            params![Uuid::now_v7().to_string(), session_id.to_string(), turn_id.to_string()],
        ).unwrap();

        let identity = ArtifactIdentity {
            artifact_id,
            local_session_id: session_id,
            local_turn_id: turn_id,
            kind: ArtifactKind::File,
            provenance: ArtifactProvenance::Synthetic,
            ordinal: 0,
            display_name: Some("safe.csv".to_owned()),
        };
        let first = TurnProgress {
            local_turn_id: turn_id,
            assistant_text: "durable-prefix".to_owned(),
            cursor: super::super::database::StoredEventCursor {
                stream_id,
                sequence: 1,
                event_id: Uuid::now_v7(),
            },
        };
        repository
            .commit_artifact_event_progress(&first, &ArtifactEventV3::Started(identity.clone()))
            .unwrap();
        let conflicting = ArtifactIdentity {
            ordinal: 1,
            ..identity.clone()
        };
        let second = TurnProgress {
            local_turn_id: turn_id,
            assistant_text: "must-roll-back".to_owned(),
            cursor: super::super::database::StoredEventCursor {
                stream_id,
                sequence: 2,
                event_id: Uuid::now_v7(),
            },
        };
        assert_eq!(
            repository
                .commit_artifact_event_progress(&second, &ArtifactEventV3::Started(conflicting)),
            Err(ChatError::ConversationConflict)
        );
        let stored: (String, i64, String) = repository
            .connection
            .query_row(
                "SELECT m.content, c.sequence, a.state
             FROM chat_messages m
             JOIN chat_event_cursors c ON c.session_id=m.session_id
             JOIN chat_output_artifacts a ON a.turn_id=m.turn_id
             WHERE m.turn_id=?1 AND m.role='assistant'",
                [turn_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            stored,
            ("durable-prefix".to_owned(), 1, "announced".to_owned())
        );

        let content = b"name,value\nalpha,1\n".to_vec();
        let digest = format!("{:x}", Sha256::digest(&content));
        let manifest = ArtifactManifest {
            artifact_id,
            agent_session_id,
            local_session_id: session_id,
            local_turn_id: turn_id,
            kind: ArtifactKind::File,
            provenance: ArtifactProvenance::Synthetic,
            ordinal: 0,
            display_name: identity.display_name,
            media_type: "text/csv".to_owned(),
            size_bytes: content.len(),
            sha256: digest.clone(),
            content_href: format!(
                "/v3/agent-sessions/{agent_session_id}/artifacts/{artifact_id}/content"
            ),
            poster_href: None,
        };
        repository.begin_artifact_transfer(&manifest).unwrap();
        let commit = repository
            .commit_artifact_with_cursor(
                &manifest,
                &DownloadedArtifact {
                    content: DownloadedResource {
                        media_type: manifest.media_type.clone(),
                        size_bytes: content.len(),
                        sha256: digest,
                        bytes: content,
                    },
                    poster: None,
                },
                100,
                Uuid::now_v7(),
                &second,
            )
            .unwrap();
        let ready: (String, String, i64) = repository.connection.query_row(
            "SELECT state, ack_state, sequence FROM chat_output_artifacts
             JOIN chat_event_cursors ON chat_event_cursors.session_id=chat_output_artifacts.session_id
             WHERE artifact_id=?1",
            [artifact_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(ready, ("ready".to_owned(), "pending".to_owned(), 2));
        assert_eq!(
            repository.pending_artifact_acknowledgements(64).unwrap()[0].commit,
            commit
        );
        drop(repository);
        fs::remove_dir_all(root).unwrap();
    }
}
