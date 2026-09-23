use super::*;
async fn single(f: &Fixture, p: &Value, review: Option<Value>) -> (Value, Value) {
    let mut q = json!({"kind":"manual","confirmation":{"request_id":Uuid::now_v7(),"plan_id":p["plan_id"],"expected_revision":p["revision"],"max_runs":1,"expires_at":execution::now().unwrap()+600}});
    if let Some(review) = review {
        q["kind"] = json!("rerun");
        q["review"] = review;
    }
    let g = f
        .call("schedule_confirm_single_run_v1", q.clone())
        .await
        .unwrap();
    (q, g)
}
async fn cancel(f: &Fixture, r: &Value) {
    let id = r["run_id"].as_str().unwrap().to_owned();
    f.worker
        .call(move |repo| {
            let n = execution::now().unwrap();
            repo.cancel_unsent_schedule(&ScheduleAuthority::local(n).unwrap(), &id, n)
        })
        .await
        .unwrap();
}
async fn plan(f: &Fixture, id: &Value) -> Value {
    f.call("schedule_get_plan_v1", json!({"plan_id":id}))
        .await
        .unwrap()["plan"]
        .clone()
}
fn capture(f: &Fixture) {
    if let Some(dir) = std::env::var_os("YIJIE_FEAT155_CONFORMANCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            PathBuf::from(dir).join("phase-4c3-ipc-producer.json"),
            serde_json::to_vec_pretty(&*f.exchanges.lock().unwrap()).unwrap(),
        )
        .unwrap();
    }
}

#[tokio::test]
async fn feat155_4c3_preview_without_grant_and_purpose_receipts() {
    let f = Fixture::new(ScheduleStorageMode::SingleRunFoundation);
    super::automatic_tests::ready(&f).await;
    // A never-created dedicated chat is correctly not reusable as a ready chat.
    // This receipt test uses the new-chat policy; actual dedicated reuse is
    // exercised after native completion by the Coordinator composition test.
    let mut initial = save();
    initial["definition"]["name"] = json!("原配置");
    initial["definition"]["target"] = json!({"mode":"new_chat_each_run"});
    let p = f.call("schedule_save_plan_v1", initial).await.unwrap();
    let (q, g) = single(&f, &p, None).await;
    assert_eq!(plan(&f, &p["plan_id"]).await, p);
    assert_eq!(
        f.call("schedule_confirm_single_run_v1", q.clone())
            .await
            .unwrap(),
        g
    );
    assert_eq!(f.call("schedule_read_execution_receipt_v1",json!({"operation":"single_grant","original_request_id":q["confirmation"]["request_id"]})).await.unwrap()["result"],g);
    let old = f
        .call(
            "schedule_manual_run_v1",
            json!({"grant_id":g["grant"]["grant_id"],"revision":p["revision"]}),
        )
        .await
        .unwrap();
    cancel(&f, &old).await;
    let mut edit = save();
    edit["plan_id"] = p["plan_id"].clone();
    edit["expected_revision"] = p["revision"].clone();
    edit["definition"] = p["definition"].clone();
    edit["definition"]["content"] = json!("当前内容");
    let current = f.call("schedule_save_plan_v1", edit).await.unwrap();
    assert!(current.get("authorization_ref").is_none());
    let preview = f
        .call(
            "schedule_preview_rerun_v1",
            json!({"original_run_id":old["run_id"]}),
        )
        .await
        .unwrap();
    assert_eq!(preview["original"]["content"], p["definition"]["content"]);
    assert_eq!(preview["current"]["content"], "当前内容");
    assert!(preview["confirmation"].get("grant_id").is_none());
    let (q, g) = single(&f, &current, Some(preview["confirmation"].clone())).await;
    assert_eq!(g["kind"], "rerun");
    assert_eq!(g["original_run_id"], old["run_id"]);
    assert_eq!(
        f.call(
            "schedule_manual_run_v1",
            json!({"grant_id":g["grant"]["grant_id"],"revision":current["revision"]})
        )
        .await
        .unwrap_err(),
        E::PermissionDenied.into()
    );
    let mut input = preview["confirmation"].clone();
    input["grant_id"] = g["grant"]["grant_id"].clone();
    let request = Uuid::now_v7().to_string();
    let run = f
        .request("schedule_confirm_rerun_v1", input.clone(), request.clone())
        .await
        .unwrap_or_else(|e| panic!("rerun error {}", serde_json::to_string(&e).unwrap()));
    assert_ne!(run["run_id"], old["run_id"]);
    assert_eq!(run["original_run_id"], old["run_id"]);
    assert_eq!(run["trigger"], "rerun");
    assert_eq!(plan(&f, &p["plan_id"]).await, current);
    assert_eq!(
        f.request("schedule_confirm_rerun_v1", input.clone(), request.clone())
            .await
            .unwrap(),
        run
    );
    let queried = f
        .call(
            "schedule_read_execution_receipt_v1",
            json!({"operation":"rerun","original_request_id":request}),
        )
        .await
        .unwrap();
    assert_eq!(queried["observation"], "rerun_observed");
    assert_eq!(queried["run"], run);
    let id = run["run_id"].as_str().unwrap().to_owned();
    f.worker
        .call(move |r| {
            r.expire_unstarted_rerun(execution::now().unwrap())?;
            assert_eq!(
                r.connection
                    .query_row(
                        "SELECT delivery_state FROM chat_scheduled_runs WHERE run_id=?1",
                        [id],
                        |r| r.get::<_, String>(0)
                    )
                    .unwrap(),
                "reserved"
            );
            r.manual_runtime.observe_host(None);
            r.expire_unstarted_rerun(execution::now().unwrap())?;
            r.expire_unstarted_rerun(execution::now().unwrap())?;
            Ok(())
        })
        .await
        .unwrap();
    let replay = f.call("schedule_confirm_single_run_v1", q).await.unwrap();
    assert_eq!(replay["grant"]["occupied_runs"], 0);
    let prior = f
        .request("schedule_confirm_rerun_v1", input.clone(), request)
        .await
        .unwrap();
    assert_eq!(prior["delivery_state"], "cancelled");
    super::automatic_tests::ready(&f).await;
    assert_eq!(
        f.call("schedule_confirm_rerun_v1", input)
            .await
            .unwrap_err(),
        E::GrantMissing.into()
    );
    let old_now = f
        .call(
            "schedule_get_record_v1",
            json!({"kind":"run","run_id":old["run_id"]}),
        )
        .await
        .unwrap();
    assert_eq!(
        old_now["record"]["run"],
        old.clone()
            .as_object()
            .map(|_| {
                let mut x = old.clone();
                x["delivery_state"] = json!("cancelled");
                x
            })
            .unwrap()
    );
    capture(&f);
    f.close().await;
}

