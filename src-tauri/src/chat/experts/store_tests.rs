//! Ordinary in-memory storage tests. No processes, files, network, permission
//! faults, malformed archives, or attack payloads are used here.
use super::{generated as wire, store};
use crate::chat::{connectors::selection_generated, database::ChatScope, migrations};
use rusqlite::{params, Connection, OptionalExtension};

fn id(number: u64) -> String {
    format!("00000000-0000-4000-8000-{number:012x}")
}

fn expert(version: &str, digest: char) -> store::ResolvedExpert {
    store::ResolvedExpert {
        reference: wire::ExpertRef {
            expert_id: "jd-ops-expert".into(),
            version: version.into(),
            archive_sha256: digest.to_string().repeat(64),
            role_sha256: digest.to_string().repeat(64),
            knowledge_manifest_sha256: digest.to_string().repeat(64),
        },
        display: wire::ExpertDisplay {
            expert_id: "jd-ops-expert".into(),
            version: version.into(),
            display_name: "合成京东专家".into(),
            subtitle: "京东专向".into(),
            icon_key: "skillOperations".into(),
        },
    }
}

struct Fixture {
    db: Connection,
    scope: ChatScope,
    session: String,
}

impl Fixture {
    fn new() -> Self {
        let mut db = Connection::open_in_memory().expect("ordinary in-memory database");
        db.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrations::migrate_to_target(&mut db, 34).expect("canonical expert migration");
        let scope = ChatScope::new(id(1), id(2)).unwrap();
        let project = id(3);
        let session = id(4);
        db.execute(
            "INSERT INTO chat_projects(id,owner_user_id,tenant_id,safe_name,canonical_hash,bookmark_ref,last_used_at) VALUES(?1,?2,?3,'Synthetic project',?4,?5,1)",
            params![project, scope.owner_user_id, scope.tenant_id, "a".repeat(64), b"ordinary-bookmark".as_slice()],
        ).unwrap();
        db.execute(
            "INSERT INTO chat_sessions(id,owner_user_id,tenant_id,project_id,title,title_source,title_job_status,created_at,last_activity_at) VALUES(?1,?2,?3,?4,'Synthetic conversation','fallback','not_started',1,1)",
            params![session, scope.owner_user_id, scope.tenant_id, project],
        ).unwrap();
        Self { db, scope, session }
    }

    fn request(
        &self,
        operation: u64,
        revision: i64,
        selected: Option<&store::ResolvedExpert>,
    ) -> wire::BindingSetPayload {
        wire::BindingSetPayload {
            operation_id: id(operation),
            session_id: self.session.clone(),
            expected_binding_revision: revision,
            expert: selected.map(|value| wire::ExpertSelection {
                expert_id: value.reference.expert_id.clone(),
                version: value.reference.version.clone(),
            }),
        }
    }

    fn payload(
        &self,
        request: &wire::BindingSetPayload,
        selected: Option<&store::ResolvedExpert>,
    ) -> wire::ApplyPayload {
        wire::ApplyPayload {
            operation_id: request.operation_id.clone(),
            host_instance_id: id(5),
            scope: wire::ScopeBinding {
                owner_user_id: self.scope.owner_user_id.clone(),
                tenant_id: self.scope.tenant_id.clone(),
                native_process_epoch: id(6),
                authorization_revision: 1,
                authorization_expires_at_unix_ms: 100_000,
            },
            local_session_id: request.session_id.clone(),
            agent_session_id: id(7),
            native_thread_id: "synthetic-owned-thread".into(),
            expected_binding_revision: request.expected_binding_revision,
            binding_revision: request.expected_binding_revision + 1,
            expert: selected.map(|value| value.reference.clone()),
            intent: serde_json::from_value(serde_json::json!({
                "profileId": "minimax-m3-high-v1", "expectedRevision": 0
            }))
            .unwrap(),
            permission_mode: wire::PermissionMode::Ask,
            market_snapshot: selection_generated::freeze_selection(
                request.operation_id.clone(),
                vec![],
            )
            .unwrap(),
        }
    }

