//! Final fixed-purpose POST admission on the existing Host transport.
use super::{draft_recovery::Context, drafts};
use crate::chat::{
    database::HostTurnInputBlock, error::ChatError, host_bridge::HostBridge,
    host_domain::HostSessionState, lifecycle::Lifecycle, worker::DatabaseWorker,
};
use uuid::Uuid;

#[derive(Clone)]
pub(crate) struct Admission {
    pub database: DatabaseWorker,
    pub lifecycle: Lifecycle,
    pub epoch: u64,
    pub operation: Uuid,
    pub context: Context,
}
impl Admission {
    pub(crate) async fn begin(
        &self,
        host: &HostBridge,
        path: &str,
        body: &[u8],
    ) -> Result<(), ChatError> {
        self.lifecycle.validate(self.epoch)?;
        let c = &self.context;
        let is_create = c.create == Some(self.operation);
        let resume_path = c
            .session
            .map(|id| format!("/v1/scheduled-plan-draft-sessions/{id}/resume"));
        let resume = resume_path.as_deref() == Some(path);
        let expected = if is_create {
            "/v1/scheduled-plan-draft-sessions".to_owned()
        } else {
            format!(
                "/v1/scheduled-plan-draft-sessions/{}/turns",
                c.session.ok_or(ChatError::ConversationConflict)?
            )
        };
        if (!resume && path != expected) || (resume && is_create) {
            return Err(ChatError::ConversationConflict);
        }
        let payload: serde_json::Value =
            serde_json::from_slice(body).map_err(|_| ChatError::InvalidInput)?;
        let kind = if is_create {
            "CreateRequest"
        } else if resume {
            "ResumeRequest"
        } else {
            "TurnRequest"
        };
        if !drafts::valid_wire(kind, &payload) {
            return Err(ChatError::InvalidInput);
        }
        if is_create
            && (payload["task_id"] != c.task.ok_or(ChatError::ConversationConflict)?.to_string()
                || payload["workspace_id"] != c.workspace)
        {
            return Err(ChatError::ConversationConflict);
        }
        if !is_create && !resume && payload["operation_id"] != self.operation.to_string() {
            return Err(ChatError::ConversationConflict);
        }
        host.require_draft_capability()
            .await
            .map_err(|_| ChatError::OrchestrationUnavailable)?;
        if let Some(session) = c.session {
            let mapping = host
                .draft_mapping(c.task.ok_or(ChatError::ConversationConflict)?)
                .await
                .map_err(|_| ChatError::OrchestrationUnavailable)?
                .ok_or(ChatError::ConversationConflict)?;
            if mapping.agent_session_id != session.to_string()
                || mapping.workspace_id != c.workspace
                || mapping.codex_thread_id != c.thread.map(|id| id.to_string())
            {
                return Err(ChatError::ConversationConflict);
            }
            let state = host
                .get_session(session)
                .await
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
            if state.agent_session_id != session
                || Some(state.task_id) != c.task
                || state.codex_thread_id != c.thread
                || state.active_turn_id.is_some()
                || state.state != HostSessionState::Idle
            {
                return Err(ChatError::ConversationConflict);
            }
        }
        self.lifecycle.validate(self.epoch)?;
        let operation = self.operation;
        let context = c.clone();
        let nonce = host.instance_nonce().to_owned();
        let epoch = self.epoch;
        let lifecycle = self.lifecycle.clone();
        self.database
            .call(move |r| {
                lifecycle.validate(epoch)?;
                if r.draft_runtime.host.as_ref() != Some(&(nonce, epoch))
                    || r.draft_context_for_operation(operation)?.as_ref() != Some(&context)
                    || !r.guard_draft_dispatch(operation)?
                {
                    return Err(ChatError::ConversationConflict);
                }
                if !is_create && !resume {
                    let expected = r.load_start_turn_dispatch_v2(operation)?;
                    let [HostTurnInputBlock::Text { text }] = expected.content_blocks.as_slice()
                    else {
                        return Err(ChatError::ConversationConflict);
                    };
                    if payload["text"].as_str() != Some(text.as_str()) {
                        return Err(ChatError::ConversationConflict);
                    }
                }
                lifecycle.validate(epoch)?;
                if !resume {
                    r.mark_draft_attempt(operation)?;
                    r.draft_runtime.actions.remove(&operation.to_string());
                }
                Ok(())
            })
            .await?;
        self.lifecycle.validate(self.epoch)
    }
}