#[tokio::test]
async fn feat155_4c3_single_limits_revision_and_automatic_grant_unchanged() {
    let f = Fixture::new(ScheduleStorageMode::SingleRunFoundation);
    super::automatic_tests::ready(&f).await;
    let p = f.save("自动和单次相互独立").await;
    let at = f
        .call(
            "schedule_preview_time_v1",
            json!({"rule":p["definition"]["rule"]}),
        )
        .await
        .unwrap()["next_at"]
        .as_i64()
        .unwrap();
    let mut c = confirmation(&p, 2);
    c["expires_at"] = json!(at + 600);
    let enabled = f
        .call(
            "schedule_confirm_enable_v1",
            json!({"confirmation":c,"expected_next_at":at}),
        )
        .await
        .unwrap();
    let p = &enabled["plan"];
    let (q, g) = single(&f, p, None).await;
    assert_eq!(plan(&f, &p["plan_id"]).await, *p);
    let mut too = q.clone();
    too["confirmation"]["request_id"] = json!(Uuid::now_v7());
    too["confirmation"]["max_runs"] = json!(2);
    assert_eq!(
        f.call("schedule_confirm_single_run_v1", too)
            .await
            .unwrap_err(),
        E::InvalidInput.into()
    );
    let mut late = q.clone();
    late["confirmation"]["request_id"] = json!(Uuid::now_v7());
    late["confirmation"]["expires_at"] = json!(execution::now().unwrap() + 1000);
    assert_eq!(
        f.call("schedule_confirm_single_run_v1", late)
            .await
            .unwrap_err(),
        E::InvalidInput.into()
    );
    let mut different = q.clone();
    different["confirmation"]["expires_at"] = json!(execution::now().unwrap() + 500);
    assert_eq!(
        f.call("schedule_confirm_single_run_v1", different)
            .await
            .unwrap_err(),
        E::RequestConflict.into()
    );
    let r = f
        .call(
            "schedule_manual_run_v1",
            json!({"grant_id":g["grant"]["grant_id"],"revision":p["revision"]}),
        )
        .await
        .unwrap();
    let d = f
        .call("schedule_get_plan_v1", json!({"plan_id":p["plan_id"]}))
        .await
        .unwrap();
    assert_eq!(d["plan"], *p);
    assert_eq!(d["grant"], enabled["grant"]);
    f.call(
        "schedule_pause_plan_v1",
        json!({"plan_id":p["plan_id"],"expected_revision":p["revision"]}),
    )
    .await
    .unwrap();
    f.worker
        .call(|r| {
            r.expire_manual(execution::now().unwrap())?;
            r.expire_manual(execution::now().unwrap())?;
            Ok(())
        })
        .await
        .unwrap();
    let detail = f
        .call(
            "schedule_get_record_v1",
            json!({"kind":"run","run_id":r["run_id"]}),
        )
        .await
        .unwrap();
    assert_eq!(detail["record"]["run"]["delivery_state"], "cancelled");
    f.close().await;
}

