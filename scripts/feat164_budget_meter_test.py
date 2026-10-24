"""Ordinary in-process accounting/stream controls; no provider connection."""
import importlib.util
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
        self.budget.settle(row, {"response_model": meter.MODEL,
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


if __name__ == "__main__":
    unittest.main()
