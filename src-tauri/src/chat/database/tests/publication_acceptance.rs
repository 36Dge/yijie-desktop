use super::*;

// Run against the bytes written by the actual Host SSE route.
#[test]
#[ignore = "requires the local publication replay or live-provider acceptance capture"]
fn publication_sse_sqlcipher_reopen() {
    use crate::chat::host_domain::{HostStreamEvent, SseDecoder};
    use crate::chat::native_conversation::NativeDisplayBuffer;
    use crate::chat::native_conversation_generated::{NativeEvent, NativeThreadSnapshot};
    let dir = std::path::PathBuf::from(std::env::var("YIJIE_PUBLICATION_EXCHANGE").unwrap());
    let stream = fs::read_to_string(dir.join("host.sse")).unwrap();
    let history: NativeThreadSnapshot =
        serde_json::from_slice(&fs::read(dir.join("host-history.json")).unwrap()).unwrap();
    let first: NativeEvent = serde_json::from_str(
        stream
            .lines()
            .find_map(|l| l.strip_prefix("data: "))
            .unwrap(),
    )
    .unwrap();
    let root = dir.join(format!("db-{}", Uuid::now_v7()));
    fs::create_dir(&root).unwrap();
    let owner = scope();
    let mut repo = open_repository_for_scope(&root, 49, owner.clone());
    let project = register_synthetic_project(&mut repo, &root);
    let pending = repo
        .create_session_and_enqueue(project, "公开消息验收", Uuid::now_v7())
        .unwrap();
    let now = unix_seconds().unwrap();
    let task = Uuid::parse_str(&first.task_id).unwrap();
    let agent = Uuid::parse_str(&first.agent_session_id).unwrap();
    let thread = Uuid::parse_str(&first.codex_thread_id).unwrap();
    let turn = Uuid::parse_str(&history.turns[0].id).unwrap();
    let create = repo
        .claim_next_conversation_outbox(now, 30)
        .unwrap()
        .unwrap();
    repo.bind_public_task(create.operation_id, task, now)
        .unwrap();
    repo.reschedule_outbox(create.operation_id, now).unwrap();
    let create = repo
        .claim_next_conversation_outbox(now, 30)
        .unwrap()
        .unwrap();
    repo.bind_host_session_and_enqueue_turn(create.operation_id, task, agent, thread)
        .unwrap();
    let claimed = repo
        .claim_next_conversation_outbox(now, 30)
        .unwrap()
        .unwrap();
    repo.accept_native_turn(claimed.operation_id, turn, &Uuid::now_v7().to_string())
        .unwrap();
    let context = repo.active_turn_context(pending.session_id).unwrap();
    let mut buffer = NativeDisplayBuffer::new(context.clone(), None).unwrap();
    let mut decoder = SseDecoder::new(Uuid::parse_str(&first.stream_id).unwrap(), 0, 13);
    let mut views = Vec::new();
    let mut preview_frames = Vec::new();
    for chunk in stream.as_bytes().chunks(379) {
        decoder.push(chunk).unwrap();
        while let Some(value) = decoder.next() {
            let HostStreamEvent::Native(event) = value else {
                panic!("unexpected SSE family")
            };
            if buffer.observe(&event).unwrap() {
                buffer.view = repo
                    .commit_native_view(&context, buffer.view.clone(), Some(&event), now)
                    .unwrap();
                preview_frames.push(serde_json::json!({
                    "sequence":event.sequence, "occurredAt":event.occurred_at,
                    "view":buffer.view, "previews":buffer.previews()
                }));
                views.push(buffer.view.clone());
            }
            assert!(
                !buffer.observe(&event).unwrap(),
                "identical cursor was applied twice"
            );
        }
    }
    decoder.finish().unwrap();
    assert!(buffer.view.terminal_observed);
    let saved_version: i64 = repo
        .connection
        .query_row(
            "SELECT format_version FROM chat_native_views WHERE turn_id=?1",
            [pending.turn_id.to_string()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(saved_version, 7);
    drop(repo);
    let mut reopened = open_repository_for_scope(&root, 49, owner);
    let saved = reopened
        .native_recovery_views(pending.session_id, &[pending.turn_id], Some(&history), true)
        .unwrap();
    assert_eq!(saved.as_slice(), std::slice::from_ref(&buffer.view));
    let projected = |item: &crate::chat::native_conversation_generated::NativeItem| {
        (
            item.id.clone(),
            item.phase.clone(),
            item.text.clone(),
            item.publication.clone(),
        )
    };
    let from_db: Vec<_> = saved[0]
        .items
        .iter()
        .filter(|i| matches!(i.item.kind.as_str(), "agentMessage" | "unpublishedText"))
        .map(|i| projected(&i.item))
        .collect();
    let from_runtime: Vec<_> = history.turns[0]
        .items
        .iter()
        .filter(|i| matches!(i.kind.as_str(), "agentMessage" | "unpublishedText"))
        .map(projected)
        .collect();
    assert!(!from_db.is_empty());
    assert_eq!(from_db, from_runtime);
    fs::write(
        dir.join("native-live-frames.json"),
        serde_json::to_vec(&preview_frames).unwrap(),
    )
    .unwrap();
    fs::write(
        dir.join("native-views.json"),
        serde_json::to_vec(&views).unwrap(),
    )
    .unwrap();
    fs::write(
        dir.join("native-reopened.json"),
        serde_json::to_vec(&saved[0]).unwrap(),
    )
    .unwrap();
    fs::write(
        dir.join("native-result.json"),
        serde_json::to_vec(&serde_json::json!({
            "sqlcipherFormat":saved_version,"identicalReopen":true,"runtimeReadMatches":true,
            "publicItems":from_db.iter().filter(|(_,phase,_,_)|phase.is_some()).count(),"observedViews":views.len()
        }))
        .unwrap(),
    )
    .unwrap();
    drop(reopened);
    fs::remove_dir_all(root).unwrap();
}
