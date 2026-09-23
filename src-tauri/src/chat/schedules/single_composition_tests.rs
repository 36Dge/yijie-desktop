//! Zero-Provider composition through the original Coordinator and declared Host HTTP.
use super::*;
async fn call(
    f: &Fixture,
    ui: &ChatAuthorizationManager,
    context: Uuid,
    name: &'static str,
    q: Value,
    id: Uuid,
) -> Value {
    crate::chat::schedules::ipc::execute_composition_fixture(
        &f.db,
        authority(),
        ui.clone(),
        crate::chat::schedules::ipc::ScheduleIpcRuntime::default(),
        json!({"schemaVersion":1,"requestId":id,"contextId":context,"payload":q}),
        name,
    )
    .await
    .unwrap_or_else(|e| panic!("{}: {}", name, serde_json::to_string(&e).unwrap()))["data"]
        .clone()
}
async fn send(f: &Fixture, run: &RunView) {
    let fresh = f.binding(run).await.2.is_some();
    {
        let mut state = f.server.state.lock().unwrap();
        state.turn = Uuid::now_v7();
        if fresh {
            state.task = Uuid::now_v7();
            state.session = Uuid::now_v7();
            state.thread = Uuid::now_v7();
        }
    }
    if fresh {
        f.local_binding().await;
        f.create().await;
    }
    f.turn().await;
    f.finish(run).await;
}
#[tokio::test]
async fn feat155_4c3_single_and_rerun_three_targets_preserve_automatic_grant() {
    for mode in [
        TargetMode::DedicatedChat,
        TargetMode::NewChatEachRun,
        TargetMode::ExistingChat,
    ] {
        let f = Fixture::new_options(false, false, true).await;
        let chat = if mode == TargetMode::ExistingChat {
            let (seed, _) =
                manual_composition_tests::prepare(&f, TargetMode::DedicatedChat, None).await;
            send(&f, &seed).await;
            Some(f.binding(&seed).await.0.to_string())
        } else {
            None
        };
        let (old, ui) = manual_composition_tests::prepare(&f, mode, chat).await;
        send(&f, &old).await;
        let old_complete = f.service.read_run(old.run_id.clone()).await.unwrap();
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
        let p = call(
            &f,
            &ui,
            context,
            "schedule_get_plan_v1",
            json!({"plan_id":old.plan_id}),
            Uuid::now_v7(),
        )
        .await["plan"]
            .clone();
        let next = call(
            &f,
            &ui,
            context,
            "schedule_preview_time_v1",
            json!({"rule":p["definition"]["rule"]}),
            Uuid::now_v7(),
        )
        .await["next_at"]
            .as_i64()
            .unwrap();
        let id = Uuid::now_v7();
        let enabled=call(&f,&ui,context,"schedule_confirm_enable_v1",json!({"confirmation":{"request_id":id,"plan_id":p["plan_id"],"expected_revision":p["revision"],"max_runs":2,"expires_at":next+600},"expected_next_at":next}),id).await;
        for rerun in [false, true] {
            let review = if rerun {
                Some(
                    call(
                        &f,
                        &ui,
                        context,
                        "schedule_preview_rerun_v1",
                        json!({"original_run_id":old.run_id}),
                        Uuid::now_v7(),
                    )
                    .await["confirmation"]
                        .clone(),
                )
            } else {
                None
            };
            let id = Uuid::now_v7();
            let mut q = json!({"kind":if rerun{"rerun"}else{"manual"},"confirmation":{"request_id":id,"plan_id":p["plan_id"],"expected_revision":enabled["plan"]["revision"],"max_runs":1,"expires_at":n+600}});
            if let Some(v) = &review {
                q["review"] = v.clone();
            }
            let g = call(&f, &ui, context, "schedule_confirm_single_run_v1", q, id).await;
            let mut input =
                review.unwrap_or_else(|| json!({"revision":enabled["plan"]["revision"]}));
            input["grant_id"] = g["grant"]["grant_id"].clone();
            let command = if rerun {
                "schedule_confirm_rerun_v1"
            } else {
                "schedule_manual_run_v1"
            };
            let id = Uuid::now_v7();
            let value = call(&f, &ui, context, command, input.clone(), id).await;
            assert_eq!(call(&f, &ui, context, command, input, id).await, value);
            let run: RunView = serde_json::from_value(value).unwrap();
            assert_ne!(run.run_id, old.run_id);
            assert_ne!(run.operation_id, old.operation_id);
            assert_eq!(
                run.trigger,
                if rerun {
                    RunTrigger::Rerun
                } else {
                    RunTrigger::Manual
                }
            );
            f.db.call(|r| {
                r.expire_unstarted_rerun(unix_seconds()?)?;
                r.expire_manual(unix_seconds()?)?;
                Ok(())
            })
            .await
            .unwrap();
            let binding = f.binding(&run).await.0;
            assert_eq!(
                binding == f.binding(&old).await.0,
                mode != TargetMode::NewChatEachRun
            );
            send(&f, &run).await;
            assert_eq!(
                f.service
                    .read_grant(run.grant_id)
                    .await
                    .unwrap()
                    .occupied_runs,
                1
            );
            let detail = call(
                &f,
                &ui,
                context,
                "schedule_get_plan_v1",
                json!({"plan_id":p["plan_id"]}),
                Uuid::now_v7(),
            )
            .await;
            assert_eq!(detail["plan"], enabled["plan"]);
            assert_eq!(detail["grant"], enabled["grant"]);
            assert_eq!(
                f.service.read_run(old.run_id.clone()).await.unwrap(),
                old_complete
            );
        }
        f.close().await;
    }
}
