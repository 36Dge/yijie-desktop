//! Explicit headless boundary, driven only by the Host's isolated Go test.
use super::{
    database::{ChatScope, DraftContentBlock},
    delivery::Admission,
    error::ChatError,
    host_bridge::{HostBridge, HostTrace},
    keychain::{DatabaseKey, DatabaseKeyStore, ReceiptKey, ReceiptKeyStore},
    lifecycle::Lifecycle,
    models::ModelIntent,
    models_generated as wire,
    sidecar::HostConnection,
    worker::DatabaseWorker,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;
struct Keys;
impl DatabaseKeyStore for Keys {
    fn load_or_create(&self, _: bool) -> Result<DatabaseKey, ChatError> {
        Ok(DatabaseKey::from_bytes([164; 32]))
    }
}
impl ReceiptKeyStore for Keys {
    fn load_or_create(&self, _: bool) -> Result<ReceiptKey, ChatError> {
        Ok(ReceiptKey::from_bytes([165; 32]))
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Setup {
    root: PathBuf,
    port: String,
    nonce: String,
    phase: String,
    owner: String,
    tenant: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Handoff {
    session: Uuid,
    host: Uuid,
    thread: Uuid,
    turn: Uuid,
    operation: Uuid,
    selection: Uuid,
    fingerprint: String,
}
fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}
fn intent(profile_id: wire::ProfileId, expected_revision: i64) -> ModelIntent {
    ModelIntent {
        profile_id,
        expected_revision,
    }
}
fn admitted(host: &HostBridge, db: &DatabaseWorker, operation: Uuid) -> HostBridge {
    let lifecycle = Lifecycle::default();
    host.with_model_profile(Some("minimax-m3-high-v1".into()))
        .unwrap()
        .with_delivery_admission(Admission {
            database: db.clone(),
            epoch: lifecycle.epoch(),
            lifecycle,
            operation,
        })
}

#[tokio::test]
#[ignore = "requires explicit isolated real Host/Runtime driver, never an App connection"]
async fn feat164_native_host_boundary() {
    let file = PathBuf::from(
        std::env::var("YIJIE_FEAT164_BOUNDARY_SETUP").expect("Host boundary setup required"),
    );
    let setup: Setup = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    assert!(
        setup.root.is_absolute()
            && setup
                .root
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("feat164-native-boundary-")
    );
    assert_eq!(file, setup.root.join("boundary.json"));
    assert!(matches!(setup.phase.as_str(), "prepare" | "reopen"));
    let db = DatabaseWorker::start(
        setup.root.join("native"),
        ChatScope::new(setup.owner, setup.tenant).unwrap(),
        Box::new(Keys),
        Box::new(Keys),
    )
    .unwrap();
    let host = HostBridge::from_connection(HostConnection {
        port: setup.port.parse().unwrap(),
        token_path: setup.root.join("host/api-token"),
        instance_nonce: setup.nonce.clone(),
    })
    .unwrap();
    let handoff = setup.root.join("native-handoff.json");
    if setup.phase == "prepare" {
        assert!(!handoff.exists());
        let project = db
            .register_project(
                setup.root.join("workspace"),
                b"ordinary-boundary-bookmark".to_vec(),
            )
            .await
            .unwrap();
        let project = Uuid::parse_str(&project.id).unwrap();
        let pending = db
            .call(move |r| {
                r.create_model_session(
                    Some(project),
                    vec![DraftContentBlock::Text(
                        "Return one short local response without tools.".into(),
                    )],
                    Uuid::now_v7(),
                    1,
                    intent(wire::ProfileId::MinimaxM3HighV1, 0),
                )
            })
            .await
            .unwrap();
        let session = pending.session_id;
        let turn = pending.turn_id;
        let operation = pending.turn_operation_id;
        let create = pending.create_operation_id;
        assert_eq!(
            db.claim_next_conversation_outbox(now(), 30)
                .await
                .unwrap()
                .unwrap()
                .operation_id,
            create
        );
        let task = Uuid::now_v7();
        db.call(move |r| r.begin_delivery_send(create, "public"))
            .await
            .unwrap();
        db.bind_public_task(create, task, now()).await.unwrap();
        let created = admitted(&host, &db, create)
            .start_session(
                task,
                &setup.root.join("workspace"),
                &HostTrace {
                    request_id: Some(create),
                    ..HostTrace::default()
                },
            )
            .await
            .unwrap();
        let agent = created.agent_session_id;
        let thread = created.codex_thread_id.unwrap();
        db.bind_host_session_and_enqueue_turn(create, task, agent, thread)
            .await
            .unwrap();
        assert_eq!(
            db.claim_next_conversation_outbox(now(), 30)
                .await
                .unwrap()
                .unwrap()
                .operation_id,
            operation
        );
        let dispatch = db.load_start_turn_dispatch_v2(operation).await.unwrap();
        let native_turn = admitted(&host, &db, operation)
            .start_permission_turn(
                agent,
                operation,
                &dispatch.content_blocks,
                &HostTrace::default(),
                super::runtime_permissions::PermissionMode::Ask,
            )
            .await
            .unwrap();
        db.accept_native_turn(operation, native_turn, setup.nonce.clone())
            .await
            .unwrap();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let snapshot = host.read_native_thread(agent).await.unwrap();
            if snapshot.turns.iter().any(|t| {
                t.id == native_turn.to_string() && t.status.as_deref() == Some("completed")
            }) {
                let views = db
                    .call(move |r| r.native_recovery_views(session, &[turn], Some(&snapshot), true))
                    .await
                    .unwrap();
                assert_eq!(views[0].status.as_deref(), Some("completed"));
                assert!(!views[0].terminal_observed); // actual read provenance, no forged notification
                break;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "normal loopback turn did not settle"
            );
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        let selected = host.model_selection(agent).await.unwrap();
        assert_eq!(selected.revision, 1);
        db.call(move |r| r.sync_model_selection(session, selected))
            .await
            .unwrap();
        let selection = Uuid::now_v7();
        let proof = db
            .call(move |r| {
                r.begin_model_recovery_intent(
                    session,
                    intent(wire::ProfileId::KimiK31ProMaxV1, 1),
                    selection,
                )
            })
            .await
            .unwrap();
        assert!(host
            .model_operation(agent, &proof.request)
            .await
            .unwrap()
            .is_none());
        let request = proof.request.clone();
        db.call(move |r| r.mark_model_recovery_dispatched(proof))
            .await
            .unwrap();
        let result = host.select_model(agent, request).await.unwrap();
        assert_eq!(result.revision, 2);
        // Stop this normal protocol phase before the Native receipt transaction.
        let fingerprint = db
            .call(move |r| {
                r.connection
                    .query_row(
                        "SELECT fingerprint FROM chat_delivery_proofs WHERE operation_id=?1",
                        [operation.to_string()],
                        |r| r.get::<_, String>(0),
                    )
                    .map_err(|_| ChatError::DatabaseUnavailable)
            })
            .await
            .unwrap();
        let out = Handoff {
            session,
            host: agent,
            thread,
            turn,
            operation,
            selection,
            fingerprint,
        };
        std::fs::write(&handoff, serde_json::to_vec(&out).unwrap()).unwrap();
        assert_eq!(
            db.call(move |r| Ok(r.model_recovery(session, selection)?.unwrap().phase))
                .await
                .unwrap(),
            "dispatched"
        );
    } else {
        let saved: Handoff = serde_json::from_slice(&std::fs::read(&handoff).unwrap()).unwrap();
        let session = saved.session;
        let selection = saved.selection;
        let operation = saved.operation;
        let proof = db
            .call(move |r| r.model_recovery(session, selection))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(proof.phase, "dispatched");
        assert_eq!(proof.thread, saved.thread.to_string());
        let original = host
            .model_operation(saved.host, &proof.request)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(original.state, wire::ModelOperationState::Committed);
        assert_eq!(original.result.as_ref().unwrap().revision, 2);
        db.call(move |r| r.observe_model_recovery(session, selection, original))
            .await
            .unwrap();
        let current = host.model_selection(saved.host).await.unwrap();
        assert_eq!(current.revision, 2);
        db.call(move |r| r.sync_model_selection(session, current))
            .await
            .unwrap();
        let next = Uuid::now_v7();
        let change = db
            .call(move |r| {
                r.begin_model_recovery_intent(
                    session,
                    intent(wire::ProfileId::MinimaxM3HighV1, 2),
                    next,
                )
            })
            .await
            .unwrap();
        let request = change.request.clone();
        db.call(move |r| r.mark_model_recovery_dispatched(change))
            .await
            .unwrap();
        assert_eq!(
            host.select_model(saved.host, request.clone())
                .await
                .unwrap()
                .revision,
            3
        );
        let receipt = host
            .model_operation(saved.host, &request)
            .await
            .unwrap()
            .unwrap();
        db.call(move |r| r.observe_model_recovery(session, next, receipt))
            .await
            .unwrap();
        // The earlier result remains revision 2; it is never installed as current.
        let replay = host
            .recover_model_operation(saved.host, &proof.request)
            .await
            .unwrap();
        assert_eq!(replay.result.as_ref().unwrap().revision, 2);
        db.call(move |r| r.observe_model_recovery(session, selection, replay))
            .await
            .unwrap();
        let current = host.model_selection(saved.host).await.unwrap();
        assert_eq!(current.revision, 3);
        let native = db
            .call(move |r| r.sync_model_selection(session, current))
            .await
            .unwrap();
        assert_eq!(native.revision, 3);
        assert_eq!(native.profile_id.as_deref(), Some("minimax-m3-high-v1"));
        let current_host = host.get_session(saved.host).await.unwrap();
        assert_eq!(current_host.codex_thread_id, Some(saved.thread));
        let cancel = Uuid::now_v7();
        db.call(move |r| {
            r.enqueue_model_turn(
                session,
                vec![DraftContentBlock::Text(
                    "This queued local submission will be cancelled.".into(),
                )],
                cancel,
                intent(wire::ProfileId::MinimaxM3HighV1, 3),
            )
        })
        .await
        .unwrap();
        assert_eq!(
            db.claim_next_conversation_outbox(now(), 30)
                .await
                .unwrap()
                .unwrap()
                .operation_id,
            cancel
        );
        let dispatch = db.load_start_turn_dispatch_v2(cancel).await.unwrap();
        let receipt = db
            .call(move |r| r.cancel_unsent_delivery(session, cancel, now()))
            .await
            .unwrap();
        let stopped = admitted(&host, &db, cancel)
            .start_permission_turn(
                saved.host,
                cancel,
                &dispatch.content_blocks,
                &HostTrace::default(),
                super::runtime_permissions::PermissionMode::Ask,
            )
            .await;
        assert!(stopped.is_err());
        assert_eq!(
            db.call(move |r| r.cancel_unsent_delivery(session, cancel, now() + 1))
                .await
                .unwrap(),
            receipt
        );
        let fingerprint = db
            .call(move |r| {
                r.connection
                    .query_row(
                        "SELECT fingerprint FROM chat_delivery_proofs WHERE operation_id=?1",
                        [operation.to_string()],
                        |r| r.get::<_, String>(0),
                    )
                    .map_err(|_| ChatError::DatabaseUnavailable)
            })
            .await
            .unwrap();
        assert_eq!(fingerprint, saved.fingerprint);
    }
    drop(host);
    drop(db); // normal SQLCipher worker shutdown; no process faults
    println!("FEAT164_NATIVE_PHASE_PASS {}", setup.phase);
}
