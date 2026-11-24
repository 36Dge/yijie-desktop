use super::database::{ActiveTurnContext, ChatRepository};
use super::error::ChatError;
use super::native_conversation_generated::{
    NativeConversationView, NativeEvent, NativeRecordDiagnostic, NativeViewRecords,
};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

// Explicit versioned writer. Old readers retain their format-unsupported guard;
// existing records are decoded in place and are never migrated on read.
pub const NATIVE_WRITE_FORMAT: i64 = 6;
pub(crate) const PUBLICATION_FORMAT: i64 = 7;
const MCP_CLOCK_FORMAT: i64 = 8;

pub(crate) fn has_publication(view: &NativeConversationView) -> bool {
    view.items
        .iter()
        .any(|entry| entry.item.publication.is_some() || entry.item.kind == "unpublishedText")
}

fn compatible_format(format: i64) -> bool {
    matches!(
        format,
        NATIVE_WRITE_FORMAT | PUBLICATION_FORMAT | MCP_CLOCK_FORMAT
    )
}

fn fact_format(view: &NativeConversationView, previous: Option<(i64, i64)>) -> i64 {
    if has_publication(view) || previous.is_some_and(|(_, format)| format == PUBLICATION_FORMAT) {
        PUBLICATION_FORMAT
    } else {
        NATIVE_WRITE_FORMAT
    }
}

fn saved_format(view: &NativeConversationView, previous: Option<(i64, i64)>) -> i64 {
    if view
        .items
        .iter()
        .any(|entry| entry.call_started_at_ms.is_some())
        || previous.is_some_and(|(_, format)| format == MCP_CLOCK_FORMAT)
    {
        MCP_CLOCK_FORMAT
    } else {
        fact_format(view, previous)
    }
}

pub(super) fn strip_mcp_call_times(view: &mut NativeConversationView) {
    for entry in &mut view.items {
        entry.call_started_at_ms = None;
    }
}

pub(crate) fn decode_native_view(
    json: &str,
    format: i64,
) -> Result<NativeConversationView, ChatError> {
    if !compatible_format(format) {
        return Err(ChatError::DatabaseUnavailable);
    }
    let view = serde_json::from_str(json).map_err(|_| ChatError::DatabaseUnavailable)?;
    if format == NATIVE_WRITE_FORMAT && has_publication(&view)
        || view.items.iter().any(|entry| {
            entry.call_started_at_ms.is_some_and(|ms| {
                format != MCP_CLOCK_FORMAT
                    || entry.item.kind != "mcpToolCall"
                    || !(0..=253_402_300_799_999).contains(&ms)
            })
        })
    {
        return Err(ChatError::DatabaseUnavailable);
    }
    Ok(view)
}

// A terminal read may supply a display title that an older Host did not
// preserve. Enrich the returned copy only; the saved facts remain authoritative.
fn read_historical_mcp_titles(
    view: &mut NativeConversationView,
    turn: &super::native_conversation_generated::NativeTurn,
) -> Result<(), ChatError> {
    use super::native_conversation_generated::NativeToolDisplay;
    use std::collections::HashMap;
    let by_id: HashMap<_, _> = turn
        .items
        .iter()
        .filter(|item| {
            item.kind == "mcpToolCall"
                && item
                    .tool_display
                    .as_ref()
                    .is_some_and(|d| d.provenance == "registeredTool" && d.title.is_some())
        })
        .map(|item| (item.id.as_str(), item))
        .collect();
    if by_id.is_empty() {
        return Ok(());
    }
    let mut remaining = super::native_conversation::MAX_VIEW_BYTES.saturating_sub(
        serde_json::to_vec(&view)
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .len(),
    );
    for entry in &mut view.items {
        let item = &mut entry.item;
        let Some(saved) = item.mcp.as_ref() else {
            continue;
        };
        let Some(other) = by_id.get(item.id.as_str()) else {
            continue;
        };
        let Some(current) = other.mcp.as_ref() else {
            continue;
        };
        let Some(title) = other.tool_display.as_ref().and_then(|d| d.title.as_deref()) else {
            continue;
        };
        if item.kind != "mcpToolCall"
            || item.status != other.status
            || saved.server.is_none()
            || saved.tool.is_none()
            || saved.server != current.server
            || saved.tool != current.tool
        {
            continue;
        }
        if let Some(old) = item
            .tool_display
            .as_ref()
            .filter(|d| d.provenance == "registeredTool")
            .and_then(|d| d.title.as_deref())
        {
            // Keep an original specific title. An older action without the target may be extended.
            if !title
                .strip_prefix(old)
                .is_some_and(|suffix| suffix.starts_with(" · "))
            {
                continue;
            }
        }
        let new_display = NativeToolDisplay {
            provenance: "registeredTool".into(),
            title: Some(title.to_owned()),
            source_label: item
                .tool_display
                .as_ref()
                .and_then(|d| d.source_label.clone()),
        };
        let size = serde_json::to_vec(&new_display)
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .len()
            + 15;
        if size <= remaining {
            item.tool_display = Some(new_display);
            remaining -= size;
        }
    }
    Ok(())
}

