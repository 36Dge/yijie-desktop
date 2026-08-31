use super::database::ChatScope;
use super::error::ChatError;
use std::collections::{HashMap, HashSet};
use std::fmt::{Debug, Formatter};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const MAX_CONTEXT_LIFETIME_SECONDS: i64 = 300;
const MAX_CAPABILITIES: usize = 64;
const MAX_CAPABILITY_BYTES: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChatAction {
    ReadSessions,
    CreateSession,
    SubmitTurn,
    RenameSession,
    PinSession,
    InterruptTurn,
    DeleteSession,
    ReadProjects,
    UseProject,
    PinProject,
    RemoveProject,
    ReadCleanup,
}

impl ChatAction {
    pub(crate) const ALL: [Self; 12] = [
        Self::ReadSessions,
        Self::CreateSession,
        Self::SubmitTurn,
        Self::RenameSession,
        Self::PinSession,
        Self::InterruptTurn,
        Self::DeleteSession,
        Self::ReadProjects,
        Self::UseProject,
        Self::PinProject,
        Self::RemoveProject,
        Self::ReadCleanup,
    ];

    pub(crate) fn wire_name(self) -> &'static str {
        match self {
            Self::ReadSessions => "read_sessions",
            Self::CreateSession => "create_session",
            Self::SubmitTurn => "submit_turn",
            Self::RenameSession => "rename_session",
            Self::PinSession => "pin_session",
            Self::InterruptTurn => "interrupt_turn",
            Self::DeleteSession => "delete_session",
            Self::ReadProjects => "read_projects",
            Self::UseProject => "use_project",
            Self::PinProject => "pin_project",
            Self::RemoveProject => "remove_project",
            Self::ReadCleanup => "read_cleanup",
        }
    }

    fn required_capabilities(self) -> &'static [&'static str] {
        match self {
            Self::ReadSessions | Self::ReadProjects | Self::ReadCleanup => &["task.read"],
            Self::CreateSession
            | Self::SubmitTurn
            | Self::RenameSession
            | Self::PinSession
            | Self::InterruptTurn
            | Self::DeleteSession => &["task.read", "task.create"],
            Self::UseProject | Self::PinProject | Self::RemoveProject => &["workspace.use"],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AuthorizationFailure {
    ContextInvalid,
    CapabilityDenied,
}

/// A validated projection produced by the trusted native-auth adapter. Its fields and
/// constructor are crate-private so a future WebView command cannot manufacture identity.
#[derive(Clone)]
pub struct AuthoritativeChatProjection {
    tenant_id: Uuid,
    authorization_revision: u64,
    expires_at: i64,
    capabilities: HashSet<String>,
}

impl AuthoritativeChatProjection {
    pub fn from_trusted_native_projection(
        tenant_id: Uuid,
        authorization_revision: u64,
        expires_at: i64,
        capabilities: impl IntoIterator<Item = String>,
    ) -> Result<Self, ChatError> {
        if tenant_id.is_nil() || authorization_revision == 0 || expires_at < 0 {
            return Err(ChatError::ScopeDenied);
        }
        let capabilities = capabilities.into_iter().collect::<HashSet<_>>();
        if capabilities.is_empty()
            || capabilities.len() > MAX_CAPABILITIES
            || capabilities.iter().any(|capability| {
                capability.is_empty()
                    || capability.len() > MAX_CAPABILITY_BYTES
                    || capability.contains('\0')
            })
        {
            return Err(ChatError::ScopeDenied);
        }
        Ok(Self {
            tenant_id,
            authorization_revision,
            expires_at,
            capabilities,
        })
    }
}

impl Debug for AuthoritativeChatProjection {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AuthoritativeChatProjection")
            .field("tenant_id", &"[RUST_BOUND]")
            .field("authorization_revision", &self.authorization_revision)
            .field("expires_at", &self.expires_at)
            .field("capability_count", &self.capabilities.len())
            .finish()
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct ChatAuthorizationContext {
    pub context_id: Uuid,
    pub expires_at: i64,
}

impl Debug for ChatAuthorizationContext {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ChatAuthorizationContext")
            .field("context_id", &self.context_id)
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

struct ContextRecord {
    process_epoch: Uuid,
    authorization_revision: u64,
    expires_at: i64,
    capabilities: HashSet<String>,
}

struct AuthorizationState {
    highest_revision: u64,
    highest_capabilities: Option<HashSet<String>>,
    contexts: HashMap<Uuid, ContextRecord>,
}

struct AuthorizationInner {
    tenant_id: Uuid,
    process_epoch: Uuid,
    state: Mutex<AuthorizationState>,
}

#[derive(Clone)]
pub struct ChatAuthorizationManager {
    inner: Arc<AuthorizationInner>,
}

impl Debug for ChatAuthorizationManager {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ChatAuthorizationManager")
            .field("tenant_id", &"[RUST_BOUND]")
            .field("process_epoch", &self.inner.process_epoch)
            .finish()
    }
}

impl ChatAuthorizationManager {
    pub(crate) fn new(scope: &ChatScope) -> Result<Self, ChatError> {
        Ok(Self {
            inner: Arc::new(AuthorizationInner {
                tenant_id: scope.tenant_uuid()?,
                process_epoch: Uuid::now_v7(),
                state: Mutex::new(AuthorizationState {
                    highest_revision: 0,
                    highest_capabilities: None,
                    contexts: HashMap::new(),
                }),
            }),
        })
    }

    pub fn bind(
        &self,
        projection: AuthoritativeChatProjection,
        now: i64,
    ) -> Result<ChatAuthorizationContext, ChatError> {
        if now < 0 || projection.tenant_id != self.inner.tenant_id || projection.expires_at <= now {
            return Err(ChatError::ScopeDenied);
        }
        let expires_at = projection.expires_at.min(
            now.checked_add(MAX_CONTEXT_LIFETIME_SECONDS)
                .ok_or(ChatError::ScopeDenied)?,
        );
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| ChatError::ScopeDenied)?;
        if projection.authorization_revision < state.highest_revision {
            return Err(ChatError::ScopeDenied);
        }
        if projection.authorization_revision > state.highest_revision {
            state.highest_revision = projection.authorization_revision;
            state.highest_capabilities = Some(projection.capabilities.clone());
        } else if state
            .highest_capabilities
            .as_ref()
            .is_some_and(|capabilities| capabilities != &projection.capabilities)
        {
            return Err(ChatError::ScopeDenied);
        } else if state.highest_capabilities.is_none() {
            state.highest_capabilities = Some(projection.capabilities.clone());
        }
        // The main WebView owns exactly one current chat context. Rebinding first
        // invalidates every prior context so a late response cannot cross generations.
        state.contexts.clear();
        let context_id = Uuid::now_v7();
        state.contexts.insert(
            context_id,
            ContextRecord {
                process_epoch: self.inner.process_epoch,
                authorization_revision: projection.authorization_revision,
                expires_at,
                capabilities: projection.capabilities,
            },
        );
        Ok(ChatAuthorizationContext {
            context_id,
            expires_at,
        })
    }

    pub fn authorize(
        &self,
        context_id: Uuid,
        action: ChatAction,
        now: i64,
    ) -> Result<(), ChatError> {
        self.authorize_detailed(context_id, action, now)
            .map_err(|_| ChatError::ScopeDenied)
    }

    pub(crate) fn authorize_detailed(
        &self,
        context_id: Uuid,
        action: ChatAction,
        now: i64,
    ) -> Result<(), AuthorizationFailure> {
        if context_id.is_nil() || now < 0 {
            return Err(AuthorizationFailure::ContextInvalid);
        }
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| AuthorizationFailure::ContextInvalid)?;
        state.contexts.retain(|_, record| record.expires_at > now);
        let record = state
            .contexts
            .get(&context_id)
            .ok_or(AuthorizationFailure::ContextInvalid)?;
        if record.process_epoch != self.inner.process_epoch
            || record.authorization_revision != state.highest_revision
        {
            return Err(AuthorizationFailure::ContextInvalid);
        }
        if !action
            .required_capabilities()
            .iter()
            .all(|capability| record.capabilities.contains(*capability))
        {
            return Err(AuthorizationFailure::CapabilityDenied);
        }
        Ok(())
    }

    pub(crate) fn authorization_revision(
        &self,
        context_id: Uuid,
        action: ChatAction,
        now: i64,
    ) -> Result<u64, AuthorizationFailure> {
        self.authorize_detailed(context_id, action, now)?;
        let state = self
            .inner
            .state
            .lock()
            .map_err(|_| AuthorizationFailure::ContextInvalid)?;
        let record = state
            .contexts
            .get(&context_id)
            .ok_or(AuthorizationFailure::ContextInvalid)?;
        if record.process_epoch != self.inner.process_epoch
            || record.authorization_revision != state.highest_revision
            || record.expires_at <= now
        {
            return Err(AuthorizationFailure::ContextInvalid);
        }
        Ok(record.authorization_revision)
    }

    pub(crate) fn allowed_actions(
        &self,
        context_id: Uuid,
        now: i64,
    ) -> Result<Vec<&'static str>, AuthorizationFailure> {
        let mut actions = Vec::new();
        for action in ChatAction::ALL {
            match self.authorize_detailed(context_id, action, now) {
                Ok(()) => actions.push(action.wire_name()),
                Err(AuthorizationFailure::CapabilityDenied) => {}
                Err(error) => return Err(error),
            }
        }
        Ok(actions)
    }

    pub(crate) fn has_authorized_context(
        &self,
        action: ChatAction,
        now: i64,
    ) -> Result<bool, ChatError> {
        if now < 0 {
            return Ok(false);
        }
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| ChatError::ScopeDenied)?;
        state.contexts.retain(|_, record| record.expires_at > now);
        Ok(state.contexts.values().any(|record| {
            record.process_epoch == self.inner.process_epoch
                && record.authorization_revision == state.highest_revision
                && action
                    .required_capabilities()
                    .iter()
                    .all(|capability| record.capabilities.contains(*capability))
        }))
    }

    pub fn invalidate_all(&self) -> Result<(), ChatError> {
        self.inner
            .state
            .lock()
            .map_err(|_| ChatError::ScopeDenied)?
            .contexts
            .clear();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(tenant: Uuid) -> ChatScope {
        ChatScope::new(Uuid::now_v7().to_string(), tenant.to_string()).unwrap()
    }

    fn projection(tenant: Uuid, revision: u64, expires_at: i64) -> AuthoritativeChatProjection {
        AuthoritativeChatProjection::from_trusted_native_projection(
            tenant,
            revision,
            expires_at,
            [
                "task.read".to_owned(),
                "task.create".to_owned(),
                "workspace.use".to_owned(),
            ],
        )
        .unwrap()
    }

    #[test]
    fn context_is_tenant_bound_short_lived_and_capability_checked() {
        let tenant = Uuid::now_v7();
        let manager = ChatAuthorizationManager::new(&scope(tenant)).unwrap();
        assert_eq!(
            manager.bind(projection(Uuid::now_v7(), 1, 999), 10),
            Err(ChatError::ScopeDenied)
        );
        let context = manager.bind(projection(tenant, 1, 999), 10).unwrap();
        assert_eq!(context.expires_at, 310);
        assert!(manager
            .has_authorized_context(ChatAction::ReadSessions, 309)
            .unwrap());
        manager
            .authorize(context.context_id, ChatAction::DeleteSession, 309)
            .unwrap();
        assert_eq!(
            manager.authorize(context.context_id, ChatAction::DeleteSession, 310),
            Err(ChatError::ScopeDenied)
        );
        assert!(!manager
            .has_authorized_context(ChatAction::ReadSessions, 310)
            .unwrap());

        let read_only = manager
            .bind(
                AuthoritativeChatProjection::from_trusted_native_projection(
                    tenant,
                    2,
                    100,
                    ["task.read".to_owned()],
                )
                .unwrap(),
                20,
            )
            .unwrap();
        assert_eq!(
            manager.authorize(read_only.context_id, ChatAction::SubmitTurn, 21),
            Err(ChatError::ScopeDenied)
        );

        let create_without_read = manager
            .bind(
                AuthoritativeChatProjection::from_trusted_native_projection(
                    tenant,
                    3,
                    100,
                    ["task.create".to_owned()],
                )
                .unwrap(),
                22,
            )
            .unwrap();
        assert_eq!(
            manager.authorize_detailed(create_without_read.context_id, ChatAction::SubmitTurn, 23),
            Err(AuthorizationFailure::CapabilityDenied)
        );
    }

    #[test]
    fn revision_change_logout_and_process_epoch_fail_closed_without_secret_debug() {
        let tenant = Uuid::now_v7();
        let manager = ChatAuthorizationManager::new(&scope(tenant)).unwrap();
        let old = manager.bind(projection(tenant, 4, 999), 10).unwrap();
        let newer = manager.bind(projection(tenant, 5, 999), 11).unwrap();
        assert_eq!(
            manager.authorize(old.context_id, ChatAction::ReadSessions, 12),
            Err(ChatError::ScopeDenied)
        );
        assert_eq!(
            manager.bind(projection(tenant, 4, 999), 12),
            Err(ChatError::ScopeDenied)
        );
        let rebound = manager.bind(projection(tenant, 5, 999), 12).unwrap();
        assert_eq!(
            manager.authorize(newer.context_id, ChatAction::ReadSessions, 13),
            Err(ChatError::ScopeDenied)
        );
        manager.invalidate_all().unwrap();
        assert_eq!(
            manager.authorize(rebound.context_id, ChatAction::ReadSessions, 14),
            Err(ChatError::ScopeDenied)
        );
        let rendered = format!("{manager:?} {:?}", projection(tenant, 6, 999));
        assert!(!rendered.contains("task.read"));
        assert!(!rendered.contains(&tenant.to_string()));
    }
}
