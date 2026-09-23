use super::*;
use crate::chat::lifecycle::Lifecycle;

async fn manual(f: &Fixture) {
    f.worker
        .call(|r| {
            let life = Lifecycle::default();
            let epoch = life.epoch();
            r.manual_runtime.enabled = true;
            r.manual_runtime.lifecycle = Some(life);
            r.manual_runtime
                .observe_host(Some((Uuid::now_v7().to_string(), epoch)));
            r.schedule_dispatch_authority = Some(auth());
            Ok(())
        })
        .await
        .unwrap();
}
fn one(p: &Value) -> Value {
    let mut q = confirmation(p, 1);
    q["expires_at"] = json!(execution::now().unwrap() + 600);
    q
}

#[tokio::test]
async fn feat155_4c1_manual_only_receipts_limits_and_no_replay_permit() {
    let f = Fixture::new(ScheduleStorageMode::ManagementFoundation);
    manual(&f).await;
    let p = f.save("本次手动许可").await;
    let caps = f
        .call("schedule_operation_capabilities_v1", json!({}))
        .await
        .unwrap();
    assert_eq!(caps["manual"]["available"], true);
    assert_eq!(caps["automatic"]["available"], false);
    assert_eq!(
        f.call("schedule_confirm_grant_v1", confirmation(&p, 1))
            .await
            .unwrap_err(),
        E::InvalidInput.into()
    );
    let mut too_many = one(&p);
    too_many["max_runs"] = json!(2);
    assert_eq!(
        f.call("schedule_confirm_grant_v1", too_many)
            .await
            .unwrap_err(),
        E::InvalidInput.into()
    );
    assert_eq!(
        f.call("schedule_confirm_enable_v1", one(&p))
            .await
            .unwrap_err(),
        E::InvalidInput.into()
    );
    let q = one(&p);
    let g = f
        .call("schedule_confirm_grant_v1", q.clone())
        .await
        .unwrap();
    let receipt = f
        .call(
            "schedule_read_execution_receipt_v1",
            json!({"operation":"grant","original_request_id":q["request_id"]}),
        )
        .await
        .unwrap();
    assert_eq!(receipt["grant"], g);
    let id = Uuid::now_v7().to_string();
    let payload = json!({"grant_id":g["grant_id"],"revision":p["revision"]});
    let run = f
        .request("schedule_manual_run_v1", payload.clone(), id.clone())
        .await
        .unwrap();
    assert_eq!(
        f.request("schedule_manual_run_v1", payload.clone(), id.clone())
            .await
            .unwrap(),
        run
    );
    assert_eq!(
        f.call("schedule_get_plan_v1", json!({"plan_id":p["plan_id"]}))
            .await
            .unwrap()["plan"]["state"],
        "paused"
    );
    let op = Uuid::parse_str(run["operation_id"].as_str().unwrap()).unwrap();
    f.worker
        .call(move |r| {
            let n = execution::now().unwrap();
            let a = ScheduleAuthority::local(n).unwrap();
            // The reserved turn is permitted even before create has inserted its outbox.
            assert!(r.manual_runtime.allows(&r.connection, &r.scope, &a, op, n));
            r.expire_manual(n)?;
            assert!(r.scheduled_recovery_candidate(&a, n)?.is_some());
            r.manual_runtime.observe_host(None);
            Ok(())
        })
        .await
        .unwrap();
    assert_eq!(
        f.request("schedule_manual_run_v1", payload, id.clone())
            .await
            .unwrap(),
        run
    );
    let receipt = f
        .call(
            "schedule_read_execution_receipt_v1",
            json!({"operation":"manual","original_request_id":id}),
        )
        .await
        .unwrap();
    assert_eq!(receipt["run"], run);
    f.worker
        .call(move |r| {
            let n = execution::now().unwrap();
            let a = ScheduleAuthority::local(n).unwrap();
            assert!(!r.manual_runtime.allows(&r.connection, &r.scope, &a, op, n));
            r.expire_manual(n)?;
            r.expire_manual(n)?;
            assert_eq!(
                r.connection
                    .query_row("SELECT occupied_runs FROM chat_scheduled_grants", [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            assert_eq!(
                r.connection
                    .query_row("SELECT count(*) FROM chat_scheduled_reservation", [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            Ok(())
        })
        .await
        .unwrap();
    let preview = f
        .call(
            "schedule_preview_rerun_v1",
            json!({"original_run_id":run["run_id"]}),
        )
        .await
        .unwrap();
    let mut rerun = preview["confirmation"].clone();
    rerun["grant_id"] = g["grant_id"].clone();
    assert_eq!(
        f.call("schedule_confirm_rerun_v1", rerun)
            .await
            .unwrap_err(),
        E::ExecutionNotReady.into()
    );
    if let Some(dir) = std::env::var_os("YIJIE_FEAT155_CONFORMANCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            PathBuf::from(dir).join("phase-4c1-ipc-producer.json"),
            serde_json::to_vec_pretty(&*f.exchanges.lock().unwrap()).unwrap(),
        )
        .unwrap();
    }
    f.close().await;
}

#[tokio::test]
async fn feat155_4c1_prior_grant_cannot_mint_permission_and_scope_isolated() {
    let f = Fixture::new(ScheduleStorageMode::ManagementFoundation);
    let p = f.save("旧许可").await;
    let q = one(&p);
    let g = f
        .call("schedule_confirm_grant_v1", q.clone())
        .await
        .unwrap();
    manual(&f).await;
    assert_eq!(
        f.call("schedule_confirm_grant_v1", q.clone())
            .await
            .unwrap(),
        g
    );
    assert_eq!(
        f.call(
            "schedule_manual_run_v1",
            json!({"grant_id":g["grant_id"],"revision":1})
        )
        .await
        .unwrap_err(),
        E::GrantMissing.into()
    );
    assert_eq!(
        f.call(
            "schedule_read_execution_receipt_v1",
            json!({"operation":"manual","original_request_id":q["request_id"]})
        )
        .await
        .unwrap()["observation"],
        "not_observed"
    );
    let id = q["request_id"].as_str().unwrap().to_owned();
    f.worker
        .call(move |r| {
            let original = r.scope.clone();
            r.scope =
                ChatScope::new(Uuid::now_v7().to_string(), original.tenant_id.clone()).unwrap();
            let receipt = r
                .execution_receipt(
                    wire::ExecutionReceiptKey {
                        operation: wire::ExecutionReceiptKeyOperation::Grant,
                        original_request_id: id,
                    },
                    execution::now().unwrap(),
                )
                .unwrap();
            assert_eq!(receipt["observation"], "not_observed");
            r.scope = original;
            Ok(())
        })
        .await
        .unwrap();
    f.close().await;
}

#[tokio::test]
async fn feat155_4c1_ui_refresh_invalidates_claim_and_never_sent_refunds_once() {
    let mut f = Fixture::new(ScheduleStorageMode::ManagementFoundation);
    manual(&f).await;
    let p = f.save("不跨会话授权").await;
    let g = f.call("schedule_confirm_grant_v1", one(&p)).await.unwrap();
    let run = f
        .call(
            "schedule_manual_run_v1",
            json!({"grant_id":g["grant_id"],"revision":1}),
        )
        .await
        .unwrap();
    f.context = bind(&f.ui, execution::now().unwrap() + 240);
    let op = Uuid::parse_str(run["operation_id"].as_str().unwrap()).unwrap();
    f.worker
        .call(move |r| {
            let n = execution::now().unwrap();
            let a = ScheduleAuthority::local(n).unwrap();
            assert!(!r.manual_runtime.allows(&r.connection, &r.scope, &a, op, n));
            assert!(r.claim_next_conversation_outbox(n, 30)?.is_none());
            r.expire_manual(n)?;
            r.expire_manual(n)?;
            assert_eq!(
                r.connection
                    .query_row("SELECT delivery_state FROM chat_scheduled_runs", [], |r| {
                        r.get::<_, String>(0)
                    })
                    .unwrap(),
                "cancelled"
            );
            assert_eq!(
                r.connection
                    .query_row("SELECT refunded FROM chat_scheduled_recovery", [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                1
            );
            Ok(())
        })
        .await
        .unwrap();
    f.close().await;
}
