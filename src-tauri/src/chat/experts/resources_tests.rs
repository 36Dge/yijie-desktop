//! Normal in-memory journal sequences only. No process, filesystem, permissions,
//! binary replacement, network or adversarial resources are used.
use super::{generated as wire, resources};
use crate::chat::connectors::selection_generated;
use crate::chat::{database::ChatScope, migrations};
use rusqlite::{params, Connection};

fn id(index: u64) -> String {
    format!("00000000-0000-4000-8000-{index:012x}")
}
fn scope(index: u64) -> ChatScope {
    ChatScope::new(id(index), id(index + 1)).unwrap()
}
fn selection() -> wire::ExpertSelection {
    wire::ExpertSelection {
        expert_id: "sample-expert".into(),
        version: "0.1.0".into(),
    }
}
fn private(owner: &ChatScope, op: u64, remove: bool) -> resources::PrivateRequest {
    let payload = wire::PrivateResourcePayload {
        host_instance_id: id(90),
        scope: wire::ScopeBinding {
            owner_user_id: owner.owner_user_id.clone(),
            tenant_id: owner.tenant_id.clone(),
            native_process_epoch: id(91),
            authorization_revision: 1,
            authorization_expires_at_unix_ms: 200_000,
        },
        operation_id: id(op),
        expert: selection(),
    };
    if remove {
        resources::PrivateRequest::Remove(wire::PrivateResourceRemoveRequest {
            schema_version: 1,
            request_id: id(op + 100),
            method: "expert_resources_remove".into(),
            payload,
        })
    } else {
        resources::PrivateRequest::Prepare(wire::PrivateResourcePrepareRequest {
            schema_version: 1,
            request_id: id(op + 100),
            method: "expert_resources_prepare".into(),
            payload,
        })
    }
}
fn db() -> Connection {
    let mut db = Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    migrations::migrate_to_target(&mut db, 35).unwrap();
    db
}
fn begin(db: &mut Connection, scope: &ChatScope, op: u64, remove: bool) -> resources::Journal {
    let tx = db.transaction().unwrap();
    let (record, fresh) = resources::begin(
        &tx,
        scope,
        private(scope, op, remove),
        &"a".repeat(64),
        &"b".repeat(64),
        10,
    )
    .unwrap();
    assert!(fresh);
    tx.commit().unwrap();
    record
}
fn session(db: &Connection, owner: &ChatScope, session: &str) {
    let project = id(39);
    db.execute("INSERT INTO chat_projects(id,owner_user_id,tenant_id,safe_name,canonical_hash,bookmark_ref,last_used_at) VALUES(?1,?2,?3,'Ordinary project',?4,X'01',1)",params![project,owner.owner_user_id,owner.tenant_id,"d".repeat(64)]).unwrap();
    db.execute("INSERT INTO chat_sessions(id,owner_user_id,tenant_id,project_id,title,title_source,title_job_status,created_at,last_activity_at) VALUES(?1,?2,?3,?4,'Ordinary history','fallback','not_started',1,1)",params![session,owner.owner_user_id,owner.tenant_id,project]).unwrap();
}
fn catalog() -> wire::CatalogSnapshot {
    wire::CatalogSnapshot {
        can_manage: true,
        execution_available: true,
        experts: vec![wire::CatalogEntry {
            display: wire::ExpertDisplay {
                expert_id: "sample-expert".into(),
                version: "0.1.0".into(),
                display_name: "普通合成专家".into(),
                subtitle: "本地参考".into(),
                icon_key: "skillOperations".into(),
            },
            description: "普通资源".into(),
            platform: "sample".into(),
            tags: vec!["参考".into()],
            quick_prompts: vec![],
            knowledge_summary: "普通参考资料".into(),
            state: wire::ResourceState::Ready,
            error_code: None,
            operation: None,
        }],
    }
}

