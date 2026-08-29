use super::artifact::{
    ArtifactCommit, ArtifactEventV3, ArtifactIdentity, ArtifactManifest, ArtifactProgressStage,
    ArtifactProjection, DownloadedArtifact, PendingArtifactAcknowledgement, ReadyFileContent,
    ReadyFileReadError, ReadyImageContent, ReadyImageReadError, ReadyReportContent,
    ReadyReportReadError, ReadyVideoContent, ReadyVideoRangeContent, ReadyVideoRangeRequest,
    ReadyVideoReadError, StoredArtifactCommit, TransferDisposition,
};
use super::attachment::PreparedAttachment;
#[cfg(feature = "feat126-s10-driver")]
use super::database::Feat126ResumeCandidate;
use super::database::{
    ActiveTurnContext, AttachmentSummary, ChatRepository, ChatScope, ClaimedDeletion,
    ClaimedOutbox, CleanupSurfaceState, CreateSessionDispatch, DeletionStatus, DraftContentBlock,
    DraftTarget, Feat134HistorySnapshot, HistoryPage, InterruptTurnDispatch,
    MessageContentBlockProjection, OutboxState, PendingConversation, ProjectSummary,
    PublicTaskBindingState, PublicTaskControlPlaneStatus, ReasoningItem, RecoverySnapshot,
    SessionPage, SessionPageCursor, SessionSummary, StartTurnDispatch, StartTurnDispatchV2,
    TerminalTurnCommit, TurnProgress,
};
use super::error::ChatError;
use super::feat134::{
    Feat134HistoryProjection, Feat134Hydration, Feat134Projection, Feat134ProjectionFailure,
};
use super::keychain::{DatabaseKeyStore, ReceiptKeyStore};
use std::path::PathBuf;
use std::sync::{mpsc, Arc};
use tokio::sync::oneshot;

type DatabaseJob = Box<dyn FnOnce(&mut ChatRepository) + Send + 'static>;

#[derive(Clone)]
pub struct DatabaseWorker {
    inner: Arc<DatabaseWorkerInner>,
}

struct DatabaseWorkerInner {
    sender: Option<mpsc::Sender<DatabaseJob>>,
    thread: Option<std::thread::JoinHandle<()>>,
    #[cfg(test)]
    thread_lifetime: std::sync::Weak<()>,
}

impl Drop for DatabaseWorkerInner {
    fn drop(&mut self) {
        self.sender.take();
        let Some(thread) = self.thread.take() else {
            return;
        };
        if thread.thread().id() == std::thread::current().id() {
            return;
        }
        let _ = thread.join();
    }
}

impl DatabaseWorker {
    pub fn start(
        chat_directory: PathBuf,
        scope: ChatScope,
        key_store: Box<dyn DatabaseKeyStore>,
        receipt_key_store: Box<dyn ReceiptKeyStore>,
    ) -> Result<Self, ChatError> {
        let database_exists = ChatRepository::database_exists(&chat_directory);
        let key = key_store.load_or_create(database_exists)?;
        let deletion_identity_exists =
            ChatRepository::deletion_identity_exists(&chat_directory, &key)?;
        let receipt_key = receipt_key_store.load_or_create(deletion_identity_exists)?;
        let repository = ChatRepository::open(&chat_directory, &key, receipt_key, scope)?;
        let (sender, receiver) = mpsc::channel::<DatabaseJob>();
        #[cfg(test)]
        let thread_lifetime = Arc::new(());
        #[cfg(test)]
        let thread_lifetime_probe = Arc::downgrade(&thread_lifetime);
        let thread = std::thread::Builder::new()
            .name("yijie-chat-database".to_owned())
            .spawn(move || {
                #[cfg(test)]
                let _thread_lifetime = thread_lifetime;
                let mut repository = repository;
                while let Ok(job) = receiver.recv() {
                    job(&mut repository);
                }
            })
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        Ok(Self {
            inner: Arc::new(DatabaseWorkerInner {
                sender: Some(sender),
                thread: Some(thread),
                #[cfg(test)]
                thread_lifetime: thread_lifetime_probe,
            }),
        })
    }

    #[cfg(feature = "feat128-s10-runtime")]
    pub(super) async fn feat128_s10d_checkpoint(&self) -> Result<(), ChatError> {
        self.call(|repository| repository.checkpoint_after_delete())
            .await
    }

