use super::*;
use crate::chat::schedules::{
    generated::{PlanDefinition, SavePlanRequest, TargetReference, TimeRule, TimeRuleFrequency},
    ScheduleStorageMode,
};
use crate::chat::{
    database::{DraftContentBlock, PendingConversation},
    error::ChatError,
    keychain::{DatabaseKey, DatabaseKeyStore, ReceiptKey, ReceiptKeyStore},
    runtime_permissions::PermissionMode,
};
use crate::local_profile::{LocalRuntimeProfile, DEMO_FAST_OWNER_USER_ID, DEMO_FAST_TENANT_ID};
use std::path::{Path, PathBuf};

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("feat155-3a-{}", Uuid::now_v7()));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}
fn scope() -> ChatScope {
    ChatScope::new(DEMO_FAST_OWNER_USER_ID.into(), DEMO_FAST_TENANT_ID.into()).unwrap()
}
fn open(root: &Path, mode: ScheduleStorageMode) -> ChatRepository {
    ChatRepository::open_with_schedule_storage(
        &root.join("chat"),
        &DatabaseKey::from_bytes([155; 32]),
        ReceiptKey::from_bytes([156; 32]),
        scope(),
        mode,
    )
    .unwrap()
}
fn request() -> SavePlanRequest {
    SavePlanRequest {
        request_id: Uuid::now_v7().to_string(),
        plan_id: None,
        expected_revision: None,
        definition: PlanDefinition {
            name: "合成定时计划".into(),
            content: "只验证本地数据".into(),
            rule: TimeRule {
                frequency: TimeRuleFrequency::Daily,
                time_zone: "Asia/Shanghai".into(),
                local_time: "09:00".into(),
                local_date: None,
                weekdays: None,
            },
            target: TargetReference {
                mode: TargetMode::DedicatedChat,
                conversation_id: None,
            },
        },
    }
}
fn confirmation(p: &PlanView, n: i64) -> GrantConfirmation {
    GrantConfirmation {
        request_id: Uuid::now_v7().to_string(),
        plan_id: p.plan_id.clone(),
        expected_revision: p.revision,
        max_runs: 2,
        expires_at: n + 3600,
    }
}
fn count(repo: &ChatRepository, table: &str) -> i64 {
    repo.connection
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
fn project(repo: &mut ChatRepository, root: &Path) -> Uuid {
    let p = root.join("project");
    std::fs::create_dir_all(&p).unwrap();
    Uuid::parse_str(
        &repo
            .register_project(&p, b"normal-synthetic-bookmark")
            .unwrap()
            .id,
    )
    .unwrap()
}
fn grant_plan(
    repo: &mut ChatRepository,
    n: i64,
) -> (ScheduleAuthority, GrantConfirmation, GrantView) {
    let a = ScheduleAuthority::local(n).unwrap();
    let p = repo.save_schedule(request(), n).unwrap();
    let c = confirmation(&p, n);
    let g = repo.confirm_schedule_grant(&a, c.clone(), n).unwrap();
    (a, c, g)
}
fn reserve(
    repo: &mut ChatRepository,
    a: &ScheduleAuthority,
    g: &GrantView,
    r: &str,
    n: i64,
) -> Result<RunView, Error> {
    let owner = repo.scope.clone();
    let tx = repo.connection.transaction().unwrap();
    let v = reserve_in_transaction(&tx, &owner, a, &g.grant_id, g.plan_revision, r, n)?;
    tx.commit().unwrap();
    Ok(v)
}
fn idle_chat(repo: &mut ChatRepository, root: &Path) -> PendingConversation {
    let project = project(repo, root);
    let p = repo
        .create_session_and_enqueue_multimodal(
            project,
            &[DraftContentBlock::Text("普通合成历史".into())],
            Uuid::now_v7(),
            1,
        )
        .unwrap();
    let n = now().unwrap();
    repo.claim_next_conversation_outbox(n, 30).unwrap().unwrap();
    repo.bind_public_task(p.create_operation_id, p.task_id, n)
        .unwrap();
    repo.bind_host_session_and_enqueue_turn(
        p.create_operation_id,
        p.task_id,
        Uuid::now_v7(),
        Uuid::now_v7(),
    )
    .unwrap();
    let n = now().unwrap(); // bind enqueues using the actual current second
    repo.claim_next_conversation_outbox(n, 30).unwrap().unwrap();
    repo.record_failed_start_turn_submission(p.turn_operation_id, n)
        .unwrap();
    p
}

#[test]
fn feat155_3a_reader_15_16_17_and_disabled_writer_preserve_old_chat() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::CompatibleReader);
    assert_eq!(r.schema_version().unwrap(), 15);
    let chat = idle_chat(&mut r, &root.0);
    drop(r);
    let r = open(&root.0, ScheduleStorageMode::PlanWriter);
    assert_eq!(r.schema_version().unwrap(), 16);
    drop(r);
    let mut r = open(&root.0, ScheduleStorageMode::ExecutionFoundation);
    assert_eq!(r.schema_version().unwrap(), 17);
    let (a, c, g) = grant_plan(&mut r, n);
    assert_eq!(
        r.read_schedule(&g.plan_id).unwrap().state,
        PlanState::Paused
    );
    drop(r);
    let mut r = open(&root.0, ScheduleStorageMode::CompatibleReader);
    assert_eq!(r.schema_version().unwrap(), 17);
    assert_eq!(grant(&r.connection, &r.scope, &g.grant_id, n).unwrap(), g);
    assert_eq!(
        r.confirm_schedule_grant(&a, c, n),
        Err(Error::StorageDisabled)
    );
    r.rename_session(chat.session_id, "旧聊天保持可用").unwrap();
    assert_eq!(
        r.session_summary(chat.session_id).unwrap().title,
        "旧聊天保持可用"
    );
    assert_eq!(count(&r, "chat_scheduled_runs"), 0);
    assert!(!guard::held(&r.connection).unwrap());
    assert_eq!(
        r.connection
            .query_row("SELECT count(*) FROM chat_schema_migrations", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        17
    );
}
#[test]
fn feat155_3a_grants_are_finite_scoped_idempotent_and_do_not_enable() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::ExecutionFoundation);
    let (mut a, c, g) = grant_plan(&mut r, n);
    assert_eq!(r.confirm_schedule_grant(&a, c.clone(), n + 1).unwrap(), g);
    let mut changed = c.clone();
    changed.max_runs += 1;
    assert_eq!(
        r.confirm_schedule_grant(&a, changed, n),
        Err(Error::RequestConflict)
    );
    for quota in [0, -1, 2147483648] {
        let mut invalid = c.clone();
        invalid.max_runs = quota;
        assert_eq!(
            r.confirm_schedule_grant(&a, invalid, n),
            Err(Error::InvalidInput)
        );
    }
    let mut invalid = c.clone();
    invalid.expires_at = n;
    assert_eq!(
        r.confirm_schedule_grant(&a, invalid, n),
        Err(Error::InvalidInput)
    );
    a.tenant = Uuid::now_v7().to_string();
    assert_eq!(
        r.confirm_schedule_grant(&a, c.clone(), n),
        Err(Error::ScopeDenied)
    );
    a = ScheduleAuthority::local(n).unwrap();
    a.capabilities = vec![ScheduleCapability::ScheduleRead];
    assert_eq!(r.confirm_schedule_grant(&a, c, n), Err(Error::ScopeDenied));
    assert_eq!(count(&r, "chat_scheduled_grants"), 1);
    assert_eq!(count(&r, "chat_scheduled_runs"), 0);
    assert_eq!(count(&r, "chat_outbox"), 0);
    assert_eq!(
        r.read_schedule(&g.plan_id).unwrap().state,
        PlanState::Paused
    );
}
#[test]
fn feat155_3a_revalidate_revision_authority_target_and_expiry() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::ExecutionFoundation);
    let (a, c, g) = grant_plan(&mut r, n);
    assert_eq!(
        validate_grant(&r.connection, &r.scope, &a, &g.grant_id, 2, n).unwrap_err(),
        Error::RevisionConflict
    );
    let expired = ScheduleAuthority::local(n + 3600).unwrap();
    assert_eq!(
        validate_grant(&r.connection, &r.scope, &expired, &g.grant_id, 1, n + 3600).unwrap_err(),
        Error::GrantExpired
    );
    assert_eq!(
        validate_grant(&r.connection, &r.scope, &a, &g.grant_id, 1, n + 240).unwrap_err(),
        Error::ScopeDenied
    );
    let mut changed = ScheduleAuthority::local(n).unwrap();
    changed.revision = 2;
    assert_eq!(
        validate_grant(&r.connection, &r.scope, &changed, &g.grant_id, 1, n).unwrap_err(),
        Error::GrantStale
    );
    let mut edit = request();
    edit.plan_id = Some(g.plan_id.clone());
    edit.expected_revision = Some(1);
    edit.definition.content = "修改内容后的合成计划".into();
    r.save_schedule(edit, n + 1).unwrap();
    assert_eq!(
        validate_grant(&r.connection, &r.scope, &a, &g.grant_id, 1, n + 1).unwrap_err(),
        Error::GrantStale
    );
    assert_eq!(
        r.confirm_schedule_grant(&a, c, n + 1).unwrap().state,
        GrantState::Stale
    );
    assert!(r
        .read_schedule(&g.plan_id)
        .unwrap()
        .authorization_ref
        .is_none());
}
#[test]
fn feat155_3a_reservation_atomic_rollback_duplicate_and_quota() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::ExecutionFoundation);
    let (a, _, g) = grant_plan(&mut r, n);
    let rid = Uuid::now_v7().to_string();
    {
        let tx = r.connection.transaction().unwrap();
        reserve_in_transaction(&tx, &scope(), &a, &g.grant_id, 1, &rid, n).unwrap();
        tx.rollback().unwrap();
    }
    assert_eq!(count(&r, "chat_scheduled_runs"), 0);
    assert_eq!(
        grant(&r.connection, &r.scope, &g.grant_id, n)
            .unwrap()
            .occupied_runs,
        0
    );
    let run = reserve(&mut r, &a, &g, &rid, n).unwrap();
    assert_eq!(reserve(&mut r, &a, &g, &rid, n + 1).unwrap(), run);
    assert_eq!(
        reserve(&mut r, &a, &g, &Uuid::now_v7().to_string(), n),
        Err(Error::ReservationBusy)
    );
    assert_eq!(
        grant(&r.connection, &r.scope, &g.grant_id, n)
            .unwrap()
            .occupied_runs,
        1
    );
    assert_eq!(count(&r, "chat_scheduled_runs"), 1);
    assert_eq!(count(&r, "chat_scheduled_reservation"), 1);
    assert_eq!(count(&r, "chat_sessions"), 0);
    assert_eq!(count(&r, "chat_outbox"), 0);
    assert_eq!(run.permission_mode, RunViewPermissionMode::Ask);
    assert_eq!(
        run.delivery_state,
        super::super::execution_generated::DeliveryState::Reserved
    );
    // An ordinary completed ledger fixture consumes its quota permanently.
    r.connection.execute("UPDATE chat_scheduled_runs SET delivery_state='terminal',native_outcome='completed' WHERE run_id=?1",[run.run_id]).unwrap();
    r.connection
        .execute("DELETE FROM chat_scheduled_reservation", [])
        .unwrap();
    reserve(&mut r, &a, &g, &Uuid::now_v7().to_string(), n + 2).unwrap();
    assert_eq!(
        validate_grant(&r.connection, &r.scope, &a, &g.grant_id, 1, n + 2).unwrap_err(),
        Error::GrantExhausted
    );
}
#[test]
fn feat155_3a_shared_reservation_blocks_all_foreground_submit_paths() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::ExecutionFoundation);
    let chat = idle_chat(&mut r, &root.0);
    let pid = project(&mut r, &root.0);
    r.set_permission_mode(None, PermissionMode::Full, true)
        .unwrap();
    let (a, _, g) = grant_plan(&mut r, n);
    reserve(&mut r, &a, &g, &Uuid::now_v7().to_string(), n).unwrap();
    assert_eq!(r.permission_state(None).unwrap().mode, PermissionMode::Full);
    assert!(matches!(
        r.create_session_and_enqueue(pid, "草稿保持", Uuid::now_v7()),
        Err(ChatError::ConversationConflict)
    ));
    assert!(matches!(
        r.create_session_and_enqueue_multimodal(
            pid,
            &[DraftContentBlock::Text("草稿保持".into())],
            Uuid::now_v7(),
            1
        ),
        Err(ChatError::ConversationConflict)
    ));
    assert!(matches!(
        r.enqueue_turn(chat.session_id, "草稿保持", Uuid::now_v7()),
        Err(ChatError::ConversationConflict)
    ));
    assert!(matches!(
        r.enqueue_turn_multimodal(
            chat.session_id,
            &[DraftContentBlock::Text("草稿保持".into())],
            Uuid::now_v7()
        ),
        Err(ChatError::ConversationConflict)
    ));
    assert_eq!(r.permission_state(None).unwrap().mode, PermissionMode::Full);
    assert_eq!(count(&r, "chat_sessions"), 1);
}
#[test]
fn feat155_3a_foreground_queued_and_create_inflight_win_the_same_writer() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::ExecutionFoundation);
    let (a, _, g) = grant_plan(&mut r, n);
    let p = project(&mut r, &root.0);
    let pending = r
        .create_session_and_enqueue(p, "普通前台", Uuid::now_v7())
        .unwrap();
    assert_eq!(
        reserve(&mut r, &a, &g, &Uuid::now_v7().to_string(), n),
        Err(Error::ReservationBusy)
    );
    let claimed = r
        .claim_next_conversation_outbox(now().unwrap(), 30)
        .unwrap()
        .unwrap();
    assert_eq!(claimed.operation_id, pending.create_operation_id);
    assert_eq!(
        reserve(&mut r, &a, &g, &Uuid::now_v7().to_string(), n),
        Err(Error::ReservationBusy)
    );
    assert!(r.guard_conversation_dispatch(claimed.operation_id).is_ok());
    assert_eq!(
        grant(&r.connection, &r.scope, &g.grant_id, n)
            .unwrap()
            .occupied_runs,
        0
    );
}
#[test]
fn feat155_3a_reader_holds_scheduled_outbox_unknown_and_attention() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::ExecutionFoundation);
    let chat = idle_chat(&mut r, &root.0);
    let (a, _, g) = grant_plan(&mut r, n);
    let run = reserve(&mut r, &a, &g, &Uuid::now_v7().to_string(), n).unwrap();
    // Safe compatibility fixture: a marked existing outbox cannot become executable.
    r.connection.execute("UPDATE chat_outbox SET scheduled_run_id=?1,state='pending',next_attempt_at=NULL WHERE operation_id=?2",params![run.run_id,chat.turn_operation_id.to_string()]).unwrap();
    drop(r);
    let mut r = open(&root.0, ScheduleStorageMode::CompatibleReader);
    for state in ["reserved", "sending", "accepted", "uncertain", "terminal"] {
        r.connection.execute("UPDATE chat_scheduled_runs SET delivery_state=?1,needs_attention=1 WHERE run_id=?2",params![state,run.run_id]).unwrap();
        assert!(guard::held(&r.connection).unwrap());
        assert!(r
            .claim_next_conversation_outbox(n + 100, 30)
            .unwrap()
            .is_none());
        assert_eq!(
            r.guard_conversation_dispatch(chat.turn_operation_id),
            Err(ChatError::OrchestrationUnavailable)
        );
    }
    r.connection
        .execute("DELETE FROM chat_scheduled_reservation", [])
        .unwrap();
    r.connection
        .execute(
            "UPDATE chat_scheduled_runs SET delivery_state='terminal',needs_attention=0",
            [],
        )
        .unwrap();
    assert!(!guard::held(&r.connection).unwrap());
    assert!(r
        .claim_next_conversation_outbox(n + 100, 30)
        .unwrap()
        .is_none());
    assert_eq!(
        r.connection
            .query_row(
                "SELECT state FROM chat_outbox WHERE operation_id=?1",
                [chat.turn_operation_id.to_string()],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "pending"
    );
    r.connection
        .execute("UPDATE chat_scheduled_runs SET format_version=2", [])
        .unwrap();
    assert!(guard::held(&r.connection).unwrap());
    assert_eq!(
        r.read_scheduled_run(&a, &run.run_id, n),
        Err(Error::FormatUnsupported)
    );
}
#[test]
fn feat155_3a_existing_target_mode_and_scope_are_rechecked() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::ExecutionFoundation);
    let chat = idle_chat(&mut r, &root.0);
    let mut req = request();
    req.definition.target = TargetReference {
        mode: TargetMode::ExistingChat,
        conversation_id: Some(chat.session_id.to_string()),
    };
    let p = r.save_schedule(req, n).unwrap();
    let a = ScheduleAuthority::local(n).unwrap();
    let g = r
        .confirm_schedule_grant(&a, confirmation(&p, n), n)
        .unwrap();
    assert_eq!(g.workspace.source, WorkspaceSource::UserProject);
    // Ordinary permission records for the three supported modes; no I/O or Runtime.
    for mode in ["auto", "full"] {
        r.connection
            .execute(
                "UPDATE chat_task_permissions SET mode=?1 WHERE session_id=?2",
                params![mode, chat.session_id.to_string()],
            )
            .unwrap();
        assert_eq!(
            validate_grant(&r.connection, &r.scope, &a, &g.grant_id, 1, n).unwrap_err(),
            Error::PermissionDenied
        );
    }
    r.connection
        .execute("UPDATE chat_task_permissions SET mode='ask'", [])
        .unwrap();
    r.connection
        .execute("UPDATE chat_projects SET removed_at=?1", [n])
        .unwrap();
    assert_eq!(
        validate_grant(&r.connection, &r.scope, &a, &g.grant_id, 1, n).unwrap_err(),
        Error::TargetUnavailable
    );
    let foreign = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
    assert_eq!(
        grant(&r.connection, &foreign, &g.grant_id, n),
        Err(Error::NotFound)
    );
}
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
#[tokio::test]
async fn feat155_3a_native_service_never_refreshes_ui_context_or_enables_execution() {
    use crate::chat::authorization::AuthoritativeChatProjection;
    let root = Temp::new();
    let n = now().unwrap();
    let worker = DatabaseWorker::start_with_schedule_storage(
        root.0.join("chat"),
        scope(),
        Box::new(Keys),
        Box::new(Keys),
        ScheduleStorageMode::ExecutionFoundation,
    )
    .unwrap();
    let p = worker
        .call(move |r| Ok(r.save_schedule(request(), n).unwrap()))
        .await
        .unwrap();
    let ui = ChatAuthorizationManager::new(&scope()).unwrap();
    let context = ui
        .bind(
            AuthoritativeChatProjection::from_trusted_native_projection(
                Uuid::parse_str(DEMO_FAST_TENANT_ID).unwrap(),
                1,
                n + 240,
                crate::local_profile::demo_fast_capabilities(),
            )
            .unwrap(),
            n,
        )
        .unwrap();
    let auth = NativeAuthRuntime::from_environment_with_test_profile(
        None,
        false,
        LocalRuntimeProfile::DemoFast,
    );
    let service = ScheduleExecutionService::new(worker.clone(), auth, ui.clone());
    let c = confirmation(&p, n);
    let g = service
        .confirm_grant(context.context_id, c.clone())
        .await
        .unwrap();
    assert_eq!(
        service.check_run(g.grant_id.clone(), 1).await,
        Err(Error::ExecutionNotReady)
    );
    assert_eq!(service.read_grant(g.grant_id.clone()).await.unwrap(), g);
    assert_eq!(service.list_plans().await.unwrap().len(), 1);
    let managed = service
        .save_plan(context.context_id, request())
        .await
        .unwrap();
    service
        .pause_plan(
            context.context_id,
            managed.plan_id.clone(),
            managed.revision,
        )
        .await
        .unwrap();
    service
        .delete_plan(
            context.context_id,
            managed.plan_id.clone(),
            managed.revision,
        )
        .await
        .unwrap();

    assert!(ui
        .authorize(context.context_id, ChatAction::SubmitTurn, n)
        .is_ok());
    assert_eq!(
        service.confirm_grant(Uuid::now_v7(), c).await,
        Err(Error::ScopeDenied)
    );
    worker
        .call(|r| {
            assert_eq!(count(r, "chat_outbox"), 0);
            assert_eq!(count(r, "chat_scheduled_runs"), 0);
            Ok(())
        })
        .await
        .unwrap();
    // Bind a normally expired UI context without sleeping or changing system time.
    let old = ui
        .bind(
            AuthoritativeChatProjection::from_trusted_native_projection(
                Uuid::parse_str(DEMO_FAST_TENANT_ID).unwrap(),
                1,
                n - 260,
                crate::local_profile::demo_fast_capabilities(),
            )
            .unwrap(),
            n - 500,
        )
        .unwrap();
    assert_eq!(
        service.save_plan(old.context_id, request()).await,
        Err(Error::ScopeDenied)
    );
    assert_eq!(
        service.check_run(g.grant_id.clone(), 1).await,
        Err(Error::ExecutionNotReady)
    );
    assert_eq!(
        ui.authorize(old.context_id, ChatAction::SubmitTurn, n),
        Err(ChatError::ScopeDenied)
    );
    let invalid = NativeAuthRuntime::from_environment_with_test_profile(
        None,
        true,
        LocalRuntimeProfile::DemoFast,
    );
    assert!(matches!(
        invalid.schedule_authority(n),
        Err(Error::ScopeDenied)
    ));
    drop(service);
    drop(worker);
}
#[test]
fn feat155_3a_native_outputs_and_closed_json_match_source() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::ExecutionFoundation);
    let (a, c, g) = grant_plan(&mut r, n);
    let v = reserve(&mut r, &a, &g, &Uuid::now_v7().to_string(), n).unwrap();
    if let Some(path) = std::env::var_os("YIJIE_FEAT155_CONFORMANCE_DIR") {
        let path = PathBuf::from(path);
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(
            path.join("phase-3a-native-producer.json"),
            serde_json::to_vec_pretty(
                &serde_json::json!({"GrantConfirmation":c,"GrantView":g,"RunView":v}),
            )
            .unwrap(),
        )
        .unwrap();
    }
    let mut value = serde_json::to_value(&c).unwrap();
    value["tenant_id"] = serde_json::json!(Uuid::now_v7());
    assert!(serde_json::from_value::<GrantConfirmation>(value).is_err());
    let mut value = serde_json::to_value(&v).unwrap();
    value["original_run_id"] = serde_json::Value::Null;
    assert!(serde_json::from_value::<RunView>(value).is_err());
    assert!(!format!("{:?}", c).contains(&c.plan_id));
}

