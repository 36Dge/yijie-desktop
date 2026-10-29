#!/usr/bin/env python3
"""FEAT-162 v2 acceptance policy, used by the existing client meter transport.

No credentials are read here. The supplied stop adapter uses only loopback Host.
Old ledgers remain in the legacy class.
All monetary values are integer micro-CNY. This is an observer, not an Agent.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import threading
from feat162_owner_stop import OwnerStop

spec = importlib.util.spec_from_file_location("feat162_legacy", Path(__file__).with_name("feat162-client-meter.py"))
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
require = legacy.require
digest = legacy.shared.canonical_digest
AUTHORITY = "FEAT-162-basic-pro-v2"
CASES = {"E1": (2, ["search"]), "E2": (2, ["pro"]), "E3": (2, ["fetch"]),
         "E4": (2, ["body"]), "E5": (4, ["search", "fetch"]),
         "E6": (2, ["pro"]), "E7": (3, ["pro", "fetch"])}
REST_RESERVE = 105_000
# The current supplier contract has no verified per-request native-search hard
# bound, and the new normal owner stop adapter lacks accurate-App qualification. A plan's
# booleans or hashes cannot qualify those missing capabilities. Keep v2 live
# traffic closed until a separately reviewed implementation proves both.
LIVE_EXECUTION_QUALIFIED = False


def fee_reserve(plan):
    """Arithmetic only; this never grants live qualification or paid authority."""
    for key in ["model_request_reserve_micro_cny", "native_calls_per_model_max", "max_output_tokens", "input_tokens_max", "total_limit_micro_cny"]:
        require(type(plan.get(key)) is int and plan[key] > 0, "Unproven hard fee bound")
    minimum = plan["input_tokens_max"] * 13 + plan["max_output_tokens"] * 68
    require(plan["model_request_reserve_micro_cny"] >= minimum, "Model fee bound too small")
    reserve = plan["model_request_reserve_micro_cny"] + 30_000 * plan["native_calls_per_model_max"]
    require(plan["total_limit_micro_cny"] >= reserve + REST_RESERVE, "Budget cannot reserve even the next request")
    return reserve


def request_output_bound_matches(plan, metadata):
    # The bound and the actual wire field are distinct: the normal Runtime may
    # omit the latter. Never inject a cap into the outbound request.
    expected = plan.get("request_max_output_tokens", plan.get("max_output_tokens"))
    if expected is None:
        evidence = plan.get("model_bound_evidence_sha256")
        require(plan.get("output_bound_source") == "provider_default"
                and isinstance(evidence, str) and legacy.re.fullmatch("[0-9a-f]{64}", evidence),
                "Missing reviewed supplier default bound evidence")
    else:
        require(type(expected) is int and expected == plan.get("max_output_tokens"), "Explicit output bound differs")
    require(metadata.get("max_output_tokens") == expected, "Product output field differs")


def tool_result(value):
    if isinstance(value, str):
        value = json.loads(legacy.re.sub(r"^Wall time: [0-9.]+ seconds\nOutput:\n", "", value))
    if isinstance(value, list):
        require(len(value) == 1 and value[0].get("type") == "text", "Unknown tool content")
        return tool_result(value[0]["text"])
    require(isinstance(value, dict) and not value.get("isError") and not value.get("error"), "Tool failed")
    if "content" in value:
        content = tool_result(value["content"])
        if "structuredContent" in value:
            require(content == tool_result(value["structuredContent"]), "Different tool representations")
        return content
    if "markdown" in value:
        require(isinstance(value["markdown"], str) and value["markdown"].strip(), "No fetched content")
        return {"kind": "fetch", "sha256": digest(value)}
    rows = value.get("results")
    require(isinstance(rows, list) and rows, "No search evidence")
    require(all(isinstance(r, dict) and isinstance(r.get("url"), str) and r["url"].startswith(("http://", "https://")) for r in rows), "No source")
    kind = "pro" if "chunks" in rows[0] else "body" if "text" in rows[0] else "search"
    if kind != "search":
        require(any(any(c.get("text", "").strip() for c in r.get("chunks", [])) if kind == "pro" else r.get("text", "").strip() for r in rows), "No body evidence")
    return {"kind": kind, "sha256": digest(value), "source_url_sha256": [digest(r["url"]) for r in rows]}


def prepare(payload):
    """Preserve every outbound byte, including tools/include/output cap."""
    body = json.loads(payload)
    require(isinstance(body, dict) and body.get("model") == legacy.shared.MODEL and body.get("stream") is True, "Unexpected model profile")
    require(not body.get("previous_response_id") and not body.get("conversation") and not body.get("background"), "Unbounded server context")
    names = []
    for tool in body.get("tools", []):
        names.append(tool.get("name", tool.get("type")))
        names.extend(t.get("name") for t in tool.get("tools", []))
    identity = body.get("client_metadata", {})
    require(isinstance(identity, dict), "Invalid Runtime metadata")
    nested = json.loads(identity.get("x-codex-turn-metadata", "{}"))
    require(isinstance(nested, dict), "Invalid Runtime turn metadata")
    for key in ["thread_id", "turn_id"]:
        require(key not in nested or key not in identity or nested[key] == identity[key], "Inconsistent Runtime identity")
    outputs = [{"call_ref": v.get("call_id"), **tool_result(v.get("output"))} for v in body.get("input", [])
               if isinstance(v, dict) and v.get("type") in {"function_call_output", "custom_tool_call_output"}]
    return payload, {"request_sha256": hashlib.sha256(payload).hexdigest(), "request_bytes": len(payload),
                     "request_adjustments": [], "declared_tools": names, "tool_results": outputs,
                     "model_config_sha256": digest({k: v for k, v in body.items() if k not in {"input", "client_metadata"}}),
                     "runtime_thread_id": identity.get("thread_id", nested.get("thread_id")),
                     "runtime_turn_id": identity.get("turn_id", nested.get("turn_id")),
                     "max_output_tokens": body.get("max_output_tokens"),
                     "native_search_declared": any(t.get("type") == "web_search" for t in body.get("tools", []))}


class Budget(legacy.Budget):
    def __init__(self, path, plan, offline=False):
        self.path, self.lock, self.offline = Path(path), threading.RLock(), offline
        self.plan = copy.deepcopy(plan)
        self.owner_stop = None
        self.enforces_owner_stop = True
        require(plan.get("feature") == "FEAT-162" and plan.get("schema_version") == 2, "Versioned new plan required")
        self.carried_count = self.carried_cost = 0
        self.state = json.loads(self.path.read_text()) if self.path.exists() else {
            "schema_version": 2, "feature": "FEAT-162", "authorization": AUTHORITY, "plan_sha256": digest(plan),
            "offline": offline, "model_http_limit": 17, "total_limit_micro_cny": plan.get("total_limit_micro_cny", 0),
            "tool_reserved_micro_cny": REST_RESERVE, "model_upper_micro_cny": 0,
            "requests": [], "tool_approvals": [], "armed": False, "armed_once": False, "halted": False,
            "meter_state": "created", "case": None, "finished_cases": []}
        require(self.state["schema_version"] == 2 and self.state["authorization"] == AUTHORITY
                and self.state["plan_sha256"] == digest(plan) and self.state["offline"] is offline, "Do not reuse legacy/changed ledgers")
        require(self.state["model_upper_micro_cny"] == sum(r.get("charged_upper_micro_cny", r["reserved_micro_cny"]) for r in self.state["requests"]), "Accounting mismatch")
        if self.state["meter_state"] != "created" or self.state["requests"]:
            self.halt("prior_run_cannot_resume")

    def halt(self, reason):
        # Persist admission closure BEFORE the normal owner API call. An unknown
        # stop result never reopens admission or releases already-sent reserves.
        with self.lock:
            super().halt(reason)
            if self.state.get("owner_stop", {}).get("status") in {"host_acknowledged", "unconfirmed"}:
                return
            self.state["owner_stop"] = {"status": "unconfirmed"}
            self.save()
            if self.owner_stop is not None and self.owner_stop.binding is not None:
                try:
                    self.state["owner_stop"] = self.owner_stop.stop()
                except (OSError, ValueError, TypeError, KeyError, legacy.http.client.HTTPException) as error:
                    self.state["owner_stop"] = {"status": "unconfirmed", "error_class": type(error).__name__}
            self.save()

    def live_ready(self, require_owner=True):
        require(LIVE_EXECUTION_QUALIFIED,
                "v2 live execution unqualified: native fee bound and owner stop evidence missing")
        p = self.plan
        require(not require_owner or self.owner_stop is not None, "No normal owner stop adapter")
        require(p.get("paid_authorized") is True and p.get("activation_qualified") is True, "No paid/entrypoint authority")
        for key in ["model_config_sha256", "artifact_receipt_sha256", "native_bound_evidence_sha256", "authorization_evidence_sha256"]:
            require(isinstance(p.get(key), str) and legacy.re.fullmatch("[0-9a-f]{64}", p[key]), "Missing frozen evidence")
        fee_reserve(p)

    def arm(self):
        if not self.offline:
            self.live_ready()
        super().arm()

    def begin_case(self, case_id):
        with self.lock:
            require(case_id in CASES and self.state["armed"] and not self.state["halted"], "No case allowance")
            require(self.state["case"] is None and case_id not in self.state["finished_cases"], "Prior case incomplete or already used")
            self.state["case"] = case_id
            self.save()

    def prepare_request(self, payload):
        return prepare(payload)

    def proposal(self, item):
        require(item.get("type") == "function_call", "Expected local function proposal")
        name = item.get("name", "").removeprefix("mcp__yijie_market__")
        require(item.get("namespace") == "mcp__yijie_market" or item.get("name", "").startswith("mcp__yijie_market__"), "Unexpected namespace")
        arguments = json.loads(item.get("arguments", ""))
        kind = {"kimi_web_search": "body" if arguments.get("include_content") is True else "search", "kimi_web_search_pro": "pro", "kimi_web_fetch": "fetch"}.get(name)
        with self.lock:
            case = self.state["case"]
            require(case in CASES and self.state["armed"] and not self.state["halted"], "No tool allowance")
            call_ref = item.get("call_id")
            require(isinstance(call_ref, str) and 0 < len(call_ref) <= 128, "Missing call identity")
            same = next((r for r in self.state["tool_approvals"] if r["call_ref"] == call_ref), None)
            if same:
                require(same["case"] == case and same["kind"] == kind and same["arguments_sha256"] == digest(arguments), "Changed proposal")
                return
            rows = [r for r in self.state["tool_approvals"] if r["case"] == case]
            sequence = CASES[case][1]
            require(len(rows) < len(sequence) and kind == sequence[len(rows)], "Wrong route or additional tool")
            if case == "E6":
                require("sites" not in arguments and "time_window" not in arguments, "Invented filters")
            if case in {"E2", "E7"} and kind == "pro":
                require(arguments.get("sites") and arguments.get("time_window"), "Missing explicit filters")
            self.state["tool_approvals"].append({"case": case, "kind": kind, "call_ref": call_ref,
                "arguments_sha256": digest(arguments), "status": "proposal_only_not_approval_or_http_evidence"})
            self.save()

    def tool_approval(self, *_args, **_kwargs):
        raise ValueError("v2 observes actual proposals; never seeds approvals")

    def admit(self, metadata):
        with self.lock:
            case = self.state["case"]
            require(self.state["armed"] and not self.state["halted"] and case in CASES, "No model allowance")
            rows = self.state["requests"]
            require(len(rows) < 17 and sum(r["case"] == case for r in rows) < CASES[case][0]
                    and not any(r["status"] == "inflight" for r in rows), "Request limit or concurrency")
            for result in metadata.get("tool_results", []):
                require(any(r["call_ref"] == result["call_ref"] and r["case"] == case and r["kind"] == result["kind"] for r in self.state["tool_approvals"]), "Unknown result provenance")
            reserve = 0
            if not self.offline:
                self.live_ready()
                require(metadata["model_config_sha256"] == self.plan["model_config_sha256"], "Product request differs")
                request_output_bound_matches(self.plan, metadata)
                reserve = fee_reserve(self.plan)
                require(self.state["model_upper_micro_cny"] + reserve + REST_RESERVE <= self.plan["total_limit_micro_cny"], "Insufficient budget")
            if not self.offline:
                session_id = self.plan.get("case_agent_sessions", {}).get(case)
                metadata["owner_binding_sha256"] = self.owner_stop.bind(session_id, metadata.get("runtime_thread_id"), metadata.get("runtime_turn_id"))
            row = {**metadata, "case": case, "ordinal": len(rows)+1, "status": "inflight", "reserved_micro_cny": reserve, "supplier_http_started": False}
            rows.append(row); self.state["model_upper_micro_cny"] += reserve; self.save()
            return row

    def settle(self, row, observation):
        with self.lock:
            row.update(observation)
            usage = observation.get("usage", {})
            known = isinstance(usage, dict) and all(type(usage.get(k)) is int and usage[k] >= 0 for k in ["input_tokens", "output_tokens"])
            known = known and observation.get("terminal_count") == 1 and observation.get("stream_complete") is True and observation.get("response_model") == legacy.shared.MODEL
            known = known and observation.get("cache_ttl", "5m") == "5m"
            # One output item is not a proven count of charged server executions.
            known = known and observation.get("native_search_calls", 0) == 0
            charge = 0
            if not self.offline and known:
                known = (usage["input_tokens"] <= self.plan["input_tokens_max"] and usage["output_tokens"] <= self.plan["max_output_tokens"]
                         and observation.get("native_search_calls", 0) <= self.plan["native_calls_per_model_max"])
                charge = usage["input_tokens"]*13 + usage["output_tokens"]*68 + observation.get("native_search_calls", 0)*30_000
            if known:
                row.update(status="settled", charged_upper_micro_cny=charge)
                self.state["model_upper_micro_cny"] += charge-row["reserved_micro_cny"]
            else:
                row["status"] = "unknown_reserved"
            if not known or not legacy.shared.successful_terminal(row) or observation.get("native_search_calls", 0):
                self.halt("failure_or_unknown_or_native_search")
            self.save()

    def finish_case(self):
        with self.lock:
            case = self.state["case"]
            require(case in CASES and not self.state["halted"], "No complete case")
            require([r["kind"] for r in self.state["tool_approvals"] if r["case"] == case] == CASES[case][1], "Incomplete tool sequence")
            rows = [r for r in self.state["requests"] if r["case"] == case]
            require(rows and all(r["status"] == "settled" for r in rows), "Incomplete model results")
            require(len(rows[-1].get("tool_results", [])) >= len(CASES[case][1]), "Missing final result feedback")
            self.state["finished_cases"].append(case); self.state["case"] = None
            # This only closes accounting; source quality and E5/E7 URL selection
            # still require the actual acceptance evidence, not this counter.
            self.save()
