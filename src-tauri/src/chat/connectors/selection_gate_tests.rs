//! Ordinary temporary SQLCipher records; no Runtime, external service or
//! process fault injection is involved in these compatibility checks.
use crate::chat::{
    database::{ChatRepository, ChatScope, PendingConversation},
    error::ChatError,
    keychain::{DatabaseKey, ReceiptKey},
    migrations,
};
use rusqlite::params;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

fn with_repository(test: impl FnOnce(&mut ChatRepository, Uuid, i64)) {
    let root = std::env::temp_dir().join(format!("feat157-reader-{}", Uuid::now_v7()));
    std::fs::create_dir(&root).unwrap();
    let mut repo = ChatRepository::open(
        &root.join("chat"),
        &DatabaseKey::from_bytes([157; 32]),
        ReceiptKey::from_bytes([158; 32]),
        ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap(),
    )
    .unwrap();
    migrations::migrate_to_target(
        &mut repo.connection,
        migrations::MARKET_SELECTION_SCHEMA_VERSION,
    )
    .unwrap();
    let workspace = root.join("workspace");
    std::fs::create_dir(&workspace).unwrap();
    let project = Uuid::parse_str(
        &repo
            .register_project(&workspace, b"ordinary-synthetic-bookmark")
            .unwrap()
            .id,
    )
    .unwrap();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    test(&mut repo, project, now);
    drop(repo);
    std::fs::remove_dir_all(root).unwrap();
}

