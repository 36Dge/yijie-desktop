"""Normal value-state tests of the single production maintenance SQL authority.

Each case creates an independent in-memory value relation; no retained database,
process, permissions or runtime is altered to manufacture a failure.
"""
from pathlib import Path
import sqlite3
import unittest

SQL = (Path(__file__).resolve().parents[2] / "src-tauri/src/chat/settled_schedule_history.sql").read_text()
SCHEMA = """
CREATE TABLE chat_scheduled_grants(grant_id,owner_user_id,tenant_id,plan_id,plan_revision,occupied_runs,max_runs);
CREATE TABLE chat_scheduled_runs(run_id,grant_id,owner_user_id,tenant_id,plan_id,plan_revision,format_version,needs_attention,delivery_state,native_outcome,operation_id);
CREATE TABLE chat_scheduled_recovery(run_id,format_version,refunded,release_kind,release_reference,create_attempt,turn_attempt);
CREATE TABLE chat_scheduled_run_bindings(run_id,target_deleted,conversation_id,local_turn_id);
CREATE TABLE chat_scheduled_reservation(run_id);
CREATE TABLE chat_sessions(id,owner_user_id,tenant_id,runtime_thread_id);
CREATE TABLE chat_turns(id,session_id,operation_id,scheduled_quiescent,runtime_turn_id,submission_status);
CREATE TABLE chat_native_bindings(turn_id,session_id,runtime_turn_id,runtime_thread_id);
CREATE TABLE chat_native_views(turn_id,session_id,format_version,view_json);
"""


def value_state(*, occupied=1, refunded=0, release="native_terminal", state="terminal", outcome="completed", deleted=True, proof=True, version=1, owner="owner", reservation=False, reference="runtime-turn", attempt="attempted", view_status="completed"):
    db = sqlite3.connect(":memory:")
    db.executescript(SCHEMA)
    db.execute("INSERT INTO chat_scheduled_grants VALUES('grant','owner','tenant','plan',1,?,1)", (occupied,))
    db.execute("INSERT INTO chat_scheduled_runs VALUES('run','grant',?,'tenant','plan',1,1,0,?,?,'operation')", (owner, state, outcome))
    if proof:
        db.execute("INSERT INTO chat_scheduled_recovery VALUES('run',?,?,?,?,?,?)", (version, refunded, release, reference, "never" if refunded else "attempted", attempt))
    db.execute("INSERT INTO chat_scheduled_run_bindings VALUES('run',?,?,'local-turn')", (int(deleted), None if deleted else "conversation"))
    if reservation:
        db.execute("INSERT INTO chat_scheduled_reservation VALUES('run')")
    if not deleted:
        db.execute("INSERT INTO chat_sessions VALUES('conversation','owner','tenant','thread')")
        db.execute("INSERT INTO chat_turns VALUES('local-turn','conversation','operation',1,?,?)", (None if refunded else "runtime-turn", "cancelled" if refunded else "accepted"))
        if not refunded:
            db.execute("INSERT INTO chat_native_bindings VALUES('local-turn','conversation','runtime-turn','thread')")
            db.execute("INSERT INTO chat_native_views VALUES('local-turn','conversation',5,?)", ('{"status":"' + view_status + '"}',))
    try:
        return db.execute(SQL).fetchone()[0]
    finally:
        db.close()


class Settlement(unittest.TestCase):
    def test_consumed_completed_deleted_target_is_settled(self):
        self.assertEqual(value_state(), 0)

    def test_retained_native_terminal_proof_is_settled(self):
        for status in ["completed", "failed", "interrupted"]:
            self.assertEqual(value_state(deleted=False, outcome=status, view_status=status), 0)

    def test_normal_never_sent_refund_is_settled(self):
        for deleted in [True, False]:
            self.assertEqual(value_state(occupied=0, refunded=1, release="never_sent_cancel", state="cancelled", outcome="unobserved", deleted=deleted, reference="run", attempt="never"), 0)

    def test_pending_or_unknown_states_remain_blocked(self):
        for args in [{"proof": False}, {"release": None}, {"release": "generation_stopped"}, {"state": "reserved", "outcome": "unobserved"}, {"reservation": True}, {"attempt": "never"}]:
            self.assertEqual(value_state(**args), 1)

    def test_accounting_and_scope_must_match(self):
        for args in [{"occupied": 0}, {"occupied": 2}, {"refunded": 1}, {"owner": "other-owner"}, {"version": 2}]:
            self.assertEqual(value_state(**args), 1)

    def test_existing_native_proof_must_match_original_terminal(self):
        for args in [{"reference": "other-turn"}, {"view_status": "failed"}]:
            self.assertEqual(value_state(deleted=False, **args), 1)


if __name__ == "__main__":
    unittest.main()
