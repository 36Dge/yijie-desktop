"""Normal, offline metadata/accounting checks. No provider/process/failure injection."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

spec = importlib.util.spec_from_file_location("meter", Path(__file__).resolve().parents[1] / "feat171-budget-meter.py")
meter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(meter)


class BudgetTest(unittest.TestCase):
    def metadata(self, model="kimi-k3.1-pro", thread="ordinary-thread"):
        request = {"model": model, "stream": True, "client_metadata": {"thread_id": thread},
                   "tools": [{"type": "function", "name": "exec"}, {"type": "web_search"}], "input": []}
        payload, metadata = meter.prepare(json.dumps(request).encode(), {})
        self.assertEqual(json.loads(payload)["max_output_tokens"], 16384)
        self.assertEqual([t["type"] for t in json.loads(payload)["tools"]], ["function"])
        return metadata

    def observation(self, model):
        return {"usage": {"input_tokens": 1000, "output_tokens": 100}, "terminal_count": 1,
                "terminal": "response.completed", "response_model": model, "stream_complete": True}

    def test_reserve_settle_restart_and_same_thread(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "ledger.json"
            budget = meter.Budget(path)
            with self.assertRaises(ValueError):
                budget.admit(self.metadata())
            budget.arm("kimi-create")
            row = budget.admit(self.metadata())
            self.assertEqual(budget.state["charged_upper_micro_cny"], 1048576 * 13 + 16384 * 68)
            budget.settle(row, self.observation(row["model"]))
            self.assertEqual(budget.state["charged_upper_micro_cny"], 19800)
            with self.assertRaises(ValueError):
                budget.admit(self.metadata(thread="another-normal-chat"))
            restored = meter.Budget(path)
            self.assertIsNone(restored.state["active_case"])
            self.assertEqual(restored.state["charged_upper_micro_cny"], 19800)

    def test_two_kimi_cases_share_one_quota(self):
        with tempfile.TemporaryDirectory() as folder:
            budget = meter.Budget(Path(folder) / "ledger.json")
            for case in ("kimi-create", "kimi-update"):
                budget.arm(case)
                row = budget.admit(self.metadata(meter.CASES[case], case))
                budget.settle(row, self.observation(row["model"]))
            self.assertEqual(budget.state["charged_upper_micro_cny"], 39600)
            self.assertEqual(len(budget.state["requests"]), 2)

    def test_continuation_waits_for_normal_settlement(self):
        with tempfile.TemporaryDirectory() as folder:
            budget = meter.Budget(Path(folder) / "ledger.json")
            budget.arm("kimi-create")
            first = budget.admit(self.metadata())
            with ThreadPoolExecutor(max_workers=1) as executor:
                following = executor.submit(budget.admit, self.metadata())
                budget.settle(first, self.observation(first["model"]))
                second = following.result(timeout=2)
                self.assertEqual(second["ordinal"], 2)
                budget.settle(second, self.observation(second["model"]))
            self.assertEqual(budget.state["charged_upper_micro_cny"], 39600)

    def test_only_observed_cache_usage_gets_published_discount(self):
        with tempfile.TemporaryDirectory() as folder:
            budget = meter.Budget(Path(folder) / "ledger.json")
            budget.arm("kimi-create")
            row = budget.admit(self.metadata())
            observer = meter.Observer()
            event = {'type':'response.completed','response':{'model':'kimi-k3.1-pro','status':'completed',
                     'usage':{'input_tokens':1000,'output_tokens':100,'input_tokens_details':{'cached_tokens':800}},'output':[]}}
            data = ('data: '+json.dumps(event)+'\n\n').encode()
            observer.feed(data[:30]); observer.feed(data[30:])
            budget.settle(row, {**observer.result, 'stream_complete':True})
            self.assertEqual(budget.state['charged_upper_micro_cny'], 10440)

    def test_unknown_usage_keeps_reservation(self):
        with tempfile.TemporaryDirectory() as folder:
            budget = meter.Budget(Path(folder) / "ledger.json")
            budget.arm("kimi-create")
            row = budget.admit(self.metadata())
            budget.settle(row, {})
            self.assertEqual(budget.state["charged_upper_micro_cny"], row["reserved_micro_cny"])
            self.assertTrue(budget.state["halted"])
            with self.assertRaises(ValueError):
                budget.arm("kimi-update")

    def test_owner_excluded_minimax_before_dispatch(self):
        self.assertNotIn("MiniMax-M3", meter.MODELS)
        self.assertNotIn("minimax-create", meter.CASES)
        with self.assertRaises(ValueError):
            meter.prepare(json.dumps({"model":"MiniMax-M3","stream":True}).encode(), {})

    def test_request_and_cost_boundaries(self):
        with tempfile.TemporaryDirectory() as folder:
            budget = meter.Budget(Path(folder) / "ledger.json")
            budget.arm("kimi-create")
            for _ in range(80):
                row = budget.admit(self.metadata())
                budget.settle(row, self.observation(row["model"]))
            with self.assertRaises(ValueError):
                budget.admit(self.metadata())
        with tempfile.TemporaryDirectory() as folder:
            budget = meter.Budget(Path(folder) / "ledger.json")
            budget.arm("kimi-create")
            for _ in range(2):
                row = budget.admit(self.metadata())
                observation = self.observation(row["model"])
                observation["usage"] = {"input_tokens": 1048576, "output_tokens": 16384}
                budget.settle(row, observation)
            with self.assertRaises(ValueError):
                budget.admit(self.metadata())


if __name__ == "__main__":
    unittest.main()
