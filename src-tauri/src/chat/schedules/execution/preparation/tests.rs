use super::*;
use crate::chat::{
    keychain::{DatabaseKey, ReceiptKey},
    schedules::{generated::*, ScheduleStorageMode},
};
use crate::local_profile::{DEMO_FAST_OWNER_USER_ID, DEMO_FAST_TENANT_ID};
use std::path::Path;

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("feat155-3b1-{}", Uuid::now_v7()));
        std::fs::create_dir(&p).unwrap();
        Self(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}
fn open(root: &Path, mode: ScheduleStorageMode) -> ChatRepository {
    ChatRepository::open_with_schedule_storage(
        &root.join("chat"),
        &DatabaseKey::from_bytes([155; 32]),
        ReceiptKey::from_bytes([156; 32]),
        ChatScope::new(DEMO_FAST_OWNER_USER_ID.into(), DEMO_FAST_TENANT_ID.into()).unwrap(),
        mode,
    )
    .unwrap()
}
fn plan_request(mode: TargetMode, conversation: Option<String>) -> SavePlanRequest {
    SavePlanRequest {
        request_id: Uuid::now_v7().to_string(),
        plan_id: None,
        expected_revision: None,
        definition: PlanDefinition {
            name: "合成准备".into(),
            content: "本地事务检查".into(),
            rule: TimeRule {
                frequency: TimeRuleFrequency::Daily,
                time_zone: "Asia/Shanghai".into(),
                local_time: "09:00".into(),
                local_date: None,
                weekdays: None,
            },
            target: TargetReference {
                mode,
                conversation_id: conversation,
            },
        },
    }
}
fn confirmed(
    r: &mut ChatRepository,
    mode: TargetMode,
    conversation: Option<String>,
    n: i64,
    max: i64,
) -> (PlanView, GrantConfirmation, GrantView) {
    let p = r
        .save_schedule(plan_request(mode, conversation), n)
        .unwrap();
    let c = GrantConfirmation {
        request_id: Uuid::now_v7().to_string(),
        plan_id: p.plan_id.clone(),
        expected_revision: p.revision,
        max_runs: max,
        expires_at: n + 3600,
    };
    let g = r
        .confirm_schedule_grant(&ScheduleAuthority::local(n).unwrap(), c.clone(), n)
        .unwrap();
    (r.read_schedule(&p.plan_id).unwrap(), c, g)
}
fn count(r: &ChatRepository, table: &str) -> i64 {
    r.connection
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
fn binding(r: &ChatRepository, run: &RunView) -> (String, String, Option<String>, String) {
    r.connection.query_row("SELECT conversation_id,project_id,create_operation_id,local_turn_id FROM chat_scheduled_run_bindings WHERE run_id=?1",[&run.run_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap()
}
// Ordinary declared terminal fixture; no process failure, no actual execution,
// and no production reservation-release API is introduced for these tests.
fn finished_fixture(r: &mut ChatRepository, run: &RunView, n: i64) {
    let (chat, _, create, _) = binding(r, run);
    if let Some(create) = create {
        r.connection
            .execute(
                "UPDATE chat_outbox SET state='inflight' WHERE operation_id=?1",
                [&create],
            )
            .unwrap();
        r.connection.execute("UPDATE chat_public_task_bindings SET state='inflight',lease_expires_at=created_at+30,last_error_code=NULL WHERE create_operation_id=?1",[&create]).unwrap();
        let create = Uuid::parse_str(&create).unwrap();
        let task = Uuid::parse_str(&chat).unwrap();
        r.bind_public_task(create, task, n).unwrap();
        r.bind_host_session_and_enqueue_turn(create, task, Uuid::now_v7(), Uuid::now_v7())
            .unwrap();
        let tag: String = r
            .connection
            .query_row(
                "SELECT scheduled_run_id FROM chat_outbox WHERE operation_id=?1",
                [&run.operation_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tag, run.run_id);
        assert_eq!(
            r.guard_conversation_dispatch(Uuid::parse_str(&run.operation_id).unwrap()),
            Err(ChatError::OrchestrationUnavailable)
        );
    }
    let tx = r.connection.transaction().unwrap();
    tx.execute(
        "UPDATE chat_outbox SET state='done' WHERE scheduled_run_id=?1",
        [&run.run_id],
    )
    .unwrap();
    tx.execute(
        "UPDATE chat_turns SET status='failed',submission_status='failed' WHERE session_id=?1",
        [&chat],
    )
    .unwrap();
    tx.execute("UPDATE chat_scheduled_runs SET delivery_state='terminal',native_outcome='failed' WHERE run_id=?1",[&run.run_id]).unwrap();
    tx.execute(
        "DELETE FROM chat_scheduled_reservation WHERE run_id=?1",
        [&run.run_id],
    )
    .unwrap();
    tx.commit().unwrap();
}

#[test]
fn feat155_3b1_old_grant_reopens_and_dedicated_binding_preserves_authority() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::ExecutionFoundation);
    let (p, c, g) = confirmed(&mut r, TargetMode::DedicatedChat, None, n, 3);
    drop(r);
    let mut r = open(&root.0, ScheduleStorageMode::LocalPreparation);
    assert_eq!(r.schema_version().unwrap(), 18);
    assert_eq!(grant(&r.connection, &r.scope, &g.grant_id, n).unwrap(), g);
    let a = ScheduleAuthority::local(n).unwrap();
    r.connection.execute("INSERT INTO chat_permission_preferences(owner_user_id,tenant_id,draft_mode) VALUES(?1,?2,'full')",params![r.scope.owner_user_id,r.scope.tenant_id]).unwrap();
    let request = Uuid::now_v7().to_string();
    let run = r
        .prepare_manual_local(&a, &g.grant_id, p.revision, &request, n)
        .unwrap();
    let first = binding(&r, &run);
    assert_eq!(r.read_schedule(&p.plan_id).unwrap(), p);
    assert_eq!(
        grant(&r.connection, &r.scope, &g.grant_id, n)
            .unwrap()
            .definition_digest,
        g.definition_digest
    );
    validate_grant(&r.connection, &r.scope, &a, &g.grant_id, p.revision, n).unwrap();
    let mode: String = r
        .connection
        .query_row(
            "SELECT mode FROM chat_task_permissions WHERE session_id=?1",
            [&first.0],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(mode, "ask");
    let draft: String = r
        .connection
        .query_row(
            "SELECT draft_mode FROM chat_permission_preferences",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(draft, "full");
    assert!(r.list_projects().unwrap().is_empty());
    assert_eq!(
        r.session_summary(Uuid::parse_str(&first.0).unwrap())
            .unwrap()
            .session_id
            .to_string(),
        first.0
    );
    assert_eq!(
        r.project_bookmark(&first.1),
        Err(ChatError::ProjectUnavailable)
    );
    assert_eq!(
        r.remove_project(&first.1),
        Err(ChatError::ProjectUnavailable)
    );
    assert_eq!(
        r.set_project_pinned(Uuid::parse_str(&first.1).unwrap(), true, n),
        Err(ChatError::ProjectUnavailable)
    );
    let directory = r.resolve_schedule_project(&first.1).unwrap();
    assert!(r
        .register_project(&directory, b"ordinary-bookmark")
        .is_err());
    assert!(r
        .refresh_project(&first.1, &directory, b"ordinary-bookmark")
        .is_err());
    assert_eq!(
        r.prepare_manual_local(&a, &g.grant_id, p.revision, &request, n)
            .unwrap(),
        run
    );
    assert_eq!(
        r.prepare_manual_local(&a, &g.grant_id, p.revision, &Uuid::now_v7().to_string(), n),
        Err(Error::ReservationBusy)
    );
    assert_eq!(count(&r, "chat_scheduled_runs"), 1);
    assert_eq!(count(&r, "chat_outbox"), 1);
    assert!(r.claim_next_conversation_outbox(n, 30).unwrap().is_none());
    assert_eq!(
        r.guard_conversation_dispatch(Uuid::parse_str(first.2.as_ref().unwrap()).unwrap()),
        Err(ChatError::OrchestrationUnavailable)
    );
    drop(r);
    let mut reader = open(&root.0, ScheduleStorageMode::CompatibleReader);
    assert_eq!(reader.schema_version().unwrap(), 18);
    assert!(reader
        .claim_next_conversation_outbox(n, 30)
        .unwrap()
        .is_none());
    assert_eq!(
        reader.prepare_manual_local(&a, &g.grant_id, p.revision, &request, n),
        Err(Error::StorageDisabled)
    );
    drop(reader);
    let mut r = open(&root.0, ScheduleStorageMode::LocalPreparation);
    finished_fixture(&mut r, &run, n);
    r.connection
        .execute(
            "UPDATE chat_task_permissions SET mode='auto' WHERE session_id=?1",
            [&first.0],
        )
        .unwrap();
    assert_eq!(
        r.prepare_manual_local(&a, &g.grant_id, p.revision, &Uuid::now_v7().to_string(), n),
        Err(Error::PermissionDenied)
    );
    r.connection
        .execute(
            "UPDATE chat_task_permissions SET mode='ask' WHERE session_id=?1",
            [&first.0],
        )
        .unwrap();
    let next = r
        .prepare_manual_local(&a, &g.grant_id, p.revision, &Uuid::now_v7().to_string(), n)
        .unwrap();
    let second = binding(&r, &next);
    assert_eq!((&first.0, &first.1), (&second.0, &second.1));
    assert!(second.2.is_none());
    assert_ne!(first.3, second.3);
    assert_eq!(
        grant(&r.connection, &r.scope, &g.grant_id, n)
            .unwrap()
            .occupied_runs,
        2
    );
    if let Some(out) = std::env::var_os("YIJIE_FEAT155_CONFORMANCE_DIR") {
        std::fs::write(Path::new(&out).join("phase-3b1-native-producer.json"),serde_json::to_vec_pretty(&serde_json::json!({"GrantConfirmation":c,"GrantView":grant(&r.connection,&r.scope,&g.grant_id,n).unwrap(),"RunView":next})).unwrap()).unwrap();
    }
}

#[test]
fn feat155_3b1_replay_precedes_own_quota_expiry_and_request_conflicts() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::LocalPreparation);
    let (p, _, g) = confirmed(&mut r, TargetMode::NewChatEachRun, None, n, 1);
    let a = ScheduleAuthority::local(n).unwrap();
    let request = Uuid::now_v7().to_string();
    let run = r
        .prepare_manual_local(&a, &g.grant_id, p.revision, &request, n)
        .unwrap();
    assert_eq!(
        r.prepare_manual_local(
            &ScheduleAuthority::local(n + 3601).unwrap(),
            &g.grant_id,
            p.revision,
            &request,
            n + 3601
        )
        .unwrap(),
        run
    );
    assert_eq!(
        r.prepare_manual_local(&a, &g.grant_id, p.revision + 1, &request, n),
        Err(Error::RequestConflict)
    );
    assert_eq!(
        r.prepare_manual_local(&a, &g.grant_id, p.revision, &Uuid::now_v7().to_string(), n),
        Err(Error::GrantExhausted)
    );
    assert_eq!(count(&r, "chat_scheduled_runs"), 1);
    assert_eq!(count(&r, "chat_projects"), 1);
    let scope = r.scope.clone();
    r.scope = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
    assert_eq!(
        r.prepare_manual_local(&a, &g.grant_id, p.revision, &request, n),
        Err(Error::ScopeDenied)
    );
    r.scope = scope;
}

#[test]
fn feat155_3b1_new_each_run_and_existing_managed_history_keep_distinct_targets() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::LocalPreparation);
    let (p, _, g) = confirmed(&mut r, TargetMode::NewChatEachRun, None, n, 3);
    let a = ScheduleAuthority::local(n).unwrap();
    let first = r
        .prepare_manual_local(&a, &g.grant_id, p.revision, &Uuid::now_v7().to_string(), n)
        .unwrap();
    let b1 = binding(&r, &first);
    finished_fixture(&mut r, &first, n);
    let second = r
        .prepare_manual_local(&a, &g.grant_id, p.revision, &Uuid::now_v7().to_string(), n)
        .unwrap();
    let b2 = binding(&r, &second);
    assert_ne!(b1.0, b2.0);
    assert_ne!(b1.1, b2.1);
    finished_fixture(&mut r, &second, n);
    let (existing, _, eg) = confirmed(&mut r, TargetMode::ExistingChat, Some(b1.0.clone()), n, 2);
    assert_eq!(eg.workspace.source, WorkspaceSource::ManagedSchedule);
    let third = r
        .prepare_manual_local(
            &a,
            &eg.grant_id,
            existing.revision,
            &Uuid::now_v7().to_string(),
            n,
        )
        .unwrap();
    assert_eq!(binding(&r, &third).0, b1.0);
    finished_fixture(&mut r, &third, n);
    r.delete_session_local(&b1.0).unwrap();
    assert_eq!(r.read_schedule(&p.plan_id).unwrap(), p);
    assert_eq!(
        r.read_schedule(&existing.plan_id).unwrap().target_state,
        TargetState::Missing
    );
    assert_eq!(
        r.connection
            .query_row(
                "SELECT target_deleted FROM chat_scheduled_run_bindings WHERE run_id=?1",
                [&third.run_id],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}

#[test]
fn feat155_3b1_delete_inflight_is_rejected_and_finished_dedicated_invalidates() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::LocalPreparation);
    let (p, _, g) = confirmed(&mut r, TargetMode::DedicatedChat, None, n, 2);
    let a = ScheduleAuthority::local(n).unwrap();
    let run = r
        .prepare_manual_local(&a, &g.grant_id, p.revision, &Uuid::now_v7().to_string(), n)
        .unwrap();
    let (chat, project, _, _) = binding(&r, &run);
    assert_eq!(
        r.begin_session_deletion(Uuid::parse_str(&chat).unwrap(), Uuid::now_v7(), n),
        Err(ChatError::ConversationConflict)
    );
    assert_eq!(
        r.delete_session_local(&chat),
        Err(ChatError::ConversationConflict)
    );
    assert_eq!(count(&r, "chat_scheduled_reservation"), 1);
    finished_fixture(&mut r, &run, n);
    r.delete_session_local(&chat).unwrap();
    let missing = r.read_schedule(&p.plan_id).unwrap();
    assert_eq!(missing.target_state, TargetState::Missing);
    assert_eq!(missing.state, PlanState::Paused);
    assert!(missing.authorization_ref.is_none());
    assert!(r.resolve_schedule_project(&project).unwrap().is_dir());
    assert_eq!(
        grant(&r.connection, &r.scope, &g.grant_id, n)
            .unwrap()
            .state,
        GrantState::Stale
    );
}

