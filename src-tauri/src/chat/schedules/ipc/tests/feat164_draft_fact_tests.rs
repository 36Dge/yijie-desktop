use super::*;
use crate::chat::{
    native_conversation::NativeDisplayBuffer, native_conversation_generated::NativeEvent,
};

#[tokio::test]
async fn feat164_current_native_writer_can_preview_completed_draft_without_rewriting() {
    let f = Fixture::new(ScheduleStorageMode::ManagementFoundation);
    f.worker
        .call(|r| {
            crate::chat::migrations::migrate_to_target(&mut r.connection, 41)?;
            r.schedule_draft_dispatch_authority = Some(auth());
            Ok(())
        })
        .await
        .unwrap();
    let receipt = f.call("schedule_submit_draft_v1", json!({"text":"ordinary synthetic draft", "model_intent":{"profile_id":"kimi-k3-1-pro-max-v1","expected_revision":0}})).await.unwrap();
    let source = receipt["source_id"].as_str().unwrap().to_owned();
    let before = f.worker.call(move |r| {
        let now=execution::now().unwrap();
        let create=r.claim_next_conversation_outbox(now+1,30)?.unwrap();
        let task=Uuid::now_v7();r.bind_public_task(create.operation_id,task,now)?;
        r.mark_draft_attempt(create.operation_id)?;
        let thread=Uuid::now_v7();r.bind_host_session_and_enqueue_turn(create.operation_id,task,Uuid::now_v7(),thread)?;
        let turn=r.claim_next_conversation_outbox(now+1,30)?.unwrap();r.mark_draft_attempt(turn.operation_id)?;
        r.accept_native_turn(turn.operation_id,Uuid::now_v7(),&Uuid::now_v7().to_string())?;
        let context=r.active_turn_context(r.draft_source_context(&source)?.conversation)?;
        let mut buffer=NativeDisplayBuffer::new(context.clone(),None)?;
        let output=json!({"schema_version":1,"kind":"candidate","name":"ordinary daily draft","content":"reply with synthetic result","schedule":{"frequency":"daily","time_zone":"Asia/Shanghai","local_time":"23:59"},"target":{"mode":"dedicated_chat"}}).to_string();
        let facts=[json!({"method":"item/completed","itemId":"ordinary-final","item":{"id":"ordinary-final","type":"agentMessage","phase":"final_answer","text":output,"availability":"available"}}),json!({"method":"turn/completed","turn":{"id":context.runtime_turn_id,"status":"completed","items":[],"itemsComplete":false}})];
        let stream=Uuid::now_v7();
        for (i,mut native) in facts.into_iter().enumerate(){
            native["source"]=json!("runtime_notification");native["threadId"]=json!(thread);native["turnId"]=json!(context.runtime_turn_id);native["availability"]=json!("available");
            let event:NativeEvent=serde_json::from_value(json!({"schema_version":11,"event_id":Uuid::now_v7(),"stream_id":stream,"sequence":i+1,"occurred_at":"2026-10-25T12:00:00Z","task_id":task,"agent_session_id":context.agent_session_id,"codex_thread_id":thread,"event_type":"native.notification","terminal":native["method"]=="turn/completed","payload":{"native":native}})).unwrap();
            assert!(buffer.observe(&event)?);buffer.view=r.commit_native_view(&context,buffer.view.clone(),Some(&event),now)?;
        }
        let facts:Vec<(String,i64)>=r.connection.prepare("SELECT fact_json,format_version FROM chat_native_facts ORDER BY event_id").unwrap().query_map([],|row|Ok((row.get(0)?,row.get(1)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(facts.len(),2);assert!(facts.iter().all(|(_,format)|*format==4));
        Ok(facts)
    }).await.unwrap();
    for _ in 0..2 {
        let preview = f
            .call(
                "schedule_preview_draft_v1",
                json!({"source_id":receipt["source_id"]}),
            )
            .await
            .unwrap();
        assert_eq!(
            preview["status"], "candidate",
            "current persisted native facts must be readable"
        );
    }
    f.worker.call(move |r| {
        let after:Vec<(String,i64)>=r.connection.prepare("SELECT fact_json,format_version FROM chat_native_facts ORDER BY event_id").unwrap().query_map([],|row|Ok((row.get(0)?,row.get(1)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(before,after);
        let effects:i64=r.connection.query_row("SELECT (SELECT count(*) FROM chat_scheduled_plans)+(SELECT count(*) FROM chat_scheduled_grants)+(SELECT count(*) FROM chat_scheduled_runs)",[],|row|row.get(0)).unwrap();assert_eq!(effects,0);
        Ok(())
    }).await.unwrap();
    f.close().await;
}
