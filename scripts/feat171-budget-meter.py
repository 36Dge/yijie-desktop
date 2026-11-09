#!/usr/bin/env python3
"""FEAT-171's explicitly approved, independent 30 CNY / 80 HTTP acceptance.

Local verification only. No product execution/approval policy. Real Responses
SSE is forwarded unchanged, output capped at 16384, unpriced hosted tools omitted.
Full model context is reserved before HTTP. Verified Kimi cache usage settles
at its published rate; absent cache metadata retains full input pricing.
No prompts, responses or credentials are persisted. Unknown usage stops admission.
"""
import argparse
import datetime
import fcntl
import hashlib
import hmac
import http.client
import http.server
import importlib.util
import json
import os
from pathlib import Path
import secrets
import threading
import time

spec = importlib.util.spec_from_file_location("feat164_meter_primitives", Path(__file__).with_name("feat164-budget-meter.py"))
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
LIMIT = 30_000_000
REQUESTS = 80
OUTPUT = 16384
AUTHORIZATION = "FEAT-171-20261109-30CNY-80HTTP"
# Owner narrowed this acceptance to Kimi on 2026-11-09 before any MiniMax HTTP.
# Product MiniMax support is unchanged; this verification grant cannot spend it.
MODELS = {"kimi-k3.1-pro": ("api.moonshot.cn", 1048576, 13, 68)}
CASES = {"kimi-create": "kimi-k3.1-pro", "kimi-update": "kimi-k3.1-pro"}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class Observer(legacy.Observer):
    def __init__(self):
        super().__init__()
        self.cache_buffer = b""

    def feed(self, data):
        super().feed(data)
        self.cache_buffer += data
        if len(self.cache_buffer) > 2 * 1024 * 1024:
            self.cache_buffer = b""
            return
        while b"\n" in self.cache_buffer:
            line, self.cache_buffer = self.cache_buffer.split(b"\n", 1)
            if not line.startswith(b"data:"):
                continue
            try:
                event = json.loads(line[5:].strip())
                if event.get("type") not in ("response.completed", "response.incomplete", "response.failed"):
                    continue
                usage = event.get("response", {}).get("usage", {})
                cached = usage.get("input_tokens_details", {}).get("cached_tokens")
                if type(cached) is int and 0 <= cached <= usage.get("input_tokens", -1):
                    self.result["usage"]["cached_input_tokens"] = cached
            except (ValueError, AttributeError, TypeError, KeyError):
                pass  # No cache discount without a valid observed count.


def prepare(payload, headers):
    body = json.loads(payload)
    if (not isinstance(body, dict) or body.get("model") not in MODELS or body.get("stream") is not True
            or body.get("previous_response_id") or body.get("conversation") or body.get("background")
            or body.get("prompt_cache_options", {}).get("ttl", "5m") != "5m"
            or body.get("service_tier", "auto") not in ("auto", "default", "priority", "standard")):
        raise ValueError("Unqualified model/context/billing profile")
    cap = body.get("max_output_tokens")
    if cap is not None and (type(cap) is not int or cap <= 0):
        raise ValueError("Output limit invalid")
    body["max_output_tokens"] = min(cap or OUTPUT, OUTPUT)
    declarations = body.get("tools", [])
    if not isinstance(declarations, list) or any(not isinstance(t, dict) for t in declarations):
        raise ValueError("Tool declarations invalid")
    # Local function/custom/namespace/tool-search tools execute in native Codex.
    if any(t.get("type") not in ("function", "custom", "namespace", "tool_search", "web_search") for t in declarations):
        raise ValueError("Hosted tool billing not qualified")
    body["tools"] = [t for t in declarations if t.get("type") != "web_search"]
    include = body.get("include", [])
    if not isinstance(include, list):
        raise ValueError("Invalid include")
    body["include"] = [v for v in include if v not in ("web_search_call.action.sources", "web_search_call.results")]
    identity = body.get("client_metadata", {})
    nested = json.loads(identity.get("x-codex-turn-metadata", headers.get("x-codex-turn-metadata", "{}")))
    thread = identity.get("thread_id", nested.get("thread_id", headers.get("thread-id")))
    if not isinstance(thread, str) or not thread or len(thread) > 128:
        raise ValueError("Native thread identity required")
    def images(v):
        if isinstance(v, dict):
            return int(v.get("type") == "input_image") + sum(images(x) for x in v.values())
        return sum(images(x) for x in v) if isinstance(v, list) else 0
    return json.dumps(body, ensure_ascii=False).encode(), {
        "model": body["model"], "thread_id": thread,
        "turn_id": identity.get("turn_id", nested.get("turn_id")),
        "original_max_output_tokens": cap, "max_output_tokens": body["max_output_tokens"],
        "image_count": images(body.get("input")), "native_search_omitted": len(declarations) - len(body["tools"]),
        "request_adjustments": ["bounded_max_output_tokens", "omit_unpriced_native_search_and_search_include", "json_encoding"],
        "original_request_sha256": hashlib.sha256(payload).hexdigest(), "original_request_bytes": len(payload),
    }