#[test]
fn feat155_3b1_prepared_directory_then_revision_conflict_leaves_no_partial_rows() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::LocalPreparation);
    let (p, _, g) = confirmed(&mut r, TargetMode::DedicatedChat, None, n, 2);
    let a = ScheduleAuthority::local(n).unwrap();
    let request = Uuid::now_v7().to_string();
    let target = r.prepare_target(&p, &request).unwrap();
    let same = r.prepare_target(&p, &request).unwrap();
    assert_eq!(target.directory, same.directory);
    let mut edit = plan_request(TargetMode::DedicatedChat, None);
    edit.plan_id = Some(p.plan_id.clone());
    edit.expected_revision = Some(p.revision);
    edit.definition.content = "已确认的新内容".into();
    r.save_schedule(edit, n).unwrap();
    assert_eq!(
        r.commit_manual_preparation(&a, &g.grant_id, p.revision, &request, &target, n),
        Err(Error::GrantStale)
    );
    for table in [
        "chat_scheduled_runs",
        "chat_scheduled_reservation",
        "chat_scheduled_run_bindings",
        "chat_outbox",
        "chat_sessions",
        "chat_projects",
    ] {
        assert_eq!(count(&r, table), 0, "{table}")
    }
    assert_eq!(
        grant(&r.connection, &r.scope, &g.grant_id, n)
            .unwrap()
            .occupied_runs,
        0
    );
    assert!(target.directory.is_dir());
}

