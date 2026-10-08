use super::*;
use rusqlite::Connection;

fn database() -> Connection {
    let mut db = Connection::open_in_memory().unwrap();
    db.pragma_update(None, "foreign_keys", true).unwrap();
    crate::chat::migrations::migrate_to_target(
        &mut db,
        crate::chat::migrations::MARKET_CONNECTORS_SCHEMA_VERSION,
    )
    .unwrap();
    db
}
fn scope() -> ChatScope {
    ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap()
}
fn install_request(service: &str) -> wire::InstallPayload {
    wire::InstallPayload {
        service_id: service.to_owned(),
        operation_id: Uuid::now_v7().to_string(),
        expected_revision: 0,
    }
}
#[test]
fn feat157_catalog_preserves_49_distinct_non_secret_services() {
    let product = catalog();
    assert_eq!(product.catalog_revision, 5);
    assert_eq!(product.catalog.len(), 49);
    assert_eq!(
        product
            .catalog
            .iter()
            .map(|e| &e.service_id)
            .collect::<HashSet<_>>()
            .len(),
        49
    );
    assert_eq!(
        product
            .catalog
            .iter()
            .filter(|e| e.transport == wire::Transport::Http)
            .count(),
        49
    );
    assert!(product.catalog.iter().all(
        |e| e.service_id == e.icon_asset_id && e.availability != wire::Availability::Available
    ));
}
#[test]
fn feat157_retired_service_installation_is_hidden_without_erasing_history() {
    for retired_id in ["taobao-flash-sale-retail", "doukou-doctor"] {
        let mut db = database();
        let owner = scope();
        let mut retired = catalog().catalog[0].clone();
        retired.service_id = retired_id.into();
        retired.server_name = retired.service_id.clone();
        retired.icon_asset_id = retired.service_id.clone();
        let old = store::install(
            &mut db,
            &owner,
            &retired,
            1,
            install_request(&retired.service_id),
            100,
        )
        .unwrap();
        let current = &catalog().catalog[0];
        store::install(
            &mut db,
            &owner,
            current,
            catalog().catalog_revision,
            install_request(&current.service_id),
            101,
        )
        .unwrap();
        let entries = store::list(&db, &owner, &catalog().catalog).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].service_id, current.service_id);
        assert!(!supports_provider(&retired.service_id));
        assert!(
            catalog()
                .catalog
                .iter()
                .all(|entry| entry.service_id != retired.service_id)
        );
        // Ordinary retained data is still present; catalogue retirement is not a
        // destructive migration or a rewrite of a historical receipt.
        assert_eq!(
            store::lookup(&db, &owner, &retired)
                .unwrap()
                .unwrap()
                .installation_id,
            old.installation.installation_id
        );
    }
}
#[test]
fn feat157_install_receipt_is_atomic_scoped_and_survives_replay() {
    let mut db = database();
    let owner = scope();
    let other = scope();
    let entry = &catalog().catalog[0];
    let request = install_request(&entry.service_id);
    let first = store::install(&mut db, &owner, entry, 1, request.clone(), 100).unwrap();
    assert!(!first.installation.desired_enabled);
    assert!(!first.installation.effective_enabled);
    assert!(first.installation.credential_ref.is_none());
    let again = store::install(&mut db, &owner, entry, 1, request, 101).unwrap();
    assert_eq!(encode(&first).unwrap(), encode(&again).unwrap());
    assert!(
        store::list(&db, &other, &catalog().catalog)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        store::operation(&db, &other, &first.operation.operation_id).unwrap_err(),
        Error::NotFound
    );
    assert_eq!(
        store::list(&db, &owner, &catalog().catalog).unwrap().len(),
        1
    );
}
#[test]
fn feat157_uninstall_reinstall_fences_old_generation_without_erasing_receipts() {
    let mut db = database();
    let owner = scope();
    let entry = &catalog().catalog[0];
    let install = store::install(
        &mut db,
        &owner,
        entry,
        1,
        install_request(&entry.service_id),
        100,
    )
    .unwrap();
    let remove = wire::UninstallPayload {
        installation_id: install.installation.installation_id.clone(),
        operation_id: Uuid::now_v7().to_string(),
        expected_revision: 1,
        confirmed: true,
    };
    let removed = store::local_change(
        &mut db,
        &owner,
        &catalog().catalog,
        &wire::InstallationOperationPayload {
            installation_id: remove.installation_id.clone(),
            operation_id: remove.operation_id.clone(),
            expected_revision: remove.expected_revision,
        },
        wire::OperationAction::Uninstall,
        &remove,
        101,
    )
    .unwrap();
    assert_eq!(
        removed.installation.status,
        wire::InstallationStatus::Removed
    );
    assert!(
        store::list(&db, &owner, &catalog().catalog)
            .unwrap()
            .is_empty()
    );
    let renewed = store::install(
        &mut db,
        &owner,
        entry,
        1,
        install_request(&entry.service_id),
        102,
    )
    .unwrap();
    assert_eq!(
        renewed.installation.installation_id,
        install.installation.installation_id
    );
    assert!(renewed.installation.generation > install.installation.generation);
    assert_eq!(
        store::operation(&db, &owner, &install.operation.operation_id)
            .unwrap()
            .installation
            .generation,
        1
    );
}
#[test]
fn feat157_unconfigured_enable_never_claims_ready() {
    let mut db = database();
    let owner = scope();
    let entry = &catalog().catalog[0];
    let installed = store::install(
        &mut db,
        &owner,
        entry,
        1,
        install_request(&entry.service_id),
        100,
    )
    .unwrap();
    let payload = wire::SetEnabledPayload {
        installation_id: installed.installation.installation_id,
        operation_id: Uuid::now_v7().to_string(),
        expected_revision: 1,
        desired_enabled: true,
    };
    let result = store::local_change(
        &mut db,
        &owner,
        &catalog().catalog,
        &wire::InstallationOperationPayload {
            installation_id: payload.installation_id.clone(),
            operation_id: payload.operation_id.clone(),
            expected_revision: payload.expected_revision,
        },
        wire::OperationAction::Enable,
        &payload,
        101,
    )
    .unwrap();
    assert_eq!(result.operation.status, wire::OperationStatus::Failed);
    assert_eq!(result.operation.error_code, Some(Error::NotConfigured));
    assert!(!result.installation.effective_enabled);
    assert!(!result.installation.desired_enabled);
}
#[test]
fn feat157_same_operation_different_normal_intent_conflicts() {
    let mut db = database();
    let owner = scope();
    let first = install_request(&catalog().catalog[0].service_id);
    store::install(
        &mut db,
        &owner,
        &catalog().catalog[0],
        1,
        first.clone(),
        100,
    )
    .unwrap();
    let mut next_request = first;
    next_request.service_id = catalog().catalog[1].service_id.clone();
    assert_eq!(
        store::install(&mut db, &owner, &catalog().catalog[1], 1, next_request, 101).unwrap_err(),
        Error::RequestConflict
    );
}