#[test]
fn feat155_3a_pending_approval_uncertainty_and_foreground_parity() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::ExecutionFoundation);
    let chat = idle_chat(&mut r, &root.0);
    let (a, _, g) = grant_plan(&mut r, n);
    // Ordinary persisted observations, not an injected Runtime failure.
    for (status, submission) in [
        ("streaming", "submitted"),
        ("stopping", "submitted"),
        ("queued", "uncertain"),
    ] {
        r.connection
            .execute(
                "UPDATE chat_turns SET status=?1,submission_status=?2 WHERE id=?3",
                params![status, submission, chat.turn_id.to_string()],
            )
            .unwrap();
        assert_eq!(
            reserve(&mut r, &a, &g, &Uuid::now_v7().to_string(), n),
            Err(Error::ReservationBusy)
        );
    }
    r.connection
        .execute(
            "UPDATE chat_turns SET status='queued',submission_status='failed' WHERE id=?1",
            [chat.turn_id.to_string()],
        )
        .unwrap();
    assert_eq!(
        grant(&r.connection, &r.scope, &g.grant_id, n)
            .unwrap()
            .occupied_runs,
        0
    );
    let pid = project(&mut r, &root.0);
    // Without a scheduled reservation, ordinary foreground/foreground semantics stay intact.
    r.create_session_and_enqueue(pid, "前台一", Uuid::now_v7())
        .unwrap();
    r.create_session_and_enqueue(pid, "前台二", Uuid::now_v7())
        .unwrap();
    assert_eq!(count(&r, "chat_sessions"), 3);
}

