//! Volatile native permissions and observations. Nothing here grants a recovered
//! operation permission to send; explicit UI actions establish bounded permits.
use super::{
    drafts, execution_generated::ScheduleCapability, ipc_generated as wire, ScheduleAuthority,
};
use crate::chat::{
    authorization::ChatAuthorizationManager,
    database::{ChatRepository, ChatScope},
    error::ChatError,
    lifecycle::Lifecycle,
};
use rusqlite::{params, OptionalExtension};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Clone)]
pub(crate) struct Action {
    pub epoch: u64,
    pub deadline: i64,
    pub revision: i64,
    pub context: Uuid,
    pub ui: ChatAuthorizationManager,
}
impl Action {
    pub(crate) fn allows(
        &self,
        scope: &ChatScope,
        a: &ScheduleAuthority,
        now: i64,
        lifecycle: &Lifecycle,
    ) -> bool {
        now < self.deadline
            && a.revision == self.revision
            && lifecycle.validate(self.epoch).is_ok()
            && a.require(scope, ScheduleCapability::ScheduleRun, now)
                .is_ok()
            && self
                .ui
                .with_schedule_context(self.context, scope, true, true, now, |_, revision| {
                    revision == self.revision as u64
                })
                .unwrap_or(false)
    }
}
#[derive(Default)]
pub(crate) struct NativeState {
    pub lifecycle: Option<Lifecycle>,
    pub host: Option<(String, u64)>,
    pub actions: HashMap<String, Action>,
    pub verified_sources: HashMap<String, (String, u64)>,
    pub observations: HashMap<(Uuid, Uuid), (String, u64)>,
    pub cursor: Option<String>,
}
impl NativeState {
    pub(crate) fn allows(
        &self,
        scope: &ChatScope,
        a: &ScheduleAuthority,
        now: i64,
        operation: &str,
    ) -> bool {
        let Some(lifecycle) = self.lifecycle.as_ref() else {
            return false;
        };
        let Some((_, epoch)) = self.host.as_ref() else {
            return false;
        };
        self.actions
            .get(operation)
            .is_some_and(|action| action.epoch == *epoch && action.allows(scope, a, now, lifecycle))
    }
}
impl ChatRepository {
    pub(crate) fn draft_host_observed(
        &mut self,
        nonce: String,
        epoch: u64,
    ) -> Result<(), ChatError> {
        let lifecycle = self
            .draft_runtime
            .lifecycle
            .as_ref()
            .ok_or(ChatError::OrchestrationUnavailable)?;
        if epoch != lifecycle.epoch() {
            return Err(ChatError::OrchestrationUnavailable);
        }
        if self.draft_runtime.host.as_ref() != Some(&(nonce.clone(), epoch)) {
            self.draft_runtime.actions.clear();
            self.draft_runtime.observations.clear();
            self.draft_runtime.verified_sources.clear();
        }
        self.draft_runtime.host = Some((nonce, epoch));
        Ok(())
    }
    pub(crate) fn grant_draft_action(
        &mut self,
        source: &str,
        action: Action,
    ) -> Result<(), ChatError> {
        let lifecycle = self
            .draft_runtime
            .lifecycle
            .as_ref()
            .ok_or(ChatError::OrchestrationUnavailable)?;
        lifecycle.validate(action.epoch)?;
        if self
            .draft_runtime
            .host
            .as_ref()
            .is_none_or(|(_, e)| *e != action.epoch)
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let now = super::dispatch::timestamp()?;
        self.draft_runtime
            .actions
            .retain(|_, a| a.deadline > now && a.epoch == action.epoch);
        if self.draft_runtime.actions.len() > 254 {
            return Err(ChatError::ConversationConflict);
        }
        let row:(Option<String>,String,bool,bool)=self.connection.query_row(
            "SELECT create_operation_id,operation_id,create_attempted,turn_attempted FROM chat_scheduled_draft_sources WHERE source_id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND source_deleted=0 AND format_version=1",
            params![source,self.scope.owner_user_id,self.scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(|_|ChatError::NotFound)?;
        if !row.2 {
            if let Some(create) = row.0 {
                self.draft_runtime.actions.insert(create, action.clone());
            }
        }
        if !row.3 {
            self.draft_runtime.actions.insert(row.1, action);
        }
        Ok(())
    }
    pub(crate) fn find_draft_source(
        &self,
        query: wire::DraftSourceQuery,
    ) -> Result<wire::DraftSourceLookup, ChatError> {
        if !drafts::present(&self.connection)? {
            return Ok(wire::DraftSourceLookup {
                found: false,
                source: None,
            });
        }
        let id:Option<String>=self.connection.query_row("SELECT source_id FROM chat_scheduled_draft_sources WHERE owner_user_id=?1 AND tenant_id=?2 AND conversation_id=?3 AND local_turn_id=?4 AND format_version=1 AND source_deleted=0",params![self.scope.owner_user_id,self.scope.tenant_id,query.conversation_id,query.local_turn_id],|r|r.get(0)).optional().map_err(|_|ChatError::DatabaseUnavailable)?;
        let source = id
            .map(|id| {
                drafts::receipt(&self.connection, &self.scope, &id)
                    .map_err(|_| ChatError::ConversationConflict)
            })
            .transpose()?;
        Ok(wire::DraftSourceLookup {
            found: source.is_some(),
            source,
        })
    }
}
