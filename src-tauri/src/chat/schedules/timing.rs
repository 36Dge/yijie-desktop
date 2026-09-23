//! A scoped cache of Runtime clock facts, never a lifecycle or dispatch authority.
use super::{execution_generated::ScheduleCapability, timing_generated::*, ScheduleAuthority};
use crate::chat::{database::ChatRepository, error::ChatError};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

fn db<T>(v: rusqlite::Result<T>) -> Result<T, ChatError> {
    v.map_err(|_| ChatError::DatabaseUnavailable)
}
pub(super) fn present(c: &Connection) -> Result<bool, ChatError> {
    db(c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_scheduled_timing')",[],|r|r.get(0)))
}
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Target {
    pub run: String,
    pub conversation: Uuid,
    pub local_turn: Uuid,
    pub session: Uuid,
    pub thread: Uuid,
    pub turn: Uuid,
}
fn id(s: String) -> Result<Uuid, ChatError> {
    Uuid::parse_str(&s)
        .ok()
        .filter(|v| !v.is_nil() && v.to_string() == s)
        .ok_or(ChatError::ConversationConflict)
}
impl ChatRepository {
    fn timing_read_authority(&self, a: &ScheduleAuthority, now: i64) -> Result<(), ChatError> {
        a.require(&self.scope, ScheduleCapability::ScheduleRead, now)
            .map_err(|_| ChatError::ScopeDenied)
    }
    pub(crate) fn timing_target(
        &self,
        a: &ScheduleAuthority,
        run: &str,
        now: i64,
    ) -> Result<Option<Target>, ChatError> {
        self.timing_read_authority(a, now)?;
        if !present(&self.connection)? {
            return Ok(None);
        }
        let row:Option<(String,String,String,String,String)>=db(self.connection.query_row(
            "SELECT b.conversation_id,b.local_turn_id,s.agent_session_id,n.runtime_thread_id,n.runtime_turn_id FROM chat_scheduled_runs r JOIN chat_scheduled_run_bindings b ON b.run_id=r.run_id JOIN chat_turns t ON t.id=b.local_turn_id AND t.session_id=b.conversation_id AND t.operation_id=r.operation_id JOIN chat_sessions s ON s.id=b.conversation_id AND s.owner_user_id=r.owner_user_id AND s.tenant_id=r.tenant_id JOIN chat_projects p ON p.id=s.project_id AND p.owner_user_id=s.owner_user_id AND p.tenant_id=s.tenant_id JOIN chat_native_bindings n ON n.turn_id=t.id AND n.session_id=s.id AND n.runtime_thread_id=s.runtime_thread_id AND n.runtime_turn_id=t.runtime_turn_id WHERE r.run_id=?1 AND r.owner_user_id=?2 AND r.tenant_id=?3 AND r.format_version=1 AND b.target_deleted=0 AND p.removed_at IS NULL AND s.agent_session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id)",
            params![run,self.scope.owner_user_id,self.scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional())?;
        row.map(|(c, l, s, t, u)| {
            Ok(Target {
                run: run.into(),
                conversation: id(c)?,
                local_turn: id(l)?,
                session: id(s)?,
                thread: id(t)?,
                turn: id(u)?,
            })
        })
        .transpose()
    }
    /// One bounded page on startup; other history pages are requested explicitly.
    pub(crate) fn timing_seed(&mut self, a: &ScheduleAuthority, now: i64) -> Result<(), ChatError> {
        self.timing_read_authority(a, now)?;
        if !self.schedule_timing_writes_enabled || !present(&self.connection)? {
            return Ok(());
        }
        let ids = {
            let mut q=db(self.connection.prepare("SELECT run_id FROM chat_scheduled_runs WHERE owner_user_id=?1 AND tenant_id=?2 ORDER BY run_id DESC LIMIT 50"))?;
            let rows = db(q
                .query_map(
                    params![self.scope.owner_user_id, self.scope.tenant_id],
                    |r| r.get::<_, String>(0),
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?
                .collect::<rusqlite::Result<Vec<_>>>())?;
            rows
        };
        // A real recovery epoch starts a new bounded read cycle, including
        // unfinished work whose local retry deadline preceded a clock change.
        for run in &ids {
            if self.timing_target(a, run, now)?.is_some() {
                db(self.connection.execute("UPDATE chat_scheduled_timing SET pending=0 WHERE run_id=?1 AND format_version=1",[run]))?;
            }
        }
        self.timing_request(a, &ids, now)
    }
    pub(crate) fn timing_request(
        &mut self,
        a: &ScheduleAuthority,
        ids: &[String],
        now: i64,
    ) -> Result<(), ChatError> {
        self.timing_read_authority(a, now)?;
        if ids.len() > 50 {
            return Err(ChatError::InvalidInput);
        }
        if !self.schedule_timing_writes_enabled || !present(&self.connection)? {
            return Ok(());
        }
        for run in ids {
            if self.timing_target(a, run, now)?.is_none() {
                continue;
            }
            let cached = match self.timing_cached(run) {
                Ok(v) => v,
                Err(ChatError::ConversationConflict) => continue,
                Err(e) => return Err(e),
            };
            if cached
                .as_ref()
                .is_some_and(|(v, conflicts, _)| *conflicts == 0 && complete(v))
            {
                continue;
            }
            db(self.connection.execute("INSERT INTO chat_scheduled_timing(run_id) VALUES(?1) ON CONFLICT(run_id) DO UPDATE SET pending=1,attempts=0,next_read_after=0,request_revision=request_revision+1 WHERE format_version=1 AND pending=0",[run]))?;
        }
        Ok(())
    }
    pub(crate) fn timing_specific(
        &self,
        a: &ScheduleAuthority,
        run: &str,
        now: i64,
    ) -> Result<Option<(Target, i64)>, ChatError> {
        let Some(target) = self.timing_target(a, run, now)? else {
            return Ok(None);
        };
        let revision:Option<i64>=db(self.connection.query_row("SELECT request_revision FROM chat_scheduled_timing WHERE run_id=?1 AND format_version=1 AND pending=1 AND next_read_after<=?2",params![run,now],|r|r.get(0)).optional())?;
        Ok(revision.map(|v| (target, v)))
    }
    pub(crate) fn timing_due(
        &mut self,
        a: &ScheduleAuthority,
        now: i64,
    ) -> Result<Option<(Target, i64)>, ChatError> {
        self.timing_read_authority(a, now)?;
        if !self.schedule_timing_writes_enabled || !present(&self.connection)? {
            return Ok(None);
        }
        // Indexed pending work, bounded even when identities have been deleted.
        let rows = {
            let mut q=db(self.connection.prepare("SELECT c.run_id,c.request_revision FROM chat_scheduled_timing c JOIN chat_scheduled_runs r ON r.run_id=c.run_id WHERE c.pending=1 AND c.next_read_after<=?3 AND c.format_version=1 AND r.owner_user_id=?1 AND r.tenant_id=?2 ORDER BY c.next_read_after,c.run_id LIMIT 50"))?;
            let rows = db(q
                .query_map(
                    params![self.scope.owner_user_id, self.scope.tenant_id, now],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?
                .collect::<rusqlite::Result<Vec<_>>>())?;
            rows
        };
        for (run, revision) in rows {
            if let Some(t) = self.timing_target(a, &run, now)? {
                match self.timing_cached(&run) {
                    Err(ChatError::ConversationConflict) => {
                        db(self.connection.execute("UPDATE chat_scheduled_timing SET pending=0 WHERE run_id=?1 AND request_revision=?2",params![run,revision]))?;
                        continue;
                    }
                    Err(e) => return Err(e),
                    _ => {}
                }
                return Ok(Some((t, revision)));
            }
            db(self.connection.execute("UPDATE chat_scheduled_timing SET pending=0 WHERE run_id=?1 AND request_revision=?2",params![run,revision]))?;
        }
        Ok(None)
    }
    fn timing_cached(
        &self,
        run: &str,
    ) -> Result<Option<(NativeTurnTiming, i64, Option<String>)>, ChatError> {
        let row:Option<(Option<String>,i64,i64,Option<String>)>=db(self.connection.query_row("SELECT fact_json,conflicts,format_version,diagnostic FROM chat_scheduled_timing WHERE run_id=?1",[run],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional())?;
        match row {
            Some((_, _, v, _)) if v != 1 => Err(ChatError::ConversationConflict),
            Some((Some(s), c, _, d)) => Ok(Some((
                serde_json::from_str(&s).map_err(|_| ChatError::ConversationConflict)?,
                c,
                d,
            ))),
            _ => Ok(None),
        }
    }
    pub(crate) fn timing_commit(
        &mut self,
        a: &ScheduleAuthority,
        target: &Target,
        revision: i64,
        result: Option<NativeTurnTiming>,
        now: i64,
    ) -> Result<(), ChatError> {
        if !self.schedule_timing_writes_enabled {
            return Err(ChatError::OrchestrationUnavailable);
        }
        // The worker serializes this revalidation and cache write; no network is held here.
        if self.timing_target(a, &target.run, now)?.as_ref() != Some(target) {
            return Err(ChatError::ConversationConflict);
        }
        let current:Option<i64>=db(self.connection.query_row("SELECT request_revision FROM chat_scheduled_timing WHERE run_id=?1 AND format_version=1",[&target.run],|r|r.get(0)).optional())?;
        if current != Some(revision) {
            return Ok(());
        } // A newer native observation owns the next read.
        let tx = db(self.connection.unchecked_transaction())?;
        let mut diagnostic = Some("history_unavailable");
        let mut done = false;
        let cached = self.timing_cached(&target.run)?;
        let result = result.filter(|incoming| {
            let matched = incoming.validate().is_ok()
                && incoming.agent_session_id == target.session.to_string()
                && incoming.thread_id == target.thread.to_string()
                && incoming.turn_id == target.turn.to_string()
                && cached.as_ref().is_none_or(|(v, _, _)| {
                    v.agent_session_id == incoming.agent_session_id
                        && v.thread_id == incoming.thread_id
                        && v.turn_id == incoming.turn_id
                });
            if !matched {
                diagnostic = Some("identity_mismatch")
            }
            matched
        });
        if let Some(incoming) = result {
            let (mut v, mut conflicts, _) = cached.unwrap_or((incoming.clone(), 0, None));
            merge(
                &mut v.started_at.state,
                &mut v.started_at.value,
                incoming.started_at.state,
                incoming.started_at.value,
                &mut conflicts,
                1,
            );
            merge(
                &mut v.completed_at.state,
                &mut v.completed_at.value,
                incoming.completed_at.state,
                incoming.completed_at.value,
                &mut conflicts,
                2,
            );
            merge(
                &mut v.duration_ms.state,
                &mut v.duration_ms.value,
                incoming.duration_ms.state,
                incoming.duration_ms.value,
                &mut conflicts,
                4,
            );
            diagnostic = if conflicts != 0 {
                Some("source_conflict")
            } else if [
                v.started_at.state,
                v.completed_at.state,
                v.duration_ms.state,
            ]
            .contains(&TimeFieldState::Invalid)
            {
                Some("field_invalid")
            } else {
                None
            };
            done = complete(&v) && conflicts == 0;
            db(tx.execute("UPDATE chat_scheduled_timing SET fact_json=?2,conflicts=?3 WHERE run_id=?1 AND format_version=1",params![target.run,serde_json::to_string(&v).map_err(|_|ChatError::DatabaseUnavailable)?,conflicts]))?;
        }
        db(tx.execute("UPDATE chat_scheduled_timing SET attempts=min(attempts+1,3),pending=CASE WHEN ?2 OR attempts>=2 THEN 0 ELSE 1 END,next_read_after=?3+CASE WHEN attempts=0 THEN 1 ELSE 5 END,diagnostic=?4 WHERE run_id=?1 AND format_version=1 AND request_revision=?5",params![target.run,done,now,diagnostic,revision]))?;
        db(tx.commit())?;
        Ok(())
    }
    pub(crate) fn timing_view(
        &self,
        run: &str,
        never: bool,
        running: bool,
        zone: &str,
    ) -> Result<Value, ChatError> {
        let mut out = json!({"execution_time":if never{"not_started"}else{"unknown"},"duration":if never{"not_started"}else{"unknown"},"source":"no_execution_clock","time_zone":zone});
        if !present(&self.connection)? {
            return Ok(out);
        }
        let cached = match self.timing_cached(run) {
            Ok(v) => v,
            Err(ChatError::ConversationConflict) => {
                out["diagnostic"] = json!("format_unsupported");
                return Ok(out);
            }
            Err(e) => return Err(e),
        };
        if let Some((v, conflicts, diagnostic)) = cached {
            out["source"] = json!("runtime_read");
            if v.started_at.state == TimeFieldState::Known && conflicts & 1 == 0 {
                out["execution_time"] = json!("known");
                out["started_at"] = json!(v.started_at.value);
                if running {
                    out["duration"] = json!("in_progress")
                }
            }
            if v.completed_at.state == TimeFieldState::Known && conflicts & 2 == 0 {
                out["completed_at"] = json!(v.completed_at.value)
            }
            if v.duration_ms.state == TimeFieldState::Known && conflicts & 4 == 0 {
                out["duration"] = json!("known");
                out["duration_ms"] = json!(v.duration_ms.value)
            }
            if let Some(d) = diagnostic {
                out["diagnostic"] = json!(d)
            }
        }
        Ok(out)
    }
}
fn complete(v: &NativeTurnTiming) -> bool {
    [
        v.started_at.state,
        v.completed_at.state,
        v.duration_ms.state,
    ]
    .iter()
    .all(|s| *s == TimeFieldState::Known)
}
fn merge(
    state: &mut TimeFieldState,
    value: &mut Option<i64>,
    new_state: TimeFieldState,
    new_value: Option<i64>,
    conflicts: &mut i64,
    bit: i64,
) {
    if new_state == TimeFieldState::Unknown {
        return;
    }
    if *state == TimeFieldState::Known {
        if new_state == TimeFieldState::Known && *value != new_value {
            *conflicts |= bit
        }
    } else {
        *state = new_state;
        *value = new_value
    }
}