#[test]
fn feat155_3b1_normal_directory_resolution_failure_and_expired_grant_have_no_writes() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::LocalPreparation);
    let (p, _, g) = confirmed(&mut r, TargetMode::DedicatedChat, None, n, 2);
    // A never-prepared native resource is an ordinary unavailable input.
    assert!(directories::managed_path(
        &root.0.join("chat"),
        &r.scope,
        &Uuid::now_v7().to_string(),
        false
    )
    .is_err());
    assert_eq!(
        r.prepare_manual_local(
            &ScheduleAuthority::local(n + 3601).unwrap(),
            &g.grant_id,
            p.revision,
            &Uuid::now_v7().to_string(),
            n + 3601
        ),
        Err(Error::GrantExpired)
    );
    assert_eq!(count(&r, "chat_scheduled_runs"), 0);
    assert_eq!(count(&r, "chat_outbox"), 0);
}

#[cfg(target_os = "macos")]
#[test]
fn feat155_3b1_existing_user_directory_and_transaction_rollback_after_reservation() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::CompatibleReader);
    assert_eq!(r.schema_version().unwrap(), 15);
    let dir = root.0.join("user-project");
    std::fs::create_dir(&dir).unwrap();
    let selection = crate::chat::native_project::create_selection(&dir)
        .unwrap()
        .unwrap();
    let project = r
        .register_project(&selection.canonical_path, &selection.bookmark)
        .unwrap();
    let chat = r
        .create_session_and_enqueue_multimodal(
            Uuid::parse_str(&project.id).unwrap(),
            &[DraftContentBlock::Text("普通聊天".into())],
            Uuid::now_v7(),
            1,
        )
        .unwrap();
    drop(r);
    let mut r = open(&root.0, ScheduleStorageMode::ExecutionFoundation);
    let (p, _, g) = confirmed(
        &mut r,
        TargetMode::ExistingChat,
        Some(chat.session_id.to_string()),
        n,
        2,
    );
    let original_bookmark = r.project_bookmark(&project.id).unwrap();
    drop(r);
    let r = open(&root.0, ScheduleStorageMode::LocalPreparation);
    assert_eq!(r.schema_version().unwrap(), 18);
    assert_eq!(r.project_bookmark(&project.id).unwrap(), original_bookmark);
    assert_eq!(grant(&r.connection, &r.scope, &g.grant_id, n).unwrap(), g);
    assert_eq!(count(&r, "chat_messages"), 1);
    assert_eq!(count(&r, "chat_turns"), 1);
    assert_eq!(count(&r, "chat_outbox"), 1);
    drop(r);
    let reader = open(&root.0, ScheduleStorageMode::CompatibleReader);
    assert_eq!(reader.schema_version().unwrap(), 18);
    assert_eq!(
        reader
            .load_history(chat.session_id, None, Some(20))
            .unwrap()
            .turns
            .len(),
        1
    );
    drop(reader);
    let mut r = open(&root.0, ScheduleStorageMode::LocalPreparation);
    let a = ScheduleAuthority::local(n).unwrap();
    assert_eq!(g.workspace.source, WorkspaceSource::UserProject);
    assert_eq!(
        r.prepare_manual_local(&a, &g.grant_id, p.revision, &Uuid::now_v7().to_string(), n),
        Err(Error::ReservationBusy)
    );
    // A normal cancelled, never-bound local chat is not a usable Host target.
    r.connection
        .execute("UPDATE chat_public_task_bindings SET state='failed',last_error_code='chat_conflict',lease_expires_at=NULL", [])
        .unwrap();
    r.connection
        .execute("UPDATE chat_outbox SET state='failed'", [])
        .unwrap();
    r.connection
        .execute(
            "UPDATE chat_turns SET status='failed',submission_status='failed'",
            [],
        )
        .unwrap();
    let before = count(&r, "chat_outbox");
    assert_eq!(
        r.prepare_manual_local(&a, &g.grant_id, p.revision, &Uuid::now_v7().to_string(), n),
        Err(Error::ReservationBusy)
    );
    assert_eq!(count(&r, "chat_scheduled_runs"), 0);
    assert_eq!(count(&r, "chat_scheduled_reservation"), 0);
    assert_eq!(count(&r, "chat_outbox"), before);
    assert_eq!(
        grant(&r.connection, &r.scope, &g.grant_id, n)
            .unwrap()
            .occupied_runs,
        0
    );
    // Separately declare an ordinary existing bound-chat fixture, not a real run.
    r.connection
        .execute("UPDATE chat_public_task_bindings SET state='inflight',lease_expires_at=created_at+30,last_error_code=NULL", [])
        .unwrap();
    r.connection
        .execute(
            "UPDATE chat_outbox SET state='inflight' WHERE operation_id=?1",
            [chat.create_operation_id.to_string()],
        )
        .unwrap();
    r.bind_public_task(chat.create_operation_id, chat.task_id, n)
        .unwrap();
    r.bind_host_session_and_enqueue_turn(
        chat.create_operation_id,
        chat.task_id,
        Uuid::now_v7(),
        Uuid::now_v7(),
    )
    .unwrap();
    r.connection
        .execute("UPDATE chat_outbox SET state='done'", [])
        .unwrap();
    let run = r
        .prepare_manual_local(&a, &g.grant_id, p.revision, &Uuid::now_v7().to_string(), n)
        .unwrap();
    assert_eq!(binding(&r, &run).0, chat.session_id.to_string());
    assert_eq!(binding(&r, &run).1, project.id);
    assert_eq!(
        r.resolve_schedule_project(&project.id).unwrap(),
        selection.canonical_path
    );
    assert_eq!(r.list_projects().unwrap().len(), 1);
}