#[test]
fn feat155_3a_deletion_pending_does_not_release_foreground_inflight() {
    let root = Temp::new();
    let n = now().unwrap();
    let mut r = open(&root.0, ScheduleStorageMode::ExecutionFoundation);
    let chat = idle_chat(&mut r, &root.0);
    let (a, _, g) = grant_plan(&mut r, n);
    let op = Uuid::now_v7();
    r.enqueue_turn_multimodal(
        chat.session_id,
        &[DraftContentBlock::Text("普通合成后续".into())],
        op,
    )
    .unwrap();
    r.claim_next_conversation_outbox(now().unwrap(), 30)
        .unwrap()
        .unwrap();
    assert!(r.guard_conversation_dispatch(op).is_ok());
    r.begin_session_deletion(chat.session_id, Uuid::now_v7(), now().unwrap())
        .unwrap();
    assert_eq!(
        r.guard_conversation_dispatch(op),
        Err(ChatError::ConversationConflict)
    );
    assert_eq!(
        reserve(&mut r, &a, &g, &Uuid::now_v7().to_string(), n),
        Err(Error::ReservationBusy)
    );
    assert_eq!(
        grant(&r.connection, &r.scope, &g.grant_id, n)
            .unwrap()
            .occupied_runs,
        0
    );
}
