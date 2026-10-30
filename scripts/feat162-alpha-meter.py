"""E1-E7 Alpha transport/soft stop only. Actual App observation decides acceptance.

No quality, source relationship, strict sequence or complete-usage gate. Original
request/response bytes and normal product tool approvals are retained.
"""
import argparse
import hashlib
import importlib.util
import json
import threading
from pathlib import Path

spec = importlib.util.spec_from_file_location("alpha_transport", Path(__file__).with_name("feat162-client-meter.py"))
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
require = legacy.require
AUTHORITY = "FEAT-162-seven-case-alpha-v1"
THRESHOLD = 20_000_000
ESTIMATE = 1_000_000
CASES = tuple("E" + str(i) for i in range(1, 8))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def prepare(payload):
    body = json.loads(payload)
    require(isinstance(body, dict) and body.get("model") == legacy.shared.MODEL
            and body.get("stream") is True, "Expected managed Kimi stream")
    names = []
    for tool in body.get("tools", []):
        names.append(tool.get("name", tool.get("type")))
        names.extend(t.get("name") for t in tool.get("tools", []))
    return payload, {"request_sha256": hashlib.sha256(payload).hexdigest(),
                     "request_bytes": len(payload), "request_adjustments": [],
                     "declared_tools": names}


class Budget(legacy.Budget):
    alpha_passive_observation = True
    requires_selected_kimi_tools = False  # Auxiliary/title calls are also metered.
    enforces_owner_stop = True

    def __init__(self, path, plan, offline=False):
        self.path, self.plan, self.offline = Path(path), plan, offline
        self.lock = threading.RLock()
        self.request_finished = threading.Condition(self.lock)
        require(not self.path.exists(), "New Alpha observation file required; history is immutable")
        require(plan.get("feature") == "FEAT-162" and plan.get("authority") == AUTHORITY
                and plan.get("soft_threshold_micro_cny") == THRESHOLD
                and plan.get("allow_inflight_overshoot") is True, "Explicit Alpha soft-stop policy required")
        self.carried_count = 0
        carried = 0
        if not offline:
            prior = Path(plan["prior_ledger"])
            require(sha(prior) == plan["prior_ledger_sha256"], "Closed predecessor changed")
            previous = json.loads(prior.read_text())
            require(previous.get("authorization") in {"FEAT-162-soft-budget-v3", AUTHORITY}
                    and previous.get("halted") is True and not previous.get("armed")
                    and previous.get("meter_state") == "stopped_normally"
                    and not any(r["status"] == "inflight" for r in previous["requests"]), "Closed predecessor required")
            self.carried_count = previous.get("carried_count", 0) + len(previous["requests"])
            carried = previous.get("carried_cost_micro_cny", 0) + previous["model_upper_micro_cny"]
            if previous.get("authorization") == AUTHORITY:
                carried += previous["tool_reserved_micro_cny"]
        self.state = {"schema_version": 4, "feature": "FEAT-162", "authorization": AUTHORITY,
                      "offline": offline, "plan_sha256": legacy.shared.canonical_digest(plan),
                      "carried_count": self.carried_count, "carried_cost_micro_cny": carried,
                      "model_upper_micro_cny": 0, "tool_reserved_micro_cny": 105_000,
                      "accounting_kind": "automatic_observation_or_estimate_not_billing_or_acceptance",
                      "requests": [], "tool_approvals": [], "case": None, "closed_cases": [],
                      "armed": False, "armed_once": False, "halted": False, "meter_state": "created"}

    def live_ready(self):
        require(self.plan.get("paid_authorized") is True, "Paid Alpha authorization required")
        for field in ("artifact_receipt", "authorization_evidence"):
            path = Path(self.plan[field + "_file"])
            require(path.is_absolute() and path.is_file() and sha(path) == self.plan[field + "_sha256"],
                    "Current source/authorization evidence differs")

    def arm(self):
        if not self.offline:
            self.live_ready()
        super().arm()

    def begin_case(self, case_id):
        with self.lock:
            require(case_id in CASES and self.state["case"] is None
                    and self.state["armed"] and not self.state["halted"], "Case unavailable")
            self.state["case"] = case_id
            self.save()

    def finish_case(self):
        with self.lock:
            require(self.state["case"] in CASES and not any(r["status"] == "inflight" for r in self.state["requests"]),
                    "Wait for current request")
            # Closing an observation group is deliberately not an acceptance verdict.
            self.state["closed_cases"].append(self.state["case"])
            self.state["case"] = None
            self.save()

    def prepare_request(self, payload):
        return prepare(payload)

    def tool_approval(self, *_args, **_kwargs):
        raise ValueError("Only normal Native UI can approve tools")

    def observed_total(self):
        return self.state["carried_cost_micro_cny"] + self.state["model_upper_micro_cny"] + self.state["tool_reserved_micro_cny"]

    def halt(self, reason):
        with self.request_finished:
            super().halt(reason)
            self.request_finished.notify_all()

    def admit(self, metadata):
        with self.request_finished:
            # Runtime can start its next request immediately after receiving the
            # terminal SSE event, before the prior HTTP connection reaches EOF.
            # Queue locally until that request settles; never reject a normal
            # follow-up as a second supplier request or forward it concurrently.
            ready = self.request_finished.wait_for(
                lambda: self.state["halted"] or not self.state["armed"]
                or not any(r["status"] == "inflight" for r in self.state["requests"]),
                timeout=240,
            )
            require(ready, "Previous transport did not finish")
            require(self.state["armed"] and not self.state["halted"]
                    and not any(r["status"] == "inflight" for r in self.state["requests"]), "No model allowance")
            if not self.offline:
                self.live_ready()
                if self.observed_total() >= THRESHOLD:
                    self.halt("soft_budget_reached")
                    raise ValueError("Soft threshold reached; no next request")
            reserve = 0 if self.offline else ESTIMATE
            row = {**metadata, "case": self.state["case"] or "auxiliary", "ordinal": len(self.state["requests"]) + 1,
                   "status": "inflight", "reserved_micro_cny": reserve, "supplier_http_started": False}
            self.state["requests"].append(row)
            self.state["model_upper_micro_cny"] += reserve
            self.save()
            return row

    def settle(self, row, observation):
        with self.lock:
            row.update(observation)
            usage = observation.get("usage", {})
            known = isinstance(usage, dict) and all(type(usage.get(k)) is int and usage[k] >= 0
                                                   for k in ("input_tokens", "output_tokens"))
            if known:
                charge = 0 if self.offline else usage["input_tokens"] * 13 + usage["output_tokens"] * 68
                row.update(status="settled", charged_upper_micro_cny=charge)
                self.state["model_upper_micro_cny"] += charge - row["reserved_micro_cny"]
            else:
                row["status"] = "unknown_estimate"
            # Missing usage, content or native-search observations are not Alpha
            # failure gates. They cannot make this observer grant a product tool.
            if not self.offline and self.observed_total() >= THRESHOLD:
                self.halt("soft_budget_reached_after_request")
            self.save()
            self.request_finished.notify_all()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("ledger", "plan", "kimi-key-file", "control-token-file"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    require(args.ledger.is_absolute() and args.ledger.parent.resolve(strict=True) == args.ledger.parent,
            "Canonical private run directory required")
    with args.ledger.with_suffix(".lock").open("a") as lock:
        legacy.fcntl.flock(lock, legacy.fcntl.LOCK_EX | legacy.fcntl.LOCK_NB)
        budget = Budget(args.ledger, json.loads(args.plan.read_text()), args.offline)
        if not args.offline:
            budget.live_ready()
        key = legacy.shared.credential(args.kimi_key_file)
        control = legacy.shared.credential(args.control_token_file)
        server = legacy.server_for(budget, key, control)
        budget.state["meter_state"] = "running"
        budget.save()
        print("FEAT-162 seven-case Alpha observer ready; unarmed; no requests sent", flush=True)
        try:
            server.serve_forever()
        finally:
            server.server_close()
            budget.state["meter_state"] = "stopped_normally"
            budget.save()


if __name__ == "__main__":
    legacy.os.umask(0o077)
    main()
