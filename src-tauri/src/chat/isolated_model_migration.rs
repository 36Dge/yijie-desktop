//! One-shot local maintenance. No path argument, worker, Host or Runtime.
//! The ordinary open guard remains unchanged; only this reviewed entry expands.
use super::{apply_raw_key, ChatRepository, ChatScope};
use crate::chat::{error::ChatError, keychain::*, migrations, schedules::ScheduleStorageMode};
use crate::local_profile::{DEMO_FAST_OWNER_USER_ID, DEMO_FAST_TENANT_ID};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;

const IDENTIFIER: &str = "com.yijie.ai.feat164-kimi-k31-r1";
const DIRECTORY: &str = "demo-fast-model-candidate-v1";
#[derive(Clone, Copy, PartialEq, Eq)]
enum Target {
    Isolated,
    Daily,
}
impl Target {
    fn directory(self) -> &'static str {
        match self {
            Self::Isolated => DIRECTORY,
            Self::Daily => "demo-fast-v1",
        }
    }
}

fn invalid() -> ChatError {
    ChatError::InvalidConfiguration
}
fn storage() -> ChatError {
    ChatError::DatabaseUnavailable
}

pub(crate) fn run(identifier: &str) -> Result<String, ChatError> {
    run_target(
        identifier,
        Target::Isolated,
        "--feat164-migrate-isolated-k3",
    )
}
pub(crate) fn run_daily(identifier: &str) -> Result<String, ChatError> {
    run_target(identifier, Target::Daily, "--feat164-migrate-daily-k3")
}
fn run_target(identifier: &str, target: Target, argument: &str) -> Result<String, ChatError> {
    if std::env::args().skip(1).collect::<Vec<_>>() != [argument] {
        return Err(invalid());
    }
    let home = PathBuf::from(std::env::var_os("HOME").ok_or_else(invalid)?);
    let application_support = home.join("Library/Application Support");
    let result = migrate_target(&application_support, identifier, target)?;
    serde_json::to_string(&result).map_err(|_| storage())
}

#[derive(Serialize)]
pub(crate) struct ResultSummary {
    status: &'static str,
    from_schema: i64,
    to_schema: i64,
    backup_id: String,
    model_http: u8,
}

#[cfg(test)]
fn admit(application_support: &Path, identifier: &str) -> Result<PathBuf, ChatError> {
    admit_target(application_support, identifier, Target::Isolated)
}
fn admit_target(
    application_support: &Path,
    identifier: &str,
    target: Target,
) -> Result<PathBuf, ChatError> {
    if !cfg!(target_os = "macos")
        || !crate::chat::models::v2_enabled()
        || !crate::chat::models::enabled()
    {
        return Err(invalid());
    }
    let allowed = match target {
        Target::Isolated => {
            matches!(
                identifier,
                IDENTIFIER | crate::feat164_qualification::IDENTIFIER
            ) && !crate::feat164_qualification::daily_selected()
                && std::env::var("YIJIE_FEAT155_SCHEDULED_CANDIDATE").as_deref() == Ok("true")
                && std::env::var("YIJIE_FEAT155_SCHEDULED_DAILY").as_deref() == Ok("false")
        }
        Target::Daily => crate::feat164_qualification::daily_admitted(identifier),
    };
    if !allowed {
        return Err(invalid());
    }
    let base = application_support
        .join(identifier)
        .join(target.directory());
    if !base.is_absolute() || fs::canonicalize(&base).map_err(|_| invalid())? != base {
        return Err(invalid());
    }
    for p in [&base, &base.join("chat"), &base.join("secrets")] {
        let m = fs::symlink_metadata(p).map_err(|_| invalid())?;
        // The existing daily parent can be 0755. Do not change its permissions.
        let mode = m.mode() & 0o777;
        let valid_mode = mode == 0o700 || (target == Target::Daily && p == &base && mode == 0o755);
        if !m.is_dir() || m.uid() != unsafe { libc::geteuid() } || !valid_mode {
            return Err(invalid());
        }
    }
    Ok(base)
}

