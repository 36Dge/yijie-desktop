//! Read-only ordinary-chat adapter for the existing native timing endpoint.
use super::database::ChatRepository;
use super::error::ChatError;
use super::host_bridge::HostBridge;
use super::turn_timing_generated::TurnTimingView;
use super::worker::DatabaseWorker;
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct TimingTarget {
    session: Uuid,
    thread: Uuid,
    turn: Uuid,
}

impl ChatRepository {
    pub(super) fn turn_timing_target(
        &self,
        session: Uuid,
        turn: Uuid,
    ) -> Result<Option<TimingTarget>, ChatError> {
        if turn.is_nil() {
            return Err(ChatError::InvalidInput);
        }
        self.session_summary(session)?;
        if self.deletion_status_for_session(session)?.is_some() {
            return Err(ChatError::NotFound);
        }
        // Use only the persisted native binding for this scoped local Turn.
        let row: Option<(String, String, String)> = self
            .connection
            .query_row(
                "SELECT s.agent_session_id, b.runtime_thread_id, b.runtime_turn_id
             FROM chat_native_bindings b
             JOIN chat_sessions s ON s.id=b.session_id
             JOIN chat_turns t ON t.id=b.turn_id AND t.session_id=s.id
             WHERE b.session_id=?1 AND b.turn_id=?2 AND s.agent_session_id IS NOT NULL
               AND s.runtime_thread_id=b.runtime_thread_id AND t.runtime_turn_id=b.runtime_turn_id",
                params![session.to_string(), turn.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        row.map(|(session, thread, turn)| {
            let parse = |id: &str| {
                Uuid::parse_str(id)
                    .ok()
                    .filter(|id| !id.is_nil())
                    .ok_or(ChatError::ConversationConflict)
            };
            Ok(TimingTarget {
                session: parse(&session)?,
                thread: parse(&thread)?,
                turn: parse(&turn)?,
            })
        })
        .transpose()
    }
}

pub(super) async fn read(
    database: &DatabaseWorker,
    host: Option<&HostBridge>,
    session_id: Uuid,
    turn_id: Uuid,
) -> Result<TurnTimingView, ChatError> {
    let target = database
        .call(move |r| r.turn_timing_target(session_id, turn_id))
        .await?;
    let timing = match (host, target) {
        (Some(host), Some(target)) => {
            let timing = host
                .read_native_turn_timing(target.session, target.turn)
                .await
                .map_err(|_| ChatError::SidecarUnavailable)?;
            if !matches_target(&timing, target) {
                return Err(ChatError::ConversationConflict);
            }
            Some(timing)
        }
        _ => None,
    };
    // Deletion, rebinding or scope changes while awaiting Host must not publish a stale fact.
    if database
        .call(move |r| r.turn_timing_target(session_id, turn_id))
        .await?
        != target
    {
        return Err(ChatError::ConversationConflict);
    }
    Ok(TurnTimingView {
        session_id,
        turn_id,
        timing,
    })
}

fn matches_target(
    timing: &super::schedules::timing_generated::NativeTurnTiming,
    target: TimingTarget,
) -> bool {
    timing.agent_session_id == target.session.to_string()
        && timing.thread_id == target.thread.to_string()
        && timing.turn_id == target.turn.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timing_keeps_native_units_and_exact_mapping() {
        let target = TimingTarget {
            session: Uuid::now_v7(),
            thread: Uuid::now_v7(),
            turn: Uuid::now_v7(),
        };
        let timing = serde_json::from_value(serde_json::json!({
            "schema_version":1,"source":"runtime_read", "agent_session_id":target.session,
            "thread_id":target.thread,"turn_id":target.turn,"started_at":{"state":"known","value":100},
            "completed_at":{"state":"known","value":102},"duration_ms":{"state":"known","value":1532}
        })).unwrap();
        assert!(matches_target(&timing, target));
        assert_eq!(timing.duration_ms.value, Some(1532));
        assert!(!matches_target(
            &timing,
            TimingTarget {
                thread: Uuid::now_v7(),
                ..target
            }
        ));
        let view = TurnTimingView {
            session_id: Uuid::now_v7(),
            turn_id: Uuid::now_v7(),
            timing: Some(timing),
        };
        let encoded = serde_json::to_value(view).unwrap();
        assert_eq!(encoded["timing"]["duration_ms"]["value"], 1532);
    }
}
