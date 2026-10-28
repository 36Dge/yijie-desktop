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
import threading

spec = importlib.util.spec_from_file_location("feat164_meter", Path(__file__).with_name("feat164-budget-meter.py"))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
LIMIT = 43_000_000
RESERVE = 1_048_576 * 13 + 8_288 * 68
TOOLS_RESERVE = 20_000
AUTHORITY = "FEAT-162-20261028-client-3-1-1-CNY43"
TOOLS = {"search": {"query": "IANA example domains", "limit": 3},
         "fetch": {"url": "https://www.iana.org/help/example-domains"}}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def failed_tool(value):
    if isinstance(value, str):
        try:
            return failed_tool(json.loads(value))
        except (ValueError, TypeError):
            return False
    if isinstance(value, list):
        return any(failed_tool(v) for v in value)
    if not isinstance(value, dict):
        return False
    if value.get("isError") is True or value.get("is_error") is True or value.get("error"):
        return True
    return any(failed_tool(v) for v in value.values())


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
    require(not any(failed_tool(v.get("output")) for v in outputs), "Tool failure stops further model requests")
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
        require(s["schema_version"] == 1 and s["feature"] == "FEAT-162" and s["authorization"] == AUTHORITY,
                "Independent FEAT-162 authority required")
        require(s["offline"] is offline and s["model_http_limit"] == 3 and s["total_limit_micro_cny"] == LIMIT
                and s["tool_reserved_micro_cny"] == TOOLS_RESERVE, "Fixed approved limits required")
        rows = s["requests"]
        require(isinstance(rows, list) and len(rows) <= 3 and all(r["ordinal"] == i + 1 for i, r in enumerate(rows)), "Request sequence")
        require(sum(r.get("charged_upper_micro_cny", r["reserved_micro_cny"]) for r in rows) == s["model_upper_micro_cny"], "Accounting mismatch")
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

    def admit(self, metadata):
        with self.lock:
            s = self.state
            require(s["armed"] and not s["halted"] and len(s["requests"]) < 3
                    and not any(r["status"] == "inflight" for r in s["requests"]), "No model allowance")
            reserve = 0 if self.offline else RESERVE
            require(s["model_upper_micro_cny"] + reserve + TOOLS_RESERVE <= LIMIT, "Insufficient reserved budget")
            row = {**metadata, "ordinal": len(s["requests"]) + 1, "status": "inflight", "reserved_micro_cny": reserve,
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
            if len(self.state["requests"]) == 3:
                self.state["armed"] = False
            self.save()


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
                payload, metadata = prepare(self.rfile.read(length))
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
            observer = shared.Observer(); digest = hashlib.sha256(); count = 0; complete = False; connection = None
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
                    observer.feed(chunk); self.wfile.write(chunk); self.wfile.flush(); digest.update(chunk); count += len(chunk)
                complete = True
                if status >= 400:
                    observer.result.update(shared.error_metadata(error_body))
            except (OSError, http.client.HTTPException) as error:
                observer.result = {"transport_error_class": type(error).__name__}
                self.close_connection = True
            finally:
                if connection:
                    connection.close()
                observer.result.update(stream_complete=complete, forwarded_response_sha256=digest.hexdigest(), forwarded_response_bytes=count)
                budget.settle(row, observer.result)
    return http.server.ThreadingHTTPServer(address, Handler)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ledger", required=True, type=Path)
    parser.add_argument("--kimi-key-file", required=True, type=Path)
    parser.add_argument("--control-token-file", required=True, type=Path)
    parser.add_argument("--authorization", required=True, choices=[AUTHORITY])
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    require(args.ledger.is_absolute() and args.ledger.parent.resolve(strict=True) == args.ledger.parent, "Canonical existing ledger directory")
    with open(args.ledger.with_suffix(".lock"), "a") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        budget = Budget(args.ledger, args.offline)
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
