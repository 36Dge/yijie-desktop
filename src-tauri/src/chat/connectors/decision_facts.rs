//! Append-only facts. Reading this module never sends or reconstructs a decision.
use super::{host_generated as wire, selection_generated};
use crate::chat::{database::ChatScope, migrations, worker::DatabaseWorker};
use rusqlite::{params, Connection, OptionalExtension};

type Code = wire::ErrorCode;

pub(super) fn fact(
    approval: &wire::MarketApproval,
    decision_id: &str,
    decision: wire::Decision,
    kind: wire::DecisionFactKind,
) -> Result<wire::DecisionFact, Code> {
    let identity = &approval.identity;
    let value = wire::DecisionFact {
        schema_version: 1,
        approval_id: approval.approval_id.clone(),
        decision_id: decision_id.into(),
        call_ref: identity.call_ref.clone(),
        service_id: identity.service_id.clone(),
        reference: identity.reference.clone(),
        native_thread_id: identity.native_thread_id.clone(),
        native_turn_id: identity.native_turn_id.clone(),
        turn_operation_id: identity.binding.turn_operation_id.clone(),
        selection_digest: identity.binding.selection_digest.clone(),
        tool_name: identity.tool_name.clone(),
        args_digest: identity.args_digest.clone(),
        args_encoding: identity.args_encoding.clone(),
        decision,
        kind,
        observed_at_unix_ms: super::now().map_err(|_| Code::TemporarilyUnavailable)?,
    };
    value.validate().map_err(|_| Code::InvalidRequest)?;
    Ok(value)
}

fn same_identity(left: &wire::DecisionFact, right: &wire::DecisionFact) -> bool {
    let mut copy = left.clone();
    copy.kind = right.kind;
    copy.observed_at_unix_ms = right.observed_at_unix_ms;
    copy == *right
}

