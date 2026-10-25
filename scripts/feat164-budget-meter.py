#!/usr/bin/env python3
"""Opt-in FEAT-164 G2V budget adapter, never a product provider or fake model.

Only api.moonshot.cn receives real requests. Output is capped to 8192 and native
search is omitted until its Responses billing bound is established. Both
adjustments are explicit in the ledger; this cannot qualify raw/default tool
behavior. SSE bytes are forwarded unchanged. No prompt, answer or key is logged.
"""
import argparse
import copy
import datetime
import fcntl
import hashlib
import hmac
import http.client
import http.server
import json
import os
from pathlib import Path
import stat
import threading

MODEL = "kimi-k3.1-pro"
MAX_OUTPUT = 8192
CONTEXT = 1048576
# Micro-CNY: worst-case default-5m input/write is 13 CNY/MTok, output 68.
# Cached tokens are charged as full-price input for a conservative upper bound.
RESERVATION = CONTEXT * 13 + MAX_OUTPUT * 68
LIMIT = 20_000_000
RESUME_LIMIT = 30_000_000
RESUME_ID = "FEAT-164-20261025-30CNY-ONE-HTTP"


def canonical_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def row_charge(row):
    # Old reservations must not change when a later policy uses another bound.
    amount = row.get("charged_upper_micro_cny", row.get("reserved_micro_cny", RESERVATION))
    if type(amount) is not int or amount < 0:
        raise ValueError("Invalid historical charge or reservation")
    return amount


def validate_resume_authorization(value):
    expected = {"schema_version", "feature", "authorization_id", "approved_by", "approved_on",
                "approval_source", "previous_ledger_sha256", "limit_micro_cny",
                "additional_http_requests", "preserve_unknown_reservations", "failure_policy", "scope"}
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("Closed resume authorization required")
    digest = value["previous_ledger_sha256"]
    if (type(value["schema_version"]) is not int or value["schema_version"] != 1 or value["feature"] != "FEAT-164"
            or value["authorization_id"] != RESUME_ID
            or value["approved_on"] != "2026-10-25"
            or value["approval_source"] != "current-user-confirmation-2026-10-25"
            or not isinstance(value["approved_by"], str) or not value["approved_by"].strip() or len(value["approved_by"]) > 128
            or not isinstance(digest, str) or len(digest) != 64
            or any(c not in "0123456789abcdef" for c in digest)
            or type(value["limit_micro_cny"]) is not int or value["limit_micro_cny"] != RESUME_LIMIT
            or type(value["additional_http_requests"]) is not int or value["additional_http_requests"] != 1
            or value["preserve_unknown_reservations"] is not True
            or value["failure_policy"] != "stop" or value["scope"] != "one_budgeted_text_g2v"):
        raise ValueError("Resume authorization differs from the approved one-request scope")


def credential(path):
    info = path.lstat()
    if (not path.is_absolute() or not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid() or info.st_nlink != 1
            or info.st_mode & 0o077 or not 0 < info.st_size <= 16384):
        raise ValueError("Owner-only regular credential source required")
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW)) as source:
        current = os.fstat(source.fileno())
        if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
            raise ValueError("Credential source changed")
        value = source.read(16385).strip()
    if not value or len(value) > 16384 or any(c in value for c in "\r\n\0"):
        raise ValueError("Credential source invalid")
    return value


def prepare_request(payload):
    body = json.loads(payload)
    if (not isinstance(body, dict) or body.get("model") != MODEL
            or body.get("reasoning", {}).get("effort") != "max"
            or body.get("stream") is not True
            or body.get("prompt_cache_options", {}).get("ttl", "5m") != "5m"):
        raise ValueError("Candidate profile differs")
    # No server-stored context or background work may outlive this budget run.
    if body.get("previous_response_id") or body.get("conversation") or body.get("background"):
        raise ValueError("Unbounded server context is not qualified")
    original_cap = body.get("max_output_tokens")
    if original_cap is not None and (type(original_cap) is not int or original_cap <= 0):
        raise ValueError("Invalid output limit")
    body["max_output_tokens"] = min(original_cap or MAX_OUTPUT, MAX_OUTPUT)
    tools = body.get("tools", [])
    if not isinstance(tools, list) or any(not isinstance(t, dict) for t in tools):
        raise ValueError("Invalid tool declarations")
    omitted = sum(t.get("type") == "web_search" for t in tools)
    body["tools"] = [t for t in tools if t.get("type") != "web_search"]
    include = body.get("include", [])
    search_includes = {"web_search_call.action.sources", "web_search_call.results"}
    if not isinstance(include, list) or any(not isinstance(v, str) or v not in search_includes for v in include):
        raise ValueError("Kimi Responses include differs from documented enum")
    # The budget adapter removes native search, so its dependent include values
    # must also be omitted. Unsupported product values are rejected, not hidden.
    if include:
        body["include"] = []
    def images(value):
        if isinstance(value, dict):
            return int(value.get("type") == "input_image") + sum(images(v) for v in value.values())
        return sum(images(v) for v in value) if isinstance(value, list) else 0
    count = images(body.get("input"))
    if count > 1:
        raise ValueError("At most one ordinary image in this minimal run")
    return json.dumps(body).encode(), {
        "model": MODEL, "effort": "max", "original_max_output_tokens": original_cap,
        "max_output_tokens": body["max_output_tokens"], "image_count": count,
        "tool_choice_preserved": body.get("tool_choice"), "native_search_omitted": omitted,
        "native_search_include_omitted": include,
        "request_adjustments": ["bounded_max_output_tokens", "omit_unpriced_native_search", "omit_search_include", "json_encoding"],
    }


