//! A disposable display buffer for native Codex notifications. This module has
//! no execution-state transition table, final-text reconciliation, or history
//! reconstruction. Native completed items replace their display buffer.
use super::database::ActiveTurnContext;
use super::error::ChatError;
use super::native_conversation_generated::{
    NativeConversationView, NativeDisplayItem, NativeEvent, NativeItem, NativeViewCursor,
};

const MAX_VIEW_BYTES: usize = 4 * 1024 * 1024 - 4096; // reserve room for cursor and availability diagnostics
const MAX_TEXT_BYTES: usize = 1024 * 1024;

/// Bound a readonly Runtime Item set without matching it to observed Items.
pub fn bound_read_view(view: &mut NativeConversationView) -> Result<(), ChatError> {
    while serde_json::to_vec(&view)
        .map_err(|_| ChatError::OrchestrationUnavailable)?
        .len()
        > MAX_VIEW_BYTES
    {
        if view.items.pop().is_none() {
            return Err(ChatError::OrchestrationUnavailable);
        }
        view.availability = "partial".into();
        view.diagnostic = Some("history_display_limit".into());
    }
    Ok(())
}

fn omit_display_content(item: &mut NativeItem) {
    item.text = None;
    item.content = None;
    item.summary = None;
    item.output_text = None;
    item.arguments_summary = None;
    item.result_summary = None;
    item.command_label = None;
    item.cwd_label = None;
    item.availability = "partial".into();
    if let Some(mcp) = &mut item.mcp {
        if !mcp.texts.is_empty() {
            mcp.texts.clear();
            mcp.result_kind = "omitted".into();
        }
        if !mcp.diagnostics.iter().any(|v| v == "display_limit") {
            mcp.diagnostics.push("display_limit".into());
        }
    }
}

fn bound_display_content(view: &mut NativeConversationView) -> Result<(), ChatError> {
    // Trim display content only. Native IDs, actual status, exit/duration facts
    // and last observed methods are retained. The full event remains encrypted.
    for index in 0..view.items.len() {
        if serde_json::to_vec(view)
            .map_err(|_| ChatError::OrchestrationUnavailable)?
            .len()
            <= MAX_VIEW_BYTES
        {
            return Ok(());
        }
        omit_display_content(&mut view.items[index].item);
    }
    if serde_json::to_vec(view)
        .map_err(|_| ChatError::OrchestrationUnavailable)?
        .len()
        > MAX_VIEW_BYTES
    {
        view.plan = None;
        view.explanation = None;
    }
    if serde_json::to_vec(view)
        .map_err(|_| ChatError::OrchestrationUnavailable)?
        .len()
        > MAX_VIEW_BYTES
    {
        return Err(ChatError::OrchestrationUnavailable);
    }
    Ok(())
}

pub struct NativeDisplayBuffer {
    context: ActiveTurnContext,
    pub view: NativeConversationView,
}

impl NativeDisplayBuffer {
    pub fn new(
        context: ActiveTurnContext,
        saved: Option<NativeConversationView>,
    ) -> Result<Self, ChatError> {
        let view = saved.unwrap_or_else(|| NativeConversationView {
            session_id: context.session_id.to_string(),
            turn_id: context.turn_id.to_string(),
            runtime_thread_id: context.codex_thread_id.to_string(),
            runtime_turn_id: context.runtime_turn_id.to_string(),
            ordinal: None,
            source: "native_observed".into(),
            revision: "0".into(),
            availability: "partial".into(),
            status: None,
            status_source: None,
            terminal_observed: false,
            items: vec![],
            plan: None,
            explanation: None,
            diagnostic: None,
            cursor: None,
            terminal_error_code: None,
        });
        if view.session_id != context.session_id.to_string()
            || view.turn_id != context.turn_id.to_string()
            || view.runtime_thread_id != context.codex_thread_id.to_string()
            || view.runtime_turn_id != context.runtime_turn_id.to_string()
            || !matches!(view.source.as_str(), "native_observed" | "native_rebuilt")
        {
            return Err(ChatError::ConversationConflict);
        }
        Ok(Self { context, view })
    }

    pub fn context(&self) -> &ActiveTurnContext {
        &self.context
    }

    pub fn mark_unavailable(&mut self, code: &str) {
        self.view.availability = "partial".into();
        self.view.diagnostic = Some(code.into());
    }