    async fn call<T, F>(&self, operation: F) -> Result<T, ChatError>
    where
        T: Send + 'static,
        F: FnOnce(&mut ChatRepository) -> Result<T, ChatError> + Send + 'static,
    {
        let (result_sender, result_receiver) = oneshot::channel();
        self.inner
            .sender
            .as_ref()
            .ok_or(ChatError::DatabaseUnavailable)?
            .send(Box::new(move |repository| {
                let _ = result_sender.send(operation(repository));
            }))
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        result_receiver
            .await
            .map_err(|_| ChatError::DatabaseUnavailable)?
    }

    #[cfg(test)]
    pub(super) fn thread_lifetime_probe(&self) -> std::sync::Weak<()> {
        self.inner.thread_lifetime.clone()
    }

    pub async fn schema_version(&self) -> Result<i64, ChatError> {
        self.call(|repository| repository.schema_version()).await
    }

    pub async fn probe_storage(&self) -> Result<(), ChatError> {
        self.call(|repository| repository.probe_storage()).await
    }

    pub async fn register_project(
        &self,
        canonical_path: PathBuf,
        bookmark: Vec<u8>,
    ) -> Result<ProjectSummary, ChatError> {
        self.call(move |repository| repository.register_project(&canonical_path, &bookmark))
            .await
    }

    pub async fn list_projects(&self) -> Result<Vec<ProjectSummary>, ChatError> {
        self.call(|repository| repository.list_projects()).await
    }

    pub async fn project_bookmark(&self, project_id: String) -> Result<Vec<u8>, ChatError> {
        self.call(move |repository| repository.project_bookmark(&project_id))
            .await
    }

    pub async fn refresh_project(
        &self,
        project_id: String,
        canonical_path: PathBuf,
        bookmark: Vec<u8>,
    ) -> Result<ProjectSummary, ChatError> {
        self.call(move |repository| {
            repository.refresh_project(&project_id, &canonical_path, &bookmark)
        })
        .await
    }

    pub async fn remove_project(&self, project_id: String) -> Result<(), ChatError> {
        self.call(move |repository| repository.remove_project(&project_id))
            .await
    }

    pub async fn set_project_pinned(
        &self,
        project_id: uuid::Uuid,
        pinned: bool,
        now: i64,
    ) -> Result<(), ChatError> {
        self.call(move |repository| repository.set_project_pinned(project_id, pinned, now))
            .await
    }

    pub async fn store_attachment(
        &self,
        attachment: PreparedAttachment,
        draft_target: DraftTarget,
    ) -> Result<AttachmentSummary, ChatError> {
        self.call(move |repository| repository.store_attachment(attachment, draft_target))
            .await
    }

    pub async fn store_attachments(
        &self,
        attachments: Vec<PreparedAttachment>,
        remaining_capacity: usize,
        draft_target: DraftTarget,
    ) -> Result<Vec<AttachmentSummary>, ChatError> {
        self.call(move |repository| {
            repository.store_attachments(attachments, remaining_capacity, draft_target)
        })
        .await
    }

    pub async fn list_ready_attachments(
        &self,
        draft_target: DraftTarget,
    ) -> Result<Vec<AttachmentSummary>, ChatError> {
        self.call(move |repository| repository.list_ready_attachments(draft_target))
            .await
    }

    pub async fn remove_ready_attachment(
        &self,
        attachment_id: uuid::Uuid,
        draft_target: DraftTarget,
    ) -> Result<(), ChatError> {
        self.call(move |repository| repository.remove_ready_attachment(attachment_id, draft_target))
            .await
    }

    pub async fn expire_attachments(&self, now: i64) -> Result<usize, ChatError> {
        self.call(move |repository| repository.expire_attachments(now))
            .await
    }

    pub async fn load_message_content_blocks(
        &self,
        message_ids: Vec<uuid::Uuid>,
    ) -> Result<Vec<(uuid::Uuid, Vec<MessageContentBlockProjection>)>, ChatError> {
        self.call(move |repository| repository.load_message_content_blocks(message_ids))
            .await
    }

    pub async fn begin_artifact_transfer(
        &self,
        manifest: ArtifactManifest,
    ) -> Result<TransferDisposition, ChatError> {
        self.call(move |repository| repository.begin_artifact_transfer(&manifest))
            .await
    }