class Budget:
    def __init__(self, path):
        self.path, self.lock = path, threading.RLock()
        self.changed = threading.Condition(self.lock)
        self.state = json.loads(path.read_text()) if path.exists() else {
            "schema_version": 1, "feature": "FEAT-171", "authorization_id": AUTHORIZATION,
            "approved_by": "段成威", "approval_source": "current-user-reply:批准：30 元／80 次请求",
            "recorded_at": now(), "limit_micro_cny": LIMIT, "max_http_requests": REQUESTS,
            "charged_upper_micro_cny": 0, "requests": [], "cases": {}, "active_case": None,
            "halted": False, "rates_checked_on": "2026-11-09", "meter_state": "created"}
        s = self.state
        if (s.get("authorization_id") != AUTHORIZATION or s.get("limit_micro_cny") != LIMIT
                or s.get("max_http_requests") != REQUESTS or s.get("feature") != "FEAT-171"):
            raise ValueError("Independent approved ledger required")
        rows = s["requests"]
        if (any(r.get("ordinal") != i + 1 or r.get("model") not in MODELS for i, r in enumerate(rows))
                or sum(r.get("charged_upper_micro_cny", r["reserved_micro_cny"]) for r in rows) != s["charged_upper_micro_cny"]
                or not 0 <= s["charged_upper_micro_cny"] <= LIMIT or len(rows) > REQUESTS):
            raise ValueError("Ledger accounting differs")
        if any(r["status"] != "settled" for r in rows):
            s["halted"] = True
        s["active_case"] = None  # Restart never silently authorizes another task.

    def save(self):
        temporary = self.path.with_suffix(".pending.json")
        with open(temporary, "w", encoding="utf8") as target:
            json.dump(self.state, target, indent=2, ensure_ascii=False)
            target.write("\n"); target.flush(); os.fsync(target.fileno())
        os.replace(temporary, self.path)
        directory = os.open(self.path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    def arm(self, case):
        with self.lock:
            if case not in CASES or self.state["halted"] or self.inflight():
                raise ValueError("Acceptance case unavailable")
            self.state["cases"].setdefault(case, {"model": CASES[case], "thread_id": None})
            self.state["active_case"] = case
            self.save()

    def inflight(self):
        return any(r["status"] == "inflight" for r in self.state["requests"])

    def admit(self, meta):
        with self.lock:
            # Native may finish its next local tool before the preceding HTTP
            # connection reaches EOF. Wait for settlement, without spending a
            # second reservation or rejecting a legitimate continuation.
            deadline = time.monotonic() + 30
            while self.inflight() and not self.state["halted"]:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ValueError("Prior request settlement still pending")
                self.changed.wait(remaining)
            s, case = self.state, self.state["active_case"]
            reservation = MODELS[meta["model"]][1] * MODELS[meta["model"]][2] + meta["max_output_tokens"] * MODELS[meta["model"]][3]
            if (s["halted"] or case not in CASES or CASES[case] != meta["model"] or self.inflight()
                    or len(s["requests"]) >= REQUESTS or s["charged_upper_micro_cny"] + reservation > LIMIT):
                raise ValueError("Budget admission unavailable")
            binding = s["cases"][case]
            if binding["thread_id"] not in (None, meta["thread_id"]):
                raise ValueError("Acceptance thread differs")
            binding["thread_id"] = meta["thread_id"]
            row = {**meta, "case": case, "ordinal": len(s["requests"]) + 1, "admitted_at": now(),
                   "status": "inflight", "reserved_micro_cny": reservation}
            s["requests"].append(row); s["charged_upper_micro_cny"] += reservation
            self.save()
            return row

    def settle(self, row, observation):
        with self.lock:
            usage = observation.get("usage")
            _, context, input_rate, output_rate = MODELS[row["model"]]
            valid = (isinstance(usage, dict) and all(type(usage.get(k)) is int and usage[k] >= 0 for k in ("input_tokens", "output_tokens"))
                     and usage["input_tokens"] <= context and usage["output_tokens"] <= row["max_output_tokens"]
                     and observation.get("terminal_count") == 1 and observation.get("stream_complete") is True
                     and observation.get("response_model") == row["model"]
                     and observation.get("native_search_calls", 0) == 0 and observation.get("cache_ttl", "5m") == "5m")
            row.update(observation); row["settled_at"] = now()
            if valid:
                cost = usage["input_tokens"] * input_rate + usage["output_tokens"] * output_rate
                cached = usage.get("cached_input_tokens", 0)
                if row["model"] == "kimi-k3.1-pro" and type(cached) is int and 0 <= cached <= usage["input_tokens"]:
                    # 13 / 1.3 / 68 CNY per MTok; round UP to integer micro-CNY.
                    cost = ((usage["input_tokens"] - cached) * 130 + cached * 13 + usage["output_tokens"] * 680 + 9) // 10
                    row["cache_pricing"] = "verified_usage_kimi_5m_1.3_CNY_per_MTok"
                row.update(status="settled", charged_upper_micro_cny=cost)
                self.state["charged_upper_micro_cny"] += cost - row["reserved_micro_cny"]
            else:
                row["status"] = "unknown_reserved"
                self.state["halted"] = True
            self.save()
            self.changed.notify_all()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("serve", "status", "arm", "stop"))
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--case", choices=CASES)
    parser.add_argument("--kimi-key-file", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    root = args.directory.resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    token_path, ledger_path = root / "control-token", root / "ledger.json"
    if args.action != "serve":
        connection = http.client.HTTPConnection("127.0.0.1", 18083, timeout=10)
        method, route = ("GET", "/health") if args.action == "status" else ("POST", "/control/" + args.action)
        connection.request(method, route, json.dumps({"case": args.case}), {"X-FEAT171-Control": legacy.credential(token_path)})
        response = connection.getresponse()
        print(response.status, response.read(16384).decode()); connection.close()
        if response.status >= 400:
            raise SystemExit(1)
        return
    if not args.kimi_key_file:
        parser.error("The existing owner-only Kimi key source is required")
    with open(root / "ledger.lock", "a") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        budget = Budget(ledger_path)
        keys = {"kimi-k3.1-pro": legacy.credential(args.kimi_key_file)}
        if not token_path.exists():
            with token_path.open("x") as target:
                target.write(secrets.token_hex(32))
        control = legacy.credential(token_path)

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                if self.path != "/health":
                    self.send_error(404); return
                with budget.lock:
                    value = json.dumps({k: budget.state[k] for k in ("feature", "active_case", "charged_upper_micro_cny", "halted", "meter_state")}
                                       | {"requests": len(budget.state["requests"])}).encode()
                self.send_response(200); self.send_header("Content-Length", str(len(value))); self.end_headers(); self.wfile.write(value)

            def do_POST(self):
                if self.path in ("/control/arm", "/control/stop"):
                    if not hmac.compare_digest(self.headers.get("X-FEAT171-Control", ""), control):
                        self.send_error(403); return
                    try:
                        with budget.lock:
                            if budget.inflight():
                                raise ValueError("Request still in flight")
                            if self.path.endswith("arm"):
                                count = int(self.headers.get("Content-Length", "0"))
                                if not 0 < count <= 1024:
                                    raise ValueError("Control size invalid")
                                budget.arm(json.loads(self.rfile.read(count))["case"])
                            else:
                                budget.state["active_case"] = None; budget.save()
                    except (ValueError, KeyError):
                        self.send_error(409, "Control unavailable"); return
                    self.send_response(204); self.end_headers()
                    if self.path.endswith("stop"):
                        threading.Thread(target=self.server.shutdown).start()
                    return
                if self.path != "/v1/responses":
                    self.send_error(403); return
                try:
                    count = int(self.headers.get("Content-Length", "0"))
                    if not 0 < count <= 32 * 1024 * 1024:
                        raise ValueError("Request size invalid")
                    payload, meta = prepare(self.rfile.read(count), {k.lower(): v for k, v in self.headers.items()})
                    key = keys[meta["model"]]
                    if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + key):
                        raise ValueError("Model authorization differs")
                    row = budget.admit(meta)
                except (ValueError, TypeError, AttributeError, KeyError) as error:
                    # Closed local reason only, never a prompt or credential.
                    print(json.dumps({"local_rejection": str(error) if isinstance(error, ValueError) and not isinstance(error, json.JSONDecodeError) else "metadata invalid"}), flush=True)
                    self.send_error(429, "FEAT-171 admission unavailable"); return
                connection = http.client.HTTPSConnection(MODELS[row["model"]][0], timeout=600)
                observer, digest, count, complete, client_connected = Observer(), hashlib.sha256(), 0, False, True
                error_bytes = bytearray()
                try:
                    connection.request("POST", "/v1/responses", body=payload,
                                       headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
                    response = connection.getresponse(); row["http_status"] = response.status
                    self.send_response(response.status)
                    self.send_header("Content-Type", response.getheader("Content-Type", "text/event-stream"))
                    self.send_header("Connection", "close"); self.end_headers(); self.close_connection = True
                    while True:
                        chunk = response.read1(65536)
                        if not chunk:
                            complete = True; break
                        observer.feed(chunk); digest.update(chunk); count += len(chunk)
                        if response.status >= 400:
                            error_bytes.extend(chunk[:max(0, 16385 - len(error_bytes))])
                        if client_connected:
                            try:
                                self.wfile.write(chunk); self.wfile.flush()
                            except OSError:
                                client_connected = False  # Drain actual usage, never refund a disconnect.
                except (OSError, http.client.HTTPException) as error:
                    observer.result["transport_error_class"] = type(error).__name__
                    self.close_connection = True
                finally:
                    connection.close()
                    if row.get("http_status", 0) >= 400:
                        observer.result.update(legacy.error_metadata(error_bytes))
                    observer.result.update(stream_complete=complete, response_sha256=digest.hexdigest(), response_bytes=count)
                    budget.settle(row, observer.result)
                    print(json.dumps({"ordinal": row["ordinal"], "status": row["status"], "charged_upper_micro_cny": budget.state["charged_upper_micro_cny"]}), flush=True)

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 18083), Handler)
        budget.state["meter_state"] = "running"; budget.save()
        print("FEAT-171 meter ready, initially disarmed; zero automatic model calls", flush=True)
        try:
            server.serve_forever()
        finally:
            server.server_close(); budget.state["meter_state"] = "stopped_normally"; budget.save()


if __name__ == "__main__":
    main()
