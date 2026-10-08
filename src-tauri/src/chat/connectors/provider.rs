//! Native provider management uses the private Host owner pipe. Only fixed,
//! checked authorization URLs reach the OS browser; none reach IPC or SQLite.
use super::{
    Action, Error, auth_error, catalog, encode, generated as ui, host_generated as host, now, store,
};
use crate::chat::{ChatRuntime, authorization::ChatAuthorizationManager, database::ChatScope};
use serde_json::Value;
use uuid::Uuid;

fn control_failure(error: &super::control::ControlError) -> (Error, bool) {
    use super::control::ControlError as C;
    use host::ErrorCode as H;
    match error {
        C::Busy => (Error::OperationPending, false),
        C::InvalidRequest => (Error::InvalidRequest, true),
        C::Closed | C::OutcomeUnknown => (Error::OutcomeUnknown, false),
        C::Rejected(error) => match error.code {
            H::InvalidRequest => (Error::InvalidRequest, true),
            H::NotReady => (Error::TemporarilyUnavailable, true),
            H::PermissionDenied => (Error::PermissionDenied, true),
            H::AuthorityMismatch | H::ScopeExpired | H::ContextInvalid => {
                (Error::ContextInvalid, true)
            }
            H::RevisionConflict | H::BindingMismatch => (Error::RevisionConflict, true),
            H::SelectionStale => (Error::SelectionStale, true),
            H::CapacityExceeded => (Error::OperationPending, true),
            H::UnknownService | H::UnsupportedAuth => (Error::UnsupportedCapability, true),
            H::NotQualified => (Error::ProviderOnboardingRequired, true),
            H::ExecutionUnavailable | H::PermissionModeUnavailable => {
                (Error::ExecutionUnavailable, true)
            }
            // Conflict may describe an already running original operation;
            // generic transport/provider errors cannot prove non-execution.
            H::RequestConflict => (Error::RequestConflict, false),
            H::NotFound => (Error::NotFound, false),
            H::AuthorizationRejected => (Error::AuthorizationCancelled, false),
            H::AuthorizationTimeout => (Error::AuthorizationRequired, false),
            H::CleanupPending => (Error::CleanupPending, false),
            H::Busy => (Error::OperationPending, false),
            H::TemporarilyUnavailable | H::KeyringUnavailable | H::MetadataUnavailable => {
                (Error::TemporarilyUnavailable, false)
            }
            _ => (Error::OutcomeUnknown, false),
        },
    }
}
fn log_control_failure(method: &str, error: &super::control::ControlError) {
    // method is selected below from fixed constants; Debug exposes only the
    // private control enum and, for a rejection, its generated safe code.
    eprintln!("FEAT-157 provider control method={method} error={error:?}");
}
fn terminal(op: &store::ProviderOperation) -> bool {
    !matches!(
        op.result.operation.status,
        ui::OperationStatus::Pending | ui::OperationStatus::Unknown
    )
}
fn browser_url(value: &str, service: &str) -> Result<url::Url, Error> {
    let url = url::Url::parse(value).map_err(|_| Error::OutcomeUnknown)?;
    if super::uses_credential_form(service)
        && (service != "google-calendar" || url.scheme() == "http")
    {
        let nonce = url
            .path()
            .strip_prefix("/credential/")
            .and_then(|s| Uuid::parse_str(s).ok())
            .filter(|id| !id.is_nil() && url.path() == format!("/credential/{id}"));
        if url.scheme() != "http"
            || url.host_str() != Some("127.0.0.1")
            || url.port().is_none_or(|port| port == 0)
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || nonce.is_none()
        {
            return Err(Error::OutcomeUnknown);
        }
        return Ok(url);
    }
    if url.scheme() != "https"
        || !super::supports_provider(service)
        || url.host_str().is_none_or(|h| {
            !h.contains('.')
                || h.parse::<std::net::IpAddr>().is_ok()
                || h.ends_with(".localhost")
                || h.ends_with(".local")
        })
        || (service == "tushareMcp"
            && (url.host_str() != Some("tushare.pro")
                || url.port().is_some()
                || url.path() != "/oauth/authorize"))
        || (service == "google-calendar"
            && (url.host_str() != Some("accounts.google.com")
                || url.port().is_some()
                || url.path() != "/o/oauth2/v2/auth"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::OutcomeUnknown);
    }
    let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    if (service == "tushareMcp"
        && (pairs.get("scope").map(String::as_str) != Some("mcp:tools")
            || pairs.get("resource").map(String::as_str) != Some("https://api.tushare.pro/mcp/")))
        || pairs.get("response_type").map(String::as_str) != Some("code")
        || pairs.get("code_challenge_method").map(String::as_str) != Some("S256")
    {
        return Err(Error::OutcomeUnknown);
    }
    let redirect = pairs
        .get("redirect_uri")
        .and_then(|s| url::Url::parse(s).ok())
        .ok_or(Error::OutcomeUnknown)?;
    if service == "google-calendar"
        && redirect.as_str() != "http://127.0.0.1:18757/oauth/callback/google-calendar"
    {
        return Err(Error::OutcomeUnknown);
    }
    if redirect.scheme() != "http"
        || redirect.host_str() != Some("127.0.0.1")
        || redirect.port().is_none()
        || !redirect.path().starts_with("/oauth/callback/")
        || redirect.query().is_some()
        || redirect.fragment().is_some()
    {
        return Err(Error::OutcomeUnknown);
    }
    Ok(url)
}

