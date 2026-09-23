use super::{generated::*, time::*, ScheduleService, ScheduleStorageMode};
use crate::chat::keychain::{DatabaseKeyStore, ReceiptKeyStore};
use crate::chat::worker::DatabaseWorker;
use crate::chat::{ChatRepository, ChatScope, DatabaseKey, ReceiptKey};
use chrono::DateTime;
use std::path::{Path, PathBuf};
use uuid::Uuid;

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("yijie-feat155-{}", Uuid::now_v7()));
        std::fs::create_dir(&path).unwrap();
        Self(std::fs::canonicalize(path).unwrap())
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn scope() -> ChatScope {
    ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap()
}
fn open(root: &Path, scope: ChatScope, mode: ScheduleStorageMode) -> ChatRepository {
    ChatRepository::open_with_schedule_storage(
        &root.join("chat"),
        &DatabaseKey::from_bytes([155; 32]),
        ReceiptKey::from_bytes([156; 32]),
        scope,
        mode,
    )
    .unwrap()
}
fn at(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value).unwrap().timestamp()
}
fn rule() -> TimeRule {
    TimeRule {
        frequency: TimeRuleFrequency::Daily,
        time_zone: "Asia/Shanghai".into(),
        local_time: "09:00".into(),
        local_date: None,
        weekdays: None,
    }
}
fn request() -> SavePlanRequest {
    SavePlanRequest {
        request_id: Uuid::now_v7().to_string(),
        plan_id: None,
        expected_revision: None,
        definition: PlanDefinition {
            name: "每日检查".into(),
            content: "公开信息合成检查".into(),
            rule: rule(),
            target: TargetReference {
                mode: TargetMode::DedicatedChat,
                conversation_id: None,
            },
        },
    }
}
fn count(repo: &ChatRepository, table: &str) -> i64 {
    repo.connection
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
}

