use super::*;

// Ordinary repository transitions, with no transport or process fault injection.
#[tokio::test]
async fn feat164_stopped_attempted_draft_has_read_only_uncertain_projection() {
    let f = Fixture::new(ScheduleStorageMode::ManagementFoundation);
    f.worker
        .call(|r| {
            crate::chat::migrations::migrate_to_target(&mut r.connection, 41)?;
            r.schedule_draft_dispatch_authority = Some(auth());
            Ok(())
        })
        .await
        .unwrap();
    let receipt=f.call("schedule_submit_draft_v1",json!({"text":"synthetic status audit","model_intent":{"profile_id":"kimi-k3-1-pro-max-v1","expected_revision":0}})).await.unwrap();
    let source = receipt["source_id"].as_str().unwrap().to_owned();
    f.worker
        .call(move |r| {
            let c = r.draft_source_context(&source)?;
            let read = |r: &crate::chat::database::ChatRepository| {
                r.local_submissions(c.conversation, &[c.local_turn])
                    .map(|v| v[0].status.clone())
            };
            assert_eq!(read(r)?, "queued");
            let n = execution::now().unwrap();
            let create = r.claim_next_conversation_outbox(n + 1, 30)?.unwrap();
            r.bind_public_task(create.operation_id, c.conversation, n)?;
            r.mark_draft_attempt(create.operation_id)?;
            assert_eq!(
                read(r)?,
                "queued",
                "an active attempt is not a stopped submission"
            );
            r.fail_outbox(create.operation_id)?;
            let before = r.draft_source_context(&source)?;
            let changes = r.connection.total_changes();
            for _ in 0..3 {
                assert_eq!(read(r)?, "uncertain");
            }
            assert_eq!(
                r.connection.total_changes(),
                changes,
                "history reads must not write"
            );
            assert_eq!(r.draft_source_context(&source)?, before);
            let raw: String = r
                .connection
                .query_row(
                    "SELECT submission_status FROM chat_turns WHERE id=?1",
                    [c.local_turn.to_string()],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(raw, "queued", "preserve historical storage");
            assert!(r.continue_draft_source(&source).is_err());
            assert_eq!(
                r.connection.total_changes(),
                changes,
                "missing mapping must not requeue"
            );
            assert!(r.claim_next_conversation_outbox(n + 2, 30)?.is_none());
            let other = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string())?;
            assert!(!super::super::super::drafts::unresolved_create_submission(
                &r.connection,
                &other,
                c.conversation,
                c.local_turn
            )?);
            assert!(!super::super::super::drafts::unresolved_create_submission(
                &r.connection,
                &r.scope,
                c.conversation,
                Uuid::now_v7()
            )?);
            let (nonce, epoch) = r.draft_runtime.host.clone().unwrap();
            let mapping = serde_json::from_value(json!({
                "schema_version":1,"policy_version":1,"purpose":"scheduled_plan_draft",
                "task_id":before.task.unwrap(),"agent_session_id":Uuid::now_v7(),
                "workspace_id":before.workspace,"mapping_state":"bound",
                "codex_thread_id":Uuid::now_v7(),"responding_host_instance_id":nonce
            }))
            .unwrap();
            r.apply_draft_mapping(&before, &mapping, &nonce, epoch)?;
            assert_eq!(
                read(r)?,
                "queued",
                "normal confirmed binding removes the uncertainty projection"
            );
            let restored = r.draft_source_context(&source)?;
            assert!(restored.create_attempted && !restored.turn_attempted);
            assert!(restored.session.is_some() && restored.thread.is_some());
            Ok(())
        })
        .await
        .unwrap();
    f.close().await;
}

#[tokio::test]
async fn feat164_never_attempted_failed_draft_does_not_invent_uncertainty() {
    let f = Fixture::new(ScheduleStorageMode::ManagementFoundation);
    f.worker
        .call(|r| {
            crate::chat::migrations::migrate_to_target(&mut r.connection, 41)?;
            r.schedule_draft_dispatch_authority = Some(auth());
            Ok(())
        })
        .await
        .unwrap();
    let receipt=f.call("schedule_submit_draft_v1",json!({"text":"synthetic local rejection","model_intent":{"profile_id":"kimi-k3-1-pro-max-v1","expected_revision":0}})).await.unwrap();
    let source = receipt["source_id"].as_str().unwrap().to_owned();
    f.worker
        .call(move |r| {
            let c = r.draft_source_context(&source)?;
            r.fail_outbox(c.create.unwrap())?;
            let changes = r.connection.total_changes();
            assert_eq!(
                r.local_submissions(c.conversation, &[c.local_turn])?[0].status,
                "queued"
            );
            assert_eq!(r.connection.total_changes(), changes);
            assert!(!r.draft_source_context(&source)?.create_attempted);
            Ok(())
        })
        .await
        .unwrap();
    f.close().await;
}
