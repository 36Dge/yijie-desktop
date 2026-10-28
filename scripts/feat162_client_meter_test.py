"""Normal accounting and local HTTP; no supplier, fault injection or binaries."""
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest

spec = importlib.util.spec_from_file_location("meter162", Path(__file__).with_name("feat162-client-meter.py"))
meter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(meter)


def success(input_tokens=1000, output_tokens=100):
    return {"http_status": 200, "response_model": meter.shared.MODEL, "response_status": "completed",
            "terminal": "response.completed", "terminal_count": 1, "stream_complete": True,
            "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens}}


def tool_output(value):
    return "Wall time: 0.1200 seconds\nOutput:\n" + json.dumps([{"type": "text", "text": json.dumps(value, ensure_ascii=False)}])


SEARCH = {"results": [{"title": "Public documentation", "url": "https://www.iana.org/help/example-domains", "snippet": "Ordinary public result"}], "truncated": False}
FETCH = {"url": meter.TOOLS["fetch"]["url"], "title": "Example domains", "markdown": "Public example documentation.", "truncated": False}


class Accounting(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="feat162-meter-")
        self.path = Path(self.directory.name).resolve() / "ledger.json"
        self.budget = meter.Budget(self.path)

    def tearDown(self):
        self.directory.cleanup()

    def test_unarmed_rejects_before_reservation(self):
        with self.assertRaises(ValueError):
            self.budget.admit({})
        self.assertEqual(self.budget.state["requests"], [])

    def test_three_full_context_reservations_and_fourth_rejection(self):
        self.budget.arm()
        for i in range(3):
            row = self.budget.admit({})
            self.assertEqual(json.loads(self.path.read_text())["requests"][-1]["status"], "inflight")
            self.budget.settle(row, success(1_048_576, 8_288))
        self.assertEqual(self.budget.state["model_upper_micro_cny"] + meter.TOOLS_RESERVE, 42_605_216)
        with self.assertRaises(ValueError):
            self.budget.admit({})
        self.assertEqual(len(self.budget.state["requests"]), 3)

    def test_concurrent_request_cannot_spend_second_slot(self):
        self.budget.arm(); row = self.budget.admit({})
        with self.assertRaises(ValueError):
            self.budget.admit({})
        self.budget.settle(row, success())
        self.assertEqual(self.budget.state["model_upper_micro_cny"], 19800)

    def test_failure_stops_and_preserves_unknown_reservation(self):
        self.budget.arm(); row = self.budget.admit({})
        self.budget.settle(row, {"http_status": 500})
        self.assertEqual(self.budget.state["model_upper_micro_cny"], meter.RESERVE)
        reopened = meter.Budget(self.path)
        with self.assertRaises(ValueError):
            reopened.admit({})
        self.assertEqual(reopened.state["requests"][0]["status"], "unknown_reserved")

    def test_incomplete_response_settles_usage_but_never_reopens_allowance(self):
        self.budget.arm(); row = self.budget.admit({})
        value = success(); value.update(terminal="response.incomplete", response_status="incomplete")
        self.budget.settle(row, value)
        self.assertTrue(self.budget.state["halted"])
        self.assertEqual(self.budget.state["model_upper_micro_cny"], 19800)

    def test_tool_intents_reserve_once_and_preserve_exact_public_parameters(self):
        self.budget.arm()
        for kind in meter.TOOLS:
            self.budget.tool_approval(kind, meter.TOOLS[kind], "ordinary-call-" + kind)
            with self.assertRaises(ValueError):
                self.budget.tool_approval(kind, meter.TOOLS[kind], "another-call")
        self.assertEqual(len(self.budget.state["tool_approvals"]), 2)
        self.assertEqual(self.budget.state["requests"], [])

    def test_request_normalization_retains_functions_and_removes_unpriced_search(self):
        request = {"model": meter.shared.MODEL, "reasoning": {"effort": "max"}, "stream": True,
                   "input": [], "tools": [{"type": "web_search"}, {"type": "function", "name": "exec_command"}, {"type": "function", "name": "kimi_web_search"}]}
        raw, meta = meter.prepare(json.dumps(request).encode())
        self.assertEqual(json.loads(raw)["max_output_tokens"], 8192)
        self.assertEqual(meta["declared_tools"], ["kimi_web_search"])
        self.assertEqual(meta["native_search_omitted"], 1)
        self.assertEqual(meta["other_tools_omitted"], ["exec_command"])
        self.assertNotIn("input", meta)

    def test_selected_namespace_retains_both_canonical_kimi_tools(self):
        request = {"model": meter.shared.MODEL, "reasoning": {"effort": "max"}, "stream": True,
                   "input": [], "tools": [{"type": "namespace", "name": "mcp__yijie_market", "tools": [
                       {"type": "function", "name": name} for name in ['kimi_web_search', 'kimi_web_fetch']]}]}
        raw, meta = meter.prepare(json.dumps(request).encode())
        self.assertEqual(json.loads(raw)["tools"], request["tools"])
        self.assertEqual(meta["declared_tools"], ['mcp__yijie_market', 'kimi_web_search', 'kimi_web_fetch'])

    def test_offline_terminal_has_required_runtime_usage_total(self):
        event = json.loads(meter.offline_response().decode().strip().splitlines()[-1][6:])
        usage = event['response']['usage']
        self.assertEqual(usage['total_tokens'], usage['input_tokens'] + usage['output_tokens'])

    def test_failed_tool_output_blocks_next_model_request(self):
        request = {"model": meter.shared.MODEL, "reasoning": {"effort": "max"}, "stream": True,
                   "input": [{"type": "function_call_output", "output": json.dumps({"isError": True, "content": []})}]}
        with self.assertRaises(ValueError):
            meter.prepare(json.dumps(request).encode())

    def test_successful_tool_result_hash_does_not_persist_content(self):
        request = {"model": meter.shared.MODEL, "reasoning": {"effort": "max"}, "stream": True,
                   "input": [{"type": "function_call_output", "call_id": "ordinary-call", "output": tool_output(SEARCH)}]}
        _, metadata = meter.prepare(json.dumps(request).encode())
        self.assertEqual(metadata["tool_result_count"], 1)
        self.assertEqual(metadata["tool_results"], [{"kind": "search", "call_ref": "ordinary-call"}])
        self.assertNotIn("Ordinary public result", json.dumps(metadata))

    def test_runtime_wrapped_search_and_fetch_and_normal_stop_text(self):
        for kind, result in (("search", SEARCH), ("fetch", FETCH)):
            self.assertEqual(meter.successful_tool(tool_output(result)), kind)
        stopped = "Wall time: 49.5695 seconds\nOutput:\n" + json.dumps([{"type": "text", "text": "本次连接器调用在进入外部执行前已停止，外部请求未发送。不会自动重试。"}])
        for output in (stopped, tool_output({"error": {"code": "cancelled"}}), tool_output({**SEARCH, "truncated": True}), "unavailable"):
            with self.subTest(output=output), self.assertRaises(ValueError):
                meter.successful_tool(output)

    def test_actual_proposal_observation_is_not_ui_approval_or_http(self):
        self.budget.arm()
        observer = meter.ProposalObserver(self.budget)
        item = {"type": "function_call", "namespace": "mcp__yijie_market", "name": "kimi_web_search",
                "call_id": "ordinary-call", "arguments": json.dumps(meter.TOOLS["search"])}
        event = ("data: " + json.dumps({"type": "response.output_item.done", "item": item}) + "\n\n").encode()
        observer.feed(event[:19]); observer.feed(event[19:]); observer.feed(event)
        self.assertEqual(len(self.budget.state["tool_approvals"]), 1)
        self.assertEqual(self.budget.state["requests"], [])
        self.assertEqual(self.budget.state["tool_approvals"][0]["status"], "proposal_reserved_not_ui_approval_or_http_evidence")
        with self.assertRaises(ValueError):
            self.budget.proposal({**item, "call_id": "second-search"})

    def continuation(self):
        self.budget.arm()
        row = self.budget.admit({}); self.budget.settle(row, success(6725, 262))
        row = self.budget.admit({}); self.budget.settle(row, {"http_status": 200, "terminal": "response.failed"})
        self.budget.state["meter_state"] = "stopped_normally"; self.budget.save()
        original = self.path.read_bytes()
        evidence = self.path.parent / "continuation.json"
        evidence.write_text(json.dumps({"authorization": meter.CONTINUATION, "total_model_limit": 5,
            "budget_micro_cny": meter.LIMIT, "prior_ledger_sha256": hashlib.sha256(original).hexdigest(),
            "actual_tool_http": {"search": 0, "fetch": 0}}))
        continued = self.path.parent / "live-ledger-continued.json"
        meter.create_continuation(self.path, continued, evidence)
        self.assertEqual(self.path.read_bytes(), original)
        return meter.Budget(continued)

    def test_sse_failure_retains_closed_diagnostics_without_provider_prose(self):
        observer = meter.ProposalObserver(self.budget)
        event = {"type": "response.failed", "response": {"error": {
            "type": "invalid_request_error", "code": "invalid_prompt", "message": "ordinary diagnostic about namespace"}}}
        observer.feed(("data: " + json.dumps(event) + "\n\n").encode())
        self.assertEqual(observer.failure_metadata["provider_error_category"], "invalid_request_error")
        self.assertEqual(observer.failure_metadata["provider_error_code"], "invalid_prompt")
        self.assertEqual(observer.failure_metadata["provider_error_mentions"], ["namespace"])
        self.assertNotIn("ordinary diagnostic", json.dumps(observer.failure_metadata))
        self.assertEqual(self.budget.state["requests"], [])

    def test_explicit_continuation_preserves_unknown_cost_and_total_five(self):
        budget = self.continuation()
        self.assertEqual(budget.state["model_upper_micro_cny"], 14_300_313)
        budget.arm()
        for ordinal in (3, 4, 5):
            row = budget.admit({}); self.assertEqual(row["ordinal"], ordinal)
            budget.settle(row, success())
        self.assertEqual(budget.state["model_upper_micro_cny"], 14_300_313 + 3 * 19800)
        with self.assertRaises(ValueError):
            budget.admit({})

    def test_continuation_keeps_43_budget_despite_extra_count(self):
        budget = self.continuation(); budget.arm()
        for _ in range(2):
            row = budget.admit({}); budget.settle(row, success(1_048_576, 8288))
        with self.assertRaises(ValueError):
            budget.admit({})
        self.assertEqual(len(budget.state["requests"]), 2)

    def test_four_more_authorized_calls_carry_both_unknown_reservations(self):
        budget = self.continuation(); budget.arm()
        row = budget.admit({}); budget.settle(row, {"http_status": 200, "terminal": "response.failed"})
        budget.state["meter_state"] = "stopped_normally"; budget.save()
        previous = budget.path.read_bytes()
        evidence = self.path.parent / "additional-four.json"
        evidence.write_text(json.dumps({"authorization": meter.ADDITIONAL_FOUR, "total_model_limit": 7,
            "budget_micro_cny": meter.LIMIT, "prior_ledger_sha256": hashlib.sha256(previous).hexdigest(),
            "actual_tool_http": {"search": 0, "fetch": 0}}))
        path = self.path.parent / "live-ledger-additional4.json"
        meter.create_continuation(budget.path, path, evidence)
        continued = meter.Budget(path)
        self.assertEqual(continued.carried_count, 3)
        self.assertEqual(continued.carried_cost, 28_495_385)
        self.assertEqual(budget.path.read_bytes(), previous)
        continued.arm(); row = continued.admit({})
        self.assertEqual(row['ordinal'], 4)
        self.assertEqual(continued.state['model_upper_micro_cny'] + meter.TOOLS_RESERVE, 42_710_457)
        continued.settle(row, {"http_status": 200, "terminal": "response.failed"})
        with self.assertRaises(ValueError):
            continued.admit({})

    def test_local_http_normal_tool_rejection_never_reserves_or_sends(self):
        budget = meter.Budget(self.path, offline=True); budget.arm()
        server = meter.server_for(budget, "ordinary-key", "ordinary-control", ("127.0.0.1", 0))
        thread = threading.Thread(target=server.serve_forever); thread.start()
        request = {"model": meter.shared.MODEL, "reasoning": {"effort": "max"}, "stream": True,
                   "input": [{"type": "function_call_output", "output": "Wall time: 0.1 seconds\nOutput:\n" + json.dumps([{"type": "text", "text": "本次连接器调用在进入外部执行前已停止，外部请求未发送。不会自动重试。"}])}]}
        try:
            c = http.client.HTTPConnection(*server.server_address, timeout=10)
            c.request("POST", "/v1/responses", json.dumps(request), {"Authorization": "Bearer ordinary-key"})
            r = c.getresponse(); r.read(); c.close()
            self.assertEqual(r.status, 429); self.assertTrue(budget.state["halted"])
            self.assertEqual(budget.state["requests"], [])
        finally:
            server.shutdown(); thread.join(); server.server_close()

    def test_local_server_rejects_unarmed_then_streams_without_supplier_and_stops_normally(self):
        budget = meter.Budget(self.path, offline=True)
        server = meter.server_for(budget, "ordinary-local-key", "ordinary-local-control", ("127.0.0.1", 0))
        thread = threading.Thread(target=server.serve_forever); thread.start()
        def post(path, value=None, control=False):
            connection = http.client.HTTPConnection(*server.server_address, timeout=10)
            headers = {"X-FEAT162-Control": "ordinary-local-control"} if control else {"Authorization": "Bearer ordinary-local-key"}
            connection.request("POST", path, body=json.dumps(value).encode() if value else b"", headers=headers)
            response = connection.getresponse(); data = response.read(); status = response.status; connection.close()
            return status, data
        try:
            request = {"model": meter.shared.MODEL, "reasoning": {"effort": "max"}, "stream": True, "input": []}
            self.assertEqual(post("/v1/responses", request)[0], 429)
            self.assertEqual(budget.state["requests"], [])
            self.assertEqual(post("/control/arm", control=True)[0], 204)
            status, data = post("/v1/responses", request)
            self.assertEqual(status, 200); self.assertEqual(data, meter.offline_response())
            self.assertEqual(post("/control/stop", control=True)[0], 204)
            self.assertFalse(budget.state["requests"][0]["supplier_http_started"])
            self.assertEqual(budget.state["requests"][0]["forwarded_response_sha256"], hashlib.sha256(data).hexdigest())
            self.assertEqual(budget.state["model_upper_micro_cny"], 0)
        finally:
            server.shutdown(); thread.join(); server.server_close()


if __name__ == "__main__":
    unittest.main()