#[test]
fn feat155_4c2_background_startup_does_not_claim_foreground_work() {
    let root = Temp::new();
    let owner = scope();
    let mut repo = open(
        &root.0,
        owner.clone(),
        ScheduleStorageMode::AutomaticFoundation,
    );
    let session = existing_chat(&mut repo, &root.0);
    repo.schedule_background_only = true;
    let now = super::execution::now().unwrap();
    assert!(repo
        .claim_next_conversation_outbox(now, 30)
        .unwrap()
        .is_none());
    assert_eq!(
        repo.connection
            .query_row("SELECT sum(attempt_count) FROM chat_outbox", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    drop(repo);
    let mut reader = open(&root.0, owner, ScheduleStorageMode::CompatibleReader);
    assert_eq!(reader.schema_version().unwrap(), 24);
    assert!(reader.session_summary(session).is_ok());
    assert!(!reader.schedule_execution_writes_enabled);
    // An explicit foreground bind may resume its original queue; startup did not.
    reader.schedule_background_only = false;
    assert!(reader
        .claim_next_conversation_outbox(now, 30)
        .unwrap()
        .is_some());
}
fn existing_chat(repo: &mut ChatRepository, root: &Path) -> Uuid {
    let path = root.join("project");
    std::fs::create_dir_all(&path).unwrap();
    let project = repo
        .register_project(&path, b"ordinary-synthetic-bookmark")
        .unwrap();
    repo.create_session_and_enqueue(
        Uuid::parse_str(&project.id).unwrap(),
        "保留的旧聊天",
        Uuid::now_v7(),
    )
    .unwrap()
    .session_id
}

#[test]
fn feat155_time_calendar_dst_and_bounded_reference_queries() {
    let cases = [
        (
            "Asia/Shanghai",
            "09:00",
            TimeRuleFrequency::Daily,
            None,
            "2026-09-18T01:00:00Z",
            "2026-09-19T01:00:00Z",
            0,
        ),
        (
            "Asia/Shanghai",
            "09:00",
            TimeRuleFrequency::Weekdays,
            None,
            "2026-09-18T01:00:00Z",
            "2026-09-21T01:00:00Z",
            0,
        ),
        (
            "Asia/Kathmandu",
            "09:00",
            TimeRuleFrequency::Weekly,
            Some(vec![1]),
            "2026-09-18T00:00:00Z",
            "2026-09-21T03:15:00Z",
            0,
        ),
        (
            "America/New_York",
            "02:30",
            TimeRuleFrequency::Daily,
            None,
            "2026-03-08T06:00:00Z",
            "2026-03-09T06:30:00Z",
            1,
        ),
        (
            "America/New_York",
            "01:30",
            TimeRuleFrequency::Daily,
            None,
            "2026-11-01T04:00:00Z",
            "2026-11-01T05:30:00Z",
            0,
        ),
        (
            "America/New_York",
            "01:30",
            TimeRuleFrequency::Daily,
            None,
            "2026-11-01T05:45:00Z",
            "2026-11-02T06:30:00Z",
            0,
        ),
        (
            "UTC",
            "09:00",
            TimeRuleFrequency::Daily,
            None,
            "2028-02-28T09:00:00Z",
            "2028-02-29T09:00:00Z",
            0,
        ),
        (
            "UTC",
            "09:00",
            TimeRuleFrequency::Daily,
            None,
            "2099-12-31T09:00:00Z",
            "2100-01-01T09:00:00Z",
            0,
        ),
    ];
    for (zone, local_time, frequency, weekdays, after, expected, skipped) in cases {
        let rule = TimeRule {
            frequency,
            time_zone: zone.into(),
            local_time: local_time.into(),
            local_date: None,
            weekdays,
        };
        let result = preview(&rule, at(after), 0).unwrap();
        assert_eq!(result.next_at, Some(at(expected)), "{zone} {after}");
        assert_eq!(result.skipped_slots.len(), skipped);
        assert!(result.candidates_examined <= 16);
        assert_eq!(result.tzdb_version, "2025b");
    }
    // Effective lower boundary is independent of the historic creation date.
    let result = preview(
        &rule(),
        at("2026-01-01T00:00:00Z"),
        at("2050-01-01T01:00:00Z"),
    )
    .unwrap();
    assert_eq!(result.next_at, Some(at("2050-01-01T01:00:00Z")));
}

#[test]
fn feat155_time_once_validation_and_continuity_are_explicit() {
    let mut once = TimeRule {
        frequency: TimeRuleFrequency::Once,
        time_zone: "America/New_York".into(),
        local_time: "01:30".into(),
        local_date: Some("2026-11-01".into()),
        weekdays: None,
    };
    assert_eq!(
        preview(&once, at("2026-11-01T04:00:00Z"), 0)
            .unwrap()
            .next_at,
        Some(at("2026-11-01T05:30:00Z"))
    );
    assert_eq!(
        preview(&once, at("2026-11-01T05:30:00Z"), 0)
            .unwrap()
            .next_at,
        None
    );
    once.local_date = Some("2026-03-08".into());
    once.local_time = "02:30".into();
    assert_eq!(validate_rule(&once), Err(ScheduleErrorCode::InvalidInput));
    let mut invalid = rule();
    invalid.time_zone = "Not/A_Zone".into();
    assert!(validate_rule(&invalid).is_err());
    invalid = rule();
    invalid.local_time = "9:00".into();
    assert!(validate_rule(&invalid).is_err());
    invalid = rule();
    invalid.weekdays = Some(vec![1]);
    assert!(validate_rule(&invalid).is_err());
    invalid.frequency = TimeRuleFrequency::Weekly;
    invalid.weekdays = Some(vec![1, 1]);
    assert!(validate_rule(&invalid).is_err());
    assert_eq!(
        due_decision(100, 160, Continuity::ContinuousAwake).unwrap(),
        DueDecision::Eligible
    );
    assert_eq!(
        due_decision(100, 161, Continuity::ContinuousAwake).unwrap(),
        DueDecision::MissedLate
    );
    assert_eq!(
        due_decision(100, 101, Continuity::Recovered).unwrap(),
        DueDecision::MissedOffline
    );
    assert_eq!(
        due_decision(100, 101, Continuity::ClockDiscontinuity).unwrap(),
        DueDecision::ClockDiscontinuity
    );
    assert_eq!(
        due_decision(100, 99, Continuity::ContinuousAwake).unwrap(),
        DueDecision::Future
    );
    assert!(due_decision(-1, 1, Continuity::Recovered).is_err());
}

#[test]
fn feat155_storage_default_reader_forward_reopen_and_old_chat() {
    let root = Temp::new();
    let owner = scope();
    let mut legacy = open(
        &root.0,
        owner.clone(),
        ScheduleStorageMode::CompatibleReader,
    );
    assert_eq!(legacy.schema_version().unwrap(), 15);
    let chat = existing_chat(&mut legacy, &root.0);
    let old_ledger: Vec<(i64, String, String)> = {
        let mut q = legacy
            .connection
            .prepare("SELECT version,name,sha256 FROM chat_schema_migrations ORDER BY version")
            .unwrap();
        q.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    };
    assert_eq!(
        legacy.list_schedules(),
        Err(ScheduleErrorCode::StorageDisabled)
    );
    drop(legacy);
    let mut writer = open(&root.0, owner.clone(), ScheduleStorageMode::PlanWriter);
    assert_eq!(writer.schema_version().unwrap(), 16);
    let plan = writer
        .save_schedule(request(), at("2026-09-18T00:00:00Z"))
        .unwrap();
    assert!(writer.session_summary(chat).is_ok());
    let ledger: Vec<(i64, String, String)> = {
        let mut q=writer.connection.prepare("SELECT version,name,sha256 FROM chat_schema_migrations WHERE version<=15 ORDER BY version").unwrap();
        q.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    };
    assert_eq!(ledger, old_ledger);
    drop(writer);
    let mut reader = open(&root.0, owner, ScheduleStorageMode::CompatibleReader);
    assert_eq!(reader.schema_version().unwrap(), 16);
    assert_eq!(reader.read_schedule(&plan.plan_id).unwrap(), plan);
    assert_eq!(
        reader.save_schedule(request(), 0),
        Err(ScheduleErrorCode::StorageDisabled)
    );
    reader.rename_session(chat, "正常兼容聊天写入").unwrap();
    assert_eq!(
        reader.session_summary(chat).unwrap().title,
        "正常兼容聊天写入"
    );
    let text: String = reader
        .connection
        .query_row(
            "SELECT content FROM chat_messages WHERE session_id=?1 AND role='user'",
            [chat.to_string()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(text, "保留的旧聊天");
}

#[test]
fn feat155_storage_request_replay_revision_epoch_and_no_execution() {
    let root = Temp::new();
    let mut repo = open(&root.0, scope(), ScheduleStorageMode::PlanWriter);
    let now = at("2026-09-18T00:00:00Z");
    let input = request();
    let first = repo.save_schedule(input.clone(), now).unwrap();
    assert_eq!(first.state, PlanState::Paused);
    assert!(first.authorization_ref.is_none());
    assert_eq!(repo.save_schedule(input.clone(), now + 100).unwrap(), first);
    assert_eq!(count(&repo, "chat_scheduled_plans"), 1);
    assert_eq!(count(&repo, "chat_scheduled_occurrences"), 1);
    assert_eq!(count(&repo, "chat_sessions"), 0);
    assert_eq!(count(&repo, "chat_outbox"), 0);
    let mut conflict = input.clone();
    conflict.definition.content = "另一个合成请求".into();
    assert_eq!(
        repo.save_schedule(conflict, now),
        Err(ScheduleErrorCode::RequestConflict)
    );
    let mut update = request();
    update.plan_id = Some(first.plan_id.clone());
    update.expected_revision = Some(1);
    update.definition.name = "修改名称".into();
    let second = repo.save_schedule(update.clone(), now + 1).unwrap();
    assert_eq!(second.revision, 2);
    assert_eq!(second.schedule_epoch, 1);
    assert_eq!(count(&repo, "chat_scheduled_occurrences"), 1);
    update.request_id = Uuid::now_v7().to_string();
    assert_eq!(
        repo.save_schedule(update.clone(), now + 2),
        Err(ScheduleErrorCode::RevisionConflict)
    );
    update.expected_revision = Some(2);
    update.definition.rule.local_time = "10:00".into();
    let third = repo.save_schedule(update, now + 2).unwrap();
    assert_eq!(third.schedule_epoch, 2);
    assert_eq!(third.revision, 3);
    let before = count(&repo, "chat_scheduled_occurrences");
    assert_eq!(
        repo.pause_schedule(&third.plan_id, 3).unwrap().state,
        PlanState::Paused
    );
    assert_eq!(count(&repo, "chat_scheduled_occurrences"), before);
    let deleted = repo.delete_schedule(&third.plan_id, 3).unwrap();
    assert_eq!(deleted.state, PlanState::Deleted);
    assert_eq!(repo.save_schedule(input, now + 5).unwrap(), deleted);
    assert!(repo.list_schedules().unwrap().is_empty());
    assert_eq!(
        repo.read_schedule(&third.plan_id),
        Err(ScheduleErrorCode::NotFound)
    );
    assert_eq!(count(&repo, "chat_outbox"), 0);
}

#[test]
fn feat155_storage_scoped_targets_and_compatible_deletion() {
    let root = Temp::new();
    let owner = scope();
    let mut repo = open(&root.0, owner.clone(), ScheduleStorageMode::PlanWriter);
    let chat = existing_chat(&mut repo, &root.0);
    let baseline = count(&repo, "chat_outbox");
    let now = at("2026-09-18T00:00:00Z");
    let mut input = request();
    input.definition.target = TargetReference {
        mode: TargetMode::ExistingChat,
        conversation_id: Some(chat.to_string()),
    };
    let bound = repo.save_schedule(input.clone(), now).unwrap();
    let mut disposable = input.clone();
    disposable.request_id = Uuid::now_v7().to_string();
    let disposable = repo.save_schedule(disposable, now).unwrap();
    repo.delete_schedule(&disposable.plan_id, disposable.revision)
        .unwrap();
    assert!(repo.session_summary(chat).is_ok());
    assert_eq!(count(&repo, "chat_outbox"), baseline);
    let mut independent = request();
    independent.definition.target.mode = TargetMode::NewChatEachRun;
    let unbound = repo.save_schedule(independent, now).unwrap();
    assert_eq!(count(&repo, "chat_outbox"), baseline);
    drop(repo);
    let mut other = open(&root.0, scope(), ScheduleStorageMode::PlanWriter);
    assert_eq!(
        other.read_schedule(&bound.plan_id),
        Err(ScheduleErrorCode::NotFound)
    );
    assert!(other.list_schedules().unwrap().is_empty());
    input.request_id = Uuid::now_v7().to_string();
    assert_eq!(
        other.save_schedule(input, now),
        Err(ScheduleErrorCode::TargetUnavailable)
    );
    drop(other);
    // Default reader can perform normal Chat deletion without leaving a live FK.
    let mut reader = open(
        &root.0,
        owner.clone(),
        ScheduleStorageMode::CompatibleReader,
    );
    reader.delete_session_local(&chat.to_string()).unwrap();
    let missing = reader.read_schedule(&bound.plan_id).unwrap();
    assert_eq!(missing.target_state, TargetState::Missing);
    assert!(missing.definition.target.conversation_id.is_none());
    assert_eq!(missing.state, PlanState::Paused);
    assert!(missing.next_at.is_none());
    assert_eq!(reader.read_schedule(&unbound.plan_id).unwrap(), unbound);
    drop(reader);
    let mut writer = open(&root.0, owner, ScheduleStorageMode::PlanWriter);
    writer
        .delete_schedule(&unbound.plan_id, unbound.revision)
        .unwrap();
    assert_eq!(count(&writer, "chat_sessions"), 0);
}

#[test]
fn feat155_storage_recovery_is_bounded_and_rollback_does_not_rewind() {
    let root = Temp::new();
    let owner = scope();
    let mut repo = open(&root.0, owner.clone(), ScheduleStorageMode::PlanWriter);
    let mut input = request();
    input.definition.rule.time_zone = "UTC".into();
    let start = at("2026-09-18T00:00:00Z");
    let first = repo.save_schedule(input, start).unwrap();
    let future = at("2050-01-01T10:00:00Z");
    let recovered = repo
        .recover_schedule_clock(&first.plan_id, 1, future, Continuity::Recovered)
        .unwrap();
    assert_eq!(recovered.next_at, Some(at("2050-01-02T09:00:00Z")));
    assert_eq!(count(&repo, "chat_scheduled_occurrences"), 2);
    let skipped:i64=repo.connection.query_row("SELECT count(*) FROM chat_scheduled_occurrences WHERE disposition='skipped_paused' AND missed_through=?1",[future],|r|r.get(0)).unwrap();
    assert_eq!(skipped, 1);
    assert_eq!(
        repo.recover_schedule_clock(&first.plan_id, 1, future, Continuity::Recovered)
            .unwrap(),
        recovered
    );
    assert_eq!(
        repo.recover_schedule_clock(&first.plan_id, 1, start, Continuity::ClockDiscontinuity)
            .unwrap(),
        recovered
    );
    assert_eq!(
        repo.recover_schedule_clock(&first.plan_id, 1, future + 1, Continuity::ContinuousAwake),
        Err(ScheduleErrorCode::ExecutionNotReady)
    );
    let mut edit = request();
    edit.plan_id = Some(first.plan_id.clone());
    edit.expected_revision = Some(1);
    edit.definition.rule.local_time = "10:00".into();
    let changed = repo.save_schedule(edit, start).unwrap();
    assert!(changed.next_at.unwrap() > future);
    assert_eq!(changed.schedule_epoch, 2);
    assert_eq!(changed.effective_from, future);
    assert_eq!(count(&repo, "chat_outbox"), 0);
    drop(repo);
    let reader = open(&root.0, owner, ScheduleStorageMode::CompatibleReader);
    assert_eq!(reader.read_schedule(&changed.plan_id).unwrap(), changed);
}

#[test]
fn feat155_storage_once_past_is_not_created_and_schema_denies_unknown_fields() {
    let root = Temp::new();
    let mut repo = open(&root.0, scope(), ScheduleStorageMode::PlanWriter);
    let now = at("2026-09-18T00:00:00Z");
    let mut input = request();
    input.definition.rule.frequency = TimeRuleFrequency::Once;
    input.definition.rule.local_date = Some("2026-09-17".into());
    assert_eq!(
        repo.save_schedule(input, now),
        Err(ScheduleErrorCode::InvalidInput)
    );
    assert_eq!(count(&repo, "chat_scheduled_plans"), 0);
    let mut value = serde_json::to_value(request()).unwrap();
    value["scope"] = serde_json::json!("ordinary-scope-field");
    assert!(serde_json::from_value::<SavePlanRequest>(value).is_err());
    let mut null_edit = serde_json::to_value(request()).unwrap();
    null_edit["plan_id"] = serde_json::Value::Null;
    null_edit["expected_revision"] = serde_json::Value::Null;
    assert!(serde_json::from_value::<SavePlanRequest>(null_edit).is_err());
    let mut null_rule = serde_json::to_value(rule()).unwrap();
    null_rule["weekdays"] = serde_json::Value::Null;
    assert!(serde_json::from_value::<TimeRule>(null_rule).is_err());
    let invalid = repo
        .connection
        .query_row("PRAGMA foreign_key_check", [], |r| r.get::<_, String>(0));
    assert!(matches!(invalid, Err(rusqlite::Error::QueryReturnedNoRows)));
}

#[test]
fn feat155_native_producer_schema_examples() {
    let root = Temp::new();
    let mut repo = open(&root.0, scope(), ScheduleStorageMode::PlanWriter);
    let input = request();
    let created = repo
        .save_schedule(input.clone(), at("2026-09-18T00:00:00Z"))
        .unwrap();
    let deleted = repo
        .delete_schedule(&created.plan_id, created.revision)
        .unwrap();
    let mut gap = rule();
    gap.time_zone = "America/New_York".into();
    gap.local_time = "02:30".into();
    let preview = preview(&gap, at("2026-03-08T06:00:00Z"), 0).unwrap();
    let example = serde_json::json!({"SavePlanRequest":input,"PlanView":[created,deleted],"TimePreview":preview,"ScheduleErrorCode":ScheduleErrorCode::ExecutionNotReady});
    if let Ok(directory) = std::env::var("YIJIE_FEAT155_CONFORMANCE_DIR") {
        // Optional test artifact only; caller supplies a new owned temporary directory.
        std::fs::write(
            Path::new(&directory).join("native-producer.json"),
            serde_json::to_vec_pretty(&example).unwrap(),
        )
        .unwrap();
    }
}

struct Keys;
impl DatabaseKeyStore for Keys {
    fn load_or_create(&self, _: bool) -> Result<DatabaseKey, crate::chat::ChatError> {
        Ok(DatabaseKey::from_bytes([155; 32]))
    }
}
impl ReceiptKeyStore for Keys {
    fn load_or_create(&self, _: bool) -> Result<ReceiptKey, crate::chat::ChatError> {
        Ok(ReceiptKey::from_bytes([156; 32]))
    }
}
#[tokio::test]
async fn feat155_worker_serializes_duplicate_confirmations_and_edits() {
    let root = Temp::new();
    let owner = scope();
    let worker = DatabaseWorker::start_with_schedule_storage(
        root.0.join("chat"),
        owner.clone(),
        Box::new(Keys),
        Box::new(Keys),
        ScheduleStorageMode::PlanWriter,
    )
    .unwrap();
    let service = ScheduleService::new(worker.clone());
    let input = request();
    let now = at("2026-09-18T00:00:00Z");
    let (left, right) = tokio::join!(service.save(input.clone(), now), service.save(input, now));
    assert_eq!(left, right);
    let first = left.unwrap();
    let mut a = request();
    a.plan_id = Some(first.plan_id.clone());
    a.expected_revision = Some(1);
    let mut b = a.clone();
    b.request_id = Uuid::now_v7().to_string();
    b.definition.name = "第二个修改".into();
    let (a, b) = tokio::join!(service.save(a, now + 1), service.save(b, now + 1));
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    assert!(
        a == Err(ScheduleErrorCode::RevisionConflict)
            || b == Err(ScheduleErrorCode::RevisionConflict)
    );
    assert_eq!(service.list().await.unwrap().len(), 1);
    drop(service);
    drop(worker); // Existing worker joins normally; no process or forced termination.
    let repo = open(&root.0, owner, ScheduleStorageMode::CompatibleReader);
    assert_eq!(repo.read_schedule(&first.plan_id).unwrap().revision, 2);
    assert_eq!(count(&repo, "chat_outbox"), 0);
}

#[test]
fn feat155_4a_old_chat_migrates_22_23_and_reader_reopens() {
    let root = Temp::new();
    let owner = scope();
    let mut legacy = open(&root.0, owner.clone(), ScheduleStorageMode::DraftFoundation);
    let chat = existing_chat(&mut legacy, &root.0);
    let history = legacy.session_summary(chat).unwrap();
    let plan = legacy
        .save_schedule(request(), at("2026-09-18T00:00:00Z"))
        .unwrap();
    let old_ledger: Vec<(i64, String)> = legacy
        .connection
        .prepare("SELECT version,sha256 FROM chat_schema_migrations ORDER BY version")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    drop(legacy);
    let writer = open(
        &root.0,
        owner.clone(),
        ScheduleStorageMode::ManagementFoundation,
    );
    assert_eq!(writer.schema_version().unwrap(), 23);
    assert_eq!(writer.session_summary(chat).unwrap(), history);
    assert_eq!(
        writer
            .connection
            .query_row(
                "SELECT created_at FROM chat_scheduled_plans WHERE plan_id=?1",
                [&plan.plan_id],
                |r| r.get::<_, Option<i64>>(0)
            )
            .unwrap(),
        None
    );
    for (version, sha) in old_ledger {
        assert_eq!(
            writer
                .connection
                .query_row(
                    "SELECT sha256 FROM chat_schema_migrations WHERE version=?1",
                    [version],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            sha
        );
    }
    drop(writer);
    let reader = open(&root.0, owner, ScheduleStorageMode::CompatibleReader);
    assert_eq!(reader.schema_version().unwrap(), 23);
    assert_eq!(reader.session_summary(chat).unwrap(), history);
}

#[test]
fn feat155_4c3_reader25_preserves_old_chat_and_does_not_enable_ordinary_writer() {
    let root = Temp::new();
    let owner = scope();
    let mut old = open(
        &root.0,
        owner.clone(),
        ScheduleStorageMode::AutomaticFoundation,
    );
    let chat = existing_chat(&mut old, &root.0);
    let before = old.session_summary(chat).unwrap();
    drop(old);
    let writer = open(
        &root.0,
        owner.clone(),
        ScheduleStorageMode::SingleRunFoundation,
    );
    assert_eq!(writer.schema_version().unwrap(), 25);
    assert_eq!(count(&writer, "chat_scheduled_single_run_grants"), 0);
    drop(writer);
    let reader = open(&root.0, owner, ScheduleStorageMode::CompatibleReader);
    assert_eq!(reader.schema_version().unwrap(), 25);
    assert_eq!(
        reader.session_summary(chat).unwrap().session_id,
        before.session_id
    );
    assert!(!reader.schedule_execution_writes_enabled);
    assert!(reader.schedule_dispatch_authority.is_none());
}

#[test]
fn feat155_4d1_reader26_preserves_15_and_25_history_without_backfill() {
    for mode in [
        ScheduleStorageMode::CompatibleReader,
        ScheduleStorageMode::SingleRunFoundation,
    ] {
        let root = Temp::new();
        let owner = scope();
        let mut old = open(&root.0, owner.clone(), mode);
        let chat = existing_chat(&mut old, &root.0);
        let before = old.session_summary(chat).unwrap();
        drop(old);
        let writer = open(
            &root.0,
            owner.clone(),
            ScheduleStorageMode::TimingFoundation,
        );
        assert_eq!(writer.schema_version().unwrap(), 26);
        assert_eq!(count(&writer, "chat_scheduled_timing"), 0);
        assert_eq!(
            writer.session_summary(chat).unwrap().session_id,
            before.session_id
        );
        drop(writer);
        let reader = open(&root.0, owner, ScheduleStorageMode::CompatibleReader);
        assert_eq!(reader.schema_version().unwrap(), 26);
        assert!(!reader.schedule_execution_writes_enabled);
        assert!(reader.schedule_dispatch_authority.is_none());
        assert_eq!(
            reader.session_summary(chat).unwrap().session_id,
            before.session_id
        );
    }
    let root = Temp::new();
    assert_eq!(
        open(&root.0, scope(), ScheduleStorageMode::CompatibleReader)
            .schema_version()
            .unwrap(),
        15
    );
}
