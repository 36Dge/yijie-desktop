#!/usr/bin/env python3
"""One approved FEAT-162 client run. No Agent loop and no tool execution.

The existing verification adapter owns request normalization and SSE observation.
This ledger cannot consume, resume or replace any FEAT-164 allowance.
"""
import argparse
import copy
import fcntl
import hashlib
import hmac
import http.client
import http.server
import importlib.util
import json
import os
from pathlib import Path
import re
import threading

spec = importlib.util.spec_from_file_location("feat164_meter", Path(__file__).with_name("feat164-budget-meter.py"))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
LIMIT = 43_000_000
RESERVE = 1_048_576 * 13 + 8_288 * 68
TOOLS_RESERVE = 20_000
AUTHORITY = "FEAT-162-20261028-client-3-1-1-CNY43"
CONTINUATION = "FEAT-162-20261028-client-total5-CNY43"
ADDITIONAL_FOUR = "FEAT-162-20261028-client-total7-CNY43"
TOOLS = {"search": {"query": "IANA example domains", "limit": 3},
         "fetch": {"url": "https://www.iana.org/help/example-domains"}}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def successful_tool(value):
    """Narrow acceptance predicate, not a replacement for the wire validator.

    Runtime renders MCP content as text and drops isError. Only recognizable,
    nonempty, untruncated results can advance this particular paid acceptance.
    """
    if isinstance(value, str):
        match = re.fullmatch(r"Wall time: [0-9.]+ seconds\nOutput:\n(.*)", value, re.S)
        return successful_tool(json.loads(match[1] if match else value))
    if isinstance(value, list):
        require(len(value) == 1 and isinstance(value[0], dict) and value[0].get("type") == "text", "Expected one tool text")
        return successful_tool(value[0].get("text"))
    require(isinstance(value, dict) and value.get("isError") is not True
            and value.get("is_error") is not True and not value.get("error"), "Tool failed or unknown")
    if "content" in value:
        result = successful_tool(value["content"])
        if "structuredContent" in value:
            require(result == successful_tool(value["structuredContent"]), "Tool result mismatch")
        return result
    require(value.get("truncated") is False, "Truncated or unknown tool result")
    nonempty = lambda v: isinstance(v, str) and bool(v.strip())
    if set(value) == {"results", "truncated"}:
        rows = value["results"]
        require(isinstance(rows, list) and 1 <= len(rows) <= 3, "Search content acceptance")
        require(all(isinstance(r, dict) and set(r) == {"title", "url", "snippet"}
                    and all(nonempty(r[k]) for k in r) and r["url"].startswith(("https://", "http://"))
                    for r in rows), "Search content acceptance")
        return "search"
    require(set(value) == {"url", "title", "markdown", "truncated"}
            and value["url"] == TOOLS["fetch"]["url"]
            and nonempty(value["title"]) and nonempty(value["markdown"]), "Fetch content acceptance")
    return "fetch"


def prepare(payload):
    outgoing, metadata = shared.prepare_request(payload)
    require(metadata["image_count"] == 0, "Text-only approved run")
    body = json.loads(outgoing)
    allowed_names = {"kimi_web_search", "kimi_web_fetch"}
    selected = []
    omitted = []
    for tool in body.get("tools", []):
        if tool.get("name") == "mcp__yijie_market" and isinstance(tool.get("tools"), list):
            functions = [f for f in tool["tools"] if f.get("name") in allowed_names]
            if functions:
                selected.append({**tool, "tools": functions})
        elif tool.get("name") in allowed_names or tool.get("name") in {"mcp__yijie_market__" + n for n in allowed_names}:
            selected.append(tool)
        else:
            omitted.append(tool.get("name", tool.get("type")))
    body["tools"] = selected
    outgoing = json.dumps(body).encode()
    metadata["other_tools_omitted"] = omitted
    metadata["request_adjustments"].append("only_selected_kimi_tools_for_this_acceptance")
    outputs = [v for v in body.get("input", []) if isinstance(v, dict)
               and v.get("type") in {"function_call_output", "custom_tool_call_output"}]
    metadata["tool_results"] = [{"kind": successful_tool(v.get("output")), "call_ref": v.get("call_id")} for v in outputs]
    metadata["tool_result_count"] = len(outputs)
    metadata["tool_result_sha256"] = [shared.canonical_digest(v) for v in outputs]
    metadata["request_sha256"] = hashlib.sha256(outgoing).hexdigest()
    metadata["request_bytes"] = len(outgoing)
    # Only tool names, never prompts, results, arguments or keys.
    metadata["declared_tools"] = []
    for tool in body.get("tools", []):
        if isinstance(tool.get("name"), str):
            metadata["declared_tools"].append(tool["name"])
        for nested in tool.get("tools", []):
            if isinstance(nested, dict) and isinstance(nested.get("name"), str):
                metadata["declared_tools"].append(nested["name"])
    return outgoing, metadata