#[test]
fn expert_resources_intent_commits_atomically_and_preserves_original_private_request() {
    let mut db = db();
    let owner = scope(1);
    {
        let tx = db.transaction().unwrap();
        resources::begin(
            &tx,
            &owner,
            private(&owner, 10, false),
            &"a".repeat(64),
            &"b".repeat(64),
            10,
        )
        .unwrap();
        tx.rollback().unwrap();
    }
    assert!(resources::read(&db, &owner, &id(10)).unwrap().is_none());
    let original = begin(&mut db, &owner, 10, false);
    let mut renewed = private(&owner, 10, false);
    if let resources::PrivateRequest::Prepare(request) = &mut renewed {
        request.request_id = id(300);
        request.payload.host_instance_id = id(301);
        request.payload.scope.native_process_epoch = id(302);
        request.payload.scope.authorization_expires_at_unix_ms = 300_000;
    }
    let tx = db.transaction().unwrap();
    let (replay, fresh) =
        resources::begin(&tx, &owner, renewed, &"a".repeat(64), &"b".repeat(64), 20).unwrap();
    assert!(!fresh);
    tx.commit().unwrap();
    match (&replay.request, &original.request) {
        (resources::PrivateRequest::Prepare(a), resources::PrivateRequest::Prepare(b)) => {
            assert_eq!(a, b)
        }
        _ => panic!("original request family changed"),
    }
    assert_eq!(replay.receipt, original.receipt);
}

#[test]
fn expert_resources_scoped_reads_and_cross_scope_pending_exclusion() {
    let mut db = db();
    let owner = scope(1);
    let another = scope(3);
    begin(&mut db, &owner, 10, false);
    assert!(resources::read(&db, &another, &id(10)).unwrap().is_none());
    let tx = db.transaction().unwrap();
    assert!(matches!(
        resources::begin(
            &tx,
            &another,
            private(&another, 11, false),
            &"c".repeat(64),
            &"b".repeat(64),
            20
        ),
        Err(wire::ErrorCode::OperationPending)
    ));
    assert!(matches!(
        resources::begin(
            &tx,
            &another,
            private(&another, 10, false),
            &"c".repeat(64),
            &"b".repeat(64),
            20
        ),
        Err(wire::ErrorCode::RequestConflict)
    ));
    tx.rollback().unwrap();
    let mut other_view = catalog();
    resources::project(&db, &another, &mut other_view).unwrap();
    assert_eq!(other_view.experts[0].state, wire::ResourceState::Preparing);
    assert!(other_view.experts[0].operation.is_none());
}

#[test]
fn expert_resources_same_operation_different_intent_conflicts() {
    let mut db = db();
    let owner = scope(1);
    begin(&mut db, &owner, 10, false);
    let tx = db.transaction().unwrap();
    assert!(matches!(
        resources::begin(
            &tx,
            &owner,
            private(&owner, 10, true),
            &"c".repeat(64),
            &"b".repeat(64),
            20
        ),
        Err(wire::ErrorCode::RequestConflict)
    ));
    assert!(matches!(
        resources::begin(
            &tx,
            &owner,
            private(&owner, 10, false),
            &"c".repeat(64),
            &"b".repeat(64),
            20
        ),
        Err(wire::ErrorCode::RequestConflict)
    ));
}