    pub async fn record_artifact_started(
        &self,
        identity: ArtifactIdentity,
    ) -> Result<(), ChatError> {
        self.call(move |repository| repository.record_artifact_started(&identity))
            .await
    }

    pub async fn commit_artifact_event_progress(
        &self,
        progress: TurnProgress,
        event: ArtifactEventV3,
    ) -> Result<(), ChatError> {
        self.call(move |repository| repository.commit_artifact_event_progress(&progress, &event))
            .await
    }

    pub async fn commit_artifact_failure_with_cursor(
        &self,
        progress: TurnProgress,
        identity: ArtifactIdentity,
        error_code: String,
        retryable: bool,
    ) -> Result<(), ChatError> {
        self.call(move |repository| {
            repository.commit_artifact_failure_with_cursor(
                &progress,
                &identity,
                &error_code,
                retryable,
            )
        })
        .await
    }

    pub async fn record_artifact_progress(
        &self,
        identity: ArtifactIdentity,
        stage: Option<ArtifactProgressStage>,
        progress_percent: Option<f64>,
    ) -> Result<(), ChatError> {
        self.call(move |repository| {
            repository.record_artifact_progress(&identity, stage, progress_percent)
        })
        .await
    }

    pub async fn record_artifact_failed(
        &self,
        identity: ArtifactIdentity,
        error_code: String,
        retryable: bool,
    ) -> Result<(), ChatError> {
        self.call(move |repository| {
            repository.record_artifact_failed(&identity, &error_code, retryable)
        })
        .await
    }

    pub async fn cancel_inflight_artifacts(
        &self,
        session_id: uuid::Uuid,
        turn_id: uuid::Uuid,
    ) -> Result<usize, ChatError> {
        self.call(move |repository| repository.cancel_inflight_artifacts(session_id, turn_id))
            .await
    }

    pub async fn commit_artifact(
        &self,
        manifest: ArtifactManifest,
        downloaded: DownloadedArtifact,
        local_committed_at: i64,
        ack_id: uuid::Uuid,
    ) -> Result<ArtifactCommit, ChatError> {
        self.call(move |repository| {
            repository.commit_artifact(&manifest, &downloaded, local_committed_at, ack_id)
        })
        .await
    }

    pub async fn commit_artifact_with_cursor(
        &self,
        manifest: ArtifactManifest,
        downloaded: DownloadedArtifact,
        local_committed_at: i64,
        ack_id: uuid::Uuid,
        progress: TurnProgress,
    ) -> Result<ArtifactCommit, ChatError> {
        self.call(move |repository| {
            repository.commit_artifact_with_cursor(
                &manifest,
                &downloaded,
                local_committed_at,
                ack_id,
                &progress,
            )
        })
        .await
    }

    pub async fn artifact_commit(
        &self,
        manifest: ArtifactManifest,
    ) -> Result<StoredArtifactCommit, ChatError> {
        self.call(move |repository| repository.artifact_commit(&manifest))
            .await
    }

    pub async fn commit_existing_artifact_cursor(
        &self,
        progress: TurnProgress,
        manifest: ArtifactManifest,
    ) -> Result<StoredArtifactCommit, ChatError> {
        self.call(move |repository| {
            repository.commit_existing_artifact_cursor(&progress, &manifest)
        })
        .await
    }

    pub async fn pending_artifact_acknowledgements(
        &self,
    ) -> Result<Vec<PendingArtifactAcknowledgement>, ChatError> {
        self.call(|repository| repository.pending_artifact_acknowledgements(64))
            .await
    }

    pub async fn mark_artifact_acknowledged(
        &self,
        artifact_id: uuid::Uuid,
        ack_id: uuid::Uuid,
        acknowledged_at: i64,
    ) -> Result<(), ChatError> {
        self.call(move |repository| {
            repository.mark_artifact_acknowledged(artifact_id, ack_id, acknowledged_at)
        })
        .await
    }

    pub async fn load_artifacts_for_turns(
        &self,
        turn_ids: Vec<uuid::Uuid>,
    ) -> Result<Vec<ArtifactProjection>, ChatError> {
        self.call(move |repository| repository.load_artifacts_for_turns(&turn_ids))
            .await
    }