/// Seed the same two operation aliases a committed market admission owns. The
/// envelope content is irrelevant to a legacy reader, which must not consume it.
fn mark_submission(repo: &ChatRepository, chat: &PendingConversation, now: i64) {
    repo.connection.execute(
        "INSERT INTO chat_market_submissions(submission_operation_id,session_id,local_turn_id,turn_operation_id,format_version,request_digest,snapshot_json,display_json,receipt_json,created_at) VALUES(?1,?2,?3,?4,1,?5,'{}','[]','{}',?6)",
        params![chat.create_operation_id.to_string(),chat.session_id.to_string(),chat.turn_id.to_string(),chat.turn_operation_id.to_string(),"a".repeat(64),now],
    ).unwrap();
    for operation in [chat.create_operation_id, chat.turn_operation_id] {
        repo.connection.execute("INSERT INTO chat_market_operation_refs(operation_id,submission_operation_id) VALUES(?1,?2)",params![operation.to_string(),chat.create_operation_id.to_string()]).unwrap();
    }
}
fn outbox(repo: &ChatRepository, operation: Uuid) -> (String, i64, Option<i64>) {
    repo.connection
        .query_row(
            "SELECT state,attempt_count,next_attempt_at FROM chat_outbox WHERE operation_id=?1",
            [operation.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap()
}

#[test]
fn feat157_market_reader_leaves_create_alias_and_exhaustion_untouched() {
    with_repository(|repo, project, now| {
        let market = repo
            .create_session_and_enqueue(project, "本地合成连接器任务", Uuid::now_v7())
            .unwrap();
        mark_submission(repo, &market, now);
        let unchanged = outbox(repo, market.create_operation_id);
        let ordinary = repo
            .create_session_and_enqueue(project, "普通任务", Uuid::now_v7())
            .unwrap();
        let claim = repo
            .claim_next_conversation_outbox(now + 1, 30)
            .unwrap()
            .unwrap();
        assert_eq!(claim.operation_id, ordinary.create_operation_id);
        assert_eq!(outbox(repo, market.create_operation_id), unchanged);
        assert_eq!(
            repo.load_create_session_dispatch(market.create_operation_id)
                .unwrap_err(),
            ChatError::OrchestrationUnavailable
        );
        assert_eq!(
            repo.guard_conversation_dispatch(market.turn_operation_id),
            Err(ChatError::OrchestrationUnavailable)
        );
        // A valid persisted retry-limit state must not be terminalized by an
        // older execution path that cannot interpret the market selection.
        repo.connection
            .execute(
                "UPDATE chat_outbox SET attempt_count=16 WHERE operation_id=?1",
                [market.create_operation_id.to_string()],
            )
            .unwrap();
        let exhausted = outbox(repo, market.create_operation_id);
        assert!(repo
            .fail_next_exhausted_public_task_binding(now + 1)
            .unwrap()
            .is_none());
        assert!(repo
            .claim_next_conversation_outbox(now + 1, 30)
            .unwrap()
            .is_none());
        assert_eq!(outbox(repo, market.create_operation_id), exhausted);
        assert!(repo
            .connection
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none());
    });
}

#[test]
fn feat157_market_reader_fences_materialized_turn_resume_and_legacy_writes() {
    with_repository(|repo, project, now| {
        let chat = repo
            .create_session_and_enqueue(project, "保留连接器历史", Uuid::now_v7())
            .unwrap();
        // Establish ordinary saved Host identities before constructing the
        // marked-state fixture; there is no live Host or model call.
        repo.claim_next_conversation_outbox(now + 1, 30)
            .unwrap()
            .unwrap();
        repo.bind_public_task(chat.create_operation_id, chat.task_id, now + 1)
            .unwrap();
        repo.bind_host_session_and_enqueue_turn(
            chat.create_operation_id,
            chat.task_id,
            Uuid::now_v7(),
            Uuid::now_v7(),
        )
        .unwrap();
        mark_submission(repo, &chat, now);
        assert!(repo.feat126_resume_candidates().unwrap().is_empty());
        assert_eq!(
            repo.resume_model_profile(chat.session_id).unwrap_err(),
            ChatError::OrchestrationUnavailable
        );
        assert!(repo.load_history(chat.session_id, None, Some(10)).is_ok());
        assert_eq!(
            repo.enqueue_turn(chat.session_id, "普通续轮", Uuid::now_v7())
                .unwrap_err(),
            ChatError::OrchestrationUnavailable
        );
        assert_eq!(
            repo.enqueue_turn_multimodal(
                chat.session_id,
                &[crate::chat::database::DraftContentBlock::Text(
                    "普通续轮".into()
                )],
                Uuid::now_v7()
            )
            .unwrap_err(),
            ChatError::OrchestrationUnavailable
        );
        assert_eq!(
            repo.create_session_and_enqueue(project, "保留连接器历史", chat.create_operation_id)
                .unwrap_err(),
            ChatError::OrchestrationUnavailable
        );
        assert_eq!(
            repo.load_start_turn_dispatch_v2(chat.turn_operation_id)
                .unwrap_err(),
            ChatError::OrchestrationUnavailable
        );
        repo.connection
            .execute(
                "UPDATE chat_outbox SET attempt_count=16 WHERE operation_id=?1",
                [chat.turn_operation_id.to_string()],
            )
            .unwrap();
        let exhausted = outbox(repo, chat.turn_operation_id);
        assert!(repo
            .claim_next_conversation_outbox(now + 1, 30)
            .unwrap()
            .is_none());
        assert_eq!(outbox(repo, chat.turn_operation_id), exhausted);
    });
}

#[test]
fn feat157_market_reader_keeps_blocked_authority_state_and_uses_keyed_intent_digest() {
    with_repository(|repo, project, now| {
        let chat = repo
            .create_session_and_enqueue(project, "权限恢复合成记录", Uuid::now_v7())
            .unwrap();
        mark_submission(repo, &chat, now);
        repo.connection.execute("UPDATE chat_public_task_bindings SET state='blocked_auth',last_error_code='chat_unauthenticated' WHERE create_operation_id=?1",[chat.create_operation_id.to_string()]).unwrap();
        repo.connection
            .execute(
                "UPDATE chat_outbox SET state='failed' WHERE operation_id=?1",
                [chat.create_operation_id.to_string()],
            )
            .unwrap();
        let original = outbox(repo, chat.create_operation_id);
        assert_eq!(repo.resume_blocked_public_tasks(2, now + 1).unwrap(), 0);
        assert_eq!(outbox(repo, chat.create_operation_id), original);
        let state: String = repo
            .connection
            .query_row(
                "SELECT state FROM chat_public_task_bindings WHERE create_operation_id=?1",
                [chat.create_operation_id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state, "blocked_auth");
        let digest = repo.market_intent_digest(b"market-submission-v1\0ordinary intent");
        assert_eq!(digest.len(), 64);
        assert_eq!(
            digest,
            repo.market_intent_digest(b"market-submission-v1\0ordinary intent")
        );
        assert_ne!(
            digest,
            repo.market_intent_digest(b"market-submission-v1\0another intent")
        );
    });
}
