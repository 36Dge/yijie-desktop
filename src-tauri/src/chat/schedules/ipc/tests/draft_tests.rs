use super::*;
use crate::chat::{
    database::DraftContentBlock, native_conversation::NativeDisplayBuffer,
    native_conversation_generated::NativeEvent,
};

#[tokio::test]
async fn feat155_4b_receipt_and_purpose_are_scoped_reads_without_host() {
    use crate::chat::application::{AuthorizedConversationApplication, ConversationApplication};
    use crate::chat::session_purpose_generated::SessionPurpose;
    let f = Fixture::new(ScheduleStorageMode::ManagementFoundation);
    let request = Uuid::now_v7().to_string();
    let key = json!({"original_request_id": request});
    assert_eq!(
        f.call("schedule_read_draft_submission_receipt_v1", key.clone())
            .await
            .unwrap()["observation"],
        "not_observed"
    );
    let receipt = f
        .request(
            "schedule_submit_draft_v1",
            json!({"text":"本地合成草案"}),
            request,
        )
        .await
        .unwrap();
    let observed = f
        .call("schedule_read_draft_submission_receipt_v1", key.clone())
        .await
        .unwrap();
    assert_eq!(observed["receipt"], receipt);
    let session = Uuid::parse_str(receipt["conversation_id"].as_str().unwrap()).unwrap();
    let ui = ChatAuthorizationManager::new(&scope()).unwrap();
    let now = execution::now().unwrap();
    let context = ui
        .bind(
            AuthoritativeChatProjection::from_trusted_native_projection(
                Uuid::parse_str(DEMO_FAST_TENANT_ID).unwrap(),
                1,
                now + 240,
                vec!["task.read".into()],
            )
            .unwrap(),
            now,
        )
        .unwrap()
        .context_id;
    let app = AuthorizedConversationApplication::new(
        ConversationApplication::new_offline(f.worker.clone()),
        ui,
    );
    assert_eq!(
        app.session_purpose(context, session).await.unwrap().purpose,
        SessionPurpose::ScheduledPlanDraft
    );
    assert!(app.session_purpose(context, Uuid::now_v7()).await.is_err());
    assert!(app.session_purpose(Uuid::now_v7(), session).await.is_err());
    f.worker.call(move |r| {
        let counts: (i64,i64)=r.connection.query_row("SELECT (SELECT sum(create_attempted+turn_attempted) FROM chat_scheduled_draft_sources),(SELECT count(*) FROM chat_scheduled_runs)",[],|row|Ok((row.get(0)?,row.get(1)?))).unwrap();
        assert_eq!(counts,(0,0));
        r.connection.execute("DELETE FROM chat_sessions WHERE id=?1",[session.to_string()]).unwrap();
        Ok(())
    }).await.unwrap();
    let deleted = f
        .call("schedule_read_draft_submission_receipt_v1", key)
        .await
        .unwrap();
    assert_eq!(deleted["observation"], "source_deleted");
    assert!(deleted.get("receipt").is_none());
    if let Ok(dir) = std::env::var("YIJIE_FEAT155_CONFORMANCE_DIR") {
        std::fs::write(
            std::path::Path::new(&dir).join("ipc-4b.json"),
            serde_json::to_vec_pretty(&*f.exchanges.lock().unwrap()).unwrap(),
        )
        .unwrap();
    }
    drop(app);
    f.close().await;
}
fn candidate() -> Value {
    json!({"schema_version":1,"kind":"candidate","name":"每天总结","content":"总结当天信息","schedule":{"frequency":"daily","time_zone":"Asia/Shanghai","local_time":"09:00"},"target":{"mode":"dedicated_chat"}})
}