fn no_open_handles(base: &Path) -> Result<(), ChatError> {
    let out = Command::new("/usr/sbin/lsof")
        .args(["-nP", "+D"])
        .arg(base)
        .output()
        .map_err(|_| invalid())?;
    if out.status.code() != Some(1) || !out.stdout.is_empty() || !out.stderr.is_empty() {
        return Err(ChatError::CleanupIncomplete);
    }
    Ok(())
}

fn bytes(path: &Path) -> Result<Vec<u8>, ChatError> {
    let m = fs::symlink_metadata(path).map_err(|_| storage())?;
    if !m.is_file()
        || m.nlink() != 1
        || m.uid() != unsafe { libc::geteuid() }
        || m.mode() & 0o077 != 0
    {
        return Err(invalid());
    }
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| storage())?;
    let actual = file.metadata().map_err(|_| storage())?;
    if actual.dev() != m.dev() || actual.ino() != m.ino() {
        return Err(invalid());
    }
    let mut data = Vec::new();
    file.read_to_end(&mut data).map_err(|_| storage())?;
    Ok(data)
}
fn write_new(path: &Path, data: &[u8]) -> Result<(), ChatError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| storage())?;
    file.write_all(data)
        .and_then(|_| file.sync_all())
        .map_err(|_| storage())
}
fn files(base: &Path) -> Result<BTreeMap<String, String>, ChatError> {
    let mut hashes = BTreeMap::new();
    for rel in [
        "chat/conversations.db",
        "chat/conversations.db-wal",
        "chat/conversations.db-shm",
        "secrets/chat-sqlcipher-v1.secret",
        "secrets/receipt-hmac-v1.secret",
    ] {
        let path = base.join(rel);
        if (rel.ends_with("-wal") || rel.ends_with("-shm")) && !path.exists() {
            continue;
        }
        hashes.insert(rel.into(), format!("{:x}", Sha256::digest(bytes(&path)?)));
    }
    Ok(hashes)
}
fn snapshot(
    base: &Path,
    hashes: &BTreeMap<String, String>,
) -> Result<(String, PathBuf), ChatError> {
    let parent = base.join("kimi-k31-migration-backups");
    crate::chat::schedules::candidate::private_directory(&parent)?;
    let id = uuid::Uuid::now_v7().to_string();
    let out = parent.join(&id);
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&out)
        .map_err(|_| storage())?;
    for name in ["chat", "secrets"] {
        fs::DirBuilder::new()
            .mode(0o700)
            .create(out.join(name))
            .map_err(|_| storage())?;
    }
    for (rel, sha) in hashes {
        let data = bytes(&base.join(rel))?;
        if &format!("{:x}", Sha256::digest(&data)) != sha {
            return Err(ChatError::CleanupIncomplete);
        }
        write_new(&out.join(rel), &data)?;
    }
    write_new(
        &out.join("source-files.json"),
        &serde_json::to_vec_pretty(hashes).map_err(|_| storage())?,
    )?;
    Ok((id, out))
}
fn open_read(path: &Path, key: &DatabaseKey) -> Result<Connection, ChatError> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| storage())?;
    apply_raw_key(&db, key)?;
    db.execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;")
        .map_err(|_| storage())?;
    migrations::validate_reader(&db)?;
    let integrity: String = db
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| storage())?;
    if integrity != "ok" {
        return Err(storage());
    }
    if db
        .prepare("PRAGMA foreign_key_check")
        .map_err(|_| storage())?
        .exists([])
        .map_err(|_| storage())?
    {
        return Err(storage());
    }
    Ok(db)
}
fn preflight(db: &Connection) -> Result<i64, ChatError> {
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|_| storage())?;
    if ![29, 37, 38, 39, 40, 41].contains(&version) {
        return Err(invalid());
    }
    for table in [
        "chat_sessions",
        "chat_projects",
        "chat_scheduled_plans",
        "chat_scheduled_grants",
    ] {
        let foreign: bool = db
            .query_row(
                &format!(
                    "SELECT EXISTS(SELECT 1 FROM {table} WHERE owner_user_id!=?1 OR tenant_id!=?2)"
                ),
                [DEMO_FAST_OWNER_USER_ID, DEMO_FAST_TENANT_ID],
                |r| r.get(0),
            )
            .map_err(|_| storage())?;
        if foreign {
            return Err(ChatError::ScopeDenied);
        }
    }
    for sql in [
        "SELECT EXISTS(SELECT 1 FROM chat_outbox WHERE state IN ('pending','inflight'))",
        "SELECT EXISTS(SELECT 1 FROM chat_model_selections WHERE state!='ready')",
        "SELECT EXISTS(SELECT 1 FROM chat_scheduled_reservation)",
        "SELECT EXISTS(SELECT 1 FROM chat_scheduled_grants WHERE occupied_runs>0)",
        "SELECT EXISTS(SELECT 1 FROM chat_turns WHERE submission_status='uncertain' OR status IN ('streaming','stopping'))",
        "SELECT EXISTS(SELECT 1 FROM chat_native_bindings b LEFT JOIN chat_native_views v ON v.turn_id=b.turn_id AND v.session_id=b.session_id WHERE v.turn_id IS NULL OR v.format_version NOT BETWEEN 1 AND 5 OR NOT json_valid(v.view_json) OR COALESCE(json_extract(v.view_json,'$.status'),'unknown') NOT IN ('completed','failed','interrupted'))",
    ] {
        if db.query_row(sql, [], |r| r.get::<_, bool>(0)).map_err(|_| storage())? { return Err(ChatError::ConversationConflict); }
    }
    Ok(version)
}