fn append(
    connection: &mut Connection,
    scope: &ChatScope,
    session: &str,
    fact: &wire::DecisionFact,
) -> Result<(), Code> {
    fact.validate().map_err(|_| Code::InvalidRequest)?;
    let json = serde_json::to_string(fact).map_err(|_| Code::InvalidRequest)?;
    if json.len() > 4096 {
        return Err(Code::InvalidRequest);
    }
    migrations::migrate_to_target(connection, migrations::MARKET_DECISION_FACTS_SCHEMA_VERSION)
        .map_err(|_| Code::TemporarilyUnavailable)?;
    let tx = connection
        .transaction()
        .map_err(|_| Code::TemporarilyUnavailable)?;
    let original: Option<(String, String, String)> = tx.query_row(
        "SELECT b.turn_id,m.snapshot_json,m.display_json FROM chat_native_bindings b JOIN chat_sessions s ON s.id=b.session_id JOIN chat_market_submissions m ON m.session_id=b.session_id AND m.local_turn_id=b.turn_id WHERE b.session_id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3 AND b.runtime_thread_id=?4 AND b.runtime_turn_id=?5",
        params![session,scope.owner_user_id,scope.tenant_id,fact.native_thread_id,fact.native_turn_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
    ).optional().map_err(|_| Code::TemporarilyUnavailable)?;
    let (local_turn, snapshot, display) = original.ok_or(Code::AuthorityMismatch)?;
    let snapshot: selection_generated::SelectionSnapshot =
        serde_json::from_str(&snapshot).map_err(|_| Code::AuthorityMismatch)?;
    let display: Vec<wire::SelectionDisplay> =
        serde_json::from_str(&display).map_err(|_| Code::AuthorityMismatch)?;
    if snapshot.turn_operation_id != fact.turn_operation_id
        || snapshot.selection_digest != fact.selection_digest
        || !snapshot.selection.contains(&fact.reference)
        || !display
            .iter()
            .any(|v| v.service_id == fact.service_id && v.reference == fact.reference)
    {
        return Err(Code::AuthorityMismatch);
    }
    let prior: Option<(String, String)> = tx.query_row("SELECT session_id,fact_json FROM chat_market_decision_facts WHERE decision_id=?1 LIMIT 1", [&fact.decision_id], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|_| Code::TemporarilyUnavailable)?;
    if let Some((old_session, old)) = prior {
        let old: wire::DecisionFact =
            serde_json::from_str(&old).map_err(|_| Code::TemporarilyUnavailable)?;
        if old_session != session || !same_identity(&old, fact) {
            return Err(Code::RevisionConflict);
        }
    } else if fact.kind != wire::DecisionFactKind::Requested {
        return Err(Code::RevisionConflict);
    }
    // Duplicate observations preserve the first fact; no UPDATE or dispatch queue.
    let kind = serde_json::to_value(fact.kind).map_err(|_| Code::InvalidRequest)?;
    tx.execute("INSERT INTO chat_market_decision_facts(decision_id,fact_kind,session_id,local_turn_id,observed_at_unix_ms,fact_json) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(decision_id,fact_kind) DO NOTHING",
        params![fact.decision_id,kind.as_str(),session,local_turn,fact.observed_at_unix_ms,json]).map_err(|_| Code::TemporarilyUnavailable)?;
    tx.commit().map_err(|_| Code::TemporarilyUnavailable)
}

pub(super) async fn persist(
    db: &DatabaseWorker,
    scope: &ChatScope,
    session: &str,
    fact: wire::DecisionFact,
) -> Result<(), Code> {
    // The current product writer is the Kimi candidate. Legacy readers/commands
    // retain their original storage profile and do not opt into migration 47.
    if !cfg!(feature = "kimi-k31-pro-candidate") {
        return Ok(());
    }
    let scope = scope.clone();
    let session = session.to_owned();
    db.call(move |repo| Ok(append(&mut repo.connection, &scope, &session, &fact)))
        .await
        .map_err(|_| Code::TemporarilyUnavailable)?
}

fn decode_fact(json: &str, turn: &str) -> Result<wire::DecisionFact, Code> {
    let value: wire::DecisionFact =
        serde_json::from_str(json).map_err(|_| Code::TemporarilyUnavailable)?;
    value.validate().map_err(|_| Code::TemporarilyUnavailable)?;
    if value.native_turn_id != turn {
        return Err(Code::AuthorityMismatch);
    }
    Ok(value)
}

pub(super) fn read(
    connection: &Connection,
    scope: &ChatScope,
    session: &str,
    turn: &str,
) -> Result<(Vec<wire::DecisionFact>, bool), Code> {
    let exists: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='chat_market_decision_facts')", [], |r| r.get(0)).map_err(|_| Code::TemporarilyUnavailable)?;
    if !exists {
        return Ok((vec![], false));
    }
    let mut statement = connection.prepare("SELECT f.fact_json FROM chat_market_decision_facts f JOIN chat_sessions s ON s.id=f.session_id JOIN chat_native_bindings b ON b.turn_id=f.local_turn_id AND b.session_id=f.session_id WHERE f.session_id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3 AND b.runtime_turn_id=?4 ORDER BY f.rowid DESC LIMIT ?5").map_err(|_| Code::TemporarilyUnavailable)?;
    let rows = statement
        .query_map(
            params![
                session,
                scope.owner_user_id,
                scope.tenant_id,
                turn,
                (wire::MAX_DECISION_FACTS + 1) as i64
            ],
            |r| r.get::<_, String>(0),
        )
        .map_err(|_| Code::TemporarilyUnavailable)?;
    let mut facts = Vec::new();
    let mut truncated = false;
    for row in rows {
        if facts.len() == wire::MAX_DECISION_FACTS {
            truncated = true;
            break;
        }
        facts.push(decode_fact(
            &row.map_err(|_| Code::TemporarilyUnavailable)?,
            turn,
        )?);
    }
    Ok((facts, truncated))
}