impl ChatRepository {
    pub fn native_host_origin(
        &self,
        session_id: Uuid,
        turn_id: Uuid,
    ) -> Result<Option<String>, ChatError> {
        self.session_summary(session_id)?;
        self.connection.query_row("SELECT host_instance_nonce FROM chat_native_bindings WHERE session_id=?1 AND turn_id=?2",params![session_id.to_string(),turn_id.to_string()],|r|r.get(0)).optional().map_err(|_|ChatError::DatabaseUnavailable).map(Option::flatten)
    }

    pub fn native_thread_binding(&self, session_id: Uuid) -> Result<Option<Uuid>, ChatError> {
        self.session_summary(session_id)?;
        let id: Option<String> = self
            .connection
            .query_row(
                "SELECT agent_session_id FROM chat_sessions WHERE id=?1",
                [session_id.to_string()],
                |r| r.get(0),
            )
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        id.map(|id| Uuid::parse_str(&id).map_err(|_| ChatError::DatabaseUnavailable))
            .transpose()
    }

    /// Active execution cannot treat an unsupported saved record as absent.
    pub fn native_views(
        &self,
        session_id: Uuid,
        turn_ids: &[Uuid],
    ) -> Result<Vec<NativeConversationView>, ChatError> {
        let records = self.native_view_records(session_id, turn_ids)?;
        if !records.record_diagnostics.is_empty() {
            return Err(ChatError::ConversationConflict);
        }
        Ok(records.views)
    }