    /// Transport ordering is checked exactly once here. It never changes the
    /// native execution status and never requests or retries a model operation.
    pub fn observe(&mut self, event: &NativeEvent) -> Result<bool, ChatError> {
        if !matches!(event.schema_version, 7 | 8)
            || event.event_type != "native.notification"
            || event.task_id != self.context.task_id.to_string()
            || event.agent_session_id != self.context.agent_session_id.to_string()
            || event.codex_thread_id != self.context.codex_thread_id.to_string()
            || event.sequence <= 0
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let n = &event.payload.native;
        if n.thread_id != event.codex_thread_id {
            return Err(ChatError::OrchestrationUnavailable);
        }
        if let Some(cursor) = &self.view.cursor {
            let previous = cursor
                .sequence
                .parse::<i64>()
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            if cursor.stream_id == event.stream_id {
                if event.sequence <= previous {
                    return Ok(false);
                }
                if event.sequence != previous + 1 {
                    self.mark_unavailable("stream_gap")
                }
            } else {
                self.mark_unavailable("stream_changed")
            }
        }
        self.view.cursor = Some(NativeViewCursor {
            stream_id: event.stream_id.clone(),
            sequence: event.sequence.to_string(),
            event_id: event.event_id.clone(),
        });
        if (n.method.starts_with("item/") || n.method.starts_with("turn/")) && n.turn_id.is_none() {
            return Err(ChatError::OrchestrationUnavailable);
        }
        if n.turn_id
            .as_deref()
            .is_some_and(|id| id != self.view.runtime_turn_id)
        {
            return Ok(true);
        }
        if n.source == "projection_notice" {
            self.mark_unavailable(n.code.as_deref().unwrap_or("projection_unavailable"));
            return Ok(true);
        }
        if n.source != "runtime_notification" {
            self.mark_unavailable("unsupported_source");
            return Ok(true);
        }
        match n.method.as_str() {
            "item/started" | "item/completed" => {
                if let Some(item) = &n.item {
                    if item.id.is_empty() || item.id.len() > 512 {
                        self.mark_unavailable("invalid_item_identity");
                        return Ok(true);
                    }
                    if self.view.source != "native_observed" {
                        // Select the entire observed Item set; never join cold and live identities.
                        self.view.items.clear();
                        self.view.source = "native_observed".into();
                        self.mark_unavailable("native_source_changed");
                    }
                    let position = self.view.items.iter().position(|v| v.item.id == item.id);
                    let ordinal = position
                        .map(|i| self.view.items[i].ordinal)
                        .unwrap_or(self.view.items.len() as i64);
                    let value = NativeDisplayItem {
                        item: item.clone(),
                        last_method: n.method.clone(),
                        ordinal,
                    };
                    // Capacity is a display concern, never an execution failure.
                    if let Some(i) = position {
                        self.view.items[i] = value
                    } else if self.view.items.len() < 512 {
                        self.view.items.push(value)
                    } else {
                        self.mark_unavailable("display_limit");
                        return Ok(true);
                    }
                    if serde_json::to_vec(&self.view)
                        .map_err(|_| ChatError::OrchestrationUnavailable)?
                        .len()
                        > MAX_VIEW_BYTES
                    {
                        // The newest native status and identity survive capacity
                        // pressure. Never restore the preceding Item snapshot.
                        let current = position.unwrap_or(self.view.items.len() - 1);
                        omit_display_content(&mut self.view.items[current].item);
                        bound_display_content(&mut self.view)?;
                        self.mark_unavailable("display_limit");
                    }
                } else {
                    self.mark_unavailable("item_unavailable")
                }
            }
            "item/agentMessage/delta"
            | "item/reasoning/textDelta"
            | "item/reasoning/summaryTextDelta"
            | "item/reasoning/summaryPartAdded" => {
                if self.view.source != "native_observed" {
                    self.mark_unavailable("item_start_not_observed");
                    return Ok(true);
                }
                let Some(index) = self
                    .view
                    .items
                    .iter()
                    .position(|v| Some(v.item.id.as_str()) == n.item_id.as_deref())
                else {
                    self.mark_unavailable("item_start_not_observed");
                    return Ok(true);
                };
                let Some(delta) = &n.delta else {
                    return Ok(true);
                };
                let current_size = serde_json::to_vec(&self.view)
                    .map_err(|_| ChatError::OrchestrationUnavailable)?
                    .len();
                if current_size.saturating_add(delta.len().saturating_mul(6)) > MAX_VIEW_BYTES {
                    self.mark_unavailable("display_limit");
                    return Ok(true);
                }
                let display = &mut self.view.items[index];
                // A completed native object is not rewritten by a late display
                // delta. A new native item/started snapshot can open a new cycle.
                if display.last_method == "item/completed" {
                    return Ok(true);
                }
                let target = if n.method == "item/agentMessage/delta" {
                    display.item.text.get_or_insert_with(String::new)
                } else {
                    let part = n.index.unwrap_or(0);
                    if !(0..128).contains(&part) {
                        self.mark_unavailable("part_unavailable");
                        return Ok(true);
                    }
                    let parts = if n.method.starts_with("item/reasoning/summary") {
                        display.item.summary.get_or_insert_with(Vec::new)
                    } else {
                        display.item.content.get_or_insert_with(Vec::new)
                    };
                    parts.resize_with(parts.len().max(part as usize + 1), String::new);
                    &mut parts[part as usize]
                };
                if target.len().saturating_add(delta.len()) > MAX_TEXT_BYTES {
                    self.mark_unavailable("display_limit");
                    return Ok(true);
                }
                target.push_str(delta);
            }
            "turn/started" | "turn/completed" => {
                if let Some(turn) = &n.turn {
                    if turn.id != self.view.runtime_turn_id {
                        return Err(ChatError::OrchestrationUnavailable);
                    }
                    if let Some(status) = &turn.status {
                        if !matches!(
                            status.as_str(),
                            "inProgress" | "completed" | "failed" | "interrupted"
                        ) {
                            self.mark_unavailable("status_unavailable");
                            return Ok(true);
                        }
                        self.view.status = Some(status.clone());
                        self.view.status_source = Some("runtime_notification".into());
                        if n.method == "turn/completed"
                            && matches!(status.as_str(), "completed" | "failed" | "interrupted")
                        {
                            self.view.terminal_observed = true;
                            self.view.terminal_error_code = turn.error_code.clone();
                        }
                    }
                    // turn.items may be empty/notLoaded: never erase observed
                    // Items or infer the terminal state of unfinished Items.
                }
            }
            "turn/plan/updated" => {
                if n.plan.is_none() {
                    self.mark_unavailable("plan_unavailable");
                    return Ok(true);
                }
                let old_plan = self.view.plan.clone();
                let old_explanation = self.view.explanation.clone();
                self.view.plan = n.plan.clone();
                self.view.explanation = n.explanation.clone();
                if serde_json::to_vec(&self.view)
                    .map_err(|_| ChatError::OrchestrationUnavailable)?
                    .len()
                    > MAX_VIEW_BYTES
                {
                    self.view.plan = old_plan;
                    self.view.explanation = old_explanation;
                    self.mark_unavailable("display_limit");
                }
            }
            "error" | "warning" => {
                self.view.diagnostic = n.code.clone();
            }
            _ => self.mark_unavailable("unsupported_notification"),
        }
        Ok(true)
    }
}