    pub(crate) async fn read_ready_image(
        &self,
        session_id: uuid::Uuid,
        turn_id: uuid::Uuid,
        artifact_id: uuid::Uuid,
        now: i64,
    ) -> Result<Result<ReadyImageContent, ReadyImageReadError>, ChatError> {
        self.call(move |repository| {
            repository.read_ready_image(session_id, turn_id, artifact_id, now)
        })
        .await
    }

    pub(crate) async fn read_ready_video(
        &self,
        session_id: uuid::Uuid,
        turn_id: uuid::Uuid,
        artifact_id: uuid::Uuid,
        now: i64,
    ) -> Result<Result<ReadyVideoContent, ReadyVideoReadError>, ChatError> {
        self.call(move |repository| {
            repository.read_ready_video(session_id, turn_id, artifact_id, now)
        })
        .await
    }

    pub(crate) async fn read_ready_file(
        &self,
        session_id: uuid::Uuid,
        turn_id: uuid::Uuid,
        artifact_id: uuid::Uuid,
        now: i64,
        max_bytes: usize,
    ) -> Result<Result<ReadyFileContent, ReadyFileReadError>, ChatError> {
        self.call(move |repository| {
            repository.read_ready_file(session_id, turn_id, artifact_id, now, max_bytes)
        })
        .await
    }

    pub(crate) async fn read_ready_report(
        &self,
        session_id: uuid::Uuid,
        turn_id: uuid::Uuid,
        artifact_id: uuid::Uuid,
        now: i64,
        max_bytes: usize,
    ) -> Result<Result<ReadyReportContent, ReadyReportReadError>, ChatError> {
        self.call(move |repository| {
            repository.read_ready_report(session_id, turn_id, artifact_id, now, max_bytes)
        })
        .await
    }

    pub(crate) async fn read_ready_video_range(
        &self,
        request: ReadyVideoRangeRequest,
    ) -> Result<Result<ReadyVideoRangeContent, ReadyVideoReadError>, ChatError> {
        self.call(move |repository| repository.read_ready_video_range(request))
            .await
    }

    pub async fn purge_expired_artifacts(&self, now: i64) -> Result<usize, ChatError> {
        self.call(move |repository| repository.purge_expired_artifacts(now))
            .await
    }

    pub async fn create_session_and_enqueue(
        &self,
        project_id: uuid::Uuid,
        input: String,
        operation_id: uuid::Uuid,
    ) -> Result<PendingConversation, ChatError> {
        self.create_session_and_enqueue_with_authority(project_id, input, operation_id, 1)
            .await
    }

    pub async fn create_session_and_enqueue_with_authority(
        &self,
        project_id: uuid::Uuid,
        input: String,
        operation_id: uuid::Uuid,
        authorization_revision: u64,
    ) -> Result<PendingConversation, ChatError> {
        self.call(move |repository| {
            repository.create_session_and_enqueue_with_authority(
                project_id,
                &input,
                operation_id,
                authorization_revision,
            )
        })
        .await
    }

    pub async fn create_session_and_enqueue_multimodal(
        &self,
        project_id: uuid::Uuid,
        blocks: Vec<DraftContentBlock>,
        operation_id: uuid::Uuid,
        authorization_revision: u64,
    ) -> Result<PendingConversation, ChatError> {
        self.call(move |repository| {
            repository.create_session_and_enqueue_multimodal(
                project_id,
                &blocks,
                operation_id,
                authorization_revision,
            )
        })
        .await
    }

    pub async fn enqueue_turn(
        &self,
        session_id: uuid::Uuid,
        input: String,
        operation_id: uuid::Uuid,
    ) -> Result<uuid::Uuid, ChatError> {
        self.call(move |repository| repository.enqueue_turn(session_id, &input, operation_id))
            .await
    }

    pub async fn enqueue_turn_multimodal(
        &self,
        session_id: uuid::Uuid,
        blocks: Vec<DraftContentBlock>,
        operation_id: uuid::Uuid,
    ) -> Result<uuid::Uuid, ChatError> {
        self.call(move |repository| {
            repository.enqueue_turn_multimodal(session_id, &blocks, operation_id)
        })
        .await
    }

