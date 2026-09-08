use super::error::{map_sqlite_error, ChatError};
use rusqlite::{params, Connection, OptionalExtension, Transaction, MAIN_DB};
use rusqlite_migration::{HookError, HookResult, Migrations, M};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

const CORE_SQL: &str = include_str!("../../migrations/chat/0001_chat_core.sql");
const REASONING_SQL: &str = include_str!("../../migrations/chat/0002_chat_reasoning_v2.sql");
const APPLICATION_DOMAIN_SQL: &str =
    include_str!("../../migrations/chat/0003_chat_application_domain.sql");
const S7C_ORCHESTRATION_SQL: &str =
    include_str!("../../migrations/chat/0004_chat_s7c_orchestration.sql");
const PUBLIC_TASK_CONTROL_PLANE_SQL: &str =
    include_str!("../../migrations/chat/0005_chat_public_task_control_plane.sql");
const CHAT_ATTACHMENTS_SQL: &str = include_str!("../../migrations/chat/0006_chat_attachments.sql");
const CHAT_ATTACHMENT_DRAFT_TARGETS_SQL: &str =
    include_str!("../../migrations/chat/0007_chat_attachment_draft_targets.sql");
const CHAT_OUTPUT_ARTIFACTS_SQL: &str =
    include_str!("../../migrations/chat/0008_chat_output_artifacts.sql");
const CHAT_TIMELINE_V4_SQL: &str = include_str!("../../migrations/chat/0009_chat_timeline_v4.sql");
const CHAT_COMMAND_TOOL_V5_SQL: &str =
    include_str!("../../migrations/chat/0010_chat_command_tool_v5.sql");
const CHAT_APPROVAL_V6_SQL: &str = include_str!("../../migrations/chat/0011_chat_approval_v6.sql");
const CHAT_APPROVAL_V6_PROCESS_PROTECTION_SQL: &str =
    include_str!("../../migrations/chat/0012_chat_approval_v6_process_protection.sql");

#[derive(Clone, Copy)]
struct CatalogEntry {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const CATALOG: [CatalogEntry; 14] = [
    CatalogEntry {
        version: 1,
        name: "0001_chat_core",
        sql: CORE_SQL,
    },
    CatalogEntry {
        version: 2,
        name: "0002_chat_reasoning_v2",
        sql: REASONING_SQL,
    },
    CatalogEntry {
        version: 3,
        name: "0003_chat_application_domain",
        sql: APPLICATION_DOMAIN_SQL,
    },
    CatalogEntry {
        version: 4,
        name: "0004_chat_s7c_orchestration",
        sql: S7C_ORCHESTRATION_SQL,
    },
    CatalogEntry {
        version: 5,
        name: "0005_chat_public_task_control_plane",
        sql: PUBLIC_TASK_CONTROL_PLANE_SQL,
    },
    CatalogEntry {
        version: 6,
        name: "0006_chat_attachments",
        sql: CHAT_ATTACHMENTS_SQL,
    },
    CatalogEntry {
        version: 7,
        name: "0007_chat_attachment_draft_targets",
        sql: CHAT_ATTACHMENT_DRAFT_TARGETS_SQL,
    },
    CatalogEntry {
        version: 8,
        name: "0008_chat_output_artifacts",
        sql: CHAT_OUTPUT_ARTIFACTS_SQL,
    },
    CatalogEntry {
        version: 9,
        name: "0009_chat_timeline_v4",
        sql: CHAT_TIMELINE_V4_SQL,
    },
    CatalogEntry {
        version: 10,
        name: "0010_chat_command_tool_v5",
        sql: CHAT_COMMAND_TOOL_V5_SQL,
    },
    CatalogEntry {
        version: 11,
        name: "0011_chat_approval_v6",
        sql: CHAT_APPROVAL_V6_SQL,
    },
    CatalogEntry {
        version: 12,
        name: "0012_chat_approval_v6_process_protection",
        sql: CHAT_APPROVAL_V6_PROCESS_PROTECTION_SQL,
    },
    CatalogEntry {
        version: 13,
        name: "0013_chat_permission_modes",
        sql: include_str!("../../migrations/chat/0013_chat_permission_modes.sql"),
    },
    CatalogEntry {
        version: 14,
        name: "0014_chat_native_conversation",
        sql: include_str!("../../migrations/chat/0014_chat_native_conversation.sql"),
    },
];

pub const LATEST_SCHEMA_VERSION: i64 = CATALOG.len() as i64;

pub fn validate_embedded_migrations() -> Result<(), ChatError> {
    migrations()
        .validate()
        .map_err(|_| ChatError::MigrationFailed)
}

pub fn migrate(connection: &mut Connection) -> Result<(), ChatError> {
    if connection.is_readonly(MAIN_DB).map_err(map_sqlite_error)? {
        return Err(ChatError::DatabaseReadOnly);
    }
    let current = user_version(connection)?;
    if current > LATEST_SCHEMA_VERSION {
        return Err(ChatError::MigrationFailed);
    }
    verify_ledger(connection, current)?;
    migrations()
        .to_latest(connection)
        .map_err(map_migration_error)?;
    verify_ledger(connection, LATEST_SCHEMA_VERSION)?;
    let violation: Option<i64> = connection
        .query_row(
            "SELECT 1 FROM pragma_foreign_key_check LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| ChatError::MigrationFailed)?;
    if violation.is_some() {
        return Err(ChatError::MigrationFailed);
    }
    Ok(())
}

fn migrations() -> Migrations<'static> {
    Migrations::new(
        CATALOG
            .iter()
            .map(|entry| {
                let entry = *entry;
                M::up_with_hook(entry.sql, move |transaction: &Transaction<'_>| {
                    record_migration(transaction, entry)
                })
                .comment(entry.name)
                .foreign_key_check()
            })
            .collect(),
    )
}

fn record_migration(transaction: &Transaction<'_>, entry: CatalogEntry) -> HookResult {
    let applied_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| HookError::Hook("migration clock unavailable".to_owned()))?
        .as_secs() as i64;
    transaction.execute(
        "INSERT INTO chat_schema_migrations(version, name, sha256, applied_at) VALUES (?1, ?2, ?3, ?4)",
        params![entry.version, entry.name, digest(entry.sql), applied_at],
    )?;
    Ok(())
}

