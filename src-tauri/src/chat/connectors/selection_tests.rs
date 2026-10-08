use super::*;
use crate::chat::keychain::{DatabaseKey, ReceiptKey};
use std::path::PathBuf;

struct Fixture {
    root: PathBuf,
    repo: Option<ChatRepository>,
    project: Uuid,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("feat157-selection-{}", Uuid::now_v7()));
        std::fs::create_dir(&root).unwrap();
        let scope = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
        let mut repo = ChatRepository::open(
            &root.join("chat"),
            &DatabaseKey::from_bytes([157; 32]),
            ReceiptKey::from_bytes([158; 32]),
            scope,
        )
        .unwrap();
        crate::chat::migrations::migrate_to_target(&mut repo.connection, 32).unwrap();
        let workspace = root.join("project");
        std::fs::create_dir(&workspace).unwrap();
        let project = id(&repo
            .register_project(&workspace, b"ordinary-project-bookmark")
            .unwrap()
            .id)
        .unwrap();
        Self {
            root,
            repo: Some(repo),
            project,
        }
    }
    fn repo(&mut self) -> &mut ChatRepository {
        self.repo.as_mut().unwrap()
    }
    fn request(&self) -> wire::SubmitPayload {
        serde_json::from_value(serde_json::json!({"operationId":Uuid::now_v7(),"projectId":self.project,"contentBlocks":[{"type":"text","text":"ordinary local submission"}],"intent":{"profileId":"kimi-k3-max-v1","expectedRevision":0},"selection":[]})).unwrap()
    }
    fn selection(&mut self, index: usize) -> management::SelectionRef {
        let entry = &super::super::catalog().catalog[index];
        let repo = self.repo();
        let r = super::super::store::install(
            &mut repo.connection,
            &repo.scope,
            entry,
            1,
            management::InstallPayload {
                operation_id: Uuid::now_v7().to_string(),
                service_id: entry.service_id.clone(),
                expected_revision: 0,
            },
            100,
        )
        .unwrap();
        management::SelectionRef {
            installation_id: r.installation.installation_id,
            revision: r.installation.revision,
            generation: r.installation.generation,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        drop(self.repo.take());
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}
fn counts(repo: &ChatRepository) -> (i64, i64, i64, i64) {
    repo.connection.query_row("SELECT (SELECT count(*) FROM chat_sessions),(SELECT count(*) FROM chat_messages),(SELECT count(*) FROM chat_outbox),(SELECT count(*) FROM chat_market_submissions)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap()
}

#[test]
fn feat157_selection_unready_provider_does_not_enqueue_even_empty_selection() {
    let mut f = Fixture::new();
    let request = f.request();
    let before = counts(f.repo());
    assert!(matches!(
        f.repo().market_submission(request, 1),
        Err(ChatError::OrchestrationUnavailable)
    ));
    assert_eq!(counts(f.repo()), before);
}

#[test]
fn feat157_selection_first_turn_snapshot_is_atomic_and_survives_normal_reopen() {
    let mut f = Fixture::new();
    let mut request = f.request();
    request.selection = vec![f.selection(1), f.selection(0)];
    // This tests storage using ordinary installation fixtures, not live tool
    // eligibility. Production requires current private-owner evidence.
    let first = f
        .repo()
        .freeze_market_submission(request.clone(), 1, ExecutionAdmission::test())
        .unwrap();
    assert_ne!(first.submission_operation_id, first.turn_operation_id);
    assert_eq!(
        first.selection_digest,
        wire::selection_digest(&first.turn_operation_id, &request.selection).unwrap()
    );
    assert_ne!(
        first.selection_digest,
        wire::selection_digest(&first.submission_operation_id, &request.selection).unwrap()
    );
    let before = counts(f.repo());
    let (aliases,first_turn_outboxes,foreign_keys):(i64,i64,i64)=f.repo().connection.query_row("SELECT (SELECT count(*) FROM chat_market_operation_refs),(SELECT count(*) FROM chat_outbox WHERE operation_id=?1),(SELECT count(*) FROM pragma_foreign_key_check)",[&first.turn_operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
    assert_eq!((aliases, first_turn_outboxes, foreign_keys), (2, 0, 0));
    request.selection.reverse();
    assert_eq!(
        f.repo().market_submission_replay(&request).unwrap(),
        Some(first.clone())
    );
    assert_eq!(counts(f.repo()), before);
    assert_eq!(
        f.repo().market_submission(request.clone(), 2).unwrap(),
        first
    );
    // A later global disable/reinstall generation must not rewrite old receipts.
    f.repo()
        .connection
        .execute(
            "UPDATE chat_connector_installations SET revision=revision+1,generation=generation+1",
            [],
        )
        .unwrap();
    assert_eq!(
        f.repo().market_submission_replay(&request).unwrap(),
        Some(first.clone())
    );
    assert_eq!(
        f.repo().market_submission(request.clone(), 2).unwrap(),
        first
    );
    assert_eq!(counts(f.repo()), before);
    let scope = f.repo().scope.clone();
    drop(f.repo.take());
    f.repo = Some(
        ChatRepository::open(
            &f.root.join("chat"),
            &DatabaseKey::from_bytes([157; 32]),
            ReceiptKey::from_bytes([158; 32]),
            scope,
        )
        .unwrap(),
    );
    assert_eq!(f.repo().market_submission(request, 3).unwrap(), first);
    assert_eq!(counts(f.repo()), before);
}

#[test]
fn feat157_selection_same_operation_binds_complete_intent_and_never_adopts_legacy() {
    let mut f = Fixture::new();
    let mut request = f.request();
    request.selection = vec![f.selection(0)];
    f.repo()
        .freeze_market_submission(request.clone(), 1, ExecutionAdmission::test())
        .unwrap();
    let before = counts(f.repo());
    let mut changes = Vec::new();
    let mut changed = request.clone();
    changed.content_blocks = vec![wire::ContentBlock::Text(wire::TextInput {
        r#type: "text".into(),
        text: "a different ordinary draft".into(),
    })];
    changes.push(changed);
    let mut changed = request.clone();
    changed.intent.profile_id = wire::ProfileId::MinimaxM3HighV1;
    changes.push(changed);
    let mut changed = request.clone();
    changed.project_id = None;
    changes.push(changed);
    let mut changed = request.clone();
    changed.selection[0].generation += 1;
    changes.push(changed);
    let mut changed = request.clone();
    changed.content_blocks = vec![wire::ContentBlock::File(wire::FileInput {
        r#type: "file".into(),
        attachment_id: Uuid::now_v7().to_string(),
    })];
    changes.push(changed);
    for changed in changes {
        assert!(matches!(
            f.repo().market_submission(changed, 2),
            Err(ChatError::ConversationConflict)
        ));
        assert_eq!(counts(f.repo()), before);
    }
    let mut legacy = f.request();
    let project = f.project;
    f.repo()
        .create_model_session(
            Some(project),
            blocks(&legacy).unwrap(),
            id(&legacy.operation_id).unwrap(),
            1,
            models::ModelIntent {
                profile_id: legacy.intent.profile_id,
                expected_revision: 0,
            },
        )
        .unwrap();
    legacy.selection.clear();
    assert!(matches!(
        f.repo().market_submission(legacy, 1),
        Err(ChatError::ConversationConflict)
    ));
    assert_eq!(counts(f.repo()).3, 1);
}

#[test]
fn feat157_selection_late_model_conflict_rolls_back_message_and_outbox() {
    let mut f = Fixture::new();
    let project = f.project;
    let receipt = f
        .repo()
        .create_session_and_enqueue(project, "ordinary prior chat", Uuid::now_v7())
        .unwrap();
    // A normally completed unmodeled legacy conversation, then a new market
    // operation. Invalid model intent is detected after the outbox insertion.
    f.repo()
        .connection
        .execute(
            "UPDATE chat_turns SET status='completed',terminal_at=100 WHERE id=?1",
            [receipt.turn_id.to_string()],
        )
        .unwrap();
    f.repo()
        .connection
        .execute(
            "UPDATE chat_sessions SET agent_session_id=?2,runtime_thread_id=?3 WHERE id=?1",
            params![
                receipt.session_id.to_string(),
                Uuid::now_v7().to_string(),
                Uuid::now_v7().to_string()
            ],
        )
        .unwrap();
    let mut next = f.request();
    next.project_id = None;
    next.session_id = Some(receipt.session_id.to_string());
    next.intent.expected_revision = 2;
    let before = counts(f.repo());
    assert!(matches!(
        f.repo()
            .freeze_market_submission(next.clone(), 1, ExecutionAdmission::test()),
        Err(ChatError::ConversationConflict)
    ));
    assert_eq!(counts(f.repo()), before);
    next.intent.profile_id = wire::ProfileId::MinimaxM3HighV1;
    next.intent.expected_revision = 0;
    let accepted = f
        .repo()
        .freeze_market_submission(next.clone(), 1, ExecutionAdmission::test())
        .unwrap();
    assert_eq!(accepted.submission_operation_id, accepted.turn_operation_id);
    assert_eq!(f.repo().market_submission(next, 1).unwrap(), accepted);
}

#[test]
fn feat157_selection_empty_uses_chat_permission_and_nonempty_requires_connector_use() {
    use crate::chat::authorization::{
        AuthoritativeChatProjection, AuthorizationFailure, ChatAuthorizationManager,
    };
    let f = Fixture::new();
    let scope = &f.repo.as_ref().unwrap().scope;
    let authority = ChatAuthorizationManager::new(scope).unwrap();
    let context = authority
        .bind(
            AuthoritativeChatProjection::from_trusted_native_projection(
                scope.tenant_uuid().unwrap(),
                1,
                500,
                [
                    "task.read".into(),
                    "task.create".into(),
                    "workspace.use".into(),
                ],
            )
            .unwrap(),
            100,
        )
        .unwrap();
    assert_eq!(
        authority
            .with_market_submit_context(context.context_id, scope, true, false, 101, |revision| {
                revision
            })
            .unwrap(),
        1
    );
    assert_eq!(
        authority.with_market_submit_context(
            context.context_id,
            scope,
            true,
            true,
            101,
            |revision| revision
        ),
        Err(AuthorizationFailure::CapabilityDenied)
    );
    assert_eq!(
        authority.with_market_submit_context(
            context.context_id,
            scope,
            true,
            false,
            401,
            |revision| revision
        ),
        Err(AuthorizationFailure::ContextInvalid)
    );
    let use_context = authority
        .bind(
            AuthoritativeChatProjection::from_trusted_native_projection(
                scope.tenant_uuid().unwrap(),
                2,
                500,
                [
                    "task.read".into(),
                    "task.create".into(),
                    "workspace.use".into(),
                    "connector.use".into(),
                ],
            )
            .unwrap(),
            102,
        )
        .unwrap();
    assert_eq!(
        authority
            .with_market_submit_context(
                use_context.context_id,
                scope,
                true,
                true,
                103,
                |revision| revision
            )
            .unwrap(),
        2
    );
}

#[test]
fn feat157_selection_sql31_preserves_sql30_installations_and_receipts() {
    let mut db = Connection::open_in_memory().unwrap();
    db.pragma_update(None, "foreign_keys", true).unwrap();
    crate::chat::migrations::migrate_to_target(&mut db, 30).unwrap();
    let scope = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
    let entry = &super::super::catalog().catalog[0];
    let installed = super::super::store::install(
        &mut db,
        &scope,
        entry,
        1,
        management::InstallPayload {
            operation_id: Uuid::now_v7().to_string(),
            service_id: entry.service_id.clone(),
            expected_revision: 0,
        },
        100,
    )
    .unwrap();
    let prior: Vec<(i64, String)> = db
        .prepare("SELECT version,sha256 FROM chat_schema_migrations ORDER BY version")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    crate::chat::migrations::migrate_to_target(&mut db, 31).unwrap();
    let after: Vec<(i64, String)> = db
        .prepare(
            "SELECT version,sha256 FROM chat_schema_migrations WHERE version<=30 ORDER BY version",
        )
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(prior, after);
    assert_eq!(
        super::super::store::operation(&db, &scope, &installed.operation.operation_id).unwrap(),
        installed
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM chat_market_submissions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    crate::chat::migrations::validate_reader(&db).unwrap();
}

#[test]
fn feat157_nonempty_selection_requires_explicit_ask_but_empty_preserves_modes() {
    use crate::chat::runtime_permissions::PermissionMode;
    for mode in [PermissionMode::Auto, PermissionMode::Full] {
        let mut f = Fixture::new();
        f.repo().set_permission_mode(None, mode, true).unwrap();
        let mut request = f.request();
        request.selection = vec![f.selection(0)];
        let before = counts(f.repo());
        assert!(matches!(
            f.repo()
                .freeze_market_submission(request, 1, ExecutionAdmission::test()),
            Err(ChatError::OrchestrationUnavailable)
        ));
        assert_eq!(counts(f.repo()), before);
        let empty = f.request();
        let accepted = f
            .repo()
            .freeze_market_submission(empty, 1, ExecutionAdmission::test())
            .unwrap();
        let frozen: String = f.repo().connection.query_row("SELECT permission_mode FROM chat_market_submissions WHERE submission_operation_id=?1", [accepted.submission_operation_id], |r| r.get(0)).unwrap();
        assert_eq!(frozen, mode.as_str());
    }
}
