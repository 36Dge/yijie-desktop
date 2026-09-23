use super::*;
use crate::chat::schedules::{draft_generated as draft, draft_recovery::Context};

async fn source(f: &Fixture) -> Context {
    let receipt = f
        .call("schedule_submit_draft_v1", json!({"text":"每天九点总结"}))
        .await
        .unwrap();
    let id = receipt["source_id"].as_str().unwrap().to_owned();
    f.worker
        .call(move |r| {
            r.schedule_draft_dispatch_authority = Some(auth());
            let n = execution::now().unwrap();
            let create = r.claim_next_conversation_outbox(n + 1, 30)?.unwrap();
            r.bind_public_task(create.operation_id, Uuid::now_v7(), n)?;
            r.mark_draft_attempt(create.operation_id)?;
            r.draft_source_context(&id)
        })
        .await
        .unwrap()
}
fn mapping(c: &Context, nonce: &str) -> draft::RecoveryMapping {
    serde_json::from_value(json!({"schema_version":1,"policy_version":1,"purpose":"scheduled_plan_draft","task_id":c.task.unwrap(),"agent_session_id":Uuid::now_v7(),"workspace_id":c.workspace,"mapping_state":"bound","codex_thread_id":Uuid::now_v7(),"responding_host_instance_id":nonce})).unwrap()
}
async fn bind_mapping(f: &Fixture, c: Context) -> Context {
    f.worker
        .call(move |r| {
            let (nonce, epoch) = r.draft_runtime.host.clone().unwrap();
            let m = mapping(&c, &nonce);
            r.apply_draft_mapping(&c, &m, &nonce, epoch)
        })
        .await
        .unwrap()
}
#[tokio::test]
async fn feat155_draft_recovery_binds_facts_only_and_explicit_continue_reuses_original() {
    let f = Fixture::new(ScheduleStorageMode::DraftFoundation);
    let c = source(&f).await;
    let c = bind_mapping(&f, c).await;
    let source = c.source.clone();
    let operation = c.operation;
    f.worker
        .call(move |r| {
            assert_eq!(
                r.connection
                    .query_row(
                        "SELECT count(*) FROM chat_outbox WHERE operation_id=?1",
                        [operation.to_string()],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                0
            );
            // A normal reopen has no volatile action. Recovery only supplies facts.
            r.draft_runtime.actions.clear();
            for n in [1, 120, 3600] {
                assert!(r
                    .claim_next_conversation_outbox(execution::now().unwrap() + n, 30)?
                    .is_none());
            }
            Ok(())
        })
        .await
        .unwrap();
    let lookup = f
        .call(
            "schedule_find_draft_source_v1",
            json!({"conversation_id":c.conversation,"local_turn_id":c.local_turn}),
        )
        .await
        .unwrap();
    assert_eq!(lookup["source"]["source_id"], source);
    assert_eq!(lookup["found"], true);
    let caps = f
        .call("schedule_operation_capabilities_v1", json!({}))
        .await
        .unwrap();
    assert_eq!(caps["draft"]["available"], true);
    assert_eq!(caps["manual"]["available"], false);
    assert_eq!(caps["automatic"]["available"], false);
    let q = json!({"source_id":source});
    let receipt = f
        .call("schedule_continue_draft_source_v1", q.clone())
        .await
        .unwrap();
    assert_eq!(
        f.call("schedule_continue_draft_source_v1", q.clone())
            .await
            .unwrap(),
        receipt
    );
    assert_eq!(receipt["operation_id"], operation.to_string());
    f.worker
        .call(move |r| {
            let claim = r
                .claim_next_conversation_outbox(execution::now().unwrap() + 1, 30)?
                .unwrap();
            assert_eq!(claim.operation_id, operation);
            assert_eq!(
                r.connection
                    .query_row(
                        "SELECT count(*) FROM chat_outbox WHERE operation_id=?1",
                        [operation.to_string()],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                1
            );
            r.mark_draft_attempt(operation)?;
            assert!(r
                .claim_next_conversation_outbox(execution::now().unwrap() + 3600, 30)?
                .is_none());
            Ok(())
        })
        .await
        .unwrap();
    assert!(f
        .call("schedule_continue_draft_source_v1", q)
        .await
        .is_err());
    assert_eq!(
        f.call("schedule_preview_draft_v1", json!({"source_id":source}))
            .await
            .unwrap()["status"],
        "unavailable"
    );
    if let Ok(dir) = std::env::var("YIJIE_FEAT155_CONFORMANCE_DIR") {
        std::fs::write(
            PathBuf::from(dir).join("draft-recovery-ipc-producer.json"),
            serde_json::to_vec_pretty(&*f.exchanges.lock().unwrap()).unwrap(),
        )
        .unwrap();
    }
    f.close().await;
}
#[tokio::test]
async fn feat155_draft_reopen_pending_stays_held_and_accepted_has_unknown_origin() {
    let f = Fixture::new(ScheduleStorageMode::DraftFoundation);
    let c = source(&f).await;
    let c = bind_mapping(&f, c).await;
    f.call(
        "schedule_continue_draft_source_v1",
        json!({"source_id":c.source}),
    )
    .await
    .unwrap();
    let root = f.root.clone();
    drop(f);
    let lifecycle = crate::chat::lifecycle::Lifecycle::default();
    let epoch = lifecycle.epoch();
    let worker = DatabaseWorker::start_scheduled_candidate(
        root.join("chat"),
        scope(),
        Box::new(Keys),
        Box::new(Keys),
        auth(),
        lifecycle.clone(),
    )
    .await
    .unwrap();
    let nonce = Uuid::now_v7().to_string();
    let c1 = c.clone();
    let peer = nonce.clone();
    worker
        .call(move |r| {
            r.draft_host_observed(peer, epoch)?;
            assert!(r.draft_runtime.actions.is_empty());
            assert!(r
                .claim_next_conversation_outbox(execution::now().unwrap() + 3600, 30)?
                .is_none());
            assert_eq!(r.draft_source_context(&c1.source)?, c1);
            Ok(())
        })
        .await
        .unwrap();
    // Fresh explicit native action, then a normal accepted response lost before binding.
    let ui = ChatAuthorizationManager::new(&scope()).unwrap();
    let context = bind(&ui, execution::now().unwrap() + 240);
    let source = c.source.clone();
    let op = c.operation;
    worker
        .call(move |r| {
            r.grant_draft_action(
                &source,
                crate::chat::schedules::draft_runtime::Action {
                    epoch,
                    deadline: execution::now().unwrap() + 240,
                    revision: 1,
                    context,
                    ui,
                },
            )?;
            assert_eq!(
                r.claim_next_conversation_outbox(execution::now().unwrap() + 1, 30)?
                    .unwrap()
                    .operation_id,
                op
            );
            r.mark_draft_attempt(op)?;
            Ok(())
        })
        .await
        .unwrap();
    let c2 = c.clone();
    let peer = nonce.clone();
    worker.call(move|r|{
  let current=r.draft_source_context(&c2.source)?;
  let m:draft::RecoveryMapping=serde_json::from_value(json!({"schema_version":1,"policy_version":1,"purpose":"scheduled_plan_draft","task_id":current.task,"agent_session_id":current.session,"workspace_id":current.workspace,"mapping_state":"bound","codex_thread_id":current.thread,"responding_host_instance_id":peer})).unwrap();
  let current=r.apply_draft_mapping(&current,&m,&peer,epoch)?;
  let accepted=serde_json::from_value(json!({"agent_session_id":current.session,"operation_id":current.operation,"state":"accepted","turn_id":Uuid::now_v7(),"responding_host_instance_id":peer})).unwrap();
  r.apply_draft_operation(&current,&accepted,&peer,epoch)?;
  assert!(r.recovered_draft_observation(current.conversation,current.local_turn,&peer,epoch)?);
  let origin:Option<String>=r.connection.query_row("SELECT host_instance_nonce FROM chat_native_bindings WHERE turn_id=?1",[current.local_turn.to_string()],|r|r.get(0)).unwrap();assert!(origin.is_none());
  assert!(r.claim_next_conversation_outbox(execution::now().unwrap()+3600,30)?.is_none());
  assert_eq!(r.preview_draft(&current.source,execution::now().unwrap()).unwrap()["status"],"unavailable");Ok(())
 }).await.unwrap();
    lifecycle.transition(crate::chat::lifecycle::Phase::Suspended);
    worker
        .call(move |r| {
            assert!(!r.recovered_draft_observation(c.conversation, c.local_turn, &nonce, epoch)?);
            Ok(())
        })
        .await
        .unwrap();
    drop(worker);
    std::fs::remove_dir_all(root).unwrap();
}