#[test]
fn feat157_connector_permission_lease_fences_context_and_keeps_read_only_scope() {
    let owner = scope();
    let manager = crate::chat::ChatAuthorizationManager::new(&owner).unwrap();
    let projection = crate::chat::AuthoritativeChatProjection::from_trusted_native_projection(
        owner.tenant_uuid().unwrap(),
        1,
        500,
        vec!["connector.read".into()],
    )
    .unwrap();
    let context = manager.bind(projection, 100).unwrap();
    assert!(
        manager
            .with_connector_context(context.context_id, &owner, "connector.read", 101, |_| ())
            .is_ok()
    );
    assert!(
        manager
            .with_connector_context(context.context_id, &owner, "connector.manage", 101, |_| ())
            .is_err()
    );
    let replacement = manager
        .bind(
            crate::chat::AuthoritativeChatProjection::from_trusted_native_projection(
                owner.tenant_uuid().unwrap(),
                1,
                501,
                vec!["connector.read".into()],
            )
            .unwrap(),
            101,
        )
        .unwrap();
    assert!(
        manager
            .with_connector_context(context.context_id, &owner, "connector.read", 102, |_| ())
            .is_err()
    );
    assert!(
        manager
            .with_connector_context(
                replacement.context_id,
                &owner,
                "connector.read",
                102,
                |_| ()
            )
            .is_ok()
    );
}

