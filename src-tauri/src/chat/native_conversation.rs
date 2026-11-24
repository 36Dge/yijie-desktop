//! A disposable display buffer for native Codex notifications. This module has
//! no execution-state transition table, final-text reconciliation, or history
//! reconstruction. Native completed items replace their display buffer.
use super::database::ActiveTurnContext;
use super::error::ChatError;
use super::native_conversation_generated::{
    NativeConversationView, NativeDisplayItem, NativeEvent, NativeItem, NativeTextPreview,
    NativeViewCursor,
};

pub(super) const MAX_VIEW_BYTES: usize = 4 * 1024 * 1024 - 4096; // reserve room for cursor and availability diagnostics
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
    item.web_search = None;
    item.command_actions = None;
    item.tool_display = None;
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
    // Strictly live display data. The repository only receives view.
    previews: Vec<NativeTextPreview>,
}

fn apply_search_titles<'a>(
    view: &mut NativeConversationView,
    rows: impl Iterator<Item = (&'a str, &'a str, &'a str)>,
) -> Result<(), ChatError> {
    use std::collections::HashMap;
    let titles: HashMap<_, _> = rows
        .filter(|(_, _, title)| !title.trim().is_empty())
        .map(|(id, url, title)| ((id, url), title))
        .collect();
    if titles.is_empty() {
        return Ok(());
    }
    let size = serde_json::to_vec(&view)
        .map_err(|_| ChatError::OrchestrationUnavailable)?
        .len();
    let mut available = MAX_VIEW_BYTES.saturating_sub(size);
    for entry in &mut view.items {
        if entry.item.kind != "webSearch" {
            continue;
        }
        let Some(sources) = entry
            .item
            .web_search
            .as_mut()
            .filter(|s| s.action == "search")
            .and_then(|s| s.sources.as_mut())
        else {
            continue;
        };
        for source in sources {
            if source
                .title
                .as_deref()
                .is_some_and(|title| !title.trim().is_empty())
            {
                continue;
            }
            let Some(title) = titles.get(&(entry.item.id.as_str(), source.url.as_str())) else {
                continue;
            };
            let added = serde_json::to_vec(title)
                .map_err(|_| ChatError::OrchestrationUnavailable)?
                .len()
                + 9;
            if added > available {
                view.availability = "partial".into();
                view.diagnostic = Some("display_limit".into());
                return Ok(());
            }
            available -= added;
            source.title = Some((*title).to_owned());
        }
    }
    Ok(())
}

