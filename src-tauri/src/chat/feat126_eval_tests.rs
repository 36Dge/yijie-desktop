use super::database::{ChatRepository, ChatScope, ReasoningStatus, SessionTitleSource};
use super::host_domain::SseDecoder;
use super::keychain::{DatabaseKey, ReceiptKey};
use super::{ChatError, ReducerOutcome, TurnEventReducer};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const DATASET_ID: &str = "feat126-title-raw-v1";
const HOST_AUTHORITY_COMMIT: &str = "8707dea552cff74121b89aa8045f27da2c8c9378";
const EVENT_FIXTURE: &[u8] =
    include_bytes!("../../fixtures/feat126-title-raw-v1/desktop-events.sse");
const CONSUMER_FIXTURE: &[u8] =
    include_bytes!("../../fixtures/feat126-title-raw-v1/desktop-consumer.json");
const AUTHORITY_LOCK: &[u8] =
    include_bytes!("../../fixtures/feat126-title-raw-v1/authority.lock.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthorityLock {
    dataset_id: String,
    source_repository: String,
    source_commit: String,
    hash_algorithm: String,
    files: AuthorityFiles,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthorityFiles {
    #[serde(rename = "desktop-consumer.json")]
    desktop_consumer: String,
    #[serde(rename = "desktop-events.sse")]
    desktop_events: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsumerFixture {
    dataset_id: String,
    reasoning_response: serde_json::Value,
    title_scenario: TitleScenario,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TitleScenario {
    late_model_title: String,
    model_title: String,
    user_title: String,
}

fn scope() -> ChatScope {
    ChatScope::new(
        "019fbe00-1000-7000-8000-000000000001".to_owned(),
        "019fbe00-1000-7000-8000-000000000002".to_owned(),
    )
    .expect("valid synthetic scope")
}

fn open_repository(root: &Path) -> ChatRepository {
    ChatRepository::open(
        &root.join("chat"),
        &DatabaseKey::from_bytes([126; 32]),
        ReceiptKey::from_bytes([127; 32]),
        scope(),
    )
    .expect("open temporary SQLCipher repository")
}

fn unix_seconds() -> i64 {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_secs(),
    )
    .expect("timestamp fits i64")
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn temporary_root() -> PathBuf {
    let root = std::env::temp_dir().join(format!("yijie-feat126-eval-{}", Uuid::now_v7()));
    fs::create_dir(&root).expect("create temporary Eval root");
    root
}

#[test]
fn host_authority_fixture_survives_reducer_sqlcipher_restart_and_delete() {
    let authority: AuthorityLock =
        serde_json::from_slice(AUTHORITY_LOCK).expect("closed authority lock");
    assert_eq!(authority.dataset_id, DATASET_ID);
    assert_eq!(authority.source_repository, "yijie-agent-host");
    assert_eq!(authority.source_commit, HOST_AUTHORITY_COMMIT);
    assert_eq!(authority.hash_algorithm, "sha256");
    assert_eq!(authority.files.desktop_events, sha256(EVENT_FIXTURE));
    assert_eq!(authority.files.desktop_consumer, sha256(CONSUMER_FIXTURE));

    let fixture: ConsumerFixture =
        serde_json::from_slice(CONSUMER_FIXTURE).expect("closed consumer fixture");
    assert_eq!(fixture.dataset_id, DATASET_ID);
    assert!(fixture.reasoning_response.is_object());

    let expected_stream =
        Uuid::parse_str("019fbe00-0000-7000-8000-000000000001").expect("fixture stream");
    let mut decoder = SseDecoder::new(expected_stream, 0);
    for chunk in EVENT_FIXTURE.chunks(37) {
        decoder.push(chunk).expect("decode bounded SSE chunk");
    }
    decoder.finish().expect("complete SSE stream");
    let mut events = Vec::new();
    while let Some(event) = decoder.next() {
        events.push(event);
    }
    assert_eq!(events.len(), 5);
    let agent_session_id = events[0].agent_session_id;
    let codex_thread_id = events[0].codex_thread_id;
    let runtime_turn_id = events[0].turn_id.expect("fixture turn identity");

    let root = temporary_root();
    let project_path = root.join("synthetic-project");
    fs::create_dir(&project_path).expect("create synthetic project");
    let mut repository = open_repository(&root);
    let project = repository
        .register_project(&project_path, b"synthetic-bookmark")
        .expect("register synthetic project");
    let project_id = Uuid::parse_str(&project.id).expect("project id");
    let pending = repository
        .create_session_and_enqueue(project_id, "合成评估消息", Uuid::now_v7())
        .expect("create local conversation");

    let create = repository
        .claim_next_conversation_outbox(unix_seconds(), 30)
        .expect("claim create outbox")
        .expect("create outbox exists");
    let dispatch = repository
        .load_create_session_dispatch(create.operation_id)
        .expect("load create dispatch");
    assert_eq!(dispatch.task_id, pending.task_id);
    repository
        .bind_host_session_and_enqueue_turn(
            create.operation_id,
            dispatch.task_id,
            agent_session_id,
            codex_thread_id,
        )
        .expect("bind fake Host session");
    let turn = repository
        .claim_next_conversation_outbox(unix_seconds(), 30)
        .expect("claim turn outbox")
        .expect("turn outbox exists");
    let turn_dispatch = repository
        .load_start_turn_dispatch(turn.operation_id)
        .expect("load turn dispatch");
    assert_eq!(turn_dispatch.turn_id, pending.turn_id);
    repository
        .suspend_started_turn_retry(turn.operation_id, runtime_turn_id)
        .expect("bind runtime turn");

    let context = repository
        .active_turn_context(pending.session_id)
        .expect("active turn context");
    let mut reducer = TurnEventReducer::new(context).expect("create authoritative reducer");
    let mut terminal = None;
    for (index, mut event) in events.into_iter().enumerate() {
        // The fixture owns Host/Runtime identities. The local task identity is generated by
        // SQLCipher and is rebound exactly as the fake Host would echo it.
        event.task_id = pending.task_id;
        match reducer
            .apply(event, 1_785_801_600_000 + i64::try_from(index).unwrap())
            .expect("reduce Host event")
        {
            ReducerOutcome::Progress => {}
            ReducerOutcome::Terminal(commit) => terminal = Some(commit),
            ReducerOutcome::Duplicate => panic!("fixture contains a duplicate event"),
        }
    }
    let terminal = terminal.expect("terminal fixture event");
    assert_eq!(terminal.reasoning_status, ReasoningStatus::Complete);
    assert_eq!(terminal.reasoning_items.len(), 1);
    assert_eq!(terminal.reasoning_items[0].parts.len(), 1);
    let raw_text = terminal.reasoning_items[0].parts[0].text.clone();
    assert_eq!(
        raw_text,
        "先核对约束。\n<script>not executable</script>\n再给出结论。"
    );
    assert_eq!(terminal.assistant_text, "已完成合成评估。");
    repository
        .commit_terminal_turn(&terminal)
        .expect("commit terminal turn atomically");

    let stored = repository
        .load_reasoning(&pending.turn_id.to_string())
        .expect("load terminal reasoning");
    assert_eq!(stored, terminal.reasoning_items);
    let history = repository
        .load_history(pending.session_id, None, Some(20))
        .expect("load local history");
    assert_eq!(history.turns.len(), 1);
    assert_eq!(history.turns[0].reasoning.len(), 1);

    let title_operation = Uuid::now_v7();
    assert!(repository
        .enqueue_title_job(pending.session_id, title_operation)
        .expect("enqueue deterministic title"));
    assert!(repository
        .apply_model_title(
            pending.session_id,
            title_operation,
            &fixture.title_scenario.model_title,
        )
        .expect("apply safe model title"));
    repository
        .rename_session(pending.session_id, &fixture.title_scenario.user_title)
        .expect("apply user title");
    assert!(!repository
        .apply_model_title(
            pending.session_id,
            title_operation,
            &fixture.title_scenario.late_model_title,
        )
        .expect("reject late model overwrite"));
    let summary = repository
        .session_summary(pending.session_id)
        .expect("load titled session");
    assert_eq!(summary.title, fixture.title_scenario.user_title);
    assert_eq!(summary.title_source, SessionTitleSource::User);

    drop(repository);
    let mut reopened = open_repository(&root);
    let restored = reopened
        .load_reasoning(&pending.turn_id.to_string())
        .expect("restore reasoning after restart");
    assert_eq!(restored, stored);
    let restored_history = reopened
        .load_history(pending.session_id, None, Some(20))
        .expect("restore history after restart");
    assert_eq!(restored_history.turns.len(), 1);
    assert_eq!(
        reopened
            .session_summary(pending.session_id)
            .expect("restore title after restart")
            .title,
        fixture.title_scenario.user_title,
    );

    reopened
        .delete_session_local(&pending.session_id.to_string())
        .expect("physical local cascade delete");
    assert_eq!(
        reopened.load_reasoning(&pending.turn_id.to_string()),
        Err(ChatError::NotFound)
    );
    assert_eq!(
        reopened.load_history(pending.session_id, None, Some(20)),
        Err(ChatError::NotFound)
    );
    assert_eq!(
        reopened.session_summary(pending.session_id),
        Err(ChatError::NotFound)
    );
    drop(reopened);

    for path in [
        root.join("chat/conversations.db"),
        root.join("chat/conversations.db-wal"),
        root.join("chat/conversations.db-shm"),
    ] {
        if path.exists() {
            let bytes = fs::read(path).expect("read local encrypted storage surface");
            assert!(!bytes
                .windows(raw_text.len())
                .any(|window| window == raw_text.as_bytes()));
        }
    }
    fs::remove_dir_all(root).expect("remove temporary Eval data");
}
