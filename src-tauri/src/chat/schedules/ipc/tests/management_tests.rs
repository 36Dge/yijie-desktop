use super::*;
use rusqlite::OptionalExtension;

fn reopen(f: Fixture, mode: ScheduleStorageMode) -> Fixture {
    let root = f.root.clone();
    drop(f);
    let worker = DatabaseWorker::start_with_schedule_storage(
        root.join("chat"),
        scope(),
        Box::new(Keys),
        Box::new(Keys),
        mode,
    )
    .unwrap();
    let ui = ChatAuthorizationManager::new(&scope()).unwrap();
    let context = bind(&ui, execution::now().unwrap() + 240);
    Fixture {
        exchanges: Mutex::new(Vec::new()),
        worker,
        ui,
        context,
        ipc: ScheduleIpcRuntime::default(),
        root,
    }
}
#[tokio::test]
async fn feat155_4a_creation_migration_reopen_receipts_and_no_execution() {
    let f = Fixture::new(ScheduleStorageMode::DraftFoundation);
    let old = f.save("旧计划").await;
    let f = reopen(f, ScheduleStorageMode::ManagementFoundation);
    assert_eq!(f.worker.schema_version().await.unwrap(), 23);
    let q = save();
    let request = q["request_id"].clone();
    let p = f.call("schedule_save_plan_v1", q.clone()).await.unwrap();
    let cards = f
        .call("schedule_list_plan_cards_v1", json!({}))
        .await
        .unwrap();
    assert_eq!(cards["items"][0]["summary"]["plan_id"], p["plan_id"]);
    let created = cards["items"][0]["created_at"].as_i64().unwrap();
    assert_eq!(cards["items"][1]["summary"]["plan_id"], old["plan_id"]);
    assert!(cards["items"][1].get("created_at").is_none());
    let mut edit = save();
    edit["plan_id"] = p["plan_id"].clone();
    edit["expected_revision"] = p["revision"].clone();
    edit["definition"]["content"] = json!("更改后的内容");
    let edit = f.call("schedule_save_plan_v1", edit).await.unwrap();
    let replay = f.call("schedule_save_plan_v1", q).await.unwrap();
    assert_eq!(replay, edit);
    let receipt = f
        .call(
            "schedule_read_plan_mutation_receipt_v1",
            json!({"original_request_id":request}),
        )
        .await
        .unwrap();
    assert_eq!(receipt["observation"], "observed");
    assert_eq!(receipt["current_plan"]["plan"], edit);
    assert_eq!(
        f.call(
            "schedule_read_plan_mutation_receipt_v1",
            json!({"original_request_id":Uuid::now_v7()})
        )
        .await
        .unwrap(),
        json!({"observation":"not_observed"})
    );
    let f = reopen(f, ScheduleStorageMode::CompatibleReader);
    let cards = f
        .call(
            "schedule_list_plan_cards_v1",
            json!({"order":"created_asc"}),
        )
        .await
        .unwrap();
    assert_eq!(cards["items"][0]["created_at"], created);
    assert!(cards["items"][1].get("created_at").is_none());
    assert_eq!(
        f.call("schedule_list_record_rows_v1", json!({}))
            .await
            .unwrap()["items"],
        json!([])
    );
    f.worker
        .call(|r| {
            for table in [
                "chat_scheduled_runs",
                "chat_scheduled_grants",
                "chat_outbox",
            ] {
                let count: i64 = r
                    .connection
                    .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                    .unwrap();
                assert_eq!(count, 0);
            }
            assert_eq!(
                r.connection
                    .query_row("PRAGMA foreign_key_check", [], |_| Ok(()))
                    .optional()
                    .unwrap(),
                None
            );
            Ok(())
        })
        .await
        .unwrap();
    f.close().await;
}
#[tokio::test]
async fn feat155_4a_cards_content_search_paging_and_scoped_receipt() {
    let f = Fixture::new(ScheduleStorageMode::ManagementFoundation);
    let mut ids = vec![];
    for name in ["同名", "同名", "别名"] {
        ids.push(f.save(name).await["plan_id"].clone());
    }
    let first = f
        .call(
            "schedule_list_plan_cards_v1",
            json!({"limit":1,"search":"本地记录"}),
        )
        .await
        .unwrap();
    let token = first["next_cursor"].clone();
    let second = f
        .call(
            "schedule_list_plan_cards_v1",
            json!({"limit":1,"search":"本地记录","cursor":token}),
        )
        .await
        .unwrap();
    assert_ne!(
        first["items"][0]["summary"]["plan_id"],
        second["items"][0]["summary"]["plan_id"]
    );
    assert_eq!(
        f.call(
            "schedule_list_plan_cards_v1",
            json!({"limit":1,"search":"其他","cursor":token})
        )
        .await
        .unwrap_err(),
        P::CursorInvalid.into()
    );
    let request = Uuid::now_v7().to_string();
    f.request(
        "schedule_delete_plan_v1",
        json!({"plan_id":ids[0],"expected_revision":1}),
        request.clone(),
    )
    .await
    .unwrap();
    let receipt = f
        .call(
            "schedule_read_plan_mutation_receipt_v1",
            json!({"original_request_id":request}),
        )
        .await
        .unwrap();
    assert_eq!(receipt["current_plan"]["plan"]["state"], "deleted");
    assert_eq!(
        f.call("schedule_list_plan_cards_v1", json!({}))
            .await
            .unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        f.call(
            "schedule_list_plan_cards_v1",
            json!({"include_deleted":true})
        )
        .await
        .unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    f.close().await;
}
#[tokio::test]
async fn feat155_4a_record_search_keeps_snapshot_after_edit_and_delete() {
    let f = Fixture::new(ScheduleStorageMode::ManagementFoundation);
    let q = save();
    let p = f.call("schedule_save_plan_v1", q).await.unwrap();
    let g = f
        .call("schedule_confirm_grant_v1", confirmation(&p, 1))
        .await
        .unwrap();
    let run = f
        .call(
            "schedule_manual_run_v1",
            json!({"grant_id":g["grant_id"],"revision":p["revision"]}),
        )
        .await
        .unwrap();
    let rid = run["run_id"].as_str().unwrap().to_owned();
    f.worker
        .call(move |r| {
            let n = execution::now().unwrap();
            r.cancel_unsent_schedule(&ScheduleAuthority::local(n).unwrap(), &rid, n)
        })
        .await
        .unwrap();
    let mut q = save();
    q["plan_id"] = p["plan_id"].clone();
    q["expected_revision"] = p["revision"].clone();
    q["definition"]["name"] = json!("新名称");
    q["definition"]["content"] = json!("新内容");
    let updated = f.call("schedule_save_plan_v1", q).await.unwrap();
    let rows = f
        .call("schedule_list_record_rows_v1", json!({"search":"本地记录"}))
        .await
        .unwrap();
    assert_eq!(rows["items"].as_array().unwrap().len(), 1);
    assert_eq!(rows["items"][0]["name"], p["definition"]["name"]);
    assert_eq!(rows["items"][0]["source"], "run_snapshot");
    assert_eq!(
        f.call("schedule_list_record_rows_v1", json!({"search":"新内容"}))
            .await
            .unwrap()["items"],
        json!([])
    );
    f.call(
        "schedule_delete_plan_v1",
        json!({"plan_id":p["plan_id"],"expected_revision":updated["revision"]}),
    )
    .await
    .unwrap();
    assert_eq!(
        f.call("schedule_list_record_rows_v1", json!({"state":"paused"}))
            .await
            .unwrap()["items"],
        json!([])
    );
    assert_eq!(
        f.call("schedule_list_record_rows_v1", json!({"state":"all"}))
            .await
            .unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    f.close().await;
}

#[test]
fn feat155_4a_receipt_requires_the_observed_native_plan() {
    assert!(validation::valid(
        "PlanMutationReceipt",
        &json!({"observation":"not_observed"})
    ));
    assert!(!validation::valid(
        "PlanMutationReceipt",
        &json!({"observation":"observed"})
    ));
}
