use super::migrations;
use rusqlite::Connection;

#[test]
fn feat164_native_recovery_schema_preserves_legacy_pending_without_backfill() {
    let mut db = Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    migrations::migrate_to_target(&mut db, 38).unwrap();
    db.execute_batch("INSERT INTO chat_projects(id,owner_user_id,tenant_id,safe_name,canonical_hash,bookmark_ref,last_used_at) VALUES('p','owner','tenant','Synthetic workspace','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',X'01',1);
      INSERT INTO chat_sessions(id,owner_user_id,tenant_id,project_id,title,title_source,title_job_status,created_at,last_activity_at) VALUES('s','owner','tenant','p','Synthetic history','user','completed',1,1);
      INSERT INTO chat_model_selections VALUES('s','kimi-k3-max-v1',7,'unknown','old-operation','minimax-m3-high-v1',7);
      INSERT INTO chat_operation_models VALUES('old-delivery','s','kimi-k3-max-v1',7);").unwrap();
    migrations::migrate_to_target(&mut db, migrations::KIMI_K31_RECOVERY_SCHEMA_VERSION).unwrap();
    migrations::migrate_to_target(&mut db, migrations::KIMI_K31_RECOVERY_SCHEMA_VERSION).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM chat_model_operations_v2", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
    assert_eq!(db.query_row("SELECT profile_id||':'||state||':'||operation_id||':'||requested_profile_id FROM chat_model_selections",[],|r|r.get::<_,String>(0)).unwrap(),"kimi-k3-max-v1:unknown:old-operation:minimax-m3-high-v1");
    assert_eq!(
        db.query_row("SELECT profile_id FROM chat_operation_models", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap(),
        "kimi-k3-max-v1"
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        39
    );
    migrations::validate_reader(&db).unwrap();
    #[cfg(not(feature = "kimi-k31-pro-candidate"))]
    assert_eq!(
        super::models::dispatch_predicate(&db, "o").unwrap(),
        "o.kind='interrupt_turn'"
    );
}

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
    for previous in [15, 29, 37, 38, 39, 40] {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        migrations::migrate_to_target(&mut db, previous).unwrap();
        migrations::migrate_to_target(&mut db, migrations::DELIVERY_PROOF_SCHEMA_VERSION).unwrap();
        migrations::migrate_to_target(&mut db, migrations::DELIVERY_PROOF_SCHEMA_VERSION).unwrap();
        assert_eq!(
            db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            40
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

#[test]
fn feat164_populated_migrations_preserve_history_and_delivery_facts() {
    use rusqlite::types::Value;
    fn rows(db: &Connection, query: &str) -> Vec<Vec<Value>> {
        let mut statement = db.prepare(query).unwrap();
        let columns = statement.column_count();
        statement
            .query_map([], |row| (0..columns).map(|i| row.get(i)).collect())
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }
    for previous in [15, 29, 37, 38, 39, 40] {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        migrations::migrate_to_target(&mut db, previous).unwrap();
        db.execute_batch("INSERT INTO chat_projects(id,owner_user_id,tenant_id,safe_name,canonical_hash,bookmark_ref,last_used_at) VALUES('p','owner','tenant','Synthetic workspace','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',X'0102',1);
          INSERT INTO chat_sessions(id,owner_user_id,tenant_id,project_id,title,title_source,title_job_status,created_at,last_activity_at,agent_session_id,runtime_thread_id) VALUES('s','owner','tenant','p','Synthetic history','user','completed',1,2,'host','thread');
          INSERT INTO chat_messages(id,session_id,role,content,status,ordinal,created_at) VALUES('m','s','assistant','Preserved synthetic answer','committed',0,2);
          INSERT INTO chat_turns(id,session_id,operation_id,runtime_turn_id,status,terminal_at) VALUES('t','s','accepted','native-turn','completed',2);
          INSERT INTO chat_outbox(operation_id,session_id,kind,state,attempt_count,payload_version,encrypted_payload) VALUES('accepted','s','start_turn','done',1,1,X'01020304');
          INSERT INTO chat_outbox(operation_id,session_id,kind,state,attempt_count,payload_version,encrypted_payload) VALUES('uncertain','s','start_turn','inflight',1,1,X'05060708');
          INSERT INTO chat_outbox(operation_id,session_id,kind,state,attempt_count,payload_version,encrypted_payload) VALUES('queued','s','start_turn','pending',0,1,X'090a0b0c');").unwrap();
        let mut queries = vec![
            "SELECT id,owner_user_id,tenant_id,project_id,title,title_source,title_job_status,created_at,last_activity_at,agent_session_id,runtime_thread_id FROM chat_sessions ORDER BY id",
            "SELECT * FROM chat_messages ORDER BY id",
            "SELECT * FROM chat_turns ORDER BY id",
            "SELECT operation_id,session_id,kind,state,attempt_count,payload_version,encrypted_payload FROM chat_outbox ORDER BY operation_id",
        ];
        if previous >= 29 {
            db.execute_batch("INSERT INTO chat_model_selections VALUES('s','kimi-k3-max-v1',4,'unknown','switch','minimax-m3-high-v1',4);
              INSERT INTO chat_operation_models VALUES('accepted','s','kimi-k3-max-v1',3);
              INSERT INTO chat_operation_models VALUES('uncertain','s','kimi-k3-max-v1',4);
              INSERT INTO chat_operation_models VALUES('queued','s','kimi-k3-max-v1',4);").unwrap();
            queries.extend([
                "SELECT * FROM chat_model_selections ORDER BY session_id",
                "SELECT * FROM chat_operation_models ORDER BY operation_id",
            ]);
        }
        // Compare every pre-existing column. Older canonical migrations may add
        // columns with defaults; SELECT * must not mistake that for data loss.
        let queries: Vec<String> = queries
            .iter()
            .map(|query| {
                if query.contains("SELECT *") {
                    let statement = db.prepare(query).unwrap();
                    query.replacen('*', &statement.column_names().join(","), 1)
                } else {
                    (*query).to_owned()
                }
            })
            .collect();
        let before: Vec<_> = queries.iter().map(|q| rows(&db, q)).collect();
        let ledger = rows(
            &db,
            "SELECT version,name,sha256,applied_at FROM chat_schema_migrations ORDER BY version",
        );
        migrations::migrate_to_target(&mut db, migrations::DELIVERY_PROOF_SCHEMA_VERSION).unwrap();
        migrations::migrate_to_target(&mut db, migrations::DELIVERY_PROOF_SCHEMA_VERSION).unwrap();
        for (query, expected) in queries.iter().zip(before) {
            assert_eq!(rows(&db, query), expected, "{previous}: {query}");
        }
        let upgraded = rows(
            &db,
            "SELECT version,name,sha256,applied_at FROM chat_schema_migrations ORDER BY version",
        );
        assert_eq!(&upgraded[..ledger.len()], ledger.as_slice());
        assert_eq!(upgraded.len(), 40);
        assert_eq!(
            rows(&db, "SELECT count(*) FROM chat_model_operations_v2"),
            vec![vec![Value::Integer(0)]]
        );
        assert_eq!(
            rows(&db, "SELECT count(*) FROM chat_delivery_proofs"),
            vec![vec![Value::Integer(0)]]
        );
        assert!(db
            .pragma_query_value(None, "foreign_keys", |r| r.get::<_, bool>(0))
            .unwrap());
        assert_eq!(rows(&db, "SELECT * FROM pragma_foreign_key_check").len(), 0);
        migrations::validate_reader(&db).unwrap();
        // These existing states are observations, not never-sent cancellation
        // authority. Migration must not settle, relabel or release any of them.
        assert_eq!(
            rows(
                &db,
                "SELECT state,attempt_count FROM chat_outbox WHERE operation_id='uncertain'"
            ),
            vec![vec![Value::Text("inflight".into()), Value::Integer(1)]]
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