    pub async fn claim_next_conversation_outbox(
        &self,
        now: i64,
        lease_seconds: i64,
    ) -> Result<Option<ClaimedOutbox>, ChatError> {
        self.call(move |repository| repository.claim_next_conversation_outbox(now, lease_seconds))
            .await
    }

    pub async fn load_create_session_dispatch(
        &self,
        operation_id: uuid::Uuid,
    ) -> Result<CreateSessionDispatch, ChatError> {
        self.call(move |repository| repository.load_create_session_dispatch(operation_id))
            .await
    }

    pub async fn bind_public_task(
        &self,
        create_operation_id: uuid::Uuid,
        public_task_id: uuid::Uuid,
        now: i64,
    ) -> Result<PublicTaskControlPlaneStatus, ChatError> {
        self.call(move |repository| {
            repository.bind_public_task(create_operation_id, public_task_id, now)
        })
        .await
    }

    pub async fn transition_public_task_binding(
        &self,
        create_operation_id: uuid::Uuid,
        state: PublicTaskBindingState,
        issue_code: String,
        next_attempt_at: Option<i64>,
        now: i64,
    ) -> Result<PublicTaskControlPlaneStatus, ChatError> {
        self.call(move |repository| {
            repository.transition_public_task_binding(
                create_operation_id,
                state,
                &issue_code,
                next_attempt_at,
                now,
            )
        })
        .await
    }

    pub async fn public_task_control_plane_status(
        &self,
        session_id: uuid::Uuid,
    ) -> Result<PublicTaskControlPlaneStatus, ChatError> {
        self.call(move |repository| repository.public_task_control_plane_status(session_id))
            .await
    }

    pub async fn resume_blocked_public_tasks(
        &self,
        authorization_revision: u64,
        now: i64,
    ) -> Result<usize, ChatError> {
        self.call(move |repository| {
            repository.resume_blocked_public_tasks(authorization_revision, now)
        })
        .await
    }

    pub async fn bind_host_session_and_enqueue_turn(
        &self,
        create_operation_id: uuid::Uuid,
        task_id: uuid::Uuid,
        agent_session_id: uuid::Uuid,
        codex_thread_id: uuid::Uuid,
    ) -> Result<(), ChatError> {
        self.call(move |repository| {
            repository.bind_host_session_and_enqueue_turn(
                create_operation_id,
                task_id,
                agent_session_id,
                codex_thread_id,
            )
        })
        .await
    }

    pub async fn load_start_turn_dispatch(
        &self,
        operation_id: uuid::Uuid,
    ) -> Result<StartTurnDispatch, ChatError> {
        self.call(move |repository| repository.load_start_turn_dispatch(operation_id))
            .await
    }

    pub async fn start_turn_payload_version(
        &self,
        operation_id: uuid::Uuid,
    ) -> Result<i64, ChatError> {
        self.call(move |repository| repository.start_turn_payload_version(operation_id))
            .await
    }

    pub async fn load_start_turn_dispatch_v2(
        &self,
        operation_id: uuid::Uuid,
    ) -> Result<StartTurnDispatchV2, ChatError> {
        self.call(move |repository| repository.load_start_turn_dispatch_v2(operation_id))
            .await
    }

    pub async fn enqueue_interrupt(
        &self,
        session_id: uuid::Uuid,
        operation_id: uuid::Uuid,
    ) -> Result<uuid::Uuid, ChatError> {
        self.call(move |repository| repository.enqueue_interrupt(session_id, operation_id))
            .await
    }

    pub async fn load_interrupt_dispatch(
        &self,
        operation_id: uuid::Uuid,
    ) -> Result<InterruptTurnDispatch, ChatError> {
        self.call(move |repository| repository.load_interrupt_dispatch(operation_id))
            .await
    }

    pub async fn complete_interrupt(&self, operation_id: uuid::Uuid) -> Result<(), ChatError> {
        self.call(move |repository| repository.complete_interrupt(operation_id))
            .await
    }

    pub async fn finalize_interrupted_without_stream(
        &self,
        operation_id: uuid::Uuid,
        terminal_at: i64,
    ) -> Result<(), ChatError> {
        self.call(move |repository| {
            repository.finalize_interrupted_without_stream(operation_id, terminal_at)
        })
        .await
    }