#[test]
fn expert_resources_unknown_survives_empty_status_and_only_positive_receipt_settles() {
    let mut db = db();
    let owner = scope(1);
    let original = begin(&mut db, &owner, 10, false);
    let unknown = wire::ResourceOperation {
        state: wire::OperationState::Unknown,
        error_code: Some(wire::ErrorCode::OutcomeUnknown),
        ..original.receipt.clone()
    };
    {
        let tx = db.transaction().unwrap();
        resources::finish(&tx, &owner, &original, &unknown, 11).unwrap();
        tx.commit().unwrap();
    }
    let status = wire::PrivateStatus {
        catalog_revision: "b".repeat(64),
        execution_available: true,
        resource_operations: vec![],
    };
    {
        let tx = db.transaction().unwrap();
        resources::merge_status(&tx, &owner, &status, 12).unwrap();
        tx.commit().unwrap();
    }
    let restored = resources::read(&db, &owner, &id(10)).unwrap().unwrap();
    assert_eq!(restored.receipt, unknown);
    let mut view = catalog();
    resources::project(&db, &owner, &mut view).unwrap();
    assert_eq!(view.experts[0].state, wire::ResourceState::Preparing);
    assert_eq!(view.experts[0].operation, Some(unknown));
    {
        let tx = db.transaction().unwrap();
        assert!(matches!(
            resources::begin(
                &tx,
                &owner,
                private(&owner, 11, false),
                &"c".repeat(64),
                &"b".repeat(64),
                12
            ),
            Err(wire::ErrorCode::OperationPending)
        ));
    }
    let positive = wire::ResourceOperation {
        state: wire::OperationState::Succeeded,
        error_code: None,
        ..original.receipt.clone()
    };
    {
        let tx = db.transaction().unwrap();
        resources::merge_status(
            &tx,
            &owner,
            &wire::PrivateStatus {
                resource_operations: vec![positive.clone()],
                ..status
            },
            13,
        )
        .unwrap();
        tx.commit().unwrap();
    }
    assert_eq!(
        resources::read(&db, &owner, &id(10))
            .unwrap()
            .unwrap()
            .receipt,
        positive
    );
}

#[test]
fn expert_resources_terminal_receipt_is_immutable_and_settlement_is_atomic() {
    let mut db = db();
    let owner = scope(1);
    let original = begin(&mut db, &owner, 10, false);
    let done = wire::ResourceOperation {
        state: wire::OperationState::Succeeded,
        ..original.receipt.clone()
    };
    {
        let tx = db.transaction().unwrap();
        resources::finish(&tx, &owner, &original, &done, 11).unwrap();
        tx.rollback().unwrap();
    }
    assert_eq!(
        resources::read(&db, &owner, &id(10))
            .unwrap()
            .unwrap()
            .receipt
            .state,
        wire::OperationState::Pending
    );
    {
        let tx = db.transaction().unwrap();
        resources::finish(&tx, &owner, &original, &done, 11).unwrap();
        tx.commit().unwrap();
    }
    let tx = db.transaction().unwrap();
    assert_eq!(
        resources::finish(&tx, &owner, &original, &done, 12).unwrap(),
        done
    );
    assert!(matches!(
        resources::finish(&tx, &owner, &original, &original.receipt, 12),
        Err(wire::ErrorCode::RequestConflict)
    ));
}

#[test]
fn expert_resources_remove_checks_existing_binding_references_before_recording() {
    let mut db = db();
    let owner = scope(1);
    let session = id(40);
    self::session(&db, &owner, &session);
    let reference = wire::ExpertRef {
        expert_id: "sample-expert".into(),
        version: "0.1.0".into(),
        archive_sha256: "a".repeat(64),
        role_sha256: "b".repeat(64),
        knowledge_manifest_sha256: "c".repeat(64),
    };
    db.execute("INSERT INTO chat_expert_bindings(session_id,binding_revision,expert_ref_json,display_json,state,updated_at) VALUES(?1,1,?2,?3,'ready',1)",params![session,serde_json::to_string(&reference).unwrap(),serde_json::to_string(&catalog().experts[0].display).unwrap()]).unwrap();
    let tx = db.transaction().unwrap();
    assert!(matches!(
        resources::begin(
            &tx,
            &owner,
            private(&owner, 10, true),
            &"a".repeat(64),
            &"b".repeat(64),
            10
        ),
        Err(wire::ErrorCode::ResourceInUse)
    ));
    tx.rollback().unwrap();
    assert!(resources::read(&db, &owner, &id(10)).unwrap().is_none());
}