#[cfg(feature = "feat126-s10-driver")]
pub(crate) fn run_r8_native_display_probe() -> Result<u64, ChatError> {
    use uuid::Uuid;
    let context = ActiveTurnContext {
        session_id: Uuid::from_u128(1),
        task_id: Uuid::from_u128(2),
        turn_id: Uuid::from_u128(3),
        turn_operation_id: Uuid::from_u128(4),
        agent_session_id: Uuid::from_u128(5),
        codex_thread_id: Uuid::from_u128(6),
        runtime_turn_id: Uuid::from_u128(7),
        assistant_text: String::new(),
        cursor: None,
    };
    let mut buffer = NativeDisplayBuffer::new(context.clone(), None)?;
    let mut event:NativeEvent=serde_json::from_value(serde_json::json!({"schema_version":7,"event_id":Uuid::from_u128(101),"stream_id":Uuid::from_u128(100),"sequence":1,"occurred_at":"2026-09-08T00:00:00Z","task_id":context.task_id,"agent_session_id":context.agent_session_id,"codex_thread_id":context.codex_thread_id,"event_type":"native.notification","terminal":false,"payload":{"native":{"source":"runtime_notification","method":"item/started","threadId":context.codex_thread_id,"turnId":context.runtime_turn_id,"availability":"available","item":{"id":"display-probe","type":"agentMessage","text":"","phase":"final_answer","availability":"available"}}}})).map_err(|_|ChatError::InvalidInput)?;
    buffer.observe(&event)?;
    event.payload.native.method = "item/agentMessage/delta".into();
    event.payload.native.item = None;
    event.payload.native.item_id = Some("display-probe".into());
    event.payload.native.delta = Some("x".into());
    for sequence in 2..=5001 {
        event.sequence = sequence;
        event.event_id = Uuid::from_u128(100 + sequence as u128).to_string();
        if !buffer.observe(&event)? {
            return Err(ChatError::OrchestrationUnavailable);
        }
    }
    for _ in 0..5000 {
        if buffer.observe(&event)? {
            return Err(ChatError::OrchestrationUnavailable);
        }
    }
    Ok(10_000)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    fn context() -> ActiveTurnContext {
        ActiveTurnContext {
            session_id: Uuid::from_u128(1),
            task_id: Uuid::from_u128(2),
            turn_id: Uuid::from_u128(3),
            turn_operation_id: Uuid::from_u128(4),
            agent_session_id: Uuid::from_u128(5),
            codex_thread_id: Uuid::from_u128(6),
            runtime_turn_id: Uuid::from_u128(7),
            assistant_text: String::new(),
            cursor: None,
        }
    }
    fn event(sequence: i64, method: &str, payload: serde_json::Value) -> NativeEvent {
        let c = context();
        let mut n = serde_json::json!({"source":"runtime_notification","method":method,"threadId":c.codex_thread_id,"turnId":c.runtime_turn_id,"availability":"available"});
        for (k, v) in payload.as_object().unwrap() {
            n[k] = v.clone()
        }
        serde_json::from_value(serde_json::json!({"schema_version":7,"event_id":Uuid::from_u128(100+sequence as u128),"stream_id":Uuid::from_u128(99),"sequence":sequence,"occurred_at":"2026-09-08T00:00:00Z","task_id":c.task_id,"agent_session_id":c.agent_session_id,"codex_thread_id":c.codex_thread_id,"event_type":"native.notification","terminal":method=="turn/completed","payload":{"native":n}})).unwrap()
    }
    #[test]
    fn feat144_native_tool_replacement_keeps_new_status_at_display_capacity() {
        let mut buffer = NativeDisplayBuffer::new(context(), None).unwrap();
        for index in 0..15 {
            buffer.observe(&event(index+1,"item/completed",serde_json::json!({"item":{"id":format!("ordinary-{index}"),"type":"agentMessage","availability":"available","text":"a".repeat(256*1024)}}))).unwrap();
        }
        let item = |status: &str, text: String| serde_json::json!({"item":{"id":"native-tool","type":"mcpToolCall","availability":"available","status":status,"mcp":{"server":"sorftime","tool":"product_detail","resultKind":"text","texts":[{"index":2,"text":text}],"diagnostics":[]}}});
        let mut started = event(16, "item/started", item("inProgress", String::new()));
        started.schema_version = 8;
        buffer.observe(&started).unwrap();
        let mut completed = event(
            17,
            "item/completed",
            item("completed", "b".repeat(256 * 1024)),
        );
        completed.schema_version = 8;
        buffer.observe(&completed).unwrap();
        let observed = buffer
            .view
            .items
            .iter()
            .find(|v| v.item.id == "native-tool")
            .unwrap();
        assert_eq!(observed.item.status.as_deref(), Some("completed"));
        assert_eq!(observed.last_method, "item/completed");
        assert_eq!(observed.item.mcp.as_ref().unwrap().result_kind, "omitted");
        assert!(observed.item.mcp.as_ref().unwrap().texts.is_empty());
        assert!(serde_json::to_vec(&buffer.view).unwrap().len() <= MAX_VIEW_BYTES);
        let mut empty = event(18, "item/completed", item("completed", String::new()));
        empty.schema_version = 8;
        buffer.observe(&empty).unwrap();
        let observed = buffer
            .view
            .items
            .iter()
            .find(|v| v.item.id == "native-tool")
            .unwrap();
        assert_eq!(observed.item.mcp.as_ref().unwrap().texts[0].index, 2);
        assert_eq!(observed.item.mcp.as_ref().unwrap().texts[0].text, "");
        assert!(observed.item.mcp.as_ref().unwrap().diagnostics.is_empty());
    }

    #[test]
    fn native_final_replaces_delta_without_prefix_reconciliation() {
        let mut b = NativeDisplayBuffer::new(context(), None).unwrap();
        b.observe(&event(1,"item/started",serde_json::json!({"item":{"id":"a","type":"agentMessage","text":"","phase":"commentary","availability":"available"}}))).unwrap();
        let delta = event(
            2,
            "item/agentMessage/delta",
            serde_json::json!({"itemId":"a","delta":"draft"}),
        );
        b.observe(&delta).unwrap();
        assert!(!b.observe(&delta).unwrap());
        b.observe(&event(3,"item/completed",serde_json::json!({"item":{"id":"a","type":"agentMessage","text":"entirely different final","phase":"final_answer","availability":"available"}}))).unwrap();
        assert_eq!(
            b.view.items[0].item.text.as_deref(),
            Some("entirely different final")
        );
        assert!(!b.view.terminal_observed);
        assert_eq!(b.view.status, None);
    }
    #[test]
    fn native_terminal_does_not_seal_items_and_gap_does_not_fail_turn() {
        let mut b = NativeDisplayBuffer::new(context(), None).unwrap();
        b.observe(&event(1,"item/started",serde_json::json!({"item":{"id":"a","type":"reasoning","content":[],"availability":"available"}}))).unwrap();
        b.observe(&event(3,"turn/completed",serde_json::json!({"turn":{"id":context().runtime_turn_id,"status":"failed","errorCode":"runtime_error","items":[],"itemsComplete":false}}))).unwrap();
        assert_eq!(b.view.status.as_deref(), Some("failed"));
        assert!(b.view.terminal_observed);
        assert_eq!(b.view.items[0].last_method, "item/started");
        assert_eq!(b.view.diagnostic.as_deref(), Some("stream_gap"));
    }
    #[test]
    fn native_interleaved_items_keep_indices_and_transport_deduplication() {
        let mut b = NativeDisplayBuffer::new(context(), None).unwrap();
        b.observe(&event(1,"item/started",serde_json::json!({"item":{"id":"a","type":"agentMessage","text":"","availability":"available"}}))).unwrap();
        b.observe(&event(2,"item/started",serde_json::json!({"item":{"id":"r","type":"reasoning","content":[],"summary":[],"availability":"available"}}))).unwrap();
        b.observe(&event(
            3,
            "item/reasoning/textDelta",
            serde_json::json!({"itemId":"r","index":1,"delta":"second"}),
        ))
        .unwrap();
        let a = event(
            4,
            "item/agentMessage/delta",
            serde_json::json!({"itemId":"a","delta":"answer"}),
        );
        b.observe(&a).unwrap();
        assert!(!b.observe(&a).unwrap());
        b.observe(&event(
            5,
            "item/reasoning/textDelta",
            serde_json::json!({"itemId":"r","index":0,"delta":"first"}),
        ))
        .unwrap();
        b.observe(&event(
            6,
            "item/reasoning/summaryTextDelta",
            serde_json::json!({"itemId":"r","index":1,"delta":"summary"}),
        ))
        .unwrap();
        assert_eq!(b.view.items[0].item.text.as_deref(), Some("answer"));
        assert_eq!(
            b.view.items[1].item.content.as_ref().unwrap(),
            &["first", "second"]
        );
        assert_eq!(
            b.view.items[1].item.summary.as_ref().unwrap(),
            &["", "summary"]
        );
    }
    #[test]
    fn native_display_capacity_and_projection_notice_do_not_create_execution_status() {
        let mut b = NativeDisplayBuffer::new(context(), None).unwrap();
        b.observe(&event(1,"item/started",serde_json::json!({"item":{"id":"a","type":"agentMessage","text":"retained","availability":"available"}}))).unwrap();
        b.observe(&event(
            2,
            "item/agentMessage/delta",
            serde_json::json!({"itemId":"a","delta":"normal text ".repeat(100_000)}),
        ))
        .unwrap();
        b.observe(&event(
            3,
            "projection/error",
            serde_json::json!({"source":"projection_notice","code":"projection_unavailable"}),
        ))
        .unwrap();
        assert_eq!(b.view.items[0].item.text.as_deref(), Some("retained"));
        assert_eq!(b.view.availability, "partial");
        assert_eq!(b.view.status, None);
        assert!(!b.view.terminal_observed);
    }
}
