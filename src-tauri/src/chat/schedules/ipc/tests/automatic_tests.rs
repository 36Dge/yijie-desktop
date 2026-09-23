use super::*;
use crate::chat::lifecycle::Lifecycle;

pub(super) async fn ready(f: &Fixture) {
    f.worker
        .call(|r| {
            let life = Lifecycle::default();
            let epoch = life.epoch();
            r.manual_runtime.enabled = true;
            r.manual_runtime.lifecycle = Some(life.clone());
            r.manual_runtime
                .observe_host(Some((Uuid::now_v7().to_string(), epoch)));
            r.schedule_trigger_lifecycle = Some(life);
            r.schedule_dispatch_authority = Some(auth());
            Ok(())
        })
        .await
        .unwrap();
}
async fn input(f: &Fixture, p: &Value) -> Value {
    let preview = f
        .call(
            "schedule_preview_time_v1",
            json!({"rule":p["definition"]["rule"]}),
        )
        .await
        .unwrap();
    let at = preview["next_at"].as_i64().unwrap();
    let mut c = confirmation(p, 1);
    c["expires_at"] = json!(at + 600);
    json!({"confirmation":c,"expected_next_at":at})
}

#[tokio::test]
async fn feat155_4c2_native_confirmation_receipts_preview_and_pause() {
    let f = Fixture::new(ScheduleStorageMode::AutomaticFoundation);
    let p = f.save("自动确认").await;
    let q = input(&f, &p).await;
    assert_eq!(
        f.call("schedule_confirm_enable_v1", q.clone())
            .await
            .unwrap_err(),
        E::ExecutionNotReady.into()
    );
    ready(&f).await;
    let mut changed = q.clone();
    changed["expected_next_at"] = json!(q["expected_next_at"].as_i64().unwrap() + 60);
    assert_eq!(
        f.call("schedule_confirm_enable_v1", changed)
            .await
            .unwrap_err(),
        E::RevisionConflict.into()
    );
    let mut expired = q.clone();
    expired["confirmation"]["expires_at"] = q["expected_next_at"].clone();
    assert_eq!(
        f.call("schedule_confirm_enable_v1", expired)
            .await
            .unwrap_err(),
        E::InvalidInput.into()
    );
    let enabled = f
        .call("schedule_confirm_enable_v1", q.clone())
        .await
        .unwrap();
    assert_eq!(enabled["automatic_consent"], true);
    let key = json!({"operation":"enable","original_request_id":q["confirmation"]["request_id"]});
    assert_eq!(
        f.call("schedule_read_execution_receipt_v1", key.clone())
            .await
            .unwrap()["result"],
        enabled
    );
    assert_eq!(
        f.call("schedule_confirm_enable_v1", q.clone())
            .await
            .unwrap(),
        enabled
    );
    let detail = f
        .call("schedule_get_plan_v1", json!({"plan_id":p["plan_id"]}))
        .await
        .unwrap();
    assert_eq!(detail["summary"]["effective_state"], "enabled");
    assert_eq!(
        f.call("schedule_list_plans_v1", json!({"state":"enabled"}))
            .await
            .unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    f.call(
        "schedule_pause_plan_v1",
        json!({"plan_id":p["plan_id"],"expected_revision":enabled["plan"]["revision"]}),
    )
    .await
    .unwrap();
    let old = f.call("schedule_confirm_enable_v1", q).await.unwrap();
    assert_eq!(old["plan"]["state"], "paused");
    assert_eq!(
        f.call("schedule_read_execution_receipt_v1", key)
            .await
            .unwrap()["result"]["plan"]["state"],
        "paused"
    );
    f.worker
        .call(|r| {
            assert_eq!(
                r.connection
                    .query_row("SELECT count(*) FROM chat_scheduled_grants", [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                1
            );
            assert_eq!(
                r.connection
                    .query_row("SELECT count(*) FROM chat_scheduled_runs", [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            Ok(())
        })
        .await
        .unwrap();
    if let Some(dir) = std::env::var_os("YIJIE_FEAT155_CONFORMANCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            PathBuf::from(dir).join("phase-4c2-ipc-producer.json"),
            serde_json::to_vec_pretty(&*f.exchanges.lock().unwrap()).unwrap(),
        )
        .unwrap();
    }
    f.close().await;
}

#[tokio::test]
async fn feat155_4c2_old_confirmation_migrates_without_consent_and_reconfirms() {
    let f = Fixture::new(ScheduleStorageMode::ManagementFoundation);
    let p = f.save("旧启用").await;
    let mut q = confirmation(&p, 2);
    q["expires_at"] = json!(execution::now().unwrap() + 172800);
    let legacy = f.legacy_enable(q.clone()).await.unwrap();
    assert_eq!(legacy["automatic_consent"], false);
    let root = f.root.clone();
    drop(f);
    let worker = DatabaseWorker::start_with_schedule_storage(
        root.join("chat"),
        scope(),
        Box::new(Keys),
        Box::new(Keys),
        ScheduleStorageMode::AutomaticFoundation,
    )
    .unwrap();
    let ui = ChatAuthorizationManager::new(&scope()).unwrap();
    let context = bind(&ui, execution::now().unwrap() + 240);
    let f = Fixture {
        exchanges: Mutex::new(Vec::new()),
        worker,
        ui,
        context,
        ipc: ScheduleIpcRuntime::default(),
        root,
    };
    assert_eq!(f.worker.schema_version().await.unwrap(), 24);
    let receipt = f
        .call(
            "schedule_read_execution_receipt_v1",
            json!({"operation":"enable","original_request_id":q["request_id"]}),
        )
        .await
        .unwrap();
    assert_eq!(receipt["result"]["automatic_consent"], false);
    assert_eq!(receipt["result"]["plan"]["state"], "enabled");
    let detail = f
        .call("schedule_get_plan_v1", json!({"plan_id":p["plan_id"]}))
        .await
        .unwrap();
    assert_eq!(detail["summary"]["pause_reason"], "confirmation");
    assert!(f
        .call("schedule_list_plans_v1", json!({"state":"enabled"}))
        .await
        .unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
    ready(&f).await;
    f.worker
        .call(|r| {
            assert_eq!(
                r.automatic_startup_work(execution::now().unwrap()).unwrap(),
                (false, false)
            );
            Ok(())
        })
        .await
        .unwrap();
    let new = input(&f, &detail["plan"]).await;
    let current = f.call("schedule_confirm_enable_v1", new).await.unwrap();
    assert_eq!(current["automatic_consent"], true);
    assert_ne!(current["grant"]["grant_id"], legacy["grant"]["grant_id"]);
    let root = f.root.clone();
    drop(f);
    let worker =
        DatabaseWorker::start(root.join("chat"), scope(), Box::new(Keys), Box::new(Keys)).unwrap();
    assert_eq!(worker.schema_version().await.unwrap(), 24);
    worker.call(|r|{ assert!(!r.schedule_execution_writes_enabled);assert!(r.schedule_dispatch_authority.is_none());assert_eq!(r.connection.query_row("SELECT count(*) FROM chat_scheduled_enable_receipts WHERE automatic_consent_version IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),1);Ok(())}).await.unwrap();
    drop(worker);
    std::fs::remove_dir_all(root).unwrap();
}
