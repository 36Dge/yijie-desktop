use super::*;
use crate::chat::{
    database::{DraftContentBlock, PendingConversation},
    keychain::{DatabaseKey, ReceiptKey},
    migrations,
    models::ModelIntent,
    models_generated as wire,
};
struct Fixture {
    root: std::path::PathBuf,
    repo: Option<ChatRepository>,
    project: Uuid,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("feat164-delivery-{}", Uuid::now_v7()));
        std::fs::create_dir(&root).unwrap();
        let mut repo = ChatRepository::open(
            &root.join("chat"),
            &DatabaseKey::from_bytes([164; 32]),
            ReceiptKey::from_bytes([165; 32]),
            ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap(),
        )
        .unwrap();
        migrations::migrate_to_target(&mut repo.connection, 40).unwrap();
        let workspace = root.join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let project = Uuid::parse_str(
            &repo
                .register_project(&workspace, b"ordinary-test-bookmark")
                .unwrap()
                .id,
        )
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
    fn create(&mut self) -> PendingConversation {
        let project = self.project;
        self.repo()
            .create_model_session(Some(project), blocks(), Uuid::now_v7(), 1, intent(0))
            .unwrap()
    }
    fn existing(&mut self) -> (Uuid, Uuid, Uuid) {
        let session = Uuid::now_v7();
        let host = Uuid::now_v7();
        let project = self.project;
        let r = self.repo();
        r.connection.execute("INSERT INTO chat_sessions(id,owner_user_id,tenant_id,project_id,title,title_source,title_job_status,created_at,last_activity_at,agent_session_id,runtime_thread_id) VALUES(?1,?2,?3,?4,'Synthetic history','user','completed',1,1,?5,?6)",params![session.to_string(),r.scope.owner_user_id,r.scope.tenant_id,project.to_string(),host.to_string(),Uuid::now_v7().to_string()]).unwrap();
        r.connection.execute("INSERT INTO chat_model_selections(session_id,profile_id,revision,state) VALUES(?1,'minimax-m3-high-v1',1,'ready')",[session.to_string()]).unwrap();
        let op = Uuid::now_v7();
        r.enqueue_model_turn(session, blocks(), op, intent(1))
            .unwrap();
        (session, host, op)
    }
    fn reopen(&mut self) {
        let scope = self.repo().scope.clone();
        drop(self.repo.take());
        self.repo = Some(
            ChatRepository::open(
                &self.root.join("chat"),
                &DatabaseKey::from_bytes([164; 32]),
                ReceiptKey::from_bytes([165; 32]),
                scope,
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
fn blocks() -> Vec<DraftContentBlock> {
    vec![DraftContentBlock::Text("Synthetic delivery check".into())]
}
fn intent(revision: i64) -> ModelIntent {
    ModelIntent {
        profile_id: wire::ProfileId::MinimaxM3HighV1,
        expected_revision: revision,
    }
}
fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}
fn count(r: &ChatRepository, sql: &str) -> i64 {
    r.connection.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn feat164_delivery_migration_does_not_backfill_legacy_pending() {
    let mut db = Connection::open_in_memory().unwrap();
    migrations::migrate_to_target(&mut db, 39).unwrap();
    let before: i64 = db
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(before, 39);
    migrations::migrate_to_target(&mut db, 40).unwrap();
    migrations::migrate_to_target(&mut db, 40).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM chat_delivery_proofs", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    migrations::validate_reader(&db).unwrap();
}
#[test]
fn feat164_delivery_cancel_after_claim_survives_reopen_without_rewriting_or_reviving() {
    let mut f = Fixture::new();
    let p = f.create();
    let before = proof(&f.repo().connection, p.turn_operation_id).unwrap();
    let claimed = f
        .repo()
        .claim_next_conversation_outbox(now(), 30)
        .unwrap()
        .unwrap();
    assert_eq!(claimed.operation_id, p.create_operation_id);
    assert_eq!(
        count(f.repo(), "SELECT claim_count FROM chat_delivery_proofs"),
        1
    );
    let receipt = f
        .repo()
        .cancel_unsent_delivery(p.session_id, p.turn_operation_id, now())
        .unwrap();
    assert!(f
        .repo()
        .begin_delivery_send(p.create_operation_id, "public")
        .is_err());
    assert!(f
        .repo()
        .reschedule_outbox(p.create_operation_id, now())
        .is_err());
    assert!(f
        .repo()
        .claim_next_conversation_outbox(now() + 60, 30)
        .unwrap()
        .is_none());
    assert_eq!(
        fingerprint(&f.repo().connection, &before).unwrap(),
        before.fingerprint
    );
    assert_eq!(
        count(
            f.repo(),
            "SELECT count(*) FROM chat_messages WHERE role='user'"
        ),
        1
    );
    assert_eq!(count(f.repo(),"SELECT count(*) FROM chat_turns WHERE status='queued' AND submission_status='cancelled' AND runtime_turn_id IS NULL"),1);
    f.reopen();
    assert_eq!(
        f.repo()
            .cancel_unsent_delivery(p.session_id, p.turn_operation_id, now() + 10)
            .unwrap(),
        receipt
    );
    assert!(f.repo().delivery_states(p.session_id).unwrap().is_empty());
    assert_eq!(
        count(f.repo(), "SELECT count(*) FROM pragma_foreign_key_check"),
        0
    );
}
#[test]
fn feat164_delivery_new_acceptance_replay_preserves_proof_and_input_identity() {
    let mut f = Fixture::new();
    let p = f.create();
    let project = f.project;
    let same = f
        .repo()
        .create_model_session(Some(project), blocks(), p.create_operation_id, 1, intent(0))
        .unwrap();
    assert_eq!(same.turn_id, p.turn_id);
    assert_eq!(
        count(f.repo(), "SELECT count(*) FROM chat_delivery_proofs"),
        1
    );
    assert!(f
        .repo()
        .create_model_session(
            Some(project),
            vec![DraftContentBlock::Text("Different ordinary input".into())],
            p.create_operation_id,
            1,
            intent(0)
        )
        .is_err());
    assert_eq!(
        count(
            f.repo(),
            "SELECT public_attempts+create_attempts+turn_attempts FROM chat_delivery_proofs"
        ),
        0
    );
}
#[test]
fn feat164_delivery_public_or_create_attempt_prevents_cancel_even_after_legacy_retry_reset() {
    for stage in ["public", "create"] {
        let mut f = Fixture::new();
        let p = f.create();
        f.repo()
            .claim_next_conversation_outbox(now(), 30)
            .unwrap()
            .unwrap();
        f.repo()
            .begin_delivery_send(p.create_operation_id, stage)
            .unwrap();
        f.repo()
            .reschedule_outbox(p.create_operation_id, now())
            .unwrap();
        // Compatibility fixture representing an old retry counter reset. Durable proof remains independent.
        f.repo()
            .connection
            .execute("UPDATE chat_outbox SET attempt_count=0", [])
            .unwrap();
        f.reopen();
        assert!(f
            .repo()
            .cancel_unsent_delivery(p.session_id, p.turn_operation_id, now())
            .is_err());
        assert_eq!(
            f.repo().delivery_states(p.session_id).unwrap()[0].status,
            "attempted"
        );
        assert_eq!(
            count(
                f.repo(),
                "SELECT public_attempts+create_attempts FROM chat_delivery_proofs"
            ),
            1
        );
    }
}
#[test]
fn feat164_delivery_ordinary_final_send_binds_operation_profile_path_and_is_single_use() {
    let mut f = Fixture::new();
    let (session, host, op) = f.existing();
    f.repo()
        .claim_next_conversation_outbox(now(), 30)
        .unwrap()
        .unwrap();
    let path = format!("/v2/agent-sessions/{host}/turns");
    let body = serde_json::to_vec(&serde_json::json!({"operation_id":op})).unwrap();
    assert!(f
        .repo()
        .begin_delivery_http(
            op,
            &format!("/v2/agent-sessions/{}/turns", Uuid::now_v7()),
            Some("minimax-m3-high-v1"),
            &body
        )
        .is_err());
    assert!(f
        .repo()
        .begin_delivery_http(op, &path, Some("kimi-k3-1-pro-max-v1"), &body)
        .is_err());
    assert_eq!(
        count(f.repo(), "SELECT turn_attempts FROM chat_delivery_proofs"),
        0
    );
    f.repo()
        .begin_delivery_http(op, &path, Some("minimax-m3-high-v1"), &body)
        .unwrap();
    assert!(f.repo().cancel_unsent_delivery(session, op, now()).is_err());
    assert!(f
        .repo()
        .begin_delivery_http(op, &path, Some("minimax-m3-high-v1"), &body)
        .is_err());
    f.repo().reschedule_outbox(op, now()).unwrap();
    assert!(f
        .repo()
        .claim_next_conversation_outbox(now() + 60, 30)
        .unwrap()
        .is_none());
}
#[test]
fn feat164_delivery_cancel_releases_lane_and_allows_explicit_model_selection() {
    let mut f = Fixture::new();
    let (session, _, op) = f.existing();
    assert!(f
        .repo()
        .begin_model_recovery_intent(session, intent(1), Uuid::now_v7())
        .is_err());
    f.repo()
        .claim_next_conversation_outbox(now(), 30)
        .unwrap()
        .unwrap();
    f.repo().cancel_unsent_delivery(session, op, now()).unwrap();
    assert!(f
        .repo()
        .record_failed_start_turn_submission(op, now())
        .is_err());
    let next = Uuid::now_v7();
    f.repo()
        .enqueue_model_turn(session, blocks(), next, intent(1))
        .unwrap();
    f.repo()
        .cancel_unsent_delivery(session, next, now())
        .unwrap();
    f.repo()
        .begin_model_recovery_intent(session, intent(1), Uuid::now_v7())
        .unwrap();
    assert_eq!(
        count(
            f.repo(),
            "SELECT count(*) FROM chat_messages WHERE role='user'"
        ),
        2
    );
}
#[test]
fn feat164_delivery_new_chat_binding_is_observed_before_first_turn_send() {
    let mut f = Fixture::new();
    let p = f.create();
    let task = Uuid::now_v7();
    let host = Uuid::now_v7();
    let thread = Uuid::now_v7();
    f.repo()
        .claim_next_conversation_outbox(now(), 30)
        .unwrap()
        .unwrap();
    f.repo()
        .begin_delivery_send(p.create_operation_id, "public")
        .unwrap();
    f.repo()
        .bind_public_task(p.create_operation_id, task, now())
        .unwrap();
    assert!(f
        .repo()
        .bind_host_session_and_enqueue_turn(p.create_operation_id, task, host, thread)
        .is_err());
    f.repo()
        .begin_delivery_http(
            p.create_operation_id,
            &format!("/v1/tasks/{task}/agent-sessions"),
            Some("minimax-m3-high-v1"),
            b"{}",
        )
        .unwrap();
    f.repo()
        .bind_host_session_and_enqueue_turn(p.create_operation_id, task, host, thread)
        .unwrap();
    assert_eq!(
        f.repo()
            .claim_next_conversation_outbox(now() + 1, 30)
            .unwrap()
            .unwrap()
            .operation_id,
        p.turn_operation_id
    );
    f.repo()
        .begin_delivery_http(
            p.turn_operation_id,
            &format!("/v2/agent-sessions/{host}/turns"),
            Some("minimax-m3-high-v1"),
            serde_json::to_string(&serde_json::json!({"operation_id":p.turn_operation_id}))
                .unwrap()
                .as_bytes(),
        )
        .unwrap();
}
#[test]
fn feat164_delivery_market_and_expert_have_independent_proof_and_no_ordinary_claim() {
    use crate::chat::{
        connectors::{selection::ExecutionAdmission, selection_generated},
        experts::{generated as expert, store},
    };
    for family in ["market", "expert"] {
        let mut f = Fixture::new();
        let project = f.project;
        let payload:selection_generated::SubmitPayload=serde_json::from_value(serde_json::json!({"operationId":Uuid::now_v7(),"projectId":project,"contentBlocks":[{"type":"text","text":"Synthetic delivery"}],"intent":{"profileId":"minimax-m3-high-v1","expectedRevision":0},"selection":[]})).unwrap();
        if family == "market" {
            f.repo()
                .market_submission_admitted(payload, 1, ExecutionAdmission::test())
                .unwrap();
        } else {
            let request = expert::NativeSubmitPayload {
                submission: payload,
                expected_binding_revision: 0,
                expert: Some(expert::ExpertSelection {
                    expert_id: "sample-expert".into(),
                    version: "0.1.0".into(),
                }),
            };
            let resolved = store::ResolvedExpert {
                reference: expert::ExpertRef {
                    expert_id: "sample-expert".into(),
                    version: "0.1.0".into(),
                    archive_sha256: "a".repeat(64),
                    role_sha256: "b".repeat(64),
                    knowledge_manifest_sha256: "c".repeat(64),
                },
                display: expert::ExpertDisplay {
                    expert_id: "sample-expert".into(),
                    version: "0.1.0".into(),
                    display_name: "合成专家".into(),
                    subtitle: "普通验证".into(),
                    icon_key: "skillOperations".into(),
                },
            };
            f.repo()
                .expert_submission_admitted(request, 1, ExecutionAdmission::test(), Some(resolved))
                .unwrap();
        }
        let (session, op): (String, String) = f
            .repo()
            .connection
            .query_row(
                "SELECT session_id,operation_id FROM chat_delivery_proofs",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        let session = Uuid::parse_str(&session).unwrap();
        let op = Uuid::parse_str(&op).unwrap();
        assert_eq!(proof(&f.repo().connection, op).unwrap().family, family);
        assert!(f
            .repo()
            .claim_next_conversation_outbox(now(), 30)
            .unwrap()
            .is_none());
        f.repo().claim_market_delivery(op).unwrap();
        f.repo().cancel_unsent_delivery(session, op, now()).unwrap();
        assert!(f.repo().claim_market_delivery(op).is_err());
        assert!(f.repo().begin_delivery_send(op, "create").is_err());
        assert_eq!(
            count(
                f.repo(),
                "SELECT count(*) FROM chat_market_dispatch WHERE state='blocked'"
            ),
            1
        );
    }
}

#[test]
fn feat164_delivery_legacy_without_proof_remains_unclassified_and_unmodified() {
    let mut f = Fixture::new();
    let project = f.project;
    let old = f
        .repo()
        .create_session_and_enqueue(project, "Synthetic legacy pending", Uuid::now_v7())
        .unwrap();
    let bytes: Vec<u8> = f
        .repo()
        .connection
        .query_row(
            "SELECT encrypted_payload FROM chat_outbox WHERE operation_id=?1",
            [old.create_operation_id.to_string()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        f.repo().delivery_states(old.session_id).unwrap()[0].status,
        "unclassified"
    );
    assert!(f
        .repo()
        .cancel_unsent_delivery(old.session_id, old.turn_operation_id, now())
        .is_err());
    assert!(f
        .repo()
        .claim_next_conversation_outbox(now(), 30)
        .unwrap()
        .is_none());
    assert_eq!(
        count(f.repo(), "SELECT count(*) FROM chat_delivery_proofs"),
        0
    );
    assert_eq!(count(f.repo(), "SELECT attempt_count FROM chat_outbox"), 0);
    assert_eq!(
        f.repo()
            .connection
            .query_row(
                "SELECT encrypted_payload FROM chat_outbox WHERE operation_id=?1",
                [old.create_operation_id.to_string()],
                |r| r.get::<_, Vec<u8>>(0)
            )
            .unwrap(),
        bytes
    );
}

#[test]
fn feat164_delivery_permission_turn_checks_nested_source_operation() {
    let mut f = Fixture::new();
    let (_, host, op) = f.existing();
    f.repo()
        .claim_next_conversation_outbox(now(), 30)
        .unwrap()
        .unwrap();
    let path = format!("/v1/agent-sessions/{host}/permission-turns");
    let flat = serde_json::json!({"operation_id":op}).to_string();
    assert!(f
        .repo()
        .begin_delivery_http(op, &path, Some("minimax-m3-high-v1"), flat.as_bytes())
        .is_err());
    let nested =
        serde_json::json!({"permission_mode":"ask","turn":{"operation_id":op}}).to_string();
    f.repo()
        .begin_delivery_http(op, &path, Some("minimax-m3-high-v1"), nested.as_bytes())
        .unwrap();
}
#[test]
fn feat164_delivery_pause_blocks_claim_but_preserves_explicit_unsent_cancel() {
    let mut f = Fixture::new();
    let project = f.project;
    assert!(f
        .repo()
        .create_model_session(
            Some(project),
            blocks(),
            Uuid::now_v7(),
            1,
            ModelIntent {
                profile_id: wire::ProfileId::KimiK3MaxV1,
                expected_revision: 0
            }
        )
        .is_err());
    let p = f
        .repo()
        .create_model_session(
            Some(project),
            blocks(),
            Uuid::now_v7(),
            1,
            ModelIntent {
                profile_id: wire::ProfileId::KimiK31ProMaxV1,
                expected_revision: 0,
            },
        )
        .unwrap();
    let available = crate::chat::models::dispatch_profile_available("kimi-k3-1-pro-max-v1");
    assert_eq!(
        f.repo()
            .claim_next_conversation_outbox(now(), 30)
            .unwrap()
            .is_some(),
        available
    );
    assert_eq!(
        count(f.repo(), "SELECT claim_count FROM chat_delivery_proofs"),
        i64::from(available)
    );
    assert_eq!(
        count(
            f.repo(),
            "SELECT public_attempts+create_attempts+turn_attempts FROM chat_delivery_proofs"
        ),
        0
    );
    f.repo()
        .cancel_unsent_delivery(p.session_id, p.turn_operation_id, now())
        .unwrap();
}