    pub async fn finalize_orphaned_turn_without_stream(
        &self,
        session_id: uuid::Uuid,
        turn_id: uuid::Uuid,
        runtime_turn_id: uuid::Uuid,
        terminal_at: i64,
    ) -> Result<(), ChatError> {
        self.call(move |repository| {
            repository.finalize_orphaned_turn_without_stream(
                session_id,
                turn_id,
                runtime_turn_id,
                terminal_at,
            )
        })
        .await
    }

    pub async fn suspend_started_turn_retry(
        &self,
        operation_id: uuid::Uuid,
        runtime_turn_id: uuid::Uuid,
    ) -> Result<(), ChatError> {
        self.call(move |repository| {
            repository.suspend_started_turn_retry(operation_id, runtime_turn_id)
        })
        .await
    }

    pub async fn suspend_uncertain_start_turn(
        &self,
        operation_id: uuid::Uuid,
    ) -> Result<(), ChatError> {
        self.call(move |repository| repository.suspend_uncertain_start_turn(operation_id))
            .await
    }

    pub async fn reschedule_outbox(
        &self,
        operation_id: uuid::Uuid,
        next_attempt_at: i64,
    ) -> Result<(), ChatError> {
        self.call(move |repository| repository.reschedule_outbox(operation_id, next_attempt_at))
            .await
    }

    pub async fn fail_outbox(&self, operation_id: uuid::Uuid) -> Result<(), ChatError> {
        self.call(move |repository| repository.fail_outbox(operation_id))
            .await
    }

    pub async fn finalize_failed_start_turn_dispatch(
        &self,
        operation_id: uuid::Uuid,
        terminal_at: i64,
    ) -> Result<super::database::FailedStartTurnProjection, ChatError> {
        self.call(move |repository| {
            repository.finalize_failed_start_turn_dispatch(operation_id, terminal_at)
        })
        .await
    }

    pub async fn recover_next_failed_start_turn_projection(
        &self,
        terminal_at: i64,
    ) -> Result<Option<super::database::FailedStartTurnProjection>, ChatError> {
        self.call(move |repository| {
            repository.recover_next_failed_start_turn_projection(terminal_at)
        })
        .await
    }

    pub async fn active_turn_context(
        &self,
        session_id: uuid::Uuid,
    ) -> Result<ActiveTurnContext, ChatError> {
        self.call(move |repository| repository.active_turn_context(session_id))
            .await
    }

    pub async fn clear_event_cursor_after_stream_change(
        &self,
        session_id: uuid::Uuid,
        expected: super::database::StoredEventCursor,
    ) -> Result<(), ChatError> {
        self.call(move |repository| {
            repository.clear_event_cursor_after_stream_change(session_id, &expected)
        })
        .await
    }

    pub async fn reset_feat134_after_stream_change(
        &self,
        session_id: uuid::Uuid,
        turn_id: uuid::Uuid,
        expected: super::database::StoredEventCursor,
    ) -> Result<(), ChatError> {
        self.call(move |repository| {
            repository.reset_feat134_after_stream_change(session_id, turn_id, &expected)
        })
        .await
    }

    pub async fn persist_feat134_projection(
        &self,
        projection: Feat134Projection,
    ) -> Result<u64, ChatError> {
        self.call(move |repository| repository.persist_feat134_projection(&projection))
            .await
    }

    pub async fn persist_feat136_projection(
        &self,
        projection: Feat134Projection,
    ) -> Result<u64, ChatError> {
        self.call(move |repository| repository.persist_feat136_projection(&projection))
            .await
    }

    pub async fn commit_feat134_terminal(
        &self,
        projection: Feat134Projection,
    ) -> Result<u64, ChatError> {
        self.call(move |repository| repository.commit_feat134_terminal(&projection))
            .await
    }

    pub async fn commit_feat136_terminal(
        &self,
        projection: Feat134Projection,
    ) -> Result<u64, ChatError> {
        self.call(move |repository| repository.commit_feat136_terminal(&projection))
            .await
    }

    pub async fn commit_feat134_projection_failure(
        &self,
        failure: Feat134ProjectionFailure,
    ) -> Result<Feat134Projection, ChatError> {
        self.call(move |repository| repository.commit_feat134_projection_failure(&failure))
            .await
    }

    pub async fn commit_feat136_projection_failure(
        &self,
        failure: Feat134ProjectionFailure,
    ) -> Result<Feat134Projection, ChatError> {
        self.call(move |repository| repository.commit_feat136_projection_failure(&failure))
            .await
    }