fn migrate_target(
    application_support: &Path,
    identifier: &str,
    target: Target,
) -> Result<ResultSummary, ChatError> {
    let base = admit_target(application_support, identifier, target)?;
    let _instance = crate::single_instance::acquire(identifier, crate::chat::experts::enabled())
        .map_err(|_| ChatError::CleanupIncomplete)?;
    no_open_handles(&base)?;
    let original = files(&base)?;
    let (id, backup) = snapshot(&base, &original)?;
    let result = (|| {
        let key = ProtectedDatabaseKeyStore::new_local_demo(
            backup.join("secrets/chat-sqlcipher-v1.secret"),
        )?
        .load_or_create(true)?;
        let receipt = ProtectedReceiptKeyStore::new_local_demo(
            backup.join("secrets/receipt-hmac-v1.secret"),
        )?
        .load_or_create(true)?;
        // SQLite may update SHM even for a read-only connection. Keep the sealed
        // backup untouched and inspect a second complete DB/WAL/SHM copy.
        let inspection = backup.join("inspection");
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&inspection)
            .map_err(|_| storage())?;
        for rel in original.keys().filter(|p| p.starts_with("chat/")) {
            write_new(
                &inspection.join(Path::new(rel).file_name().ok_or_else(invalid)?),
                &bytes(&backup.join(rel))?,
            )?;
        }
        let db = open_read(&inspection.join("conversations.db"), &key)?;
        let version = preflight(&db)?;
        drop(db);
        if files(&base)? != original {
            return Err(ChatError::CleanupIncomplete);
        }
        no_open_handles(&base)?;
        if version < 38 {
            let mut db = Connection::open_with_flags(
                base.join("chat/conversations.db"),
                OpenFlags::SQLITE_OPEN_READ_WRITE,
            )
            .map_err(|_| storage())?;
            apply_raw_key(&db, &key)?;
            super::configure_connection(&db)?;
            migrations::migrate_to_target(&mut db, migrations::KIMI_K31_SCHEMA_VERSION)?;
            db.close().map_err(|_| storage())?;
        }
        let repo = ChatRepository::open_with_schedule_storage(
            &base.join("chat"),
            &key,
            receipt,
            ChatScope::new(DEMO_FAST_OWNER_USER_ID.into(), DEMO_FAST_TENANT_ID.into())?,
            ScheduleStorageMode::TimingFoundation,
        )?;
        let current = repo.schema_version()?;
        if current != 41 {
            return Err(storage());
        }
        drop(repo); // normal connection close; never a manual checkpoint or WAL edit
        Ok(ResultSummary {
            status: "migrated_or_reopened",
            from_schema: version,
            to_schema: current,
            backup_id: id.clone(),
            model_http: 0,
        })
    })();
    let receipt = match &result {
        Ok(v) => serde_json::to_vec_pretty(v).map_err(|_| storage())?,
        Err(e) => serde_json::to_vec_pretty(&serde_json::json!({"status":"stopped", "code":e.code(), "automatic_restore":false, "model_http":0})).map_err(|_| storage())?,
    };
    write_new(&backup.join("result.json"), &receipt)?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn copy_case(source: &Path, destination: &Path) {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(destination.join("chat"))
            .unwrap();
        fs::DirBuilder::new()
            .mode(0o700)
            .create(destination.join("secrets"))
            .unwrap();
        for f in fs::read_dir(source.join("chat")).unwrap() {
            let f = f.unwrap();
            if f.file_type().unwrap().is_file() {
                write_new(
                    &destination.join("chat").join(f.file_name()),
                    &fs::read(f.path()).unwrap(),
                )
                .unwrap();
            }
        }
        write_new(
            &destination.join("secrets/chat-sqlcipher-v1.secret"),
            &[164; 32],
        )
        .unwrap();
        write_new(
            &destination.join("secrets/receipt-hmac-v1.secret"),
            &[165; 32],
        )
        .unwrap();
    }
    fn facts(db: &Connection, saved: &serde_json::Value) {
        for entry in saved["facts"].as_array().unwrap() {
            let name = entry[0].as_str().unwrap();
            let mut q = db
                .prepare(&format!("SELECT * FROM {name} ORDER BY rowid"))
                .unwrap();
            let n = q.column_count();
            let hashes = q
                .query_map([], |r| {
                    let row = (0..n)
                        .map(|i| format!("{:?}", r.get_ref(i).unwrap()))
                        .collect::<Vec<_>>();
                    Ok(format!(
                        "{:x}",
                        Sha256::digest(serde_json::to_vec(&row).unwrap())
                    ))
                })
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            assert_eq!(
                serde_json::to_value(hashes).unwrap(),
                entry[1],
                "old {name} changed"
            );
        }
    }
    #[test]
    #[ignore = "requires fresh retained natural legacy fixture and isolated test output"]
    fn feat164_controlled_isolated_migration() {
        controlled_migration(Target::Isolated);
    }
    #[test]
    #[ignore = "requires fresh retained natural legacy fixture; never the actual daily data root"]
    fn feat164_controlled_daily_migration() {
        controlled_migration(Target::Daily);
    }
    fn controlled_migration(target: Target) {
        let identifier = if target == Target::Daily {
            crate::feat164_qualification::DAILY_IDENTIFIER
        } else {
            IDENTIFIER
        };
        let source = PathBuf::from(std::env::var("YIJIE_FEAT164_NATURAL_SOURCE").unwrap());
        let output = PathBuf::from(std::env::var("YIJIE_FEAT164_MIGRATION_TEST_ROOT").unwrap());
        assert!(output.is_absolute() && !output.exists());
        fs::DirBuilder::new().mode(0o700).create(&output).unwrap();
        assert!(admit_target(Path::new("relative"), identifier, target).is_err());
        let other = if target == Target::Daily {
            IDENTIFIER
        } else {
            crate::feat164_qualification::DAILY_IDENTIFIER
        };
        assert!(admit_target(&output, other, target).is_err());
        for held in [true, false] {
            let case = if held { "held" } else { "review" };
            let support = output.join(case).join("Application Support");
            let base = support.join(identifier).join(target.directory());
            if target == Target::Daily {
                // A normal daily parent, not a permission-failure fixture.
                fs::DirBuilder::new()
                    .recursive(true)
                    .mode(0o755)
                    .create(&base)
                    .unwrap();
            }
            copy_case(&source.join(case), &base);
            if target == Target::Daily {
                assert_eq!(fs::metadata(&base).unwrap().mode() & 0o777, 0o755);
            }
            let before = files(&base).unwrap();
            // Normal concurrent ownership, not a process fault or permission fixture.
            let guard = crate::single_instance::acquire(identifier, false).unwrap();
            assert!(matches!(
                migrate_target(&support, identifier, target),
                Err(ChatError::CleanupIncomplete)
            ));
            drop(guard);
            assert_eq!(files(&base).unwrap(), before);
            let result = migrate_target(&support, identifier, target);
            if held {
                assert!(matches!(result, Err(ChatError::ConversationConflict)));
                assert_eq!(
                    files(&base).unwrap(),
                    before,
                    "occupied legacy root must stay unchanged"
                );
                continue;
            }
            let result = result.unwrap();
            let expected: serde_json::Value =
                serde_json::from_slice(&fs::read(source.join(case).join("legacy.json")).unwrap())
                    .unwrap();
            assert_eq!(
                (result.from_schema, result.to_schema),
                (expected["schema"].as_i64().unwrap(), 41)
            );
            let backup = base
                .join("kimi-k31-migration-backups")
                .join(&result.backup_id);
            for (rel, sha) in &before {
                assert_eq!(
                    format!("{:x}", Sha256::digest(bytes(&backup.join(rel)).unwrap())),
                    *sha
                );
            }
            let saved: serde_json::Value =
                serde_json::from_slice(&fs::read(source.join(case).join("legacy.json")).unwrap())
                    .unwrap();
            // Read a complete copy, preserving both the original snapshot and migrated store.
            let probe = output.join("after-probe");
            copy_case(&base, &probe);
            let db = open_read(
                &probe.join("chat/conversations.db"),
                &DatabaseKey::from_bytes([164; 32]),
            )
            .unwrap();
            facts(&db, &saved);
            let count: i64 = db
                .query_row(
                    "SELECT count(*) FROM chat_plan_model_retirements",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 2);
            let still_enabled:i64=db.query_row("SELECT count(*) FROM chat_scheduled_plans p JOIN chat_plan_models m ON m.plan_id=p.plan_id WHERE m.profile_id='kimi-k3-max-v1' AND (p.state!='paused' OR p.authorization_ref IS NOT NULL OR p.next_at IS NOT NULL)",[],|r|r.get(0)).unwrap();
            assert_eq!(still_enabled, 0);
            drop(db);
            let repeated = migrate_target(&support, identifier, target).unwrap();
            assert_eq!((repeated.from_schema, repeated.to_schema), (41, 41));
            let repo = ChatRepository::open_with_schedule_storage(
                &base.join("chat"),
                &DatabaseKey::from_bytes([164; 32]),
                ReceiptKey::from_bytes([165; 32]),
                ChatScope::new(DEMO_FAST_OWNER_USER_ID.into(), DEMO_FAST_TENANT_ID.into()).unwrap(),
                ScheduleStorageMode::TimingFoundation,
            )
            .unwrap();
            facts(&repo.connection, &saved);
            let count: i64 = repo
                .connection
                .query_row(
                    "SELECT count(*) FROM chat_plan_model_retirements",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 2);
            drop(repo);
        }
        println!("S4R_CONTROLLED_MIGRATION_PASS: identity/path/normal ownership guards; held refusal; natural29->41; exact backup; old facts; idempotence; normal reader reopen; modelHTTP=0");
    }

    #[test]
    #[ignore = "explicit feature-off process; no database access"]
    fn feat164_disabled_migration_is_rejected() {
        assert!(!crate::chat::models::v2_enabled());
        assert!(admit_target(
            Path::new("/"),
            crate::feat164_qualification::DAILY_IDENTIFIER,
            Target::Daily
        )
        .is_err());
        assert!(matches!(
            admit(Path::new("/"), IDENTIFIER),
            Err(ChatError::InvalidConfiguration)
        ));
    }
}