#[tokio::test]
async fn feat155_3b1_native_worker_service_prepares_once_without_enabling_run() {
    use crate::chat::keychain::{DatabaseKeyStore, ReceiptKeyStore};
    use crate::local_profile::LocalRuntimeProfile;
    struct Keys;
    impl DatabaseKeyStore for Keys {
        fn load_or_create(&self, _: bool) -> Result<DatabaseKey, ChatError> {
            Ok(DatabaseKey::from_bytes([155; 32]))
        }
    }
    impl ReceiptKeyStore for Keys {
        fn load_or_create(&self, _: bool) -> Result<ReceiptKey, ChatError> {
            Ok(ReceiptKey::from_bytes([156; 32]))
        }
    }
    let root = Temp::new();
    let n = now().unwrap();
    let scope = ChatScope::new(DEMO_FAST_OWNER_USER_ID.into(), DEMO_FAST_TENANT_ID.into()).unwrap();
    let worker = DatabaseWorker::start_with_schedule_storage(
        root.0.join("chat"),
        scope.clone(),
        Box::new(Keys),
        Box::new(Keys),
        ScheduleStorageMode::LocalPreparation,
    )
    .unwrap();
    let (p, _, g) = worker
        .call(move |r| Ok(confirmed(r, TargetMode::DedicatedChat, None, n, 2)))
        .await
        .unwrap();
    let service = ScheduleExecutionService::new(
        worker.clone(),
        NativeAuthRuntime::from_environment_with_test_profile(
            None,
            false,
            LocalRuntimeProfile::DemoFast,
        ),
        ChatAuthorizationManager::new(&scope).unwrap(),
    );
    assert_eq!(
        service.check_run(g.grant_id.clone(), p.revision).await,
        Err(Error::ExecutionNotReady)
    );
    let request = Uuid::now_v7().to_string();
    let (a, b) = tokio::join!(
        service.prepare_manual(g.grant_id.clone(), p.revision, request.clone()),
        service.prepare_manual(g.grant_id.clone(), p.revision, request)
    );
    assert_eq!(a.unwrap(), b.unwrap());
    worker
        .call(move |r| {
            assert_eq!(count(r, "chat_scheduled_runs"), 1);
            assert!(r
                .claim_next_conversation_outbox(now().unwrap(), 30)?
                .is_none());
            Ok(())
        })
        .await
        .unwrap();
    drop(service);
    drop(worker);
}

