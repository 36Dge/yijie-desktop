//! Declared native clock/lifecycle events, temporary SQLCipher and the same HTTP fixture.
use super::*;
use crate::chat::{
    lifecycle::Phase,
    schedules::{EnableReceipt, ScheduleAuthority},
};
use chrono::{TimeZone, Utc};
fn definition(
    at: i64,
    frequency: TimeRuleFrequency,
    mode: TargetMode,
    chat: Option<String>,
) -> PlanDefinition {
    let dt = Utc.timestamp_opt(at, 0).unwrap();
    PlanDefinition {
        name: "自动合成".into(),
        content: "只用于进程内组合检查".into(),
        target: TargetReference {
            mode,
            conversation_id: chat,
        },
        rule: TimeRule {
            frequency,
            time_zone: "UTC".into(),
            local_time: dt.format("%H:%M").to_string(),
            local_date: (frequency == TimeRuleFrequency::Once)
                .then(|| dt.format("%Y-%m-%d").to_string()),
            weekdays: None,
        },
    }
}
impl Fixture {
    async fn enable_current_at(
        &self,
        at: i64,
        mode: TargetMode,
        chat: Option<String>,
    ) -> EnableReceipt {
        let host = self.app.host().unwrap().instance_nonce().to_owned();
        let epoch = self.gate.epoch();
        self.db
            .call(move |r| {
                let n = at - 10;
                r.manual_runtime.observe_host(Some((host, epoch)));
                let p = r
                    .save_schedule(
                        SavePlanRequest {
                            request_id: Uuid::now_v7().to_string(),
                            plan_id: None,
                            expected_revision: None,
                            definition: definition(at, TimeRuleFrequency::Daily, mode, chat),
                        },
                        n,
                    )
                    .unwrap();
                Ok(r.confirm_automatic_schedule(
                    &ScheduleAuthority::local(n).unwrap(),
                    crate::chat::schedules::ipc_generated::EnableConfirmation {
                        confirmation: GrantConfirmation {
                            request_id: Uuid::now_v7().to_string(),
                            plan_id: p.plan_id,
                            expected_revision: p.revision,
                            max_runs: 1,
                            expires_at: at + 600,
                        },
                        expected_next_at: at,
                    },
                    n,
                )
                .unwrap())
            })
            .await
            .unwrap()
    }
}

#[tokio::test]
async fn feat155_4c2_current_automatic_three_targets_no_manual_permit_and_last_debit() {
    for mode in [
        TargetMode::DedicatedChat,
        TargetMode::NewChatEachRun,
        TargetMode::ExistingChat,
    ] {
        let f = Fixture::new_options(false, false, true).await;
        let chat = if mode == TargetMode::ExistingChat {
            let (run, ui) =
                super::manual_composition_tests::prepare(&f, TargetMode::DedicatedChat, None).await;
            f.local_binding().await;
            f.create().await;
            f.turn().await;
            f.finish(&run).await;
            ui.invalidate_all().unwrap();
            f.server.state.lock().unwrap().turn = Uuid::now_v7();
            Some(f.binding(&run).await.0.to_string())
        } else {
            None
        };
        let at = unix_seconds().unwrap() / 60 * 60;
        f.continuous(at - 20).await;
        let enabled = f.enable_current_at(at, mode, chat).await;
        // Automatic consent does not depend on manual actions or renderer refresh.
        f.db.call(|r| {
            r.manual_runtime.observe_host(None);
            Ok(())
        })
        .await
        .unwrap();
        let before = f.counts().await;
        f.due(at).await;
        f.due(at).await;
        let run = f.run_for(&enabled.plan.plan_id).await;
        assert_eq!(run.trigger, RunTrigger::Automatic);
        assert_eq!(f.counts().await, (before.0 + 1, 1, before.2 + 1));
        f.db.call(move |r| {
            r.expire_manual(unix_seconds()?)?;
            assert_eq!(r.automatic_startup_work(unix_seconds()?)?, (false, true));
            Ok(())
        })
        .await
        .unwrap();
        if mode != TargetMode::ExistingChat {
            f.local_binding().await;
            f.create().await;
        }
        f.turn().await;
        f.finish(&run).await;
        assert_eq!(
            f.service
                .read_grant(run.grant_id)
                .await
                .unwrap()
                .occupied_runs,
            1
        );
        assert_eq!(
            f.db.call(|r| r.automatic_startup_work(unix_seconds()?))
                .await
                .unwrap(),
            (false, false)
        );
        f.close().await;
    }
}