class Budget:
    def __init__(self, ledger):
        self.path = ledger
        self.state = json.loads(ledger.read_text()) if ledger.exists() else {
            "feature": "FEAT-164", "limit_micro_cny": LIMIT, "max_http_requests": 8,
            "scope": "budgeted_text_image_g2v_not_raw_request_or_search_qualification",
            "charged_upper_micro_cny": 0, "requests": [], "halted": False,
        }
        version = self.state.get("schema_version", 1)
        if self.state.get("feature") != "FEAT-164" or version not in (1, 2):
            raise ValueError("Independent approved FEAT-164 ledger required")
        rows = self.state["requests"]
        if not isinstance(rows, list) or any(r.get("ordinal") != i + 1 or r.get("status") not in
                {"inflight", "unknown_reserved", "settled"} for i, r in enumerate(rows)):
            raise ValueError("Invalid request ledger")
        self.acknowledged_unknown = set()
        if version == 1:
            if self.state["limit_micro_cny"] != LIMIT or self.state["max_http_requests"] != 8:
                raise ValueError("Legacy budget limits differ")
        else:
            receipt = self.state.get("resume_receipt", {})
            authorization = receipt.get("authorization")
            validate_resume_authorization(authorization)
            if (receipt.get("authorization_sha256") != canonical_digest(authorization)
                    or receipt.get("base_request_count") != 1
                    or len(rows) < 1 or len(rows) > 2
                    or receipt.get("base_requests_sha256") != canonical_digest(rows[:1])
                    or receipt.get("acknowledged_unknown_ordinals") != [1]
                    or rows[0]["status"] != "unknown_reserved"
                    or row_charge(rows[0]) != RESERVATION
                    or self.state["limit_micro_cny"] != RESUME_LIMIT
                    or self.state["max_http_requests"] != 2):
                raise ValueError("Resume receipt or preserved history differs")
            self.acknowledged_unknown = {1}
        expected = sum(row_charge(r) for r in rows)
        if expected != self.state["charged_upper_micro_cny"] or not 0 <= expected <= self.state["limit_micro_cny"]:
            raise ValueError("Ledger cost accounting differs")
        # The explicit receipt acknowledges only the original unknown row, never
        # a newly interrupted/unknown request. Restart cannot mint another slot.
        if any(r["status"] == "inflight" or (r["status"] == "unknown_reserved" and
               r["ordinal"] not in self.acknowledged_unknown) for r in rows) or len(rows) >= self.state["max_http_requests"]:
            self.state["halted"] = True
        self.lock = threading.Lock()
        self.closed = False

    def save(self):
        temporary = self.path.with_suffix(".pending.json")
        with open(temporary, "w", encoding="utf8") as target:
            json.dump(self.state, target, indent=2); target.write("\n")
            target.flush(); os.fsync(target.fileno())
        os.replace(temporary, self.path)
        directory = os.open(self.path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    def stop_resume_on_rejection(self):
        with self.lock:
            if self.acknowledged_unknown:
                self.state["halted"] = True
                self.state["stop_reason"] = "authenticated_request_rejected"
                self.save()

    def admit(self, metadata):
        with self.lock:
            if (self.closed or self.state["halted"] or any(r["status"] == "inflight" for r in self.state["requests"])
                    or len(self.state["requests"]) >= self.state["max_http_requests"]
                    or self.state["charged_upper_micro_cny"] + RESERVATION > self.state["limit_micro_cny"]):
                raise ValueError("Verification budget unavailable")
            if self.acknowledged_unknown and metadata["image_count"] != 0:
                raise ValueError("The one-request resume is text-only")
            if metadata["image_count"] and sum(r["image_count"] for r in self.state["requests"]) >= 1:
                raise ValueError("Image budget unavailable")
            row = {**metadata, "ordinal": len(self.state["requests"]) + 1,
                   "status": "inflight", "reserved_micro_cny": RESERVATION}
            self.state["charged_upper_micro_cny"] += RESERVATION
            self.state["requests"].append(row); self.save()
            return row

    def settle(self, row, observation):
        with self.lock:
            usage = observation.get("usage")
            valid = (isinstance(usage, dict) and all(type(usage.get(k)) is int and usage[k] >= 0
                     for k in ["input_tokens", "output_tokens"])
                     and usage["input_tokens"] <= CONTEXT and usage["output_tokens"] <= MAX_OUTPUT
                     and observation.get("terminal") in ["response.completed", "response.incomplete", "response.failed"]
                     and observation.get("response_model") == MODEL
                     and observation.get("terminal_count") == 1
                     and observation.get("stream_complete") is True
                     and observation.get("native_search_calls", 0) == 0
                     and observation.get("cache_ttl", "5m") == "5m")
            row.update(observation)
            if valid:
                cost = usage["input_tokens"] * 13 + usage["output_tokens"] * 68
                self.state["charged_upper_micro_cny"] += cost - RESERVATION
                row["charged_upper_micro_cny"] = cost; row["status"] = "settled"
            else:
                row["status"] = "unknown_reserved"
                self.state["halted"] = True
            if self.acknowledged_unknown:
                # Success also exhausts the one additional request. Failed or
                # incomplete responses may settle cost, but never reopen quota.
                self.state["halted"] = True
                self.state["stop_reason"] = "single_resume_request_consumed"
            self.save()


def resume_ledger(ledger, authorization):
    """Explicit, idempotent administrative action; never performs HTTP."""
    validate_resume_authorization(authorization)
    with open(ledger.with_suffix(".lock"), "a") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        raw = ledger.read_bytes()
        budget = Budget(ledger)
        if budget.state.get("schema_version") == 2:
            if budget.state["resume_receipt"]["authorization"] != authorization:
                raise ValueError("A different resume decision cannot reuse this ledger")
            return {"authorization_id": RESUME_ID, "already_applied": True,
                    "remaining_http_requests": max(0, 2 - len(budget.state["requests"]))}
        if (hashlib.sha256(raw).hexdigest() != authorization["previous_ledger_sha256"]
                or budget.state.get("meter_state") != "stopped_normally"
                or not budget.state["halted"] or len(budget.state["requests"]) != 1
                or budget.state["requests"][0]["status"] != "unknown_reserved"
                or budget.state["requests"][0].get("http_status") != 400
                or row_charge(budget.state["requests"][0]) != RESERVATION):
            raise ValueError("The stopped original ledger does not match this resume decision")
        preserved = copy.deepcopy(budget.state["requests"])
        budget.state.update({"schema_version": 2, "limit_micro_cny": RESUME_LIMIT,
            "max_http_requests": 2, "halted": False, "resume_receipt": {
                "authorization": copy.deepcopy(authorization),
                "authorization_sha256": canonical_digest(authorization),
                "base_request_count": 1, "base_requests_sha256": canonical_digest(preserved),
                "acknowledged_unknown_ordinals": [1],
                "recorded_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}})
        if budget.state["requests"] != preserved or budget.state["charged_upper_micro_cny"] + RESERVATION > RESUME_LIMIT:
            raise ValueError("Preserved budget exceeds the approved resume limit")
        budget.save()
        return {"authorization_id": RESUME_ID, "already_applied": False, "remaining_http_requests": 1}


class Observer:
    def __init__(self):
        self.buffer = b""; self.result = {}; self.invalid = False; self.terminals = 0

    def feed(self, data):
        if self.invalid:
            return
        self.buffer += data
        if len(self.buffer) > 2 * 1024 * 1024:
            self.invalid = True; self.buffer = b""; self.result = {}; return
        while b"\n" in self.buffer:
            line, self.buffer = self.buffer.split(b"\n", 1)
            if not line.startswith(b"data:"):
                continue
            try:
                event = json.loads(line[5:].strip())
                if event.get("type") in ["response.completed", "response.incomplete", "response.failed"]:
                    self.terminals += 1
                    response = event.get("response", {})
                    usage = response.get("usage")
                    if isinstance(usage, dict):
                        self.result["usage"] = {k: usage[k] for k in ["input_tokens", "output_tokens"] if k in usage}
                    self.result.update({"terminal": event["type"], "response_model": response.get("model"),
                        "terminal_count": self.terminals, "response_status": response.get("status"),
                        "output_text_present": any(item.get("type") == "message" and any(
                            content.get("type") == "output_text" and isinstance(content.get("text"), str)
                            and bool(content["text"].strip()) for content in item.get("content", [])
                            if isinstance(content, dict)) for item in response.get("output", []) if isinstance(item, dict)),
                        "cache_ttl": response.get("prompt_cache_options", {}).get("ttl", "5m"),
                        "native_search_calls": sum(i.get("type") == "web_search_call" for i in response.get("output", []))})
            except (ValueError, AttributeError, TypeError):
                continue


def error_metadata(payload):
    """Closed diagnostic hints only; never persist provider error prose."""
    result = {"provider_error_category": "unclassified", "provider_error_mentions": []}
    if len(payload) > 16384:
        return result
    try:
        error = json.loads(payload).get("error")
        if not isinstance(error, dict):
            return result
        category = error.get("type")
        if category in {"invalid_request_error", "content_filter", "invalid_authentication_error",
                        "incorrect_api_key_error", "permission_denied_error", "resource_not_found_error",
                        "exceeded_current_quota_error", "rate_limit_reached_error", "engine_overloaded_error",
                        "server_error", "server_unavailable"}:
            result["provider_error_category"] = category
        message = error.get("message")
        if isinstance(message, str):
            result["provider_error_mentions"] = [field for field in (
                "reasoning.encrypted_content", "web_search_call.action.sources", "web_search_call.results",
                "max_output_tokens", "client_metadata", "tool_choice", "parallel_tool_calls",
                "reasoning.effort", "namespace", "prompt_cache_key") if field in message]
    except (ValueError, AttributeError, TypeError):
        pass
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ledger", required=True, type=Path)
    parser.add_argument("--kimi-key-file", type=Path)
    parser.add_argument("--control-token-file", type=Path)
    parser.add_argument("--apply-resume-authorization", type=Path)
    args = parser.parse_args()
    if args.apply_resume_authorization:
        if args.kimi_key_file or args.control_token_file:
            parser.error("Resume is an offline action; do not pass credentials")
        print(json.dumps(resume_ledger(args.ledger, json.loads(args.apply_resume_authorization.read_text()))))
        return
    if not args.kimi_key_file or not args.control_token_file:
        parser.error("Meter startup requires both credential file arguments")
    # Two meters cannot spend against this ledger at once.
    with open(args.ledger.with_suffix(".lock"), "a") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        budget = Budget(args.ledger); key = credential(args.kimi_key_file)
        control = credential(args.control_token_file)
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                if self.path != "/health":
                    self.send_error(404); return
                value = json.dumps({"feature": "FEAT-164", "requests": len(budget.state["requests"]),
                    "charged_upper_micro_cny": budget.state["charged_upper_micro_cny"],
                    "halted": budget.state["halted"]}).encode()
                self.send_response(200); self.send_header("Content-Length", str(len(value)))
                self.end_headers(); self.wfile.write(value)

            def do_POST(self):
                if self.path == "/control/stop":
                    if not hmac.compare_digest(self.headers.get("X-FEAT164-Control", ""), control):
                        self.send_error(403); return
                    with budget.lock:
                        if any(r["status"] == "inflight" for r in budget.state["requests"]):
                            self.send_error(409); return
                        budget.closed = True; budget.save()
                    self.send_response(204); self.end_headers()
                    threading.Thread(target=self.server.shutdown).start(); return
                if self.path != "/v1/responses" or not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + key):
                    self.send_error(403); return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 4 * 1024 * 1024:
                        raise ValueError("Request size")
                    payload, metadata = prepare_request(self.rfile.read(length))
                    row = budget.admit(metadata)
                except (ValueError, TypeError, AttributeError):
                    budget.stop_resume_on_rejection()
                    self.send_error(429, "Verification admission unavailable"); return
                connection = http.client.HTTPSConnection("api.moonshot.cn", timeout=240)
                observer = Observer(); digest = hashlib.sha256(); count = 0; error_bytes = bytearray(); complete = False
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
                            complete = True
                            break
                        if response.status >= 400:
                            error_bytes.extend(chunk[:max(0, 16385 - len(error_bytes))])
                        observer.feed(chunk)
                        self.wfile.write(chunk); self.wfile.flush()
                        digest.update(chunk); count += len(chunk)
                except (OSError, http.client.HTTPException) as error:
                    observer.result = {"transport_error_class": type(error).__name__}
                    self.close_connection = True
                finally:
                    connection.close()
                    if row.get("http_status", 0) >= 400:
                        observer.result.update(error_metadata(error_bytes))
                    observer.result.update({"forwarded_response_sha256": digest.hexdigest(), "forwarded_response_bytes": count})
                    observer.result["stream_complete"] = complete
                    budget.settle(row, observer.result)
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 18083), Handler)
        budget.state["meter_state"] = "running"; budget.save()
        print("FEAT-164 meter ready; bounded output, native search omitted, no automatic requests", flush=True)
        try:
            server.serve_forever()
        finally:
            server.server_close(); budget.state["meter_state"] = "stopped_normally"; budget.save()


if __name__ == "__main__":
    main()