pub(super) async fn handle(
    runtime: &ChatRuntime,
    authorization: ChatAuthorizationManager,
    context: Uuid,
    scope: ChatScope,
    action: Action,
) -> Result<Option<Value>, Error> {
    if matches!(action, Action::Snapshot | Action::Selection(_)) {
        return observe(runtime, authorization, context, scope, action)
            .await
            .map(Some);
    }
    let key = match &action {
        Action::Authorize(p) | Action::Configure(p) => Some((
            p.installation_id.clone(),
            p.operation_id.clone(),
            p.expected_revision,
            Some(p.expected_generation),
            if matches!(&action, Action::Authorize(_)) {
                ui::OperationAction::Authorize
            } else {
                ui::OperationAction::Configure
            },
            encode(p)?,
        )),
        Action::SetEnabled(p) => Some((
            p.installation_id.clone(),
            p.operation_id.clone(),
            p.expected_revision,
            None,
            if p.desired_enabled {
                ui::OperationAction::Enable
            } else {
                ui::OperationAction::Disable
            },
            encode(p)?,
        )),
        Action::Uninstall(p) => Some((
            p.installation_id.clone(),
            p.operation_id.clone(),
            p.expected_revision,
            None,
            ui::OperationAction::Uninstall,
            encode(p)?,
        )),
        Action::Operation(_) | Action::Cancel(_) | Action::Reopen(_) => None,
        _ => return Ok(None),
    };
    let db = runtime
        .database()
        .await
        .map_err(|_| Error::TemporarilyUnavailable)?;
    let select_scope = scope.clone();
    let select_action = action.clone();
    let select_key = key.clone();
    let existing = db
        .call(move |repo| {
            Ok((|| -> Result<Option<Option<store::ProviderOperation>>,Error> { match select_key {
                Some((installation,op,_,_,action,intent))=>{
                    if let Some(existing)=store::provider_operation(&repo.connection,&select_scope,&op)? {
                        store::verify_provider_replay(&repo.connection,&select_scope,&op,action,&intent)?;
                        return Ok(Some(Some(existing)));
                    }
                    let item=store::find(&repo.connection,&select_scope,&catalog().catalog,&installation)?;
                    let cleanup=matches!(select_action,Action::SetEnabled(ref p) if !p.desired_enabled) || matches!(select_action,Action::Uninstall(_));
                    if (!super::supports_provider(&item.service_id) && !cleanup) || (cleanup && item.credential_ref.is_none()) {return Ok(None);}
                    Ok(Some(None))
                }
                None=>{
                    let op=match select_action{Action::Operation(p)=>p.operation_id,Action::Cancel(p)|Action::Reopen(p)=>p.operation_id,_=>unreachable!()};
                    Ok(store::provider_operation(&repo.connection,&select_scope,&op)?.map(Some))
                }
            }})())
        })
        .await
        .map_err(|_| Error::TemporarilyUnavailable)??;
    let Some(existing) = existing else {
        return Ok(None);
    };
    let _admission = authorization.market_admission_lock().await;
    // The first read only located the provider branch. Another normal
    // management request may have completed while this gate was queued.
    let existing = if let Some(operation_id) = existing
        .as_ref()
        .map(|previous| previous.payload.operation_id.clone())
        .or_else(|| key.as_ref().map(|key| key.1.clone()))
    {
        let refresh_scope = scope.clone();
        let refresh_key = key.clone();
        db.call(move |repo| {
            Ok((|| {
                let current =
                    store::provider_operation(&repo.connection, &refresh_scope, &operation_id)?;
                if current.is_some() {
                    if let Some((_, _, _, _, action, intent)) = refresh_key {
                        store::verify_provider_replay(
                            &repo.connection,
                            &refresh_scope,
                            &operation_id,
                            action,
                            &intent,
                        )?;
                    }
                }
                Ok(current)
            })())
        })
        .await
        .map_err(|_| Error::TemporarilyUnavailable)??
    } else {
        None
    };
    let required = match existing
        .as_ref()
        .map(|op| op.result.operation.action)
        .or_else(|| key.as_ref().map(|p| p.4))
    {
        Some(ui::OperationAction::Authorize | ui::OperationAction::Configure) => {
            "connector.credentials.manage"
        }
        _ => "connector.manage",
    };
    let required = if matches!(action, Action::Reopen(_)) {
        "connector.credentials.manage"
    } else if matches!(action, Action::Operation(_)) {
        "connector.read"
    } else {
        required
    };
    authorization
        .with_market_authority(context, &scope, &[required], now()?, |_| ())
        .map_err(auth_error)?;
    if let Some(ref op) = existing {
        if terminal(op) {
            if let Action::Cancel(ref cancel) | Action::Reopen(ref cancel) = action {
                if cancel.expected_revision != op.result.operation.revision {
                    return Err(Error::RevisionConflict);
                }
            }
            return Ok(Some(if key.is_some() {
                encode(&op.result)?
            } else {
                encode(&op.result.operation)?
            }));
        }
    }
    runtime
        .ensure_demo_fast_sidecar()
        .await
        .map_err(|_| Error::TemporarilyUnavailable)?;
    let bridge = runtime
        .local_host_bridge()
        .await
        .map_err(|_| Error::TemporarilyUnavailable)?;
    let control = bridge
        .market_control()
        .ok_or(Error::TemporarilyUnavailable)?;
    let host_id = bridge.instance_nonce().to_string();
    let authority = authorization
        .with_market_authority(context, &scope, &[required], now()?, |v| v)
        .map_err(auth_error)?;
    // Retire previous admission before changing a durable installation revision.
    // Reading/replaying an existing original operation does not revoke again.
    if existing.is_none() {
        let (installation, operation, revision, generation, kind, _) =
            key.clone().ok_or(Error::InvalidRequest)?;
        let check_scope = scope.clone();
        let check_installation = installation.clone();
        db.call(move |repo| {
            Ok(store::check_provider_change(
                &repo.connection,
                &check_scope,
                &catalog().catalog,
                &ui::InstallationOperationPayload {
                    installation_id: check_installation,
                    operation_id: operation,
                    expected_revision: revision,
                },
                generation,
                kind,
            )
            .map(|_| ()))
        })
        .await
        .map_err(|_| Error::TemporarilyUnavailable)??;
        let request_id = Uuid::now_v7().to_string();
        let request = host::RevokeAuthorityRequest {
            schema_version: 1,
            request_id: request_id.clone(),
            method: "revoke_authority".into(),
            payload: host::RevokeAuthorityPayload {
                operation_id: Uuid::now_v7().to_string(),
                host_instance_id: host_id.clone(),
                scope: authority.clone(),
                installation_id: Some(installation),
                reason: "installation_changed".into(),
            },
        };
        let revoked = control
            .request::<_, host::RevokeAuthorityResponse>(&request_id, &request)
            .await;
        if let Err(ref error) = revoked {
            log_control_failure("revoke_authority", error);
        }
        if !revoked.is_ok_and(|response| response.data.outcome == "admission_revoked") {
            control.close().await;
            return Err(Error::CleanupPending);
        }
    }
    let mut op = if let Some(op) = existing {
        op
    } else {
        let (installation, operation, revision, generation, kind, intent) =
            key.clone().ok_or(Error::InvalidRequest)?;
        let save_scope = scope.clone();
        let save_auth = authorization.clone();
        let host_id = host_id.clone();
        db.call(move |repo| {
            Ok(save_auth
                .with_market_authority(
                    context,
                    &save_scope,
                    &[required],
                    now().map_err(|_| crate::chat::error::ChatError::DatabaseUnavailable)?,
                    |authority| {
                        store::prepare_provider(
                            &mut repo.connection,
                            &save_scope,
                            &catalog().catalog,
                            store::ProviderIntent {
                                key: &ui::InstallationOperationPayload {
                                    installation_id: installation,
                                    operation_id: operation,
                                    expected_revision: revision,
                                },
                                expected_generation: generation,
                                action: kind,
                                intent: &intent,
                                host: &host_id,
                                authority,
                                now: now().unwrap_or(-1),
                            },
                        )
                    },
                )
                .map_err(auth_error)
                .and_then(|v| v))
        })
        .await
        .map_err(|_| Error::TemporarilyUnavailable)??
    };
    if op.payload.host_instance_id != host_id
        || op.payload.scope.native_process_epoch != authority.native_process_epoch
        || op.payload.scope.authorization_revision != authority.authorization_revision
    {
        return Err(Error::OutcomeUnknown);
    }
    if let Action::Cancel(ref cancel) | Action::Reopen(ref cancel) = action {
        if cancel.expected_revision != op.result.operation.revision {
            return Err(Error::RevisionConflict);
        }
    }
    op.payload.scope = authority;
    if matches!(action, Action::Reopen(_)) && op.kind != "auth" {
        return Err(Error::UnsupportedCapability);
    }
    let request_id = Uuid::now_v7().to_string();
    let method = if matches!(action, Action::Cancel(_)) {
        "provider_auth_cancel"
    } else if key.is_none() || !op.newly_created {
        "provider_auth_poll"
    } else {
        match op.kind.as_str() {
            "auth" => "provider_auth_begin",
            "probe" => "provider_probe",
            "forget" => "provider_forget",
            _ => return Err(Error::OutcomeUnknown),
        }
    };
    macro_rules! exchange {
        ($request:ident,$response:ident) => {{
            let request = host::$request {
                schema_version: 1,
                request_id: request_id.clone(),
                method: method.into(),
                payload: op.payload.clone(),
            };
            request.validate().map_err(|_| Error::InvalidRequest)?;
            control
                .request::<_, host::$response>(&request_id, &request)
                .await
                .map(|r| r.data)
        }};
    }
    let observed = match method {
        "provider_auth_begin" => exchange!(AuthBeginRequest, AuthBeginResponse),
        "provider_auth_poll" => exchange!(AuthPollRequest, AuthPollResponse),
        "provider_auth_cancel" => exchange!(AuthCancelRequest, AuthCancelResponse),
        "provider_forget" => exchange!(ForgetRequest, ForgetResponse),
        "provider_probe" => exchange!(ProbeRequest, ProbeResponse),
        _ => unreachable!(),
    };
    let observed = match observed {
        Ok(observed) => observed,
        Err(error) => {
            log_control_failure(method, &error);
            let (code, definitive) = control_failure(&error);
            if matches!(error, super::control::ControlError::Busy) {
                return Err(code);
            }
            let save_scope = scope.clone();
            let save_auth = authorization.clone();
            let operation = op.payload.operation_id.clone();
            let newly_created = op.newly_created;
            let definitive =
                definitive && matches!(method, "provider_auth_begin" | "provider_probe");
            let saved = db
                .call(move |repo| {
                    Ok(save_auth
                        .with_market_authority(
                            context,
                            &save_scope,
                            &[required],
                            now()
                                .map_err(|_| crate::chat::error::ChatError::DatabaseUnavailable)?,
                            |_| {
                                store::provider_control_failure(
                                    &mut repo.connection,
                                    &save_scope,
                                    &operation,
                                    code,
                                    definitive,
                                    newly_created,
                                )
                            },
                        )
                        .map_err(auth_error)
                        .and_then(|v| v))
                })
                .await
                .map_err(|_| Error::TemporarilyUnavailable)??;
            return Ok(Some(if key.is_some() {
                encode(&saved.result)?
            } else {
                encode(&saved.result.operation)?
            }));
        }
    };
    observed.validate().map_err(|_| Error::OutcomeUnknown)?;
    if observed.operation_state == super::provider_generated::OperationState::Failed {
        eprintln!(
            "FEAT-157 provider status authorization={:?} connection={:?} error={:?}",
            observed.authorization_status, observed.connection_status, observed.error_code
        );
    }
    authorization
        .with_market_authority(context, &scope, &[required], now()?, |_| ())
        .map_err(auth_error)?;
    let authorization_url = observed.authorization_url.clone();
    let awaiting_user =
        observed.operation_state == super::provider_generated::OperationState::AwaitingUser;
    let save_scope = scope.clone();
    let save_auth = authorization.clone();
    let expected = op.clone();
    let saved = db
        .call(move |repo| {
            Ok(save_auth
                .with_market_authority(
                    context,
                    &save_scope,
                    &[required],
                    now().map_err(|_| crate::chat::error::ChatError::DatabaseUnavailable)?,
                    |_| {
                        store::finish_provider(
                            &mut repo.connection,
                            &save_scope,
                            &expected,
                            observed,
                            now().unwrap_or(-1),
                        )
                    },
                )
                .map_err(auth_error)
                .and_then(|v| v))
        })
        .await
        .map_err(|_| Error::TemporarilyUnavailable)??;
    let explicit_reopen = matches!(action, Action::Reopen(_));
    let can_open_browser = authorization
        .with_market_authority(
            context,
            &scope,
            &["connector.credentials.manage"],
            now()?,
            |_| (),
        )
        .is_ok();
    if explicit_reopen && !terminal(&saved) && (!awaiting_user || authorization_url.is_none()) {
        return Err(Error::OperationPending);
    }
    if let Some(url) = authorization_url.filter(|_| {
        browser_open_allowed(
            &saved.kind,
            awaiting_user,
            saved.browser_opened,
            explicit_reopen,
            can_open_browser,
        )
    }) {
        let url = browser_url(&url, &saved.result.installation.service_id)?;
        let browser_scope = scope.clone();
        let operation = saved.payload.operation_id.clone();
        let browser_auth = authorization.clone();
        let open = db
            .call(move |repo| {
                Ok(browser_auth
                    .with_market_authority(
                        context,
                        &browser_scope,
                        &["connector.credentials.manage"],
                        now().map_err(|_| crate::chat::error::ChatError::DatabaseUnavailable)?,
                        |_| {
                            store::reserve_provider_browser(
                                &repo.connection,
                                &browser_scope,
                                &operation,
                            )
                            .map(|first| first || explicit_reopen)
                        },
                    )
                    .map_err(auth_error)
                    .and_then(|v| v))
            })
            .await
            .map_err(|_| Error::TemporarilyUnavailable)??;
        if open {
            tokio::task::spawn_blocking(move || webbrowser::open(url.as_str()))
                .await
                .map_err(|_| Error::TemporarilyUnavailable)?
                .map_err(|_| Error::TemporarilyUnavailable)?;
        }
    }
    Ok(Some(if key.is_some() {
        encode(&saved.result)?
    } else {
        encode(&saved.result.operation)?
    }))
}