// Identities come only from the already validated live Host approval snapshot.
// This read selects evidence; it never reconstructs a callback or grants approval.
pub(super) fn read_for_pending(
    connection: &Connection,
    scope: &ChatScope,
    session: &str,
    turn: &str,
    pending: &[(String, String)],
) -> Result<(Vec<wire::DecisionFact>, bool), Code> {
    if pending.len() > wire::MAX_DECISION_FACTS {
        return Err(Code::TemporarilyUnavailable);
    }
    let (recent, truncated) = read(connection, scope, session, turn)?;
    if !truncated || pending.is_empty() {
        return Ok((recent, truncated));
    }
    let pending_json = serde_json::to_string(pending).map_err(|_| Code::InvalidRequest)?;
    let mut statement = connection.prepare(
        "WITH protected AS (
            SELECT f.rowid AS position,f.fact_json,ROW_NUMBER() OVER (
                PARTITION BY json_extract(f.fact_json,'$.approvalId'),json_extract(f.fact_json,'$.callRef')
                ORDER BY (f.fact_kind='acknowledged') DESC,f.rowid DESC
            ) AS rank
            FROM chat_market_decision_facts f
            JOIN chat_sessions s ON s.id=f.session_id
            JOIN chat_native_bindings b ON b.turn_id=f.local_turn_id AND b.session_id=f.session_id
            WHERE f.session_id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3 AND b.runtime_turn_id=?4
              AND EXISTS (
                SELECT 1 FROM json_each(?5) p
                WHERE json_extract(p.value,'$[0]')=json_extract(f.fact_json,'$.approvalId')
                  AND json_extract(p.value,'$[1]')=json_extract(f.fact_json,'$.callRef')
              )
        )
        SELECT fact_json FROM protected WHERE rank=1 ORDER BY position DESC LIMIT ?6"
    ).map_err(|_| Code::TemporarilyUnavailable)?;
    let rows = statement
        .query_map(
            params![
                session,
                scope.owner_user_id,
                scope.tenant_id,
                turn,
                pending_json,
                wire::MAX_DECISION_FACTS as i64
            ],
            |r| r.get::<_, String>(0),
        )
        .map_err(|_| Code::TemporarilyUnavailable)?;
    let mut facts = Vec::new();
    for row in rows {
        facts.push(decode_fact(
            &row.map_err(|_| Code::TemporarilyUnavailable)?,
            turn,
        )?);
    }
    for fact in recent {
        if facts.len() == wire::MAX_DECISION_FACTS {
            break;
        }
        if !facts
            .iter()
            .any(|existing| existing.decision_id == fact.decision_id && existing.kind == fact.kind)
        {
            facts.push(fact);
        }
    }
    Ok((facts, truncated))
}

#[cfg(all(test, feature = "kimi-k31-pro-candidate"))]
mod tests {
    use super::*;
    use crate::chat::{
        database::ChatRepository,
        keychain::{DatabaseKey, ReceiptKey},
    };
    use uuid::Uuid;