#[tokio::test]
async fn feat155_4c2_pause_before_post_cancels_once() {
    let f = Fixture::new_options(false, false, true).await;
    let at = unix_seconds().unwrap() / 60 * 60;
    f.continuous(at - 20).await;
    let enabled = f
        .enable_current_at(at, TargetMode::DedicatedChat, None)
        .await;
    f.due(at).await;
    let run = f.run_for(&enabled.plan.plan_id).await;
    f.local_binding().await;
    let db = f.db.clone();
    let plan = enabled.plan.clone();
    f.server.state.lock().unwrap().on_ready = Some(Box::new(move || {
        Box::pin(async move {
            db.call(move |r| {
                r.pause_schedule(&plan.plan_id, plan.revision).unwrap();
                Ok(())
            })
            .await
            .unwrap();
        })
    }));
    let _ = f.app.dispatch_next().await;
    assert_eq!(f.server.state.lock().unwrap().posts(), 0);
    f.db.call(|r| {
        r.expire_automatic(unix_seconds()?)?;
        r.expire_automatic(unix_seconds()?)?;
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(
        f.service
            .read_grant(run.grant_id)
            .await
            .unwrap()
            .occupied_runs,
        0
    );
    assert_eq!(f.counts().await.1, 0);
    f.close().await;
}

#[tokio::test]
async fn feat155_4c2_recovery_clocks_and_old_run_never_replay() {
    let f = Fixture::new_options(false, false, true).await;
    let at = unix_seconds().unwrap() / 60 * 60;
    f.continuous(at - 20).await;
    let enabled = f
        .enable_current_at(at, TargetMode::DedicatedChat, None)
        .await;
    f.due(at).await;
    let run = f.run_for(&enabled.plan.plan_id).await;
    // Normal lifecycle discontinuity invalidates the original unsent slot.
    f.gate.transition(Phase::Recovering);
    f.db.call(|r| {
        r.expire_automatic(unix_seconds()?)?;
        r.expire_automatic(unix_seconds()?)?;
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(
        f.service.read_run(run.run_id).await.unwrap().delivery_state,
        DeliveryState::Cancelled
    );
    assert_eq!(
        f.service
            .read_grant(run.grant_id)
            .await
            .unwrap()
            .occupied_runs,
        0
    );
    assert_eq!(f.server.state.lock().unwrap().posts(), 0);
    f.close().await;
}
impl Fixture {
    async fn enable_at(
        &self,
        at: i64,
        frequency: TimeRuleFrequency,
        mode: TargetMode,
        chat: Option<String>,
        max: i64,
    ) -> EnableReceipt {
        self.db
            .call(move |r| {
                let n = at - 10;
                let p = r
                    .save_schedule(
                        SavePlanRequest {
                            request_id: Uuid::now_v7().to_string(),
                            plan_id: None,
                            expected_revision: None,
                            definition: definition(at, frequency, mode, chat),
                        },
                        n,
                    )
                    .unwrap();
                Ok(r.enable_schedule(
                    &ScheduleAuthority::local(n).unwrap(),
                    GrantConfirmation {
                        request_id: Uuid::now_v7().to_string(),
                        plan_id: p.plan_id,
                        expected_revision: p.revision,
                        max_runs: max,
                        expires_at: at + 86400 * 3,
                    },
                    n,
                )
                .unwrap())
            })
            .await
            .unwrap()
    }
    async fn continuous(&self, since: i64) {
        let n = unix_seconds().unwrap();
        self.gate.observe_clock_at(
            since,
            std::time::Instant::now() - Duration::from_secs((n - since) as u64),
        );
        let gate = self.gate.clone();
        self.db
            .call(move |r| {
                r.trigger_clock_tick(&gate, since)?;
                Ok(())
            })
            .await
            .unwrap();
        self.gate.ready(self.gate.epoch());
        assert!(self.gate.ticket().is_ok());
    }
    async fn due(&self, at: i64) {
        let gate = self.gate.clone();
        let due = self
            .db
            .call(move |r| r.trigger_clock_tick(&gate, at))
            .await
            .unwrap();
        for c in due {
            let duplicate = c.clone();
            let (first, second) = tokio::join!(
                self.db.call(move |r| r.process_schedule_due(c, None, at)),
                self.db
                    .call(move |r| r.process_schedule_due(duplicate, None, at))
            );
            first.unwrap();
            second.unwrap();
        }
    }
    async fn run_for(&self, p: &str) -> RunView {
        let p = p.to_string();
        let id=self.db.call(move|r|Ok(r.connection.query_row("SELECT run_id FROM chat_scheduled_runs WHERE plan_id=?1 ORDER BY run_id DESC LIMIT 1",[p],|r|r.get::<_,String>(0)).unwrap())).await.unwrap();
        self.service.read_run(id).await.unwrap()
    }
    async fn disposition(&self, p: &str) -> (String, Option<String>) {
        let p = p.to_string();
        self.db.call(move|r|Ok(r.connection.query_row("SELECT disposition,run_id FROM chat_scheduled_occurrences WHERE plan_id=?1 ORDER BY scheduled_at LIMIT 1",[p],|r|Ok((r.get(0)?,r.get(1)?))).unwrap())).await.unwrap()
    }
    async fn counts(&self) -> (i64, i64, i64) {
        self.db
            .call(|r| {
                Ok((
                    r.connection
                        .query_row("SELECT count(*) FROM chat_scheduled_runs", [], |r| r.get(0))
                        .unwrap(),
                    r.connection
                        .query_row("SELECT count(*) FROM chat_scheduled_reservation", [], |r| {
                            r.get(0)
                        })
                        .unwrap(),
                    r.connection
                        .query_row(
                            "SELECT COALESCE(sum(occupied_runs),0) FROM chat_scheduled_grants",
                            [],
                            |r| r.get(0),
                        )
                        .unwrap(),
                ))
            })
            .await
            .unwrap()
    }
}
#[tokio::test]
async fn feat155_3c2_enable_atomic_final_revision_replay_and_no_silent_topup() {
    let f = Fixture::new_mode(true, true).await;
    let at = (unix_seconds().unwrap() / 60 + 5) * 60;
    let p = f
        .service
        .save_plan(
            f.context,
            SavePlanRequest {
                request_id: Uuid::now_v7().to_string(),
                plan_id: None,
                expected_revision: None,
                definition: definition(
                    at,
                    TimeRuleFrequency::Once,
                    TargetMode::DedicatedChat,
                    None,
                ),
            },
        )
        .await
        .unwrap();
    let c = GrantConfirmation {
        request_id: Uuid::now_v7().to_string(),
        plan_id: p.plan_id.clone(),
        expected_revision: p.revision,
        max_runs: 1,
        expires_at: at + 3600,
    };
    let first = f
        .service
        .confirm_and_enable(f.context, c.clone())
        .await
        .unwrap();
    assert_eq!(first.plan.revision, p.revision + 1);
    assert_eq!(first.grant.plan_revision, first.plan.revision);
    assert_eq!(first.plan.schedule_epoch, p.schedule_epoch);
    assert_eq!(f.counts().await, (0, 0, 0));
    let mut another = c.clone();
    another.request_id = Uuid::now_v7().to_string();
    another.expected_revision = first.plan.revision;
    assert_eq!(
        f.service
            .confirm_and_enable(f.context, another)
            .await
            .unwrap_err(),
        ExecutionErrorCode::RequestConflict
    );
    let paused = f
        .service
        .pause_plan(f.context, p.plan_id.clone(), first.plan.revision)
        .await
        .unwrap();
    let replay = f.service.confirm_and_enable(f.context, c).await.unwrap();
    assert_eq!(replay.plan, paused);
    assert_eq!(replay.grant.grant_id, first.grant.grant_id);
    assert_eq!(replay.grant.state, GrantState::Stale);
    assert_eq!(f.server.state.lock().unwrap().posts(), 0);
    f.close().await;
}
#[tokio::test]
async fn feat155_3c2_three_automatic_targets_dedup_and_last_debit() {
    for mode in [
        TargetMode::DedicatedChat,
        TargetMode::NewChatEachRun,
        TargetMode::ExistingChat,
    ] {
        let f = Fixture::new_mode(true, true).await;
        let chat = if mode == TargetMode::ExistingChat {
            let (_, _, run) = f.prepare(TargetMode::DedicatedChat, None, 1).await;
            f.local_binding().await;
            f.create().await;
            f.turn().await;
            f.finish(&run).await;
            f.server.state.lock().unwrap().turn = Uuid::now_v7();
            Some(f.binding(&run).await.0.to_string())
        } else {
            None
        };
        let at = unix_seconds().unwrap() / 60 * 60;
        f.continuous(at - 20).await;
        let enabled = f
            .enable_at(at, TimeRuleFrequency::Once, mode, chat, 1)
            .await;
        // No early run/outbox/debit; the candidate is only a future occurrence.
        let before = f.counts().await;
        f.due(at).await;
        f.due(at).await;
        let run = f.run_for(&enabled.plan.plan_id).await;
        assert_eq!(run.trigger, RunTrigger::Automatic);
        assert_eq!(f.counts().await, (before.0 + 1, 1, before.2 + 1));
        assert_eq!(
            f.disposition(&enabled.plan.plan_id).await,
            ("consumed".into(), Some(run.run_id.clone()))
        );
        let p = f
            .service
            .list_plans()
            .await
            .unwrap()
            .into_iter()
            .find(|p| p.plan_id == enabled.plan.plan_id)
            .unwrap();
        assert_eq!(p.state, PlanState::Enabled);
        assert_eq!(p.next_at, None);
        if mode != TargetMode::ExistingChat {
            f.local_binding().await;
            f.create().await;
        }
        f.turn().await;
        f.finish(&run).await;
        let p = f
            .service
            .list_plans()
            .await
            .unwrap()
            .into_iter()
            .find(|p| p.plan_id == enabled.plan.plan_id)
            .unwrap();
        assert_eq!(p.state, PlanState::Completed);
        f.close().await;
    }
}
#[tokio::test]
async fn feat155_3c2_busy_late_offline_and_bounded_batches() {
    let f = Fixture::new_mode(true, true).await;
    let at = unix_seconds().unwrap() / 60 * 60;
    f.continuous(at - 20).await;
    let mut plans = vec![];
    for _ in 0..35 {
        plans.push(
            f.enable_at(
                at,
                TimeRuleFrequency::Daily,
                TargetMode::DedicatedChat,
                None,
                2,
            )
            .await
            .plan
            .plan_id,
        );
    }
    f.due(at).await;
    assert_eq!(f.counts().await, (1, 1, 1));
    let first=f.db.call(|r|Ok(r.connection.query_row("SELECT count(*) FROM chat_scheduled_occurrences WHERE disposition IN ('consumed','busy')",[],|r|r.get::<_,i64>(0)).unwrap())).await.unwrap();
    assert_eq!(first, 32);
    f.due(at).await;
    assert_eq!(f.counts().await, (1, 1, 1));
    let busy =
        f.db.call(|r| {
            Ok(r.connection
                .query_row(
                    "SELECT count(*) FROM chat_scheduled_occurrences WHERE disposition='busy'",
                    [],
                    |r| r.get::<_, i64>(0),
                )
                .unwrap())
        })
        .await
        .unwrap();
    assert_eq!(busy, 34);
    f.close().await;
    for (delay, recovered, expected) in [(61, false, "missed_late"), (30, true, "missed_offline")] {
        let f = Fixture::new_mode(true, true).await;
        f.continuous(at - 20).await;
        let p = f
            .enable_at(
                at,
                TimeRuleFrequency::Once,
                TargetMode::DedicatedChat,
                None,
                1,
            )
            .await
            .plan;
        if recovered {
            f.gate.transition(Phase::Suspended);
            f.gate.transition(Phase::Recovering);
            f.gate.observe_clock(at + delay);
        }
        f.due(at + delay).await;
        assert_eq!(f.disposition(&p.plan_id).await.0, expected);
        assert_eq!(f.counts().await, (0, 0, 0));
        assert_eq!(
            f.service.list_plans().await.unwrap()[0].state,
            PlanState::Completed
        );
        f.close().await;
    }
}
#[tokio::test]
async fn feat155_3c2_expiry_never_refunds_once_but_created_never_turn_does_not() {
    for created in [false, true] {
        let f = Fixture::new_mode(true, true).await;
        let at = unix_seconds().unwrap() / 60 * 60;
        f.continuous(at - 20).await;
        let e = f
            .enable_at(
                at,
                TimeRuleFrequency::Once,
                TargetMode::DedicatedChat,
                None,
                1,
            )
            .await;
        f.due(at).await;
        let run = f.run_for(&e.plan.plan_id).await;
        if created {
            f.local_binding().await;
            f.create().await;
        }
        f.db.call(move |r| r.expire_automatic(at + 61))
            .await
            .unwrap();
        f.db.call(move |r| r.expire_automatic(at + 62))
            .await
            .unwrap();
        assert_eq!(f.app.dispatch_next().await.unwrap(), DispatchOutcome::Idle);
        let r = f.service.read_run(run.run_id.clone()).await.unwrap();
        if created {
            assert!(r.needs_attention);
            assert_eq!(f.counts().await, (1, 1, 1));
            assert_eq!(f.server.state.lock().unwrap().posts(), 1);
        } else {
            assert_eq!(r.delivery_state, DeliveryState::Cancelled);
            assert_eq!(f.counts().await, (1, 0, 0));
            assert_eq!(
                f.disposition(&e.plan.plan_id).await,
                ("missed_late".into(), Some(run.run_id))
            );
        }
        f.close().await;
    }
}
#[tokio::test]
async fn feat155_3c2_rerun_diff_confirmation_idempotence_and_history_unchanged() {
    let f = Fixture::new_mode(true, true).await;
    let (p, g, original) = f.prepare(TargetMode::DedicatedChat, None, 3).await;
    f.local_binding().await;
    f.create().await;
    f.turn().await;
    f.finish(&original).await;
    let old = f.service.read_run(original.run_id.clone()).await.unwrap();
    let preview = f
        .service
        .preview_rerun(original.run_id.clone())
        .await
        .unwrap();
    assert_eq!(preview.original, preview.current);
    let request = Uuid::now_v7().to_string();
    let rerun = f
        .service
        .confirm_rerun(f.context, preview.confirmation.clone(), request.clone())
        .await
        .unwrap();
    assert_eq!(rerun.trigger, RunTrigger::Rerun);
    assert_eq!(rerun.original_run_id, Some(original.run_id.clone()));
    assert_ne!(rerun.operation_id, old.operation_id);
    assert_eq!(
        f.service
            .confirm_rerun(f.context, preview.confirmation, request.clone())
            .await
            .unwrap(),
        rerun
    );
    assert_eq!(
        f.service
            .prepare_manual(g.grant_id.clone(), p.revision, request)
            .await
            .unwrap_err(),
        ExecutionErrorCode::RequestConflict
    );
    assert_eq!(
        f.service.read_run(original.run_id.clone()).await.unwrap(),
        old
    );
    f.service.cancel_unsent(rerun.run_id).await.unwrap();
    let preview = f
        .service
        .preview_rerun(original.run_id.clone())
        .await
        .unwrap();
    let mut changed = p.definition.clone();
    changed.content = "新的当前正文".into();
    let edited = f
        .service
        .save_plan(
            f.context,
            SavePlanRequest {
                request_id: Uuid::now_v7().to_string(),
                plan_id: Some(p.plan_id.clone()),
                expected_revision: Some(p.revision),
                definition: changed,
            },
        )
        .await
        .unwrap();
    assert!(f
        .service
        .confirm_rerun(f.context, preview.confirmation, Uuid::now_v7().to_string())
        .await
        .is_err());
    f.service
        .confirm_grant(
            f.context,
            GrantConfirmation {
                request_id: Uuid::now_v7().to_string(),
                plan_id: p.plan_id.clone(),
                expected_revision: edited.revision,
                max_runs: 1,
                expires_at: unix_seconds().unwrap() + 3600,
            },
        )
        .await
        .unwrap();
    let preview = f
        .service
        .preview_rerun(original.run_id.clone())
        .await
        .unwrap();
    assert_ne!(preview.original.content, preview.current.content);
    f.service
        .delete_plan(f.context, p.plan_id, edited.revision)
        .await
        .unwrap();
    assert_eq!(
        f.service.preview_rerun(original.run_id).await.unwrap_err(),
        ExecutionErrorCode::NotFound
    );
    f.close().await;
}

#[tokio::test]
async fn feat155_3c2_unknown_hold_survives_release_and_requires_new_enable_confirmation() {
    let f = Fixture::new_mode(true, true).await;
    let (p, _, run) = f.prepare(TargetMode::DedicatedChat, None, 2).await;
    f.local_binding().await;
    f.create().await;
    f.server.state.lock().unwrap().reject = true;
    f.app.dispatch_next().await.unwrap();
    let rid = run.run_id.clone();
    let pid = p.plan_id.clone();
    f.db.call(move |r| {
        assert_eq!(
            r.connection
                .query_row(
                    "SELECT future_hold FROM chat_scheduled_plans WHERE plan_id=?1",
                    [pid],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "unknown"
        );
        assert!(r
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM chat_scheduled_reservation WHERE run_id=?1)",
                [rid],
                |r| r.get::<_, bool>(0)
            )
            .unwrap());
        Ok(())
    })
    .await
    .unwrap();
    let request = GrantConfirmation {
        request_id: Uuid::now_v7().to_string(),
        plan_id: p.plan_id.clone(),
        expected_revision: p.revision,
        max_runs: 2,
        expires_at: unix_seconds().unwrap() + 3600,
    };
    assert_eq!(
        f.service
            .confirm_and_enable(f.context, request.clone())
            .await
            .unwrap_err(),
        ExecutionErrorCode::ReservationBusy
    );
    let nonce = f.app.host().unwrap().instance_nonce().to_string();
    let id = run.run_id.clone();
    f.db.call(move |r| {
        let n = unix_seconds()?;
        r.record_stopped_schedule_generation(&nonce)?;
        r.release_stopped_schedule(
            &ScheduleAuthority::local(n).unwrap(),
            &id,
            &Uuid::now_v7().to_string(),
            n,
        )
    })
    .await
    .unwrap();
    assert_eq!(
        f.service
            .read_run(run.run_id.clone())
            .await
            .unwrap()
            .delivery_state,
        DeliveryState::Uncertain
    );
    let pid = p.plan_id.clone();
    f.db.call(move |r| {
        assert_eq!(
            r.connection
                .query_row(
                    "SELECT future_hold FROM chat_scheduled_plans WHERE plan_id=?1",
                    [pid],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "unknown"
        );
        Ok(())
    })
    .await
    .unwrap();
    let enabled = f
        .service
        .confirm_and_enable(f.context, request.clone())
        .await
        .unwrap();
    assert_eq!(enabled.future_hold, None);
    // A new attempted unknown needs another explicit confirmation; the old receipt cannot clear it.
    let next = f
        .service
        .prepare_manual(
            enabled.grant.grant_id.clone(),
            enabled.plan.revision,
            Uuid::now_v7().to_string(),
        )
        .await
        .unwrap();
    f.app.dispatch_next().await.unwrap();
    assert!(
        f.service
            .read_run(next.run_id)
            .await
            .unwrap()
            .needs_attention
    );
    assert_eq!(
        f.service
            .confirm_and_enable(f.context, request)
            .await
            .unwrap()
            .future_hold
            .as_deref(),
        Some("unknown")
    );
    f.close().await;
}
#[tokio::test]
async fn feat155_3c2_pending_approval_is_not_unknown_and_wake_recovery_ignores_old_run() {
    let f = Fixture::new_mode(true, true).await;
    let (_, _, run) = f.prepare(TargetMode::DedicatedChat, None, 2).await;
    f.local_binding().await;
    f.create().await;
    f.turn().await;
    f.server.state.lock().unwrap().pending = true;
    *f.app.recovery_poll.lock().unwrap() = None;
    f.app.recover_schedule_once().await.unwrap();
    let pid = run.plan_id.clone();
    f.db.call(move |r| {
        assert_eq!(
            r.connection
                .query_row(
                    "SELECT future_hold FROM chat_scheduled_plans WHERE plan_id=?1",
                    [pid],
                    |r| r.get::<_, Option<String>>(0)
                )
                .unwrap(),
            None
        );
        Ok(())
    })
    .await
    .unwrap();
    // Save a different paused schedule while the original run remains held.
    let at = unix_seconds().unwrap() / 60 * 60;
    let p =
        f.db.call(move |r| {
            Ok(r.save_schedule(
                SavePlanRequest {
                    request_id: Uuid::now_v7().to_string(),
                    plan_id: None,
                    expected_revision: None,
                    definition: definition(
                        at,
                        TimeRuleFrequency::Daily,
                        TargetMode::DedicatedChat,
                        None,
                    ),
                },
                at - 10,
            )
            .unwrap())
        })
        .await
        .unwrap();
    f.gate.transition(Phase::Suspended);
    f.gate.transition(Phase::Recovering);
    f.app.native_schedule_tick().await.unwrap();
    assert_eq!(f.disposition(&p.plan_id).await.0, "skipped_paused");
    assert_eq!(f.counts().await.1, 1);
    f.close().await;
}
#[tokio::test]
async fn feat155_3c2_busy_after_create_never_sends_delayed_turn() {
    let f = Fixture::new_mode(true, true).await;
    let at = unix_seconds().unwrap() / 60 * 60;
    f.continuous(at - 20).await;
    let e = f
        .enable_at(
            at,
            TimeRuleFrequency::Daily,
            TargetMode::DedicatedChat,
            None,
            2,
        )
        .await;
    f.due(at).await;
    let run = f.run_for(&e.plan.plan_id).await;
    f.local_binding().await;
    f.create().await;
    f.server.state.lock().unwrap().pending = true;
    f.app.dispatch_next().await.unwrap();
    f.server.state.lock().unwrap().pending = false;
    let rid = run.run_id.clone();
    f.db.call(move |r| {
        assert_eq!(
            r.connection
                .query_row(
                    "SELECT send_closed_reason FROM chat_scheduled_trigger_facts WHERE run_id=?1",
                    [rid],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "busy"
        );
        assert!(r
            .claim_next_conversation_outbox(unix_seconds()? + 6, 30)?
            .is_none());
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(f.app.dispatch_next().await.unwrap(), DispatchOutcome::Idle);
    assert_eq!(f.server.state.lock().unwrap().posts(), 1);
    assert!(
        f.service
            .read_run(run.run_id)
            .await
            .unwrap()
            .needs_attention
    );
    assert_eq!(f.counts().await, (1, 1, 1));
    f.close().await;
}

#[tokio::test]
async fn feat155_3c2_clock_jump_compresses_years_and_rollback_never_rewinds() {
    let f = Fixture::new_mode(true, true).await;
    let at = unix_seconds().unwrap() / 60 * 60;
    f.continuous(at - 20).await;
    let e = f
        .enable_at(
            at,
            TimeRuleFrequency::Daily,
            TargetMode::DedicatedChat,
            None,
            2,
        )
        .await;
    let later = at + 86400 * 365 * 10;
    f.gate.observe_clock(later);
    f.due(later).await;
    assert_eq!(
        f.disposition(&e.plan.plan_id).await.0,
        "clock_discontinuity"
    );
    assert_eq!(f.counts().await, (0, 0, 0));
    let pid = e.plan.plan_id.clone();
    let next =
        f.db.call(move |r| {
            let count: i64 = r
                .connection
                .query_row(
                    "SELECT count(*) FROM chat_scheduled_occurrences WHERE plan_id=?1",
                    [&pid],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 2);
            Ok(r.read_schedule(&pid).unwrap().next_at.unwrap())
        })
        .await
        .unwrap();
    f.gate.ready(f.gate.epoch());
    f.gate.observe_clock(at - 300);
    f.due(at - 300).await;
    assert_eq!(f.service.list_plans().await.unwrap()[0].next_at, Some(next));
    assert_eq!(f.counts().await, (0, 0, 0));
    f.close().await;
}
#[tokio::test]
async fn feat155_3c2_automatic_ready_await_pause_sleep_stop_block_first_io() {
    for action in ["pause", "sleep", "stop"] {
        let f = Fixture::new_mode(true, true).await;
        let at = unix_seconds().unwrap() / 60 * 60;
        f.continuous(at - 20).await;
        let e = f
            .enable_at(
                at,
                TimeRuleFrequency::Once,
                TargetMode::DedicatedChat,
                None,
                1,
            )
            .await;
        f.due(at).await;
        f.local_binding().await;
        let gate = f.gate.clone();
        let service = f.service.clone();
        let context = f.context;
        let p = e.plan.clone();
        f.server.state.lock().unwrap().on_ready = Some(Box::new(move || {
            Box::pin(async move {
                match action {
                    "pause" => {
                        service
                            .pause_plan(context, p.plan_id, p.revision)
                            .await
                            .unwrap();
                    }
                    "sleep" => gate.transition(Phase::Suspended),
                    _ => gate.transition(Phase::Stopping),
                }
            })
        }));
        let _ = f.app.dispatch_next().await;
        assert_eq!(f.server.state.lock().unwrap().posts(), 0);
        f.db.call(|r| r.expire_automatic(unix_seconds()?))
            .await
            .unwrap();
        assert_eq!(f.counts().await, (1, 0, 0));
        f.close().await;
    }
}
#[tokio::test]
async fn feat155_3c2_long_sse_uses_same_tick_and_records_busy() {
    let f = Fixture::new_mode(true, true).await;
    let at = unix_seconds().unwrap() / 60 * 60;
    f.continuous(at - 20).await;
    let e = f
        .enable_at(
            at,
            TimeRuleFrequency::Daily,
            TargetMode::DedicatedChat,
            None,
            2,
        )
        .await;
    // The foreground/manual turn holds the original reservation before the timer ticks.
    let (_, _, run) = f.prepare(TargetMode::DedicatedChat, None, 2).await;
    f.local_binding().await;
    f.create().await;
    f.turn().await;
    f.server.state.lock().unwrap().complete = false;
    let db = f.db.clone();
    let pid = e.plan.plan_id.clone();
    f.server.state.lock().unwrap().on_stream = Some(Box::new(move || {
        Box::pin(async move {
            tokio::time::timeout(Duration::from_secs(4),async{
            loop {
                let pid=pid.clone();
                let busy=db.call(move|r|Ok(r.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_occurrences WHERE plan_id=?1 AND disposition='busy')",[pid],|r|r.get::<_,bool>(0)).unwrap())).await.unwrap();
                if busy{break}tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }).await.unwrap();
        })
    }));
    // Suppress a redundant Host recovery GET while this single-response fixture streams.
    *f.app.recovery_poll.lock().unwrap() = Some((f.gate.epoch(), std::time::Instant::now()));
    let (chat, _, _) = f.binding(&run).await;
    f.app.stream_active_turn(chat).await.unwrap();
    assert_eq!(f.disposition(&e.plan.plan_id).await.0, "busy");
    assert_eq!(f.server.state.lock().unwrap().posts(), 2);
    f.close().await;
}
#[tokio::test]
async fn feat155_3c2_original_coordinator_automatically_reaches_terminal_and_stops() {
    let f = Fixture::new_mode(true, true).await;
    let at = unix_seconds().unwrap() / 60 * 60;
    f.continuous(at - 20).await;
    let e = f
        .enable_at(
            at,
            TimeRuleFrequency::Daily,
            TargetMode::DedicatedChat,
            None,
            2,
        )
        .await;
    f.server.state.lock().unwrap().complete = false;
    let coordinator =
        ConversationCoordinator::start(f.app.clone(), Duration::from_millis(10)).unwrap();
    let pid = e.plan.plan_id.clone();
    let result=tokio::time::timeout(Duration::from_secs(8),async{
        loop {let pid=pid.clone();let done=f.db.call(move|r|Ok(r.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_runs WHERE plan_id=?1 AND native_outcome='completed')",[pid],|r|r.get::<_,bool>(0)).unwrap())).await.unwrap();if done{break}tokio::time::sleep(Duration::from_millis(20)).await;}
    }).await;
    coordinator.stop().await.unwrap();
    assert!(result.is_ok());
    assert_eq!(f.server.state.lock().unwrap().posts(), 2);
    assert_eq!(
        f.service.list_plans().await.unwrap()[0].state,
        PlanState::Enabled
    );
    f.close().await;
}

#[tokio::test]
async fn feat155_3c2_normal_reopen_cancels_never_auto_and_preserves_consumed_slot() {
    let f = Fixture::new_mode(true, true).await;
    let at = unix_seconds().unwrap() / 60 * 60;
    f.continuous(at - 20).await;
    let e = f
        .enable_at(
            at,
            TimeRuleFrequency::Daily,
            TargetMode::DedicatedChat,
            None,
            1,
        )
        .await;
    f.due(at).await;
    let run = f.run_for(&e.plan.plan_id).await;
    let Fixture {
        root,
        db,
        app,
        service,
        server,
        ..
    } = f;
    drop(app);
    drop(service);
    drop(db); // Normal worker drain and connection close.
    let gate = crate::chat::lifecycle::Lifecycle::default();
    let db = DatabaseWorker::start_schedule_trigger_candidate(
        root.join("chat"),
        scope(),
        Box::new(Keys),
        Box::new(Keys),
        authority(),
        gate.clone(),
    )
    .await
    .unwrap();
    let service = ScheduleExecutionService::new(
        db.clone(),
        authority(),
        ChatAuthorizationManager::new(&scope()).unwrap(),
    );
    db.call(|r| r.expire_automatic(unix_seconds()?))
        .await
        .unwrap();
    db.call(|r| r.expire_automatic(unix_seconds()?))
        .await
        .unwrap();
    let current = service.read_run(run.run_id.clone()).await.unwrap();
    assert_eq!(current.delivery_state, DeliveryState::Cancelled);
    let rid = run.run_id.clone();
    db.call(move |r| {
        assert_eq!(
            r.connection
                .query_row(
                    "SELECT run_id FROM chat_scheduled_occurrences WHERE run_id=?1",
                    [rid],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            run.run_id
        );
        assert_eq!(
            r.connection
                .query_row(
                    "SELECT sum(occupied_runs) FROM chat_scheduled_grants",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        Ok(())
    })
    .await
    .unwrap();
    assert!(db
        .claim_next_conversation_outbox(unix_seconds().unwrap(), 30)
        .await
        .unwrap()
        .is_none());
    assert_eq!(server.state.lock().unwrap().posts(), 0);
    drop(service);
    drop(db);
    server.stop.send(()).unwrap();
    server.join.await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
#[tokio::test]
async fn feat155_3c2_rerun_of_automatic_does_not_change_slot_cursor_or_original() {
    let f = Fixture::new_mode(true, true).await;
    let at = unix_seconds().unwrap() / 60 * 60;
    f.continuous(at - 20).await;
    let e = f
        .enable_at(
            at,
            TimeRuleFrequency::Daily,
            TargetMode::DedicatedChat,
            None,
            3,
        )
        .await;
    f.due(at).await;
    let run = f.run_for(&e.plan.plan_id).await;
    f.local_binding().await;
    f.create().await;
    f.turn().await;
    f.finish(&run).await;
    let read_clock = |pid: String| {
        move |r: &mut crate::chat::database::ChatRepository| {
            Ok(r.connection.query_row("SELECT cursor_at,next_at,(SELECT count(*) FROM chat_scheduled_occurrences WHERE plan_id=?1) FROM chat_scheduled_plans WHERE plan_id=?1",[pid],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,Option<i64>>(1)?,r.get::<_,i64>(2)?))).unwrap())
        }
    };
    let before = f.db.call(read_clock(e.plan.plan_id.clone())).await.unwrap();
    let original = f.service.read_run(run.run_id.clone()).await.unwrap();
    let preview = f.service.preview_rerun(run.run_id.clone()).await.unwrap();
    let rerun = f
        .service
        .confirm_rerun(f.context, preview.confirmation, Uuid::now_v7().to_string())
        .await
        .unwrap();
    if let Some(dir) = std::env::var_os("YIJIE_FEAT155_CONFORMANCE_DIR") {
        std::fs::write(
            PathBuf::from(dir).join("phase-3c2-trigger-producer.json"),
            serde_json::to_vec_pretty(&json!({"automatic":original,"rerun":rerun})).unwrap(),
        )
        .unwrap();
    }
    assert_eq!(
        f.db.call(read_clock(e.plan.plan_id.clone())).await.unwrap(),
        before
    );
    assert_eq!(f.service.read_run(run.run_id).await.unwrap(), original);
    f.server.state.lock().unwrap().turn = Uuid::now_v7();
    f.turn().await;
    f.finish(&rerun).await;
    assert_eq!(f.db.call(read_clock(e.plan.plan_id)).await.unwrap(), before);
    assert_eq!(
        f.service
            .read_grant(e.grant.grant_id)
            .await
            .unwrap()
            .occupied_runs,
        2
    );
    f.close().await;
}
#[tokio::test]
async fn feat155_3c2_paused_cancelled_cursors_do_not_starve_and_budget_requires_confirmation() {
    let f = Fixture::new_mode(true, true).await;
    let at = unix_seconds().unwrap() / 60 * 60;
    f.continuous(at - 20).await;
    let paused = f
        .enable_at(
            at,
            TimeRuleFrequency::Daily,
            TargetMode::DedicatedChat,
            None,
            1,
        )
        .await;
    f.service
        .pause_plan(f.context, paused.plan.plan_id.clone(), paused.plan.revision)
        .await
        .unwrap();
    f.due(at).await;
    let p = f.service.list_plans().await.unwrap()[0].clone();
    assert!(p.next_at.unwrap() > at);
    let enabled = f
        .enable_at(
            at,
            TimeRuleFrequency::Daily,
            TargetMode::DedicatedChat,
            None,
            1,
        )
        .await;
    f.due(at).await;
    let run = f.run_for(&enabled.plan.plan_id).await;
    f.local_binding().await;
    f.create().await;
    f.turn().await;
    f.finish(&run).await;
    let c = GrantConfirmation {
        request_id: Uuid::now_v7().to_string(),
        plan_id: enabled.plan.plan_id.clone(),
        expected_revision: enabled.plan.revision,
        max_runs: 1,
        expires_at: unix_seconds().unwrap() + 3600,
    };
    assert_eq!(
        f.service
            .confirm_grant(f.context, c.clone())
            .await
            .unwrap_err(),
        ExecutionErrorCode::RequestConflict
    );
    let renewed = f.service.confirm_and_enable(f.context, c).await.unwrap();
    assert_eq!(renewed.future_hold, None);
    assert_eq!(renewed.grant.occupied_runs, 0);
    assert_ne!(renewed.grant.grant_id, enabled.grant.grant_id);
    assert_eq!(renewed.plan.schedule_epoch, enabled.plan.schedule_epoch);
    f.close().await;
}
