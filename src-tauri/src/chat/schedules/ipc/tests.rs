use super::*;
use crate::chat::{
    authorization::AuthoritativeChatProjection,
    database::ChatScope,
    error::ChatError,
    keychain::{DatabaseKey, DatabaseKeyStore, ReceiptKey, ReceiptKeyStore},
    schedules::{generated::*, ScheduleStorageMode},
};
use crate::local_profile::*;
use std::path::PathBuf;
struct Keys;
impl DatabaseKeyStore for Keys {
    fn load_or_create(&self, _: bool) -> Result<DatabaseKey, ChatError> {
        Ok(DatabaseKey::from_bytes([155; 32]))
    }
}
impl ReceiptKeyStore for Keys {
    fn load_or_create(&self, _: bool) -> Result<ReceiptKey, ChatError> {
        Ok(ReceiptKey::from_bytes([156; 32]))
    }
}
fn scope() -> ChatScope {
    ChatScope::new(DEMO_FAST_OWNER_USER_ID.into(), DEMO_FAST_TENANT_ID.into()).unwrap()
}
fn auth() -> NativeAuthRuntime {
    NativeAuthRuntime::from_environment_with_test_profile(
        None,
        false,
        LocalRuntimeProfile::DemoFast,
    )
}
fn bind(ui: &ChatAuthorizationManager, expiry: i64) -> Uuid {
    ui.bind(
        AuthoritativeChatProjection::from_trusted_native_projection(
            Uuid::parse_str(DEMO_FAST_TENANT_ID).unwrap(),
            1,
            expiry,
            demo_fast_capabilities(),
        )
        .unwrap(),
        execution::now().unwrap(),
    )
    .unwrap()
    .context_id
}
struct Fixture {
    exchanges: Mutex<Vec<Value>>,
    worker: DatabaseWorker,
    ui: ChatAuthorizationManager,
    context: Uuid,
    ipc: ScheduleIpcRuntime,
    root: PathBuf,
}
impl Fixture {
    fn new(mode: ScheduleStorageMode) -> Self {
        let root = std::env::temp_dir().join(format!("feat155-3c3a-{}", Uuid::now_v7()));
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
        Self {
            exchanges: Mutex::new(Vec::new()),
            worker,
            ui,
            context,
            ipc: ScheduleIpcRuntime::default(),
            root,
        }
    }
    // Historical schema21 enable is seeded through its original native service.
    // The current IPC requires SQL24, a reviewed next_at and live confirmation.
    async fn legacy_enable(&self, payload: Value) -> Result<Value, Code> {
        self.worker
            .call(move |r| {
                let n = execution::now().unwrap();
                Ok(r.enable_schedule(
                    &ScheduleAuthority::local(n).unwrap(),
                    serde_json::from_value(payload).unwrap(),
                    n,
                )
                .map(super::super::automatic::receipt_value)
                .map_err(Code::from))
            })
            .await
            .unwrap()
    }
    async fn call(&self, name: &'static str, payload: Value) -> Result<Value, Code> {
        let id = payload["request_id"]
            .as_str()
            .or_else(|| payload["confirmation"]["request_id"].as_str())
            .map(str::to_owned)
            .unwrap_or_else(|| Uuid::now_v7().to_string());
        self.request(name, payload, id).await
    }
    async fn request(&self, name: &'static str, payload: Value, id: String) -> Result<Value, Code> {
        self.worker
            .call(|r| {
                if r.schedule_draft_writes_enabled && r.draft_runtime.lifecycle.is_none() {
                    let lifecycle = crate::chat::lifecycle::Lifecycle::default();
                    let epoch = lifecycle.epoch();
                    r.draft_runtime.lifecycle = Some(lifecycle);
                    r.draft_host_observed(Uuid::now_v7().to_string(), epoch)?;
                }
                Ok(())
            })
            .await
            .unwrap();
        let request =
            json!({"schemaVersion":1,"requestId":id,"contextId":self.context,"payload":payload});
        let response = execute(
            &self.worker,
            auth(),
            self.ui.clone(),
            self.ipc.clone(),
            request.clone(),
            name,
        )
        .await?;
        self.exchanges
            .lock()
            .unwrap()
            .push(json!({"command":name,"request":request,"response":response}));
        Ok(response["data"].clone())
    }