    fn begin_apply(
        &mut self,
        request: &wire::BindingSetPayload,
        selected: Option<&store::ResolvedExpert>,
        digest: char,
        timestamp: i64,
    ) -> (wire::BindingResult, wire::ApplyPayload) {
        let payload = self.payload(request, selected);
        let tx = self.db.transaction().unwrap();
        let result = store::begin(
            &tx,
            &self.scope,
            request,
            selected,
            &digest.to_string().repeat(64),
            timestamp,
        )
        .unwrap();
        assert!(store::record_apply(&tx, &self.scope, &payload, timestamp + 1).unwrap());
        tx.commit().unwrap();
        (result, payload)
    }

    fn finish(
        &mut self,
        payload: &wire::ApplyPayload,
        state: wire::OperationState,
        timestamp: i64,
    ) -> wire::BindingResult {
        let tx = self.db.transaction().unwrap();
        let result = store::finish(&tx, &self.scope, &receipt(payload, state), timestamp).unwrap();
        tx.commit().unwrap();
        result
    }

    fn activate(&mut self, value: &store::ResolvedExpert) -> wire::BindingResult {
        let request = self.request(20, 0, Some(value));
        let (_, payload) = self.begin_apply(&request, Some(value), 'a', 10);
        self.finish(&payload, wire::OperationState::Succeeded, 12)
    }