/// A deferred notification authorizes refreshing only display titles in this turn.
/// Existing observed search rows continue to own membership, order and lifecycle.
pub(super) fn apply_history_search_titles(
    view: &mut NativeConversationView,
    turn: &super::native_conversation_generated::NativeTurn,
) -> Result<(), ChatError> {
    if view.runtime_turn_id != turn.id {
        return Ok(());
    }
    let rows = turn
        .items
        .iter()
        .filter(|item| item.kind == "webSearch")
        .flat_map(|item| {
            item.web_search
                .iter()
                .filter(|s| s.action == "search")
                .filter_map(|s| s.sources.as_ref())
                .flatten()
                .filter_map(move |s| {
                    s.title
                        .as_deref()
                        .map(|title| (item.id.as_str(), s.url.as_str(), title))
                })
        });
    apply_search_titles(view, rows)
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
            notices: None,
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
        Ok(Self {
            context,
            view,
            previews: Vec::new(),
        })
    }

    pub fn previews(&self) -> &[NativeTextPreview] {
        &self.previews
    }

    /// An offset addresses UTF-8 bytes, independently of SSE sequence and Vue's UTF-16 cursor.
    fn observe_preview(&mut self, id: &str, offset: i64, delta: &str) -> bool {
        const ITEM_LIMIT: usize = 256 * 1024;
        const TURN_LIMIT: usize = 2 * 1024 * 1024;
        if id.is_empty()
            || id.len() > 512
            || delta.is_empty()
            || self.view.terminal_observed
            || self.view.status.as_deref() != Some("inProgress")
            || self.view.items.iter().any(|entry| entry.item.id == id)
        {
            return false;
        }
        let Ok(offset) = usize::try_from(offset) else {
            return false;
        };
        if offset.saturating_add(delta.len()) > ITEM_LIMIT
            || self.previews.iter().map(|p| p.text.len()).sum::<usize>() + delta.len() > TURN_LIMIT
        {
            return false;
        }
        if let Some(index) = self.previews.iter().position(|p| p.item_id == id) {
            let body = &mut self.previews[index].text;
            if offset == body.len() {
                body.push_str(delta);
                return true;
            }
            if body.as_bytes().get(offset..offset + delta.len()) == Some(delta.as_bytes()) {
                return false;
            }
            // A suffix from a different or incomplete stream is not a readable prefix.
            self.previews.remove(index);
            return true;
        }
        if offset != 0 || self.previews.len() >= 128 {
            return false;
        }
        self.previews.push(NativeTextPreview {
            item_id: id.into(),
            text: delta.into(),
        });
        true
    }

    pub fn context(&self) -> &ActiveTurnContext {
        &self.context
    }

    /// Turn completion does not complete its independently reported MCP Items.
    /// This is a subscription lifetime check, never execution/approval authority.
    pub fn has_pending_market_items(&self) -> bool {
        self.view.items.iter().any(|entry| {
            entry.last_method == "item/started"
                && entry.item.kind == "mcpToolCall"
                && entry
                    .item
                    .mcp
                    .as_ref()
                    .is_some_and(|mcp| mcp.server.as_deref() == Some("yijie_market"))
        })
    }

    pub fn mark_unavailable(&mut self, code: &str) {
        self.previews.clear();
        self.view.availability = "partial".into();
        self.view.diagnostic = Some(code.into());
    }

    /// Transport ordering is checked exactly once here. It never changes the
    /// native execution status and never requests or retries a model operation.
    pub fn observe(&mut self, event: &NativeEvent) -> Result<bool, ChatError> {
        if event.schema_version != 13
            || event.event_type != "native.notification"
            || event.task_id != self.context.task_id.to_string()
            || event.agent_session_id != self.context.agent_session_id.to_string()
            || event.codex_thread_id != self.context.codex_thread_id.to_string()
            || event.sequence <= 0
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let n = &event.payload.native;
        let previous_diagnostic = self.view.diagnostic.clone();
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
            // Consume the session transport cursor without publishing another
            // turn's traffic as an update to this view. New transport issues
            // remain observable, but ordinary foreign events cause no SQL/IPC.
            return Ok(self.view.diagnostic != previous_diagnostic);
        }
        if n.source == "projection_notice" {
            // Command chunks are deliberately withheld until the complete output
            // can be sanitized. This is not a loss of lifecycle/stream authority.
            // In particular it must not replace a real stream-gap diagnostic.
            if n.code.as_deref() != Some("command_output_pending_final") {
                self.mark_unavailable(n.code.as_deref().unwrap_or("projection_unavailable"));
            }
            return Ok(true);
        }
        if n.source != "runtime_notification" {
            self.mark_unavailable("unsupported_source");
            return Ok(true);
        }
        match n.method.as_str() {
            "item/agentMessage/previewDelta" => {
                return Ok(match (&n.item_id, n.preview_offset, &n.delta) {
                    (Some(id), Some(offset), Some(delta)) => {
                        self.observe_preview(id, offset, delta)
                    }
                    _ => false,
                });
            }
            "item/started" | "item/completed" => {
                if let Some(item) = &n.item {
                    if n.method == "item/completed" || item.kind != "agentMessage" {
                        self.previews.retain(|preview| preview.item_id != item.id);
                    }
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
                    let index = position.unwrap_or_else(|| {
                        let Some(stamp) = &item.publication else {
                            return self.view.items.len();
                        };
                        if let Some(anchor) = &stamp.after_item_id {
                            if let Some(i) =
                                self.view.items.iter().position(|e| e.item.id == *anchor)
                            {
                                return i + 1;
                            }
                        }
                        self.view
                            .items
                            .iter()
                            .position(|e| {
                                e.item
                                    .publication
                                    .as_ref()
                                    .is_some_and(|other| other.order > stamp.order)
                            })
                            .unwrap_or_else(|| (stamp.order as usize).min(self.view.items.len()))
                    });
                    let value = NativeDisplayItem {
                        item: item.clone(),
                        last_method: n.method.clone(),
                        ordinal: index as i64,
                        call_started_at_ms: if item.kind == "mcpToolCall" {
                            position
                                .and_then(|i| self.view.items[i].call_started_at_ms)
                                .or_else(|| {
                                    if n.method != "item/started" {
                                        return None;
                                    }
                                    let ms =
                                        chrono::DateTime::parse_from_rfc3339(&event.occurred_at)
                                            .ok()?
                                            .timestamp_millis();
                                    (0..=253_402_300_799_999).contains(&ms).then_some(ms)
                                })
                        } else {
                            None
                        },
                    };
                    if let Some(i) = position {
                        if self.view.items[i]
                            .item
                            .publication
                            .as_ref()
                            .is_some_and(|old| {
                                value.item.publication.as_ref().is_none_or(|new| {
                                    old.item_id != new.item_id
                                        || old.source != new.source
                                        || old.order != new.order
                                }) || self.view.items[i].item.phase != value.item.phase
                            })
                        {
                            self.mark_unavailable("publication_conflict");
                            return Ok(true);
                        }
                        self.view.items[i] = value;
                    } else if self.view.items.len() < 512 {
                        self.view.items.insert(index, value);
                        for (i, entry) in self.view.items.iter_mut().enumerate().skip(index + 1) {
                            entry.ordinal = i as i64;
                        }
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
                        let current = index;
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
                if n.method == "turn/completed" {
                    self.previews.clear();
                }
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
                let notices = self.view.notices.get_or_insert_with(Vec::new);
                if !notices
                    .iter()
                    .any(|notice| notice.event_id == event.event_id)
                {
                    if notices.len() == 32 {
                        notices.remove(0);
                        self.view.availability = "partial".into();
                    }
                    notices.push(super::native_conversation_generated::NativeTraceNotice {
                        event_id: event.event_id.clone(),
                        sequence: event.sequence.to_string(),
                        method: n.method.clone(),
                        code: n.code.clone().unwrap_or_else(|| "runtime_notice".into()),
                        scope: if n.turn_id.is_some() {
                            "turn"
                        } else {
                            "thread"
                        }
                        .into(),
                        will_retry: n.will_retry,
                        item_id: n.item_id.clone(),
                    });
                }
            }
            _ => self.mark_unavailable("unsupported_notification"),
        }
        if let Some(rows) = n
            .web_search_source_titles
            .as_deref()
            .filter(|_| matches!(n.method.as_str(), "item/completed" | "turn/completed"))
        {
            apply_search_titles(
                &mut self.view,
                rows.iter().map(|row| {
                    (
                        row.search_item_id.as_str(),
                        row.url.as_str(),
                        row.title.as_str(),
                    )
                }),
            )?;
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
    let mut event:NativeEvent=serde_json::from_value(serde_json::json!({"schema_version":13,"event_id":Uuid::from_u128(101),"stream_id":Uuid::from_u128(100),"sequence":1,"occurred_at":"2026-09-08T00:00:00Z","task_id":context.task_id,"agent_session_id":context.agent_session_id,"codex_thread_id":context.codex_thread_id,"event_type":"native.notification","terminal":false,"payload":{"native":{"source":"runtime_notification","method":"item/started","threadId":context.codex_thread_id,"turnId":context.runtime_turn_id,"availability":"available","item":{"id":"display-probe","type":"agentMessage","text":"","phase":"final_answer","availability":"available"}}}})).map_err(|_|ChatError::InvalidInput)?;
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

    // Optional current-task capture replay. Reads only the explicitly supplied
    // real Runtime/Host evidence; never opens the user's database or calls a model.
    #[test]
    #[ignore = "requires an explicitly selected real-provider capture"]
    fn context_window_real_native_frames_preserve_context_identity() {
        let input =
            std::env::var("YIJIE_CONTEXT_WINDOW_CAPTURE").expect("real-provider capture required");
        let path = std::path::Path::new(&input);
        assert!(path.is_absolute());
        let capture: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let observations = capture["observations"].as_array().unwrap();
        let started = observations
            .iter()
            .find(|value| {
                value["method"] == "item/started"
                    && value["source"]["item"]["type"] == "contextCompaction"
            })
            .unwrap();
        let completed = observations
            .iter()
            .find(|value| {
                value["method"] == "item/completed"
                    && value["source"]["item"]["type"] == "contextCompaction"
            })
            .unwrap();
        let item_id = started["source"]["item"]["id"].as_str().unwrap();
        let runtime_turn_id = started["source"]["turnId"].as_str().unwrap();
        let events: Vec<NativeEvent> =
            serde_json::from_value(capture["native_events"].clone()).unwrap();
        let first = events
            .iter()
            .position(|event| event.payload.native.turn_id.as_deref() == Some(runtime_turn_id))
            .unwrap();
        let last = events
            .iter()
            .rposition(|event| event.payload.native.turn_id.as_deref() == Some(runtime_turn_id))
            .unwrap();
        let initial = &events[first];
        let context = ActiveTurnContext {
            session_id: Uuid::now_v7(),
            task_id: Uuid::parse_str(&initial.task_id).unwrap(),
            turn_id: Uuid::now_v7(),
            turn_operation_id: Uuid::now_v7(),
            agent_session_id: Uuid::parse_str(&initial.agent_session_id).unwrap(),
            codex_thread_id: Uuid::parse_str(&initial.codex_thread_id).unwrap(),
            runtime_turn_id: Uuid::parse_str(runtime_turn_id).unwrap(),
            assistant_text: String::new(),
            cursor: None,
        };
        let mut buffer = NativeDisplayBuffer::new(context, None).unwrap();
        let mut frames = Vec::new();
        for event in &events[first..=last] {
            buffer.observe(event).unwrap();
            let n = &event.payload.native;
            if n.item.as_ref().is_some_and(|item| item.id == item_id)
                && matches!(n.method.as_str(), "item/started" | "item/completed")
            {
                let observation = if n.method == "item/started" {
                    started
                } else {
                    completed
                };
                frames.push(serde_json::json!({"view": buffer.view, "snapshot": observation["snapshot"], "method": n.method}));
            }
        }
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0]["snapshot"]["sample"], serde_json::Value::Null);
        assert_eq!(
            frames[0]["snapshot"]["compactions"][0]["state"],
            "in_progress"
        );
        assert_eq!(
            frames[1]["snapshot"]["compactions"][0]["state"],
            "completed"
        );
        assert_eq!(
            frames[0]["view"]["runtimeThreadId"],
            frames[1]["view"]["runtimeThreadId"]
        );
        assert_eq!(
            frames[0]["view"]["runtimeTurnId"],
            frames[1]["view"]["runtimeTurnId"]
        );
        std::fs::write(
            path.with_file_name("native-frames.json"),
            serde_json::to_vec_pretty(&frames).unwrap(),
        )
        .unwrap();
    }
    fn event(sequence: i64, method: &str, payload: serde_json::Value) -> NativeEvent {
        let c = context();
        let mut n = serde_json::json!({"source":"runtime_notification","method":method,"threadId":c.codex_thread_id,"turnId":c.runtime_turn_id,"availability":"available"});
        for (k, v) in payload.as_object().unwrap() {
            n[k] = v.clone()
        }
        serde_json::from_value(serde_json::json!({"schema_version":13,"event_id":Uuid::from_u128(100+sequence as u128),"stream_id":Uuid::from_u128(99),"sequence":sequence,"occurred_at":"2026-09-08T00:00:00Z","task_id":c.task_id,"agent_session_id":c.agent_session_id,"codex_thread_id":c.codex_thread_id,"event_type":"native.notification","terminal":method=="turn/completed","payload":{"native":n}})).unwrap()
    }
    #[test]
    fn search_titles_preserve_large_research_in_live_and_deferred_views() {
        use super::super::native_conversation_generated::NativeTurn;
        let mut live = NativeDisplayBuffer::new(context(), None).unwrap();
        let mut titles = Vec::new();
        let mut history = Vec::new();
        for call in 0..14 {
            let id = format!("city-{call}");
            let mut sources = Vec::new();
            let mut labeled = Vec::new();
            for source in 0..10 {
                let url = format!("https://example.org/city/{call}/{source}");
                let title = format!("城市来源 {call}/{source}");
                sources.push(serde_json::json!({"url":url}));
                labeled.push(serde_json::json!({"url":url,"title":title}));
                titles.push(serde_json::json!({"searchItemId":id,"url":url,"title":title}));
            }
            let mut item = serde_json::json!({"id":id,"type":"webSearch","availability":"available","webSearch":{"action":"search","queries":[id],"sources":sources}});
            live.observe(&event(
                call + 1,
                "item/completed",
                serde_json::json!({"item":item}),
            ))
            .unwrap();
            item["webSearch"]["sources"] = serde_json::Value::Array(labeled);
            history.push(item);
        }
        let mut deferred = live.view.clone();
        let turn = serde_json::json!({"id":context().runtime_turn_id,"status":"completed","items":[],"itemsComplete":false});
        live.observe(&event(
            15,
            "turn/completed",
            serde_json::json!({"turn":turn,"webSearchSourceTitles":titles}),
        ))
        .unwrap();
        let src: NativeTurn=serde_json::from_value(serde_json::json!({"id":context().runtime_turn_id,"status":"completed","items":history,"itemsComplete":false})).unwrap();
        apply_history_search_titles(&mut deferred, &src).unwrap();
        for (observed, restored) in live.view.items.iter().zip(&deferred.items) {
            assert_eq!(observed, restored);
            assert!(observed
                .item
                .web_search
                .as_ref()
                .unwrap()
                .sources
                .as_ref()
                .unwrap()
                .iter()
                .all(|s| s.title.is_some()));
        }
        assert_eq!(live.view.items.len(), 14);
    }

    #[test]
    fn search_titles_update_only_original_urls_and_survive_reopen() {
        let mut buffer = NativeDisplayBuffer::new(context(), None).unwrap();
        let search = |id: &str, url: &str| {
            serde_json::json!({"item":{
            "id":id,"type":"webSearch","availability":"available",
            "webSearch":{"action":"search","queries":[id],"sources":[{"url":url}]}}})
        };
        let sh = "https://example.org/shanghai";
        let bj = "https://example.org/beijing";
        buffer
            .observe(&event(1, "item/completed", search("sh", sh)))
            .unwrap();
        buffer
            .observe(&event(2, "item/completed", search("bj", bj)))
            .unwrap();
        let done = event(
            3,
            "turn/completed",
            serde_json::json!({
                "turn":{"id":context().runtime_turn_id,"status":"completed","items":[],"itemsComplete":false},
                "webSearchSourceTitles":[{"searchItemId":"sh","url":bj,"title":"北京"},
                    {"searchItemId":"bj","url":bj,"title":"北京"},{"searchItemId":"sh","url":sh,"title":"上海"}]
            }),
        );
        buffer.observe(&done).unwrap();
        assert!(!buffer.observe(&done).unwrap());
        let encoded = serde_json::to_string(&buffer.view).unwrap();
        let saved =
            super::super::native_conversation_storage::decode_native_view(&encoded, 8).unwrap();
        let rows: Vec<_> = saved
            .items
            .iter()
            .map(|entry| {
                let sources = entry
                    .item
                    .web_search
                    .as_ref()
                    .unwrap()
                    .sources
                    .as_ref()
                    .unwrap();
                assert_eq!(sources.len(), 1);
                assert_eq!(entry.last_method, "item/completed");
                (
                    entry.item.id.as_str(),
                    sources[0].url.as_str(),
                    sources[0].title.as_deref(),
                )
            })
            .collect();
        assert_eq!(rows, [("sh", sh, Some("上海")), ("bj", bj, Some("北京"))]);
    }

    #[test]
    fn mcp_rows_keep_the_observed_start_on_completion_and_reopen() {
        let mut buffer = NativeDisplayBuffer::new(context(), None).unwrap();
        let item = |id: &str, status: &str| serde_json::json!({"item":{"id":id,"type":"mcpToolCall","status":status,"availability":"available","mcp":{"server":"weather","tool":"forecast","resultKind":"absent","texts":[],"diagnostics":[]}}});
        let first = event(1, "item/started", item("a", "inProgress"));
        let start = chrono::DateTime::parse_from_rfc3339(&first.occurred_at)
            .unwrap()
            .timestamp_millis();
        buffer.observe(&first).unwrap();
        let mut duplicate = event(2, "item/started", item("a", "inProgress"));
        duplicate.occurred_at = "2026-09-08T01:00:00Z".into();
        buffer.observe(&duplicate).unwrap();
        buffer
            .observe(&event(3, "item/completed", item("a", "completed")))
            .unwrap();
        buffer
            .observe(&event(4, "item/completed", item("b", "completed")))
            .unwrap();
        let encoded = serde_json::to_string(&buffer.view).unwrap();
        let saved =
            super::super::native_conversation_storage::decode_native_view(&encoded, 8).unwrap();
        assert_eq!(saved.items.len(), 2);
        assert_eq!(saved.items[0].call_started_at_ms, Some(start));
        assert_eq!(saved.items[1].call_started_at_ms, None);
        assert!(
            super::super::native_conversation_storage::decode_native_view(&encoded, 7).is_err()
        );
        let mut legacy = saved;
        super::super::native_conversation_storage::strip_mcp_call_times(&mut legacy);
        assert!(
            super::super::native_conversation_storage::decode_native_view(
                &serde_json::to_string(&legacy).unwrap(),
                7
            )
            .is_ok()
        );
    }
    #[test]
    fn market_late_items_keep_original_turn_and_wait_for_each_started_call() {
        let mut buffer = NativeDisplayBuffer::new(context(), None).unwrap();
        let item = |id, server, status| serde_json::json!({"item":{"id":id,"type":"mcpToolCall","status":status,"availability":"available","mcp":{"server":server,"tool":"sample","resultKind":"omitted","texts":[],"diagnostics":[]}}});
        buffer
            .observe(&event(
                1,
                "item/started",
                item("other", "other_server", "inProgress"),
            ))
            .unwrap();
        assert!(!buffer.has_pending_market_items());
        for (sequence, id) in [(2, "one"), (3, "two")] {
            buffer
                .observe(&event(
                    sequence,
                    "item/started",
                    item(id, "yijie_market", "inProgress"),
                ))
                .unwrap();
        }
        buffer.observe(&event(4, "turn/completed", serde_json::json!({"turn":{"id":context().runtime_turn_id,"status":"interrupted","items":[],"itemsComplete":false}}))).unwrap();
        assert!(buffer.has_pending_market_items());
        let mut foreign = event(
            5,
            "item/completed",
            item("one", "yijie_market", "completed"),
        );
        foreign.payload.native.turn_id = Some(Uuid::now_v7().to_string());
        assert!(
            !buffer.observe(&foreign).unwrap(),
            "foreign traffic cannot publish the old view"
        );
        assert_eq!(buffer.view.cursor.as_ref().unwrap().sequence, "5");
        assert_eq!(buffer.view.items[1].last_method, "item/started");
        buffer
            .observe(&event(
                6,
                "item/completed",
                item("one", "yijie_market", "failed"),
            ))
            .unwrap();
        assert!(buffer.has_pending_market_items());
        buffer
            .observe(&event(
                7,
                "item/completed",
                item("two", "yijie_market", "failed"),
            ))
            .unwrap();
        assert!(!buffer.has_pending_market_items());
        assert!(buffer.view.terminal_observed);
        assert_eq!(buffer.view.status.as_deref(), Some("interrupted"));
        assert_eq!(buffer.view.items[1].item.status.as_deref(), Some("failed"));
        assert_eq!(
            buffer.view.runtime_turn_id,
            context().runtime_turn_id.to_string()
        );
    }
    #[test]
    fn native_output_policy_notice_keeps_subsequent_lifecycle_authoritative() {
        let mut b = NativeDisplayBuffer::new(context(), None).unwrap();
        b.observe(&event(1,"turn/started",serde_json::json!({"turn":{"id":context().runtime_turn_id,"status":"inProgress","items":[],"itemsComplete":false}}))).unwrap();
        b.observe(&event(2,"item/started",serde_json::json!({"item":{"id":"command","type":"commandExecution","status":"inProgress","availability":"available"}}))).unwrap();
        b.observe(&event(3,"projection/error",serde_json::json!({"source":"projection_notice","code":"command_output_pending_final","itemId":"command","availability":"partial"}))).unwrap();
        b.observe(&event(4,"item/completed",serde_json::json!({"item":{"id":"command","type":"commandExecution","status":"completed","exitCode":0,"outputText":"ordinary output","availability":"available"}}))).unwrap();
        b.observe(&event(5,"item/started",serde_json::json!({"item":{"id":"tool","type":"mcpToolCall","status":"inProgress","availability":"partial"}}))).unwrap();
        assert_eq!(b.view.diagnostic, None);
        assert_eq!(b.view.status.as_deref(), Some("inProgress"));
        assert!(!b.view.terminal_observed);
        assert_eq!(b.view.items.len(), 2);
        assert_eq!(b.view.items[1].item.status.as_deref(), Some("inProgress"));
        assert_eq!(
            b.view.items[0].item.output_text.as_deref(),
            Some("ordinary output")
        );
        // A pre-existing historical continuity diagnostic is never healed by
        // receiving a non-fatal content-policy notification.
        b.view.diagnostic = Some("stream_gap".into());
        b.observe(&event(6,"projection/error",serde_json::json!({"source":"projection_notice","code":"command_output_pending_final","itemId":"command"}))).unwrap();
        assert_eq!(b.view.diagnostic.as_deref(), Some("stream_gap"));
    }

    #[test]
    fn feat144_native_tool_replacement_keeps_new_status_at_display_capacity() {
        let mut buffer = NativeDisplayBuffer::new(context(), None).unwrap();
        for index in 0..15 {
            buffer.observe(&event(index+1,"item/completed",serde_json::json!({"item":{"id":format!("ordinary-{index}"),"type":"agentMessage","availability":"available","text":"a".repeat(256*1024)}}))).unwrap();
        }
        let item = |status: &str, text: String| serde_json::json!({"item":{"id":"native-tool","type":"mcpToolCall","availability":"available","status":status,"mcp":{"server":"sorftime","tool":"product_detail","resultKind":"text","texts":[{"index":2,"text":text}],"diagnostics":[]}}});
        let mut started = event(16, "item/started", item("inProgress", String::new()));
        started.schema_version = 13;
        buffer.observe(&started).unwrap();
        let mut completed = event(
            17,
            "item/completed",
            item("completed", "b".repeat(256 * 1024)),
        );
        completed.schema_version = 13;
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
        empty.schema_version = 13;
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
    fn native_trace_retry_intent_and_notice_scope_do_not_end_the_turn() {
        let mut buffer = NativeDisplayBuffer::new(context(), None).unwrap();
        for (sequence, value) in [
            (1, serde_json::json!(true)),
            (2, serde_json::json!(false)),
            (3, serde_json::Value::Null),
        ] {
            let notice = event(
                sequence,
                "error",
                serde_json::json!({"code":"transport_error","willRetry":value}),
            );
            buffer.observe(&notice).unwrap();
            assert!(!buffer.view.terminal_observed);
        }
        let mut notice = event(4, "warning", serde_json::json!({"code":"runtime_warning"}));
        notice.payload.native.turn_id = None;
        buffer.observe(&notice).unwrap();
        assert_eq!(
            buffer
                .view
                .notices
                .as_ref()
                .unwrap()
                .iter()
                .map(|n| n.will_retry)
                .collect::<Vec<_>>(),
            vec![Some(true), Some(false), None, None]
        );
        assert_eq!(buffer.view.notices.as_ref().unwrap()[3].scope, "thread");
        assert!(!buffer.observe(&notice).unwrap());
        assert_eq!(buffer.view.notices.as_ref().unwrap().len(), 4);
    }

    #[test]
    fn public_preview_is_ephemeral_offset_checked_and_reconciled() {
        let mut buffer = NativeDisplayBuffer::new(context(), None).unwrap();
        let start = serde_json::json!({"turn":{"id":context().runtime_turn_id,"status":"inProgress","items":[],"itemsComplete":false}});
        buffer.observe(&event(1, "turn/started", start)).unwrap();
        let part = |sequence, offset, delta: &str| {
            event(
                sequence,
                "item/agentMessage/previewDelta",
                serde_json::json!({"itemId":"a","previewOffset":offset,"delta":delta}),
            )
        };
        assert!(buffer.observe(&part(2, 0, "第一")).unwrap());
        assert!(!buffer.observe(&part(2, 0, "第一")).unwrap());
        assert!(buffer.observe(&part(3, 6, "段")).unwrap());
        assert_eq!(buffer.previews()[0].text, "第一段");
        assert!(buffer.view.items.is_empty());
        let mut reopened = NativeDisplayBuffer::new(context(), Some(buffer.view.clone())).unwrap();
        assert!(reopened.previews().is_empty());
        assert!(!reopened.observe(&part(4, 9, "后文")).unwrap());
        let item = |body| serde_json::json!({"item":{"id":"a","type":"agentMessage","text":body,"phase":"commentary","availability":"available"}});
        buffer.observe(&event(4, "item/started", item(""))).unwrap();
        buffer
            .observe(&event(5, "item/completed", item("第一段")))
            .unwrap();
        assert!(buffer.previews().is_empty());
        assert_eq!(buffer.view.items.len(), 1);
        assert_eq!(
            buffer.view.items[0].item.phase.as_deref(),
            Some("commentary")
        );
        assert!(!buffer.observe(&part(6, 9, "迟到")).unwrap());
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
    fn native_completed_unknown_phase_replaces_a_provisional_declaration() {
        let mut b = NativeDisplayBuffer::new(context(), None).unwrap();
        b.observe(&event(1,"item/started",serde_json::json!({"item":{"id":"a","type":"agentMessage","text":"","phase":"commentary","availability":"available"}}))).unwrap();
        b.observe(&event(
            2,
            "item/agentMessage/delta",
            serde_json::json!({"itemId":"a","delta":"开场与可读结果。"}),
        ))
        .unwrap();
        b.observe(&event(3,"item/completed",serde_json::json!({"item":{"id":"a","type":"agentMessage","text":"开场与可读结果。","availability":"available"}}))).unwrap();
        assert_eq!(b.view.items.len(), 1);
        assert_eq!(b.view.items[0].item.id, "a");
        assert_eq!(b.view.items[0].item.phase, None);
        assert_eq!(
            b.view.items[0].item.text.as_deref(),
            Some("开场与可读结果。")
        );
        assert!(!b.view.terminal_observed);
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

/// Downgrade only the copy sent to legacy IPC readers.
pub(crate) fn strip_publication(view: &mut NativeConversationView) {
    for entry in &mut view.items {
        let item = &mut entry.item;
        item.publication = None;
        if item.kind == "unpublishedText" {
            item.kind = "unknown".into();
            item.text = None;
            item.availability = "unavailable".into();
        }
    }
}
