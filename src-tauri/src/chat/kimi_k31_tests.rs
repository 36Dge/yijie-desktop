use super::migrations;
use rusqlite::Connection;

#[test]
fn feat164_migration_expands_without_rewriting_model_facts() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE chat_sessions(id TEXT PRIMARY KEY); CREATE TABLE chat_scheduled_plans(plan_id TEXT PRIMARY KEY); INSERT INTO chat_sessions VALUES('s'); INSERT INTO chat_scheduled_plans VALUES('p');").unwrap();
    db.execute_batch(include_str!("../../migrations/chat/0028_chat_models.sql"))
        .unwrap();
    db.execute_batch("INSERT INTO chat_model_selections VALUES('s','kimi-k3-max-v1',7,'unknown','switch','minimax-m3-high-v1',6); INSERT INTO chat_operation_models VALUES('accepted','s','kimi-k3-max-v1',6); INSERT INTO chat_plan_models VALUES('p','kimi-k3-max-v1');").unwrap();
    db.execute_batch(include_str!(
        "../../migrations/chat/0038_kimi_k31_models.sql"
    ))
    .unwrap();
    let selection: (String, i64, String, String, String, i64) = db.query_row("SELECT profile_id,revision,state,operation_id,requested_profile_id,expected_revision FROM chat_model_selections", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).unwrap();
    assert_eq!(
        selection,
        (
            "kimi-k3-max-v1".into(),
            7,
            "unknown".into(),
            "switch".into(),
            "minimax-m3-high-v1".into(),
            6
        )
    );
    assert_eq!(
        db.query_row(
            "SELECT profile_id FROM chat_operation_models WHERE operation_id='accepted'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "kimi-k3-max-v1"
    );
    assert_eq!(
        db.query_row(
            "SELECT profile_id FROM chat_plan_models WHERE plan_id='p'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "kimi-k3-max-v1"
    );
    // A newly accepted operation may use the new identity; the old operation
    // deliberately has no outbox FK, retaining its original reservation role.
    db.execute(
        "INSERT INTO chat_operation_models VALUES('new','s','kimi-k3-1-pro-max-v1',8)",
        [],
    )
    .unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
    db.execute("DELETE FROM chat_sessions WHERE id='s'", [])
        .unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM chat_operation_models", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM chat_model_selections", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    db.execute("DELETE FROM chat_scheduled_plans WHERE plan_id='p'", [])
        .unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM chat_plan_models", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn feat164_canonical_migration_paths_and_repeat_are_valid() {
    for previous in [15, 29, 37, 38] {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        migrations::migrate_to_target(&mut db, previous).unwrap();
        migrations::migrate_to_target(&mut db, migrations::KIMI_K31_SCHEMA_VERSION).unwrap();
        migrations::migrate_to_target(&mut db, migrations::KIMI_K31_SCHEMA_VERSION).unwrap();
        assert_eq!(
            db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            38
        );
        migrations::validate_reader(&db).unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            0
        );
    }
}

#[cfg(feature = "kimi-k31-pro-candidate")]
#[test]
fn feat164_candidate_decoder_separates_readable_and_executable_identity() {
    use super::models_generated as wire;
    let old: wire::ProfileId = serde_json::from_str("\"kimi-k3-max-v1\"").unwrap();
    assert_eq!(super::models::profile_id(old), "kimi-k3-max-v1");
    assert!(!super::models::executable_profile(
        super::models::profile_id(old)
    ));
    assert!(super::models::executable_profile("kimi-k3-1-pro-max-v1"));
    assert!(serde_json::from_str::<wire::ActiveProfileId>("\"kimi-k3-max-v1\"").is_err());
    assert!(serde_json::from_str::<wire::ProfileId>("\"future-profile\"").is_err());
}