#[tokio::test]
async fn feat155_4c3_reader_migrates_without_backfill_and_completed_plan_stays_completed() {
    let f = Fixture::new(ScheduleStorageMode::AutomaticFoundation);
    let p = f.save("旧库").await;
    let legacy = f
        .call("schedule_confirm_grant_v1", confirmation(&p, 1))
        .await
        .unwrap();
    let root = f.root.clone();
    drop(f);
    let worker = DatabaseWorker::start_with_schedule_storage(
        root.join("chat"),
        scope(),
        Box::new(Keys),
        Box::new(Keys),
        ScheduleStorageMode::SingleRunFoundation,
    )
    .unwrap();
    let ui = ChatAuthorizationManager::new(&scope()).unwrap();
    let context = bind(&ui, execution::now().unwrap() + 240);
    let f = Fixture {
        exchanges: Mutex::new(vec![]),
        worker,
        ui,
        context,
        ipc: ScheduleIpcRuntime::default(),
        root,
    };
    assert_eq!(f.worker.schema_version().await.unwrap(), 25);
    f.worker
        .call(|r| {
            assert_eq!(
                r.connection
                    .query_row(
                        "SELECT count(*) FROM chat_scheduled_single_run_grants",
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
    assert_eq!(
        f.call("schedule_get_plan_v1", json!({"plan_id":p["plan_id"]}))
            .await
            .unwrap()["grant"],
        legacy
    );
    super::automatic_tests::ready(&f).await;
    let id = p["plan_id"].as_str().unwrap().to_owned();
    f.worker.call(move|r|{ // Declared completed once-plan fixture, not an execution success claim.
 r.connection.execute("UPDATE chat_scheduled_plans SET state='completed',next_at=NULL WHERE plan_id=?1",[id]).unwrap();Ok(())}).await.unwrap();
    let completed = plan(&f, &p["plan_id"]).await;
    let (_, g) = single(&f, &completed, None).await;
    let run = f
        .call(
            "schedule_manual_run_v1",
            json!({"grant_id":g["grant"]["grant_id"],"revision":completed["revision"]}),
        )
        .await
        .unwrap();
    cancel(&f, &run).await;
    assert_eq!(plan(&f, &p["plan_id"]).await, completed);
    f.close().await;
}

#[tokio::test]
async fn feat155_4c3_unknown_purpose_blocks_dispatch_without_hiding_run_history() {
    let f = Fixture::new(ScheduleStorageMode::SingleRunFoundation);
    super::automatic_tests::ready(&f).await;
    let p = f.save("未来格式只读边界").await;
    let (_, g) = single(&f, &p, None).await;
    let run = f
        .call(
            "schedule_manual_run_v1",
            json!({"grant_id":g["grant"]["grant_id"],"revision":p["revision"]}),
        )
        .await
        .unwrap();
    let gid = g["grant"]["grant_id"].as_str().unwrap().to_owned();
    let op = Uuid::parse_str(run["operation_id"].as_str().unwrap()).unwrap();
    f.worker.call(move|r|{
        // A declared future-format record in a temporary library, not file damage.
        r.connection.execute("UPDATE chat_scheduled_single_run_grants SET format_version=2 WHERE grant_id=?1",[&gid]).unwrap();
        let n=execution::now().unwrap();let a=ScheduleAuthority::local(n).unwrap();
        assert!(!r.manual_runtime.allows(&r.connection,&r.scope,&a,op,n));
        assert!(matches!(execution::grant(&r.connection,&r.scope,&gid,n),Err(E::FormatUnsupported)));
        Ok(())
    }).await.unwrap();
    let old = f
        .call(
            "schedule_get_record_v1",
            json!({"kind":"run","run_id":run["run_id"]}),
        )
        .await
        .unwrap();
    assert_eq!(old["record"]["run"], run);
    assert_eq!(
        f.call("schedule_list_record_rows_v1", json!({}))
            .await
            .unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    f.close().await;
}
