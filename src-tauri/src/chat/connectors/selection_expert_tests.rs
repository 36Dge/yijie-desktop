//! Normal metadata-only storage qualification; no Runtime or external provider.
use super::*;
use crate::chat::keychain::{DatabaseKey, ReceiptKey};

struct Fixture {
    root: std::path::PathBuf,
    repo: Option<ChatRepository>,
    scope: ChatScope,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("feat158-selection-{}", Uuid::now_v7()));
        std::fs::create_dir(&root).unwrap();
        let scope = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
        let mut repo = ChatRepository::open(
            &root.join("chat"),
            &DatabaseKey::from_bytes([71; 32]),
            ReceiptKey::from_bytes([72; 32]),
            scope.clone(),
        )
        .unwrap();
        crate::chat::migrations::migrate_to_target(&mut repo.connection, 34).unwrap();
        Self {
            root,
            repo: Some(repo),
            scope,
        }
    }
    fn repo(&mut self) -> &mut ChatRepository {
        self.repo.as_mut().unwrap()
    }
    fn reopen(&mut self) {
        drop(self.repo.take());
        self.repo = Some(
            ChatRepository::open(
                &self.root.join("chat"),
                &DatabaseKey::from_bytes([71; 32]),
                ReceiptKey::from_bytes([72; 32]),
                self.scope.clone(),
            )
            .unwrap(),
        );
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        drop(self.repo.take());
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}
fn resolved() -> expert_store::ResolvedExpert {
    expert_store::ResolvedExpert {
        reference: expert_wire::ExpertRef {
            expert_id: "sample-expert".into(),
            version: "0.1.0".into(),
            archive_sha256: "a".repeat(64),
            role_sha256: "b".repeat(64),
            knowledge_manifest_sha256: "c".repeat(64),
        },
        display: expert_wire::ExpertDisplay {
            expert_id: "sample-expert".into(),
            version: "0.1.0".into(),
            display_name: "普通合成专家".into(),
            subtitle: "本地参考".into(),
            icon_key: "skillOperations".into(),
        },
    }
}
fn request(expert: bool) -> expert_wire::NativeSubmitPayload {
    serde_json::from_value(serde_json::json!({"submission":{"operationId":Uuid::now_v7(),"projectId":null,"contentBlocks":[{"type":"text","text":"普通专家资源验证"}],"intent":{"profileId":"kimi-k3-max-v1","expectedRevision":0},"selection":[]},"expectedBindingRevision":0,"expert":if expert { serde_json::json!({"expertId":"sample-expert","version":"0.1.0"}) } else { serde_json::Value::Null }})).unwrap()
}

#[test]
fn feat158_expert_turn_freezes_with_existing_queue_and_replays_after_normal_reopen() {
    let mut fixture = Fixture::new();
    let request = request(true);
    let result = fixture
        .repo()
        .expert_submission_admitted(
            request.clone(),
            1,
            ExecutionAdmission::test(),
            Some(resolved()),
        )
        .unwrap();
    assert_eq!(result.binding_revision, 0);
    assert_eq!(result.expert.as_ref().unwrap().expert_id, "sample-expert");
    let scope = fixture.scope.clone();
    let (snapshot, display) = expert_store::submission(
        &fixture.repo().connection,
        &scope,
        &result.receipt.submission_operation_id,
    )
    .unwrap()
    .unwrap();
    assert_eq!(snapshot.turn_operation_id, result.receipt.turn_operation_id);
    assert_ne!(
        snapshot.turn_operation_id,
        result.receipt.submission_operation_id
    );
    assert_eq!(
        snapshot.snapshot_digest,
        expert_wire::snapshot_digest(&snapshot.turn_operation_id, 0, Some(&resolved().reference))
            .unwrap()
    );
    assert_eq!(display, result.expert);
    let counts:(i64,i64,i64)=fixture.repo().connection.query_row("SELECT (SELECT count(*) FROM chat_market_submissions),(SELECT count(*) FROM chat_expert_submissions),(SELECT count(*) FROM chat_market_dispatch)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
    assert_eq!(counts, (1, 1, 1));
    fixture.reopen();
    assert_eq!(
        fixture.repo().expert_submission_replay(&request).unwrap(),
        Some(result.clone())
    );
    // Frozen wrapper remains distinct from the ordinary family after reopen.
    assert!(matches!(
        fixture.repo().market_submission_replay(&request.submission),
        Err(ChatError::ConversationConflict)
    ));
    assert!(fixture
        .repo()
        .claim_next_conversation_outbox(super::super::now().unwrap(), 30)
        .unwrap()
        .is_none());
}

#[test]
fn feat158_explicit_ordinary_is_a_frozen_expert_family_snapshot() {
    let mut fixture = Fixture::new();
    let request = request(false);
    let result = fixture
        .repo()
        .expert_submission_admitted(request.clone(), 1, ExecutionAdmission::test(), None)
        .unwrap();
    assert_eq!(result.expert, None);
    let scope = fixture.scope.clone();
    let (snapshot, display) = expert_store::submission(
        &fixture.repo().connection,
        &scope,
        &result.receipt.submission_operation_id,
    )
    .unwrap()
    .unwrap();
    assert_eq!(snapshot.expert, None);
    assert_eq!(display, None);
    assert_eq!(
        snapshot.snapshot_digest,
        expert_wire::snapshot_digest(&snapshot.turn_operation_id, 0, None).unwrap()
    );
    let mut revised = request.clone();
    revised.expected_binding_revision = 1;
    assert!(matches!(
        fixture.repo().expert_submission_replay(&revised),
        Err(ChatError::ConversationConflict)
    ));
    assert_eq!(
        fixture.repo().expert_submission_replay(&request).unwrap(),
        Some(result)
    );
}
