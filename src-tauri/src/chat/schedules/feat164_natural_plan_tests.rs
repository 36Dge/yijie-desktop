//! Explicit two-build normal API producer/reader. Never edits historical rows.
use super::{execution_generated::*, generated::*, ScheduleAuthority, ScheduleStorageMode};
use crate::chat::{ChatRepository, ChatScope, DatabaseKey, ReceiptKey};
use crate::local_profile::{DEMO_FAST_OWNER_USER_ID, DEMO_FAST_TENANT_ID};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use uuid::Uuid;

#[derive(Serialize, Deserialize)]
struct Handoff {
    plan: PlanView,
    enabled: PlanView,
    minimax: PlanView,
    confirmation: GrantConfirmation,
    grant: GrantView,
    facts: Vec<(String, Vec<String>)>,
    schema: i64,
}

fn open(root: &Path) -> ChatRepository {
    try_open(root).unwrap()
}
fn try_open(root: &Path) -> Result<ChatRepository, crate::chat::error::ChatError> {
    ChatRepository::open_with_schedule_storage(
        &root.join("chat"),
        &DatabaseKey::from_bytes([164; 32]),
        ReceiptKey::from_bytes([165; 32]),
        ChatScope::new(DEMO_FAST_OWNER_USER_ID.into(), DEMO_FAST_TENANT_ID.into()).unwrap(),
        ScheduleStorageMode::TimingFoundation,
    )
}
fn request(profile: PlanDefinitionModelProfile, name: &str) -> SavePlanRequest {
    SavePlanRequest {
        request_id: Uuid::now_v7().to_string(),
        plan_id: None,
        expected_revision: None,
        definition: PlanDefinition {
            model_profile: Some(profile),
            name: name.into(),
            content: "S4Q ordinary offline plan; no external resources".into(),
            rule: TimeRule {
                frequency: TimeRuleFrequency::Daily,
                time_zone: "Asia/Shanghai".into(),
                local_time: "09:00".into(),
                local_date: None,
                weekdays: None,
            },
            target: TargetReference {
                mode: TargetMode::NewChatEachRun,
                conversation_id: None,
            },
        },
    }
}
fn confirmation(plan: &PlanView, n: i64) -> GrantConfirmation {
    GrantConfirmation {
        request_id: Uuid::now_v7().to_string(),
        plan_id: plan.plan_id.clone(),
        expected_revision: plan.revision,
        max_runs: 2,
        expires_at: n + 3600,
    }
}
fn facts(r: &ChatRepository) -> Vec<(String, Vec<String>)> {
    [
        "chat_scheduled_grants",
        "chat_scheduled_runs",
        "chat_scheduled_recovery",
        "chat_scheduled_reservation",
        "chat_scheduled_requests",
        "chat_operation_models",
        "chat_scheduled_run_bindings",
        "chat_outbox",
        "chat_public_task_bindings",
    ]
    .iter()
    .map(|table| {
        let mut q = r
            .connection
            .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
            .unwrap();
        let count = q.column_count();
        let rows = q
            .query_map([], |row| {
                let bytes = (0..count)
                    .map(|i| format!("{:?}", row.get_ref(i).unwrap()))
                    .collect::<Vec<_>>();
                Ok(format!(
                    "{:x}",
                    Sha256::digest(serde_json::to_vec(&bytes).unwrap())
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        (table.to_string(), rows)
    })
    .collect()
}
fn old_rows_preserved(r: &ChatRepository, original: &[(String, Vec<String>)]) {
    let current = facts(r);
    for (table, rows) in original {
        let found = &current.iter().find(|(t, _)| t == table).unwrap().1;
        assert!(
            rows.iter().all(|row| found.contains(row)),
            "old rows changed: {table}"
        );
    }
}

#[test]
#[ignore = "explicit retained root; run legacy producer then candidate upgrade and reopen"]
fn feat164_natural_plan_upgrade() {
    let root = std::path::PathBuf::from(std::env::var("YIJIE_FEAT164_PLAN_ROOT").unwrap());
    assert!(
        root.is_absolute()
            && root
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("feat164-natural-plans-")
    );
    let phase = std::env::var("YIJIE_FEAT164_PLAN_PHASE").unwrap();
    let n = chrono::Utc::now().timestamp();
    let authority = ScheduleAuthority::local(n).unwrap();
    for held in [false, true] {
        let dir = root.join(if held { "held" } else { "review" });
        let handoff = dir.join("legacy.json");
        if phase == "produce" {
            assert_eq!(crate::chat::models::schema_version(), 1);
            assert!(!dir.exists());
            std::fs::create_dir_all(&dir).unwrap();
            let mut r = open(&dir);
            let p = r
                .save_schedule(
                    request(PlanDefinitionModelProfile::KimiK3MaxV1, "S4Q old paused"),
                    n,
                )
                .unwrap();
            let c = confirmation(&p, n);
            let g = r.confirm_schedule_grant(&authority, c.clone(), n).unwrap();
            let enabled = r
                .save_active_schedule(
                    &authority,
                    request(PlanDefinitionModelProfile::KimiK3MaxV1, "S4Q old enabled"),
                    n,
                )
                .unwrap();
            assert_eq!(enabled.state, PlanState::Enabled);
            let minimax = r
                .save_active_schedule(
                    &authority,
                    request(
                        PlanDefinitionModelProfile::MinimaxM3HighV1,
                        "S4Q MiniMax control",
                    ),
                    n,
                )
                .unwrap();
            if held {
                let run = r
                    .prepare_trigger_local(
                        &authority,
                        &g.grant_id,
                        p.revision,
                        &Uuid::now_v7().to_string(),
                        &super::triggers::Trigger::Manual,
                        n,
                    )
                    .unwrap();
                std::fs::write(
                    dir.join("held-run.json"),
                    serde_json::to_vec_pretty(&run).unwrap(),
                )
                .unwrap();
            }
            let saved = Handoff {
                plan: r.read_schedule(&p.plan_id).unwrap(),
                enabled,
                minimax,
                confirmation: c,
                grant: g,
                facts: facts(&r),
                schema: r.schema_version().unwrap(),
            };
            std::fs::write(&handoff, serde_json::to_vec_pretty(&saved).unwrap()).unwrap();
            drop(r);
        } else if phase == "admission" {
            assert_eq!(crate::chat::models::schema_version(), 2);
            let file = dir.join("chat/conversations.db");
            let before = std::fs::read(&file).unwrap();
            assert!(matches!(
                try_open(&dir),
                Err(crate::chat::error::ChatError::OrchestrationUnavailable)
            ));
            assert_eq!(std::fs::read(&file).unwrap(), before);
        } else if phase == "expand" {
            // Deliberately separate from candidate App open: that entry rejects
            // old stores until a reviewed cutover entrance exists. This opt-in
            // test exercises the existing migration authority on its own data.
            assert_eq!(crate::chat::models::schema_version(), 1);
            let saved: Handoff = serde_json::from_slice(&std::fs::read(&handoff).unwrap()).unwrap();
            let mut r = open(&dir);
            assert_eq!(r.schema_version().unwrap(), saved.schema);
            assert_eq!(facts(&r), saved.facts);
            crate::chat::migrations::migrate_to_target(&mut r.connection, 38).unwrap();
            assert_eq!(r.schema_version().unwrap(), 38);
            assert_eq!(facts(&r), saved.facts);
            assert_eq!(r.read_schedule(&saved.plan.plan_id).unwrap(), saved.plan);
            assert_eq!(
                r.read_schedule(&saved.enabled.plan_id).unwrap(),
                saved.enabled
            );
            drop(r);
        } else {
            assert!(cfg!(feature = "kimi-k31-pro-candidate") && crate::chat::models::v2_enabled());
            let saved: Handoff = serde_json::from_slice(&std::fs::read(&handoff).unwrap()).unwrap();
            let mut r = open(&dir);
            assert_eq!(r.schema_version().unwrap(), 41);
            assert_eq!(
                r.read_schedule(&saved.minimax.plan_id).unwrap(),
                saved.minimax
            );
            old_rows_preserved(&r, &saved.facts);
            if phase == "upgrade" {
                for old in [&saved.plan, &saved.enabled] {
                    let retired = r.read_schedule(&old.plan_id).unwrap();
                    assert_eq!(retired.definition, old.definition);
                    assert_eq!(retired.revision, old.revision + 1);
                    assert_eq!(retired.state, PlanState::Paused);
                    assert!(retired.authorization_ref.is_none() && retired.next_at.is_none());
                }
                assert_eq!(
                    facts(&r),
                    saved.facts,
                    "startup cannot refund or rewrite old facts"
                );
                assert!(r.claim_next_conversation_outbox(n, 30).unwrap().is_none());
                assert_eq!(
                    r.confirm_schedule_grant(&authority, saved.confirmation.clone(), n)
                        .unwrap()
                        .state,
                    GrantState::Stale
                );
                if held {
                    assert_eq!(
                        r.confirm_schedule_grant(&authority, saved.confirmation.clone(), n)
                            .unwrap()
                            .occupied_runs,
                        1
                    );
                }
                assert!(r
                    .prepare_trigger_local(
                        &authority,
                        &saved.grant.grant_id,
                        saved.plan.revision,
                        &Uuid::now_v7().to_string(),
                        &super::triggers::Trigger::Manual,
                        n
                    )
                    .is_err());
                #[cfg(feature = "kimi-k31-pro-candidate")]
                if !held {
                    let retired = r.read_schedule(&saved.plan.plan_id).unwrap();
                    let mut q = request(
                        PlanDefinitionModelProfile::KimiK31ProMaxV1,
                        "S4Q explicitly reviewed",
                    );
                    q.plan_id = Some(retired.plan_id.clone());
                    q.expected_revision = Some(retired.revision);
                    let revised = r.save_active_schedule(&authority, q, n).unwrap();
                    assert_eq!(revised.state, PlanState::Paused);
                    assert!(revised.authorization_ref.is_none());
                    assert_eq!(revised.revision, retired.revision + 1);
                    let c = confirmation(&revised, n);
                    let fresh = r.confirm_schedule_grant(&authority, c.clone(), n).unwrap();
                    assert_ne!(fresh.grant_id, saved.grant.grant_id);
                    assert_ne!(fresh.definition_digest, saved.grant.definition_digest);
                    assert_eq!(fresh.occupied_runs, 0);
                    let run = r
                        .prepare_trigger_local(
                            &authority,
                            &fresh.grant_id,
                            revised.revision,
                            &Uuid::now_v7().to_string(),
                            &super::triggers::Trigger::Manual,
                            n,
                        )
                        .unwrap();
                    assert_eq!(
                        r.model_operation_profile(Uuid::parse_str(&run.operation_id).unwrap())
                            .unwrap()
                            .as_deref(),
                        Some("kimi-k3-1-pro-max-v1")
                    );
                    r.cancel_unsent_schedule(&authority, &run.run_id, n)
                        .unwrap();
                    let cancelled = facts(&r);
                    r.cancel_unsent_schedule(&authority, &run.run_id, n + 1)
                        .unwrap();
                    assert_eq!(facts(&r), cancelled);
                    assert_eq!(
                        r.confirm_schedule_grant(&authority, c, n)
                            .unwrap()
                            .occupied_runs,
                        0
                    );
                }
                old_rows_preserved(&r, &saved.facts);
                let current = r.read_schedule(&saved.plan.plan_id).unwrap();
                std::fs::write(
                    dir.join("after.json"),
                    serde_json::to_vec_pretty(&(current, facts(&r))).unwrap(),
                )
                .unwrap();
            } else {
                assert_eq!(phase, "reopen");
                let (plan, facts_before): (PlanView, Vec<(String, Vec<String>)>) =
                    serde_json::from_slice(&std::fs::read(dir.join("after.json")).unwrap())
                        .unwrap();
                assert_eq!(r.read_schedule(&saved.plan.plan_id).unwrap(), plan);
                assert_eq!(facts(&r), facts_before);
                assert!(r.claim_next_conversation_outbox(n, 30).unwrap().is_none());
            }
            let receipts: i64 = r
                .connection
                .query_row(
                    "SELECT count(*) FROM chat_plan_model_retirements",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(receipts, 2);
            drop(r);
        }
    }
    println!("S4Q_NATURAL_PLAN_PASS phase={phase}; product API writes only; external/model HTTP=0; roots retained");
}