    pub fn native_view_records(
        &self,
        session_id: Uuid,
        turn_ids: &[Uuid],
    ) -> Result<NativeViewRecords, ChatError> {
        self.session_summary(session_id)?;
        if turn_ids.len() > 50 {
            return Err(ChatError::InvalidInput);
        }
        let mut result = NativeViewRecords {
            views: Vec::new(),
            record_diagnostics: Vec::new(),
        };
        for id in turn_ids {
            let row: Option<(String, i64)> = self.connection.query_row(
                "SELECT view_json,format_version FROM chat_native_views WHERE session_id=?1 AND turn_id=?2",
                params![session_id.to_string(), id.to_string()], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional().map_err(|_| ChatError::DatabaseUnavailable)?;
            if let Some((json, version)) = row {
                if !compatible_format(version) {
                    result.record_diagnostics.push(NativeRecordDiagnostic {
                        session_id: session_id.to_string(),
                        turn_id: id.to_string(),
                        format_version: version,
                        code: "format_unsupported".into(),
                    });
                    continue;
                }
                let view = decode_native_view(&json, version)?;
                if view.session_id != session_id.to_string() || view.turn_id != id.to_string() {
                    return Err(ChatError::ConversationConflict);
                }
                result.views.push(view);
            }
        }
        Ok(result)
    }

    pub fn local_submissions(
        &self,
        session_id: Uuid,
        turn_ids: &[Uuid],
    ) -> Result<Vec<super::native_conversation_generated::LocalSubmissionView>, ChatError> {
        self.session_summary(session_id)?;
        if turn_ids.len() > 50 {
            return Err(ChatError::InvalidInput);
        }
        let mut result = Vec::new();
        for id in turn_ids {
            let row:Option<(String,String)>=self.connection.query_row("SELECT operation_id,submission_status FROM chat_turns WHERE session_id=?1 AND id=?2 AND submission_status IS NOT NULL",params![session_id.to_string(),id.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|_|ChatError::DatabaseUnavailable)?;
            if let Some((operation_id, mut status)) = row {
                if status == "queued"
                    && super::schedules::drafts::unresolved_create_submission(
                        &self.connection,
                        &self.scope,
                        session_id,
                        *id,
                    )?
                {
                    status = "uncertain".into();
                }
                result.push(super::native_conversation_generated::LocalSubmissionView {
                    turn_id: id.to_string(),
                    operation_id,
                    status,
                })
            }
        }
        Ok(result)
    }

    pub fn native_recovery_views(
        &mut self,
        session_id: Uuid,
        turn_ids: &[Uuid],
        snapshot: Option<&super::native_conversation_generated::NativeThreadSnapshot>,
        recover: bool,
    ) -> Result<Vec<NativeConversationView>, ChatError> {
        let result = self.native_recovery_records(session_id, turn_ids, snapshot, recover)?;
        if !result.record_diagnostics.is_empty() {
            return Err(ChatError::ConversationConflict);
        }
        Ok(result.views)
    }

    pub fn native_recovery_records(
        &mut self,
        session_id: Uuid,
        turn_ids: &[Uuid],
        snapshot: Option<&super::native_conversation_generated::NativeThreadSnapshot>,
        recover: bool,
    ) -> Result<NativeViewRecords, ChatError> {
        let records = self.native_view_records(session_id, turn_ids)?;
        let mut views = records.views;
        let record_diagnostics = records.record_diagnostics;
        for view in &mut views {
            let rebuilt = snapshot
                .filter(|s| s.thread_id == view.runtime_thread_id)
                .and_then(|s| s.turns.iter().find(|t| t.id == view.runtime_turn_id));
            if let Some(turn) = rebuilt {
                if !recover
                    && matches!(
                        view.status.as_deref(),
                        Some("completed" | "failed" | "interrupted")
                    )
                    && turn.status == view.status
                {
                    read_historical_mcp_titles(view, turn)?;
                }
                if view.terminal_observed {
                    if turn.status != view.status {
                        view.availability = "partial".into();
                        view.diagnostic = Some("history_source_conflict".into());
                    }
                    continue;
                }
                if !recover {
                    continue;
                }
                if let Some(status) = &turn.status {
                    if matches!(status.as_str(), "completed" | "failed" | "interrupted")
                        && (view.status.as_ref() != Some(status)
                            || view.status_source.as_deref() != Some("runtime_read"))
                    {
                        view.status = Some(status.clone());
                        view.status_source = Some("runtime_read".into());
                        view.availability = "partial".into();
                        view.diagnostic = Some("native_history_partial".into());
                        self.persist_native_read_status(view, turn)?;
                    }
                }
            }
        }
        for id in turn_ids {
            if views.iter().any(|v| v.turn_id == id.to_string())
                || record_diagnostics
                    .iter()
                    .any(|d| d.turn_id == id.to_string())
            {
                continue;
            }
            let binding:Option<(String,String,i64)>=self.connection.query_row("SELECT b.runtime_thread_id,b.runtime_turn_id,(SELECT COUNT(*) FROM chat_turns older WHERE older.session_id=b.session_id AND older.id<b.turn_id) FROM chat_native_bindings b WHERE b.session_id=?1 AND b.turn_id=?2",params![session_id.to_string(),id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|_|ChatError::DatabaseUnavailable)?;
            let Some((thread, turn, ordinal)) = binding else {
                continue;
            };
            let rebuilt = snapshot
                .filter(|s| s.thread_id == thread)
                .and_then(|s| s.turns.iter().find(|t| t.id == turn));
            views.push(NativeConversationView {
                session_id: session_id.to_string(),
                turn_id: id.to_string(),
                runtime_thread_id: thread,
                runtime_turn_id: turn,
                ordinal: Some(ordinal),
                source: "native_rebuilt".into(),
                revision: "0".into(),
                availability: if rebuilt.is_some() {
                    "partial"
                } else {
                    "unavailable"
                }
                .into(),
                // Cold history is available for display, but cannot confirm an observed terminal.
                status: rebuilt.and_then(|t| t.status.clone()),
                status_source: rebuilt.map(|_| "runtime_read".into()),
                terminal_observed: false,
                items: rebuilt
                    .map(|t| {
                        t.items
                            .iter()
                            .enumerate()
                            .map(|(ordinal, item)| {
                                super::native_conversation_generated::NativeDisplayItem {
                                    item: item.clone(),
                                    ordinal: ordinal as i64,
                                    last_method: "thread/read".into(),
                                    call_started_at_ms: None,
                                }
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                notices: None,
                plan: None,
                explanation: None,
                diagnostic: Some("native_history_partial".into()),
                cursor: None,
                terminal_error_code: rebuilt.and_then(|t| t.error_code.clone()),
            });
            if let Some(view) = views.last_mut() {
                super::native_conversation::bound_read_view(view)?;
            }
            if let Some(turn) = rebuilt {
                if recover
                    && turn
                        .status
                        .as_deref()
                        .is_some_and(|s| matches!(s, "completed" | "failed" | "interrupted"))
                {
                    self.persist_native_read_status(
                        views.last_mut().ok_or(ChatError::DatabaseUnavailable)?,
                        turn,
                    )?;
                }
            }
        }
        Ok(NativeViewRecords {
            views,
            record_diagnostics,
        })
    }

    fn persist_native_read_status(
        &mut self,
        view: &mut NativeConversationView,
        turn: &super::native_conversation_generated::NativeTurn,
    ) -> Result<(), ChatError> {
        let Some(status) = &turn.status else {
            return Ok(());
        };
        if view.terminal_observed
            || !matches!(status.as_str(), "completed" | "failed" | "interrupted")
        {
            return Ok(());
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .as_secs() as i64;
        let tx = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let revision_row: Option<(i64, i64)> = tx
            .query_row(
                "SELECT revision,format_version FROM chat_native_views WHERE turn_id=?1",
                [&view.turn_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if revision_row.is_some_and(|(_, v)| !compatible_format(v)) {
            return Err(ChatError::ConversationConflict);
        }
        let format = saved_format(view, revision_row);
        let revision = revision_row.map(|(r, _)| r);
        let revision = revision
            .unwrap_or(0)
            .checked_add(1)
            .ok_or(ChatError::DatabaseUnavailable)?;
        view.revision = revision.to_string();
        // This is explicitly a read observation, never a fabricated notification.
        let mut fact_turn = turn.clone();
        fact_turn.items.clear();
        fact_turn.items_complete = false;
        let fact = super::native_conversation_generated::NativeThreadSnapshot {
            schema_version: NATIVE_WRITE_FORMAT,
            source: "runtime_read".into(),
            thread_id: view.runtime_thread_id.clone(),
            turns: vec![fact_turn],
            availability: "partial".into(),
        };
        tx.execute("INSERT INTO chat_native_facts(turn_id,event_id,method,fact_json,format_version) VALUES(?1,?2,'thread/read',?3,?4)",params![view.turn_id,format!("local-read:{}",Uuid::now_v7()),serde_json::to_string(&fact).map_err(|_|ChatError::DatabaseUnavailable)?,fact_format(view, revision_row)]).map_err(|_|ChatError::DatabaseUnavailable)?;
        tx.execute("INSERT INTO chat_native_views(turn_id,session_id,source,revision,view_json,format_version) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(turn_id) DO UPDATE SET source=excluded.source,revision=excluded.revision,view_json=excluded.view_json,format_version=excluded.format_version",params![view.turn_id,view.session_id,view.source,revision,serde_json::to_string(view).map_err(|_|ChatError::DatabaseUnavailable)?,format]).map_err(|_|ChatError::DatabaseUnavailable)?;
        tx.execute(
            "UPDATE chat_turns SET status=?1 WHERE id=?2 AND runtime_turn_id=?3",
            params![status, view.turn_id, view.runtime_turn_id],
        )
        .map_err(|_| ChatError::DatabaseUnavailable)?;
        super::schedules::recovery::native_terminal(
            &tx,
            &view.turn_id,
            &view.runtime_turn_id,
            status,
        )?;
        // Native history confirms it ended, but provides no trustworthy completion time.
        tx.execute("UPDATE chat_outbox SET state='done',next_attempt_at=NULL WHERE operation_id=(SELECT operation_id FROM chat_turns WHERE id=?1) AND kind='start_turn' AND state='inflight'",[&view.turn_id]).map_err(|_|ChatError::DatabaseUnavailable)?;
        tx.execute(
            "UPDATE chat_sessions SET last_activity_at=MAX(last_activity_at,?1) WHERE id=?2",
            params![now, view.session_id],
        )
        .map_err(|_| ChatError::DatabaseUnavailable)?;
        tx.commit().map_err(|_| ChatError::DatabaseUnavailable)
    }

    pub fn commit_native_view(
        &mut self,
        context: &ActiveTurnContext,
        mut view: NativeConversationView,
        event: Option<&NativeEvent>,
        now: i64,
    ) -> Result<NativeConversationView, ChatError> {
        self.session_summary(context.session_id)?;
        if view.session_id != context.session_id.to_string()
            || view.turn_id != context.turn_id.to_string()
            || !matches!(view.source.as_str(), "native_observed" | "native_rebuilt")
            || now < 0
        {
            return Err(ChatError::ConversationConflict);
        }
        let (runtime_thread,runtime_turn,ordinal):(String,String,i64)=self.connection.query_row(
            "SELECT s.runtime_thread_id,t.runtime_turn_id,(SELECT COUNT(*) FROM chat_turns older WHERE older.session_id=t.session_id AND older.id<t.id) FROM chat_turns t JOIN chat_sessions s ON s.id=t.session_id WHERE t.id=?1 AND s.id=?2",
            params![context.turn_id.to_string(),context.session_id.to_string()],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(|_|ChatError::DatabaseUnavailable)?;
        if runtime_thread != view.runtime_thread_id || runtime_turn != view.runtime_turn_id {
            return Err(ChatError::ConversationConflict);
        }
        view.ordinal = Some(ordinal);
        let tx = self
            .connection
            .transaction()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let revision_row: Option<(i64, i64)> = tx
            .query_row(
                "SELECT revision,format_version FROM chat_native_views WHERE turn_id=?1",
                [&view.turn_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if revision_row.is_some_and(|(_, v)| !compatible_format(v)) {
            return Err(ChatError::ConversationConflict);
        }
        if event.is_some_and(|e| e.schema_version != 13) {
            return Err(ChatError::ConversationConflict);
        }
        let format = saved_format(&view, revision_row);
        let revision = revision_row.map(|(r, _)| r);
        if revision.unwrap_or(0).to_string() != view.revision {
            return Err(ChatError::ConversationConflict);
        }
        let revision = revision
            .unwrap_or(0)
            .checked_add(1)
            .ok_or(ChatError::DatabaseUnavailable)?;
        view.revision = revision.to_string();
        if let Some(event) = event {
            let n = &event.payload.native;
            if n.source == "runtime_notification"
                && n.thread_id == runtime_thread
                && (n.turn_id.as_deref() == Some(runtime_turn.as_str())
                    || (n.turn_id.is_none() && matches!(n.method.as_str(), "error" | "warning")))
                && matches!(
                    n.method.as_str(),
                    "item/started"
                        | "item/completed"
                        | "turn/started"
                        | "turn/completed"
                        | "turn/plan/updated"
                        | "error"
                        | "warning"
                )
            {
                let fact = serde_json::to_string(n).map_err(|_| ChatError::DatabaseUnavailable)?;
                tx.execute("INSERT OR IGNORE INTO chat_native_facts(turn_id,event_id,method,fact_json,format_version) VALUES (?1,?2,?3,?4,?5)",params![view.turn_id,event.event_id,n.method,fact,fact_format(&view, revision_row)]).map_err(|_|ChatError::DatabaseUnavailable)?;
            }
        }
        let json = serde_json::to_string(&view).map_err(|_| ChatError::DatabaseUnavailable)?;
        tx.execute("INSERT INTO chat_native_views(turn_id,session_id,source,revision,view_json,format_version) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(turn_id) DO UPDATE SET source=excluded.source,revision=excluded.revision,view_json=excluded.view_json,format_version=excluded.format_version",params![view.turn_id,view.session_id,view.source,revision,json,format]).map_err(|_|ChatError::DatabaseUnavailable)?;
        // Only an actual native notification updates execution. Local errors do not.
        if let Some(n) = event.map(|e| &e.payload.native) {
            if n.source == "runtime_notification"
                && n.thread_id == runtime_thread
                && n.turn_id.as_deref() == Some(runtime_turn.as_str())
                && matches!(n.method.as_str(), "turn/started" | "turn/completed")
            {
                if let Some(turn) = &n.turn {
                    if turn.id == runtime_turn {
                        if let Some(status) = &turn.status {
                            let status = match status.as_str() {
                                "inProgress" => "streaming",
                                "completed" => "completed",
                                "failed" => "failed",
                                "interrupted" => "interrupted",
                                _ => return Err(ChatError::OrchestrationUnavailable),
                            };
                            let terminal = n.method == "turn/completed" && status != "streaming";
                            tx.execute("UPDATE chat_turns SET status=?1,terminal_at=?2,terminal_code=?3 WHERE id=?4",params![status,terminal.then_some(now),turn.error_code,view.turn_id]).map_err(|_|ChatError::DatabaseUnavailable)?;
                            if terminal {
                                super::schedules::recovery::native_terminal(
                                    &tx,
                                    &view.turn_id,
                                    &runtime_turn,
                                    status,
                                )?;
                                tx.execute("UPDATE chat_outbox SET state='done',next_attempt_at=NULL WHERE operation_id=?1 AND kind='start_turn' AND state='inflight'",[context.turn_operation_id.to_string()]).map_err(|_|ChatError::DatabaseUnavailable)?;
                            }
                        }
                    }
                }
            }
        }
        tx.execute(
            "UPDATE chat_sessions SET last_activity_at=?1 WHERE id=?2",
            params![now, view.session_id],
        )
        .map_err(|_| ChatError::DatabaseUnavailable)?;
        tx.commit().map_err(|_| ChatError::DatabaseUnavailable)?;
        Ok(view)
    }
}

#[cfg(test)]
mod source_reader_tests {
    use super::*;

    #[test]
    fn native_trace_reads_supported_storage_formats_independently_of_live_ipc() {
        let mut value = serde_json::json!({
            "sessionId":"session","turnId":"turn","runtimeThreadId":"runtime","runtimeTurnId":"runtime-turn",
            "source":"native_observed","revision":"1","availability":"available","status":"completed",
            "statusSource":"runtime_notification","terminalObserved":true,
            "items":[{"ordinal":0,"lastMethod":"item/completed","item":{"id":"search","type":"webSearch","availability":"available","webSearch":{"action":"search","queries":["annual statistics"]}}}]
        });
        let old_json = value.to_string();
        for format in 1..=5 {
            assert!(decode_native_view(&old_json, format).is_err());
        }
        value["items"][0]["item"]["webSearch"]["sources"] = serde_json::json!([{"url":"https://example.org/statistics/2025","title":"Annual statistics"}]);
        let new_json = value.to_string();
        let new = decode_native_view(&new_json, 6).unwrap();
        assert_eq!(
            new.items[0]
                .item
                .web_search
                .as_ref()
                .unwrap()
                .sources
                .as_ref()
                .unwrap()[0]
                .url,
            "https://example.org/statistics/2025"
        );
        assert!(decode_native_view(&new_json, 3).is_err());
        // Storage 7 introduced publication; storage 8 also accepts MCP start clocks.
        assert_eq!(decode_native_view(&new_json, 7).unwrap(), new);
        assert_eq!(decode_native_view(&new_json, 8).unwrap(), new);
        assert!(decode_native_view(&new_json, 9).is_err());
        assert!(!old_json.contains("sources"));
    }

    #[test]
    fn mcp_history_returns_only_the_title_for_each_matching_original_item() {
        use serde_json::json;
        let item = |id: &str, tool: &str| {
            json!({"id":id,"type":"mcpToolCall","status":"completed","availability":"partial","durationMs":450,
            "mcp":{"server":"catalog","tool":tool,"texts":[],"diagnostics":[],"resultKind":"empty"}})
        };
        let stored = json!({"sessionId":"s","turnId":"t","runtimeThreadId":"r","runtimeTurnId":"rt","source":"native_observed",
            "revision":"7","availability":"partial","status":"completed","terminalObserved":true,
            "items":[{"item":item("a","lookup"),"ordinal":0,"lastMethod":"item/completed"},
                     {"item":item("b","lookup"),"ordinal":1,"lastMethod":"item/completed"}]});
        let mut a = item("a", "lookup");
        a["toolDisplay"] = json!({"provenance":"registeredTool","title":"查询库存 · SKU-12"});
        let mut b = item("b", "list");
        b["toolDisplay"] = json!({"provenance":"registeredTool","title":"查看列表"});
        let turn = serde_json::from_value(
            json!({"id":"rt","status":"completed","items":[b,a],"itemsComplete":true}),
        )
        .unwrap();
        let mut view = decode_native_view(&stored.to_string(), 7).unwrap();
        read_historical_mcp_titles(&mut view, &turn).unwrap();
        let mut expected = stored;
        expected["items"][0]["item"]["toolDisplay"] =
            json!({"provenance":"registeredTool","title":"查询库存 · SKU-12"});
        assert_eq!(serde_json::to_value(view).unwrap(), expected);
    }
}
