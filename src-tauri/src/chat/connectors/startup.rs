//! Restore globally enabled connections through the existing provider probe.
//! Conversation selection remains empty and independent in the renderer.
//! The two one-time repair intents undo the prior startup-disable regression;
//! their ordinary durable receipts preserve every later explicit Disable.
use super::*;
use crate::chat::authorization::ChatAuthorizationManager;

#[derive(Default)]
pub(crate) struct StartupState {
    actions: Option<Vec<wire::SetEnabledPayload>>,
    next: usize,
    done: bool,
}

fn repair_operation(service: &str) -> Option<&'static str> {
    // Scope-bound ordinary operation IDs, allocated for the user's 2026-11-01
    // correction. No fabricated result or separate preference store is used.
    match service {
        "shopify" => Some("2fb22072-04bb-49e5-80cf-14875909aa92"),
        "kimi-web" => Some("3f6bbad3-21e3-4c10-9507-8abb2623bdf2"),
        _ => None,
    }
}

pub(super) fn actions(
    db: &rusqlite::Connection,
    scope: &ChatScope,
    items: Vec<wire::Installation>,
) -> Result<Vec<wire::SetEnabledPayload>, Error> {
    let mut actions = Vec::new();
    for item in items {
        if item.status != wire::InstallationStatus::Installed || item.active_operation.is_some() {
            continue;
        }
        let ready_to_probe = item.service_id == wire::BUILTIN_MODEL_SERVICE_ID
            || (item.configuration_status == wire::ConfigurationStatus::Configured
                && matches!(
                    item.authorization_status,
                    wire::AuthorizationStatus::Authorized | wire::AuthorizationStatus::NotRequired
                ));
        if !ready_to_probe {
            continue;
        }
        let operation_id = if item.desired_enabled {
            Uuid::now_v7().to_string()
        } else if let Some(id) = repair_operation(&item.service_id) {
            match store::operation(db, scope, id) {
                Ok(_) => continue,
                Err(Error::NotFound) => id.to_owned(),
                Err(error) => return Err(error),
            }
        } else {
            continue;
        };
        actions.push(wire::SetEnabledPayload {
            installation_id: item.installation_id,
            expected_revision: item.revision,
            desired_enabled: true,
            operation_id,
        });
    }
    Ok(actions)
}

pub(super) async fn initialize(
    runtime: &ChatRuntime,
    authorization: ChatAuthorizationManager,
    context: Uuid,
    scope: ChatScope,
) -> Result<(), Error> {
    // A read-only context may inspect existing facts, never issue management.
    if authorization
        .with_connector_context(context, &scope, "connector.manage", now()?, |_| ())
        .is_err()
    {
        return Ok(());
    }
    let mut startup = runtime.connector_startup.lock().await;
    if startup.done {
        return Ok(());
    }
    if startup.actions.is_none() {
        let db = runtime
            .database()
            .await
            .map_err(|_| Error::TemporarilyUnavailable)?;
        let query_scope = scope.clone();
        let auth = authorization.clone();
        let initial = db
            .call(move |repo| {
                Ok(auth
                    .with_connector_context(
                        context,
                        &query_scope,
                        "connector.manage",
                        now().map_err(|_| crate::chat::ChatError::DatabaseUnavailable)?,
                        |_| {
                            if crate::chat::models::enabled() {
                                store::prepare_kimi_default(
                                    &mut repo.connection,
                                    &query_scope,
                                    now().unwrap_or(-1),
                                )?;
                            }
                            actions(
                                &repo.connection,
                                &query_scope,
                                store::list(&repo.connection, &query_scope, &catalog().catalog)?,
                            )
                        },
                    )
                    .map_err(auth_error)
                    .and_then(|v| v))
            })
            .await
            .map_err(|_| Error::TemporarilyUnavailable)??;
        startup.actions = Some(initial);
    }
    while let Some(payload) = startup
        .actions
        .as_ref()
        .and_then(|items| items.get(startup.next))
        .cloned()
    {
        // Keep the same operation identity across a pending response, context
        // renewal or retry. handle() reads an existing operation without resending.
        let service = catalog()
            .catalog
            .iter()
            .find(|entry| {
                repair_operation(&entry.service_id) == Some(payload.operation_id.as_str())
            })
            .map(|entry| entry.service_id.as_str())
            .unwrap_or("saved-connection");
        let outcome = async {
            let value = execute_action(
                runtime,
                authorization.clone(),
                context,
                scope.clone(),
                Action::SetEnabled(payload.clone()),
            )
            .await?;
            let result: wire::MutationResult =
                serde_json::from_value(value).map_err(|_| Error::OutcomeUnknown)?;
            let mut operation = result.operation;
            for _ in 0..25 {
                if !matches!(
                    operation.status,
                    wire::OperationStatus::Pending | wire::OperationStatus::Unknown
                ) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                let value = execute_action(
                    runtime,
                    authorization.clone(),
                    context,
                    scope.clone(),
                    Action::Operation(wire::OperationReadPayload {
                        operation_id: payload.operation_id.clone(),
                    }),
                )
                .await?;
                operation = serde_json::from_value(value).map_err(|_| Error::OutcomeUnknown)?;
            }
            if operation.status != wire::OperationStatus::Succeeded {
                return Err(operation.error_code.unwrap_or(Error::OperationPending));
            }
            Ok::<(), Error>(())
        }
        .await;
        if let Err(error) = outcome {
            // A single provider must not hide the other installations. Its
            // exact pending/failed receipt remains visible for normal recovery;
            // no automatic auth/configuration or repeated Enable is issued.
            if matches!(error, Error::ContextInvalid | Error::PermissionDenied) {
                return Err(error);
            }
            eprintln!("Connector startup observation: service={service} error={error:?}");
        }
        startup.next += 1;
    }
    startup.done = true;
    let query_scope = scope.clone();
    let items = runtime
        .database()
        .await
        .map_err(|_| Error::TemporarilyUnavailable)?
        .call(move |repo| {
            Ok(store::list(
                &repo.connection,
                &query_scope,
                &catalog().catalog,
            ))
        })
        .await
        .map_err(|_| Error::TemporarilyUnavailable)??;
    eprintln!(
        "Connector startup ready: installed={}, desired_enabled={}, pending={}, enable_checks={}",
        items.len(),
        items.iter().filter(|item| item.desired_enabled).count(),
        items
            .iter()
            .filter(|item| item.active_operation.is_some())
            .count(),
        startup.next
    );
    Ok(())
}