fn verify_ledger(connection: &Connection, current_version: i64) -> Result<(), ChatError> {
    if current_version == 0 {
        return Ok(());
    }
    let table_exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='chat_schema_migrations')",
            [],
            |row| row.get(0),
        )
        .map_err(|_| ChatError::MigrationFailed)?;
    if !table_exists {
        return Err(ChatError::MigrationFailed);
    }
    for entry in CATALOG.iter().take(current_version as usize) {
        let recorded: Option<(String, String)> = connection
            .query_row(
                "SELECT name, sha256 FROM chat_schema_migrations WHERE version=?1",
                [entry.version],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ChatError::MigrationFailed)?;
        if recorded != Some((entry.name.to_owned(), digest(entry.sql))) {
            return Err(ChatError::MigrationFailed);
        }
    }
    let row_count: i64 = connection
        .query_row(
            "SELECT count(*) FROM chat_schema_migrations WHERE version <= ?1",
            [current_version],
            |row| row.get(0),
        )
        .map_err(|_| ChatError::MigrationFailed)?;
    if row_count != current_version {
        return Err(ChatError::MigrationFailed);
    }
    Ok(())
}

fn user_version(connection: &Connection) -> Result<i64, ChatError> {
    connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(map_sqlite_error)
}

fn map_migration_error(error: rusqlite_migration::Error) -> ChatError {
    match error {
        rusqlite_migration::Error::RusqliteError { err, .. } => map_sqlite_error(err),
        _ => ChatError::MigrationFailed,
    }
}

pub fn catalog_digests() -> Vec<(&'static str, String)> {
    CATALOG
        .iter()
        .map(|entry| (entry.name, digest(entry.sql)))
        .collect()
}

fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::OpenFlags;
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn embedded_migrations_validate_and_write_checksum_ledger() {
        validate_embedded_migrations().expect("validate embedded migrations");
        assert_eq!(
            digest(CHAT_APPROVAL_V6_PROCESS_PROTECTION_SQL),
            "98c635f3acf5191a4aa7be9891bb263bcfd52468c9cc9fc5730a06609ab87720"
        );
        let mut connection = Connection::open_in_memory().expect("open database");
        connection
            .execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable foreign keys");
        migrate(&mut connection).expect("migrate database");
        assert_eq!(user_version(&connection).unwrap(), LATEST_SCHEMA_VERSION);
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM chat_schema_migrations", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            LATEST_SCHEMA_VERSION
        );
    }

    #[test]
    fn checksum_drift_and_future_versions_fail_closed() {
        let mut connection = Connection::open_in_memory().expect("open database");
        migrate(&mut connection).expect("migrate database");
        connection
            .execute(
                "UPDATE chat_schema_migrations SET sha256=?1 WHERE version=1",
                ["0".repeat(64)],
            )
            .unwrap();
        assert_eq!(migrate(&mut connection), Err(ChatError::MigrationFailed));

        let mut future = Connection::open_in_memory().expect("open future database");
        future
            .execute_batch(
                "CREATE TABLE future_schema_sentinel(value TEXT NOT NULL);
                 INSERT INTO future_schema_sentinel(value) VALUES ('retained');",
            )
            .unwrap();
        future
            .pragma_update(None, "user_version", LATEST_SCHEMA_VERSION + 1)
            .unwrap();
        assert_eq!(migrate(&mut future), Err(ChatError::MigrationFailed));
        assert_eq!(user_version(&future).unwrap(), LATEST_SCHEMA_VERSION + 1);
        assert_eq!(
            future
                .query_row("SELECT value FROM future_schema_sentinel", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "retained"
        );
    }

    #[test]
    fn populated_v1_migrates_to_current_and_repeated_startup_is_idempotent() {
        let mut connection = Connection::open_in_memory().expect("open database");
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrations()
            .to_version(&mut connection, 1)
            .expect("create v1");
        let project_id = Uuid::now_v7().to_string();
        let session_id = Uuid::now_v7().to_string();
        let turn_id = Uuid::now_v7().to_string();
        let owner = Uuid::now_v7().to_string();
        let tenant = Uuid::now_v7().to_string();
        connection.execute(
			"INSERT INTO chat_projects(id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at)
			 VALUES (?1, ?2, ?3, 'Synthetic', ?4, X'01', 1)",
			params![project_id, owner, tenant, "a".repeat(64)],
		).unwrap();
        connection.execute(
			"INSERT INTO chat_sessions(id, owner_user_id, tenant_id, project_id, title, title_source, title_job_status, created_at, last_activity_at)
			 VALUES (?1, ?2, ?3, ?4, 'Existing', 'fallback', 'not_started', 1, 1)",
			params![session_id, owner, tenant, project_id],
		).unwrap();
        connection.execute(
			"INSERT INTO chat_turns(id, session_id, operation_id, status, terminal_at) VALUES (?1, ?2, ?3, 'completed', 1)",
			params![turn_id, session_id, Uuid::now_v7().to_string()],
		).unwrap();
        migrate(&mut connection).expect("migrate populated v1");
        migrate(&mut connection).expect("repeat startup");
        let retained: i64 = connection
            .query_row(
                "SELECT count(*) FROM chat_turns WHERE id=?1 AND reasoning_status='pending'",
                [turn_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retained, 1);
        assert_eq!(user_version(&connection).unwrap(), LATEST_SCHEMA_VERSION);
    }

    #[test]
    fn populated_v2_migrates_to_application_indexes_without_losing_history() {
        let mut connection = Connection::open_in_memory().expect("open database");
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrations()
            .to_version(&mut connection, 2)
            .expect("create v2");
        let project_id = Uuid::now_v7().to_string();
        let session_id = Uuid::now_v7().to_string();
        let turn_id = Uuid::now_v7().to_string();
        let owner = Uuid::now_v7().to_string();
        let tenant = Uuid::now_v7().to_string();
        connection
            .execute(
                "INSERT INTO chat_projects(
                   id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at
                 ) VALUES (?1, ?2, ?3, 'Synthetic', ?4, X'01', 1)",
                params![project_id, owner, tenant, "a".repeat(64)],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_sessions(
                   id, owner_user_id, tenant_id, project_id, title, title_source,
                   title_job_status, created_at, last_activity_at
                 ) VALUES (?1, ?2, ?3, ?4, 'Existing', 'fallback', 'not_started', 1, 1)",
                params![session_id, owner, tenant, project_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, status, terminal_at)
                 VALUES (?1, ?2, ?3, 'completed', 1)",
                params![turn_id, session_id, Uuid::now_v7().to_string()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_messages(
                   id, session_id, turn_id, role, content, status, ordinal, created_at
                 ) VALUES (?1, ?2, ?3, 'assistant', 'retained', 'committed', 0, 1)",
                params![Uuid::now_v7().to_string(), session_id, turn_id],
            )
            .unwrap();

        migrate(&mut connection).expect("migrate populated v2");
        migrate(&mut connection).expect("repeat current startup");
        assert_eq!(user_version(&connection).unwrap(), LATEST_SCHEMA_VERSION);
        assert_eq!(
            connection
                .query_row(
                    "SELECT content FROM chat_messages WHERE turn_id=?1",
                    [turn_id.clone()],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "retained"
        );
        assert!(connection
            .execute(
                "INSERT INTO chat_messages(
                   id, session_id, turn_id, role, content, status, ordinal, created_at
                 ) VALUES (?1, ?2, ?3, 'assistant', 'duplicate', 'committed', 1, 1)",
                params![Uuid::now_v7().to_string(), session_id, turn_id],
            )
            .is_err());
    }

    #[test]
    fn populated_v7_expands_to_empty_artifact_authority_without_backfill() {
        let mut connection = Connection::open_in_memory().expect("open database");
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrations()
            .to_version(&mut connection, 7)
            .expect("create v7");
        let project_id = Uuid::now_v7().to_string();
        let session_id = Uuid::now_v7().to_string();
        let turn_id = Uuid::now_v7().to_string();
        let owner = Uuid::now_v7().to_string();
        let tenant = Uuid::now_v7().to_string();
        connection
            .execute(
                "INSERT INTO chat_projects(
                   id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at
                 ) VALUES (?1, ?2, ?3, 'Synthetic', ?4, X'01', 1)",
                params![project_id, owner, tenant, "a".repeat(64)],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_sessions(
                   id, owner_user_id, tenant_id, project_id, title, title_source,
                   title_job_status, created_at, last_activity_at
                 ) VALUES (?1, ?2, ?3, ?4, 'Existing', 'fallback', 'not_started', 1, 1)",
                params![session_id, owner, tenant, project_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, status, terminal_at)
                 VALUES (?1, ?2, ?3, 'completed', 1)",
                params![turn_id, session_id, Uuid::now_v7().to_string()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_messages(
                   id, session_id, turn_id, role, content, status, ordinal, created_at
                 ) VALUES (?1, ?2, ?3, 'assistant', 'retained-v7', 'committed', 0, 1)",
                params![Uuid::now_v7().to_string(), session_id, turn_id],
            )
            .unwrap();

        migrate(&mut connection).expect("expand populated v7 to current");
        assert_eq!(user_version(&connection).unwrap(), LATEST_SCHEMA_VERSION);
        assert_eq!(
            connection
                .query_row(
                    "SELECT content FROM chat_messages WHERE turn_id=?1",
                    [turn_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "retained-v7"
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM chat_output_artifacts", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
    }

    #[test]
    fn populated_v3_migrates_to_recoverable_s7c_jobs_without_losing_state() {
        let mut connection = Connection::open_in_memory().expect("open database");
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrations()
            .to_version(&mut connection, 3)
            .expect("create v3");
        let operation_id = Uuid::now_v7().to_string();
        connection
            .execute(
                "INSERT INTO chat_deletion_jobs(
                   operation_id, keyed_session_hash, encrypted_retry_ids, desktop_state,
                   host_state, runtime_state, requested_at, lease_expires_at
                 ) VALUES (?1, ?2, X'01', 'pending', 'pending', 'pending', 1, 0)",
                params![operation_id, "a".repeat(64)],
            )
            .unwrap();

        migrate(&mut connection).expect("migrate populated v3");
        migrate(&mut connection).expect("repeat current startup");
        let retained: (Option<String>, i64, String, Option<String>) = connection
            .query_row(
                "SELECT session_id, attempt_count, outcome_code, last_error_code
                 FROM chat_deletion_jobs WHERE operation_id=?1",
                [operation_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            retained,
            (
                None,
                0,
                "legacy_unrecoverable".to_owned(),
                Some("legacy_job_missing_session_id".to_owned())
            )
        );
        assert_eq!(user_version(&connection).unwrap(), LATEST_SCHEMA_VERSION);
    }

    #[test]
    fn populated_v4_migrates_to_terminal_content_free_control_plane_state() {
        let mut connection = Connection::open_in_memory().expect("open database");
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrations()
            .to_version(&mut connection, 4)
            .expect("create v4");
        let project_id = Uuid::now_v7().to_string();
        let session_id = Uuid::now_v7().to_string();
        let turn_id = Uuid::now_v7().to_string();
        let operation_id = Uuid::now_v7().to_string();
        let owner = Uuid::now_v7().to_string();
        let tenant = Uuid::now_v7().to_string();
        connection
            .execute(
                "INSERT INTO chat_projects(
                   id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at
                 ) VALUES (?1, ?2, ?3, 'Synthetic', ?4, X'01', 1)",
                params![project_id, owner, tenant, "a".repeat(64)],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_sessions(
                   id, owner_user_id, tenant_id, project_id, title, title_source,
                   title_job_status, created_at, last_activity_at
                 ) VALUES (?1, ?2, ?3, ?4, 'Existing', 'fallback', 'not_started', 1, 2)",
                params![session_id, owner, tenant, project_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, status)
                 VALUES (?1, ?2, ?3, 'queued')",
                params![turn_id, session_id, Uuid::now_v7().to_string()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_outbox(
                   operation_id, session_id, kind, state, attempt_count,
                   next_attempt_at, payload_version, encrypted_payload
                 ) VALUES (?1, ?2, 'create_session', 'pending', 0, 1, 1, X'01')",
                params![operation_id, session_id],
            )
            .unwrap();

        migrate(&mut connection).expect("migrate populated v4");
        migrate(&mut connection).expect("repeat current startup");

        let binding: (String, String, String, String, Option<String>) = connection
            .query_row(
                "SELECT client_reference_id, create_operation_id, host_operation_id,
                        state, last_error_code
                 FROM chat_public_task_bindings WHERE session_id=?1",
                [session_id.clone()],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            binding,
            (
                session_id.clone(),
                session_id.clone(),
                session_id,
                "failed".to_owned(),
                Some("chat_protocol_error".to_owned()),
            )
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT state FROM chat_outbox WHERE operation_id=?1",
                    [operation_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "failed"
        );
        let columns = connection
            .prepare("SELECT name FROM pragma_table_info('chat_public_task_bindings')")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        for forbidden in [
            "prompt",
            "message",
            "assistant",
            "reasoning",
            "title",
            "path",
        ] {
            assert!(!columns.iter().any(|column| column.contains(forbidden)));
        }
        assert_eq!(user_version(&connection).unwrap(), LATEST_SCHEMA_VERSION);
    }

    #[test]
    fn populated_v6_discards_unroutable_drafts_and_preserves_bound_attachment_history() {
        let mut connection = Connection::open_in_memory().expect("open database");
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrations()
            .to_version(&mut connection, 6)
            .expect("create v6");

        let project_id = Uuid::now_v7().to_string();
        let session_id = Uuid::now_v7().to_string();
        let turn_id = Uuid::now_v7().to_string();
        let message_id = Uuid::now_v7().to_string();
        let owner = Uuid::now_v7().to_string();
        let tenant = Uuid::now_v7().to_string();
        let ready_id = Uuid::now_v7().to_string();
        let bound_id = Uuid::now_v7().to_string();
        connection
            .execute(
                "INSERT INTO chat_projects(
                   id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at
                 ) VALUES (?1, ?2, ?3, 'Synthetic', ?4, X'01', 1)",
                params![project_id, owner, tenant, "a".repeat(64)],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_sessions(
                   id, owner_user_id, tenant_id, project_id, title, title_source,
                   title_job_status, created_at, last_activity_at
                 ) VALUES (?1, ?2, ?3, ?4, 'Existing', 'fallback', 'not_started', 1, 2)",
                params![session_id, owner, tenant, project_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, status, terminal_at)
                 VALUES (?1, ?2, ?3, 'completed', 2)",
                params![turn_id, session_id, Uuid::now_v7().to_string()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_messages(
                   id, session_id, turn_id, role, content, status, ordinal, created_at
                 ) VALUES (?1, ?2, ?3, 'user', '', 'committed', 0, 1)",
                params![message_id, session_id, turn_id],
            )
            .unwrap();

        for (attachment_id, state, linked_message) in [
            (&ready_id, "ready", None),
            (&bound_id, "bound", Some(message_id.as_str())),
        ] {
            connection
                .execute(
                    "INSERT INTO chat_attachments(
                       id, owner_user_id, tenant_id, kind, safe_name, media_type,
                       byte_size, sha256, state, imported_at, expires_at, content_blob, message_id
                     ) VALUES (?1, ?2, ?3, 'file', 'synthetic.txt', 'text/plain',
                       7, ?4, ?5, 10, 604810, X'636F6E74656E74', ?6)",
                    params![
                        attachment_id,
                        owner,
                        tenant,
                        "b".repeat(64),
                        state,
                        linked_message
                    ],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO chat_attachment_chunks(
                       attachment_id, chunk_ordinal, content, byte_count
                     ) VALUES (?1, 0, 'context', 7)",
                    [attachment_id],
                )
                .unwrap();
        }
        connection
            .execute(
                "INSERT INTO chat_message_content_blocks(
                   message_id, block_ordinal, block_type, attachment_id
                 ) VALUES (?1, 0, 'file', ?2)",
                params![message_id, bound_id],
            )
            .unwrap();

        migrate(&mut connection).expect("migrate populated v6");
        migrate(&mut connection).expect("repeat current startup");

        assert_eq!(user_version(&connection).unwrap(), LATEST_SCHEMA_VERSION);
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM chat_attachments WHERE id=?1",
                    [ready_id.as_str()],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM chat_attachment_chunks WHERE attachment_id=?1",
                    [ready_id.as_str()],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT state, message_id, draft_target_kind, draft_session_id, draft_ordinal
                     FROM chat_attachments WHERE id=?1",
                    [bound_id.as_str()],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, Option<i64>>(4)?,
                        ))
                    },
                )
                .unwrap(),
            ("bound".to_owned(), message_id, None, None, None)
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM chat_attachment_chunks WHERE attachment_id=?1",
                    [bound_id.as_str()],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM chat_message_content_blocks WHERE attachment_id=?1",
                    [bound_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn feat136_v9_rows_remain_schema4_after_additive_v10() {
        let mut connection = Connection::open_in_memory().expect("open database");
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrations()
            .to_version(&mut connection, 9)
            .expect("migrate populated database to v9");

        let project_id = Uuid::now_v7().to_string();
        let session_id = Uuid::now_v7().to_string();
        let turn_id = Uuid::now_v7().to_string();
        let owner = Uuid::now_v7().to_string();
        let tenant = Uuid::now_v7().to_string();
        let event_id = Uuid::now_v7().to_string();
        connection
            .execute(
                "INSERT INTO chat_projects(
                   id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at
                 ) VALUES (?1, ?2, ?3, 'Synthetic', ?4, X'01', 1)",
                params![project_id, owner, tenant, "a".repeat(64)],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_sessions(
                   id, owner_user_id, tenant_id, project_id, title, title_source,
                   title_job_status, created_at, last_activity_at
                 ) VALUES (?1, ?2, ?3, ?4, 'Existing', 'fallback', 'not_started', 1, 2)",
                params![session_id, owner, tenant, project_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, status)
                 VALUES (?1, ?2, ?3, 'queued')",
                params![turn_id, session_id, Uuid::now_v7().to_string()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_observed_events_v4(
                   event_id, session_id, turn_id, stream_id, sequence, durable_sequence,
                   event_type, source_occurred_at, observed_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, 1, 1, 'item.started',
                           '2026-08-29T00:00:00Z', 1)",
                params![event_id, session_id, turn_id, Uuid::now_v7().to_string()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_timeline_items_v4(
                   turn_id, item_id, item_ordinal, item_type, status, text,
                   started_at_ms, source_event_id, source_sequence, source_occurred_at
                 ) VALUES (?1, 'legacy-v4', 1, 'agentMessage', 'in_progress', '', 1,
                           ?2, 1, '2026-08-29T00:00:00Z')",
                params![turn_id, event_id],
            )
            .unwrap();

        migrate(&mut connection).expect("migrate populated v9 database to v10");
        assert_eq!(
            connection
                .query_row(
                    "SELECT source_schema_version FROM chat_observed_events_v4 WHERE event_id=?1",
                    [event_id.as_str()],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            4
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT source_schema_version FROM chat_timeline_items_v4
                     WHERE turn_id=?1 AND item_id='legacy-v4'",
                    [turn_id.as_str()],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            4
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT (SELECT count(*) FROM chat_command_items_v5)
                            + (SELECT count(*) FROM chat_tool_items_v5)",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn feat136_v10_failed_terminal_codes_match_contract() {
        let mut connection = Connection::open_in_memory().expect("open database");
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrate(&mut connection).expect("migrate database");

        let project_id = Uuid::now_v7().to_string();
        let session_id = Uuid::now_v7().to_string();
        let turn_id = Uuid::now_v7().to_string();
        let owner = Uuid::now_v7().to_string();
        let tenant = Uuid::now_v7().to_string();
        connection
            .execute(
                "INSERT INTO chat_projects(
                   id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at
                 ) VALUES (?1, ?2, ?3, 'Synthetic', ?4, X'01', 1)",
                params![project_id, owner, tenant, "a".repeat(64)],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_sessions(
                   id, owner_user_id, tenant_id, project_id, title, title_source,
                   title_job_status, created_at, last_activity_at
                 ) VALUES (?1, ?2, ?3, ?4, 'Existing', 'fallback', 'not_started', 1, 2)",
                params![session_id, owner, tenant, project_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_turns(id, session_id, operation_id, status)
                 VALUES (?1, ?2, ?3, 'queued')",
                params![turn_id, session_id, Uuid::now_v7().to_string()],
            )
            .unwrap();

        for (ordinal, item_id, item_type) in [
            (1_i64, "tool-protocol", "tool"),
            (2, "tool-unknown", "tool"),
            (3, "command-protocol", "command"),
            (4, "command-declined", "command"),
        ] {
            connection
                .execute(
                    "INSERT INTO chat_timeline_items_v4(
                       turn_id, item_id, item_ordinal, item_type, status, text,
                       started_at_ms, completed_at_ms, source_event_id, source_sequence,
                       source_occurred_at, source_schema_version
                     ) VALUES (?1, ?2, ?3, ?4, 'completed', '', 1, 2, ?5, ?3,
                               '2026-08-29T00:00:00Z', 5)",
                    params![
                        turn_id,
                        item_id,
                        ordinal,
                        item_type,
                        Uuid::now_v7().to_string()
                    ],
                )
                .unwrap();
        }

        for (item_id, code, result) in [
            ("tool-protocol", "protocol_error", Some("bounded result")),
            ("tool-unknown", "unknown_tool", None),
        ] {
            connection
                .execute(
                    "INSERT INTO chat_tool_items_v5(
                       turn_id, item_id, status,
                       started_source_event_id, started_source_sequence, started_source_occurred_at,
                       last_source_event_id, last_source_sequence, last_source_occurred_at,
                       identity_resolution, server_name, tool_name,
                       arguments_summary, arguments_summary_bytes, arguments_summary_truncated,
                       duration_ms, result_summary, result_summary_bytes, result_summary_truncated,
                       error_code, error_summary
                     ) VALUES (?1, ?2, 'failed', ?3, 1, '2026-08-29T00:00:00Z',
                               ?4, 2, '2026-08-29T00:00:01Z', 'unknown', 'unknown', 'unknown',
                               '', 0, 0, 1, ?5, ?6, ?7, ?8, 'bounded error')",
                    params![
                        turn_id,
                        item_id,
                        Uuid::now_v7().to_string(),
                        Uuid::now_v7().to_string(),
                        result,
                        result.map(|value| i64::try_from(value.len()).unwrap()),
                        result.map(|_| 0_i64),
                        code,
                    ],
                )
                .unwrap();
        }

        for (item_id, status, code) in [
            ("command-protocol", "failed", "protocol_error"),
            ("command-declined", "declined", "command_declined"),
        ] {
            connection
                .execute(
                    "INSERT INTO chat_command_items_v5(
                       turn_id, item_id, status,
                       started_source_event_id, started_source_sequence, started_source_occurred_at,
                       last_source_event_id, last_source_sequence, last_source_occurred_at,
                       command_summary, command_summary_bytes, command_summary_truncated, cwd_kind,
                       output_retention, output_reason, output_truncated,
                       error_code, error_summary
                     ) VALUES (?1, ?2, ?3, ?4, 1, '2026-08-29T00:00:00Z',
                               ?5, 2, '2026-08-29T00:00:01Z', '', 0, 0, 'redacted',
                               'unavailable', 'not_available', 0, ?6, 'bounded error')",
                    params![
                        turn_id,
                        item_id,
                        status,
                        Uuid::now_v7().to_string(),
                        Uuid::now_v7().to_string(),
                        code,
                    ],
                )
                .unwrap();
        }

        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM chat_tool_items_v5", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM chat_command_items_v5", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            2
        );

        connection
            .execute(
                "UPDATE chat_tool_items_v5 SET identity_resolution='known'
                 WHERE turn_id=?1 AND item_id='tool-protocol'",
                [turn_id.as_str()],
            )
            .expect("known Tool identity may use the literal unknown display names");
        assert_eq!(
            connection
                .query_row(
                    "SELECT identity_resolution, server_name, tool_name
                     FROM chat_tool_items_v5
                     WHERE turn_id=?1 AND item_id='tool-protocol'",
                    [turn_id.as_str()],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .unwrap(),
            (
                "known".to_owned(),
                "unknown".to_owned(),
                "unknown".to_owned()
            )
        );

        connection
            .execute(
                "INSERT INTO chat_timeline_items_v4(
                   turn_id, item_id, item_ordinal, item_type, status, text,
                   started_at_ms, completed_at_ms, source_event_id, source_sequence,
                   source_occurred_at, source_schema_version
                 ) VALUES (?1, 'invalid-complete', 5, 'command', 'completed', '', 1, 2,
                           ?2, 5, '2026-08-29T00:00:00Z', 5)",
                params![turn_id, Uuid::now_v7().to_string()],
            )
            .unwrap();
        let invalid_complete = connection.execute(
            "INSERT INTO chat_command_items_v5(
               turn_id, item_id, status,
               started_source_event_id, started_source_sequence, started_source_occurred_at,
               last_source_event_id, last_source_sequence, last_source_occurred_at,
               command_summary, command_summary_bytes, command_summary_truncated, cwd_kind,
               output_retention, output_text, output_truncated, output_truncation_reason
             ) VALUES (?1, 'invalid-complete', 'completed', ?2, 1, '2026-08-29T00:00:00Z',
                       ?3, 2, '2026-08-29T00:00:01Z', '', 0, 0, 'redacted',
                       'complete', 'bounded', 1, 'upstream_truncated')",
            params![
                turn_id,
                Uuid::now_v7().to_string(),
                Uuid::now_v7().to_string(),
            ],
        );
        assert!(invalid_complete.is_err());
    }

    #[test]
    fn feat137_v11_process_rows_are_protected_transactionally_without_touching_v5() {
        const RAW: &str = "FEAT137_PRIVATE_PROCESS_CANARY_91D72A_DO_NOT_PERSIST";
        const RAW_SECOND: &str = "FEAT137_SECONDARY_PROCESS_CANARY_DO_NOT_PERSIST";
        const PROTECTED: &str = super::super::feat137::PROCESS_CONTENT_PROTECTED_MESSAGE;
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/feat-137/native-boundary-canary.json"
        ))
        .unwrap();
        assert_eq!(fixture["forbiddenCanary"].as_str(), Some(RAW));
        assert_eq!(fixture["protectedMessage"].as_str(), Some(PROTECTED));

        let mut connection = Connection::open_in_memory().expect("open database");
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrations()
            .to_version(&mut connection, 11)
            .expect("create v11");

        let project_id = Uuid::now_v7().to_string();
        let session_id = Uuid::now_v7().to_string();
        let owner = Uuid::now_v7().to_string();
        let tenant = Uuid::now_v7().to_string();
        connection
            .execute(
                "INSERT INTO chat_projects(
                   id, owner_user_id, tenant_id, safe_name, canonical_hash, bookmark_ref, last_used_at
                 ) VALUES (?1, ?2, ?3, 'Synthetic', ?4, X'01', 1)",
                params![project_id, owner, tenant, "a".repeat(64)],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_sessions(
                   id, owner_user_id, tenant_id, project_id, title, title_source,
                   title_job_status, created_at, last_activity_at
                 ) VALUES (?1, ?2, ?3, ?4, 'Existing', 'fallback', 'not_started', 1, 2)",
                params![session_id, owner, tenant, project_id],
            )
            .unwrap();

        let v6_turn = Uuid::now_v7().to_string();
        let v5_turn = Uuid::now_v7().to_string();
        let v4_turn = Uuid::now_v7().to_string();
        for turn_id in [&v6_turn, &v5_turn, &v4_turn] {
            connection
                .execute(
                    "INSERT INTO chat_turns(id, session_id, operation_id, status, terminal_at)
                     VALUES (?1, ?2, ?3, 'completed', 2)",
                    params![turn_id, session_id, Uuid::now_v7().to_string()],
                )
                .unwrap();
        }
        connection
            .execute(
                "INSERT INTO chat_turn_stream_versions_v6(turn_id, schema_version)
                 VALUES (?1, 6)",
                [v6_turn.as_str()],
            )
            .unwrap();

        for (turn_id, source_schema_version) in
            [(&v6_turn, 5_i64), (&v5_turn, 5_i64), (&v4_turn, 4_i64)]
        {
            let commentary_event = Uuid::now_v7().to_string();
            let reasoning_event = Uuid::now_v7().to_string();
            connection
                .execute(
                    "INSERT INTO chat_timeline_items_v4(
                       turn_id, item_id, item_ordinal, item_type, phase, status, text,
                       started_at_ms, completed_at_ms, source_event_id, source_sequence,
                       source_occurred_at, source_schema_version
                     ) VALUES (?1, 'commentary', 1, 'agentMessage', 'commentary', 'completed', ?2,
                               1, 2, ?3, 1, '2026-08-30T00:00:00Z', ?4)",
                    params![turn_id, RAW, commentary_event, source_schema_version],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO chat_timeline_items_v4(
                       turn_id, item_id, item_ordinal, item_type, status, text,
                       reasoning_status, reasoning_finalized_at_ms,
                       started_at_ms, completed_at_ms, source_event_id, source_sequence,
                       source_occurred_at, source_schema_version
                     ) VALUES (?1, 'reasoning', 2, 'reasoning', 'completed', ?2,
                               'complete', 2, 1, 2, ?3, 2, '2026-08-30T00:00:01Z', ?4)",
                    params![turn_id, RAW, reasoning_event, source_schema_version],
                )
                .unwrap();
            for (index, value) in [(0_i64, RAW), (1_i64, RAW_SECOND)] {
                connection
                    .execute(
                        "INSERT INTO chat_timeline_reasoning_parts_v4(
                           turn_id, item_id, content_index, text, byte_count
                         ) VALUES (?1, 'reasoning', ?2, ?3, ?4)",
                        params![turn_id, index, value, i64::try_from(value.len()).unwrap()],
                    )
                    .unwrap();
            }
            connection
                .execute(
                    "INSERT INTO chat_reasoning_items(
                       turn_id, item_id, item_ordinal, status, total_bytes, finalized_at_ms
                     ) VALUES (?1, 'reasoning', 0, 'complete', ?2, 2)",
                    params![
                        turn_id,
                        i64::try_from(RAW.len() + RAW_SECOND.len()).unwrap()
                    ],
                )
                .unwrap();
            for (index, value) in [(0_i64, RAW), (1_i64, RAW_SECOND)] {
                connection
                    .execute(
                        "INSERT INTO chat_reasoning_parts(
                           turn_id, item_id, content_index, text, byte_count
                         ) VALUES (?1, 'reasoning', ?2, ?3, ?4)",
                        params![turn_id, index, value, i64::try_from(value.len()).unwrap()],
                    )
                    .unwrap();
            }
            connection
                .execute(
                    "INSERT INTO chat_turn_plans_v4(
                       turn_id, source_event_id, source_sequence, source_occurred_at,
                       explanation, observed_at_ms
                     ) VALUES (?1, ?2, 3, '2026-08-30T00:00:02Z', ?3, 3)",
                    params![turn_id, Uuid::now_v7().to_string(), RAW],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO chat_turn_plan_steps_v4(turn_id, ordinal, step, status)
                     VALUES (?1, 0, ?2, 'in_progress')",
                    params![turn_id, RAW_SECOND],
                )
                .unwrap();
        }

        connection
            .execute(
                "INSERT INTO chat_timeline_items_v4(
                   turn_id, item_id, item_ordinal, item_type, status, text,
                   reasoning_status, reasoning_reason_code, reasoning_finalized_at_ms,
                   started_at_ms, completed_at_ms, source_event_id, source_sequence,
                   source_occurred_at, source_schema_version
                 ) VALUES (?1, 'reasoning-unavailable', 3, 'reasoning', 'completed', ?2,
                           'unavailable', 'not_available', 3, 1, 3, ?3, 4,
                           '2026-08-30T00:00:03Z', 5)",
                params![v6_turn, RAW, Uuid::now_v7().to_string()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_timeline_reasoning_parts_v4(
                   turn_id, item_id, content_index, text, byte_count
                 ) VALUES (?1, 'reasoning-unavailable', 0, ?2, ?3)",
                params![v6_turn, RAW, i64::try_from(RAW.len()).unwrap()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_reasoning_items(
                   turn_id, item_id, item_ordinal, status, reason_code, total_bytes, finalized_at_ms
                 ) VALUES (?1, 'reasoning-unavailable', 1, 'unavailable', 'not_available', 0, 3)",
                [v6_turn.as_str()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chat_reasoning_parts(
                   turn_id, item_id, content_index, text, byte_count
                 ) VALUES (?1, 'reasoning-unavailable', 0, ?2, ?3)",
                params![v6_turn, RAW, i64::try_from(RAW.len()).unwrap()],
            )
            .unwrap();

        migrate(&mut connection).expect("protect v6 process rows");
        migrate(&mut connection).expect("repeat protected startup");
        assert_eq!(user_version(&connection).unwrap(), LATEST_SCHEMA_VERSION);

        let v6_projection: (String, String, String, i64, String, i64, String, String) = connection
            .query_row(
                "SELECT
                   (SELECT text FROM chat_timeline_items_v4
                    WHERE turn_id=?1 AND item_id='commentary'),
                   (SELECT text FROM chat_timeline_items_v4
                    WHERE turn_id=?1 AND item_id='reasoning'),
                   (SELECT text FROM chat_timeline_reasoning_parts_v4
                    WHERE turn_id=?1 AND item_id='reasoning' AND content_index=0),
                   (SELECT count(*) FROM chat_timeline_reasoning_parts_v4
                    WHERE turn_id=?1 AND item_id='reasoning'),
                   (SELECT text FROM chat_reasoning_parts
                    WHERE turn_id=?1 AND item_id='reasoning' AND content_index=0),
                   (SELECT count(*) FROM chat_reasoning_parts
                    WHERE turn_id=?1 AND item_id='reasoning'),
                   (SELECT explanation FROM chat_turn_plans_v4 WHERE turn_id=?1),
                   (SELECT step FROM chat_turn_plan_steps_v4 WHERE turn_id=?1 AND ordinal=0)",
                [v6_turn.as_str()],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            v6_projection,
            (
                PROTECTED.to_owned(),
                String::new(),
                PROTECTED.to_owned(),
                1,
                PROTECTED.to_owned(),
                1,
                PROTECTED.to_owned(),
                PROTECTED.to_owned(),
            )
        );
        let unavailable_parts: (i64, i64) = connection
            .query_row(
                "SELECT
                   (SELECT count(*) FROM chat_timeline_reasoning_parts_v4
                    WHERE turn_id=?1 AND item_id='reasoning-unavailable'),
                   (SELECT count(*) FROM chat_reasoning_parts
                    WHERE turn_id=?1 AND item_id='reasoning-unavailable')",
                [v6_turn.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(unavailable_parts, (0, 0));
        let upgraded_v6_forbidden_hits: i64 = connection
            .query_row(
                "SELECT
                   (SELECT count(*) FROM chat_timeline_items_v4
                    WHERE turn_id=?1 AND instr(text, ?2) > 0)
                 + (SELECT count(*) FROM chat_timeline_reasoning_parts_v4
                    WHERE turn_id=?1 AND instr(text, ?2) > 0)
                 + (SELECT count(*) FROM chat_reasoning_parts
                    WHERE turn_id=?1 AND instr(text, ?2) > 0)
                 + (SELECT count(*) FROM chat_turn_plans_v4
                    WHERE turn_id=?1 AND instr(COALESCE(explanation, ''), ?2) > 0)
                 + (SELECT count(*) FROM chat_turn_plan_steps_v4
                    WHERE turn_id=?1 AND instr(step, ?2) > 0)",
                params![v6_turn, RAW],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(upgraded_v6_forbidden_hits, 0);

        let v5_projection: (String, String, i64, String) = connection
            .query_row(
                "SELECT
                   (SELECT text FROM chat_timeline_items_v4
                    WHERE turn_id=?1 AND item_id='commentary'),
                   (SELECT text FROM chat_timeline_reasoning_parts_v4
                    WHERE turn_id=?1 AND item_id='reasoning' AND content_index=0),
                   (SELECT count(*) FROM chat_timeline_reasoning_parts_v4
                    WHERE turn_id=?1 AND item_id='reasoning'),
                   (SELECT step FROM chat_turn_plan_steps_v4 WHERE turn_id=?1 AND ordinal=0)",
                [v5_turn.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            v5_projection,
            (RAW.to_owned(), RAW.to_owned(), 2, RAW_SECOND.to_owned())
        );
        let v4_projection: (String, String, i64, String) = connection
            .query_row(
                "SELECT
                   (SELECT text FROM chat_timeline_items_v4
                    WHERE turn_id=?1 AND item_id='commentary'),
                   (SELECT text FROM chat_timeline_reasoning_parts_v4
                    WHERE turn_id=?1 AND item_id='reasoning' AND content_index=0),
                   (SELECT count(*) FROM chat_timeline_reasoning_parts_v4
                    WHERE turn_id=?1 AND item_id='reasoning'),
                   (SELECT step FROM chat_turn_plan_steps_v4 WHERE turn_id=?1 AND ordinal=0)",
                [v4_turn.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(v4_projection, v5_projection);
    }

    #[test]
    fn readonly_and_corrupt_databases_fail_closed() {
        let root = std::env::temp_dir().join(format!("yijie-migration-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let path = root.join("readonly.db");
        let mut writable = Connection::open(&path).unwrap();
        migrate(&mut writable).unwrap();
        drop(writable);
        let mut readonly =
            Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert_eq!(migrate(&mut readonly), Err(ChatError::DatabaseReadOnly));
        drop(readonly);

        let corrupt_path = root.join("corrupt.db");
        fs::write(&corrupt_path, b"not-a-sqlite-database").unwrap();
        let mut corrupt = Connection::open(&corrupt_path).unwrap();
        assert_eq!(migrate(&mut corrupt), Err(ChatError::DatabaseCorrupt));
        drop(corrupt);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn feat132_populated_schema13_migrates_forward_without_native_backfill() {
        let root = std::env::temp_dir().join(format!("feat132-schema13-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let file = root.join("ordinary-fixture.db");
        let mut connection = Connection::open(&file).unwrap();
        connection
            .execute_batch("PRAGMA key='public-native-migration-fixture'; PRAGMA foreign_keys=ON;")
            .unwrap();
        let cipher: String = connection
            .query_row("PRAGMA cipher_version", [], |r| r.get(0))
            .unwrap();
        assert!(!cipher.is_empty());
        migrations().to_version(&mut connection, 13).unwrap();
        let project = Uuid::now_v7().to_string();
        let session = Uuid::now_v7().to_string();
        let completed = Uuid::now_v7().to_string();
        let queued = Uuid::now_v7().to_string();
        let owner = Uuid::now_v7().to_string();
        let tenant = Uuid::now_v7().to_string();
        connection.execute("INSERT INTO chat_projects(id,owner_user_id,tenant_id,safe_name,canonical_hash,bookmark_ref,last_used_at) VALUES(?1,?2,?3,'Fixture',?4,X'01',1)",params![project,owner,tenant,"a".repeat(64)]).unwrap();
        connection.execute("INSERT INTO chat_sessions(id,owner_user_id,tenant_id,project_id,title,title_source,title_job_status,created_at,last_activity_at,runtime_thread_id) VALUES(?1,?2,?3,?4,'Old history','fallback','cancelled',1,1,?5)",params![session,owner,tenant,project,Uuid::now_v7().to_string()]).unwrap();
        connection.execute("INSERT INTO chat_turns(id,session_id,operation_id,runtime_turn_id,status,terminal_at) VALUES(?1,?2,?3,?4,'failed',2)",params![completed,session,Uuid::now_v7().to_string(),Uuid::now_v7().to_string()]).unwrap();
        connection.execute("INSERT INTO chat_turns(id,session_id,operation_id,status) VALUES(?1,?2,?3,'queued')",params![queued,session,Uuid::now_v7().to_string()]).unwrap();
        connection.execute("INSERT INTO chat_messages(id,session_id,turn_id,role,content,status,ordinal,created_at) VALUES(?1,?2,?3,'assistant','Old body retained','committed',0,1)",params![Uuid::now_v7().to_string(),session,completed]).unwrap();
        connection
            .execute(
                "INSERT INTO chat_task_permissions(session_id,mode) VALUES(?1,'auto')",
                [&session],
            )
            .unwrap();
        migrate(&mut connection).unwrap();
        migrate(&mut connection).unwrap();
        assert_eq!(user_version(&connection).unwrap(), 14);
        verify_ledger(&connection, 14).unwrap();
        let counts:(i64,i64,i64)=connection.query_row("SELECT (SELECT count(*) FROM chat_native_bindings),(SELECT count(*) FROM chat_native_facts),(SELECT count(*) FROM chat_native_views)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(counts, (0, 0, 0));
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM chat_turns WHERE submission_status IS NOT NULL",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT mode FROM chat_task_permissions WHERE session_id=?1",
                    [&session],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "auto"
        );
        drop(connection);
        assert_ne!(&fs::read(&file).unwrap()[..16], b"SQLite format 3\0");
        let reopened = Connection::open(&file).unwrap();
        reopened
            .execute_batch("PRAGMA key='public-native-migration-fixture';")
            .unwrap();
        assert_eq!(
            reopened
                .query_row("SELECT content FROM chat_messages", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "Old body retained"
        );
        assert_eq!(
            reopened
                .query_row(
                    "SELECT status FROM chat_turns WHERE id=?1",
                    [&queued],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "queued"
        );
        drop(reopened);
        fs::remove_dir_all(root).unwrap();
    }
}
