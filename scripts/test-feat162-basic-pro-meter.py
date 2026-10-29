import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("policy", Path(__file__).with_name("feat162-basic-pro-meter.py"))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class BasicProMeterTests(unittest.TestCase):
    def body(self):
        return {"model": policy.legacy.shared.MODEL, "stream": True, "input": [], "max_output_tokens": 12000,
                "instructions": "普通产品规则", "tool_choice": "auto", "include": ["web_search_call.action.sources"],
                "tools": [{"type": "web_search"}, {"type": "function", "name": "ordinary_tool"},
                          {"type": "namespace", "name": "mcp__yijie_market", "tools": [{"name": "kimi_web_search_pro"}]}]}

    def test_request_bytes_keep_full_competition_and_product_output_limit(self):
        payload = json.dumps(self.body(), ensure_ascii=False).encode()
        outgoing, metadata = policy.prepare(payload)
        self.assertEqual(outgoing, payload)
        self.assertEqual(metadata["request_adjustments"], [])
        self.assertIn("web_search", metadata["declared_tools"])
        self.assertIn("ordinary_tool", metadata["declared_tools"])
        self.assertEqual(metadata["max_output_tokens"], 12000)

    def test_twenty_yuan_is_a_rolling_cap_not_permission_to_reserve_seventeen_requests(self):
        plan = {"input_tokens_max": 1_048_576, "max_output_tokens": 8288,
                "model_request_reserve_micro_cny": 14_195_072, "native_calls_per_model_max": 1,
                "total_limit_micro_cny": 20_000_000}
        reserve = policy.fee_reserve(plan)
        self.assertLessEqual(reserve + policy.REST_RESERVE, 20_000_000)
        self.assertGreater(17 * reserve + policy.REST_RESERVE, 20_000_000)
        # These are ordinary arithmetic values, not verified supplier bounds.
        self.assertFalse(policy.LIVE_EXECUTION_QUALIFIED)
        with self.assertRaisesRegex(ValueError, "next request"):
            policy.fee_reserve({**plan, "total_limit_micro_cny": reserve + policy.REST_RESERVE - 1})
        with self.assertRaisesRegex(ValueError, "too small"):
            policy.fee_reserve({**plan, "model_request_reserve_micro_cny": 1})

    def test_provider_default_bound_keeps_the_actual_output_field_absent(self):
        body = self.body(); del body["max_output_tokens"]
        payload = json.dumps(body).encode(); outbound, metadata = policy.prepare(payload)
        self.assertEqual(outbound, payload)
        plan = {"request_max_output_tokens": None, "max_output_tokens": 131072,
                "output_bound_source": "provider_default", "model_bound_evidence_sha256": "0" * 64}
        policy.request_output_bound_matches(plan, metadata)
        with self.assertRaisesRegex(ValueError, "default bound"):
            policy.request_output_bound_matches({**plan, "model_bound_evidence_sha256": None}, metadata)
        with self.assertRaisesRegex(ValueError, "field differs"):
            policy.request_output_bound_matches(plan, {"max_output_tokens": 8288})
        self.assertFalse(policy.LIVE_EXECUTION_QUALIFIED)

    def test_live_arm_without_authority_and_hard_bound_sends_nothing(self):
        with tempfile.TemporaryDirectory() as root:
            budget = policy.Budget(Path(root)/"new.json", {"schema_version": 2, "feature": "FEAT-162", "paid_authorized": False})
            with self.assertRaises(ValueError): budget.arm()
            self.assertEqual(budget.state["requests"], [])
            self.assertFalse(budget.state["armed"])

    def test_e5_keeps_four_requests_and_extra_proposal_is_rejected(self):
        self.assertEqual(sum(v[0] for v in policy.CASES.values()), 17)
        self.assertEqual(policy.CASES["E5"][0], 4)
        with tempfile.TemporaryDirectory() as root:
            budget = policy.Budget(Path(root)/"new.json", {"schema_version": 2, "feature": "FEAT-162"}, offline=True)
            budget.arm(); budget.begin_case("E6")
            item = {"type": "function_call", "namespace": "mcp__yijie_market", "name": "kimi_web_search_pro", "call_id": "call-1", "arguments": '{"query":"公开资料"}'}
            budget.proposal(item)
            budget.proposal(item)
            self.assertEqual(len(budget.state["tool_approvals"]), 1)
            self.assertNotIn("arguments", budget.state["tool_approvals"][0])
            with self.assertRaises(ValueError): budget.proposal({**item, "call_id": "call-2"})
            with self.assertRaises(ValueError): budget.begin_case("E7")

    def test_complete_unqualified_plan_still_cannot_arm(self):
        plan = {"schema_version": 2, "feature": "FEAT-162", "paid_authorized": True,
                "activation_qualified": True, "model_request_reserve_micro_cny": 100_000_000,
                "native_calls_per_model_max": 1, "max_output_tokens": 12000,
                "input_tokens_max": 1_048_576, "total_limit_micro_cny": 2_000_000_000}
        for key in ["model_config_sha256", "artifact_receipt_sha256", "native_bound_evidence_sha256", "authorization_evidence_sha256"]:
            plan[key] = "0" * 64
        with tempfile.TemporaryDirectory() as root:
            budget = policy.Budget(Path(root)/"new.json", plan)
            with self.assertRaisesRegex(ValueError, "unqualified"):
                budget.arm()
            self.assertFalse(budget.state["armed"])
            self.assertEqual(budget.state["requests"], [])

    def test_normalized_clipped_body_can_be_evidence_but_empty_body_cannot(self):
        good = {"results": [{"url": "https://example.org/", "text": "可核对材料", "content_status": "truncated"}], "truncated": True, "dropped_results": 1}
        self.assertEqual(policy.tool_result(good)["kind"], "body")
        good["results"][0]["text"] = ""
        with self.assertRaises(ValueError): policy.tool_result(good)

    def test_native_observation_halts_future_requests_and_keeps_unknown_reserve(self):
        with tempfile.TemporaryDirectory() as root:
            budget = policy.Budget(Path(root)/"new.json", {"schema_version": 2, "feature": "FEAT-162"}, offline=True)
            budget.arm(); budget.begin_case("E1")
            _, metadata = policy.prepare(json.dumps(self.body()).encode())
            row = budget.admit(metadata)
            budget.settle(row, {"native_search_calls": 1, "stream_complete": True})
            self.assertTrue(budget.state["halted"])
            self.assertEqual(row["status"], "unknown_reserved")
            with self.assertRaises(ValueError): budget.admit(metadata)


if __name__ == "__main__": unittest.main()