#[test]
fn feat157_snapshot_and_mutation_follow_the_generated_wire_contract() {
    let mut db = database();
    let owner = scope();
    let capabilities = wire::CONNECTOR_CAPABILITIES
        .map(str::to_owned)
        .into_iter()
        .collect();
    let data = apply(&mut db, &owner, Action::Snapshot, &capabilities, 100).unwrap();
    let response =
        serde_json::json!({"schemaVersion":1,"requestId":Uuid::now_v7().to_string(),"data":data});
    let validated: wire::SnapshotResponse = serde_json::from_value(response).unwrap();
    assert_eq!(validated.data.catalog.len(), 49);
    assert!(!validated.data.execution_available);
    let installed = apply(
        &mut db,
        &owner,
        Action::Install(install_request("cue")),
        &capabilities,
        101,
    )
    .unwrap();
    let response = serde_json::json!({"schemaVersion":1,"requestId":Uuid::now_v7().to_string(),"data":installed});
    let validated: wire::MutationResponse = serde_json::from_value(response).unwrap();
    assert_eq!(
        validated.data.operation.status,
        wire::OperationStatus::Succeeded
    );
}

#[test]
fn feat157_sql30_expands_sql29_preserving_existing_rows_and_ledger() {
    let mut db = Connection::open_in_memory().unwrap();
    db.pragma_update(None, "foreign_keys", true).unwrap();
    crate::chat::migrations::migrate_to_target(&mut db, 29).unwrap();
    db.execute("INSERT INTO chat_projects(id,owner_user_id,tenant_id,safe_name,canonical_hash,bookmark_ref,last_used_at) VALUES(?1,?2,?3,'既有普通项目',?4,?5,100)",
        rusqlite::params![Uuid::now_v7().to_string(),Uuid::now_v7().to_string(),Uuid::now_v7().to_string(),"a".repeat(64),b"ordinary-bookmark".to_vec()]).unwrap();
    let project_before: (String, String, Vec<u8>, i64) = db
        .query_row(
            "SELECT id,safe_name,bookmark_ref,last_used_at FROM chat_projects",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    let before: Vec<(String, String)> = {
        let mut q = db
            .prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        q.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    };
    crate::chat::migrations::migrate_to_target(&mut db, 30).unwrap();
    for (name, original) in before {
        let current: String = db
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
                [&name],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(original, current);
    }
    let project_after: (String, String, Vec<u8>, i64) = db
        .query_row(
            "SELECT id,safe_name,bookmark_ref,last_used_at FROM chat_projects",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(project_before, project_after);
    crate::chat::migrations::validate_reader(&db).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        30
    );
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM chat_connector_installations",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn feat157_authorization_adapter_availability_does_not_claim_execution_readiness() {
    let disabled = projected_catalog(false);
    assert!(
        disabled
            .iter()
            .all(|entry| entry.authorization_available == Some(false))
    );
    let enabled = projected_catalog(true);
    assert_eq!(
        enabled
            .iter()
            .filter(|entry| entry.availability == wire::Availability::Available)
            .count(),
        49
    );
    assert_eq!(
        enabled
            .iter()
            .filter(|entry| entry.authorization_available == Some(true))
            .count(),
        45
    );
    for entry in enabled {
        assert_eq!(
            entry.authorization_available,
            Some(entry.auth_mode == wire::AuthMode::Oauth)
        );
        if supports_provider(&entry.service_id) {
            assert_eq!(entry.availability, wire::Availability::Available);
            assert!(
                !entry
                    .blocker_codes
                    .contains(&Error::ProviderOnboardingRequired)
            );
        } else {
            assert_eq!(
                entry.availability,
                catalog()
                    .catalog
                    .iter()
                    .find(|original| original.service_id == entry.service_id)
                    .unwrap()
                    .availability
            );
            assert_ne!(entry.availability, wire::Availability::Available);
        }
    }
}
