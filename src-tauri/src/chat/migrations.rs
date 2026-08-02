use super::error::ChatError;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use rusqlite_migration::{HookError, HookResult, Migrations, M};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

const CORE_SQL: &str = include_str!("../../migrations/chat/0001_chat_core.sql");
const REASONING_SQL: &str = include_str!("../../migrations/chat/0002_chat_reasoning_v2.sql");

#[derive(Clone, Copy)]
struct CatalogEntry {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const CATALOG: [CatalogEntry; 2] = [
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
];

pub const LATEST_SCHEMA_VERSION: i64 = CATALOG.len() as i64;

pub fn validate_embedded_migrations() -> Result<(), ChatError> {
    migrations()
        .validate()
        .map_err(|_| ChatError::MigrationFailed)
}

pub fn migrate(connection: &mut Connection) -> Result<(), ChatError> {
    let current = user_version(connection)?;
    if current > LATEST_SCHEMA_VERSION {
        return Err(ChatError::MigrationFailed);
    }
    verify_ledger(connection, current)?;
    migrations()
        .to_latest(connection)
        .map_err(|_| ChatError::MigrationFailed)?;
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
        .map_err(|_| ChatError::MigrationFailed)
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

    #[test]
    fn embedded_migrations_validate_and_write_checksum_ledger() {
        validate_embedded_migrations().expect("validate embedded migrations");
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
            .pragma_update(None, "user_version", LATEST_SCHEMA_VERSION + 1)
            .unwrap();
        assert_eq!(migrate(&mut future), Err(ChatError::MigrationFailed));
    }
}
