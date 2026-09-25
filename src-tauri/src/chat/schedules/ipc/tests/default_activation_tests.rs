use super::*;

#[tokio::test]
async fn creation_is_enabled_atomically_and_replay_never_reactivates() {
    let f = Fixture::new(ScheduleStorageMode::TimingFoundation);
    let request = save();
    let enabled = f
        .call("schedule_save_active_plan_v1", request.clone())
        .await
        .unwrap();
    assert_eq!(enabled["state"], "enabled");
    let detail = f
        .call(
            "schedule_get_plan_v1",
            json!({"plan_id":enabled["plan_id"]}),
        )
        .await
        .unwrap();
    assert_eq!(detail["summary"]["effective_state"], "enabled");
    assert_eq!(detail["grant"]["max_runs"], 2147483647_i64);
    assert_eq!(detail["grant"]["expires_at"], 253402300799_i64);
    assert_eq!(
        f.call("schedule_save_active_plan_v1", request.clone())
            .await
            .unwrap(),
        enabled
    );
    let paused = f
        .call(
            "schedule_pause_plan_v1",
            json!({"plan_id":enabled["plan_id"],"expected_revision":enabled["revision"]}),
        )
        .await
        .unwrap();
    assert_eq!(
        f.call("schedule_save_active_plan_v1", request)
            .await
            .unwrap(),
        paused
    );
    f.worker.call(|r| {
        let counts: (i64,i64,i64) = r.connection.query_row("SELECT (SELECT count(*) FROM chat_scheduled_plans),(SELECT count(*) FROM chat_scheduled_grants),(SELECT count(*) FROM chat_scheduled_runs)", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(counts, (1,1,0));
        Ok(())
    }).await.unwrap();
    f.close().await;
}

#[tokio::test]
async fn switch_and_edits_preserve_state_and_receipts() {
    let f = Fixture::new(ScheduleStorageMode::TimingFoundation);
    let p = f.save("已有关闭任务").await;
    let input = json!({"plan_id":p["plan_id"],"expected_revision":p["revision"]});
    let id = Uuid::now_v7().to_string();
    let enabled = f
        .request("schedule_enable_plan_v1", input.clone(), id.clone())
        .await
        .unwrap();
    let mut edit = save();
    edit["plan_id"] = enabled["plan_id"].clone();
    edit["expected_revision"] = enabled["revision"].clone();
    let edited = f
        .call("schedule_save_active_plan_v1", edit.clone())
        .await
        .unwrap();
    assert_eq!(edited["state"], "enabled");
    let paused = f
        .call(
            "schedule_pause_plan_v1",
            json!({"plan_id":edited["plan_id"],"expected_revision":edited["revision"]}),
        )
        .await
        .unwrap();
    assert_eq!(
        f.request("schedule_enable_plan_v1", input, id.clone())
            .await
            .unwrap(),
        paused
    );
    let receipt = f
        .call(
            "schedule_read_plan_mutation_receipt_v1",
            json!({"original_request_id":id}),
        )
        .await
        .unwrap();
    assert_eq!(receipt["current_plan"]["plan"]["state"], "paused");
    edit["request_id"] = json!(Uuid::now_v7());
    edit["expected_revision"] = paused["revision"].clone();
    assert_eq!(
        f.call("schedule_save_active_plan_v1", edit).await.unwrap()["state"],
        "paused"
    );
    f.close().await;
}

#[tokio::test]
async fn unsupported_activation_rolls_back_the_entire_creation() {
    let f = Fixture::new(ScheduleStorageMode::ManagementFoundation);
    assert_eq!(
        f.call("schedule_save_active_plan_v1", save())
            .await
            .unwrap_err(),
        E::StorageDisabled.into()
    );
    let plans = f.call("schedule_list_plans_v1", json!({})).await.unwrap();
    assert!(plans["items"].as_array().unwrap().is_empty());
    f.close().await;
}
