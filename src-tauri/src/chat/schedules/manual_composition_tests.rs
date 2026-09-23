use super::*;

#[tokio::test]
async fn feat155_4d1_background_clock_reads_without_send_admission() {
    let f = Fixture::new_options(false, false, true).await;
    let (run, _) = prepare(&f, TargetMode::DedicatedChat, None).await;
    f.local_binding().await;
    f.create().await;
    f.turn().await;
    f.finish(&run).await;
    assert!(!f.app.host().unwrap().is_schedule_admitted());
    let posts = f.server.state.lock().unwrap().posts();
    let coordinator =
        ConversationCoordinator::start(f.app.clone(), Duration::from_millis(20)).unwrap();
    let result = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let id = run.run_id.clone();
            let fact: Option<String> =
                f.db.call(move |r| {
                    Ok(r.connection
                        .query_row(
                            "SELECT fact_json FROM chat_scheduled_timing WHERE run_id=?1",
                            [id],
                            |r| r.get(0),
                        )
                        .unwrap_or(None))
                })
                .await
                .unwrap();
            if let Some(fact) = fact {
                let value: Value = serde_json::from_str(&fact).unwrap();
                assert_eq!(value["started_at"]["value"], 0);
                assert_eq!(value["duration_ms"]["value"], 440);
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await;
    coordinator.stop().await.unwrap();
    assert!(
        result.is_ok(),
        "background timing collector did not read the completed run"
    );
    assert_eq!(f.server.state.lock().unwrap().posts(), posts);
    f.close().await;
}

pub(super) async fn prepare(
    f: &Fixture,
    mode: TargetMode,
    chat: Option<String>,
) -> (RunView, ChatAuthorizationManager) {
    let ui = ChatAuthorizationManager::new(&scope()).unwrap();
    let n = unix_seconds().unwrap();
    let context = ui
        .bind(
            AuthoritativeChatProjection::from_trusted_native_projection(
                Uuid::parse_str(DEMO_FAST_TENANT_ID).unwrap(),
                1,
                n + 240,
                demo_fast_capabilities(),
            )
            .unwrap(),
            n,
        )
        .unwrap()
        .context_id;
    f.app.native_schedule_tick().await.unwrap();
    let host = f.app.host().unwrap().instance_nonce().to_owned();
    let epoch = f.gate.epoch();
    f.db.call(move |r| {
        assert!(r.manual_runtime.enabled);
        r.manual_runtime.observe_host(Some((host, epoch)));
        Ok(())
    })
    .await
    .unwrap();
    let call = |name, payload: Value, id: Uuid| {
        crate::chat::schedules::ipc::execute_composition_fixture(
            &f.db,
            authority(),
            ui.clone(),
            crate::chat::schedules::ipc::ScheduleIpcRuntime::default(),
            json!({"schemaVersion":1,"requestId":id,"contextId":context,"payload":payload}),
            name,
        )
    };
    let id = Uuid::now_v7();
    let mut target = json!({"mode":mode});
    if let Some(c) = chat {
        target["conversation_id"] = json!(c);
    }
    let p=call("schedule_save_plan_v1",json!({"request_id":id,"definition":{"name":"一次手动合成","content":"仅回复完成","rule":{"frequency":"daily","time_zone":"Asia/Shanghai","local_time":"09:00"},"target":target}}),id).await.unwrap()["data"].clone();
    let id = Uuid::now_v7();
    let grant=call("schedule_confirm_grant_v1",json!({"request_id":id,"plan_id":p["plan_id"],"expected_revision":p["revision"],"max_runs":1,"expires_at":n+600}),id).await.unwrap()["data"].clone();
    let id = Uuid::now_v7();
    let payload = json!({"grant_id":grant["grant_id"],"revision":p["revision"]});
    let value = call("schedule_manual_run_v1", payload.clone(), id)
        .await
        .unwrap()["data"]
        .clone();
    assert_eq!(
        call("schedule_manual_run_v1", payload, id).await.unwrap()["data"],
        value
    );
    (serde_json::from_value(value).unwrap(), ui)
}

#[tokio::test]
async fn feat155_4c1_candidate_manual_three_targets_original_coordinator() {
    for mode in [TargetMode::DedicatedChat, TargetMode::NewChatEachRun] {
        let f = Fixture::new_options(false, false, true).await;
        let (run, _) = prepare(&f, mode, None).await;
        f.local_binding().await;
        f.create().await;
        f.turn().await;
        f.finish(&run).await;
        let chat = f.binding(&run).await.0;
        assert_eq!(f.server.state.lock().unwrap().posts(), 2);
        let grant = f.service.read_grant(run.grant_id.clone()).await.unwrap();
        assert_eq!(grant.occupied_runs, 1);
        assert_eq!(grant.state, GrantState::Exhausted);
        let pid = run.plan_id.clone();
        f.db.call(move |r| {
            assert_eq!(r.read_schedule(&pid).unwrap().state, PlanState::Paused);
            Ok(())
        })
        .await
        .unwrap();
        f.server.state.lock().unwrap().turn = Uuid::now_v7();
        let (second, _) = prepare(&f, TargetMode::ExistingChat, Some(chat.to_string())).await;
        assert_eq!(f.binding(&second).await.0, chat);
        f.turn().await;
        f.finish(&second).await;
        assert_eq!(f.server.state.lock().unwrap().posts(), 3);
        assert!(f
            .server
            .state
            .lock()
            .unwrap()
            .requests
            .iter()
            .filter(|r| r.0 == "POST" && r.1.ends_with("/permission-turns"))
            .all(|r| r.2["permission_mode"] == "ask"));
        f.close().await;
    }
}

#[tokio::test]
async fn feat155_4c1_final_post_checks_current_context_and_cancels_unsent() {
    let f = Fixture::new_options(false, false, true).await;
    let (run, ui) = prepare(&f, TargetMode::DedicatedChat, None).await;
    f.local_binding().await;
    f.server.state.lock().unwrap().on_ready = Some(Box::new(move || {
        Box::pin(async move {
            let n = unix_seconds().unwrap();
            ui.bind(
                AuthoritativeChatProjection::from_trusted_native_projection(
                    Uuid::parse_str(DEMO_FAST_TENANT_ID).unwrap(),
                    1,
                    n + 240,
                    demo_fast_capabilities(),
                )
                .unwrap(),
                n,
            )
            .unwrap();
        })
    }));
    assert!(matches!(
        f.app.dispatch_next().await.unwrap(),
        DispatchOutcome::RetryScheduled { .. }
    ));
    assert_eq!(f.server.state.lock().unwrap().posts(), 0);
    f.db.call(|r| {
        r.expire_manual(unix_seconds()?)?;
        r.expire_manual(unix_seconds()?)?;
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
    f.close().await;
}

#[tokio::test]
async fn feat155_4c1_missing_mapping_releases_only_with_normal_stop_proof() {
    let f = Fixture::new_options(false, false, true).await;
    let (run, _) = prepare(&f, TargetMode::DedicatedChat, None).await;
    f.local_binding().await;
    let id = run.run_id.clone();
    let prior = Uuid::now_v7().to_string();
    let stopped = prior.clone();
    f.db.call(move|r|{
        // Declared retained historical facts, not a simulated process crash.
        r.connection.execute("UPDATE chat_scheduled_recovery SET create_attempt='attempted',create_host_instance=?2 WHERE run_id=?1",rusqlite::params![id,prior]).unwrap();
        r.manual_runtime.observe_host(None);Ok(())
    }).await.unwrap();
    *f.app.recovery_poll.lock().unwrap() = None;
    f.app.recover_schedule_once().await.unwrap();
    f.db.call(|r| {
        assert_eq!(
            r.connection
                .query_row("SELECT count(*) FROM chat_scheduled_reservation", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        Ok(())
    })
    .await
    .unwrap();
    f.db.call(move |r| r.record_stopped_schedule_generation(&stopped))
        .await
        .unwrap();
    *f.app.recovery_poll.lock().unwrap() = None;
    f.app.recover_schedule_once().await.unwrap();
    f.db.call(|r| {
        assert_eq!(
            r.connection
                .query_row("SELECT count(*) FROM chat_scheduled_reservation", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(r.recovery_snapshot()?.active_session_ids.is_empty());
        assert_eq!(
            r.connection
                .query_row(
                    "SELECT release_kind,refunded FROM chat_scheduled_recovery",
                    [],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                )
                .unwrap(),
            ("generation_stopped".into(), 0)
        );
        Ok(())
    })
    .await
    .unwrap();
    let state = f.service.read_run(run.run_id).await.unwrap();
    assert_eq!(state.delivery_state, DeliveryState::Uncertain);
    assert_eq!(state.native_outcome, NativeOutcome::Unobserved);
    assert_eq!(
        f.service
            .read_grant(run.grant_id)
            .await
            .unwrap()
            .occupied_runs,
        1
    );
    assert_eq!(f.server.state.lock().unwrap().posts(), 0);
    f.close().await;
}
