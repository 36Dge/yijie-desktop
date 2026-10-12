//! Normal storage ordering only: canonical migrations and real reservation
//! helpers, without launching a process or submitting a Runtime turn.
use super::*;
use crate::chat::{
    database::ChatScope,
    experts::{generated as expert, store as experts},
    keychain::{DatabaseKey, ReceiptKey},
    migrations,
    schedules::{
        execution::{reserve_in_transaction, ScheduleAuthority},
        execution_generated::{ExecutionErrorCode, GrantConfirmation},
        generated::{
            PlanDefinition, SavePlanRequest, TargetMode, TargetReference, TimeRule,
            TimeRuleFrequency,
        },
        ScheduleStorageMode,
    },
};
use crate::local_profile::{DEMO_FAST_OWNER_USER_ID, DEMO_FAST_TENANT_ID};

const NOW: i64 = 1_800_000_000;

struct Fixture {
    root: std::path::PathBuf,
    repo: Option<ChatRepository>,
    authority: ScheduleAuthority,
    grant: String,
    revision: i64,
    binding: expert::BindingSetPayload,
}
impl Fixture {
    fn new(schema: i64) -> Self {
        let root = std::env::temp_dir().join(format!("feat158-scheduled-lane-{}", Uuid::now_v7()));
        std::fs::create_dir(&root).unwrap();
        let mut repo = ChatRepository::open_with_schedule_storage(
            &root.join("chat"),
            &DatabaseKey::from_bytes([151; 32]),
            ReceiptKey::from_bytes([152; 32]),
            ChatScope::new(DEMO_FAST_OWNER_USER_ID.into(), DEMO_FAST_TENANT_ID.into()).unwrap(),
            ScheduleStorageMode::ExecutionFoundation,
        )
        .unwrap();
        migrations::migrate_to_target(&mut repo.connection, schema).unwrap();
        let plan = repo
            .save_schedule(
                SavePlanRequest {
                    request_id: Uuid::now_v7().to_string(),
                    plan_id: None,
                    expected_revision: None,
                    definition: PlanDefinition {
                        model_profile: None,
                        name: "普通预约验证".into(),
                        content: "本地状态互斥".into(),
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
                },
                NOW,
            )
            .unwrap();
        let authority = ScheduleAuthority::local(NOW).unwrap();
        let grant = repo
            .confirm_schedule_grant(
                &authority,
                GrantConfirmation {
                    request_id: Uuid::now_v7().to_string(),
                    plan_id: plan.plan_id,
                    expected_revision: plan.revision,
                    max_runs: 2,
                    expires_at: NOW + 3600,
                },
                NOW,
            )
            .unwrap();
        let project = Uuid::now_v7().to_string();
        let session = Uuid::now_v7().to_string();
        repo.connection.execute("INSERT INTO chat_projects(id,owner_user_id,tenant_id,safe_name,canonical_hash,bookmark_ref,last_used_at) VALUES(?1,?2,?3,'Ordinary project',?4,?5,1)",rusqlite::params![project,repo.scope.owner_user_id,repo.scope.tenant_id,"a".repeat(64),b"ordinary-bookmark".as_slice()]).unwrap();
        repo.connection.execute("INSERT INTO chat_sessions(id,owner_user_id,tenant_id,project_id,title,title_source,title_job_status,created_at,last_activity_at) VALUES(?1,?2,?3,?4,'Ordinary conversation','fallback','not_started',1,1)",rusqlite::params![session,repo.scope.owner_user_id,repo.scope.tenant_id,project]).unwrap();
        Self {
            root,
            repo: Some(repo),
            authority,
            grant: grant.grant_id,
            revision: plan.revision,
            binding: expert::BindingSetPayload {
                operation_id: Uuid::now_v7().to_string(),
                session_id: session,
                expected_binding_revision: 0,
                expert: None,
            },
        }
    }
    fn reserve(&mut self) -> Result<(), ExecutionErrorCode> {
        let repo = self.repo.as_mut().unwrap();
        let tx = repo.connection.transaction().unwrap();
        let result = reserve_in_transaction(
            &tx,
            &repo.scope,
            &self.authority,
            &self.grant,
            self.revision,
            &Uuid::now_v7().to_string(),
            NOW,
        )
        .map(|_| ());
        if result.is_ok() {
            tx.commit().unwrap();
        }
        result
    }
    fn begin(&mut self) -> Result<(), expert::ErrorCode> {
        let repo = self.repo.as_mut().unwrap();
        let tx = repo.connection.transaction().unwrap();
        let result =
            experts::begin(&tx, &repo.scope, &self.binding, None, &"b".repeat(64), NOW).map(|_| ());
        if result.is_ok() {
            tx.commit().unwrap();
        }
        result
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        drop(self.repo.take());
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn feat158_schedule_reservation_prevents_new_binding_in_same_transaction() {
    let mut fixture = Fixture::new(35);
    fixture.reserve().unwrap();
    assert_eq!(fixture.begin(), Err(expert::ErrorCode::Busy));
    let count: i64 = fixture
        .repo
        .as_ref()
        .unwrap()
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
fn feat158_unsettled_binding_prevents_reservation_until_original_attempt_settles() {
    let mut fixture = Fixture::new(35);
    fixture.begin().unwrap();
    assert_eq!(fixture.reserve(), Err(ExecutionErrorCode::ReservationBusy));
    for (failure, blocked) in [
        (experts::AttemptFailure::Unknown, true),
        (
            experts::AttemptFailure::Rejected(expert::ErrorCode::Busy),
            false,
        ),
    ] {
        let repo = fixture.repo.as_mut().unwrap();
        let tx = repo.connection.transaction().unwrap();
        experts::fail_attempt(
            &tx,
            &repo.scope,
            &fixture.binding.session_id,
            &fixture.binding.operation_id,
            failure,
            NOW,
        )
        .unwrap();
        tx.commit().unwrap();
        assert_eq!(foreground_busy(&repo.connection).unwrap(), blocked);
        if blocked {
            assert_eq!(fixture.reserve(), Err(ExecutionErrorCode::ReservationBusy));
        }
    }
    fixture.reserve().unwrap();
}

#[test]
fn feat158_old_schema_without_expert_storage_keeps_normal_reservation() {
    let mut fixture = Fixture::new(33);
    assert!(!experts::any_unsettled(&fixture.repo.as_ref().unwrap().connection).unwrap());
    fixture.reserve().unwrap();
}
