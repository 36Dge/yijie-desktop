"""Ordinary loopback HTTP; normal shutdown; no model, provider or executable fixture."""
import importlib.util
import http.server
import json
from pathlib import Path
import tempfile
import threading
import unittest
from feat162_owner_stop import OwnerStop

spec = importlib.util.spec_from_file_location("policy", Path(__file__).with_name("feat162-basic-pro-meter.py"))
policy = importlib.util.module_from_spec(spec); spec.loader.exec_module(policy)
IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"]


class OwnerStopTests(unittest.TestCase):
    def setUp(self):
        self.calls = []; self.status = 204; self.active = IDS[-1]; self.before_stop = lambda: None
        outer = self
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_GET(self):
                outer.calls.append(("GET", self.path))
                outer.assertEqual(self.headers["Authorization"], "Bearer ordinary-local-fixture")
                data = json.dumps({"session": {"agent_session_id": IDS[0], "codex_thread_id": IDS[1], "active_turn_id": outer.active, "state": "active"}}).encode()
                self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
            def do_POST(self):
                outer.calls.append(("POST", self.path)); outer.before_stop()
                outer.assertEqual(self.rfile.read(int(self.headers["Content-Length"])), b"{}")
                self.send_response(outer.status); self.end_headers()
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever); self.thread.start()
        self.stop = OwnerStop(f"http://127.0.0.1:{self.server.server_port}", "ordinary-local-fixture")

    def tearDown(self):
        self.server.shutdown(); self.thread.join(); self.server.server_close()

    def test_exact_active_identity_then_normal_interrupt(self):
        self.stop.bind(*IDS)
        receipt = self.stop.stop()
        self.assertEqual(receipt["status"], "host_acknowledged")
        self.assertEqual(self.calls[-1], ("POST", f"/v1/agent-sessions/{IDS[0]}/turns/{IDS[2]}/interrupt"))
        self.assertNotIn("ordinary-local-fixture", json.dumps(receipt))

    def test_completed_or_different_turn_is_not_a_stop_target(self):
        self.stop.bind(*IDS); self.active = ""
        with self.assertRaisesRegex(ValueError, "identity differs"): self.stop.bind(*IDS)
        with self.assertRaisesRegex(ValueError, "No verified"): self.stop.stop()
        self.assertFalse(any(method == "POST" for method, _ in self.calls))

    def test_halt_closes_admission_before_owner_ack_and_does_not_retry(self):
        with tempfile.TemporaryDirectory() as root:
            ledger = Path(root)/"ledger.json"
            budget = policy.Budget(ledger, {"schema_version": 2, "feature": "FEAT-162"}, offline=True)
            budget.arm(); budget.begin_case("E1"); budget.owner_stop = self.stop; self.stop.bind(*IDS)
            self.before_stop = lambda: self.assertEqual((json.loads(ledger.read_text())["armed"], json.loads(ledger.read_text())["halted"]), (False, True))
            budget.halt("ordinary_stop"); budget.halt("already_stopped")
            self.assertEqual(budget.state["owner_stop"]["status"], "host_acknowledged")
            self.assertEqual(sum(method == "POST" for method, _ in self.calls), 1)

    def test_unconfirmed_stop_never_rearms_or_claims_ack(self):
        self.status = 409
        with tempfile.TemporaryDirectory() as root:
            budget = policy.Budget(Path(root)/"ledger.json", {"schema_version": 2, "feature": "FEAT-162"}, offline=True)
            budget.arm(); budget.owner_stop = self.stop; self.stop.bind(*IDS)
            budget.halt("ordinary_completed_turn")
            self.assertTrue(budget.state["halted"])
            self.assertEqual(budget.state["owner_stop"]["status"], "unconfirmed")

    def test_native_added_chunk_stops_before_forward_permission(self):
        with tempfile.TemporaryDirectory() as root:
            budget = policy.Budget(Path(root)/"ledger.json", {"schema_version": 2, "feature": "FEAT-162"}, offline=True)
            budget.arm(); budget.begin_case("E1"); budget.owner_stop = self.stop; self.stop.bind(*IDS)
            observer = policy.legacy.ProposalObserver(budget)
            chunk = b'data: {"type":"response.output_item.added","item":{"type":"web_search_call"}}\n\n'
            allowed = policy.legacy.observe_tool_chunk(budget, observer, chunk)
            self.assertFalse(allowed)
            self.assertEqual(budget.state["owner_stop"]["status"], "host_acknowledged")
            self.assertEqual(sum(method == "POST" for method, _ in self.calls), 1)

    def test_runtime_identity_changes_do_not_change_product_config_or_bytes(self):
        body = {"model": policy.legacy.shared.MODEL, "stream": True, "input": [], "tools": [],
                "client_metadata": {"thread_id": IDS[1], "turn_id": IDS[2]}}
        payload = json.dumps(body).encode(); outbound, first = policy.prepare(payload)
        self.assertEqual(outbound, payload)
        body["client_metadata"]["turn_id"] = IDS[0]
        _, second = policy.prepare(json.dumps(body).encode())
        self.assertEqual(first["model_config_sha256"], second["model_config_sha256"])
        self.assertNotEqual(first["runtime_turn_id"], second["runtime_turn_id"])
        body["client_metadata"]["x-codex-turn-metadata"] = json.dumps({"turn_id": IDS[2]})
        with self.assertRaisesRegex(ValueError, "Inconsistent"): policy.prepare(json.dumps(body).encode())

    def test_native_item_with_usage_still_keeps_unknown_reserve(self):
        with tempfile.TemporaryDirectory() as root:
            budget = policy.Budget(Path(root)/"ledger.json", {"schema_version": 2, "feature": "FEAT-162"}, offline=True)
            budget.arm(); budget.begin_case("E1")
            row = budget.admit({})
            budget.settle(row, {"native_search_calls": 1, "stream_complete": True, "terminal_count": 1,
                               "response_model": policy.legacy.shared.MODEL, "usage": {"input_tokens": 10, "output_tokens": 10}})
            self.assertEqual(row["status"], "unknown_reserved")
            self.assertNotIn("charged_upper_micro_cny", row)


if __name__ == "__main__": unittest.main()