    #[test]
    fn market_decision_facts_survive_normal_reopen_without_replaying_or_changing_outbox() {
        let root = std::env::temp_dir().join(format!("market-decision-facts-{}", Uuid::now_v7()));
        std::fs::create_dir(&root).unwrap();
        let scope = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
        let open = || {
            ChatRepository::open(
                &root.join("chat"),
                &DatabaseKey::from_bytes([47; 32]),
                ReceiptKey::from_bytes([48; 32]),
                scope.clone(),
            )
            .unwrap()
        };
        let mut repo = open();
        migrations::migrate_to_target(
            &mut repo.connection,
            migrations::MARKET_INITIAL_HOST_TURN_SCHEMA_VERSION,
        )
        .unwrap();
        let workspace = root.join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let project = Uuid::parse_str(
            &repo
                .register_project(&workspace, b"ordinary-test-bookmark")
                .unwrap()
                .id,
        )
        .unwrap();
        let conversation = repo
            .create_session_and_enqueue(project, "普通连接器决定记录", Uuid::now_v7())
            .unwrap();
        let session = conversation.session_id.to_string();
        let turn = Uuid::now_v7().to_string();
        let thread = Uuid::now_v7().to_string();
        let reference = wire::SelectionRef {
            installation_id: Uuid::now_v7().to_string(),
            revision: 1,
            generation: 1,
        };
        let snapshot = selection_generated::freeze_selection(
            conversation.turn_operation_id.to_string(),
            vec![reference.clone()],
        )
        .unwrap();
        let display = vec![wire::SelectionDisplay {
            service_id: "tushareMcp".into(),
            reference: reference.clone(),
            display_name: "原查询服务".into(),
        }];
        repo.connection.execute("INSERT INTO chat_market_submissions(submission_operation_id,session_id,local_turn_id,turn_operation_id,format_version,request_digest,snapshot_json,display_json,receipt_json,created_at) VALUES(?1,?2,?3,?4,1,?5,?6,?7,'{}',1)",params![conversation.create_operation_id.to_string(),session,conversation.turn_id.to_string(),snapshot.turn_operation_id,"a".repeat(64),serde_json::to_string(&snapshot).unwrap(),serde_json::to_string(&display).unwrap()]).unwrap();
        repo.connection.execute("INSERT INTO chat_native_bindings(turn_id,session_id,runtime_thread_id,runtime_turn_id,host_instance_nonce) VALUES(?1,?2,?3,?4,?5)",params![conversation.turn_id.to_string(),session,thread,turn,Uuid::now_v7().to_string()]).unwrap();
        let outbox = |connection: &Connection| {
            connection
                .query_row(
                    "SELECT COUNT(*),SUM(attempt_count) FROM chat_outbox",
                    [],
                    |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
                )
                .unwrap()
        };
        let before = outbox(&repo.connection);
        assert_eq!(
            read(&repo.connection, &scope, &session, &turn).unwrap(),
            (vec![], false)
        );
        let mut requested = wire::DecisionFact {
            schema_version: 1,
            approval_id: Uuid::now_v7().to_string(),
            decision_id: Uuid::now_v7().to_string(),
            call_ref: Uuid::now_v7().to_string(),
            service_id: "tushareMcp".into(),
            reference,
            native_thread_id: thread,
            native_turn_id: turn.clone(),
            turn_operation_id: snapshot.turn_operation_id,
            selection_digest: snapshot.selection_digest,
            tool_name: "public_lookup".into(),
            args_digest: "b".repeat(64),
            args_encoding: "worker-json-v1".into(),
            decision: wire::Decision::ApproveOnce,
            kind: wire::DecisionFactKind::Requested,
            observed_at_unix_ms: 1000,
        };
        append(&mut repo.connection, &scope, &session, &requested).unwrap();
        // No reply is not a rejection, permission consumption or execution result.
        let (facts, truncated) = read(&repo.connection, &scope, &session, &turn).unwrap();
        assert!(!truncated);
        assert_eq!(facts.len(), 1);
        assert_eq!(facts[0].kind, wire::DecisionFactKind::Requested);
        requested.observed_at_unix_ms += 1;
        append(&mut repo.connection, &scope, &session, &requested).unwrap();
        assert_eq!(
            read(&repo.connection, &scope, &session, &turn).unwrap().0[0].observed_at_unix_ms,
            1000
        );
        let mut acknowledged = requested.clone();
        acknowledged.kind = wire::DecisionFactKind::Acknowledged;
        acknowledged.observed_at_unix_ms = 1002;
        append(&mut repo.connection, &scope, &session, &acknowledged).unwrap();
        let mut unknown = requested.clone();
        unknown.decision_id = Uuid::now_v7().to_string();
        unknown.approval_id = Uuid::now_v7().to_string();
        unknown.call_ref = Uuid::now_v7().to_string();
        unknown.decision = wire::Decision::Cancel;
        unknown.observed_at_unix_ms = 1003;
        append(&mut repo.connection, &scope, &session, &unknown).unwrap();
        unknown.kind = wire::DecisionFactKind::Unconfirmed;
        unknown.observed_at_unix_ms = 900; // a normal wall-clock correction
        append(&mut repo.connection, &scope, &session, &unknown).unwrap();
        assert_eq!(outbox(&repo.connection), before);
        let version: i64 = repo
            .connection
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 47);
        drop(repo); // ordinary SQLCipher close and reopen, no process interruption
        let mut repo = open();
        let (facts, truncated) = read(&repo.connection, &scope, &session, &turn).unwrap();
        assert!(!truncated);
        assert_eq!(facts.len(), 4);
        assert_eq!(facts[0], unknown); // append order, not wall-clock order
        assert!(facts
            .iter()
            .any(|f| f.kind == wire::DecisionFactKind::Acknowledged));
        assert_eq!(outbox(&repo.connection), before);
        let other = ChatScope::new(Uuid::now_v7().to_string(), scope.tenant_id.clone()).unwrap();
        assert!(read(&repo.connection, &other, &session, &turn)
            .unwrap()
            .0
            .is_empty());
        assert!(read(
            &repo.connection,
            &scope,
            &session,
            &Uuid::now_v7().to_string()
        )
        .unwrap()
        .0
        .is_empty());
        // A busy turn can contain more fact rows than the display window. Its
        // still-pending decisions must remain visible after a normal reopen.
        let mut active = vec![
            (unknown.approval_id.clone(), unknown.call_ref.clone()),
            (requested.approval_id.clone(), requested.call_ref.clone()),
        ];
        for index in 0..wire::MAX_DECISION_FACTS {
            let mut next = requested.clone();
            next.decision_id = Uuid::now_v7().to_string();
            next.approval_id = Uuid::now_v7().to_string();
            next.call_ref = Uuid::now_v7().to_string();
            next.observed_at_unix_ms = 500 + index as i64;
            append(&mut repo.connection, &scope, &session, &next).unwrap();
            if active.len() < wire::MAX_DECISION_FACTS {
                active.push((next.approval_id, next.call_ref));
            }
        }
        drop(repo);
        let repo = open();
        let (recent, truncated) = read(&repo.connection, &scope, &session, &turn).unwrap();
        assert!(truncated);
        assert_eq!(recent.len(), wire::MAX_DECISION_FACTS);
        assert!(!recent.iter().any(|f| f.call_ref == unknown.call_ref));
        let (protected, truncated) =
            read_for_pending(&repo.connection, &scope, &session, &turn, &active).unwrap();
        assert!(truncated);
        assert_eq!(protected.len(), wire::MAX_DECISION_FACTS);
        for (approval, call) in &active {
            assert!(protected
                .iter()
                .any(|f| &f.approval_id == approval && &f.call_ref == call));
        }
        assert!(protected.contains(&unknown));
        assert!(protected.contains(&acknowledged));
        assert!(!protected
            .iter()
            .any(|f| f.decision_id == acknowledged.decision_id
                && f.kind != wire::DecisionFactKind::Acknowledged));
        let mismatched_pair = vec![(unknown.approval_id.clone(), requested.call_ref.clone())];
        assert_eq!(
            read_for_pending(&repo.connection, &scope, &session, &turn, &mismatched_pair)
                .unwrap()
                .0,
            recent
        );
        assert!(
            read_for_pending(&repo.connection, &other, &session, &turn, &active)
                .unwrap()
                .0
                .is_empty()
        );
        assert!(read_for_pending(
            &repo.connection,
            &scope,
            &session,
            &Uuid::now_v7().to_string(),
            &active
        )
        .unwrap()
        .0
        .is_empty());
        assert_eq!(outbox(&repo.connection), before);
        repo.connection
            .execute("DELETE FROM chat_sessions WHERE id=?1", [&session])
            .unwrap();
        let remaining: i64 = repo
            .connection
            .query_row("SELECT COUNT(*) FROM chat_market_decision_facts", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(remaining, 0);
        assert!(repo
            .connection
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none());
        drop(repo);
        std::fs::remove_dir_all(root).unwrap();
    }
}
