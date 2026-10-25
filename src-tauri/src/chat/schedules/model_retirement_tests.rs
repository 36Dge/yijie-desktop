use super::execution_generated::ExecutionErrorCode as Error;
// Ordinary historical-state fixtures and domain transitions, no network or fault injection.
use super::{
    execution, execution_generated::*, generated::*, model_retirement::*, store, ScheduleAuthority,
    ScheduleStorageMode,
};
use crate::chat::{ChatRepository, ChatScope, DatabaseKey, ReceiptKey};
use crate::local_profile::{DEMO_FAST_OWNER_USER_ID, DEMO_FAST_TENANT_ID};
use rusqlite::params;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use uuid::Uuid;
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("feat164-s3-{}", Uuid::now_v7()));
        std::fs::create_dir(&p).unwrap();
        Self(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}
fn open(t: &Temp) -> ChatRepository {
    ChatRepository::open_with_schedule_storage(
        &t.0.join("chat"),
        &DatabaseKey::from_bytes([164; 32]),
        ReceiptKey::from_bytes([165; 32]),
        ChatScope::new(DEMO_FAST_OWNER_USER_ID.into(), DEMO_FAST_TENANT_ID.into()).unwrap(),
        ScheduleStorageMode::TimingFoundation,
    )
    .unwrap()
}
fn request(profile: Option<PlanDefinitionModelProfile>) -> SavePlanRequest {
    SavePlanRequest {
        request_id: Uuid::now_v7().to_string(),
        plan_id: None,
        expected_revision: None,
        definition: PlanDefinition {
            model_profile: profile,
            name: "合成计划".into(),
            content: "离线计划验收".into(),
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
fn hash(s: &str) -> String {
    format!("{:x}", Sha256::digest(s))
}
fn facts(r: &ChatRepository) -> Vec<(String, Vec<Vec<String>>)> {
    [
        "chat_scheduled_runs",
        "chat_scheduled_grants",
        "chat_scheduled_recovery",
        "chat_scheduled_reservation",
        "chat_scheduled_run_bindings",
        "chat_scheduled_requests",
        "chat_operation_models",
        "chat_outbox",
        "chat_public_task_bindings",
        "chat_model_selections",
    ]
    .iter()
    .map(|t| {
        let mut q = r
            .connection
            .prepare(&format!("SELECT * FROM {t} ORDER BY rowid"))
            .unwrap();
        let n = q.column_count();
        let rows = q
            .query_map([], |row| {
                Ok((0..n)
                    .map(|i| format!("{:?}", row.get_ref(i).unwrap()))
                    .collect::<Vec<_>>())
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        (t.to_string(), rows)
    })
    .collect()
}
// Establish a coherent retained old-format fixture, before the feature transition.
// This helper never runs against a user DB and is not a migration implementation.
fn historical(r: &mut ChatRepository, p: &PlanView, state: PlanState, n: i64) -> PlanView {
    let scope = r.scope.clone();
    let tx = r.connection.transaction().unwrap();
    let mut old = p.clone();
    old.definition.model_profile = Some(PlanDefinitionModelProfile::KimiK3MaxV1);
    old.state = state;
    store::write_plan(&tx, &scope, &old, n).unwrap();
    tx.commit().unwrap();
    old
}
#[test]
fn feat164_plan_retirement_before_dispatch() {
    assert!(crate::chat::models::v2_enabled());
    assert!(crate::chat::models::dispatch_profile_available(
        "kimi-k3-1-pro-max-v1"
    ));
    let t = Temp::new();
    let n = chrono::Utc::now().timestamp();
    let a = ScheduleAuthority::local(n).unwrap();
    let mut r = open(&t);
    assert_eq!(r.schema_version().unwrap(), 41);
    let mut minimax_request = request(Some(PlanDefinitionModelProfile::MinimaxM3HighV1));
    let normal = r.save_schedule(minimax_request.clone(), n).unwrap();
    let legacy = r.save_schedule(request(None), n).unwrap();
    let old_paused_base = r
        .save_schedule(
            request(Some(PlanDefinitionModelProfile::MinimaxM3HighV1)),
            n,
        )
        .unwrap();
    let old_paused = historical(&mut r, &old_paused_base, PlanState::Paused, n);
    let deleted_base = r.save_schedule(request(None), n).unwrap();
    let deleted = historical(&mut r, &deleted_base, PlanState::Deleted, n);
    let planned = r
        .save_schedule(
            request(Some(PlanDefinitionModelProfile::MinimaxM3HighV1)),
            n,
        )
        .unwrap();
    let c = confirmation(&planned, n);
    let g = r.confirm_schedule_grant(&a, c.clone(), n).unwrap();
    let run_request = Uuid::now_v7().to_string();
    let run = r
        .prepare_trigger_local(
            &a,
            &g.grant_id,
            planned.revision,
            &run_request,
            &super::triggers::Trigger::Manual,
            n,
        )
        .unwrap();
    let create: String = r
        .connection
        .query_row(
            "SELECT create_operation_id FROM chat_scheduled_run_bindings WHERE run_id=?1",
            [&run.run_id],
            |r| r.get(0),
        )
        .unwrap();
    let op = Uuid::parse_str(&create).unwrap();
    assert!(
        execution::dispatch::validate_operation(&r.connection, &r.scope, &a, op, n, false, None)
            .is_ok(),
        "positive MiniMax admission"
    );
    let selected = r.read_schedule(&planned.plan_id).unwrap();
    let old = historical(&mut r, &selected, PlanState::Enabled, n);
    let snapshot = serde_json::to_string(&old).unwrap();
    r.connection
        .execute(
            "UPDATE chat_scheduled_runs SET snapshot_json=?1,snapshot_digest=?2 WHERE run_id=?3",
            params![snapshot, hash(&snapshot), run.run_id],
        )
        .unwrap();
    let digest = hash(
        &serde_json::to_string(&(
            old.revision,
            old.schedule_epoch,
            &old.definition,
            &g.workspace,
        ))
        .unwrap(),
    );
    r.connection
        .execute(
            "UPDATE chat_scheduled_grants SET definition_digest=?1 WHERE grant_id=?2",
            params![digest, g.grant_id],
        )
        .unwrap();
    r.connection
        .execute(
            "UPDATE chat_operation_models SET profile_id='kimi-k3-max-v1'",
            [],
        )
        .unwrap();
    r.connection
        .execute(
            "UPDATE chat_model_selections SET profile_id='kimi-k3-max-v1'",
            [],
        )
        .unwrap();
    assert_eq!(
        require_execution(&r.connection, &r.scope, &old),
        Err(Error::ExecutionNotReady)
    );
    assert!(
        execution::dispatch::validate_operation(&r.connection, &r.scope, &a, op, n, false, None)
            .is_err(),
        "retired identity denied even before retirement transaction"
    );
    let run = execution::read_run(&r.connection, &r.scope, &run.run_id).unwrap();
    let retained = facts(&r);
    drop(r);
    let mut r = open(&t); // exact production entry retires before returning to worker
    let retired = r.read_schedule(&old.plan_id).unwrap();
    assert_eq!(retired.revision, old.revision + 1);
    assert_eq!(retired.state, PlanState::Paused);
    assert_eq!(retired.definition, old.definition);
    assert!(retired.authorization_ref.is_none());
    assert!(retired.authorization_expires_at.is_none());
    assert!(retired.next_at.is_none());
    assert_eq!(
        r.read_schedule(&old_paused.plan_id).unwrap().revision,
        old_paused.revision + 1
    );
    assert_eq!(r.read_schedule(&normal.plan_id).unwrap(), normal);
    assert_eq!(r.read_schedule(&legacy.plan_id).unwrap(), legacy);
    assert_eq!(
        r.read_schedule(&deleted.plan_id),
        Err(ScheduleErrorCode::NotFound)
    );
    assert_eq!(
        store::read_plan(&r.connection, &r.scope, &deleted.plan_id).unwrap(),
        deleted
    );
    assert_eq!(
        facts(&r),
        retained,
        "run/grant/receipt/debit/outbox facts retained byte-for-byte"
    );
    let pending:i64=r.connection.query_row("SELECT count(*) FROM chat_scheduled_occurrences WHERE plan_id=?1 AND disposition='planned' AND run_id IS NULL",[&old.plan_id],|r|r.get(0)).unwrap();
    assert_eq!(pending, 0);
    assert_eq!(
        r.confirm_schedule_grant(&a, c.clone(), n).unwrap().state,
        GrantState::Stale
    );
    assert_eq!(
        r.prepare_trigger_local(
            &a,
            &g.grant_id,
            old.revision,
            &run_request,
            &super::triggers::Trigger::Manual,
            n
        )
        .unwrap(),
        run,
        "replay observes original run"
    );
    assert!(r
        .prepare_trigger_local(
            &a,
            &g.grant_id,
            old.revision,
            &Uuid::now_v7().to_string(),
            &super::triggers::Trigger::Manual,
            n
        )
        .is_err());
    assert!(r.claim_next_conversation_outbox(n, 30).unwrap().is_none());
    assert!(execution::dispatch::validate_operation(
        &r.connection,
        &r.scope,
        &a,
        op,
        n,
        true,
        None
    )
    .is_err());
    assert_eq!(facts(&r), retained, "no attempts or automatic refund");
    assert_eq!(
        r.confirm_schedule_grant(&a, confirmation(&retired, n), n),
        Err(Error::ExecutionNotReady)
    );
    assert_eq!(
        r.save_schedule(request(Some(PlanDefinitionModelProfile::KimiK3MaxV1)), n),
        Err(ScheduleErrorCode::ExecutionNotReady)
    );
    assert_eq!(
        r.recover_schedule_clock(
            &retired.plan_id,
            retired.revision,
            n + 60,
            super::time::Continuity::Recovered
        )
        .unwrap(),
        retired
    );
    r.manual_runtime.enabled = true;
    r.schedule_dispatch_authority = Some(
        crate::native_auth::NativeAuthRuntime::from_environment_with_test_profile(
            None,
            false,
            crate::local_profile::LocalRuntimeProfile::DemoFast,
        ),
    );
    r.expire_manual(n).unwrap();
    r.expire_unstarted_rerun(n).unwrap();
    r.expire_automatic(n).unwrap();
    assert_eq!(
        facts(&r),
        retained,
        "automatic expiry must not cancel or refund a retired run"
    );
    assert_eq!(
        r.automatic_startup_work(n).unwrap(),
        (false, true),
        "retired future is closed; observation remains available"
    );
    let counts: i64 = r
        .connection
        .query_row(
            "SELECT count(*) FROM chat_plan_model_retirements",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(counts, 2);
    drop(r);
    let r = open(&t);
    assert_eq!(r.read_schedule(&old.plan_id).unwrap(), retired);
    assert_eq!(facts(&r), retained);
    // An existing unknown send remains an occupied fact through another reopen.
    r.connection
        .execute(
            "UPDATE chat_scheduled_recovery SET turn_attempt='unknown' WHERE run_id=?1",
            [&run.run_id],
        )
        .unwrap();
    let unknown = facts(&r);
    drop(r);
    let mut r = open(&t);
    assert_eq!(facts(&r), unknown);
    assert!(r.claim_next_conversation_outbox(n, 30).unwrap().is_none());
    assert_eq!(facts(&r), unknown);
    minimax_request.plan_id = Some(old_paused.plan_id.clone());
    minimax_request.expected_revision = Some(old_paused.revision + 1);
    minimax_request.request_id = Uuid::now_v7().to_string();
    minimax_request.definition.model_profile = None;
    assert_eq!(
        r.save_schedule(minimax_request, n),
        Err(ScheduleErrorCode::InvalidInput),
        "omission cannot masquerade as explicit migration"
    );
    println!("S3 retirement: enabled/paused/deleted/MiniMax/implicit default; pre-claim denial; reopen idempotence; old receipt replay; unknown reservation retained");
}

#[test]
fn feat164_s3_explicit_save_reauthorize_and_bound_target() {
    assert!(crate::chat::models::v2_enabled());
    let t = Temp::new();
    let mut r = open(&t);
    let n = chrono::Utc::now().timestamp();
    let a = ScheduleAuthority::local(n).unwrap();
    let p = r.save_schedule(request(None), n).unwrap();
    let c = confirmation(&p, n);
    let g = r.confirm_schedule_grant(&a, c.clone(), n).unwrap();
    let previous = r.read_schedule(&p.plan_id).unwrap();
    let old = historical(&mut r, &previous, PlanState::Paused, n);
    drop(r);
    let mut r = open(&t);
    let p = r.read_schedule(&old.plan_id).unwrap();
    let mut q = request(Some(PlanDefinitionModelProfile::KimiK31ProMaxV1));
    q.plan_id = Some(p.plan_id.clone());
    q.expected_revision = Some(p.revision);
    let migrated = r.save_active_schedule(&a, q.clone(), n).unwrap();
    assert_eq!(migrated.state, PlanState::Paused);
    assert!(migrated.authorization_ref.is_none());
    assert_eq!(migrated.revision, p.revision + 1);
    assert_eq!(
        r.confirm_schedule_grant(&a, c, n).unwrap().state,
        GrantState::Stale
    );
    assert!(r
        .prepare_trigger_local(
            &a,
            &g.grant_id,
            old.revision,
            &Uuid::now_v7().to_string(),
            &super::triggers::Trigger::Manual,
            n
        )
        .is_err());
    let fresh = r
        .confirm_schedule_grant(&a, confirmation(&migrated, n), n)
        .unwrap();
    assert_ne!(fresh.grant_id, g.grant_id);
    assert_eq!(fresh.occupied_runs, 0);
    let run = r
        .prepare_trigger_local(
            &a,
            &fresh.grant_id,
            migrated.revision,
            &Uuid::now_v7().to_string(),
            &super::triggers::Trigger::Manual,
            n,
        )
        .unwrap();
    let (chat,create):(String,String)=r.connection.query_row("SELECT conversation_id,create_operation_id FROM chat_scheduled_run_bindings WHERE run_id=?1",[&run.run_id],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
    let profile: String = r
        .connection
        .query_row(
            "SELECT profile_id FROM chat_operation_models WHERE operation_id=?1",
            [&run.operation_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(profile, "kimi-k3-1-pro-max-v1");
    assert!(execution::dispatch::validate_operation(
        &r.connection,
        &r.scope,
        &a,
        Uuid::parse_str(&create).unwrap(),
        n,
        false,
        None
    )
    .is_ok());
    r.connection
        .execute(
            "UPDATE chat_outbox SET state='inflight' WHERE operation_id=?1",
            [&create],
        )
        .unwrap();
    r.connection
        .execute(
            "UPDATE chat_scheduled_recovery SET native_claim=1 WHERE run_id=?1",
            [&run.run_id],
        )
        .unwrap();
    assert!(execution::dispatch::validate_operation(
        &r.connection,
        &r.scope,
        &a,
        Uuid::parse_str(&create).unwrap(),
        n,
        true,
        None
    )
    .is_ok());
    let p = r.read_schedule(&p.plan_id).unwrap();
    // A normal pending selection blocks both fresh confirmation and final admission.
    r.connection
        .execute(
            "UPDATE chat_model_selections SET state='switching' WHERE session_id=?1",
            [&chat],
        )
        .unwrap();
    assert_eq!(
        require_execution(&r.connection, &r.scope, &p),
        Err(Error::TargetUnavailable)
    );
    assert!(execution::dispatch::validate_operation(
        &r.connection,
        &r.scope,
        &a,
        Uuid::parse_str(&create).unwrap(),
        n,
        true,
        None
    )
    .is_err());
    let mut q = request(Some(PlanDefinitionModelProfile::MinimaxM3HighV1));
    q.plan_id = Some(p.plan_id.clone());
    q.expected_revision = Some(p.revision);
    assert_eq!(
        r.save_schedule(q, n),
        Err(ScheduleErrorCode::TargetUnavailable)
    );
    println!("S3 explicit migration: paused save, stale old grant, fresh grant, frozen K3.1 profile, bound pending-selection barrier");
}

#[test]
fn feat164_s3_paused_candidate_preserves_authority() {
    assert!(crate::chat::models::v2_enabled());
    assert!(!crate::chat::models::dispatch_profile_available(
        "kimi-k3-1-pro-max-v1"
    ));
    let t = Temp::new();
    let mut r = open(&t);
    let n = chrono::Utc::now().timestamp();
    let a = ScheduleAuthority::local(n).unwrap();
    let p = r
        .save_schedule(
            request(Some(PlanDefinitionModelProfile::KimiK31ProMaxV1)),
            n,
        )
        .unwrap();
    assert_eq!(
        r.confirm_schedule_grant(&a, confirmation(&p, n), n),
        Err(Error::ExecutionNotReady)
    );
    assert_eq!(
        r.connection
            .query_row("SELECT count(*) FROM chat_scheduled_grants", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let mini = r
        .save_active_schedule(
            &a,
            request(Some(PlanDefinitionModelProfile::MinimaxM3HighV1)),
            n,
        )
        .unwrap();
    assert_eq!(
        mini.state,
        PlanState::Enabled,
        "MiniMax keeps its prior enable semantics"
    );
    for _ in 0..33 {
        r.save_schedule(
            request(Some(PlanDefinitionModelProfile::KimiK31ProMaxV1)),
            n,
        )
        .unwrap();
    }
    assert_eq!(
        due_plan_ids(&r.connection, &r.scope, n + 86400, 32).unwrap(),
        vec![mini.plan_id],
        "paused Kimi cannot occupy the entire scan page"
    );
}

#[test]
fn feat164_s3_schema_upgrade_and_replay() {
    assert!(crate::chat::models::v2_enabled());
    for version in [38, 39, 40] {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        crate::chat::migrations::migrate_to_target(&mut db, version).unwrap();
        let scope =
            ChatScope::new(DEMO_FAST_OWNER_USER_ID.into(), DEMO_FAST_TENANT_ID.into()).unwrap();
        let n = chrono::Utc::now().timestamp();
        let id = Uuid::now_v7().to_string();
        let plan = PlanView {
            plan_id: id.clone(),
            revision: 1,
            schedule_epoch: 1,
            definition: request(Some(PlanDefinitionModelProfile::KimiK3MaxV1)).definition,
            state: PlanState::Enabled,
            target_state: TargetState::Unbound,
            effective_from: n,
            next_at: Some(n + 60),
            rule_version: 1,
            tzdb_version: chrono_tz::IANA_TZDB_VERSION.into(),
            authorization_ref: Some(Uuid::now_v7().to_string()),
            authorization_expires_at: Some(n + 600),
        };
        let tx = db.transaction().unwrap();
        store::write_plan(&tx, &scope, &plan, n).unwrap();
        store::insert_future(&tx, &scope, &plan, Some("2026-10-26T09:00"), n).unwrap();
        tx.commit().unwrap();
        let ledger = |db: &rusqlite::Connection| -> Vec<(i64, String, String, i64)> {
            db.prepare("SELECT version,name,sha256,applied_at FROM chat_schema_migrations WHERE version<=?1 ORDER BY version").unwrap().query_map([version],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap().collect::<Result<Vec<_>,_>>().unwrap()
        };
        let original = ledger(&db);
        crate::chat::migrations::migrate_to_target(&mut db, 41).unwrap();
        retire_before_worker(&mut db, &scope, n).unwrap();
        let current = store::read_plan(&db, &scope, &id).unwrap();
        assert_eq!(current.revision, 2);
        assert_eq!(current.state, PlanState::Paused);
        assert_eq!(current.definition, plan.definition);
        assert!(current.authorization_ref.is_none());
        assert_eq!(ledger(&db), original);
        retire_before_worker(&mut db, &scope, n + 1).unwrap();
        assert_eq!(store::read_plan(&db, &scope, &id).unwrap(), current);
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM chat_plan_model_retirements",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(
            db.query_row(
                "SELECT disposition FROM chat_scheduled_occurrences WHERE plan_id=?1",
                [&id],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "cancelled"
        );
        println!("SQL{version}->41 preserved original migration ledger and plan identity; retirement idempotent");
    }
}

struct Keys;
impl crate::chat::keychain::DatabaseKeyStore for Keys {
    fn load_or_create(&self, _: bool) -> Result<DatabaseKey, crate::chat::error::ChatError> {
        Ok(DatabaseKey::from_bytes([164; 32]))
    }
}
impl crate::chat::keychain::ReceiptKeyStore for Keys {
    fn load_or_create(&self, _: bool) -> Result<ReceiptKey, crate::chat::error::ChatError> {
        Ok(ReceiptKey::from_bytes([165; 32]))
    }
}
#[tokio::test]
async fn feat164_s3_worker_starts_after_retirement() {
    assert!(crate::chat::models::v2_enabled());
    let t = Temp::new();
    let mut r = open(&t);
    let n = chrono::Utc::now().timestamp();
    let a = ScheduleAuthority::local(n).unwrap();
    let active = r
        .save_active_schedule(
            &a,
            request(Some(PlanDefinitionModelProfile::MinimaxM3HighV1)),
            n,
        )
        .unwrap();
    r.schedule_dispatch_authority = Some(
        crate::native_auth::NativeAuthRuntime::from_environment_with_test_profile(
            None,
            false,
            crate::local_profile::LocalRuntimeProfile::DemoFast,
        ),
    );
    assert_eq!(
        r.automatic_startup_work(n).unwrap(),
        (true, false),
        "positive finite enabled intent"
    );
    let old = historical(&mut r, &active, PlanState::Enabled, n);
    assert_eq!(
        r.automatic_startup_work(n).unwrap(),
        (false, false),
        "retired profile never requests takeover before open transition"
    );
    let scope = r.scope.clone();
    let before = facts(&r);
    drop(r);
    let worker = crate::chat::worker::DatabaseWorker::start_with_schedule_storage(
        t.0.join("chat"),
        scope,
        Box::new(Keys),
        Box::new(Keys),
        ScheduleStorageMode::TimingFoundation,
    )
    .unwrap();
    worker
        .call(move |r| {
            let p = r.read_schedule(&old.plan_id).unwrap();
            assert_eq!(p.revision, old.revision + 1);
            assert_eq!(p.state, PlanState::Paused);
            assert!(p.authorization_ref.is_none());
            r.manual_runtime.enabled = true;
            r.schedule_dispatch_authority = Some(
                crate::native_auth::NativeAuthRuntime::from_environment_with_test_profile(
                    None,
                    false,
                    crate::local_profile::LocalRuntimeProfile::DemoFast,
                ),
            );
            r.expire_manual(n)?;
            r.expire_unstarted_rerun(n)?;
            r.expire_automatic(n)?;
            assert_eq!(r.automatic_startup_work(n)?, (false, false));
            assert!(r.claim_next_conversation_outbox(n, 30)?.is_none());
            assert_eq!(facts(r), before);
            Ok(())
        })
        .await
        .unwrap();
    drop(worker); // normal channel close + database thread join before removing the temp directory
}