    pub async fn load_feat134_hydration(
        &self,
        turn_id: uuid::Uuid,
    ) -> Result<Feat134Hydration, ChatError> {
        self.call(move |repository| repository.load_feat134_hydration(turn_id))
            .await
    }

    pub async fn turn_projection_schema_version(
        &self,
        turn_id: uuid::Uuid,
    ) -> Result<Option<u8>, ChatError> {
        self.call(move |repository| repository.turn_projection_schema_version(turn_id))
            .await
    }

    pub async fn load_feat136_hydration(
        &self,
        turn_id: uuid::Uuid,
    ) -> Result<Feat134Hydration, ChatError> {
        self.call(move |repository| repository.load_feat136_hydration(turn_id))
            .await
    }

    pub async fn classify_feat136_observed_event(
        &self,
        session_id: uuid::Uuid,
        turn_id: uuid::Uuid,
        cursor: super::database::StoredEventCursor,
        event_type: String,
        source_turn_scoped: bool,
    ) -> Result<super::database::Feat136ObservedEventDisposition, ChatError> {
        self.call(move |repository| {
            repository.classify_feat136_observed_event(
                session_id,
                turn_id,
                &cursor,
                &event_type,
                source_turn_scoped,
            )
        })
        .await
    }

    pub async fn load_feat134_history_projection(
        &self,
        session_id: uuid::Uuid,
        turn_ids: Vec<uuid::Uuid>,
    ) -> Result<Feat134HistoryProjection, ChatError> {
        self.call(move |repository| {
            repository.load_feat134_history_projection(session_id, &turn_ids)
        })
        .await
    }

    pub async fn load_feat136_history_projection(
        &self,
        session_id: uuid::Uuid,
        turn_ids: Vec<uuid::Uuid>,
    ) -> Result<Feat134HistoryProjection, ChatError> {
        self.call(move |repository| {
            repository.load_feat136_history_projection(session_id, &turn_ids)
        })
        .await
    }

    pub async fn load_feat134_history_snapshot(
        &self,
        session_id: uuid::Uuid,
        before_ordinal: Option<u64>,
        limit: Option<usize>,
    ) -> Result<Feat134HistorySnapshot, ChatError> {
        self.call(move |repository| {
            repository.load_feat134_history_snapshot(session_id, before_ordinal, limit)
        })
        .await
    }

    pub async fn load_feat136_history_snapshot(
        &self,
        session_id: uuid::Uuid,
        before_ordinal: Option<u64>,
        limit: Option<usize>,
    ) -> Result<Feat134HistorySnapshot, ChatError> {
        self.call(move |repository| {
            repository.load_feat136_history_snapshot(session_id, before_ordinal, limit)
        })
        .await
    }

    pub async fn persist_turn_progress(&self, progress: TurnProgress) -> Result<(), ChatError> {
        self.call(move |repository| repository.persist_turn_progress(&progress))
            .await
    }

    pub async fn commit_terminal_turn(
        &self,
        terminal: TerminalTurnCommit,
    ) -> Result<(), ChatError> {
        self.call(move |repository| repository.commit_terminal_turn(&terminal))
            .await
    }

    pub async fn list_sessions(
        &self,
        cursor: Option<SessionPageCursor>,
        requested_limit: Option<usize>,
    ) -> Result<SessionPage, ChatError> {
        self.call(move |repository| repository.list_sessions(cursor.as_ref(), requested_limit))
            .await
    }

    pub async fn session_summary(
        &self,
        session_id: uuid::Uuid,
    ) -> Result<SessionSummary, ChatError> {
        self.call(move |repository| repository.session_summary(session_id))
            .await
    }

    pub async fn load_history(
        &self,
        session_id: uuid::Uuid,
        before_ordinal: Option<u64>,
        requested_limit: Option<usize>,
    ) -> Result<HistoryPage, ChatError> {
        self.call(move |repository| {
            repository.load_history(session_id, before_ordinal, requested_limit)
        })
        .await
    }

    pub async fn load_reasoning(
        &self,
        turn_id: uuid::Uuid,
    ) -> Result<Vec<ReasoningItem>, ChatError> {
        self.call(move |repository| repository.load_reasoning(&turn_id.to_string()))
            .await
    }