#[tokio::test]
async fn feat155_4b_ordinary_purpose_preserves_sql15_without_schedule_authority() {
    use crate::chat::application::{AuthorizedConversationApplication, ConversationApplication};
    use crate::chat::session_purpose_generated::SessionPurpose;
    let f = Fixture::new(ScheduleStorageMode::CompatibleReader);
    let directory = f.root.join("ordinary");
    std::fs::create_dir(&directory).unwrap();
    let selection = crate::chat::native_project::create_selection(&directory)
        .unwrap()
        .unwrap();
    let session = f
        .worker
        .call(move |r| {
            let project = r.register_project(&selection.canonical_path, &selection.bookmark)?;
            r.create_session_and_enqueue_multimodal(
                Uuid::parse_str(&project.id).unwrap(),
                &[DraftContentBlock::Text("普通合成输入".into())],
                Uuid::now_v7(),
                1,
            )
            .map(|r| r.session_id)
        })
        .await
        .unwrap();
    let ui = ChatAuthorizationManager::new(&scope()).unwrap();
    let now = execution::now().unwrap();
    let context = ui
        .bind(
            AuthoritativeChatProjection::from_trusted_native_projection(
                Uuid::parse_str(DEMO_FAST_TENANT_ID).unwrap(),
                1,
                now + 240,
                vec!["task.read".into()],
            )
            .unwrap(),
            now,
        )
        .unwrap()
        .context_id;
    let app = AuthorizedConversationApplication::new(
        ConversationApplication::new_offline(f.worker.clone()),
        ui,
    );
    assert_eq!(
        app.session_purpose(context, session).await.unwrap().purpose,
        SessionPurpose::Ordinary
    );
    assert_eq!(f.worker.schema_version().await.unwrap(), 15);
    drop(app);
    f.close().await;
}
async fn submit(f: &Fixture) -> Value {
    f.call("schedule_submit_draft_v1", json!({"text":"每天九点总结"}))
        .await
        .unwrap()
}
// Normal declared protocol fixture through the original outbox/binding/native producer.
async fn finish(
    f: &Fixture,
    receipt: &Value,
    output: Value,
    status: &str,
    extra_final: bool,
) -> Value {
    finish_with_phase(
        f,
        receipt,
        output,
        status,
        extra_final,
        Some("final_answer"),
        false,
    )
    .await
}
async fn finish_with_phase(
    f: &Fixture,
    receipt: &Value,
    output: Value,
    status: &str,
    extra_final: bool,
    phase: Option<&str>,
    partial: bool,
) -> Value {
    let id = receipt["source_id"].as_str().unwrap().to_owned();
    let status = status.to_owned();
    let phase = phase.map(str::to_owned);
    f.worker.call(move|r|{
  r.schedule_draft_dispatch_authority=Some(auth());
  let n=execution::now().unwrap();let create=r.claim_next_conversation_outbox(n+1,30)?.unwrap();
  r.guard_conversation_dispatch(create.operation_id)?;
  let task=Uuid::now_v7();r.bind_public_task(create.operation_id,task,n)?;
  r.mark_draft_attempt(create.operation_id)?;
  let thread=Uuid::now_v7();r.bind_host_session_and_enqueue_turn(create.operation_id,task,Uuid::now_v7(),thread)?;
  let turn=r.claim_next_conversation_outbox(n+1,30)?.unwrap();r.mark_draft_attempt(turn.operation_id)?;
  r.accept_native_turn(turn.operation_id,Uuid::now_v7(),&Uuid::now_v7().to_string())?;
  let session=r.connection.query_row("SELECT conversation_id FROM chat_scheduled_draft_sources WHERE source_id=?1",[&id],|row|row.get::<_,String>(0)).unwrap();
  let context=r.active_turn_context(Uuid::parse_str(&session).unwrap())?;
  let mut buffer=NativeDisplayBuffer::new(context.clone(),None)?;
  let text=if let Some(s)=output.as_str(){s.to_owned()}else{output.to_string()};
  let availability=if partial {"partial"} else {"available"};
  let mut facts=vec![json!({"method":"item/completed","itemId":"final-1","item":{"id":"final-1","type":"agentMessage","phase":phase,"text":text,"availability":availability}})];
  if extra_final{facts.push(json!({"method":"item/completed","itemId":"final-2","item":{"id":"final-2","type":"agentMessage","phase":phase,"text":text,"availability":availability}}))}
  facts.push(json!({"method":"turn/completed","turn":{"id":context.runtime_turn_id,"status":status,"items":[],"itemsComplete":false}}));
  let stream=Uuid::now_v7();
  for (i,mut native)in facts.into_iter().enumerate(){native["source"]=json!("runtime_notification");native["threadId"]=json!(thread);native["turnId"]=json!(context.runtime_turn_id);native["availability"]=json!("available");
   let event:NativeEvent=serde_json::from_value(json!({"schema_version":7,"event_id":Uuid::now_v7(),"stream_id":stream,"sequence":i+1,"occurred_at":"2026-09-19T00:00:00Z","task_id":task,"agent_session_id":context.agent_session_id,"codex_thread_id":thread,"event_type":"native.notification","terminal":native["method"]=="turn/completed","payload":{"native":native}})).unwrap();
   assert!(buffer.observe(&event)?);buffer.view=r.commit_native_view(&context,buffer.view.clone(),Some(&event),n)?;
  }
  // View is partial because the turn's complete item inventory is unavailable.
  assert_eq!(buffer.view.availability,"partial");
  Ok(())
 }).await.unwrap();
    f.call(
        "schedule_preview_draft_v1",
        json!({"source_id":receipt["source_id"]}),
    )
    .await
    .unwrap_or_else(|e| json!({"error":e}))
}
fn confirm(preview: &Value) -> Value {
    json!({"source_id":preview["source_id"],"source_digest":preview["source_digest"],"definition":save()["definition"]})
}
#[tokio::test]
async fn feat155_4b_unclassified_draft_requires_unique_complete_schema_and_success() {
    for (output, phase, status, multiple, partial, expected) in [
        (candidate(), None, "completed", false, false, "candidate"),
        (
            json!({"schema_version":1,"kind":"needs_clarification","missing_fields":["time_zone"],"question":"使用哪个时区？"}),
            None,
            "completed",
            false,
            false,
            "needs_clarification",
        ),
        (
            candidate(),
            Some("commentary"),
            "completed",
            false,
            false,
            "unavailable",
        ),
        (candidate(), None, "completed", true, false, "unavailable"),
        (candidate(), None, "completed", false, true, "unavailable"),
        (candidate(), None, "failed", false, false, "unavailable"),
        (
            json!({"action":"ask_questions","questions":[]}),
            None,
            "completed",
            false,
            false,
            "error",
        ),
    ] {
        let f = Fixture::new(ScheduleStorageMode::ManagementFoundation);
        let receipt = submit(&f).await;
        let p = finish_with_phase(&f, &receipt, output, status, multiple, phase, partial).await;
        if expected == "error" {
            assert!(p.get("error").is_some(), "{p}");
        } else {
            assert_eq!(p["status"], expected, "{p}");
        }
        // Reading a schema-valid draft never saves, authorizes or creates a run.
        f.worker.call(move |r| {
            let count:i64=r.connection.query_row("SELECT (SELECT count(*) FROM chat_scheduled_plans)+(SELECT count(*) FROM chat_scheduled_grants)+(SELECT count(*) FROM chat_scheduled_runs)",[],|row|row.get(0)).unwrap();
            assert_eq!(count,0);
            let promoted:i64=r.connection.query_row("SELECT count(*) FROM chat_native_facts WHERE json_extract(fact_json,'$.item.phase')='final_answer'",[],|row|row.get(0)).unwrap();
            assert_eq!(promoted,0);
            Ok(())
        }).await.unwrap();
        if expected == "candidate" {
            let first = f
                .call("schedule_confirm_draft_v1", confirm(&p))
                .await
                .unwrap();
            let second = f
                .call("schedule_confirm_draft_v1", confirm(&p))
                .await
                .unwrap();
            assert_eq!(first, second);
            assert_eq!(first["state"], "paused");
        }
        f.close().await;
    }
}
#[tokio::test]
async fn feat155_draft_submit_idempotence_reader_and_purpose_guards() {
    let f = Fixture::new(ScheduleStorageMode::DraftFoundation);
    assert_eq!(f.worker.schema_version().await.unwrap(), 22);
    let id = Uuid::now_v7().to_string();
    let input = json!({"text":"每天九点总结"});
    let a = f
        .request("schedule_submit_draft_v1", input.clone(), id.clone())
        .await
        .unwrap();
    assert_eq!(
        a,
        f.request("schedule_submit_draft_v1", input, id.clone())
            .await
            .unwrap()
    );
    assert_eq!(
        f.request("schedule_submit_draft_v1", json!({"text":"changed"}), id)
            .await
            .unwrap_err(),
        E::RequestConflict.into()
    );
    let session = Uuid::parse_str(a["conversation_id"].as_str().unwrap()).unwrap();
    f.worker
        .call(move |r| {
            assert!(r
                .claim_next_conversation_outbox(execution::now().unwrap() + 60, 30)?
                .is_none());
            assert!(r
                .enqueue_turn_multimodal(
                    session,
                    &[DraftContentBlock::Text("普通发送".into())],
                    Uuid::now_v7()
                )
                .is_err());
            Ok(())
        })
        .await
        .unwrap();
    let mut plan = save();
    plan["definition"]["target"] = json!({"mode":"existing_chat","conversation_id":session});
    assert!(f.call("schedule_save_plan_v1", plan).await.is_err());
    let root = f.root.clone();
    drop(f);
    let worker =
        DatabaseWorker::start(root.join("chat"), scope(), Box::new(Keys), Box::new(Keys)).unwrap();
    assert_eq!(worker.schema_version().await.unwrap(), 22);
    worker
        .call(|r| {
            assert!(!r.schedule_draft_writes_enabled);
            assert!(r.draft_runtime.actions.is_empty());
            assert!(r
                .claim_next_conversation_outbox(execution::now().unwrap() + 120, 30)?
                .is_none());
            Ok(())
        })
        .await
        .unwrap();
    drop(worker);
    std::fs::remove_dir_all(root).unwrap();
}
#[tokio::test]
async fn feat155_draft_trusted_partial_final_unique_confirm_and_reopen() {
    let f = Fixture::new(ScheduleStorageMode::DraftFoundation);
    let receipt = submit(&f).await;
    let p = finish(&f, &receipt, candidate(), "completed", false).await;
    assert_eq!(p["status"], "candidate", "{p}");
    let q = confirm(&p);
    let plan = f
        .call("schedule_confirm_draft_v1", q.clone())
        .await
        .unwrap();
    assert_eq!(plan["state"], "paused");
    assert!(plan["authorization_ref"].is_null());
    assert_eq!(
        f.call("schedule_confirm_draft_v1", q.clone())
            .await
            .unwrap(),
        plan
    );
    let mut changed = q.clone();
    changed["definition"]["content"] = json!("different");
    assert_eq!(
        f.call("schedule_confirm_draft_v1", changed)
            .await
            .unwrap_err(),
        E::RequestConflict.into()
    );
    let rows = f.exchanges.lock().unwrap().clone();
    if let Ok(dir) = std::env::var("YIJIE_FEAT155_CONFORMANCE_DIR") {
        std::fs::write(
            std::path::Path::new(&dir).join("draft-ipc-producer.json"),
            serde_json::to_vec_pretty(&rows).unwrap(),
        )
        .unwrap();
    }
    let root = f.root.clone();
    drop(f);
    let worker = DatabaseWorker::start_with_schedule_storage(
        root.join("chat"),
        scope(),
        Box::new(Keys),
        Box::new(Keys),
        ScheduleStorageMode::DraftFoundation,
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
    assert_eq!(f.call("schedule_confirm_draft_v1", q).await.unwrap(), plan);
    f.worker
        .call(|r| {
            let n: i64 = r
                .connection
                .query_row("SELECT count(*) FROM chat_scheduled_plans", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(n, 1);
            let n: i64 = r
                .connection
                .query_row("SELECT count(*) FROM chat_scheduled_runs", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(n, 0);
            Ok(())
        })
        .await
        .unwrap();
    f.close().await;
}
#[tokio::test]
async fn feat155_draft_failed_multiple_and_incomplete_output_do_not_confirm() {
    for (output, status, multiple, expected) in [
        (candidate(), "failed", false, "unavailable"),
        (candidate(), "interrupted", false, "unavailable"),
        (candidate(), "completed", true, "unavailable"),
        (json!("```json {} ```"), "completed", false, "error"),
        (
            json!({"schema_version":1,"kind":"needs_clarification","missing_fields":["time"],"question":"什么时间？"}),
            "completed",
            false,
            "needs_clarification",
        ),
    ] {
        let f = Fixture::new(ScheduleStorageMode::DraftFoundation);
        let receipt = submit(&f).await;
        let p = finish(&f, &receipt, output, status, multiple).await;
        if expected == "error" {
            assert!(p.get("error").is_some(), "{p}")
        } else {
            assert_eq!(p["status"], expected, "{p}")
        };
        let q = json!({"source_id":receipt["source_id"],"source_digest":"a".repeat(64),"definition":save()["definition"]});
        assert!(f.call("schedule_confirm_draft_v1", q).await.is_err());
        f.close().await;
    }
}
#[tokio::test]
async fn feat155_draft_confirmation_deadline_rolls_back_and_deletion_tombstone() {
    let f = Fixture::new(ScheduleStorageMode::DraftFoundation);
    let receipt = submit(&f).await;
    let p = finish(&f, &receipt, candidate(), "completed", false).await;
    let q = confirm(&p);
    let native_q: wire::DraftConfirmation = serde_json::from_value(q.clone()).unwrap();
    f.worker
        .call(move |r| {
            r.schedule_ui_deadline = Some(execution::now().unwrap() - 1);
            assert!(r
                .confirm_draft(
                    native_q,
                    &Uuid::now_v7().to_string(),
                    execution::now().unwrap()
                )
                .is_err());
            r.schedule_ui_deadline = None;
            let n: i64 = r
                .connection
                .query_row("SELECT count(*) FROM chat_scheduled_plans", [], |r| {
                    r.get(0)
                })
                .unwrap();
            assert_eq!(n, 0);
            Ok(())
        })
        .await
        .unwrap();
    let plan = f
        .call("schedule_confirm_draft_v1", q.clone())
        .await
        .unwrap();
    let session = receipt["conversation_id"].as_str().unwrap().to_owned();
    f.worker
        .call(move |r| {
            r.connection
                .execute("DELETE FROM chat_sessions WHERE id=?1", [session])
                .unwrap();
            Ok(())
        })
        .await
        .unwrap();
    assert_eq!(f.call("schedule_confirm_draft_v1", q).await.unwrap(), plan);
    f.close().await;
}
#[tokio::test]
async fn feat155_draft_attempt_never_reposts_after_lease_or_reader_reopen() {
    let f = Fixture::new(ScheduleStorageMode::DraftFoundation);
    submit(&f).await;
    f.worker
        .call(|r| {
            r.schedule_draft_dispatch_authority = Some(auth());
            let n = execution::now().unwrap();
            let op = r
                .claim_next_conversation_outbox(n + 1, 30)?
                .unwrap()
                .operation_id;
            r.mark_draft_attempt(op)?;
            assert!(r.claim_next_conversation_outbox(n + 120, 30)?.is_none());
            assert!(r.guard_conversation_dispatch(op).is_err());
            Ok(())
        })
        .await
        .unwrap();
    f.close().await;
}

#[tokio::test]
async fn feat155_draft_clarification_followup_uses_same_restricted_conversation() {
    let f = Fixture::new(ScheduleStorageMode::DraftFoundation);
    let first = submit(&f).await;
    let missing = f
        .call(
            "schedule_preview_draft_v1",
            json!({"source_id":first["source_id"]}),
        )
        .await
        .unwrap();
    assert_eq!(missing["status"], "unavailable");
    let p = finish(&f, &first, json!({"schema_version":1,"kind":"needs_clarification","missing_fields":["time_zone"],"question":"使用哪个时区？"}), "completed", false).await;
    assert_eq!(p["status"], "needs_clarification");
    let second = f
        .call(
            "schedule_submit_draft_v1",
            json!({"text":"北京时间","conversation_id":first["conversation_id"]}),
        )
        .await
        .unwrap();
    assert_eq!(first["conversation_id"], second["conversation_id"]);
    assert_ne!(first["source_id"], second["source_id"]);
    let op = Uuid::parse_str(second["operation_id"].as_str().unwrap()).unwrap();
    f.worker.call(move|r|{
        let claim=r.claim_next_conversation_outbox(execution::now().unwrap()+1,30)?.unwrap();
        assert_eq!(claim.operation_id,op);
        let dispatch=r.load_start_turn_dispatch_v2(op)?;
        assert!(matches!(&dispatch.content_blocks[..],[crate::chat::database::HostTurnInputBlock::Text{text}] if text=="北京时间"));
        let count:i64=r.connection.query_row("SELECT count(*) FROM chat_scheduled_draft_sessions",[],|r|r.get(0)).unwrap();assert_eq!(count,1);
        // Leave it explicitly pending: normal cleanup stops the worker, no send or fabricated terminal.
        Ok(())
    }).await.unwrap();
    f.close().await;
}