class Budget:
    def __init__(self, path, offline=False):
        self.path = Path(path)
        self.lock = threading.RLock()
        self.offline = offline
        self.state = json.loads(self.path.read_text()) if self.path.exists() else {
            "schema_version": 1, "feature": "FEAT-162", "authorization": AUTHORITY,
            "offline": offline, "model_http_limit": 3, "total_limit_micro_cny": LIMIT,
            "tool_reserved_micro_cny": TOOLS_RESERVE, "model_upper_micro_cny": 0,
            "armed": False, "armed_once": False, "halted": False,
            "requests": [], "tool_approvals": [], "meter_state": "created"}
        s = self.state
        require(s["schema_version"] == 1 and s["feature"] == "FEAT-162" and s["authorization"] in {AUTHORITY, CONTINUATION, ADDITIONAL_FOUR},
                "Independent FEAT-162 authority required")
        self.carried_count = 0
        self.carried_cost = 0
        if s["authorization"] in {CONTINUATION, ADDITIONAL_FOUR}:
            limit, previous_authority, expected_count = (5, AUTHORITY, 2) if s["authorization"] == CONTINUATION else (7, CONTINUATION, 3)
            require(not offline and s["model_http_limit"] == limit, "Explicit continuation only")
            carried = s["carryover"]
            prior = Path(carried["ledger_path"])
            require(hashlib.sha256(prior.read_bytes()).hexdigest() == carried["ledger_sha256"], "Prior ledger changed")
            old = json.loads(prior.read_text())
            require(old["authorization"] == previous_authority and old["meter_state"] == "stopped_normally"
                    and old["halted"] and not old["armed"]
                    and all(r["status"] != "inflight" for r in old["requests"]), "Closed prior run required")
            ancestor = old.get("carryover", {})
            if ancestor:
                ancestor_path = Path(ancestor["ledger_path"])
                require(hashlib.sha256(ancestor_path.read_bytes()).hexdigest() == ancestor["ledger_sha256"], "Ancestor ledger changed")
                root = json.loads(ancestor_path.read_text())
                require(root["authorization"] == AUTHORITY and len(root["requests"]) == ancestor["model_http_count"]
                        and root["model_upper_micro_cny"] == ancestor["model_upper_micro_cny"], "Ancestor accounting mismatch")
            self.carried_count = len(old["requests"]) + ancestor.get("model_http_count", 0)
            require(self.carried_count == expected_count, "Reviewed prior count required")
            self.carried_cost = old["model_upper_micro_cny"]
            require(self.carried_cost == ancestor.get("model_upper_micro_cny", 0) + sum(
                r.get("charged_upper_micro_cny", r["reserved_micro_cny"]) for r in old["requests"]), "Prior cost mismatch")
            require(carried["model_http_count"] == self.carried_count
                    and carried["model_upper_micro_cny"] == self.carried_cost, "Carryover mismatch")
            proof = json.loads(Path(carried["evidence_path"]).read_text())
            require(hashlib.sha256(Path(carried["evidence_path"]).read_bytes()).hexdigest() == carried["evidence_sha256"], "Continuation evidence changed")
            require(proof["authorization"] == s["authorization"] and proof["total_model_limit"] == limit
                    and proof["budget_micro_cny"] == LIMIT and proof["prior_ledger_sha256"] == carried["ledger_sha256"]
                    and proof["actual_tool_http"] == {"search": 0, "fetch": 0}, "Explicit total limits and zero tool sends required")
        else:
            require(s["model_http_limit"] == 3, "Original limit")
        require(s["offline"] is offline and s["total_limit_micro_cny"] == LIMIT
                and s["tool_reserved_micro_cny"] == TOOLS_RESERVE, "Fixed approved limits required")
        rows = s["requests"]
        require(isinstance(rows, list) and len(rows) + self.carried_count <= s["model_http_limit"]
                and all(r["ordinal"] == i + 1 + self.carried_count for i, r in enumerate(rows)), "Request sequence")
        require(self.carried_cost + sum(r.get("charged_upper_micro_cny", r["reserved_micro_cny"]) for r in rows) == s["model_upper_micro_cny"], "Accounting mismatch")
        approvals = s["tool_approvals"]
        require(len(approvals) <= 2 and len({x["kind"] for x in approvals}) == len(approvals)
                and all(x["arguments"] == TOOLS.get(x["kind"]) for x in approvals), "Tool approval bound")
        require(0 <= s["model_upper_micro_cny"] + TOOLS_RESERVE <= LIMIT, "Budget exceeded")
        if s["meter_state"] == "running" or any(r["status"] in {"inflight", "unknown_reserved"} for r in rows):
            self.halt("unfinished_or_unknown_request")

    def save(self):
        temporary = self.path.with_suffix(".pending.json")
        fd = os.open(temporary, os.O_CREAT | os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(self.state, f, indent=2); f.write("\n"); f.flush(); os.fsync(f.fileno())
        os.replace(temporary, self.path)
        fd = os.open(self.path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def halt(self, reason):
        with self.lock:
            self.state.update(armed=False, halted=True, stop_reason=reason)
            self.save()

    def arm(self):
        with self.lock:
            require(not self.state["halted"] and not self.state["armed_once"] and not self.state["requests"], "One arm only")
            self.state.update(armed=True, armed_once=True); self.save()

    def tool_approval(self, kind, arguments, call_ref):
        with self.lock:
            require(not self.offline and self.state["armed"] and not self.state["halted"], "Live approved run required")
            require(kind in TOOLS and arguments == TOOLS[kind] and isinstance(call_ref, str) and 0 < len(call_ref) <= 128, "Fixed tool intent")
            require(not any(x["kind"] == kind for x in self.state["tool_approvals"]), "Tool allowance already reserved")
            self.state["tool_approvals"].append({"kind": kind, "arguments": copy.deepcopy(arguments), "call_ref": call_ref,
                                                 "status": "reserved_before_ui_approval_not_http_evidence"})
            self.save()

    def proposal(self, item):
        require(item.get("type") == "function_call", "Expected function proposal")
        name = item.get("name", "")
        require(item.get("namespace") == "mcp__yijie_market" or name.startswith("mcp__yijie_market__"), "Selected tool namespace")
        kind = name.removeprefix("mcp__yijie_market__").removeprefix("kimi_web_")
        arguments = json.loads(item.get("arguments", ""))
        call_ref = item.get("call_id")
        with self.lock:
            for previous in self.state["tool_approvals"]:
                if previous["call_ref"] == call_ref:
                    require(previous["kind"] == kind and previous["arguments"] == arguments, "Changed tool proposal")
                    return
            self.tool_approval(kind, arguments, call_ref)
            self.state["tool_approvals"][-1]["status"] = "proposal_reserved_not_ui_approval_or_http_evidence"
            self.save()

    def admit(self, metadata):
        with self.lock:
            s = self.state
            require(s["armed"] and not s["halted"] and len(s["requests"]) + self.carried_count < s["model_http_limit"]
                    and not any(r["status"] == "inflight" for r in s["requests"]), "No model allowance")
            for result in metadata.get("tool_results", []):
                require(any(p["kind"] == result["kind"] and p["call_ref"] == result["call_ref"] for p in s["tool_approvals"]), "Unregistered tool result")
            reserve = 0 if self.offline else RESERVE
            require(s["model_upper_micro_cny"] + reserve + TOOLS_RESERVE <= LIMIT, "Insufficient reserved budget")
            row = {**metadata, "ordinal": len(s["requests"]) + self.carried_count + 1, "status": "inflight", "reserved_micro_cny": reserve,
                   "supplier_http_started": False}
            s["requests"].append(row); s["model_upper_micro_cny"] += reserve; self.save()
            return row

    def settle(self, row, observation):
        with self.lock:
            usage = observation.get("usage", {})
            valid = (isinstance(usage, dict) and all(type(usage.get(k)) is int and usage[k] >= 0 for k in ["input_tokens", "output_tokens"])
                     and usage["input_tokens"] <= 1_048_576 and usage["output_tokens"] <= 8_288
                     and observation.get("response_model") == shared.MODEL and observation.get("terminal_count") == 1
                     and observation.get("stream_complete") is True and observation.get("native_search_calls", 0) == 0
                     and observation.get("cache_ttl", "5m") == "5m")
            row.update(observation)
            if valid:
                charge = 0 if self.offline else usage["input_tokens"] * 13 + usage["output_tokens"] * 68
                row.update(status="settled", charged_upper_micro_cny=charge)
                self.state["model_upper_micro_cny"] += charge - row["reserved_micro_cny"]
            else:
                row["status"] = "unknown_reserved"
            if not valid or not shared.successful_terminal(row):
                self.halt("first_failure_or_incomplete_or_unknown")
            if len(self.state["requests"]) + self.carried_count == self.state["model_http_limit"]:
                self.state["armed"] = False
            self.save()


def create_continuation(previous, path, evidence):
    previous, path, evidence = Path(previous).resolve(strict=True), Path(path), Path(evidence).resolve(strict=True)
    authorization = json.loads(evidence.read_text())["authorization"]
    require(authorization in {CONTINUATION, ADDITIONAL_FOUR}, "Explicit continuation authority")
    name, limit = ("live-ledger-continued.json", 5) if authorization == CONTINUATION else ("live-ledger-additional4.json", 7)
    require(path.name == name and not path.exists()
            and path.parent == previous.parent, "One separately named continuation ledger")
    with open(previous.with_suffix(".lock"), "a") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old = json.loads(previous.read_text())
        state = {"schema_version": 1, "feature": "FEAT-162", "authorization": authorization,
                 "offline": False, "model_http_limit": limit, "total_limit_micro_cny": LIMIT,
                 "tool_reserved_micro_cny": TOOLS_RESERVE, "model_upper_micro_cny": old["model_upper_micro_cny"],
                 "armed": False, "armed_once": False, "halted": False, "requests": [], "tool_approvals": [], "meter_state": "created",
                 "carryover": {"ledger_path": str(previous), "ledger_sha256": hashlib.sha256(previous.read_bytes()).hexdigest(),
                     "model_http_count": len(old["requests"]) + old.get("carryover", {}).get("model_http_count", 0), "model_upper_micro_cny": old["model_upper_micro_cny"],
                     "evidence_path": str(evidence), "evidence_sha256": hashlib.sha256(evidence.read_bytes()).hexdigest()}}
        # Validate using a temporary ordinary document before creating the ledger.
        candidate = path.with_suffix(".candidate.json")
        with candidate.open("x") as f:
            json.dump(state, f)
        try:
            Budget(candidate)
            with path.open("x") as f:
                json.dump(state, f, indent=2); f.write("\n"); f.flush(); os.fsync(f.fileno())
        finally:
            candidate.unlink()


class ProposalObserver:
    """Observe, never rewrite, actual SSE proposals before UI approval."""
    def __init__(self, budget):
        self.budget, self.buffer = budget, b""
        self.failure_metadata = {}
        self.native_search_ids = set()

    def feed(self, data):
        self.buffer += data
        require(len(self.buffer) <= 2 * 1024 * 1024, "Bounded proposal observation")
        while b"\n" in self.buffer:
            line, self.buffer = self.buffer.split(b"\n", 1)
            if not line.startswith(b"data:") or line[5:].strip() == b"[DONE]":
                continue
            event = json.loads(line[5:].strip())
            known_events = {"response.created", "response.in_progress", "response.completed",
                            "response.failed", "response.incomplete", "response.output_item.added",
                            "response.output_item.done", "response.function_call_arguments.done"}
            if event.get("type") in known_events:
                self.failure_metadata["last_observed_event_type"] = event["type"]
            if event.get("type") in {"response.failed", "response.incomplete"}:
                response = event.get("response", {})
                error = response.get("error")
                self.failure_metadata["provider_error_present"] = isinstance(error, dict)
                if isinstance(error, dict):
                    self.failure_metadata.update(shared.error_metadata(json.dumps({"error": error}).encode()))
                    code = error.get("code")
                    allowed_codes = {"server_error", "rate_limit_exceeded", "invalid_prompt", "context_length_exceeded",
                                     "insufficient_quota", "model_not_found", "invalid_api_key", "invalid_request_error"}
                    self.failure_metadata["provider_error_code"] = code if isinstance(code, str) and code in allowed_codes else "unclassified"
                    self.failure_metadata["provider_error_sha256"] = shared.canonical_digest(error)
                    message = str(error.get("message", "")).lower()
                    terms = {"quota_or_balance": ("quota", "balance", "credit", "余额", "额度"),
                             "rate_limit": ("rate limit", "too many requests", "限流"),
                             "server_busy": ("overload", "server error", "server busy", "unavailable", "繁忙"),
                             "authentication": ("authentication", "api key", "unauthorized", "鉴权"),
                             "invalid_argument": ("invalid", "unsupported", "not support", "不支持", "参数"),
                             "context_or_tokens": ("context", "token limit", "maximum token"),
                             "tool_call": ("tool", "function", "namespace")}
                    self.failure_metadata["provider_error_terms"] = [k for k, words in terms.items() if any(w in message for w in words)]
            if event.get("type") in {"response.failed", "response.incomplete"} and getattr(self.budget, "enforces_owner_stop", False):
                self.budget.halt("provider_terminal_failure")
            items = [event.get("item")] if event.get("type") in {"response.output_item.added", "response.output_item.done"} else []
            if event.get("type") == "response.completed":
                items += event.get("response", {}).get("output", [])
            for item in items:
                if isinstance(item, dict) and item.get("type") == "web_search_call" and hasattr(self.budget, "begin_case"):
                    self.native_search_ids.add(shared.canonical_digest(item.get("id", item)))
                    self.failure_metadata["observed_native_search_items"] = len(self.native_search_ids)
                    self.budget.halt("native_search_already_executed")
                if isinstance(item, dict) and item.get("type") == "function_call" and event.get("type") != "response.output_item.added":
                    known_names = {"kimi_web_search", "kimi_web_search_pro", "kimi_web_fetch",
                                   "exec_command", "write_stdin", "update_plan", "request_user_input",
                                   "publish_artifact", "get_goal", "create_goal", "update_goal"}
                    name = str(item.get("name", "")).removeprefix("mcp__yijie_market__")
                    self.failure_metadata["last_proposal_name"] = name if name in known_names else "other"
                    namespace = item.get("namespace")
                    self.failure_metadata["last_proposal_namespace"] = namespace if namespace in {None, "mcp__yijie_market", "functions"} else "other"
                    self.failure_metadata["last_proposal_sha256"] = shared.canonical_digest(item)
                    self.budget.proposal(item)



def observe_tool_chunk(budget, proposals, chunk):
    try:
        proposals.feed(chunk)
    except (ValueError, TypeError, AttributeError) as error:
        reasons = {"Unexpected namespace": "unexpected_namespace",
                   "Wrong route or additional tool": "wrong_route_or_additional_tool",
                   "Missing explicit filters": "missing_explicit_filters",
                   "Invented filters": "invented_filters",
                   "Changed proposal": "changed_proposal",
                   "No tool allowance": "no_tool_allowance",
                   "Missing call identity": "missing_call_identity"}
        proposals.failure_metadata["proposal_error_class"] = type(error).__name__
        proposals.failure_metadata["proposal_error_reason"] = reasons.get(str(error), "unclassified")
        budget.halt("invalid_or_repeated_tool_proposal")
    return not (getattr(budget, "enforces_owner_stop", False) and budget.state["halted"])


def offline_response():
    message = {"id": "msg_feat162_local", "type": "message", "role": "assistant", "status": "completed",
               "content": [{"type": "output_text", "text": "FEAT162 本机零费用正控通过。此为合成响应，没有访问供应商。", "annotations": []}]}
    response = {"id": "resp_feat162_local", "object": "response", "model": shared.MODEL, "status": "completed",
                "output": [message], "usage": {"input_tokens": 100, "output_tokens": 30, "total_tokens": 130}}
    events = [{"type": "response.created", "response": {**response, "status": "in_progress", "output": []}},
              {"type": "response.output_item.added", "output_index": 0, "item": {**message, "status": "in_progress", "content": []}},
              {"type": "response.output_text.delta", "item_id": message["id"], "output_index": 0, "content_index": 0, "delta": message["content"][0]["text"]},
              {"type": "response.output_item.done", "output_index": 0, "item": message},
              {"type": "response.completed", "response": response}]
    return b"".join(("data: " + json.dumps(e, ensure_ascii=False) + "\n\n").encode() for e in events)


def server_for(budget, key, control, address=("127.0.0.1", 18083)):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.path != "/health":
                self.send_error(404); return
            with budget.lock:
                data = json.dumps({"feature": "FEAT-162", "offline": budget.offline, "armed": budget.state["armed"],
                    "halted": budget.state["halted"], "model_requests": len(budget.state["requests"]),
                    "cumulative_model_requests": budget.carried_count + len(budget.state["requests"]),
                    "supplier_http_started": sum(r["supplier_http_started"] for r in budget.state["requests"]),
                    "model_upper_micro_cny": budget.state["model_upper_micro_cny"],
                    "tool_approval_reservations": len(budget.state["tool_approvals"])}).encode()
            self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

        def do_POST(self):
            if self.path.startswith("/control/"):
                if not hmac.compare_digest(self.headers.get("X-FEAT162-Control", ""), control):
                    self.send_error(403); return
                try:
                    if self.path == "/control/arm":
                        budget.arm()
                    elif self.path == "/control/tool-approval":
                        size = int(self.headers.get("Content-Length", "0")); require(0 < size <= 8192, "Control size")
                        value = json.loads(self.rfile.read(size)); budget.tool_approval(**value)
                    elif self.path == "/control/case" and hasattr(budget, "begin_case"):
                        size = int(self.headers.get("Content-Length", "0")); require(0 < size <= 1024, "Case control size")
                        budget.begin_case(json.loads(self.rfile.read(size))["case_id"])
                    elif self.path == "/control/complete-case" and hasattr(budget, "finish_case"):
                        budget.finish_case()
                    elif self.path == "/control/halt":
                        budget.halt("operator_stop")
                    elif self.path == "/control/stop":
                        with budget.lock:
                            require(not any(r["status"] == "inflight" for r in budget.state["requests"]), "Wait for owned request")
                            budget.halt("normal_stop")
                        self.send_response(204); self.end_headers(); threading.Thread(target=self.server.shutdown).start(); return
                    else:
                        self.send_error(404); return
                except (ValueError, TypeError):
                    self.send_error(409); return
                self.send_response(204); self.end_headers(); return
            if self.path != "/v1/responses" or not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + key):
                self.send_error(403); return
            try:
                length = int(self.headers.get("Content-Length", "0")); require(0 < length <= 4 * 1024 * 1024, "Request size")
                payload, metadata = getattr(budget, "prepare_request", prepare)(self.rfile.read(length))
                if not budget.offline:
                    names = {n.removeprefix("mcp__yijie_market__") for n in metadata["declared_tools"]}
                    require({"kimi_web_search", "kimi_web_fetch"} <= names, "Selected Kimi connector required")
                row = budget.admit(metadata)
            except (ValueError, TypeError, AttributeError):
                # A deliberately unarmed startup rejects without spending; an
                # actual armed-run deviation permanently stops future sends.
                if budget.state["armed"]:
                    budget.halt("request_rejected")
                self.send_error(429, "Verification unavailable"); return
            observer = shared.Observer(); proposals = ProposalObserver(budget)
            digest = hashlib.sha256(); count = 0; complete = False; connection = None
            try:
                if budget.offline:
                    chunks = [offline_response()]; status = 200; content_type = "text/event-stream"
                else:
                    connection = http.client.HTTPSConnection("api.moonshot.cn", timeout=240)
                    row["supplier_http_started"] = True; budget.save()
                    connection.request("POST", "/v1/responses", body=payload, headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
                    response = connection.getresponse(); status = response.status
                    content_type = response.getheader("Content-Type", "text/event-stream")
                    chunks = iter(lambda: response.read1(65536), b"")
                row["http_status"] = status
                self.send_response(status); self.send_header("Content-Type", content_type); self.send_header("Connection", "close")
                self.end_headers(); self.close_connection = True
                error_body = bytearray()
                for chunk in chunks:
                    if status >= 400:
                        error_body.extend(chunk[:max(0, 16385 - len(error_body))])
                    observer.feed(chunk)
                    if not budget.offline and not budget.state["halted"]:
                        observe_tool_chunk(budget, proposals, chunk)
                    if getattr(budget, "enforces_owner_stop", False) and budget.state["halted"]:
                        # The owner stop has been attempted synchronously. Never
                        # deliver the offending tool chunk after admission closes.
                        break
                    self.wfile.write(chunk); self.wfile.flush(); digest.update(chunk); count += len(chunk)
                complete = not (getattr(budget, "enforces_owner_stop", False) and budget.state["halted"])
                if status >= 400:
                    observer.result.update(shared.error_metadata(error_body))
            except (OSError, http.client.HTTPException) as error:
                observer.result = {"transport_error_class": type(error).__name__}
                self.close_connection = True
            finally:
                if connection:
                    connection.close()
                observer.result.update(proposals.failure_metadata)
                observer.result.update(stream_complete=complete, forwarded_response_sha256=digest.hexdigest(), forwarded_response_bytes=count)
                budget.settle(row, observer.result)
    return http.server.ThreadingHTTPServer(address, Handler)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ledger", required=True, type=Path)
    parser.add_argument("--kimi-key-file", type=Path)
    parser.add_argument("--control-token-file", type=Path)
    parser.add_argument("--authorization", required=True, choices=[AUTHORITY, CONTINUATION, ADDITIONAL_FOUR, "FEAT-162-basic-pro-v2", "FEAT-162-soft-budget-v3"])
    parser.add_argument("--create-continuation-from", type=Path)
    parser.add_argument("--continuation-evidence", type=Path)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--basic-pro-plan", type=Path)
    parser.add_argument("--owner-stop-url")
    parser.add_argument("--owner-token-file", type=Path)
    args = parser.parse_args()
    require(args.ledger.is_absolute() and args.ledger.parent.resolve(strict=True) == args.ledger.parent, "Canonical existing ledger directory")
    if args.create_continuation_from or args.continuation_evidence:
        require(args.authorization in {CONTINUATION, ADDITIONAL_FOUR} and args.create_continuation_from and args.continuation_evidence
                and not args.kimi_key_file and not args.control_token_file and not args.offline, "Creation does not read credentials")
        require(json.loads(args.continuation_evidence.read_text())["authorization"] == args.authorization, "Matching continuation evidence")
        create_continuation(args.create_continuation_from, args.ledger, args.continuation_evidence)
        print("FEAT-162 continuation created unarmed; prior ledger and unknown cost preserved")
        return
    require(args.kimi_key_file and args.control_token_file, "Existing credentials required")
    with open(args.ledger.with_suffix(".lock"), "a") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.authorization in {"FEAT-162-basic-pro-v2", "FEAT-162-soft-budget-v3"}:
            require(args.basic_pro_plan and not args.create_continuation_from, "New independent plan required")
            policy_file = "feat162-soft-budget-meter.py" if args.authorization == "FEAT-162-soft-budget-v3" else "feat162-basic-pro-meter.py"
            policy_spec = importlib.util.spec_from_file_location("feat162_current_policy", Path(__file__).with_name(policy_file))
            policy = importlib.util.module_from_spec(policy_spec); policy_spec.loader.exec_module(policy)
            budget = policy.Budget(args.ledger, json.loads(args.basic_pro_plan.read_text()), args.offline)
        else:
            require(not args.basic_pro_plan and not args.owner_stop_url and not args.owner_token_file, "Legacy ledgers cannot consume a v2 plan or stop adapter")
            budget = Budget(args.ledger, args.offline)
        require(budget.state["authorization"] == args.authorization, "Matching authority required")
        if args.authorization == "FEAT-162-basic-pro-v2" and not args.offline:
            # Fail before reading credentials or opening a listening socket.
            require(policy.LIVE_EXECUTION_QUALIFIED, "v2 live execution unqualified: native fee bound and owner stop evidence missing")
            budget.live_ready(require_owner=False)
            require(args.owner_stop_url and args.owner_token_file, "Explicit normal Owner stop configuration required")
            budget.owner_stop = policy.OwnerStop(args.owner_stop_url, shared.credential(args.owner_token_file))
            budget.live_ready()
        if args.authorization == "FEAT-162-soft-budget-v3" and not args.offline:
            budget.live_ready()
        key, control = shared.credential(args.kimi_key_file), shared.credential(args.control_token_file)
        server = server_for(budget, key, control)
        budget.state["meter_state"] = "running"; budget.save()
        print("FEAT-162 independent meter ready; unarmed; no automatic requests", flush=True)
        try:
            server.serve_forever()
        finally:
            server.server_close(); budget.state["meter_state"] = "stopped_normally"; budget.save()


if __name__ == "__main__":
    main()