fn browser_open_allowed(
    kind: &str,
    awaiting_user: bool,
    opened: bool,
    explicit: bool,
    can_manage_credentials: bool,
) -> bool {
    kind == "auth" && awaiting_user && can_manage_credentials && (!opened || explicit)
}

async fn observe(
    runtime: &ChatRuntime,
    authorization: ChatAuthorizationManager,
    context: Uuid,
    scope: ChatScope,
    action: Action,
) -> Result<Value, Error> {
    let _gate = authorization.market_admission_lock().await;
    let permission = action.permission();
    let authority = authorization
        .with_market_authority(context, &scope, &[permission], now()?, |v| v)
        .map_err(auth_error)?;
    let db = runtime
        .database()
        .await
        .map_err(|_| Error::TemporarilyUnavailable)?;
    let selection = if let Action::Selection(payload) = &action {
        payload.selection.clone()
    } else {
        let query_scope = scope.clone();
        db.call(move |repo| {
            Ok(
                store::list(&repo.connection, &query_scope, &catalog().catalog).map(|items| {
                    items
                        .into_iter()
                        .filter(|item| {
                            super::supports_provider(&item.service_id)
                                && item.desired_enabled
                                && item.credential_ref.is_some()
                        })
                        .map(|item| ui::SelectionRef {
                            installation_id: item.installation_id,
                            revision: item.revision,
                            generation: item.generation,
                        })
                        .collect::<Vec<_>>()
                }),
            )
        })
        .await
        .map_err(|_| Error::TemporarilyUnavailable)??
    };
    // Snapshot is always a read: do not ensure/start Host or a model merely to
    // display installed intent. A missing or expired owner projects inactive.
    let admission = if selection.is_empty() {
        None
    } else {
        match runtime.local_host_bridge().await {
            Ok(host) => {
                match read_admission(&db, &host, &scope, authority.clone(), &selection).await {
                    Ok(admission) => Some(admission),
                    Err(_) if matches!(action, Action::Snapshot) => None,
                    Err(error) => return Err(error),
                }
            }
            Err(_) => None,
        }
    };
    db.call(move |repo| {
        Ok(authorization
            .with_connector_context(
                context,
                &scope,
                permission,
                now().map_err(|_| crate::chat::error::ChatError::DatabaseUnavailable)?,
                |caps| {
                    super::apply_observation(
                        &mut repo.connection,
                        &scope,
                        action,
                        caps,
                        now().unwrap_or(-1),
                        admission.as_ref(),
                    )
                },
            )
            .map_err(auth_error)
            .and_then(|v| v))
    })
    .await
    .map_err(|_| Error::TemporarilyUnavailable)?
}

