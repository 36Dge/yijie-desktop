//! Native-owned installation for the built-in connector; it starts disabled.
//! The caller holds current management admission. No credentials are accessed.
use super::*;

pub(in crate::chat::connectors) fn prepare_kimi_default(
    db: &mut Connection,
    scope: &ChatScope,
    now: i64,
) -> Result<()> {
    if !provider_storage(db)? {
        return Ok(());
    }
    let entry = super::super::catalog()
        .catalog
        .iter()
        .find(|e| e.service_id == wire::BUILTIN_MODEL_SERVICE_ID)
        .ok_or(Error::NotFound)?;
    if lookup(db, scope, entry)?.is_none() {
        install(
            db,
            scope,
            entry,
            super::super::catalog().catalog_revision,
            wire::InstallPayload {
                service_id: entry.service_id.clone(),
                operation_id: Uuid::now_v7().to_string(),
                expected_revision: 0,
            },
            now,
        )?;
    }
    // Installation is the only default. Existing enabled/disabled state is
    // handled once per Native process by the ordinary suspend owner; a read or
    // context renewal never re-enables this connector or rewrites old receipts.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kimi_default_installs_disabled_once_and_preserves_explicit_removal() {
        let mut db = Connection::open_in_memory().unwrap();
        crate::chat::migrations::migrate_to_target(
            &mut db,
            crate::chat::migrations::CONNECTOR_SUSPEND_SCHEMA_VERSION,
        )
        .unwrap();
        let scope = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
        let entry = super::super::super::catalog()
            .catalog
            .iter()
            .find(|e| e.service_id == wire::BUILTIN_MODEL_SERVICE_ID)
            .unwrap();
        prepare_kimi_default(&mut db, &scope, 100).unwrap();
        let first = lookup(&db, &scope, entry).unwrap().unwrap();
        assert!(!first.desired_enabled && !first.effective_enabled);
        assert!(first.credential_ref.is_none());
        prepare_kimi_default(&mut db, &scope, 101).unwrap();
        assert_eq!(lookup(&db, &scope, entry).unwrap().unwrap(), first);
        let key = wire::InstallationOperationPayload {
            installation_id: first.installation_id.clone(),
            operation_id: Uuid::now_v7().to_string(),
            expected_revision: first.revision,
        };
        local_change(
            &mut db,
            &scope,
            &super::super::super::catalog().catalog,
            &key,
            wire::OperationAction::Uninstall,
            &key,
            102,
        )
        .unwrap();
        prepare_kimi_default(&mut db, &scope, 103).unwrap();
        assert_eq!(
            lookup(&db, &scope, entry).unwrap().unwrap().status,
            wire::InstallationStatus::Removed
        );
    }
}
