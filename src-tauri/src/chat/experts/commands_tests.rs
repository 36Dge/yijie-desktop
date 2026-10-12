//! Normal command composition and reader-authority tests. Only this test's
//! temporary SQLCipher repository is opened; no App, Host, Runtime or model.
use super::*;
use crate::chat::{
    authorization::AuthoritativeChatProjection,
    keychain::{DatabaseKey, ReceiptKey},
    migrations,
};

struct Fixture {
    root: std::path::PathBuf,
    repo: Option<ChatRepository>,
    access: Access,
    session: String,
    agent: String,
    thread: String,
    turn: String,
    operation: String,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("feat158-command-{}", Uuid::now_v7()));
        std::fs::create_dir(&root).unwrap();
        let scope = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
        let mut repo = ChatRepository::open(
            &root.join("chat"),
            &DatabaseKey::from_bytes([81; 32]),
            ReceiptKey::from_bytes([82; 32]),
            scope.clone(),
        )
        .unwrap();
        migrations::migrate_to_target(&mut repo.connection, 35).unwrap();
        let project = Uuid::now_v7().to_string();
        let session = Uuid::now_v7().to_string();
        let agent = Uuid::now_v7().to_string();
        let thread = Uuid::now_v7().to_string();
        let turn = Uuid::now_v7().to_string();
        let operation = Uuid::now_v7().to_string();
        repo.connection.execute(
            "INSERT INTO chat_projects(id,owner_user_id,tenant_id,safe_name,canonical_hash,bookmark_ref,last_used_at) VALUES(?1,?2,?3,'Normal command fixture',?4,?5,1)",
            params![project,scope.owner_user_id,scope.tenant_id,"a".repeat(64),b"normal-bookmark".as_slice()],
        ).unwrap();
        repo.connection.execute(
            "INSERT INTO chat_sessions(id,owner_user_id,tenant_id,project_id,title,title_source,title_job_status,created_at,last_activity_at,agent_session_id,runtime_thread_id) VALUES(?1,?2,?3,?4,'Completed ordinary conversation','fallback','not_started',1,1,?5,?6)",
            params![session,scope.owner_user_id,scope.tenant_id,project,agent,thread],
        ).unwrap();
        repo.connection.execute(
            "INSERT INTO chat_turns(id,session_id,operation_id,runtime_turn_id,status,terminal_at,submission_status) VALUES(?1,?2,?3,?4,'completed',2,'submitted')",
            params![turn,session,operation,Uuid::now_v7().to_string()],
        ).unwrap();
        repo.connection.execute("INSERT INTO chat_model_selections(session_id,profile_id,revision,state) VALUES(?1,'minimax-m3-high-v1',3,'ready')", [&session]).unwrap();
        repo.connection
            .execute(
                "INSERT INTO chat_task_permissions(session_id,mode) VALUES(?1,'auto')",
                [&session],
            )
            .unwrap();
        let manager = ChatAuthorizationManager::new(&scope).unwrap();
        let context = manager
            .bind(projection(&scope, 1), now().unwrap())
            .unwrap()
            .context_id;
        Self {
            root,
            repo: Some(repo),
            access: Access {
                manager,
                scope,
                context,
            },
            session,
            agent,
            thread,
            turn,
            operation,
        }
    }
    fn repo(&mut self) -> &mut ChatRepository {
        self.repo.as_mut().unwrap()
    }
    fn request(&self, selected: Option<&store::ResolvedExpert>) -> wire::BindingSetPayload {
        wire::BindingSetPayload {
            operation_id: Uuid::now_v7().to_string(),
            session_id: self.session.clone(),
            expected_binding_revision: 0,
            expert: selected.map(|value| wire::ExpertSelection {
                expert_id: value.reference.expert_id.clone(),
                version: value.reference.version.clone(),
            }),
        }
    }
    fn plan(
        &mut self,
        request: &wire::BindingSetPayload,
        selected: Option<&store::ResolvedExpert>,
    ) -> Result<(wire::BindingResult, wire::ApplyPayload), Error> {
        let access = self.access.clone();
        plan_binding(
            self.repo(),
            &access,
            request,
            selected,
            Uuid::now_v7().to_string(),
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        drop(self.repo.take());
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}
fn projection(scope: &ChatScope, revision: u64) -> AuthoritativeChatProjection {
    AuthoritativeChatProjection::from_trusted_native_projection(
        Uuid::parse_str(&scope.tenant_id).unwrap(),
        revision,
        now().unwrap() + 300,
        ["task.read", "task.create", "plugin.read"].map(str::to_owned),
    )
    .unwrap()
}
fn expert() -> store::ResolvedExpert {
    store::ResolvedExpert {
        reference: wire::ExpertRef {
            expert_id: "sample-expert".into(),
            version: "0.1.0".into(),
            archive_sha256: "a".repeat(64),
            role_sha256: "b".repeat(64),
            knowledge_manifest_sha256: "c".repeat(64),
        },
        display: wire::ExpertDisplay {
            expert_id: "sample-expert".into(),
            version: "0.1.0".into(),
            display_name: "普通合成专家".into(),
            subtitle: "本地参考".into(),
            icon_key: "skillOperations".into(),
        },
    }
}

#[test]
fn expert_commands_recheck_current_reader_before_returning_saved_observation() {
    let mut fixture = Fixture::new();
    let request = fixture.request(None);
    let (observed, _) = fixture.plan(&request, None).unwrap();
    let old = fixture.access.clone();
    assert!(old
        .response(Uuid::now_v7().to_string(), encode(&observed).unwrap())
        .is_ok());
    // A normal UI context rebind invalidates the previous reader while a Host
    // read could be in flight. Its saved fallback must not bypass that change.
    let current = old
        .manager
        .bind(projection(&old.scope, 1), now().unwrap())
        .unwrap();
    assert_eq!(
        old.response(Uuid::now_v7().to_string(), encode(&observed).unwrap()),
        Err(Error::ContextInvalid)
    );
    let renewed = Access {
        context: current.context_id,
        ..old
    };
    let response = renewed
        .response(Uuid::now_v7().to_string(), encode(&observed).unwrap())
        .unwrap();
    let decoded: wire::BindingOperationReadResponse = serde_json::from_value(response).unwrap();
    assert_eq!(decoded.data, observed);
}

#[test]
fn expert_commands_plan_combines_real_ordinary_session_model_permission_and_turn() {
    let mut fixture = Fixture::new();
    let selected = expert();
    let request = fixture.request(Some(&selected));
    let (pending, payload) = fixture.plan(&request, Some(&selected)).unwrap();
    assert_eq!(payload.local_session_id, fixture.session);
    assert_eq!(payload.agent_session_id, fixture.agent);
    assert_eq!(payload.native_thread_id, fixture.thread);
    assert_eq!(payload.intent.expected_revision, 3);
    assert_eq!(
        serde_json::to_value(payload.intent.profile_id).unwrap(),
        "minimax-m3-high-v1"
    );
    assert_eq!(payload.permission_mode, wire::PermissionMode::Auto);
    assert_eq!(
        payload.market_snapshot,
        selection_generated::freeze_selection(fixture.operation.clone(), vec![]).unwrap()
    );
    assert_eq!(payload.expert, Some(selected.reference));
    assert_eq!(
        payload.scope,
        fixture
            .access
            .authority(&required_binding(&request))
            .unwrap()
    );
    assert_eq!(pending.binding.binding_revision, 0);
    assert!(pending.binding.managed);
    let repo = fixture.repo.as_ref().unwrap();
    assert_eq!(
        store::apply_payload(
            &repo.connection,
            &fixture.access.scope,
            &fixture.session,
            &request.operation_id
        )
        .unwrap(),
        Some(payload)
    );
    assert_eq!(
        store::read_operation(
            &repo.connection,
            &fixture.access.scope,
            &fixture.session,
            &request.operation_id
        )
        .unwrap(),
        Some(pending)
    );
}

#[test]
fn expert_commands_plan_preserves_the_existing_market_snapshot() {
    let mut fixture = Fixture::new();
    let snapshot = selection_generated::freeze_selection(
        fixture.operation.clone(),
        vec![crate::chat::connectors::generated::SelectionRef {
            installation_id: Uuid::now_v7().to_string(),
            revision: 2,
            generation: 1,
        }],
    )
    .unwrap();
    let receipt = selection_generated::SubmissionReceipt {
        outcome: "local_durable_accepted".into(),
        session_id: fixture.session.clone(),
        local_turn_id: fixture.turn.clone(),
        submission_operation_id: fixture.operation.clone(),
        turn_operation_id: fixture.operation.clone(),
        selection_digest: snapshot.selection_digest.clone(),
    };
    fixture.repo.as_mut().unwrap().connection.execute(
        "INSERT INTO chat_market_submissions(submission_operation_id,session_id,local_turn_id,turn_operation_id,format_version,request_digest,snapshot_json,display_json,receipt_json,created_at,authorization_revision,permission_mode,native_process_epoch) VALUES(?1,?2,?3,?1,1,?4,?5,'[]',?6,1,1,'auto',?7)",
        params![fixture.operation,fixture.session,fixture.turn,"d".repeat(64),serde_json::to_string(&snapshot).unwrap(),serde_json::to_string(&receipt).unwrap(),Uuid::now_v7().to_string()],
    ).unwrap();
    let request = fixture.request(None);
    let (_, payload) = fixture.plan(&request, None).unwrap();
    assert_eq!(payload.market_snapshot, snapshot);
    assert!(payload.expert.is_none());
}

#[test]
fn expert_commands_plan_waits_for_a_normal_active_turn_before_journaling() {
    let mut fixture = Fixture::new();
    fixture
        .repo
        .as_mut()
        .unwrap()
        .connection
        .execute(
            "UPDATE chat_turns SET status='streaming',terminal_at=NULL WHERE id=?1",
            [&fixture.turn],
        )
        .unwrap();
    let request = fixture.request(None);
    assert!(matches!(fixture.plan(&request, None), Err(Error::Busy)));
    let count: i64 = fixture
        .repo()
        .connection
        .query_row(
            "SELECT count(*) FROM chat_expert_binding_operations",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn expert_commands_apply_rechecks_sender_after_journal_and_settles_without_dispatch() {
    for selecting in [false, true] {
        let mut fixture = Fixture::new();
        let selected = selecting.then(expert);
        let request = fixture.request(selected.as_ref());
        let (_, original) = fixture.plan(&request, selected.as_ref()).unwrap();
        assert!(authorize_apply_dispatch(&fixture.access, &original).is_ok());
        let scope = fixture.access.scope.clone();
        // A same-revision UI context renewal is ordinary lifecycle activity.
        // It does not retire the private pipe, but the old sender is no longer
        // authorized to start an apply after its database await returns.
        fixture
            .access
            .manager
            .bind(projection(&scope, 1), now().unwrap())
            .unwrap();
        let code = authorize_apply_dispatch(&fixture.access, &original).unwrap_err();
        assert_eq!(code, Error::ContextInvalid);
        let rejected = settle_binding(
            fixture.repo(),
            &scope,
            &request,
            Err(ExpertControlError::Rejected(wire::Error {
                schema_version: 1,
                request_id: None,
                code,
                retryable: false,
            })),
        )
        .unwrap();
        assert_eq!(rejected.operation.operation_id, request.operation_id);
        assert_eq!(rejected.operation.state, wire::OperationState::Rejected);
        assert_eq!(rejected.operation.error_code, Some(Error::ContextInvalid));
        assert_eq!(rejected.binding.state, wire::BindingState::None);
        assert_eq!(rejected.binding.binding_revision, 0);
        assert!(rejected.binding.expert.is_none());
        let repo = fixture.repo.as_ref().unwrap();
        assert_eq!(
            store::read_operation(
                &repo.connection,
                &scope,
                &fixture.session,
                &request.operation_id
            )
            .unwrap(),
            Some(rejected)
        );
        assert_eq!(
            store::apply_payload(
                &repo.connection,
                &scope,
                &fixture.session,
                &request.operation_id
            )
            .unwrap(),
            Some(original)
        );
    }
}

fn receipt(original: &wire::ApplyPayload) -> wire::ApplyReceipt {
    wire::ApplyReceipt {
        operation_id: original.operation_id.clone(),
        host_instance_id: original.host_instance_id.clone(),
        local_session_id: original.local_session_id.clone(),
        agent_session_id: original.agent_session_id.clone(),
        native_thread_id: original.native_thread_id.clone(),
        expected_binding_revision: original.expected_binding_revision,
        binding_revision: original.binding_revision,
        expert: original.expert.clone(),
        state: wire::OperationState::Succeeded,
        error_code: None,
    }
}

#[test]
fn expert_commands_recovery_keeps_original_intent_under_a_renewed_context() {
    let mut fixture = Fixture::new();
    let selected = expert();
    let request = fixture.request(Some(&selected));
    let (_, original) = fixture.plan(&request, Some(&selected)).unwrap();
    let scope = fixture.access.scope.clone();
    // Busy is a normal concurrent-admission refusal, not evidence that the
    // original binding never applied. Recovery retains an unknown operation.
    let unknown = settle_recovery(
        fixture.repo(),
        &scope,
        &original,
        Err(ExpertControlError::Busy),
    )
    .unwrap();
    assert_eq!(unknown.operation.state, wire::OperationState::Unknown);
    assert_eq!(unknown.binding.binding_revision, 0);
    fixture.access.context = fixture
        .access
        .manager
        .bind(projection(&scope, 1), now().unwrap())
        .unwrap()
        .context_id;
    let checked =
        guard_recovery(fixture.repo.as_ref().unwrap(), &fixture.access, &original).unwrap();
    assert_eq!(checked, unknown);
    let private = recovery_request(&fixture.access, Uuid::now_v7().to_string(), &original).unwrap();
    private.validate().unwrap();
    assert_ne!(private.payload.host_instance_id, original.host_instance_id);
    assert_eq!(private.payload.original, original);
    assert_eq!(
        store::apply_payload(
            &fixture.repo.as_ref().unwrap().connection,
            &scope,
            &fixture.session,
            &request.operation_id
        )
        .unwrap(),
        Some(original.clone())
    );
    let settled =
        settle_recovery(fixture.repo(), &scope, &original, Ok(receipt(&original))).unwrap();
    assert_eq!(settled.operation.state, wire::OperationState::Succeeded);
    assert_eq!(settled.binding.binding_revision, 1);
    assert_eq!(settled.binding.expert, Some(selected.display));
}

#[test]
fn expert_commands_recovery_rechecks_sender_after_composition_guard_without_ending_original() {
    let mut fixture = Fixture::new();
    let selected = expert();
    let request = fixture.request(Some(&selected));
    let (_, original) = fixture.plan(&request, Some(&selected)).unwrap();
    let scope = fixture.access.scope.clone();
    let pending =
        guard_recovery(fixture.repo.as_ref().unwrap(), &fixture.access, &original).unwrap();
    fixture
        .access
        .manager
        .bind(projection(&scope, 1), now().unwrap())
        .unwrap();
    assert!(matches!(
        recovery_request(&fixture.access, Uuid::now_v7().to_string(), &original),
        Err(Error::ContextInvalid)
    ));
    assert_eq!(
        store::read_operation(
            &fixture.repo.as_ref().unwrap().connection,
            &scope,
            &fixture.session,
            &request.operation_id,
        )
        .unwrap(),
        Some(pending)
    );
}

#[test]
fn expert_commands_completed_recovery_replays_before_live_composition_checks() {
    let mut fixture = Fixture::new();
    let request = fixture.request(None);
    let (_, original) = fixture.plan(&request, None).unwrap();
    let scope = fixture.access.scope.clone();
    let completed =
        settle_recovery(fixture.repo(), &scope, &original, Ok(receipt(&original))).unwrap();
    // A later ordinary active turn does not change the original completed
    // recovery receipt or authorize another apply of that operation.
    fixture
        .repo
        .as_mut()
        .unwrap()
        .connection
        .execute(
            "UPDATE chat_turns SET status='streaming',terminal_at=NULL WHERE id=?1",
            [&fixture.turn],
        )
        .unwrap();
    let (replay, pending) = read_recovery(
        fixture.repo.as_ref().unwrap(),
        &fixture.access,
        &wire::BindingOperationReadPayload {
            session_id: fixture.session.clone(),
            operation_id: request.operation_id,
        },
    )
    .unwrap();
    assert_eq!(replay, completed);
    assert!(pending.is_none());
    assert_eq!(
        guard_recovery(fixture.repo.as_ref().unwrap(), &fixture.access, &original).unwrap(),
        completed
    );
}

#[test]
fn expert_commands_recovery_rechecks_current_plugin_read_permission() {
    let mut fixture = Fixture::new();
    let selected = expert();
    let request = fixture.request(Some(&selected));
    let (_, original) = fixture.plan(&request, Some(&selected)).unwrap();
    let scope = fixture.access.scope.clone();
    let current = fixture
        .access
        .manager
        .bind(
            AuthoritativeChatProjection::from_trusted_native_projection(
                Uuid::parse_str(&scope.tenant_id).unwrap(),
                2,
                now().unwrap() + 300,
                ["task.read", "task.create"].map(str::to_owned),
            )
            .unwrap(),
            now().unwrap(),
        )
        .unwrap();
    fixture.access.context = current.context_id;
    assert!(matches!(
        guard_recovery(fixture.repo.as_ref().unwrap(), &fixture.access, &original),
        Err(Error::PermissionDenied)
    ));
    assert_eq!(
        store::apply_payload(
            &fixture.repo.as_ref().unwrap().connection,
            &scope,
            &fixture.session,
            &request.operation_id
        )
        .unwrap(),
        Some(original)
    );
}