    fn confirmed_reference(&self) -> Option<wire::ExpertRef> {
        let value: Option<Option<String>> = self
            .db
            .query_row(
                "SELECT expert_ref_json FROM chat_expert_bindings WHERE session_id=?1",
                [&self.session],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        value
            .flatten()
            .map(|json| serde_json::from_str(&json).unwrap())
    }

    fn counts(&self) -> (i64, i64) {
        self.db.query_row(
            "SELECT (SELECT count(*) FROM chat_expert_bindings),(SELECT count(*) FROM chat_expert_binding_operations)",
            [], |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap()
    }
}

fn receipt(payload: &wire::ApplyPayload, state: wire::OperationState) -> wire::ApplyReceipt {
    wire::ApplyReceipt {
        operation_id: payload.operation_id.clone(),
        host_instance_id: payload.host_instance_id.clone(),
        local_session_id: payload.local_session_id.clone(),
        agent_session_id: payload.agent_session_id.clone(),
        native_thread_id: payload.native_thread_id.clone(),
        expected_binding_revision: payload.expected_binding_revision,
        binding_revision: payload.expected_binding_revision
            + i64::from(state == wire::OperationState::Succeeded),
        expert: payload.expert.clone(),
        state,
        error_code: match state {
            wire::OperationState::Rejected => Some(wire::ErrorCode::ResourceUnavailable),
            wire::OperationState::Unknown => Some(wire::ErrorCode::OutcomeUnknown),
            _ => None,
        },
    }
}

#[test]
fn expert_store_local_rejection_keeps_managed_none_and_original_terminal_receipt() {
    let mut fixture = Fixture::new();
    assert!(
        !store::read(&fixture.db, &fixture.scope, &fixture.session)
            .unwrap()
            .managed
    );
    let selected = expert("0.1.0", 'a');
    let request = fixture.request(30, 0, Some(&selected));
    fixture.begin_apply(&request, Some(&selected), 'a', 10);
    let tx = fixture.db.transaction().unwrap();
    let rejected = store::fail_attempt(
        &tx,
        &fixture.scope,
        &fixture.session,
        &request.operation_id,
        store::AttemptFailure::Rejected(wire::ErrorCode::Busy),
        12,
    )
    .unwrap();
    tx.commit().unwrap();
    assert_eq!(rejected.operation.state, wire::OperationState::Rejected);
    assert!(rejected.binding.managed);
    assert_eq!(rejected.binding.binding_revision, 0);
    assert_eq!(rejected.binding.state, wire::BindingState::None);
    assert!(rejected.binding.expert.is_none());
    store::require_settled(&fixture.db, &fixture.session).unwrap();
    let tx = fixture.db.transaction().unwrap();
    assert_eq!(
        store::fail_attempt(
            &tx,
            &fixture.scope,
            &fixture.session,
            &request.operation_id,
            store::AttemptFailure::Unknown,
            13,
        )
        .unwrap(),
        rejected
    );
    tx.commit().unwrap();
}

#[test]
fn expert_store_local_unknown_keeps_prior_reference_and_resolves_only_original_receipt() {
    let mut fixture = Fixture::new();
    let selected = expert("0.1.0", 'a');
    fixture.activate(&selected);
    let request = fixture.request(30, 1, None);
    let (_, payload) = fixture.begin_apply(&request, None, 'b', 20);
    let tx = fixture.db.transaction().unwrap();
    let uncertain = store::fail_attempt(
        &tx,
        &fixture.scope,
        &fixture.session,
        &request.operation_id,
        store::AttemptFailure::Unknown,
        22,
    )
    .unwrap();
    tx.commit().unwrap();
    assert_eq!(uncertain.binding.state, wire::BindingState::Unknown);
    assert_eq!(uncertain.binding.binding_revision, 1);
    assert_eq!(fixture.confirmed_reference(), Some(selected.reference));
    assert_eq!(
        store::require_settled(&fixture.db, &fixture.session),
        Err(wire::ErrorCode::OperationPending)
    );
    assert_eq!(
        store::apply_payload(
            &fixture.db,
            &fixture.scope,
            &fixture.session,
            &request.operation_id
        )
        .unwrap(),
        Some(payload.clone())
    );
    let finished = fixture.finish(&payload, wire::OperationState::Succeeded, 23);
    assert!(finished.binding.managed);
    assert_eq!(finished.binding.binding_revision, 2);
    assert_eq!(finished.binding.state, wire::BindingState::None);
    store::require_settled(&fixture.db, &fixture.session).unwrap();
}

#[test]
fn expert_store_scope_ownership_applies_to_reads_and_binding_intents() {
    let mut fixture = Fixture::new();
    let selected = expert("0.1.0", 'a');
    let request = fixture.request(30, 0, Some(&selected));
    assert_eq!(
        store::read(&fixture.db, &fixture.scope, &fixture.session)
            .unwrap()
            .state,
        wire::BindingState::None
    );
    for other_scope in [
        ChatScope::new(id(11), id(2)).unwrap(),
        ChatScope::new(id(1), id(12)).unwrap(),
    ] {
        assert_eq!(
            store::read(&fixture.db, &other_scope, &fixture.session),
            Err(wire::ErrorCode::NotFound)
        );
        assert_eq!(
            store::reference(&fixture.db, &other_scope, &fixture.session),
            Err(wire::ErrorCode::NotFound)
        );
        assert_eq!(
            store::read_operation(
                &fixture.db,
                &other_scope,
                &fixture.session,
                &request.operation_id
            ),
            Err(wire::ErrorCode::NotFound)
        );
        let tx = fixture.db.transaction().unwrap();
        assert_eq!(
            store::begin(
                &tx,
                &other_scope,
                &request,
                Some(&selected),
                &"a".repeat(64),
                10
            ),
            Err(wire::ErrorCode::NotFound)
        );
        tx.rollback().unwrap();
    }
    assert_eq!(fixture.counts(), (0, 0));
}

#[test]
fn expert_store_begin_and_attempt_journal_follow_the_same_transaction() {
    let mut fixture = Fixture::new();
    let selected = expert("0.1.0", 'a');
    let request = fixture.request(30, 0, Some(&selected));
    let payload = fixture.payload(&request, Some(&selected));
    let tx = fixture.db.transaction().unwrap();
    store::begin(
        &tx,
        &fixture.scope,
        &request,
        Some(&selected),
        &"a".repeat(64),
        10,
    )
    .unwrap();
    assert!(store::record_apply(&tx, &fixture.scope, &payload, 11).unwrap());
    assert_eq!(
        store::read(&tx, &fixture.scope, &fixture.session)
            .unwrap()
            .state,
        wire::BindingState::Applying
    );
    tx.rollback().unwrap(); // Normal caller decision, not a fault injection.
    assert_eq!(fixture.counts(), (0, 0));
    assert_eq!(
        store::read(&fixture.db, &fixture.scope, &fixture.session)
            .unwrap()
            .binding_revision,
        0
    );
    let (result, _) = fixture.begin_apply(&request, Some(&selected), 'a', 20);
    assert_eq!(result.operation.state, wire::OperationState::Pending);
    assert_eq!(fixture.counts(), (1, 1));
}

#[test]
fn expert_store_pending_switch_preserves_old_effective_reference_and_revision() {
    let mut fixture = Fixture::new();
    let old = expert("0.1.0", 'a');
    let next = expert("0.2.0", 'b');
    fixture.activate(&old);
    let request = fixture.request(30, 1, Some(&next));
    let (result, _) = fixture.begin_apply(&request, Some(&next), 'b', 20);
    assert_eq!(result.binding.binding_revision, 1);
    assert_eq!(result.binding.expert, Some(old.display));
    assert_eq!(result.operation.requested_expert, Some(next.display));
    assert_eq!(fixture.confirmed_reference(), Some(old.reference));
    assert_eq!(
        store::reference(&fixture.db, &fixture.scope, &fixture.session),
        Err(wire::ErrorCode::OperationPending)
    );
    assert_eq!(
        store::require_settled(&fixture.db, &fixture.session),
        Err(wire::ErrorCode::OperationPending)
    );
}

#[test]
fn expert_store_finish_is_atomic_and_success_increments_only_once() {
    let mut fixture = Fixture::new();
    let selected = expert("0.1.0", 'a');
    let request = fixture.request(30, 0, Some(&selected));
    let (_, payload) = fixture.begin_apply(&request, Some(&selected), 'a', 10);
    let succeeded = receipt(&payload, wire::OperationState::Succeeded);
    let tx = fixture.db.transaction().unwrap();
    let temporary = store::finish(&tx, &fixture.scope, &succeeded, 12).unwrap();
    assert_eq!(temporary.binding.binding_revision, 1);
    assert_eq!(
        store::reference(&tx, &fixture.scope, &fixture.session).unwrap(),
        Some(selected.reference.clone())
    );
    tx.rollback().unwrap();
    let pending = store::read_operation(
        &fixture.db,
        &fixture.scope,
        &fixture.session,
        &request.operation_id,
    )
    .unwrap()
    .unwrap();
    assert_eq!(pending.operation.state, wire::OperationState::Pending);
    assert_eq!(fixture.confirmed_reference(), None);
    let committed = fixture.finish(&payload, wire::OperationState::Succeeded, 13);
    assert_eq!(committed.binding.binding_revision, 1);
    assert_eq!(committed.binding.state, wire::BindingState::Ready);
    assert_eq!(
        fixture.finish(&payload, wire::OperationState::Succeeded, 14),
        committed
    );
    assert_eq!(fixture.counts(), (1, 1));
    assert_eq!(fixture.confirmed_reference(), Some(selected.reference));
}

#[test]
fn expert_store_same_operation_and_intent_replays_but_changed_intent_conflicts() {
    let mut fixture = Fixture::new();
    let selected = expert("0.1.0", 'a');
    let request = fixture.request(30, 0, Some(&selected));
    let (pending, payload) = fixture.begin_apply(&request, Some(&selected), 'a', 10);
    let tx = fixture.db.transaction().unwrap();
    assert_eq!(
        store::begin(
            &tx,
            &fixture.scope,
            &request,
            Some(&selected),
            &"a".repeat(64),
            12
        )
        .unwrap(),
        pending
    );
    assert!(!store::record_apply(&tx, &fixture.scope, &payload, 12).unwrap());
    assert_eq!(
        store::begin(
            &tx,
            &fixture.scope,
            &request,
            Some(&selected),
            &"b".repeat(64),
            12
        ),
        Err(wire::ErrorCode::RequestConflict)
    );
    tx.commit().unwrap();
    let done = fixture.finish(&payload, wire::OperationState::Succeeded, 13);
    let tx = fixture.db.transaction().unwrap();
    assert_eq!(
        store::begin(
            &tx,
            &fixture.scope,
            &request,
            Some(&selected),
            &"a".repeat(64),
            14
        )
        .unwrap(),
        done
    );
    assert!(!store::record_apply(&tx, &fixture.scope, &payload, 14).unwrap());
    tx.commit().unwrap();
    assert_eq!(fixture.counts(), (1, 1));
}

#[test]
fn expert_store_unknown_blocks_new_changes_and_keeps_confirmed_state_until_resolved() {
    let mut fixture = Fixture::new();
    let old = expert("0.1.0", 'a');
    let next = expert("0.2.0", 'b');
    fixture.activate(&old);
    let request = fixture.request(30, 1, Some(&next));
    let (_, payload) = fixture.begin_apply(&request, Some(&next), 'b', 20);
    let unknown = fixture.finish(&payload, wire::OperationState::Unknown, 22);
    assert_eq!(unknown.binding.state, wire::BindingState::Unknown);
    assert_eq!(unknown.binding.binding_revision, 1);
    assert_eq!(unknown.binding.expert, Some(old.display));
    assert_eq!(fixture.confirmed_reference(), Some(old.reference));
    let remove = fixture.request(31, 1, None);
    let tx = fixture.db.transaction().unwrap();
    assert_eq!(
        store::begin(&tx, &fixture.scope, &remove, None, &"c".repeat(64), 23),
        Err(wire::ErrorCode::OperationPending)
    );
    assert_eq!(
        store::begin(
            &tx,
            &fixture.scope,
            &request,
            Some(&next),
            &"b".repeat(64),
            23
        )
        .unwrap(),
        unknown
    );
    assert!(!store::record_apply(&tx, &fixture.scope, &payload, 23).unwrap());
    tx.commit().unwrap();
    assert_eq!(fixture.counts(), (1, 2));
    assert_eq!(
        store::reference(&fixture.db, &fixture.scope, &fixture.session),
        Err(wire::ErrorCode::OperationPending)
    );
    let resolved = fixture.finish(&payload, wire::OperationState::Succeeded, 24);
    assert_eq!(resolved.binding.binding_revision, 2);
    assert_eq!(
        store::reference(&fixture.db, &fixture.scope, &fixture.session).unwrap(),
        Some(next.reference)
    );
}

#[test]
fn expert_store_rejection_keeps_revision_and_removal_is_a_new_successful_revision() {
    let mut fixture = Fixture::new();
    let old = expert("0.1.0", 'a');
    let next = expert("0.2.0", 'b');
    let first = fixture.activate(&old);
    let switch = fixture.request(30, 1, Some(&next));
    let (_, switch_payload) = fixture.begin_apply(&switch, Some(&next), 'b', 20);
    let rejected = fixture.finish(&switch_payload, wire::OperationState::Rejected, 22);
    assert_eq!(rejected.operation.binding_revision, 1);
    assert_eq!(rejected.binding.binding_revision, 1);
    assert_eq!(rejected.binding.state, wire::BindingState::Ready);
    assert_eq!(fixture.confirmed_reference(), Some(old.reference));
    let remove = fixture.request(31, 1, None);
    let (_, removal_payload) = fixture.begin_apply(&remove, None, 'c', 30);
    let removed = fixture.finish(&removal_payload, wire::OperationState::Succeeded, 32);
    assert_eq!(removed.binding.binding_revision, 2);
    assert_eq!(removed.binding.state, wire::BindingState::None);
    assert_eq!(removed.binding.expert, None);
    assert_eq!(fixture.confirmed_reference(), None);
    assert_eq!(
        store::reference(&fixture.db, &fixture.scope, &fixture.session).unwrap(),
        None
    );
    assert_eq!(
        store::read_operation(&fixture.db, &fixture.scope, &fixture.session, &id(20)).unwrap(),
        Some(first)
    );
    assert_eq!(
        store::read_operation(
            &fixture.db,
            &fixture.scope,
            &fixture.session,
            &switch.operation_id
        )
        .unwrap(),
        Some(rejected)
    );
    assert_eq!(fixture.counts(), (1, 3));
}

#[test]
fn expert_store_receipt_requires_the_journaled_owned_host_attempt() {
    let mut fixture = Fixture::new();
    let selected = expert("0.1.0", 'a');
    let request = fixture.request(30, 0, Some(&selected));
    let payload = fixture.payload(&request, Some(&selected));
    let expected_receipt = receipt(&payload, wire::OperationState::Succeeded);
    let tx = fixture.db.transaction().unwrap();
    store::begin(
        &tx,
        &fixture.scope,
        &request,
        Some(&selected),
        &"a".repeat(64),
        10,
    )
    .unwrap();
    assert_eq!(
        store::finish(&tx, &fixture.scope, &expected_receipt, 11),
        Err(wire::ErrorCode::OperationPending)
    );
    assert!(store::record_apply(&tx, &fixture.scope, &payload, 11).unwrap());
    tx.commit().unwrap();
    // A normal receipt from a different Host generation must not confirm this attempt.
    let mut other_host_receipt = expected_receipt.clone();
    other_host_receipt.host_instance_id = id(15);
    let tx = fixture.db.transaction().unwrap();
    assert_eq!(
        store::finish(&tx, &fixture.scope, &other_host_receipt, 12),
        Err(wire::ErrorCode::RequestConflict)
    );
    let mut other_attempt = payload.clone();
    other_attempt.agent_session_id = id(16);
    assert_eq!(
        store::record_apply(&tx, &fixture.scope, &other_attempt, 12),
        Err(wire::ErrorCode::RequestConflict)
    );
    tx.rollback().unwrap();
    assert_eq!(fixture.confirmed_reference(), None);
    assert_eq!(
        fixture
            .finish(&payload, wire::OperationState::Succeeded, 13)
            .binding
            .binding_revision,
        1
    );
}

#[test]
fn expert_store_rejected_initial_selection_stays_ordinary_and_history_is_untouched() {
    let mut fixture = Fixture::new();
    fixture.db.execute(
        "INSERT INTO chat_messages(id,session_id,turn_id,role,content,status,ordinal,created_at) VALUES(?1,?2,NULL,'user','Ordinary synthetic history','committed',0,2)",
        params![id(50), fixture.session],
    ).unwrap();
    let selected = expert("0.1.0", 'a');
    let request = fixture.request(30, 0, Some(&selected));
    let (_, payload) = fixture.begin_apply(&request, Some(&selected), 'a', 10);
    let rejected = fixture.finish(&payload, wire::OperationState::Rejected, 12);
    assert_eq!(rejected.binding.state, wire::BindingState::None);
    assert_eq!(rejected.binding.binding_revision, 0);
    assert_eq!(rejected.operation.binding_revision, 0);
    assert_eq!(fixture.confirmed_reference(), None);
    let stored: (String, String, i64, i64) = fixture.db.query_row(
        "SELECT content,status,ordinal,created_at FROM chat_messages WHERE id=?1 AND session_id=?2",
        params![id(50), fixture.session], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).unwrap();
    assert_eq!(
        stored,
        (
            "Ordinary synthetic history".into(),
            "committed".into(),
            0,
            2
        )
    );
    let messages: i64 = fixture
        .db
        .query_row("SELECT count(*) FROM chat_messages", [], |row| row.get(0))
        .unwrap();
    assert_eq!(messages, 1);
    assert_eq!(
        store::require_settled(&fixture.db, &fixture.session),
        Ok(())
    );
}

#[test]
fn expert_store_same_operation_on_another_owned_session_conflicts_without_partial_binding() {
    let mut fixture = Fixture::new();
    let selected = expert("0.1.0", 'a');
    let request = fixture.request(30, 0, Some(&selected));
    let (first, _) = fixture.begin_apply(&request, Some(&selected), 'a', 10);
    let second_session = id(40);
    fixture.db.execute(
        "INSERT INTO chat_sessions(id,owner_user_id,tenant_id,project_id,title,title_source,title_job_status,created_at,last_activity_at) VALUES(?1,?2,?3,?4,'Second ordinary conversation','fallback','not_started',1,1)",
        params![second_session, fixture.scope.owner_user_id, fixture.scope.tenant_id, id(3)],
    ).unwrap();
    let mut second_request = request.clone();
    second_request.session_id = second_session.clone();
    let tx = fixture.db.transaction().unwrap();
    assert_eq!(
        store::begin(
            &tx,
            &fixture.scope,
            &second_request,
            Some(&selected),
            &"a".repeat(64),
            20
        ),
        Err(wire::ErrorCode::RequestConflict)
    );
    tx.commit().unwrap();
    assert_eq!(fixture.counts(), (1, 1));
    let second = store::read(&fixture.db, &fixture.scope, &second_session).unwrap();
    assert_eq!(second.state, wire::BindingState::None);
    assert_eq!(second.binding_revision, 0);
    assert_eq!(
        store::read_operation(
            &fixture.db,
            &fixture.scope,
            &second_session,
            &request.operation_id
        )
        .unwrap(),
        None
    );
    assert_eq!(
        store::read_operation(
            &fixture.db,
            &fixture.scope,
            &fixture.session,
            &request.operation_id
        )
        .unwrap(),
        Some(first)
    );
}
