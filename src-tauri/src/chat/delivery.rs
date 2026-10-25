//! Private dispatch facts for newly accepted ordinary/market/expert requests.
//! Missing history is unknown, not a proof that a request was never sent.
use super::{
    database::{ChatRepository, ChatScope},
    error::ChatError,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

fn db_error(_: rusqlite::Error) -> ChatError {
    ChatError::DatabaseUnavailable
}
fn conflict() -> ChatError {
    ChatError::ConversationConflict
}
pub(crate) fn present(db: &Connection) -> Result<bool, ChatError> {
    db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_delivery_proofs')",[],|r|r.get(0)).map_err(db_error)
}
#[derive(Debug, Clone)]
struct Proof {
    operation: String,
    session: String,
    turn: String,
    create: Option<String>,
    family: String,
    profile: String,
    revision: i64,
    initial_host: Option<String>,
    initial_thread: Option<String>,
    bound_host: Option<String>,
    bound_thread: Option<String>,
    fingerprint: String,
    phase: String,
    public: i64,
    create_attempts: i64,
    turn_attempts: i64,
}
fn proof(db: &Connection, op: Uuid) -> Result<Proof, ChatError> {
    db.query_row("SELECT operation_id,session_id,turn_id,create_operation_id,family,profile_id,model_revision,fingerprint,phase,public_attempts,create_attempts,turn_attempts,initial_host,initial_thread,bound_host,bound_thread FROM chat_delivery_proofs WHERE (operation_id=?1 OR create_operation_id=?1) AND format_version=1",[op.to_string()],|r|Ok(Proof{operation:r.get(0)?,session:r.get(1)?,turn:r.get(2)?,create:r.get(3)?,family:r.get(4)?,profile:r.get(5)?,revision:r.get(6)?,fingerprint:r.get(7)?,phase:r.get(8)?,public:r.get(9)?,create_attempts:r.get(10)?,turn_attempts:r.get(11)?,initial_host:r.get(12)?,initial_thread:r.get(13)?,bound_host:r.get(14)?,bound_thread:r.get(15)?})).optional().map_err(db_error)?.ok_or_else(conflict)
}
fn fingerprint(db: &Connection, p: &Proof) -> Result<String, ChatError> {
    let current: (Option<String>, Option<String>) = db
        .query_row(
            "SELECT agent_session_id,runtime_thread_id FROM chat_sessions WHERE id=?1",
            [&p.session],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(db_error)?;
    if current != (p.bound_host.clone(), p.bound_thread.clone()) {
        return Err(conflict());
    }
    let source = p.create.as_deref().unwrap_or(&p.operation);
    let (version,bytes):(i64,Vec<u8>)=db.query_row("SELECT payload_version,encrypted_payload FROM chat_outbox WHERE operation_id=?1 AND session_id=?2",params![source,p.session],|r|Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?;
    if version != 2 {
        return Err(conflict());
    }
    let message: String = db
        .query_row(
            "SELECT id FROM chat_messages WHERE turn_id=?1 AND session_id=?2 AND role='user'",
            params![p.turn, p.session],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    let digest = super::database::stored_content_block_digest(
        db,
        Uuid::parse_str(&message).map_err(|_| conflict())?,
    )?;
    let frozen:(String,i64)=db.query_row("SELECT profile_id,revision FROM chat_operation_models WHERE operation_id=?1 AND session_id=?2",params![p.operation,p.session],|r|Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?;
    if frozen != (p.profile.clone(), p.revision) {
        return Err(conflict());
    }
    let market: Option<(String, String, Option<String>)> = if p.family == "ordinary" {
        None
    } else {
        Some(db.query_row("SELECT m.request_digest,m.snapshot_json,e.snapshot_json FROM chat_market_submissions m LEFT JOIN chat_expert_submissions e ON e.submission_operation_id=m.submission_operation_id WHERE m.turn_operation_id=?1 AND m.session_id=?2 AND m.local_turn_id=?3",params![p.operation,p.session,p.turn],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(db_error)?)
    };
    let value = serde_json::to_vec(&(
        source,
        &p.operation,
        &p.session,
        &p.turn,
        &p.family,
        &p.profile,
        p.revision,
        &p.initial_host,
        &p.initial_thread,
        version,
        bytes,
        digest,
        market,
    ))
    .map_err(|_| conflict())?;
    Ok(format!("{:x}", Sha256::digest(value)))
}
pub(crate) fn initialize(
    db: &Connection,
    session: Uuid,
    turn: Uuid,
    operation: Uuid,
    create: Option<Uuid>,
    family: &str,
    now: i64,
) -> Result<(), ChatError> {
    if !present(db)? {
        return Ok(());
    }
    if !matches!(family, "ordinary" | "market" | "expert") || now < 0 {
        return Err(conflict());
    }
    let (profile,revision):(String,i64)=db.query_row("SELECT profile_id,revision FROM chat_operation_models WHERE operation_id=?1 AND session_id=?2",params![operation.to_string(),session.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?;
    let (host, thread): (Option<String>, Option<String>) = db
        .query_row(
            "SELECT agent_session_id,runtime_thread_id FROM chat_sessions WHERE id=?1",
            [session.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(db_error)?;
    let p = Proof {
        operation: operation.to_string(),
        session: session.to_string(),
        turn: turn.to_string(),
        create: create.map(|v| v.to_string()),
        family: family.into(),
        profile,
        revision,
        initial_host: host.clone(),
        initial_thread: thread.clone(),
        bound_host: host,
        bound_thread: thread,
        fingerprint: String::new(),
        phase: "prepared".into(),
        public: 0,
        create_attempts: 0,
        turn_attempts: 0,
    };
    let digest = fingerprint(db, &p)?;
    // Called only on the fresh acceptance branch, never on an idempotent replay.
    db.execute("INSERT INTO chat_delivery_proofs(operation_id,session_id,turn_id,create_operation_id,format_version,family,profile_id,model_revision,fingerprint,phase,created_at,initial_host,initial_thread,bound_host,bound_thread) VALUES(?1,?2,?3,?4,1,?5,?6,?7,?8,'prepared',?9,?10,?11,?10,?11)",params![p.operation,p.session,p.turn,p.create,p.family,p.profile,p.revision,digest,now,p.initial_host,p.initial_thread]).map_err(db_error)?;
    Ok(())
}
// Only the normal create-session acknowledgement can install a new binding.
pub(crate) fn observe_binding(
    db: &Connection,
    op: Uuid,
    host: Uuid,
    thread: Uuid,
) -> Result<(), ChatError> {
    if !present(db)? {
        return Ok(());
    }
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM chat_delivery_proofs WHERE create_operation_id=?1)",
            [op.to_string()],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    if !exists {
        return Ok(());
    }
    let p = proof(db, op)?;
    if p.family != "ordinary" {
        return Ok(());
    }
    if p.phase == "cancelled" || p.create_attempts == 0 || fingerprint(db, &p)? != p.fingerprint {
        return Err(conflict());
    }
    if p.bound_host
        .as_deref()
        .is_some_and(|h| h != host.to_string())
        || p.bound_thread
            .as_deref()
            .is_some_and(|t| t != thread.to_string())
    {
        return Err(conflict());
    }
    db.execute(
        "UPDATE chat_delivery_proofs SET bound_host=?2,bound_thread=?3 WHERE operation_id=?1",
        params![p.operation, host.to_string(), thread.to_string()],
    )
    .map_err(db_error)?;
    Ok(())
}
pub(crate) fn market_claim_predicate(db: &Connection) -> Result<String, ChatError> {
    if !present(db)? {
        return Ok("1=1".into());
    }
    let profiles = if super::models::enabled() && cfg!(feature = "kimi-k31-pro-candidate") {
        ["kimi-k3-1-pro-max-v1", "minimax-m3-high-v1"]
            .into_iter()
            .filter(|p| super::models::dispatch_profile_available(p))
            .map(|p| format!("'{p}'"))
            .collect::<Vec<_>>()
            .join(",")
    } else {
        "NULL".into()
    };
    Ok(format!("(d.state!='pending' OR EXISTS(SELECT 1 FROM chat_delivery_proofs proof WHERE proof.operation_id=m.turn_operation_id AND proof.session_id=m.session_id AND proof.family IN ('market','expert') AND proof.format_version=1 AND proof.phase!='cancelled' AND proof.turn_attempts=0 AND proof.profile_id IN ({profiles})))"))
}
pub(crate) fn claim_predicate(db: &Connection, alias: &str) -> Result<String, ChatError> {
    if !present(db)? {
        return Ok("1=1".into());
    }
    if !matches!(alias, "o" | "chat_outbox") {
        return Err(ChatError::InvalidInput);
    }
    Ok(format!("({alias}.kind='interrupt_turn' OR {alias}.scheduled_run_id IS NOT NULL OR EXISTS(SELECT 1 FROM chat_scheduled_draft_sessions draft WHERE draft.conversation_id={alias}.session_id) OR EXISTS(SELECT 1 FROM chat_delivery_proofs proof WHERE (proof.operation_id={alias}.operation_id OR proof.create_operation_id={alias}.operation_id) AND proof.family='ordinary' AND proof.format_version=1 AND proof.phase!='cancelled' AND ({alias}.kind!='start_turn' OR proof.turn_attempts=0)))"))
}
pub(crate) fn mark_claim(db: &Connection, op: Uuid) -> Result<(), ChatError> {
    if !present(db)? {
        return Ok(());
    }
    // Scheduled/draft and interrupts retain their separate authority and proof.
    let managed:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM chat_outbox o WHERE o.operation_id=?1 AND o.kind IN ('create_session','start_turn') AND o.scheduled_run_id IS NULL AND NOT EXISTS(SELECT 1 FROM chat_scheduled_draft_sessions d WHERE d.conversation_id=o.session_id))",[op.to_string()],|r|r.get(0)).map_err(db_error)?;
    if !managed {
        return Ok(());
    }
    let p = proof(db, op)?;
    if p.phase == "cancelled"
        || !super::models::dispatch_profile_available(&p.profile)
        || fingerprint(db, &p)? != p.fingerprint
    {
        return Err(conflict());
    }
    let n=db.execute("UPDATE chat_delivery_proofs SET phase=CASE WHEN phase='prepared' THEN 'claimed' ELSE phase END,claim_count=claim_count+1 WHERE operation_id=?1 AND phase!='cancelled'",[p.operation]).map_err(db_error)?;
    if n != 1 {
        return Err(conflict());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryState {
    pub operation_id: String,
    pub turn_id: String,
    pub status: String,
    pub cancellable: bool,
}
#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelReceipt {
    pub schema_version: i64,
    pub operation_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub outcome: String,
    pub cancelled_at: i64,
}

fn require_scope(db: &Connection, scope: &ChatScope, session: &str) -> Result<(), ChatError> {
    let found:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM chat_sessions WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3)",params![session,scope.owner_user_id,scope.tenant_id],|r|r.get(0)).map_err(db_error)?;
    if found {
        Ok(())
    } else {
        Err(ChatError::NotFound)
    }
}
fn never_sent(db: &Connection, p: &Proof) -> Result<bool, ChatError> {
    if !matches!(p.phase.as_str(), "prepared" | "claimed")
        || p.public != 0
        || p.create_attempts != 0
        || p.turn_attempts != 0
    {
        return Ok(false);
    }
    if fingerprint(db, p)? != p.fingerprint {
        return Err(conflict());
    }
    let safe:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM chat_turns t WHERE t.id=?1 AND t.session_id=?2 AND t.operation_id=?3 AND t.status='queued' AND t.submission_status='queued' AND t.runtime_turn_id IS NULL AND NOT EXISTS(SELECT 1 FROM chat_native_bindings n WHERE n.turn_id=t.id) AND NOT EXISTS(SELECT 1 FROM chat_observed_events_v4 e WHERE e.turn_id=t.id) AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=t.session_id))",params![p.turn,p.session,p.operation],|r|r.get(0)).map_err(db_error)?;
    Ok(safe)
}
impl ChatRepository {
    pub(crate) fn claim_market_delivery(&mut self, op: Uuid) -> Result<(), ChatError> {
        if !present(&self.connection)? {
            return Ok(());
        }
        let tx = self.connection.transaction().map_err(db_error)?;
        let p = proof(&tx, op)?;
        require_scope(&tx, &self.scope, &p.session)?;
        if !super::models::enabled()
            || !cfg!(feature = "kimi-k31-pro-candidate")
            || !matches!(p.family.as_str(), "market" | "expert")
            || p.phase == "cancelled"
            || p.turn_attempts != 0
            || !super::models::dispatch_profile_available(&p.profile)
            || fingerprint(&tx, &p)? != p.fingerprint
        {
            return Err(conflict());
        }
        let live:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_market_dispatch d JOIN chat_market_submissions m ON m.submission_operation_id=d.submission_operation_id WHERE m.turn_operation_id=?1 AND d.state='pending')",[&p.operation],|r|r.get(0)).map_err(db_error)?;
        if !live {
            return Err(conflict());
        }
        tx.execute("UPDATE chat_delivery_proofs SET phase=CASE WHEN phase='prepared' THEN 'claimed' ELSE phase END,claim_count=claim_count+1 WHERE operation_id=?1",[p.operation]).map_err(db_error)?;
        tx.commit().map_err(db_error)
    }
    pub(crate) fn delivery_managed_operation(&self, operation: Uuid) -> Result<bool, ChatError> {
        if !present(&self.connection)? {
            return Ok(false);
        }
        self.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_outbox o WHERE o.operation_id=?1 AND o.kind IN ('create_session','start_turn') AND o.scheduled_run_id IS NULL AND NOT EXISTS(SELECT 1 FROM chat_scheduled_draft_sessions d WHERE d.conversation_id=o.session_id))",[operation.to_string()],|r|r.get(0)).map_err(db_error)
    }
    pub(crate) fn begin_delivery_http(
        &mut self,
        operation: Uuid,
        path: &str,
        profile: Option<&str>,
        body: &[u8],
    ) -> Result<(), ChatError> {
        if !self.delivery_managed_operation(operation)? {
            return Ok(());
        }
        let p = proof(&self.connection, operation)?;
        if p.phase == "cancelled" || p.family != "ordinary" || profile != Some(p.profile.as_str()) {
            return Err(conflict());
        }
        let kind: String = self
            .connection
            .query_row(
                "SELECT kind FROM chat_outbox WHERE operation_id=?1",
                [operation.to_string()],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        if kind == "create_session" {
            let task:String=self.connection.query_row("SELECT public_task_id FROM chat_public_task_bindings WHERE create_operation_id=?1 AND state='bound'",[operation.to_string()],|r|r.get(0)).map_err(db_error)?;
            if path != format!("/v1/tasks/{task}/agent-sessions") {
                return Err(conflict());
            }
            self.begin_delivery_send(operation, "create")
        } else if kind == "start_turn" {
            let host: String = self
                .connection
                .query_row(
                    "SELECT agent_session_id FROM chat_sessions WHERE id=?1",
                    [p.session],
                    |r| r.get(0),
                )
                .map_err(db_error)?;
            if path != format!("/v2/agent-sessions/{host}/turns")
                && path != format!("/v1/agent-sessions/{host}/permission-turns")
            {
                return Err(conflict());
            }
            let value: serde_json::Value = serde_json::from_slice(body).map_err(|_| conflict())?;
            let turn = if path.ends_with("/permission-turns") {
                value.get("turn").ok_or_else(conflict)?
            } else {
                &value
            };
            if turn.get("operation_id").and_then(|v| v.as_str())
                != Some(operation.to_string().as_str())
            {
                return Err(conflict());
            }
            self.begin_delivery_send(operation, "turn")
        } else {
            Err(conflict())
        }
    }
    pub(crate) fn delivery_states(&self, session: Uuid) -> Result<Vec<DeliveryState>, ChatError> {
        require_scope(&self.connection, &self.scope, &session.to_string())?;
        if !present(&self.connection)? {
            return Ok(Vec::new());
        }
        let mut q=self.connection.prepare("SELECT operation_id,id FROM chat_turns WHERE session_id=?1 AND runtime_turn_id IS NULL AND status='queued' AND submission_status IN ('queued','uncertain') AND NOT EXISTS(SELECT 1 FROM chat_outbox o WHERE o.session_id=chat_turns.session_id AND o.scheduled_run_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM chat_scheduled_draft_sessions d WHERE d.conversation_id=chat_turns.session_id) ORDER BY id DESC LIMIT 50").map_err(db_error)?;
        let rows = q
            .query_map([session.to_string()], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(db_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_error)?;
        rows.into_iter()
            .map(|(operation_id, turn_id)| {
                let op = Uuid::parse_str(&operation_id).map_err(|_| conflict())?;
                let (status, cancellable) = match proof(&self.connection, op) {
                    Ok(p) => {
                        let safe = never_sent(&self.connection, &p)?;
                        (
                            if safe {
                                "never_sent"
                            } else if p.public + p.create_attempts + p.turn_attempts > 0 {
                                "attempted"
                            } else {
                                "unclassified"
                            }
                            .into(),
                            safe,
                        )
                    }
                    Err(ChatError::ConversationConflict) => ("unclassified".into(), false),
                    Err(e) => return Err(e),
                };
                Ok(DeliveryState {
                    operation_id,
                    turn_id,
                    status,
                    cancellable,
                })
            })
            .collect()
    }
    pub(crate) fn cancel_unsent_delivery(
        &mut self,
        session: Uuid,
        operation: Uuid,
        now: i64,
    ) -> Result<CancelReceipt, ChatError> {
        if !cfg!(feature = "kimi-k31-pro-candidate") || now < 0 || operation.is_nil() {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let tx = self.connection.transaction().map_err(db_error)?;
        require_scope(&tx, &self.scope, &session.to_string())?;
        if !present(&tx)? {
            return Err(conflict());
        }
        let p = proof(&tx, operation)?;
        if p.operation != operation.to_string() || p.session != session.to_string() {
            return Err(conflict());
        }
        if p.phase == "cancelled" {
            let raw: String = tx
                .query_row(
                    "SELECT receipt_json FROM chat_delivery_proofs WHERE operation_id=?1",
                    [p.operation],
                    |r| r.get(0),
                )
                .map_err(db_error)?;
            let receipt: CancelReceipt = serde_json::from_str(&raw).map_err(|_| conflict())?;
            if receipt.operation_id != operation.to_string()
                || receipt.session_id != session.to_string()
                || receipt.turn_id != p.turn
                || receipt.schema_version != 1
                || receipt.outcome != "cancelled_never_sent"
            {
                return Err(conflict());
            }
            return Ok(receipt);
        }
        if !never_sent(&tx, &p)? {
            return Err(conflict());
        }
        let receipt = CancelReceipt {
            schema_version: 1,
            operation_id: p.operation.clone(),
            session_id: p.session.clone(),
            turn_id: p.turn.clone(),
            outcome: "cancelled_never_sent".into(),
            cancelled_at: now,
        };
        tx.execute("UPDATE chat_delivery_proofs SET phase='cancelled',receipt_json=?2 WHERE operation_id=?1",params![p.operation,serde_json::to_string(&receipt).map_err(|_|conflict())?]).map_err(db_error)?;
        tx.execute("UPDATE chat_outbox SET state='failed',next_attempt_at=NULL WHERE session_id=?1 AND (operation_id=?2 OR operation_id=?3) AND state IN ('pending','inflight')",params![p.session,p.operation,p.create]).map_err(db_error)?;
        tx.execute("UPDATE chat_turns SET submission_status='cancelled' WHERE id=?1 AND runtime_turn_id IS NULL",[p.turn]).map_err(db_error)?;
        if let Some(create) = p.create {
            tx.execute("UPDATE chat_public_task_bindings SET state='failed',lease_expires_at=NULL,next_attempt_at=NULL,last_error_code='chat_conflict',updated_at=?2 WHERE create_operation_id=?1 AND public_task_id IS NULL",params![create,now]).map_err(db_error)?;
        }
        if p.family != "ordinary" {
            tx.execute("UPDATE chat_market_dispatch SET state='blocked',issue_code='cancelled_never_sent',updated_at=?2 WHERE submission_operation_id=(SELECT submission_operation_id FROM chat_market_submissions WHERE turn_operation_id=?1) AND state IN ('pending','blocked')",params![p.operation,now]).map_err(db_error)?;
        }
        tx.commit().map_err(db_error)?;
        Ok(receipt)
    }
    pub(crate) fn begin_delivery_send(&mut self, op: Uuid, kind: &str) -> Result<(), ChatError> {
        if !present(&self.connection)? {
            return Ok(());
        }
        let tx = self.connection.transaction().map_err(db_error)?;
        let p = proof(&tx, op)?;
        require_scope(&tx, &self.scope, &p.session)?;
        if p.phase == "cancelled"
            || !super::models::dispatch_profile_available(&p.profile)
            || fingerprint(&tx, &p)? != p.fingerprint
        {
            return Err(conflict());
        }
        let column = match kind {
            "public" => "public_attempts",
            "create" => "create_attempts",
            "turn" => "turn_attempts",
            _ => return Err(conflict()),
        };
        if kind == "turn" && p.turn_attempts != 0 {
            return Err(conflict());
        }
        if p.family == "ordinary" {
            let live:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_outbox WHERE operation_id=?1 AND session_id=?2 AND state='inflight' AND kind=?3)",params![op.to_string(),p.session,if kind=="turn"{"start_turn"}else{"create_session"}],|r|r.get(0)).map_err(db_error)?;
            if !live {
                return Err(conflict());
            }
        } else {
            let live:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_market_dispatch d JOIN chat_market_submissions m ON m.submission_operation_id=d.submission_operation_id WHERE m.turn_operation_id=?1 AND d.state='pending')",[&p.operation],|r|r.get(0)).map_err(db_error)?;
            if !live {
                return Err(conflict());
            }
        }
        tx.execute(&format!("UPDATE chat_delivery_proofs SET phase='dispatched',{column}={column}+1 WHERE operation_id=?1 AND phase!='cancelled'"),[p.operation]).map_err(db_error)?;
        tx.commit().map_err(db_error)
    }
}

#[derive(Clone)]
pub(crate) struct Admission {
    pub database: super::worker::DatabaseWorker,
    pub lifecycle: super::lifecycle::Lifecycle,
    pub epoch: u64,
    pub operation: Uuid,
}
impl Admission {
    pub(crate) async fn begin(
        &self,
        path: &str,
        profile: Option<&str>,
        body: &[u8],
    ) -> Result<(), ChatError> {
        self.lifecycle.validate(self.epoch)?;
        let operation = self.operation;
        let path = path.to_owned();
        let profile = profile.map(str::to_owned);
        let body = body.to_vec();
        let lifecycle = self.lifecycle.clone();
        let epoch = self.epoch;
        self.database
            .call(move |r| {
                lifecycle.validate(epoch)?;
                r.begin_delivery_http(operation, &path, profile.as_deref(), &body)
            })
            .await?;
        self.lifecycle.validate(self.epoch)
    }
}

#[cfg(all(test, feature = "kimi-k31-pro-candidate"))]
mod tests;