/// Recheck current installation facts in the caller's original SQL transaction.
/// A prior SQL observation cannot construct this admission evidence.
pub(crate) fn preflight(
    db: &rusqlite::Connection,
    scope: &ChatScope,
    selection: &[ui::SelectionRef],
    admission: &ProviderAdmission,
) -> Result<(), Error> {
    if admission.authority.owner_user_id != scope.owner_user_id
        || admission.authority.tenant_id != scope.tenant_id
        || admission.host_instance.is_empty()
        || !admission.control.is_open()
        || std::time::Instant::now() >= admission.deadline
    {
        return Err(Error::ExecutionUnavailable);
    }
    if selection.len() != admission.bindings.len() {
        return Err(Error::SelectionStale);
    }
    let mut unique = std::collections::HashSet::new();
    for reference in selection {
        if !unique.insert(&reference.installation_id) {
            return Err(Error::InvalidRequest);
        }
        let binding = admission
            .bindings
            .iter()
            .find(|b| b.reference == *reference)
            .ok_or(Error::SelectionStale)?;
        let item = store::find(db, scope, &catalog().catalog, &reference.installation_id)?;
        if item.revision != reference.revision
            || item.generation != reference.generation
            || item.service_id != binding.service_id
            || item.credential_ref.as_ref() != Some(&binding.credential_ref)
        {
            return Err(Error::SelectionStale);
        }
        if !super::supports_provider(&item.service_id)
            || !item.desired_enabled
            || item.status != ui::InstallationStatus::Installed
        {
            return Err(Error::ExecutionUnavailable);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::provider_generated as p;
    use super::*;
    #[test]
    fn browser_recovery_requires_a_live_auth_page_and_current_credential_permission() {
        assert!(browser_open_allowed("auth", true, false, false, true));
        assert!(!browser_open_allowed("auth", true, true, false, true));
        assert!(browser_open_allowed("auth", true, true, true, true));
        for explicit in [false, true] {
            assert!(!browser_open_allowed("auth", true, false, explicit, false));
            assert!(!browser_open_allowed("auth", false, false, explicit, true));
            assert!(!browser_open_allowed("probe", true, false, explicit, true));
            assert!(!browser_open_allowed("forget", true, false, explicit, true));
        }
    }
    fn setup() -> (
        rusqlite::Connection,
        ChatScope,
        ui::Installation,
        String,
        super::super::broker_generated::ScopeBinding,
    ) {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        db.pragma_update(None, "foreign_keys", true).unwrap();
        crate::chat::migrations::migrate_to_target(
            &mut db,
            crate::chat::migrations::MARKET_PROVIDER_SCHEMA_VERSION,
        )
        .unwrap();
        let scope = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
        let entry = catalog()
            .catalog
            .iter()
            .find(|e| e.service_id == "tushareMcp")
            .unwrap();
        let item = store::install(
            &mut db,
            &scope,
            entry,
            1,
            ui::InstallPayload {
                service_id: entry.service_id.clone(),
                operation_id: Uuid::now_v7().to_string(),
                expected_revision: 0,
            },
            100,
        )
        .unwrap()
        .installation;
        let host = Uuid::now_v7().to_string();
        let authority = super::super::broker_generated::ScopeBinding {
            owner_user_id: scope.owner_user_id.clone(),
            tenant_id: scope.tenant_id.clone(),
            native_process_epoch: Uuid::now_v7().to_string(),
            authorization_revision: 1,
            authorization_expires_at_unix_ms: 9999999999999,
        };
        (db, scope, item, host, authority)
    }
    fn begin(
        db: &mut rusqlite::Connection,
        scope: &ChatScope,
        item: &ui::Installation,
        host: &str,
        authority: super::super::broker_generated::ScopeBinding,
        action: ui::OperationAction,
    ) -> store::ProviderOperation {
        store::prepare_provider(
            db,
            scope,
            &catalog().catalog,
            store::ProviderIntent {
                key: &ui::InstallationOperationPayload {
                    installation_id: item.installation_id.clone(),
                    operation_id: Uuid::now_v7().to_string(),
                    expected_revision: item.revision,
                },
                expected_generation: Some(item.generation),
                action,
                intent: &serde_json::json!({"ordinary":"intent"}),
                host,
                authority,
                now: 101,
            },
        )
        .unwrap()
    }
    fn status(op: &store::ProviderOperation, state: p::OperationState) -> p::ProviderStatus {
        p::ProviderStatus {
            operation_id: op.payload.operation_id.clone(),
            host_instance_id: op.payload.host_instance_id.clone(),
            scope: op.payload.scope.clone(),
            binding: op.payload.binding.clone(),
            operation_state: state,
            authorization_status: p::AuthorizationStatus::Authorized,
            connection_status: p::ConnectionStatus::Connected,
            qualification: p::Qualification::NotQualified,
            execution_available: false,
            authorization_url: None,
            error_code: None,
        }
    }
    #[test]
    fn google_client_setup_and_registered_oauth_use_separate_owned_browser_steps() {
        let form = format!("http://127.0.0.1:12345/credential/{}", Uuid::now_v7());
        assert!(browser_url(&form, "google-calendar").is_ok());
        let mut oauth = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
        oauth
            .query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("code_challenge_method", "S256")
            .append_pair("resource", "https://calendarmcp.googleapis.com/mcp/v1")
            .append_pair(
                "redirect_uri",
                "http://127.0.0.1:18757/oauth/callback/google-calendar",
            );
        assert!(browser_url(oauth.as_str(), "google-calendar").is_ok());
        assert!(browser_url(&form, "google-maps").is_ok());
        assert!(browser_url(&form, "zerone").is_ok());
    }

    #[test]
    fn typed_control_rejection_is_not_reported_as_transport_unknown() {
        let rejected = super::super::control::ControlError::Rejected(host::Error {
            schema_version: 1,
            request_id: None,
            code: host::ErrorCode::UnsupportedAuth,
            retryable: false,
        });
        assert_eq!(
            control_failure(&rejected),
            (Error::UnsupportedCapability, true)
        );
        assert_eq!(
            control_failure(&super::super::control::ControlError::OutcomeUnknown),
            (Error::OutcomeUnknown, false)
        );
    }
    #[test]
    fn known_rejection_can_finish_new_intent_but_never_erase_unknown_original() {
        let (mut db, scope, item, host, authority) = setup();
        let auth = begin(
            &mut db,
            &scope,
            &item,
            &host,
            authority.clone(),
            ui::OperationAction::Authorize,
        );
        let rejected = store::provider_control_failure(
            &mut db,
            &scope,
            &auth.payload.operation_id,
            Error::UnsupportedCapability,
            true,
            auth.newly_created,
        )
        .unwrap();
        assert_eq!(
            rejected.result.operation.status,
            ui::OperationStatus::Failed
        );
        let item = store::find(&db, &scope, &catalog().catalog, &item.installation_id).unwrap();
        let second = begin(
            &mut db,
            &scope,
            &item,
            &host,
            authority,
            ui::OperationAction::Authorize,
        );
        let unknown = store::provider_control_failure(
            &mut db,
            &scope,
            &second.payload.operation_id,
            Error::OutcomeUnknown,
            false,
            second.newly_created,
        )
        .unwrap();
        let reread = store::provider_control_failure(
            &mut db,
            &scope,
            &second.payload.operation_id,
            Error::UnsupportedCapability,
            true,
            false,
        )
        .unwrap();
        assert_eq!(reread.result.operation.status, ui::OperationStatus::Unknown);
        assert_eq!(
            reread.result.operation.error_code,
            Some(Error::OutcomeUnknown)
        );
        assert_eq!(reread.payload, unknown.payload);
        let completed = store::finish_provider(
            &mut db,
            &scope,
            &reread,
            status(&reread, p::OperationState::Succeeded),
            104,
        )
        .unwrap();
        assert_eq!(
            completed.result.operation.status,
            ui::OperationStatus::Succeeded
        );
    }
    #[test]
    fn existing_pending_without_observation_is_not_fresh_dispatch() {
        let (mut db, scope, item, host, authority) = setup();
        let original = begin(
            &mut db,
            &scope,
            &item,
            &host,
            authority,
            ui::OperationAction::Authorize,
        );
        let reread = store::provider_operation(&db, &scope, &original.payload.operation_id)
            .unwrap()
            .unwrap();
        assert!(!reread.newly_created);
        let result = store::provider_control_failure(
            &mut db,
            &scope,
            &original.payload.operation_id,
            Error::ContextInvalid,
            true,
            reread.newly_created,
        )
        .unwrap();
        assert_eq!(result.result.operation.status, ui::OperationStatus::Unknown);
        assert_eq!(result.payload, original.payload);
    }
    #[test]
    fn authorized_metadata_never_enables_unqualified_business() {
        let (mut db, scope, item, host, authority) = setup();
        let auth = begin(
            &mut db,
            &scope,
            &item,
            &host,
            authority.clone(),
            ui::OperationAction::Authorize,
        );
        let mut waiting = status(&auth, p::OperationState::AwaitingUser);
        waiting.authorization_url =
            Some("https://tushare.pro/oauth/authorize?ordinary=transient".into());
        let waiting = store::finish_provider(&mut db, &scope, &auth, waiting, 102).unwrap();
        let snapshot = store::find(&db, &scope, &catalog().catalog, &item.installation_id).unwrap();
        assert_eq!(
            snapshot
                .active_operation
                .as_ref()
                .map(|op| op.operation_id.as_str()),
            Some(auth.payload.operation_id.as_str())
        );
        let stored: String = db
            .query_row(
                "SELECT observation_json FROM chat_connector_provider_operations",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!stored.contains("authorizationUrl"));
        assert!(!stored.contains("transient"));
        assert!(store::reserve_provider_browser(&db, &scope, &auth.payload.operation_id).unwrap());
        assert!(!store::reserve_provider_browser(&db, &scope, &auth.payload.operation_id).unwrap());
        let authorized = store::finish_provider(
            &mut db,
            &scope,
            &waiting,
            status(&auth, p::OperationState::Succeeded),
            103,
        )
        .unwrap();
        assert_eq!(
            authorized.result.installation.authorization_status,
            ui::AuthorizationStatus::Authorized
        );
        assert!(!authorized.result.installation.effective_enabled);
        let item = store::find(&db, &scope, &catalog().catalog, &item.installation_id).unwrap();
        assert_eq!(
            item.authorization_status,
            ui::AuthorizationStatus::Authorized
        );
        assert_eq!(item.connection_status, ui::ConnectionStatus::Disconnected);
        assert!(item.active_operation.is_none());
        let probe = begin(
            &mut db,
            &scope,
            &item,
            &host,
            authority,
            ui::OperationAction::Enable,
        );
        let completed = store::finish_provider(
            &mut db,
            &scope,
            &probe,
            status(&probe, p::OperationState::Succeeded),
            104,
        )
        .unwrap();
        assert_eq!(
            completed.result.operation.status,
            ui::OperationStatus::Failed
        );
        assert_eq!(
            completed.result.operation.error_code,
            Some(Error::ProviderOnboardingRequired)
        );
        assert!(!completed.result.installation.desired_enabled);
    }
    #[test]
    fn disable_fences_pending_auth_before_forget_receipt_and_late_auth_stays_stale() {
        let (mut db, scope, item, host, authority) = setup();
        let auth = begin(
            &mut db,
            &scope,
            &item,
            &host,
            authority.clone(),
            ui::OperationAction::Authorize,
        );
        let item = store::find(&db, &scope, &catalog().catalog, &item.installation_id).unwrap();
        let forget = begin(
            &mut db,
            &scope,
            &item,
            &host,
            authority,
            ui::OperationAction::Disable,
        );
        assert!(
            forget.payload.binding.reference.revision > auth.payload.binding.reference.revision
        );
        assert!(!forget.result.operation.cancellable);
        assert_eq!(
            store::finish_provider(
                &mut db,
                &scope,
                &auth,
                status(&auth, p::OperationState::Succeeded),
                102
            )
            .err(),
            Some(Error::SelectionStale)
        );
        let completed = store::finish_provider(
            &mut db,
            &scope,
            &forget,
            status(&forget, p::OperationState::Succeeded),
            103,
        )
        .unwrap();
        assert!(completed.result.installation.credential_ref.is_none());
        assert!(completed.result.installation.generation > item.generation);
        let replay = store::finish_provider(
            &mut db,
            &scope,
            &forget,
            status(&forget, p::OperationState::Succeeded),
            104,
        )
        .unwrap();
        assert_eq!(
            replay.result.installation.generation,
            completed.result.installation.generation
        );
    }
    #[test]
    fn ordinary_user_cancel_has_terminal_receipt_without_reopening_authorization() {
        let (mut db, scope, item, host, authority) = setup();
        let auth = begin(
            &mut db,
            &scope,
            &item,
            &host,
            authority,
            ui::OperationAction::Authorize,
        );
        let cancelled = store::finish_provider(
            &mut db,
            &scope,
            &auth,
            status(&auth, p::OperationState::Cancelled),
            102,
        )
        .unwrap();
        assert_eq!(
            cancelled.result.operation.status,
            ui::OperationStatus::Cancelled
        );
        assert!(!cancelled.result.operation.cancellable);
        assert_eq!(
            store::verify_provider_replay(
                &db,
                &scope,
                &auth.payload.operation_id,
                ui::OperationAction::Authorize,
                &serde_json::json!({"ordinary":"different intent"})
            ),
            Err(Error::RequestConflict)
        );
    }

    fn qualified_enable(
        db: &mut rusqlite::Connection,
        scope: &ChatScope,
        item: &ui::Installation,
        host: &str,
        authority: super::super::broker_generated::ScopeBinding,
    ) -> store::ProviderOperation {
        let auth = begin(
            db,
            scope,
            item,
            host,
            authority.clone(),
            ui::OperationAction::Authorize,
        );
        store::finish_provider(
            db,
            scope,
            &auth,
            status(&auth, p::OperationState::Succeeded),
            102,
        )
        .unwrap();
        let item = store::find(db, scope, &catalog().catalog, &item.installation_id).unwrap();
        let enable = begin(
            db,
            scope,
            &item,
            host,
            authority,
            ui::OperationAction::Enable,
        );
        let mut ready = status(&enable, p::OperationState::Succeeded);
        ready.qualification = p::Qualification::Qualified;
        ready.execution_available = true;
        store::finish_provider(db, scope, &enable, ready, 103).unwrap()
    }

    #[test]
    fn explicit_enable_persists_only_intent_and_original_binding() {
        let (mut db, scope, item, host, authority) = setup();
        let enabled = qualified_enable(&mut db, &scope, &item, &host, authority);
        let stored = store::find(&db, &scope, &catalog().catalog, &item.installation_id).unwrap();
        assert!(stored.desired_enabled);
        assert!(!stored.effective_enabled);
        assert_eq!(stored.connection_status, ui::ConnectionStatus::Disconnected);
        assert_eq!(stored.revision, enabled.payload.binding.reference.revision);
        assert!(!enabled.result.installation.effective_enabled);
        let selected = vec![enabled.payload.binding.reference.clone()];
        let operations = store::enabled_provider_operations(&db, &scope, &selected).unwrap();
        assert_eq!(operations.len(), 1);
        assert_eq!(
            operations[0].payload.operation_id,
            enabled.payload.operation_id
        );
        let caps = ui::CONNECTOR_CAPABILITIES
            .map(str::to_owned)
            .into_iter()
            .collect();
        let data =
            super::super::apply_observation(&mut db, &scope, Action::Snapshot, &caps, 104, None)
                .unwrap();
        let snapshot: ui::Snapshot = serde_json::from_value(data).unwrap();
        assert!(!snapshot.execution_available);
        assert!(snapshot.installations[0].desired_enabled);
        assert!(!snapshot.installations[0].effective_enabled);
        assert_eq!(
            super::super::apply_observation(
                &mut db,
                &scope,
                Action::Selection(ui::SelectionValidatePayload {
                    selection: selected
                }),
                &caps,
                104,
                None
            )
            .err(),
            Some(Error::ExecutionUnavailable)
        );
    }

    #[tokio::test]
    async fn current_enable_poll_projects_readiness_and_normal_close_removes_it() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};
        let (mut db, scope, item, host_id, authority) = setup();
        let enabled = qualified_enable(&mut db, &scope, &item, &host_id, authority.clone());
        let refs = vec![enabled.payload.binding.reference.clone()];
        let original = enabled.payload.operation_id.clone();
        let (native, peer) = duplex(65536);
        let (read, write) = split(native);
        let control =
            super::super::control::MarketControl::from_test_io(Box::new(write), Box::new(read));
        let host = crate::chat::host_bridge::HostBridge::from_connection(
            crate::chat::sidecar::HostConnection {
                port: 1,
                token_path: std::env::temp_dir().join("feat157-unused-bearer"),
                instance_nonce: host_id.clone(),
            },
        )
        .unwrap()
        .with_market_control(Some(control.clone()));
        let peer = tokio::spawn(async move {
            let (read, mut write) = split(peer);
            let mut read = BufReader::new(read);
            let mut line = String::new();
            read.read_line(&mut line).await.unwrap();
            let request: host::AuthPollRequest = serde_json::from_str(&line).unwrap();
            assert_eq!(request.method, "provider_auth_poll");
            assert_eq!(request.payload.operation_id, original);
            let response = host::AuthPollResponse {
                schema_version: 1,
                request_id: request.request_id,
                data: p::ProviderStatus {
                    operation_id: request.payload.operation_id,
                    host_instance_id: request.payload.host_instance_id,
                    scope: request.payload.scope,
                    binding: request.payload.binding,
                    operation_state: p::OperationState::Succeeded,
                    authorization_status: p::AuthorizationStatus::Authorized,
                    connection_status: p::ConnectionStatus::Connected,
                    qualification: p::Qualification::Qualified,
                    execution_available: true,
                    authorization_url: None,
                    error_code: None,
                },
            };
            write
                .write_all(format!("{}\n", serde_json::to_string(&response).unwrap()).as_bytes())
                .await
                .unwrap();
            write.flush().await.unwrap();
            line.clear();
            assert_eq!(read.read_line(&mut line).await.unwrap(), 0);
        });
        // A prior Host generation is an ordinary stale record, not authority.
        let mut stale = store::enabled_provider_operations(&db, &scope, &refs).unwrap();
        stale[0].payload.host_instance_id = Uuid::now_v7().to_string();
        assert!(matches!(
            poll_admission(&host, &scope, authority.clone(), stale).await,
            Err(Error::ExecutionUnavailable)
        ));
        let operations = store::enabled_provider_operations(&db, &scope, &refs).unwrap();
        let admission = poll_admission(&host, &scope, authority.clone(), operations)
            .await
            .unwrap();
        assert!(preflight(&db, &scope, &refs, &admission).is_ok());
        let caps = ui::CONNECTOR_CAPABILITIES
            .map(str::to_owned)
            .into_iter()
            .collect();
        let data = super::super::apply_observation(
            &mut db,
            &scope,
            Action::Snapshot,
            &caps,
            104,
            Some(&admission),
        )
        .unwrap();
        let snapshot: ui::Snapshot = serde_json::from_value(data).unwrap();
        assert!(snapshot.execution_available);
        assert!(snapshot.installations[0].effective_enabled);
        let data = super::super::apply_observation(
            &mut db,
            &scope,
            Action::Selection(ui::SelectionValidatePayload {
                selection: refs.clone(),
            }),
            &caps,
            104,
            Some(&admission),
        )
        .unwrap();
        let selection: ui::SelectionValidation = serde_json::from_value(data).unwrap();
        assert!(selection.execution_available);
        assert_eq!(selection.selection[0].reference, refs[0]);
        let mut expired = admission.clone();
        expired.deadline = std::time::Instant::now();
        assert_eq!(
            preflight(&db, &scope, &refs, &expired),
            Err(Error::ExecutionUnavailable)
        );
        let mut item = store::find(&db, &scope, &catalog().catalog, &item.installation_id).unwrap();
        expired.project_installation(&scope, &mut item);
        assert!(!item.effective_enabled);
        control.close().await;
        peer.await.unwrap();
        assert_eq!(
            preflight(&db, &scope, &refs, &admission),
            Err(Error::ExecutionUnavailable)
        );
        admission.project_installation(&scope, &mut item);
        assert!(!item.effective_enabled);
    }

    #[test]
    fn disable_revision_supersedes_original_enable_locator() {
        let (mut db, scope, item, host, authority) = setup();
        let enabled = qualified_enable(&mut db, &scope, &item, &host, authority.clone());
        let refs = vec![enabled.payload.binding.reference.clone()];
        let item = store::find(&db, &scope, &catalog().catalog, &item.installation_id).unwrap();
        let disabled = begin(
            &mut db,
            &scope,
            &item,
            &host,
            authority,
            ui::OperationAction::Disable,
        );
        assert!(!disabled.result.installation.desired_enabled);
        assert_eq!(
            store::enabled_provider_operations(&db, &scope, &refs).err(),
            Some(Error::SelectionStale)
        );
        assert!(
            disabled.payload.binding.reference.revision
                > enabled.payload.binding.reference.revision
        );
        let stale = ui::InstallationOperationPayload {
            installation_id: item.installation_id.clone(),
            operation_id: Uuid::now_v7().to_string(),
            expected_revision: item.revision,
        };
        assert_eq!(
            store::check_provider_change(
                &db,
                &scope,
                &catalog().catalog,
                &stale,
                Some(item.generation),
                ui::OperationAction::Enable
            )
            .err(),
            Some(Error::RevisionConflict)
        );
        let unchanged =
            store::find(&db, &scope, &catalog().catalog, &item.installation_id).unwrap();
        assert_eq!(
            unchanged.revision,
            disabled.payload.binding.reference.revision
        );
    }
}