    async fn save(&self, name: &str) -> Value {
        let mut q = save();
        q["definition"]["name"] = json!(name);
        self.call("schedule_save_plan_v1", q).await.unwrap()
    }
    async fn close(self) {
        let root = self.root.clone();
        drop(self);
        std::fs::remove_dir_all(root).unwrap();
    }
}
fn save() -> Value {
    json!({"request_id":Uuid::now_v7(),"definition":{"name":"合成计划","content":"仅检查本地记录","rule":{"frequency":"daily","time_zone":"Asia/Shanghai","local_time":"09:00"},"target":{"mode":"dedicated_chat"}}})
}
fn confirmation(p: &Value, max: i64) -> Value {
    json!({"request_id":Uuid::now_v7(),"plan_id":p["plan_id"],"expected_revision":p["revision"],"max_runs":max,"expires_at":execution::now().unwrap()+3600})
}
#[tokio::test]
async fn feat155_3c3a_default_and_compatible_reader_never_gain_writer() {
    let f = Fixture::new(ScheduleStorageMode::CompatibleReader);
    let a = f.call("schedule_availability_v1", json!({})).await.unwrap();
    assert_eq!(a["schema_version"], 15);
    assert_eq!(a["dispatch"], "disabled");
    assert_eq!(
        f.call("schedule_list_plans_v1", json!({}))
            .await
            .unwrap_err(),
        E::StorageDisabled.into()
    );
    assert_eq!(f.worker.schema_version().await.unwrap(), 15);
    f.close().await;
    let f = Fixture::new(ScheduleStorageMode::TriggerFoundation);
    f.save("已保存").await;
    let root = f.root.clone();
    drop(f);
    let worker =
        DatabaseWorker::start(root.join("chat"), scope(), Box::new(Keys), Box::new(Keys)).unwrap();
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
    let a = f.call("schedule_availability_v1", json!({})).await.unwrap();
    assert_eq!(a["schema_version"], 21);
    assert_eq!(a["writable"], false);
    assert_eq!(a["dispatch"], "disabled");
    assert_eq!(
        f.call("schedule_list_plans_v1", json!({})).await.unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        f.call("schedule_save_plan_v1", save()).await.unwrap_err(),
        P::StorageReadOnly.into()
    );
    f.close().await;
}
#[tokio::test]
async fn feat155_3c3a_queries_page_and_bind_cursor_without_mutation() {
    let f = Fixture::new(ScheduleStorageMode::TriggerFoundation);
    for _ in 0..3 {
        f.save("同名").await;
    }
    let a = f
        .call("schedule_list_plans_v1", json!({"limit":2}))
        .await
        .unwrap();
    assert_eq!(a["items"].as_array().unwrap().len(), 2);
    let b = f
        .call(
            "schedule_list_plans_v1",
            json!({"limit":2,"cursor":a["next_cursor"]}),
        )
        .await
        .unwrap();
    assert_eq!(b["items"].as_array().unwrap().len(), 1);
    assert!(b.get("next_cursor").is_none());
    assert!(a["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| p["plan_id"] != b["items"][0]["plan_id"]));
    assert_eq!(
        f.call(
            "schedule_list_plans_v1",
            json!({"limit":2,"state":"paused","cursor":a["next_cursor"]})
        )
        .await
        .unwrap_err(),
        P::CursorInvalid.into()
    );
    assert_eq!(
        f.call("schedule_list_plans_v1", json!({"limit":101}))
            .await
            .unwrap_err(),
        E::InvalidInput.into()
    );
    let mut f = f;
    f.context = bind(&f.ui, execution::now().unwrap() + 240);
    assert_eq!(
        f.call(
            "schedule_list_plans_v1",
            json!({"limit":2,"cursor":a["next_cursor"]})
        )
        .await
        .unwrap_err(),
        P::CursorInvalid.into()
    );
    f.worker
        .call(|r| {
            assert_eq!(
                r.connection
                    .query_row("SELECT count(*) FROM chat_scheduled_runs", [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            assert!(r.schedule_dispatch_authority.is_none());
            Ok(())
        })
        .await
        .unwrap();
    f.close().await;
}
#[tokio::test]
async fn feat155_3c3a_save_grant_enable_and_request_replay_stay_separate() {
    let f = Fixture::new(ScheduleStorageMode::TriggerFoundation);
    let req = save();
    let p = f.call("schedule_save_plan_v1", req.clone()).await.unwrap();
    assert_eq!(f.call("schedule_save_plan_v1", req).await.unwrap(), p);
    assert_eq!(p["state"], "paused");
    let g = f
        .call("schedule_confirm_grant_v1", confirmation(&p, 2))
        .await
        .unwrap();
    assert_eq!(g["occupied_runs"], 0);
    assert_eq!(
        f.call("schedule_get_plan_v1", json!({"plan_id":p["plan_id"]}))
            .await
            .unwrap()["plan"]["state"],
        "paused"
    );
    let c = confirmation(&p, 2);
    let enabled = f.legacy_enable(c.clone()).await.unwrap();
    assert_eq!(enabled["plan"]["state"], "enabled");
    assert_eq!(f.legacy_enable(c).await.unwrap(), enabled);
    let mutation = json!({"plan_id":p["plan_id"],"expected_revision":enabled["plan"]["revision"]});
    let id = Uuid::now_v7().to_string();
    let paused = f
        .request("schedule_pause_plan_v1", mutation.clone(), id.clone())
        .await
        .unwrap();
    assert_eq!(
        f.request("schedule_pause_plan_v1", mutation.clone(), id.clone())
            .await
            .unwrap(),
        paused
    );
    assert_eq!(
        f.request("schedule_delete_plan_v1", mutation, id)
            .await
            .unwrap_err(),
        E::RequestConflict.into()
    );
    let deleted = f
        .call(
            "schedule_delete_plan_v1",
            json!({"plan_id":p["plan_id"],"expected_revision":paused["revision"]}),
        )
        .await
        .unwrap();
    assert_eq!(deleted["state"], "deleted");
    assert_eq!(
        f.call("schedule_list_plans_v1", json!({"include_deleted":true}))
            .await
            .unwrap()["items"][0]["effective_state"],
        "deleted"
    );
    f.close().await;
}
#[tokio::test]
async fn feat155_3c3a_manual_delete_guard_links_unknown_and_trusted_release() {
    let f = Fixture::new(ScheduleStorageMode::TriggerFoundation);
    let p = f.save("在途").await;
    let idle = f.save("空闲").await;
    let g = f
        .call("schedule_confirm_grant_v1", confirmation(&p, 1))
        .await
        .unwrap();
    let id = Uuid::now_v7().to_string();
    let input = json!({"grant_id":g["grant_id"],"revision":p["revision"]});
    let run = f
        .request("schedule_manual_run_v1", input.clone(), id.clone())
        .await
        .unwrap();
    assert_eq!(
        f.request("schedule_manual_run_v1", input, id)
            .await
            .unwrap(),
        run
    );
    assert_eq!(
        f.call(
            "schedule_delete_plan_v1",
            json!({"plan_id":p["plan_id"],"expected_revision":p["revision"]})
        )
        .await
        .unwrap_err(),
        E::ReservationBusy.into()
    );
    f.call(
        "schedule_delete_plan_v1",
        json!({"plan_id":idle["plan_id"],"expected_revision":idle["revision"]}),
    )
    .await
    .unwrap();
    let pid = p["plan_id"].as_str().unwrap().to_owned();
    f.worker
        .call(move |r| {
            assert_eq!(
                r.delete_schedule(&pid, 1),
                Err(ScheduleErrorCode::ExecutionNotReady)
            );
            Ok(())
        })
        .await
        .unwrap();
    let detail = f
        .call(
            "schedule_get_record_v1",
            json!({"kind":"run","run_id":run["run_id"]}),
        )
        .await
        .unwrap();
    assert_eq!(detail["record"]["conversation"]["status"], "available");
    assert_eq!(detail["record"]["timing"]["duration"], "not_started");
    assert_eq!(detail["record"]["business_result"], "not_evaluated");
    let rid = run["run_id"].as_str().unwrap().to_owned();
    f.worker.call(move|r|{r.connection.execute("UPDATE chat_scheduled_runs SET delivery_state='uncertain',needs_attention=1 WHERE run_id=?1",[&rid]).unwrap();Ok(())}).await.unwrap();
    assert_eq!(
        f.call(
            "schedule_delete_plan_v1",
            json!({"plan_id":p["plan_id"],"expected_revision":p["revision"]})
        )
        .await
        .unwrap_err(),
        E::ReservationBusy.into()
    );
    let rid = run["run_id"].as_str().unwrap().to_owned();
    f.worker
        .call(move |r| {
            r.cancel_unsent_schedule(
                &ScheduleAuthority::local(execution::now().unwrap()).unwrap(),
                &rid,
                execution::now().unwrap(),
            )
        })
        .await
        .unwrap();
    f.call(
        "schedule_delete_plan_v1",
        json!({"plan_id":p["plan_id"],"expected_revision":p["revision"]}),
    )
    .await
    .unwrap();
    let history = f.call("schedule_list_records_v1", json!({})).await.unwrap();
    assert_eq!(history["items"].as_array().unwrap().len(), 1);
    assert_eq!(history["items"][0]["plan"]["effective_state"], "deleted");
    f.close().await;
}
#[tokio::test]
async fn feat155_3c3a_effective_state_occurrence_truth_and_completion_priority() {
    let f = Fixture::new(ScheduleStorageMode::TriggerFoundation);
    let p = f.save("一次已完成").await;
    let enabled = f.legacy_enable(confirmation(&p, 1)).await.unwrap();
    let pid = p["plan_id"].as_str().unwrap().to_owned();
    let n = execution::now().unwrap();
    f.worker.call(move|r|{r.connection.execute("UPDATE chat_scheduled_plans SET state='completed',future_hold='budget' WHERE plan_id=?1",[&pid]).unwrap();r.connection.execute("INSERT INTO chat_scheduled_occurrences(owner_user_id,tenant_id,plan_id,schedule_epoch,logical_slot,scheduled_at,disposition) VALUES(?1,?2,?3,1,'2026-01-01T09:00',?4,'missed_offline')",rusqlite::params![r.scope.owner_user_id,r.scope.tenant_id,pid,n-100]).unwrap();Ok(())}).await.unwrap();
    let detail = f
        .call("schedule_get_plan_v1", json!({"plan_id":p["plan_id"]}))
        .await
        .unwrap();
    assert_eq!(detail["summary"]["effective_state"], "completed");
    assert!(detail["summary"].get("pause_reason").is_none());
    let h = f
        .call("schedule_list_records_v1", json!({"state":"completed"}))
        .await
        .unwrap();
    assert_eq!(h["items"].as_array().unwrap().len(), 1);
    assert_eq!(h["items"][0]["kind"], "occurrence");
    assert!(h["items"][0].get("run").is_none());
    assert_eq!(
        f.call("schedule_list_records_v1", json!({"state":"paused"}))
            .await
            .unwrap()["items"],
        json!([])
    );
    assert_eq!(enabled["grant"]["occupied_runs"], 0);
    f.close().await;
}
#[tokio::test]
async fn feat155_3c3a_current_context_and_commit_deadline_fail_closed() {
    let f = Fixture::new(ScheduleStorageMode::TriggerFoundation);
    let _new = bind(&f.ui, execution::now().unwrap() + 240);
    assert_eq!(
        f.call("schedule_save_plan_v1", save()).await.unwrap_err(),
        P::ContextInvalid.into()
    );
    f.worker
        .call(|r| {
            r.schedule_ui_deadline = Some(execution::now().unwrap() - 1);
            let req: SavePlanRequest = serde_json::from_value(save()).unwrap();
            assert_eq!(
                r.save_schedule(req, execution::now().unwrap()),
                Err(ScheduleErrorCode::ExecutionNotReady)
            );
            r.schedule_ui_deadline = None;
            assert!(r.list_schedules().unwrap().is_empty());
            Ok(())
        })
        .await
        .unwrap();
    let other = ChatScope::new(Uuid::now_v7().to_string(), DEMO_FAST_TENANT_ID.into()).unwrap();
    assert!(f
        .ui
        .with_schedule_context(
            f.context,
            &other,
            true,
            true,
            execution::now().unwrap(),
            |_, _| ()
        )
        .is_err());
    f.close().await;
}
#[test]
fn feat155_3c3a_source_validation_rejects_bounds_unknown_and_null() {
    let req = json!({"schemaVersion":1,"requestId":Uuid::now_v7(),"contextId":Uuid::now_v7(),"payload":{"limit":20}});
    assert!(validation::valid("ListPlansRequest", &req));
    for (key, v) in [
        ("limit", json!(0)),
        ("limit", json!(101)),
        ("limit", json!(1.2)),
        ("state", json!("future")),
        ("cursor", Value::Null),
        ("native_authority", json!("none")),
    ] {
        let mut r = req.clone();
        r["payload"][key] = v;
        assert!(!validation::valid("ListPlansRequest", &r));
    }
    let mut req = req;
    req["schemaVersion"] = json!(2);
    assert!(!validation::valid("ListPlansRequest", &req));
}
#[tokio::test]
async fn feat155_3c3a_native_producer_private_and_shared_conformance() {
    let f = Fixture::new(ScheduleStorageMode::TriggerFoundation);
    let mut request = save();
    request["definition"]["target"]["mode"] = json!("new_chat_each_run");
    let p = f.call("schedule_save_plan_v1", request).await.unwrap();
    let g = f
        .call("schedule_confirm_grant_v1", confirmation(&p, 2))
        .await
        .unwrap();
    let run = f
        .call(
            "schedule_manual_run_v1",
            json!({"grant_id":g["grant_id"],"revision":p["revision"]}),
        )
        .await
        .unwrap();
    for (name, payload) in [
        ("schedule_availability_v1", json!({})),
        ("schedule_list_plans_v1", json!({})),
        ("schedule_get_plan_v1", json!({"plan_id":p["plan_id"]})),
        ("schedule_list_records_v1", json!({})),
        (
            "schedule_get_record_v1",
            json!({"kind":"run","run_id":run["run_id"]}),
        ),
        ("schedule_list_targets_v1", json!({})),
        (
            "schedule_preview_time_v1",
            json!({"rule":p["definition"]["rule"]}),
        ),
        (
            "schedule_preview_rerun_v1",
            json!({"original_run_id":run["run_id"]}),
        ),
    ] {
        f.call(name, payload).await.unwrap();
    }
    let preview = f
        .call(
            "schedule_preview_rerun_v1",
            json!({"original_run_id":run["run_id"]}),
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
    let mut rerun_confirmation = preview["confirmation"].clone();
    rerun_confirmation["grant_id"] = g["grant_id"].clone();
    let rerun = f
        .call("schedule_confirm_rerun_v1", rerun_confirmation)
        .await
        .unwrap_or_else(|e| panic!("rerun error code: {}", serde_json::to_string(&e).unwrap()));
    let rid = rerun["run_id"].as_str().unwrap().to_owned();
    f.worker
        .call(move |r| {
            let n = execution::now().unwrap();
            r.cancel_unsent_schedule(&ScheduleAuthority::local(n).unwrap(), &rid, n)
        })
        .await
        .unwrap();
    let paused = f
        .call(
            "schedule_pause_plan_v1",
            json!({"plan_id":p["plan_id"],"expected_revision":p["revision"]}),
        )
        .await
        .unwrap();
    let enabled = f.legacy_enable(confirmation(&paused, 1)).await.unwrap();
    f.call(
        "schedule_delete_plan_v1",
        json!({"plan_id":p["plan_id"],"expected_revision":enabled["plan"]["revision"]}),
    )
    .await
    .unwrap();
    f.call("schedule_list_plan_cards_v1", json!({}))
        .await
        .unwrap();
    f.call("schedule_list_record_rows_v1", json!({}))
        .await
        .unwrap();
    f.call(
        "schedule_read_plan_mutation_receipt_v1",
        json!({"original_request_id":Uuid::now_v7()}),
    )
    .await
    .unwrap();
    let outputs = f.exchanges.lock().unwrap().clone();
    if let Some(dir) = std::env::var_os("YIJIE_FEAT155_CONFORMANCE_DIR") {
        let path = PathBuf::from(dir);
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(
            path.join("phase-3c3a-ipc-producer.json"),
            serde_json::to_vec_pretty(&outputs).unwrap(),
        )
        .unwrap();
    }
    f.close().await;
}

#[tokio::test]
async fn feat155_3c3a_queued_write_rechecks_rebound_context_and_native_capabilities() {
    let f = Fixture::new(ScheduleStorageMode::TriggerFoundation);
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let blocker = f.worker.clone();
    let blocked = tokio::spawn(async move {
        blocker
            .call(move |_| {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            })
            .await
            .unwrap()
    });
    entered_rx.await.unwrap();
    let worker = f.worker.clone();
    let ui = f.ui.clone();
    let ipc = f.ipc.clone();
    let request = json!({"schemaVersion":1,"requestId":Uuid::now_v7(),"contextId":f.context,"payload":{"plan_id":Uuid::now_v7(),"expected_revision":1}});
    let queued = tokio::spawn(async move {
        execute(&worker, auth(), ui, ipc, request, "schedule_delete_plan_v1").await
    });
    tokio::task::yield_now().await;
    let _fresh = bind(&f.ui, execution::now().unwrap() + 240);
    release_tx.send(()).unwrap();
    blocked.await.unwrap();
    assert_eq!(queued.await.unwrap().unwrap_err(), P::ContextInvalid.into());
    let mut f = f;
    f.context =
        f.ui.bind(
            AuthoritativeChatProjection::from_trusted_native_projection(
                Uuid::parse_str(DEMO_FAST_TENANT_ID).unwrap(),
                2,
                execution::now().unwrap() + 240,
                vec!["task.read".into(), "schedule.read".into()],
            )
            .unwrap(),
            execution::now().unwrap(),
        )
        .unwrap()
        .context_id;
    assert_eq!(
        f.call("schedule_save_plan_v1", save()).await.unwrap_err(),
        E::ScopeDenied.into()
    );
    assert_eq!(
        f.call("schedule_list_plans_v1", json!({}))
            .await
            .unwrap_err(),
        E::ScopeDenied.into()
    );
    f.close().await;
}
#[tokio::test]
async fn feat155_3c3a_deleted_link_is_tombstone_and_history_remains_scoped() {
    let f = Fixture::new(ScheduleStorageMode::TriggerFoundation);
    let p = f.save("保留历史").await;
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
    let detail = f
        .call(
            "schedule_get_record_v1",
            json!({"kind":"run","run_id":run["run_id"]}),
        )
        .await
        .unwrap();
    let chat = detail["record"]["conversation"]["conversation_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let targets = f
        .call("schedule_list_targets_v1", json!({"limit":1}))
        .await
        .unwrap();
    assert_eq!(targets["items"][0]["conversation_id"], chat);
    assert_eq!(targets["items"][0]["can_save"], true);
    let rid = run["run_id"].as_str().unwrap().to_owned();
    f.worker.call(move|r|{let n=execution::now().unwrap();r.cancel_unsent_schedule(&ScheduleAuthority::local(n).unwrap(),&rid,n)?;r.connection.execute("UPDATE chat_scheduled_run_bindings SET target_deleted=1,conversation_id=NULL WHERE run_id=?1",[&rid]).unwrap();Ok(())}).await.unwrap();
    let detail = f
        .call(
            "schedule_get_record_v1",
            json!({"kind":"run","run_id":run["run_id"]}),
        )
        .await
        .unwrap();
    assert_eq!(
        detail["record"]["conversation"],
        json!({"status":"deleted"})
    );
    assert!(detail["configuration"].get("conversation_id").is_none());
    let p2 = f.save("其它计划").await;
    assert_eq!(
        f.call("schedule_list_records_v1", json!({"plan_id":p2["plan_id"]}))
            .await
            .unwrap()["items"],
        json!([])
    );
    f.close().await;
}
#[test]
fn feat155_3c3a_native_validator_parity_corpus() {
    let mut rows = Vec::new();
    let request = json!({"schemaVersion":1,"requestId":Uuid::now_v7(),"contextId":Uuid::now_v7(),"payload":{"limit":20}});
    rows.push(json!({"schema":"ListPlansRequest","value":request,"valid":true}));
    for (key, v) in [
        ("limit", json!(0)),
        ("limit", json!(101)),
        ("limit", json!(1.5)),
        ("cursor", Value::Null),
        ("state", json!("unknown")),
        ("authority", json!(false)),
    ] {
        let mut r = request.clone();
        r["payload"][key] = v;
        rows.push(json!({"schema":"ListPlansRequest","value":r,"valid":false}));
    }
    for (time, valid) in [
        ("23:59", true),
        ("24:00", false),
        ("09:60", false),
        ("上午", false),
    ] {
        let r = json!({"schemaVersion":1,"requestId":Uuid::now_v7(),"contextId":Uuid::now_v7(),"payload":{"rule":{"frequency":"daily","time_zone":"Asia/Shanghai","local_time":time}}});
        rows.push(json!({"schema":"PreviewTimeRequest","value":r,"valid":valid}));
    }
    for row in &rows {
        assert_eq!(
            validation::valid(row["schema"].as_str().unwrap(), &row["value"]),
            row["valid"].as_bool().unwrap()
        );
    }
    if let Some(dir) = std::env::var_os("YIJIE_FEAT155_CONFORMANCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            PathBuf::from(dir).join("phase-3c3a-validator-parity.json"),
            serde_json::to_vec_pretty(&rows).unwrap(),
        )
        .unwrap();
    }
}
#[tokio::test]
async fn feat155_3c3a_last_reserved_run_is_independent_of_future_budget_hold() {
    let f = Fixture::new(ScheduleStorageMode::TriggerFoundation);
    let p = f.save("最后一次已预约").await;
    let enabled = f.legacy_enable(confirmation(&p, 1)).await.unwrap();
    let run = f
        .call(
            "schedule_manual_run_v1",
            json!({"grant_id":enabled["grant"]["grant_id"],"revision":enabled["plan"]["revision"]}),
        )
        .await
        .unwrap();
    let detail = f
        .call("schedule_get_plan_v1", json!({"plan_id":p["plan_id"]}))
        .await
        .unwrap();
    assert_eq!(detail["summary"]["raw_state"], "enabled");
    assert_eq!(detail["summary"]["effective_state"], "paused");
    assert_eq!(detail["summary"]["pause_reason"], "budget");
    let records = f
        .call("schedule_list_records_v1", json!({"state":"paused"}))
        .await
        .unwrap();
    assert_eq!(records["items"].as_array().unwrap().len(), 1);
    assert_eq!(records["items"][0]["run"], run);
    assert_eq!(records["items"][0]["kind"], "run");
    f.close().await;
}

mod draft_tests;

mod recovery_tests;

mod management_tests;
mod manual_tests;

mod automatic_tests;

mod single_tests;
#[tokio::test]
async fn feat155_4d1_private_reader_accepts_26_without_execution_read_side_effects() {
    let f = Fixture::new(ScheduleStorageMode::TimingFoundation);
    let a = f.call("schedule_availability_v1", json!({})).await.unwrap();
    assert_eq!(a["schema_version"], 26);
    assert_eq!(a["readable"], true);
    let caps = f
        .call("schedule_operation_capabilities_v1", json!({}))
        .await
        .unwrap();
    assert_eq!(caps["read"]["available"], true);
    assert_eq!(caps["manual"]["available"], false);
    f.worker
        .call(|r| {
            assert_eq!(
                r.connection
                    .query_row("SELECT count(*) FROM chat_scheduled_timing", [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            Ok(())
        })
        .await
        .unwrap();
}

#[test]
fn feat155_4d1_strict_clock_consumer_and_private_projection() {
    use crate::chat::schedules::timing_generated::NativeTurnTiming;
    let id = Uuid::now_v7().to_string();
    let good = json!({"schema_version":1,"agent_session_id":id,"thread_id":id,"turn_id":id,"source":"runtime_read","started_at":{"state":"known","value":0},"completed_at":{"state":"unknown"},"duration_ms":{"state":"known","value":440}});
    assert!(serde_json::from_value::<NativeTurnTiming>(good.clone()).is_ok());
    for (key, value) in [
        ("started_at", json!({"state":"known"})),
        ("duration_ms", json!({"state":"known","value":-1})),
        ("started_at", json!({"state":"unknown","value":0})),
        ("started_at", json!({"state":"known","value":null})),
        ("thread_id", json!(Uuid::nil())),
        ("source", json!("local_receive")),
        ("schema_version", json!(2)),
    ] {
        let mut v = good.clone();
        v[key] = value;
        assert!(serde_json::from_value::<NativeTurnTiming>(v).is_err());
    }
    assert!(validation::valid(
        "Timing",
        &json!({"execution_time":"known","duration":"known","source":"runtime_read","started_at":0,"duration_ms":440,"time_zone":"UTC"})
    ));
    assert!(!validation::valid(
        "Timing",
        &json!({"execution_time":"known","duration":"unknown","source":"runtime_read"})
    ));
}

#[tokio::test]
async fn feat155_final_important_updates_are_scoped_read_only_and_bounded() {
    let f = Fixture::new(ScheduleStorageMode::TriggerFoundation);
    let p = f.save("通知快照").await;
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
    let input_id = rid.clone();
    f.worker.call(move |r| {
        // Normal declared rows in an isolated fixture, with distinct logical IDs.
        for _ in 0..55 {
            r.connection.execute("INSERT INTO chat_scheduled_runs SELECT ?1,owner_user_id,tenant_id,format_version,plan_id,plan_revision,schedule_epoch,?2,request_digest,?3,trigger_source,original_run_id,logical_slot,grant_id,snapshot_json,snapshot_digest,workspace_source,workspace_id,permission_mode,delivery_state,'completed',0 FROM chat_scheduled_runs WHERE run_id=?4",rusqlite::params![Uuid::now_v7().to_string(),Uuid::now_v7().to_string(),Uuid::now_v7().to_string(),input_id]).unwrap();
        }
        r.connection.execute("UPDATE chat_scheduled_runs SET needs_attention=1 WHERE run_id=?1",[input_id]).unwrap();
        Ok(())
    }).await.unwrap();
    let before = f
        .worker
        .call(|r| Ok(r.connection.total_changes()))
        .await
        .unwrap();
    let page = f
        .call("schedule_list_important_updates_v1", json!({}))
        .await
        .unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 50);
    assert_eq!(page["truncated"], true);
    assert_eq!(
        page["items"][0],
        json!({"run_id":rid,"plan_id":p["plan_id"],"name":"通知快照","state":"needs_attention"})
    );
    assert_eq!(
        page,
        f.call("schedule_list_important_updates_v1", json!({}))
            .await
            .unwrap()
    );
    assert_eq!(
        before,
        f.worker
            .call(|r| Ok(r.connection.total_changes()))
            .await
            .unwrap()
    );
    // Another valid local scope cannot see the fixture's run names or IDs.
    f.worker
        .call(|r| {
            r.scope.tenant_id = Uuid::now_v7().to_string();
            assert_eq!(query::important_updates(r).unwrap()["items"], json!([]));
            Ok(())
        })
        .await
        .unwrap();
    f.close().await;
}

#[tokio::test]
async fn feat155_final_important_updates_do_not_open_ordinary_storage() {
    let f = Fixture::new(ScheduleStorageMode::CompatibleReader);
    assert_eq!(
        f.call("schedule_list_important_updates_v1", json!({}))
            .await
            .unwrap_err(),
        E::StorageDisabled.into()
    );
    f.worker
        .call(|r| {
            assert_eq!(
                r.connection
                    .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                15
            );
            Ok(())
        })
        .await
        .unwrap();
    f.close().await;
}
