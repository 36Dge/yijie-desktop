"""Normal JSON/loopback tests only; no supplier, App or fixture executable."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("alpha", Path(__file__).with_name("feat162-alpha-meter.py"))
alpha = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alpha)


class AlphaTests(unittest.TestCase):
    def budget(self, root, offline=False):
        root = Path(root)
        prior = root / "prior.json"
        prior.write_text(json.dumps({"authorization": "FEAT-162-soft-budget-v3", "halted": True,
            "armed": False, "meter_state": "stopped_normally", "requests": [],
            "carried_count": 3, "carried_cost_micro_cny": 3_000_000, "model_upper_micro_cny": 0}))
        receipt = root / "receipt.json"
        receipt.write_text('{"synthetic_metadata":"not actual App qualification"}')
        plan = {"feature": "FEAT-162", "authority": alpha.AUTHORITY, "paid_authorized": True,
                "soft_threshold_micro_cny": alpha.THRESHOLD, "allow_inflight_overshoot": True,
                "prior_ledger": str(prior), "prior_ledger_sha256": alpha.sha(prior),
                "artifact_receipt_file": str(receipt), "artifact_receipt_sha256": alpha.sha(receipt),
                "authorization_evidence_file": str(receipt), "authorization_evidence_sha256": alpha.sha(receipt)}
        return alpha.Budget(root / "alpha.json", plan, offline)

    def test_seven_cases_and_no_automatic_pass(self):
        with tempfile.TemporaryDirectory() as root:
            budget = self.budget(root, True)
            budget.arm()
            for case in alpha.CASES:
                budget.begin_case(case)
                row = budget.admit({})
                budget.settle(row, {})
                budget.finish_case()
            self.assertEqual(budget.state["closed_cases"], ["E1", "E2", "E3", "E4", "E5", "E6", "E7"])
            self.assertNotIn("acceptance", budget.state)
            self.assertFalse(budget.state["halted"])

    def test_original_payload_and_ordinary_tool_results_not_graded(self):
        body = {"model": alpha.legacy.shared.MODEL, "stream": True, "tools": [{"type": "web_search"}],
                "input": [{"type": "function_call_output", "call_id": "ordinary", "output": "ordinary empty-result response"}]}
        payload = json.dumps(body, indent=2).encode()
        actual, metadata = alpha.prepare(payload)
        self.assertEqual(actual, payload)
        self.assertEqual(metadata["request_adjustments"], [])
        self.assertNotIn("tool_results", metadata)

    def test_unknown_usage_and_native_observation_keep_estimate_without_rejecting_alpha(self):
        with tempfile.TemporaryDirectory() as root:
            b = self.budget(root); b.arm(); b.begin_case("E1")
            row = b.admit({}); b.settle(row, {"native_search_calls": 1})
            self.assertFalse(b.state["halted"])
            self.assertEqual(row["status"], "unknown_estimate")
            self.assertEqual(b.state["model_upper_micro_cny"], alpha.ESTIMATE)

    def test_observation_does_not_gate_tools_or_grant_approval(self):
        with tempfile.TemporaryDirectory() as root:
            b = self.budget(root, True)
            observer = alpha.legacy.ProposalObserver(b)
            chunk = b'data: {"type":"response.output_item.added","item":{"type":"web_search_call","id":"ordinary"}}\n\n'
            self.assertTrue(alpha.legacy.observe_tool_chunk(b, observer, chunk))
            self.assertFalse(b.state["halted"])
            with self.assertRaises(ValueError): b.tool_approval()

    def test_soft_stop_allows_inflight_overshoot_but_no_next(self):
        with tempfile.TemporaryDirectory() as root:
            b = self.budget(root); b.state["carried_cost_micro_cny"] = 19_800_000
            b.arm(); b.begin_case("E1"); row = b.admit({})
            self.assertGreater(b.observed_total(), alpha.THRESHOLD)
            b.settle(row, {})
            self.assertTrue(b.state["halted"])
            with self.assertRaises(ValueError): b.admit({})

    def test_single_inflight_includes_auxiliary_and_preserves_prior(self):
        with tempfile.TemporaryDirectory() as root:
            b = self.budget(root); old = (Path(root) / "prior.json").read_bytes()
            b.arm(); row = b.admit({})
            self.assertEqual(row["case"], "auxiliary")
            waiting = threading.Event()
            original_wait = b.request_finished.wait
            def wait(timeout=None):
                waiting.set()
                return original_wait(timeout)
            with patch.object(b.request_finished, "wait", wait), ThreadPoolExecutor(1) as pool:
                next_request = pool.submit(b.admit, {})
                self.assertTrue(waiting.wait(2))
                self.assertEqual(len(b.state["requests"]), 1)
                b.settle(row, {"usage": {"input_tokens": 100, "output_tokens": 10}})
                second = next_request.result(timeout=2)
                self.assertEqual(second["ordinal"], 2)
                b.settle(second, {"usage": {"input_tokens": 0, "output_tokens": 0}})
            self.assertEqual(b.state["model_upper_micro_cny"], 1980)
            self.assertEqual(b.carried_count, 3)
            self.assertEqual((Path(root) / "prior.json").read_bytes(), old)

    def test_queued_request_rechecks_soft_stop_after_settlement(self):
        with tempfile.TemporaryDirectory() as root:
            b = self.budget(root); b.arm(); row = b.admit({})
            waiting = threading.Event(); original_wait = b.request_finished.wait
            def wait(timeout=None):
                waiting.set()
                return original_wait(timeout)
            with patch.object(b.request_finished, "wait", wait), ThreadPoolExecutor(1) as pool:
                next_request = pool.submit(b.admit, {})
                self.assertTrue(waiting.wait(2))
                b.settle(row, {"usage": {"input_tokens": 2_000_000, "output_tokens": 0}})
                with self.assertRaises(ValueError): next_request.result(timeout=2)
            self.assertEqual(len(b.state["requests"]), 1)

    def test_closed_alpha_continuation_carries_estimates_without_rewriting_history(self):
        with tempfile.TemporaryDirectory() as root:
            b = self.budget(root); b.arm(); b.admit({})
            b.settle(b.state["requests"][0], {})
            b.halt("normal_stop"); b.state["meter_state"] = "stopped_normally"; b.save()
            old = b.path.read_bytes()
            plan = {**b.plan, "prior_ledger": str(b.path), "prior_ledger_sha256": alpha.sha(b.path)}
            c = alpha.Budget(Path(root) / "continuation.json", plan)
            self.assertEqual(c.carried_count, 4)
            self.assertEqual(c.state["carried_cost_micro_cny"], 4_105_000)
            self.assertEqual(b.path.read_bytes(), old)

    def test_unarmed_and_reused_files_refused(self):
        with tempfile.TemporaryDirectory() as root:
            b = self.budget(root)
            with self.assertRaises(ValueError): b.admit({})
            b.save()
            with self.assertRaises(ValueError): alpha.Budget(b.path, b.plan)


if __name__ == "__main__":
    unittest.main()