/// Current, non-serializable provider evidence returned only by the owned Host
/// pipe. Durable installation/operation rows merely identify what to query.
#[derive(Clone)]
pub(crate) struct ProviderAdmission {
    authority: super::broker_generated::ScopeBinding,
    host_instance: String,
    bindings: Vec<super::provider_generated::ProviderBinding>,
    control: super::control::MarketControl,
    deadline: std::time::Instant,
}

impl ProviderAdmission {
    fn live(&self, scope: &ChatScope) -> bool {
        self.authority.owner_user_id == scope.owner_user_id
            && self.authority.tenant_id == scope.tenant_id
            && !self.host_instance.is_empty()
            && self.control.is_open()
            && std::time::Instant::now() < self.deadline
    }
    pub(super) fn project_installation(&self, scope: &ChatScope, item: &mut ui::Installation) {
        item.effective_enabled = false;
        if self.live(scope)
            && super::supports_provider(&item.service_id)
            && item.desired_enabled
            && item.status == ui::InstallationStatus::Installed
            && self.bindings.iter().any(|binding| {
                binding.service_id == item.service_id
                    && binding.reference.installation_id == item.installation_id
                    && binding.reference.revision == item.revision
                    && binding.reference.generation == item.generation
                    && Some(&binding.credential_ref) == item.credential_ref.as_ref()
            })
        {
            item.effective_enabled = true;
            item.configuration_status = ui::ConfigurationStatus::Configured;
            item.authorization_status = ui::AuthorizationStatus::Authorized;
            item.connection_status = ui::ConnectionStatus::Ready;
            item.error_code = None;
        }
    }
}