    pub async fn enqueue_title_job(
        &self,
        session_id: uuid::Uuid,
        operation_id: uuid::Uuid,
    ) -> Result<bool, ChatError> {
        self.call(move |repository| repository.enqueue_title_job(session_id, operation_id))
            .await
    }

    pub async fn apply_model_title(
        &self,
        session_id: uuid::Uuid,
        operation_id: uuid::Uuid,
        title: String,
    ) -> Result<bool, ChatError> {
        self.call(move |repository| repository.apply_model_title(session_id, operation_id, &title))
            .await
    }

    pub async fn rename_session(
        &self,
        session_id: uuid::Uuid,
        title: String,
    ) -> Result<(), ChatError> {
        self.call(move |repository| repository.rename_session(session_id, &title))
            .await
    }

    pub async fn set_session_pinned(
        &self,
        session_id: uuid::Uuid,
        pinned: bool,
        now: i64,
    ) -> Result<(), ChatError> {
        self.call(move |repository| repository.set_session_pinned(session_id, pinned, now))
            .await
    }

    pub async fn begin_session_deletion(
        &self,
        session_id: uuid::Uuid,
        operation_id: uuid::Uuid,
        now: i64,
    ) -> Result<DeletionStatus, ChatError> {
        self.call(move |repository| {
            repository.begin_session_deletion(session_id, operation_id, now)
        })
        .await
    }

    pub async fn claim_next_deletion(
        &self,
        now: i64,
        lease_seconds: i64,
    ) -> Result<Option<ClaimedDeletion>, ChatError> {
        self.call(move |repository| repository.claim_next_deletion(now, lease_seconds))
            .await
    }

    pub async fn record_cleanup_surfaces(
        &self,
        operation_id: uuid::Uuid,
        host_state: CleanupSurfaceState,
        runtime_state: CleanupSurfaceState,
        outcome_code: String,
        next_attempt_at: i64,
    ) -> Result<(), ChatError> {
        self.call(move |repository| {
            repository.record_cleanup_surfaces(
                operation_id,
                host_state,
                runtime_state,
                &outcome_code,
                next_attempt_at,
            )
        })
        .await
    }

    pub async fn reschedule_deletion(
        &self,
        operation_id: uuid::Uuid,
        next_attempt_at: i64,
    ) -> Result<(), ChatError> {
        self.call(move |repository| repository.reschedule_deletion(operation_id, next_attempt_at))
            .await
    }

    pub async fn complete_local_deletion(&self, operation_id: uuid::Uuid) -> Result<(), ChatError> {
        self.call(move |repository| repository.complete_local_deletion(operation_id))
            .await
    }

    pub async fn finalize_deletion_receipt(
        &self,
        operation_id: uuid::Uuid,
        completed_at: i64,
    ) -> Result<DeletionStatus, ChatError> {
        self.call(move |repository| {
            repository.finalize_deletion_receipt(operation_id, completed_at)
        })
        .await
    }

    pub async fn deletion_status(
        &self,
        operation_id: uuid::Uuid,
    ) -> Result<Option<DeletionStatus>, ChatError> {
        self.call(move |repository| repository.deletion_status(operation_id))
            .await
    }

    pub async fn deletion_status_for_session(
        &self,
        session_id: uuid::Uuid,
    ) -> Result<Option<DeletionStatus>, ChatError> {
        self.call(move |repository| repository.deletion_status_for_session(session_id))
            .await
    }

    pub async fn recovery_snapshot(&self) -> Result<RecoverySnapshot, ChatError> {
        self.call(|repository| repository.recovery_snapshot()).await
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub(crate) async fn feat126_resume_candidates(
        &self,
    ) -> Result<Vec<Feat126ResumeCandidate>, ChatError> {
        self.call(|repository| repository.feat126_resume_candidates())
            .await
    }

    pub async fn purge_expired_deletion_receipts(&self, now: i64) -> Result<usize, ChatError> {
        self.call(move |repository| repository.purge_expired_deletion_receipts(now))
            .await
    }

    pub async fn outbox_state(&self, operation_id: uuid::Uuid) -> Result<OutboxState, ChatError> {
        self.call(move |repository| repository.outbox_state(operation_id))
            .await
    }
}