fn recovery_fixture(r: &mut ChatRepository, n: i64) -> (RunView, Uuid, Uuid, Uuid) {
    use crate::chat::schedules::recovery_generated::*;
    let (p, _, g) = confirmed(r, TargetMode::DedicatedChat, None, n, 3);
    let a = ScheduleAuthority::local(n).unwrap();
    let run = r
        .prepare_manual_local(&a, &g.grant_id, p.revision, &Uuid::now_v7().to_string(), n)
        .unwrap();
    let (chat, _, create, local) = binding(r, &run);
    let task = Uuid::now_v7();
    let session = Uuid::now_v7();
    let thread = Uuid::now_v7();
    let create = create.unwrap();
    r.connection.execute("UPDATE chat_public_task_bindings SET state='inflight',lease_expires_at=created_at+30,last_error_code=NULL WHERE create_operation_id=?1",[&create]).unwrap();
    r.bind_public_task(Uuid::parse_str(&create).unwrap(), task, n)
        .unwrap();
    r.apply_schedule_mapping(
        &a,
        &run.run_id,
        &SessionMapping {
            task_id: task.to_string(),
            agent_session_id: session.to_string(),
            mapping_state: MappingState::Bound,
            codex_thread_id: Some(thread.to_string()),
            responding_host_instance_id: Some(Uuid::now_v7().to_string()),
        },
        n,
    )
    .unwrap();
    let rt = Uuid::now_v7();
    r.apply_schedule_operation(
        &a,
        &run.run_id,
        &TurnOperationResult {
            agent_session_id: session.to_string(),
            operation_id: run.operation_id.clone(),
            state: OperationState::Accepted,
            turn_id: Some(rt.to_string()),
            responding_host_instance_id: Some(Uuid::now_v7().to_string()),
        },
        n,
    )
    .unwrap();
    assert!(r
        .native_host_origin(
            Uuid::parse_str(&chat).unwrap(),
            Uuid::parse_str(&local).unwrap()
        )
        .unwrap()
        .is_none());
    (run, Uuid::parse_str(&chat).unwrap(), rt, thread)
}
#[test]
fn feat155_3b2_forward_reader_keeps_old_unknown_and_default_15() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::LocalPreparation);
    let (p, _, g) = confirmed(&mut r, TargetMode::DedicatedChat, None, n, 3);
    let run = r
        .prepare_manual_local(
            &ScheduleAuthority::local(n).unwrap(),
            &g.grant_id,
            p.revision,
            &Uuid::now_v7().to_string(),
            n,
        )
        .unwrap();
    drop(r);
    let r = open(&root.0, ScheduleStorageMode::RecoveryFoundation);
    assert_eq!(r.schema_version().unwrap(), 19);
    let attempts: (String, String) = r
        .connection
        .query_row(
            "SELECT create_attempt,turn_attempt FROM chat_scheduled_recovery WHERE run_id=?1",
            [&run.run_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(attempts, ("unknown".into(), "unknown".into()));
    drop(r);
    let mut r = open(&root.0, ScheduleStorageMode::CompatibleReader);
    assert_eq!(r.schema_version().unwrap(), 19);
    assert!(r
        .cancel_unsent_schedule(&ScheduleAuthority::local(n).unwrap(), &run.run_id, n)
        .is_err());
    assert!(guard::held(&r.connection).unwrap());
    finished_fixture(&mut r, &run, n);
    assert!(
        r.scheduled_recovery_candidate(&ScheduleAuthority::local(n).unwrap(), n)
            .unwrap()
            .is_none(),
        "closed old history must not be reopened by recovery"
    );
    let empty = Temp::new();
    assert_eq!(
        open(&empty.0, ScheduleStorageMode::CompatibleReader)
            .schema_version()
            .unwrap(),
        15
    );
}
#[test]
fn feat155_3b2_cancel_never_sent_is_atomic_and_refunds_once() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::RecoveryFoundation);
    let (p, _, g) = confirmed(&mut r, TargetMode::DedicatedChat, None, n, 3);
    let a = ScheduleAuthority::local(n).unwrap();
    let run = r
        .prepare_manual_local(&a, &g.grant_id, p.revision, &Uuid::now_v7().to_string(), n)
        .unwrap();
    r.cancel_unsent_schedule(&a, &run.run_id, n).unwrap();
    r.cancel_unsent_schedule(&a, &run.run_id, n).unwrap();
    assert!(!guard::held(&r.connection).unwrap());
    assert!(!guard::foreground_busy(&r.connection).unwrap());
    assert_eq!(
        grant(&r.connection, &r.scope, &g.grant_id, n)
            .unwrap()
            .occupied_runs,
        0
    );
    assert!(r.claim_next_conversation_outbox(n, 30).unwrap().is_none());
}
#[test]
fn feat155_3b2_native_read_terminal_releases_in_original_fact_transaction() {
    use crate::chat::native_conversation_generated::{NativeThreadSnapshot, NativeTurn};
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::RecoveryFoundation);
    let (run, chat, rt, thread) = recovery_fixture(&mut r, n);
    let (_, _, _, local) = binding(&r, &run);
    let local = Uuid::parse_str(&local).unwrap();
    let snapshot = NativeThreadSnapshot {
        schema_version: 2,
        source: "runtime_read".into(),
        thread_id: thread.to_string(),
        turns: vec![NativeTurn {
            id: rt.to_string(),
            status: Some("failed".into()),
            error_code: None,
            items: vec![],
            items_complete: false,
            error: None,
        }],
        availability: "partial".into(),
    };
    r.native_recovery_views(chat, &[local], Some(&snapshot), true)
        .unwrap();
    assert!(!guard::held(&r.connection).unwrap());
    assert!(!guard::foreground_busy(&r.connection).unwrap());
    let state: (String, String) = r
        .connection
        .query_row(
            "SELECT delivery_state,native_outcome FROM chat_scheduled_runs WHERE run_id=?1",
            [&run.run_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(state, ("terminal".into(), "failed".into()));
    assert_eq!(count(&r, "chat_native_facts"), 1);
}
#[test]
fn feat155_3b2_stopped_unknown_releases_index_without_changing_history_or_quota() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::RecoveryFoundation);
    let (run, chat, _, _) = recovery_fixture(&mut r, n);
    let a = ScheduleAuthority::local(n).unwrap();
    let current = Uuid::now_v7().to_string();
    r.release_stopped_schedule(&a, &run.run_id, &current, n)
        .unwrap();
    assert!(guard::held(&r.connection).unwrap());
    let interrupt = Uuid::now_v7();
    r.enqueue_interrupt(chat, interrupt).unwrap();
    r.connection
        .execute(
            "UPDATE chat_outbox SET state='inflight' WHERE operation_id=?1",
            [interrupt.to_string()],
        )
        .unwrap();
    let original = Uuid::now_v7().to_string();
    // Ordinary declared historical-send/normal-stop facts; no process is killed.
    r.connection.execute("UPDATE chat_scheduled_recovery SET create_host_instance=?2,original_host_instance=?2,create_attempt='attempted',turn_attempt='attempted' WHERE run_id=?1",params![run.run_id,original]).unwrap();
    r.record_stopped_schedule_generation(&original).unwrap();
    r.release_stopped_schedule(&a, &run.run_id, &current, n)
        .unwrap();
    assert!(r.guard_conversation_dispatch(interrupt).is_err());
    assert!(!guard::held(&r.connection).unwrap());
    assert!(!guard::foreground_busy(&r.connection).unwrap());
    assert!(r.recovery_snapshot().unwrap().active_session_ids.is_empty());
    assert!(!r.permission_state(Some(chat)).unwrap().busy);
    r.release_stopped_schedule(&a, &run.run_id, &current, n)
        .unwrap();
    assert!(r.active_turn_context(chat).is_err());
    assert!(r.enqueue_interrupt(chat, Uuid::now_v7()).is_err());
    let (_, _, _, local) = binding(&r, &run);
    let state:(String,String,i64)=r.connection.query_row("SELECT r.delivery_state,t.status,g.occupied_runs FROM chat_scheduled_runs r JOIN chat_scheduled_run_bindings b ON b.run_id=r.run_id JOIN chat_turns t ON t.id=b.local_turn_id JOIN chat_scheduled_grants g ON g.grant_id=r.grant_id WHERE r.run_id=?1",[&run.run_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
    assert_eq!(state, ("uncertain".into(), "streaming".into(), 1));
    assert!(r.claim_next_conversation_outbox(n, 30).unwrap().is_none());
    // Reuse the existing ordinary submission API: the old index must no longer
    // occupy this chat, while the unknown row remains present and unchanged.
    let next = r.enqueue_turn(chat, "正常下一轮", Uuid::now_v7()).unwrap();
    assert_ne!(next.to_string(), local);
    assert!(guard::foreground_busy(&r.connection).unwrap());
    drop(r);
    let r = open(&root.0, ScheduleStorageMode::CompatibleReader);
    assert!(guard::foreground_busy(&r.connection).unwrap());
}
#[test]
fn feat155_3b2_recovery_reads_survive_grant_expiry_and_reject_different_identity() {
    use crate::chat::schedules::recovery_generated::*;
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::RecoveryFoundation);
    let (run, _, rt, _) = recovery_fixture(&mut r, n);
    let later = n + 7200;
    let a = ScheduleAuthority::local(later).unwrap();
    let c = r.scheduled_recovery_candidate(&a, later).unwrap().unwrap();
    let mut receipt = TurnOperationResult {
        agent_session_id: c.session.unwrap().to_string(),
        operation_id: run.operation_id.clone(),
        state: OperationState::Accepted,
        turn_id: Some(rt.to_string()),
        responding_host_instance_id: None,
    };
    r.apply_schedule_operation(&a, &run.run_id, &receipt, later)
        .unwrap();
    let mut pending = receipt.clone();
    pending.state = OperationState::Pending;
    pending.turn_id = None;
    r.apply_schedule_operation(&a, &run.run_id, &pending, later)
        .unwrap();
    assert!(r.cancel_unsent_schedule(&a, &run.run_id, later).is_err());
    assert_eq!(
        r.scheduled_recovery_candidate(&a, later)
            .unwrap()
            .unwrap()
            .runtime_turn,
        Some(rt)
    );
    let attempt: String = r
        .connection
        .query_row(
            "SELECT turn_attempt FROM chat_scheduled_recovery WHERE run_id=?1",
            [&run.run_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(attempt, "attempted");
    receipt.turn_id = Some(Uuid::now_v7().to_string());
    assert!(r
        .apply_schedule_operation(&a, &run.run_id, &receipt, later)
        .is_err());
    assert!(guard::held(&r.connection).unwrap());
}

#[test]
fn feat155_3b2_released_queued_history_is_not_cancelled_by_deletion() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::RecoveryFoundation);
    let (run, chat, _, _) = recovery_fixture(&mut r, n);
    let a = ScheduleAuthority::local(n).unwrap();
    let (_, _, _, local) = binding(&r, &run);
    // Declared unknown submission with a known, normally stopped owner generation.
    let old = Uuid::now_v7().to_string();
    r.connection.execute("UPDATE chat_scheduled_recovery SET create_attempt='attempted',create_host_instance=?2,turn_attempt='attempted',original_host_instance=?2 WHERE run_id=?1",params![run.run_id,old]).unwrap();
    r.connection
        .execute(
            "UPDATE chat_turns SET status='queued',submission_status='uncertain' WHERE id=?1",
            [&local],
        )
        .unwrap();
    r.record_stopped_schedule_generation(&old).unwrap();
    r.release_stopped_schedule(&a, &run.run_id, &Uuid::now_v7().to_string(), n)
        .unwrap();
    let deletion = Uuid::now_v7();
    r.begin_session_deletion(chat, deletion, n).unwrap();
    let submission: String = r
        .connection
        .query_row(
            "SELECT submission_status FROM chat_turns WHERE id=?1",
            [&local],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(submission, "uncertain");
    assert!(r.claim_next_deletion(n, 30).unwrap().is_some());
    assert!(r.claim_next_conversation_outbox(n, 30).unwrap().is_none());
}

#[test]
fn feat155_3c2_schema21_reopens_old_manual_receipts_and_chat_without_activation() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::DispatchFoundation);
    let a = ScheduleAuthority::local(n).unwrap();
    let (p, _, g) = confirmed(&mut r, TargetMode::DedicatedChat, None, n, 1);
    let request = Uuid::now_v7().to_string();
    let run = r
        .prepare_manual_local(&a, &g.grant_id, p.revision, &request, n)
        .unwrap();
    let hash: String = r
        .connection
        .query_row(
            "SELECT request_digest FROM chat_scheduled_runs WHERE run_id=?1",
            [&run.run_id],
            |r| r.get(0),
        )
        .unwrap();
    let before = count(&r, "chat_sessions");
    drop(r);
    let mut r = open(&root.0, ScheduleStorageMode::TriggerFoundation);
    assert_eq!(r.schema_version().unwrap(), 21);
    assert_eq!(
        r.prepare_manual_local(&a, &g.grant_id, p.revision, &request, n)
            .unwrap(),
        run
    );
    assert_eq!(
        r.connection
            .query_row(
                "SELECT request_digest FROM chat_scheduled_runs WHERE run_id=?1",
                [&run.run_id],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        hash
    );
    assert_eq!(count(&r, "chat_sessions"), before);
    assert_eq!(count(&r, "chat_scheduled_trigger_facts"), 0);
    drop(r);
    let mut reader = open(&root.0, ScheduleStorageMode::CompatibleReader);
    assert_eq!(reader.schema_version().unwrap(), 21);
    assert_eq!(reader.read_scheduled_run(&a, &run.run_id, n).unwrap(), run);
    assert!(reader
        .claim_next_conversation_outbox(n, 10)
        .unwrap()
        .is_none());
    assert_eq!(
        reader.prepare_manual_local(&a, &g.grant_id, p.revision, &request, n),
        Err(Error::StorageDisabled)
    );
    let fresh = Temp::new();
    let normal = open(&fresh.0, ScheduleStorageMode::CompatibleReader);
    assert_eq!(normal.schema_version().unwrap(), 15);
}

#[path = "timing_tests.rs"]
mod timing_tests;
