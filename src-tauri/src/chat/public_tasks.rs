use crate::native_auth::{NativeAuthRuntime, NativePublicTaskOutcome};
use async_trait::async_trait;
use std::fmt::{Debug, Formatter};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PublicTaskIssueCode {
    Unauthenticated,
    CapabilityDenied,
    TemporarilyUnavailable,
    Conflict,
    ProtocolError,
}

impl PublicTaskIssueCode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Unauthenticated => "chat_unauthenticated",
            Self::CapabilityDenied => "chat_capability_denied",
            Self::TemporarilyUnavailable => "chat_temporarily_unavailable",
            Self::Conflict => "chat_conflict",
            Self::ProtocolError => "chat_protocol_error",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PublicTaskCreateOutcome {
    Bound { public_task_id: Uuid },
    BlockedAuth,
    Denied,
    RetryWait,
    Conflict,
    ProtocolError,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct PublicTaskCreateIntent {
    pub operation_id: Uuid,
    pub client_reference_id: Uuid,
    pub authorization_revision: u64,
}

impl Debug for PublicTaskCreateIntent {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PublicTaskCreateIntent")
            .field("operation_id", &self.operation_id)
            .field("client_reference_id", &"[OPAQUE]")
            .field("authorization_revision", &self.authorization_revision)
            .finish()
    }
}

#[async_trait]
pub trait PublicTaskControlPlane: Send + Sync {
    async fn create_task(&self, intent: PublicTaskCreateIntent) -> PublicTaskCreateOutcome;
}

pub struct NativePublicTaskControlPlane {
    runtime: NativeAuthRuntime,
    expected_owner_user_id: Uuid,
    expected_tenant_id: Uuid,
}

impl NativePublicTaskControlPlane {
    pub fn new(
        runtime: NativeAuthRuntime,
        expected_owner_user_id: Uuid,
        expected_tenant_id: Uuid,
    ) -> Self {
        Self {
            runtime,
            expected_owner_user_id,
            expected_tenant_id,
        }
    }
}

impl Debug for NativePublicTaskControlPlane {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("NativePublicTaskControlPlane")
            .field("expected_owner_user_id", &"[RUST_BOUND]")
            .field("expected_tenant_id", &"[RUST_BOUND]")
            .finish()
    }
}

#[async_trait]
impl PublicTaskControlPlane for NativePublicTaskControlPlane {
    async fn create_task(&self, intent: PublicTaskCreateIntent) -> PublicTaskCreateOutcome {
        match self
            .runtime
            .create_chat_public_task(
                self.expected_owner_user_id,
                self.expected_tenant_id,
                intent.authorization_revision,
                intent.operation_id,
                intent.client_reference_id,
            )
            .await
        {
            NativePublicTaskOutcome::Bound(public_task_id) => {
                PublicTaskCreateOutcome::Bound { public_task_id }
            }
            NativePublicTaskOutcome::BlockedAuth => PublicTaskCreateOutcome::BlockedAuth,
            NativePublicTaskOutcome::Denied => PublicTaskCreateOutcome::Denied,
            NativePublicTaskOutcome::RetryWait => PublicTaskCreateOutcome::RetryWait,
            NativePublicTaskOutcome::Conflict => PublicTaskCreateOutcome::Conflict,
            NativePublicTaskOutcome::ProtocolError => PublicTaskCreateOutcome::ProtocolError,
        }
    }
}

#[cfg(test)]
pub(crate) struct FixedPublicTaskControlPlane {
    outcomes: std::sync::Mutex<std::collections::VecDeque<PublicTaskCreateOutcome>>,
    calls: std::sync::Mutex<Vec<PublicTaskCreateIntent>>,
}

#[cfg(test)]
impl FixedPublicTaskControlPlane {
    pub(crate) fn new(outcomes: impl IntoIterator<Item = PublicTaskCreateOutcome>) -> Self {
        Self {
            outcomes: std::sync::Mutex::new(outcomes.into_iter().collect()),
            calls: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn calls(&self) -> Vec<PublicTaskCreateIntent> {
        self.calls.lock().expect("public task calls").clone()
    }
}

#[cfg(test)]
#[async_trait]
impl PublicTaskControlPlane for FixedPublicTaskControlPlane {
    async fn create_task(&self, intent: PublicTaskCreateIntent) -> PublicTaskCreateOutcome {
        self.calls.lock().expect("public task calls").push(intent);
        self.outcomes
            .lock()
            .expect("public task outcomes")
            .pop_front()
            .unwrap_or(PublicTaskCreateOutcome::RetryWait)
    }
}