pub(crate) async fn read_admission(
    database: &crate::chat::worker::DatabaseWorker,
    host: &crate::chat::host_bridge::HostBridge,
    scope: &ChatScope,
    authority: super::broker_generated::ScopeBinding,
    selection: &[ui::SelectionRef],
) -> Result<ProviderAdmission, Error> {
    if authority.owner_user_id != scope.owner_user_id || authority.tenant_id != scope.tenant_id {
        return Err(Error::ContextInvalid);
    }
    authority.validate().map_err(|_| Error::ContextInvalid)?;
    let remaining = authority
        .authorization_expires_at_unix_ms
        .saturating_sub(now()?.saturating_mul(1000));
    if remaining <= 0 {
        return Err(Error::ContextInvalid);
    }
    let selected = selection.to_vec();
    let query_scope = scope.clone();
    let operations = database
        .call(move |repo| {
            Ok(store::enabled_provider_operations(
                &repo.connection,
                &query_scope,
                &selected,
            ))
        })
        .await
        .map_err(|_| Error::TemporarilyUnavailable)??;
    poll_admission(host, scope, authority, operations).await
}

async fn poll_admission(
    host: &crate::chat::host_bridge::HostBridge,
    scope: &ChatScope,
    authority: super::broker_generated::ScopeBinding,
    operations: Vec<store::ProviderOperation>,
) -> Result<ProviderAdmission, Error> {
    use super::provider_generated as p;
    if authority.owner_user_id != scope.owner_user_id || authority.tenant_id != scope.tenant_id {
        return Err(Error::ContextInvalid);
    }
    let control = host.market_control().ok_or(Error::ExecutionUnavailable)?;
    let mut bindings = Vec::new();
    for mut operation in operations {
        if operation.payload.host_instance_id != host.instance_nonce()
            || operation.payload.scope.native_process_epoch != authority.native_process_epoch
            || operation.payload.scope.authorization_revision != authority.authorization_revision
        {
            return Err(Error::ExecutionUnavailable);
        }
        operation.payload.scope = authority.clone();
        let request = super::host_generated::AuthPollRequest {
            schema_version: 1,
            request_id: Uuid::now_v7().to_string(),
            method: "provider_auth_poll".into(),
            payload: operation.payload.clone(),
        };
        request.validate().map_err(|_| Error::InvalidRequest)?;
        let response: super::host_generated::AuthPollResponse = control
            .request(&request.request_id, &request)
            .await
            .map_err(|_| Error::ExecutionUnavailable)?;
        let current = response.data;
        if current.operation_id != operation.payload.operation_id
            || current.host_instance_id != operation.payload.host_instance_id
            || current.scope != authority
            || current.binding != operation.payload.binding
            || current.operation_state != p::OperationState::Succeeded
            || current.qualification != p::Qualification::Qualified
            || current.authorization_status != p::AuthorizationStatus::Authorized
            || current.connection_status != p::ConnectionStatus::Connected
            || !current.execution_available
        {
            return Err(Error::ExecutionUnavailable);
        }
        bindings.push(current.binding);
    }
    if !control.is_open() {
        return Err(Error::ExecutionUnavailable);
    }
    let remaining = authority
        .authorization_expires_at_unix_ms
        .saturating_sub(now()?.saturating_mul(1000));
    if remaining <= 0 {
        return Err(Error::ContextInvalid);
    }
    Ok(ProviderAdmission {
        authority,
        host_instance: host.instance_nonce().into(),
        bindings,
        control,
        deadline: std::time::Instant::now()
            + std::time::Duration::from_millis(remaining.min(10_000) as u64),
    })
}
