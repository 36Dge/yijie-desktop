//! Native-owned default intent for the one built-in model-backed connector.
//! The caller holds management admission and current credential permission.
use super::*;

pub(in crate::chat::connectors) fn prepare_kimi_default(
    db: &mut Connection,
    scope: &ChatScope,
    host: &str,
    authority: &super::super::broker_generated::ScopeBinding,
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
    let mut item = match lookup(db, scope, entry)? {
        Some(item) => item,
        None => {
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
            )?
            .installation
        }
    };
    if item.status != wire::InstallationStatus::Installed {
        return Ok(());
    }

    // A retired local preparation can no longer register into the current Host.
    // Do not revive its original operation or touch an auth/removal operation.
    if let Some(active) = &item.active_operation {
        if let Some(mut op) = provider_operation(db, scope, &active.operation_id)? {
            if op.kind == "probe"
                && op.payload.binding.reference.revision == item.revision
                && op.payload.binding.reference.generation == item.generation
                && (op.payload.host_instance_id != host
                    || op.payload.scope.native_process_epoch != authority.native_process_epoch)
            {
                op.result.operation.status = wire::OperationStatus::Cancelled;
                op.result.operation.cancellable = false;
                op.result.operation.error_code = None;
                op.result.operation.revision = next(op.result.operation.revision)?;
                op.result.installation.active_operation = None;
                op.result.installation.effective_enabled = false;
                op.result.installation.connection_status = wire::ConnectionStatus::Disconnected;
                op.result.installation.error_code = None;
                let tx = sql(db.transaction())?;
                sql(tx.execute("UPDATE chat_connector_operations SET response_json=?1 WHERE owner_user_id=?2 AND tenant_id=?3 AND operation_id=?4", params![encode(&op.result)?, scope.owner_user_id, scope.tenant_id, active.operation_id]))?;
                sql(tx.execute("UPDATE chat_connector_provider_operations SET observation_json=NULL,updated_at=?1 WHERE owner_user_id=?2 AND tenant_id=?3 AND operation_id=?4", params![now, scope.owner_user_id, scope.tenant_id, active.operation_id]))?;
                sql(tx.commit())?;
                item = lookup(db, scope, entry)?.ok_or(Error::NotFound)?;
            }
        }
    }
    if item.desired_enabled || item.active_operation.is_some() {
        return Ok(());
    }
    let choice: Option<String> = sql(db.query_row(
        "SELECT json_extract(response_json,'$.operation.action') FROM chat_connector_operations WHERE owner_user_id=?1 AND tenant_id=?2 AND installation_id=?3 AND json_extract(response_json,'$.installation.generation')=?4 AND json_extract(response_json,'$.operation.action') IN ('enable','disable','uninstall') ORDER BY created_at DESC,rowid DESC LIMIT 1",
        params![scope.owner_user_id, scope.tenant_id, item.installation_id, item.generation], |r| r.get(0)).optional())?;
    if matches!(choice.as_deref(), Some("disable" | "uninstall")) {
        return Ok(());
    }
    // Product default intent is not a successful Enable receipt or readiness.
    sql(db.execute("UPDATE chat_connector_installations SET desired_enabled=1,revision=?1,updated_at=?2 WHERE owner_user_id=?3 AND tenant_id=?4 AND installation_id=?5 AND revision=?6 AND installed=1", params![next(item.revision)?, now, scope.owner_user_id, scope.tenant_id, item.installation_id, item.revision]))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (
        Connection,
        ChatScope,
        super::super::super::broker_generated::ScopeBinding,
    ) {
        let mut db = Connection::open_in_memory().unwrap();
        crate::chat::migrations::migrate_to_target(
            &mut db,
            crate::chat::migrations::CONNECTOR_SUSPEND_SCHEMA_VERSION,
        )
        .unwrap();
        let scope = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
        let authority = super::super::super::broker_generated::ScopeBinding {
            owner_user_id: scope.owner_user_id.clone(),
            tenant_id: scope.tenant_id.clone(),
            native_process_epoch: Uuid::now_v7().to_string(),
            authorization_revision: 1,
            authorization_expires_at_unix_ms: 9999999999999,
        };
        (db, scope, authority)
    }
    fn item(db: &Connection, scope: &ChatScope) -> wire::Installation {
        lookup(
            db,
            scope,
            super::super::super::catalog()
                .catalog
                .iter()
                .find(|e| e.service_id == wire::BUILTIN_MODEL_SERVICE_ID)
                .unwrap(),
        )
        .unwrap()
        .unwrap()
    }
    #[test]
    fn kimi_default_installs_once_and_preserves_explicit_disable_and_uninstall() {
        let (mut db, scope, authority) = setup();
        let host = Uuid::now_v7().to_string();
        prepare_kimi_default(&mut db, &scope, &host, &authority, 100).unwrap();
        let first = item(&db, &scope);
        assert!(first.desired_enabled && !first.effective_enabled);
        assert!(first.credential_ref.is_none());
        prepare_kimi_default(&mut db, &scope, &host, &authority, 101).unwrap();
        assert_eq!(item(&db, &scope), first);
        assert_eq!(
            list(&db, &scope, &super::super::super::catalog().catalog)
                .unwrap()
                .len(),
            1
        );
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
            wire::OperationAction::Disable,
            &key,
            102,
        )
        .unwrap();
        prepare_kimi_default(
            &mut db,
            &scope,
            &Uuid::now_v7().to_string(),
            &authority,
            103,
        )
        .unwrap();
        let disabled = item(&db, &scope);
        assert!(!disabled.desired_enabled);
        let key = wire::InstallationOperationPayload {
            installation_id: disabled.installation_id.clone(),
            operation_id: Uuid::now_v7().to_string(),
            expected_revision: disabled.revision,
        };
        local_change(
            &mut db,
            &scope,
            &super::super::super::catalog().catalog,
            &key,
            wire::OperationAction::Uninstall,
            &key,
            104,
        )
        .unwrap();
        prepare_kimi_default(&mut db, &scope, &host, &authority, 105).unwrap();
        assert_eq!(item(&db, &scope).status, wire::InstallationStatus::Removed);
    }
    #[test]
    fn kimi_default_upgrades_previous_installation_without_replacing_identity() {
        let (mut db, scope, authority) = setup();
        let entry = super::super::super::catalog()
            .catalog
            .iter()
            .find(|e| e.service_id == wire::BUILTIN_MODEL_SERVICE_ID)
            .unwrap();
        let original = install(
            &mut db,
            &scope,
            entry,
            10,
            wire::InstallPayload {
                service_id: entry.service_id.clone(),
                operation_id: Uuid::now_v7().to_string(),
                expected_revision: 0,
            },
            100,
        )
        .unwrap()
        .installation;
        assert!(!original.desired_enabled);
        prepare_kimi_default(
            &mut db,
            &scope,
            &Uuid::now_v7().to_string(),
            &authority,
            101,
        )
        .unwrap();
        let next = item(&db, &scope);
        assert_eq!(next.installation_id, original.installation_id);
        assert_eq!(next.generation, original.generation);
        assert!(next.desired_enabled && !next.effective_enabled);
    }
    #[test]
    fn kimi_default_keeps_current_prepare_but_retires_old_host_local_prepare() {
        let (mut db, scope, authority) = setup();
        let host = Uuid::now_v7().to_string();
        prepare_kimi_default(&mut db, &scope, &host, &authority, 100).unwrap();
        let initial = item(&db, &scope);
        let key = wire::InstallationOperationPayload {
            installation_id: initial.installation_id.clone(),
            operation_id: Uuid::now_v7().to_string(),
            expected_revision: initial.revision,
        };
        let op = prepare_provider(
            &mut db,
            &scope,
            &super::super::super::catalog().catalog,
            ProviderIntent {
                key: &key,
                expected_generation: Some(initial.generation),
                action: wire::OperationAction::Enable,
                intent: &serde_json::to_value(&key).unwrap(),
                host: &host,
                authority: authority.clone(),
                now: 101,
            },
        )
        .unwrap();
        prepare_kimi_default(&mut db, &scope, &host, &authority, 102).unwrap();
        assert!(item(&db, &scope).active_operation.is_some());
        prepare_kimi_default(
            &mut db,
            &scope,
            &Uuid::now_v7().to_string(),
            &authority,
            103,
        )
        .unwrap();
        let restored = item(&db, &scope);
        assert!(
            restored.desired_enabled
                && restored.active_operation.is_none()
                && !restored.effective_enabled
        );
        assert_eq!(
            provider_operation(&db, &scope, &op.payload.operation_id)
                .unwrap()
                .unwrap()
                .result
                .operation
                .status,
            wire::OperationStatus::Cancelled
        );
    }
}
