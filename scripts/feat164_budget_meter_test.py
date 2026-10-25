"""Ordinary in-process accounting/stream controls; no provider connection."""
import importlib.util
import copy
import hashlib
import fcntl
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("meter", Path(__file__).with_name("feat164-budget-meter.py"))
meter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(meter)


class BudgetControls(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="feat164-budget-control-")
        self.path = Path(self.directory.name) / "ledger.json"
        self.budget = meter.Budget(self.path)

    def tearDown(self):
        self.directory.cleanup()

    def admitted(self, images=0):
        return self.budget.admit({"image_count": images})

    def settle(self, row, input_tokens=1000, output_tokens=100):
        self.budget.settle(row, {"response_model": meter.MODEL, "terminal": "response.completed",
            "terminal_count": 1, "stream_complete": True,
            "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens}})

    def test_request_and_reservation_are_bounded_before_network(self):
        row = self.admitted()
        self.assertLessEqual(self.budget.state["charged_upper_micro_cny"], meter.LIMIT)
        with self.assertRaises(ValueError):
            self.admitted()
        self.settle(row, meter.CONTEXT, meter.MAX_OUTPUT)
        with self.assertRaises(ValueError):
            self.admitted()

    def test_usage_releases_only_reported_conservative_cost(self):
        row = self.admitted(); self.settle(row)
        self.assertEqual(self.budget.state["charged_upper_micro_cny"], 19800)
        self.assertEqual(meter.Budget(self.path).state, self.budget.state)
        self.admitted()

    def test_missing_usage_stays_reserved_and_stops_restart(self):
        row = self.admitted(); self.budget.settle(row, {"terminal": "response.failed"})
        self.assertEqual(self.budget.state["charged_upper_micro_cny"], meter.RESERVATION)
        with self.assertRaises(ValueError):
            meter.Budget(self.path).admit({"image_count": 0})

    def test_normal_close_retains_ledger_and_image_allowance(self):
        row = self.admitted(1); self.settle(row)
        self.budget.closed = True
        with self.assertRaises(ValueError):
            self.admitted()
        reopened = meter.Budget(self.path)
        with self.assertRaises(ValueError):
            reopened.admit({"image_count": 1})
        reopened.admit({"image_count": 0})

    def test_adjustments_are_explicit_and_tool_choice_is_preserved(self):
        request = {"model": meter.MODEL, "reasoning": {"effort": "max"}, "stream": True,
            "input": "普通合成文本", "tool_choice": "auto", "tools": [{"type": "web_search"}]}
        raw, metadata = meter.prepare_request(json.dumps(request).encode())
        result = json.loads(raw)
        self.assertEqual(result["max_output_tokens"], 8192)
        self.assertEqual(result["tool_choice"], "auto")
        self.assertEqual(result["tools"], [])
        self.assertEqual(metadata["native_search_omitted"], 1)
        self.assertNotIn("input", metadata)

    def test_sse_observer_keeps_only_usage_and_public_terminal_metadata(self):
        event = {"type": "response.completed", "response": {"model": meter.MODEL,
            "output": [{"type": "message", "content": [{"text": "普通合成回答"}]}],
            "usage": {"input_tokens": 1000, "output_tokens": 100}}}
        stream = ("data: " + json.dumps(event) + "\n\n").encode()
        observer = meter.Observer()
        for pos in range(0, len(stream), 7):
            observer.feed(stream[pos:pos+7])
        self.assertEqual(observer.result["usage"]["output_tokens"], 100)
        self.assertNotIn("普通合成回答", json.dumps(observer.result, ensure_ascii=False))

    def test_search_removal_also_removes_only_documented_search_include(self):
        request = {"model": meter.MODEL, "reasoning": {"effort": "max"}, "stream": True,
            "input": "ordinary", "tools": [{"type": "web_search"}],
            "include": ["web_search_call.action.sources"]}
        raw, metadata = meter.prepare_request(json.dumps(request).encode())
        self.assertEqual(json.loads(raw)["include"], [])
        self.assertEqual(metadata["native_search_include_omitted"], request["include"])
        request["include"].append("reasoning.encrypted_content")
        with self.assertRaises(ValueError):
            meter.prepare_request(json.dumps(request).encode())

    def test_http_error_hints_are_closed_and_never_release_unknown_usage(self):
        payload = json.dumps({"error": {"type": "invalid_request_error",
            "message": "Unsupported include reasoning.encrypted_content. Ordinary diagnostic marker.",
            "code": "ordinary-unretained-value"}}).encode()
        observed = meter.error_metadata(payload)
        self.assertEqual(observed, {"provider_error_category": "invalid_request_error",
            "provider_error_mentions": ["reasoning.encrypted_content"]})
        self.assertNotIn("diagnostic marker", json.dumps(observed))
        row = self.admitted(); self.budget.settle(row, observed)
        self.assertTrue(self.budget.state["halted"])
        self.assertEqual(self.budget.state["charged_upper_micro_cny"], meter.RESERVATION)
        self.assertEqual(meter.error_metadata(b"ordinary non-JSON response"),
            {"provider_error_category": "unclassified", "provider_error_mentions": []})

    def prepare_resume(self):
        row = self.admitted()
        self.budget.settle(row, {"http_status": 400})
        self.budget.state["meter_state"] = "stopped_normally"
        self.budget.save()
        authorization = {"schema_version": 1, "feature": "FEAT-164",
            "authorization_id": meter.RESUME_ID, "approved_by": "ordinary Owner fixture",
            "approved_on": "2026-10-25", "approval_source": "current-user-confirmation-2026-10-25",
            "previous_ledger_sha256": hashlib.sha256(self.path.read_bytes()).hexdigest(),
            "limit_micro_cny": 30_000_000, "additional_http_requests": 1,
            "preserve_unknown_reservations": True, "failure_policy": "stop", "scope": "one_budgeted_text_g2v"}
        return authorization

    def test_resume_preserves_history_and_allows_only_one_request_across_restart(self):
        authorization = self.prepare_resume()
        original = copy.deepcopy(self.budget.state["requests"])
        meter.resume_ledger(self.path, authorization)
        self.budget = meter.Budget(self.path)
        self.assertEqual(self.budget.state["requests"], original)
        self.assertEqual(self.budget.state["charged_upper_micro_cny"], meter.RESERVATION)
        row = self.admitted()
        self.assertEqual(self.budget.state["charged_upper_micro_cny"], 2 * meter.RESERVATION)
        self.assertLessEqual(2 * meter.RESERVATION, 30_000_000)
        self.settle(row)
        self.assertEqual(self.budget.state["requests"][:1], original)
        for budget in [self.budget, meter.Budget(self.path)]:
            with self.assertRaises(ValueError):
                budget.admit({"image_count": 0})
        before = self.path.read_bytes()
        result = meter.resume_ledger(self.path, authorization)
        self.assertTrue(result["already_applied"])
        self.assertEqual(result["remaining_http_requests"], 0)
        self.assertEqual(self.path.read_bytes(), before)

    def test_failed_resume_keeps_both_reservations_and_cannot_refill(self):
        authorization = self.prepare_resume()
        meter.resume_ledger(self.path, authorization)
        self.budget = meter.Budget(self.path)
        row = self.admitted()
        self.budget.settle(row, {"http_status": 400})
        self.assertEqual(self.budget.state["charged_upper_micro_cny"], 2 * meter.RESERVATION)
        self.assertTrue(meter.Budget(self.path).state["halted"])
        meter.resume_ledger(self.path, authorization)
        with self.assertRaises(ValueError):
            meter.Budget(self.path).admit({"image_count": 0})

    def test_resume_rejects_wrong_source_scope_and_active_meter_lock(self):
        authorization = self.prepare_resume()
        before = self.path.read_bytes()
        for changed in [{"previous_ledger_sha256": "0" * 64}, {"additional_http_requests": 2},
                        {"limit_micro_cny": 40_000_000}, {"preserve_unknown_reservations": False}]:
            with self.assertRaises(ValueError):
                meter.resume_ledger(self.path, {**authorization, **changed})
            self.assertEqual(self.path.read_bytes(), before)
        with open(self.path.with_suffix(".lock"), "a") as guard:
            fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                meter.resume_ledger(self.path, authorization)
        self.assertEqual(self.path.read_bytes(), before)

    def test_old_per_row_reservation_survives_global_policy_changes(self):
        self.prepare_resume()
        self.budget.state["requests"][0]["reserved_micro_cny"] = 10_000_000
        self.budget.state["charged_upper_micro_cny"] = 10_000_000
        self.budget.save()
        self.assertEqual(meter.Budget(self.path).state["charged_upper_micro_cny"], 10_000_000)

    def test_new_inflight_on_restart_is_closed_and_original_row_is_verified(self):
        authorization = self.prepare_resume()
        meter.resume_ledger(self.path, authorization)
        self.budget = meter.Budget(self.path)
        self.admitted()
        with self.assertRaises(ValueError):
            meter.Budget(self.path).admit({"image_count": 0})
        altered = json.loads(self.path.read_text())
        altered["requests"][0]["http_status"] = 200
        self.path.write_text(json.dumps(altered))
        with self.assertRaises(ValueError):
            meter.Budget(self.path)

    def test_duplicate_terminal_and_incomplete_stream_do_not_release_reservation(self):
        observer = meter.Observer()
        event = {"type": "response.completed", "response": {"model": meter.MODEL,
            "status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "ordinary"}]}],
            "usage": {"input_tokens": 10, "output_tokens": 5}}}
        observer.feed(("data: " + json.dumps(event) + "\n\n").encode() * 2)
        self.assertEqual(observer.result["terminal_count"], 2)
        self.assertTrue(observer.result["output_text_present"])
        row = self.admitted()
        self.budget.settle(row, {**observer.result, "stream_complete": True})
        self.assertEqual(self.budget.state["charged_upper_micro_cny"], meter.RESERVATION)
        self.assertTrue(self.budget.state["halted"])
        separate = meter.Budget(Path(self.directory.name) / "incomplete.json")
        row = separate.admit({"image_count": 0})
        separate.settle(row, {**observer.result, "terminal_count": 1, "stream_complete": False})
        self.assertEqual(separate.state["charged_upper_micro_cny"], meter.RESERVATION)

    def test_resume_rejection_closes_admission_without_spending_or_refilling(self):
        authorization = self.prepare_resume()
        meter.resume_ledger(self.path, authorization)
        self.budget = meter.Budget(self.path)
        with self.assertRaises(ValueError):
            self.admitted(1)
        self.budget.stop_resume_on_rejection()
        meter.resume_ledger(self.path, authorization)
        reopened = meter.Budget(self.path)
        self.assertEqual(len(reopened.state["requests"]), 1)
        with self.assertRaises(ValueError):
            reopened.admit({"image_count": 0})


if __name__ == "__main__":
    unittest.main()