#[test]
fn expert_resources_migration_keeps_ordinary_history_and_upgrades_only_expert_receipt() {
    let mut db = Connection::open_in_memory().unwrap();
    migrations::migrate_to_target(&mut db, 34).unwrap();
    let owner = scope(1);
    let session = id(40);
    self::session(&db, &owner, &session);
    let old = serde_json::json!({"binding":{"sessionId":session,"bindingRevision":0,"expert":null,"state":"none"},"operation":{"operationId":id(10),"sessionId":session,"state":"rejected","expectedBindingRevision":0,"bindingRevision":0,"requestedExpert":null}});
    db.execute("INSERT INTO chat_expert_binding_operations(operation_id,session_id,intent_digest,expected_binding_revision,receipt_json,state,created_at,updated_at) VALUES(?1,?2,?3,0,?4,'rejected',1,1)",params![id(10),session,"a".repeat(64),old.to_string()]).unwrap();
    migrations::migrate_to_target(&mut db, 35).unwrap();
    migrations::migrate_to_target(&mut db, 35).unwrap();
    assert!(db.query_row("SELECT json_extract(receipt_json,'$.binding.managed') FROM chat_expert_binding_operations",[],|r|r.get::<_,bool>(0)).unwrap());
    assert_eq!(
        db.query_row("SELECT title FROM chat_sessions", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "Ordinary history"
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM chat_expert_resource_operations",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn expert_resources_completed_history_blocks_new_version_prepare_before_journal() {
    let mut db = db();
    let owner = scope(1);
    let session_id = id(40);
    session(&db, &owner, &session_id);
    let turn = id(41);
    let submission = id(42);
    let operation = id(43);
    db.execute("INSERT INTO chat_turns(id,session_id,operation_id,status,terminal_at) VALUES(?1,?2,?3,'completed',2)",params![turn,session_id,operation]).unwrap();
    let market = selection_generated::freeze_selection(operation.clone(), vec![]).unwrap();
    let receipt = wire::NativeReceipt {
        outcome: "local_durable_accepted".into(),
        session_id: session_id.clone(),
        local_turn_id: turn.clone(),
        submission_operation_id: submission.clone(),
        turn_operation_id: operation.clone(),
        selection_digest: market.selection_digest.clone(),
    };
    let old = wire::ExpertRef {
        expert_id: "sample-expert".into(),
        version: "0.1.0".into(),
        archive_sha256: "a".repeat(64),
        role_sha256: "b".repeat(64),
        knowledge_manifest_sha256: "c".repeat(64),
    };
    let snapshot = wire::freeze_snapshot(operation.clone(), 1, Some(old.clone())).unwrap();
    db.execute("INSERT INTO chat_market_submissions(submission_operation_id,session_id,local_turn_id,turn_operation_id,format_version,request_digest,snapshot_json,display_json,receipt_json,created_at) VALUES(?1,?2,?3,?4,1,?5,?6,'[]',?7,1)",params![submission,session_id,turn,operation,"a".repeat(64),serde_json::to_string(&market).unwrap(),serde_json::to_string(&receipt).unwrap()]).unwrap();
    db.execute("INSERT INTO chat_expert_submissions(submission_operation_id,session_id,snapshot_json,display_json) VALUES(?1,?2,?3,?4)",params![submission,session_id,serde_json::to_string(&snapshot).unwrap(),serde_json::to_string(&catalog().experts[0].display).unwrap()]).unwrap();
    let mut next = private(&owner, 10, false);
    if let resources::PrivateRequest::Prepare(request) = &mut next {
        request.payload.expert.version = "0.2.0".into();
    }
    let tx = db.transaction().unwrap();
    assert!(matches!(
        resources::begin(
            &tx,
            &owner,
            next.clone(),
            &"a".repeat(64),
            &"b".repeat(64),
            10
        ),
        Err(wire::ErrorCode::ResourceInUse)
    ));
    tx.commit().unwrap();
    assert!(resources::read(&db, &owner, &id(10)).unwrap().is_none());
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM chat_expert_resource_operations",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    // Trusted exact older identity in a distinct installation slot permits
    // additive preparation, while the retained snapshot stays byte-for-byte.
    let before: String = db
        .query_row(
            "SELECT snapshot_json FROM chat_expert_submissions",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let tx = db.transaction().unwrap();
    let allowed = resources::begin_with_coexisting(
        &tx,
        &owner,
        next,
        &"a".repeat(64),
        &"b".repeat(64),
        10,
        &[old],
    )
    .unwrap();
    assert!(allowed.1);
    tx.rollback().unwrap();
    let after: String = db
        .query_row(
            "SELECT snapshot_json FROM chat_expert_submissions",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(before, after);
    // Same exact version may still prepare as the existing core's normal no-op.
    let retained = begin(&mut db, &owner, 11, false);
    assert_eq!(retained.receipt.expert.version, "0.1.0");
}

#[test]
fn expert_resources_explicit_recovery_keeps_original_intent_with_renewed_authority() {
    let mut db = db();
    let owner = scope(1);
    let original = begin(&mut db, &owner, 10, false);
    let current = wire::ScopeBinding {
        owner_user_id: owner.owner_user_id.clone(),
        tenant_id: owner.tenant_id.clone(),
        native_process_epoch: id(501),
        authorization_revision: 2,
        authorization_expires_at_unix_ms: 400_000,
    };
    let request = resources::recovery_request(id(500), current.clone(), &original).unwrap();
    request.validate().unwrap();
    assert_eq!(request.method, "expert_resources_recover");
    assert_eq!(request.payload.host_instance_id, id(500));
    assert_eq!(request.payload.scope, current);
    assert_eq!(request.payload.action, "prepare");
    let resources::PrivateRequest::Prepare(saved) = &original.request else {
        panic!("wrong family")
    };
    assert_eq!(request.payload.original, saved.payload);
    assert_eq!(request.payload.original.host_instance_id, id(90));
    assert_eq!(
        request.payload.original.operation_id,
        original.receipt.operation_id
    );
    // Request construction and ordinary receipt reads do not settle or mutate.
    assert_eq!(
        resources::read(&db, &owner, &id(10))
            .unwrap()
            .unwrap()
            .receipt,
        original.receipt
    );
    let different_scope = wire::ScopeBinding {
        tenant_id: id(600),
        ..current
    };
    assert_eq!(
        resources::recovery_request(id(500), different_scope, &original).unwrap_err(),
        wire::ErrorCode::ContextInvalid
    );
}

#[test]
fn expert_resources_confirmed_unstarted_rejection_closes_only_original_journal() {
    let mut db = db();
    let owner = scope(1);
    let original = begin(&mut db, &owner, 10, false);
    let receipt = wire::ResourceOperation {
        state: wire::OperationState::Rejected,
        error_code: Some(wire::ErrorCode::ResourceUnavailable),
        ..original.receipt.clone()
    };
    let tx = db.transaction().unwrap();
    let settled = resources::finish(&tx, &owner, &original, &receipt, 20).unwrap();
    tx.commit().unwrap();
    assert_eq!(settled.operation_id, id(10));
    let saved = resources::read(&db, &owner, &id(10)).unwrap().unwrap();
    let request = resources::recovery_request(
        id(500),
        match &original.request {
            resources::PrivateRequest::Prepare(value) => value.payload.scope.clone(),
            _ => panic!("wrong family"),
        },
        &saved,
    )
    .unwrap();
    let resources::PrivateRequest::Prepare(original_request) = original.request else {
        panic!("wrong family")
    };
    assert_eq!(request.payload.original, original_request.payload);
    // Once positively closed, a separate deliberate operation is possible;
    // the original receipt stays terminal and can never claim later success.
    let newer = begin(&mut db, &owner, 11, false);
    assert_eq!(newer.receipt.state, wire::OperationState::Pending);
    assert_eq!(
        resources::read(&db, &owner, &id(10))
            .unwrap()
            .unwrap()
            .receipt,
        receipt
    );
    let tx = db.transaction().unwrap();
    assert_eq!(
        resources::finish(
            &tx,
            &owner,
            &saved,
            &wire::ResourceOperation {
                state: wire::OperationState::Succeeded,
                error_code: None,
                ..receipt
            },
            30
        )
        .unwrap_err(),
        wire::ErrorCode::RequestConflict
    );
}
