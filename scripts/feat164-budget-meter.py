#!/usr/bin/env python3
"""Opt-in FEAT-164 G2V budget adapter, never a product provider or fake model.

Only api.moonshot.cn receives real requests. Output is capped to 8192 and native
search is omitted for legacy text qualification. Explicit schema5 preserves search
and images, retains the full reserve for unreconciled search fees, and stops.
Schema6 allows at most two source-specific attempts within 45 CNY, stops after
each, and requires an explicit settled-result review before a second request.
Only native search tools are offered in schema6; old ledgers/reserves stay exact.
Schema7 is one further reviewed request with original product tools and content-free item-type diagnostics.
All adjustments are explicit in the ledger; this cannot qualify raw/default tool
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
SUCCESSOR_ID = "FEAT-164-20261026-30CNY-THREE-HTTP"
SUCCESSOR_NAME = "g2v-real-budget-ledger-r3.json"
FUNCTIONAL_NAME = "g2v-real-budget-ledger-functional.json"
FUNCTIONAL_ID = "FEAT-164-R5-FUNCTIONAL-FOUR-HTTP"
SEARCH_NAME = "g2v-real-budget-ledger-search.json"
SEARCH_ID = "FEAT-164-S4AB-45CNY-TWO-HTTP"
THIRD_NAME = "g2v-real-budget-ledger-search-third.json"
THIRD_ID = "FEAT-164-S4AB-THIRD-ORIGINAL-TOOLS"
SEARCH_LIMIT = 45_000_000
SEARCH_APP = "179dbd187220694d4666af5822466572f3b245a911501991cb0194f4308db195"
R5_ID = "FEAT-164-R5-30CNY-ONE-HTTP"
R5_NAME = "g2v-real-budget-ledger-r5.json"
R5_BINARY_SHA256 = "283d12e16b124942302fcdc8281c729a8a7f676498f06df1d2646292905f579e"
R5_APP_SHA256 = "42a23cfbc11cc047b005b8d80dafa2aff243fcc469dd1510d04d88196e85f6a9"


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


def validate_successor_authorization(value):
    expected = {"schema_version", "feature", "authorization_id", "approved_by", "approved_on",
                "approval_source", "previous_ledger_sha256", "limit_micro_cny",
                "additional_http_requests", "preserve_unknown_reservations", "failure_policy", "scope",
                "successor_ledger_name"}
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("Closed successor authorization required")
    digest = value["previous_ledger_sha256"]
    if (type(value["schema_version"]) is not int or value["schema_version"] != 1
            or value["feature"] != "FEAT-164" or value["authorization_id"] != SUCCESSOR_ID
            or value["approved_on"] != "2026-10-26"
            or value["approval_source"] != "current-user-confirmation-2026-10-26-plus-two"
            or not isinstance(value["approved_by"], str) or not value["approved_by"].strip()
            or len(value["approved_by"]) > 128 or not isinstance(digest, str) or len(digest) != 64
            or any(c not in "0123456789abcdef" for c in digest)
            or type(value["limit_micro_cny"]) is not int or value["limit_micro_cny"] != RESUME_LIMIT
            or type(value["additional_http_requests"]) is not int or value["additional_http_requests"] != 3
            or value["preserve_unknown_reservations"] is not True or value["failure_policy"] != "stop"
            or value["scope"] != "bounded_text_g2v_successor" or value["successor_ledger_name"] != SUCCESSOR_NAME):
        raise ValueError("Successor authorization differs from the approved three-request scope")


def validate_r5_authorization(value):
    expected = {"schema_version", "feature", "authorization_id", "approved_by", "approved_on",
                "approval_source", "previous_ledger_sha256", "limit_micro_cny",
                "additional_http_requests", "preserve_unknown_reservations", "failure_policy", "scope",
                "successor_ledger_name", "runtime_sha256", "app_sha256", "budget_basis_sha256"}
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("Closed r5 authorization required")
    digests = [value.get("previous_ledger_sha256"), value.get("budget_basis_sha256")]
    if (value["schema_version"] != 1 or type(value["schema_version"]) is not int
            or value["feature"] != "FEAT-164" or value["authorization_id"] != R5_ID
            or value["approval_source"] != "explicit-user-r5-one-http"
            or not isinstance(value["approved_by"], str) or not value["approved_by"].strip()
            or len(value["approved_by"]) > 128 or not isinstance(value["approved_on"], str)
            or len(value["approved_on"]) != 10
            or value["limit_micro_cny"] != RESUME_LIMIT or type(value["limit_micro_cny"]) is not int
            or value["additional_http_requests"] != 1 or type(value["additional_http_requests"]) is not int
            or value["preserve_unknown_reservations"] is not True or value["failure_policy"] != "stop"
            or value["scope"] != "r5_single_text_qualification" or value["successor_ledger_name"] != R5_NAME
            or value["runtime_sha256"] != R5_BINARY_SHA256 or value["app_sha256"] != R5_APP_SHA256
            or any(not isinstance(d, str) or len(d) != 64 or any(c not in "0123456789abcdef" for c in d) for d in digests)):
        raise ValueError("r5 authorization differs from the single-text scope")
    datetime.date.fromisoformat(value["approved_on"])


def validate_r5_budget_basis(value):
    # The Owner explicitly prioritized functional validation over a fresh exact
    # price lookup. Keep the old accounting estimate, never call it a bill.
    expected = {"model", "basis", "exact_pricing_required", "owner_instruction",
                "input_estimate_micro_cny_per_token", "output_estimate_micro_cny_per_token", "ttl"}
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("Explicit r5 estimate basis required")
    if (value["model"] != MODEL or value["basis"] != "retained_historical_estimate"
            or value["exact_pricing_required"] is not False
            or value["owner_instruction"] != "2026-10-26-functional-validation-no-exact-pricing"
            or type(value["input_estimate_micro_cny_per_token"]) is not int
            or value["input_estimate_micro_cny_per_token"] != 13
            or type(value["output_estimate_micro_cny_per_token"]) is not int
            or value["output_estimate_micro_cny_per_token"] != 68 or value["ttl"] != "5m"):
        raise ValueError("r5 historical estimate or Owner instruction differs")


def validate_functional_authorization(value):
    expected = {"schema_version", "feature", "authorization_id", "approval_source", "approved_by", "approved_on",
                "previous_ledger_sha256", "app_sha256", "runtime_sha256", "additional_http_requests",
                "limit_micro_cny", "scope", "successor_ledger_name", "preserve_unknown_reservations", "failure_policy"}
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("Closed functional authorization required")
    if (type(value["schema_version"]) is not int or value["schema_version"] != 1
            or value["feature"] != "FEAT-164" or value["authorization_id"] != FUNCTIONAL_ID
            or value["approval_source"] != "owner-necessary-functional-calls-search-images"
            or not isinstance(value["approved_by"], str) or not value["approved_by"].strip()
            or type(value["additional_http_requests"]) is not int or value["additional_http_requests"] != 4
            or type(value["limit_micro_cny"]) is not int or value["limit_micro_cny"] != RESUME_LIMIT
            or value["scope"] != "image_function_roundtrip_then_search"
            or value["successor_ledger_name"] != FUNCTIONAL_NAME
            or value["runtime_sha256"] != R5_BINARY_SHA256
            or value["preserve_unknown_reservations"] is not True or value["failure_policy"] != "stop"):
        raise ValueError("Functional scope differs from the bounded execution plan")
    for name in ["previous_ledger_sha256", "app_sha256"]:
        digest = value[name]
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("Functional provenance digest required")
    datetime.date.fromisoformat(value["approved_on"])


def validate_search_authorization(value):
    expected = {"schema_version", "feature", "authorization_id", "approval_source", "approved_by", "approved_on",
                "previous_ledger_sha256", "app_sha256", "runtime_sha256", "additional_http_requests",
                "limit_micro_cny", "scope", "successor_ledger_name", "preserve_unknown_reservations", "failure_policy"}
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("Closed search revalidation authorization required")
    fixed = {"schema_version": 1, "feature": "FEAT-164", "authorization_id": SEARCH_ID,
             "approval_source": "owner-20261027-cap45-then-two-attempts", "approved_on": "2026-10-27",
             "app_sha256": SEARCH_APP, "runtime_sha256": R5_BINARY_SHA256, "additional_http_requests": 2,
             "limit_micro_cny": SEARCH_LIMIT, "scope": "source_specific_native_search_one_at_a_time",
             "successor_ledger_name": SEARCH_NAME, "preserve_unknown_reservations": True,
             "failure_policy": "stop_and_review_before_second"}
    digest = value["previous_ledger_sha256"]
    if (any(type(value[k]) is not type(v) or value[k] != v for k, v in fixed.items())
            or not isinstance(value["approved_by"], str) or not value["approved_by"].strip()
            or not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest)):
        raise ValueError("Search revalidation differs from Owner's bounded scope")


def validate_third_authorization(value):
    if not isinstance(value, dict):
        raise ValueError("Third attempt authorization required")
    changes = {"authorization_id": THIRD_ID, "approval_source": "owner-20261027-third-attempt",
               "additional_http_requests": 1, "scope": "third_search_original_product_tools",
               "successor_ledger_name": THIRD_NAME, "failure_policy": "stop"}
    if any(type(value.get(k)) is not type(v) or value.get(k) != v for k, v in changes.items()):
        raise ValueError("Third attempt scope differs")
    base = {**value, "authorization_id": SEARCH_ID, "approval_source": "owner-20261027-cap45-then-two-attempts",
            "additional_http_requests": 2, "scope": "source_specific_native_search_one_at_a_time",
            "successor_ledger_name": SEARCH_NAME, "failure_policy": "stop_and_review_before_second"}
    validate_search_authorization(base)


def successful_terminal(row):
    return (row.get("http_status") == 200 and row.get("terminal") == "response.completed"
            and row.get("response_status") == "completed" and row.get("terminal_count") == 1
            and row.get("stream_complete") is True and row.get("response_model") == MODEL)


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


def prepare_request(payload, *, functional=False, search_only=False):
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
    if search_only and not functional:
        raise ValueError("Search-only qualification requires functional preservation")
    omitted = 0 if functional else sum(t.get("type") == "web_search" for t in tools)
    if not functional:
        body["tools"] = [t for t in tools if t.get("type") != "web_search"]
    include = body.get("include", [])
    search_includes = {"web_search_call.action.sources", "web_search_call.results"}
    if not isinstance(include, list) or any(not isinstance(v, str) or v not in search_includes for v in include):
        raise ValueError("Kimi Responses include differs from documented enum")
    # The budget adapter removes native search, so its dependent include values
    # must also be omitted. Unsupported product values are rejected, not hidden.
    if include and not functional:
        body["include"] = []
    def images(value):
        if isinstance(value, dict):
            return int(value.get("type") == "input_image") + sum(images(v) for v in value.values())
        return sum(images(v) for v in value) if isinstance(value, list) else 0
    if search_only:
        body["tools"] = [t for t in tools if t.get("type") == "web_search"]
    count = images(body.get("input"))
    if count > 1:
        raise ValueError("At most one ordinary image in this minimal run")
    return json.dumps(body).encode(), {
        "model": MODEL, "effort": "max", "original_max_output_tokens": original_cap,
        "max_output_tokens": body["max_output_tokens"], "image_count": count,
        "tool_choice_preserved": body.get("tool_choice"), "native_search_omitted": omitted,
        "native_search_include_omitted": [] if functional else include,
        "request_adjustments": (["bounded_max_output_tokens", "json_encoding"] + (["search_only_tool_declarations"] if search_only else [])) if functional else ["bounded_max_output_tokens", "omit_unpriced_native_search", "omit_search_include", "json_encoding"],
        **({"function_output_inputs": sum(isinstance(i,dict) and i.get("type")=="function_call_output" for i in body.get("input",[])),
            "native_search_offered": sum(t.get("type")=="web_search" for t in tools)} if functional else {}),
    }


class Budget:
    def __init__(self, ledger, *, _state=None):
        self.path = ledger
        if ledger.name in (R5_NAME, FUNCTIONAL_NAME, SEARCH_NAME, THIRD_NAME) and _state is None and not ledger.exists():
            raise ValueError("r5 ledger requires prior offline authorization and explicit accounting basis")
        self.state = copy.deepcopy(_state) if _state is not None else json.loads(ledger.read_text()) if ledger.exists() else {
            "feature": "FEAT-164", "limit_micro_cny": LIMIT, "max_http_requests": 8,
            "scope": "budgeted_text_image_g2v_not_raw_request_or_search_qualification",
            "charged_upper_micro_cny": 0, "requests": [], "halted": False,
        }
        version = self.state.get("schema_version", 1)
        if self.state.get("feature") != "FEAT-164" or version not in (1, 2, 3, 4, 5, 6, 7):
            raise ValueError("Independent approved FEAT-164 ledger required")
        rows = self.state["requests"]
        if not isinstance(rows, list) or any(r.get("ordinal") != i + 1 or r.get("status") not in
                {"inflight", "unknown_reserved", "settled"} for i, r in enumerate(rows)):
            raise ValueError("Invalid request ledger")
        self.acknowledged_unknown = set()
        if version == 1:
            if self.state["limit_micro_cny"] != LIMIT or self.state["max_http_requests"] != 8:
                raise ValueError("Legacy budget limits differ")
        elif version == 2:
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
        elif version == 3:
            receipt = self.state.get("successor_receipt", {})
            authorization = receipt.get("authorization")
            validate_successor_authorization(authorization)
            prior = receipt.get("predecessor_state", {})
            raw_prior = receipt.get("predecessor_json")
            if (not isinstance(prior, dict) or prior.get("schema_version") != 2
                    or not isinstance(raw_prior, str) or len(raw_prior) > 256 * 1024
                    or hashlib.sha256(raw_prior.encode()).hexdigest() != authorization["previous_ledger_sha256"]
                    or json.loads(raw_prior) != prior):
                raise ValueError("An exact schema2 predecessor is required")
            previous = Budget(ledger, _state=prior)
            if (len(previous.state["requests"]) != 2 or prior.get("halted") is not True
                    or prior.get("meter_state") != "stopped_normally"
                    or previous.state["requests"][1]["status"] != "settled"
                    or not successful_terminal(previous.state["requests"][1])
                    or receipt.get("authorization_sha256") != canonical_digest(authorization)
                    or receipt.get("predecessor_state_sha256") != canonical_digest(prior)
                    or receipt.get("base_request_count") != 2 or not 2 <= len(rows) <= 5
                    or receipt.get("base_requests_sha256") != canonical_digest(rows[:2])
                    or rows[:2] != previous.state["requests"]
                    or self.state["limit_micro_cny"] != RESUME_LIMIT or self.state["max_http_requests"] != 5):
                raise ValueError("Successor receipt or preserved predecessor differs")
            self.acknowledged_unknown = {1}
            # Settled cost is not permission to continue after an unsuccessful response.
            if any(r["status"] != "settled" or not successful_terminal(r) for r in rows[2:]):
                self.state["halted"] = True
        elif version == 4:
            receipt = self.state.get("r5_receipt", {})
            authorization = receipt.get("authorization")
            validate_r5_authorization(authorization)
            pricing = receipt.get("budget_basis")
            validate_r5_budget_basis(pricing)
            raw_prior = receipt.get("predecessor_json")
            if not isinstance(raw_prior, str) or len(raw_prior) > 256 * 1024:
                raise ValueError("Exact schema3 predecessor required")
            prior = json.loads(raw_prior)
            previous = Budget(ledger, _state=prior)
            if (prior.get("schema_version") != 3 or len(prior["requests"]) != 5
                    or prior.get("halted") is not True or prior.get("meter_state") != "stopped_normally"
                    or any(r["status"] != "settled" or not successful_terminal(r) for r in prior["requests"][1:])
                    or hashlib.sha256(raw_prior.encode()).hexdigest() != authorization["previous_ledger_sha256"]
                    or receipt.get("authorization_sha256") != canonical_digest(authorization)
                    or receipt.get("budget_basis_sha256") != canonical_digest(pricing)
                    or receipt["budget_basis_sha256"] != authorization["budget_basis_sha256"]
                    or receipt.get("base_request_count") != 5 or not 5 <= len(rows) <= 6
                    or rows[:5] != previous.state["requests"]
                    or self.state["limit_micro_cny"] != RESUME_LIMIT or self.state["max_http_requests"] != 6):
                raise ValueError("r5 receipt or preserved history differs")
            self.acknowledged_unknown = {1}
            if len(rows) == 6:
                self.state["halted"] = True
        elif version == 5:
            receipt = self.state.get("functional_receipt", {})
            authorization = receipt.get("authorization")
            validate_functional_authorization(authorization)
            raw = receipt.get("predecessor_json")
            if not isinstance(raw, str) or len(raw) > 512 * 1024:
                raise ValueError("Exact stopped r5 predecessor required")
            prior = json.loads(raw)
            previous = Budget(ledger, _state=prior)
            if (prior.get("schema_version") != 4 or len(prior["requests"]) != 6
                    or not prior.get("halted") or prior.get("meter_state") != "stopped_normally"
                    or not successful_terminal(prior["requests"][-1])
                    or hashlib.sha256(raw.encode()).hexdigest() != authorization["previous_ledger_sha256"]
                    or receipt.get("authorization_sha256") != canonical_digest(authorization)
                    or receipt.get("base_request_count") != 6 or not 6 <= len(rows) <= 10
                    or rows[:6] != previous.state["requests"]
                    or self.state["limit_micro_cny"] != RESUME_LIMIT or self.state["max_http_requests"] != 10):
                raise ValueError("Functional receipt or preserved history differs")
            self.acknowledged_unknown = {1}
            if any(r["status"] != "settled" or not successful_terminal(r) for r in rows[6:]):
                self.state["halted"] = True
        elif version == 6:
            receipt = self.state.get("search_receipt", {})
            authorization = receipt.get("authorization")
            validate_search_authorization(authorization)
            raw = receipt.get("predecessor_json")
            if not isinstance(raw, str) or len(raw) > 1024 * 1024:
                raise ValueError("Exact stopped functional predecessor required")
            prior = json.loads(raw)
            previous = Budget(ledger, _state=prior)
            if (prior.get("schema_version") != 5 or len(prior["requests"]) != 10
                    or prior.get("meter_state") != "stopped_normally" or not prior.get("halted")
                    or not successful_terminal(prior["requests"][-1])
                    or prior["requests"][-1].get("accounting_reason") != "native_search_fee_unreconciled_full_reserve_retained"
                    or prior["requests"][-1]["status"] != "unknown_reserved"
                    or hashlib.sha256(raw.encode()).hexdigest() != authorization["previous_ledger_sha256"]
                    or receipt.get("authorization_sha256") != canonical_digest(authorization)
                    or receipt.get("base_request_count") != 10 or not 10 <= len(rows) <= 12
                    or rows[:10] != previous.state["requests"]
                    or self.state["limit_micro_cny"] != SEARCH_LIMIT or self.state["max_http_requests"] != 12):
                raise ValueError("Search receipt or preserved history differs")
            self.acknowledged_unknown = {1, 10}
            review = receipt.get("second_attempt_review")
            if review is not None and (len(rows) < 11 or set(review) != {"first_row_sha256", "reason"}
                    or review["first_row_sha256"] != canonical_digest(rows[10])
                    or not isinstance(review["reason"], str) or not review["reason"].strip()
                    or rows[10]["status"] != "settled"):
                raise ValueError("Explicit second-attempt review differs")
            if len(rows) >= 12 or (len(rows) == 11 and review is None):
                self.state["halted"] = True
        else:
            receipt = self.state.get("third_receipt", {})
            authorization = receipt.get("authorization")
            validate_third_authorization(authorization)
            raw = receipt.get("predecessor_json")
            if not isinstance(raw, str) or len(raw) > 2 * 1024 * 1024:
                raise ValueError("Exact stopped search predecessor required")
            prior = json.loads(raw)
            previous = Budget(ledger, _state=prior)
            if (prior.get("schema_version") != 6 or len(prior["requests"]) != 12
                    or prior.get("meter_state") != "stopped_normally" or not prior.get("halted")
                    or any(r["status"] != "settled" or not successful_terminal(r) for r in prior["requests"][-2:])
                    or hashlib.sha256(raw.encode()).hexdigest() != authorization["previous_ledger_sha256"]
                    or receipt.get("authorization_sha256") != canonical_digest(authorization)
                    or receipt.get("base_request_count") != 12 or not 12 <= len(rows) <= 13
                    or rows[:12] != previous.state["requests"]
                    or self.state["limit_micro_cny"] != SEARCH_LIMIT or self.state["max_http_requests"] != 13):
                raise ValueError("Third receipt or preserved history differs")
            self.acknowledged_unknown = set(previous.acknowledged_unknown)
            if len(rows) == 13:
                self.state["halted"] = True
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
            if self.state.get("schema_version") in (6, 7) and (metadata["image_count"] != 0 or metadata.get("native_search_offered") != 1 or metadata.get("function_output_inputs") != 0):
                raise ValueError("Search qualification excludes images and tool followups")
            if self.acknowledged_unknown and self.state.get("schema_version") != 5 and metadata["image_count"] != 0:
                raise ValueError("The approved resume is text-only")
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
            if self.state.get("schema_version") in (6, 7):
                if observation.get("native_search_calls", 0):
                    row["accounting_reason"] = "native_search_fee_unreconciled_full_reserve_retained"
                self.state["halted"] = True
                self.state["stop_reason"] = "search_attempt_finished_review_required"
            elif self.state.get("schema_version") == 5:
                if observation.get("native_search_calls", 0):
                    row["accounting_reason"] = "native_search_fee_unreconciled_full_reserve_retained"
                if not valid or not successful_terminal(row) or len(self.state["requests"]) >= 10:
                    self.state["halted"] = True
                    self.state["stop_reason"] = "functional_failure_reserve_or_exhausted"
            elif self.state.get("schema_version") == 3:
                if not valid or not successful_terminal(row) or len(self.state["requests"]) >= 5:
                    self.state["halted"] = True
                    self.state["stop_reason"] = "successor_failed_or_exhausted"
            elif self.acknowledged_unknown:
                # Success also exhausts the one additional request. Failed or
                # incomplete responses may settle cost, but never reopen quota.
                self.state["halted"] = True
                self.state["stop_reason"] = "r5_request_consumed" if self.state.get("schema_version") == 4 else "single_resume_request_consumed"
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


def create_successor_ledger(previous_ledger, ledger, authorization):
    """Create one separately named successor; never rewrite the old ledger or perform HTTP."""
    validate_successor_authorization(authorization)
    if (ledger.name != SUCCESSOR_NAME or ledger.resolve() == previous_ledger.resolve()
            or ledger.parent.resolve() != previous_ledger.parent.resolve()):
        raise ValueError("Use the separate approved successor name")
    with open(previous_ledger.with_suffix(".lock"), "a") as old_guard, open(ledger.with_suffix(".lock"), "a") as guard:
        fcntl.flock(old_guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        raw = previous_ledger.read_bytes()
        if hashlib.sha256(raw).hexdigest() != authorization["previous_ledger_sha256"]:
            raise ValueError("Predecessor bytes differ from approval")
        previous = Budget(previous_ledger)
        prior = copy.deepcopy(previous.state)
        if (prior.get("schema_version") != 2 or len(prior["requests"]) != 2 or prior.get("halted") is not True
                or prior.get("meter_state") != "stopped_normally" or prior["requests"][1]["status"] != "settled"
                or not successful_terminal(prior["requests"][1]) or prior["charged_upper_micro_cny"] + RESERVATION > RESUME_LIMIT):
            raise ValueError("Stopped predecessor or remaining budget not qualified")
        if ledger.exists():
            existing = Budget(ledger)
            receipt = existing.state.get("successor_receipt", {})
            if receipt.get("authorization") != authorization or receipt.get("predecessor_state") != prior:
                raise ValueError("An existing ledger cannot be replaced or refilled")
            return {"authorization_id": SUCCESSOR_ID, "already_applied": True,
                    "remaining_http_requests": 0 if existing.state["halted"] else max(0, 5 - len(existing.state["requests"]))}
        state = copy.deepcopy(prior)
        state.update(schema_version=3, max_http_requests=5, halted=False, meter_state="created",
                     scope="bounded_text_g2v_successor")
        state.pop("stop_reason", None)
        state["successor_receipt"] = {"authorization": copy.deepcopy(authorization),
            "authorization_sha256": canonical_digest(authorization), "predecessor_state": prior, "predecessor_json": raw.decode(),
            "predecessor_state_sha256": canonical_digest(prior), "base_request_count": 2,
            "base_requests_sha256": canonical_digest(prior["requests"]),
            "recorded_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
        budget = Budget(ledger, _state=state)
        budget.save()
        if previous_ledger.read_bytes() != raw:
            raise ValueError("Predecessor changed during successor creation")
        return {"authorization_id": SUCCESSOR_ID, "already_applied": False, "remaining_http_requests": 3}


def create_r5_ledger(previous_ledger, ledger, authorization, pricing):
    """Offline preparation after explicit consent; never rewrites schema3 or emits HTTP."""
    validate_r5_authorization(authorization)
    validate_r5_budget_basis(pricing)
    if canonical_digest(pricing) != authorization["budget_basis_sha256"]:
        raise ValueError("Accounting basis differs from authorization")
    if (ledger.name != R5_NAME or ledger.resolve() == previous_ledger.resolve()
            or ledger.parent.resolve() != previous_ledger.parent.resolve()):
        raise ValueError("Use the separate r5 ledger beside its predecessor")
    with open(previous_ledger.with_suffix(".lock"), "a") as old_guard, open(ledger.with_suffix(".lock"), "a") as guard:
        fcntl.flock(old_guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        raw = previous_ledger.read_bytes()
        if hashlib.sha256(raw).hexdigest() != authorization["previous_ledger_sha256"]:
            raise ValueError("Predecessor differs from authorization")
        prior = Budget(previous_ledger).state
        if prior.get("schema_version") != 3 or len(prior["requests"]) != 5 or prior.get("meter_state") != "stopped_normally" or not prior.get("halted"):
            raise ValueError("Stopped exhausted schema3 predecessor required")
        if ledger.exists():
            existing = Budget(ledger)
            if existing.state.get("r5_receipt", {}).get("authorization") != authorization:
                raise ValueError("Existing r5 ledger cannot be replaced or refilled")
            return {"already_applied": True, "remaining_http_requests": int(not existing.state["halted"])}
        state = copy.deepcopy(prior)
        state.update(schema_version=4, max_http_requests=6, halted=False, meter_state="created", scope="r5_single_text_qualification")
        state.pop("stop_reason", None)
        state["r5_receipt"] = {"authorization": copy.deepcopy(authorization), "authorization_sha256": canonical_digest(authorization),
            "budget_basis": copy.deepcopy(pricing), "budget_basis_sha256": canonical_digest(pricing), "predecessor_json": raw.decode(), "base_request_count": 5}
        budget = Budget(ledger, _state=state)
        if budget.state["halted"] or prior["charged_upper_micro_cny"] + RESERVATION > RESUME_LIMIT:
            raise ValueError("r5 request cannot fit the preserved budget")
        budget.save()
        if previous_ledger.read_bytes() != raw:
            raise ValueError("Predecessor changed")
        return {"already_applied": False, "remaining_http_requests": 1}


def create_functional_ledger(previous_ledger, ledger, authorization):
    """Fresh append-only phase; old ledgers and their reservations remain byte exact."""
    validate_functional_authorization(authorization)
    if (ledger.name != FUNCTIONAL_NAME or ledger.resolve() == previous_ledger.resolve()
            or ledger.parent.resolve() != previous_ledger.parent.resolve()):
        raise ValueError("Use the separate functional ledger beside r5")
    with open(previous_ledger.with_suffix(".lock"), "a") as old_guard, open(ledger.with_suffix(".lock"), "a") as guard:
        fcntl.flock(old_guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        raw = previous_ledger.read_bytes()
        if hashlib.sha256(raw).hexdigest() != authorization["previous_ledger_sha256"]:
            raise ValueError("Functional predecessor digest differs")
        prior = Budget(previous_ledger).state
        if ledger.exists():
            existing = Budget(ledger)
            if existing.state.get("functional_receipt", {}).get("authorization") != authorization:
                raise ValueError("Existing functional ledger cannot be replaced or refilled")
            return {"already_applied": True, "remaining_http_requests": 0 if existing.state["halted"] else 10-len(existing.state["requests"])}
        state = copy.deepcopy(prior)
        state.update(schema_version=5, max_http_requests=10, halted=False, meter_state="created", scope="image_function_roundtrip_then_search")
        state.pop("stop_reason", None)
        state["functional_receipt"] = {"authorization": copy.deepcopy(authorization), "authorization_sha256": canonical_digest(authorization),
            "predecessor_json": raw.decode(), "base_request_count": 6}
        budget = Budget(ledger, _state=state)
        if budget.state["halted"] or prior["charged_upper_micro_cny"] + RESERVATION > RESUME_LIMIT:
            raise ValueError("Functional request cannot fit the retained estimate budget")
        budget.save()
        if previous_ledger.read_bytes() != raw:
            raise ValueError("Predecessor changed")
        return {"already_applied": False, "remaining_http_requests": 4}


def create_search_ledger(previous_ledger, ledger, authorization):
    """Offline, separately named successor; never releases either old reserve."""
    validate_search_authorization(authorization)
    if ledger.name != SEARCH_NAME or ledger.resolve() == previous_ledger.resolve() or ledger.parent.resolve() != previous_ledger.parent.resolve():
        raise ValueError("Separate search ledger beside its predecessor required")
    with open(previous_ledger.with_suffix(".lock"), "a") as old_guard, open(ledger.with_suffix(".lock"), "a") as guard:
        fcntl.flock(old_guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        raw = previous_ledger.read_bytes()
        if hashlib.sha256(raw).hexdigest() != authorization["previous_ledger_sha256"]:
            raise ValueError("Search predecessor bytes differ")
        if ledger.exists():
            existing = Budget(ledger)
            if existing.state["search_receipt"]["authorization"] != authorization:
                raise ValueError("Existing search ledger cannot be replaced")
            return {"already_applied": True, "admissible": not existing.state["halted"]}
        prior = Budget(previous_ledger).state
        state = copy.deepcopy(prior)
        state.update(schema_version=6, limit_micro_cny=SEARCH_LIMIT, max_http_requests=12,
                     halted=False, meter_state="created", scope="source_specific_native_search_one_at_a_time")
        state.pop("stop_reason", None)
        state["search_receipt"] = {"authorization": copy.deepcopy(authorization),
            "authorization_sha256": canonical_digest(authorization), "predecessor_json": raw.decode(), "base_request_count": 10}
        budget = Budget(ledger, _state=state)
        if budget.state["halted"] or budget.state["charged_upper_micro_cny"] + RESERVATION > SEARCH_LIMIT:
            raise ValueError("Preserved reservations leave no admissible request")
        budget.save()
        assert previous_ledger.read_bytes() == raw
        return {"already_applied": False, "admissible": True}


def review_second_search_attempt(ledger, reason):
    """Explicit review only; may not acknowledge a new unknown reserve or exceed cap."""
    with open(ledger.with_suffix(".lock"), "a") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        budget = Budget(ledger)
        rows = budget.state["requests"]
        if (budget.state.get("schema_version") != 6 or budget.state.get("meter_state") != "stopped_normally"
                or len(rows) != 11 or rows[-1]["status"] != "settled"
                or budget.state["charged_upper_micro_cny"] + RESERVATION > SEARCH_LIMIT
                or not isinstance(reason, str) or not reason.strip()):
            raise ValueError("Second attempt requires a settled first result, review and available budget")
        budget.state["search_receipt"]["second_attempt_review"] = {"first_row_sha256": canonical_digest(rows[-1]), "reason": reason}
        budget.state["halted"] = False
        Budget(ledger, _state=budget.state)
        budget.save()


def create_third_search_ledger(previous_ledger, ledger, authorization):
    """One extra Owner-authorized attempt; original product tools, same total cap."""
    validate_third_authorization(authorization)
    if ledger.name != THIRD_NAME or ledger.resolve() == previous_ledger.resolve() or ledger.parent.resolve() != previous_ledger.parent.resolve():
        raise ValueError("Separate third-attempt ledger required")
    with open(previous_ledger.with_suffix(".lock"), "a") as old_guard, open(ledger.with_suffix(".lock"), "a") as guard:
        fcntl.flock(old_guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        raw = previous_ledger.read_bytes()
        if hashlib.sha256(raw).hexdigest() != authorization["previous_ledger_sha256"]:
            raise ValueError("Third predecessor bytes differ")
        if ledger.exists():
            existing = Budget(ledger)
            if existing.state["third_receipt"]["authorization"] != authorization:
                raise ValueError("Existing third ledger cannot be replaced")
            return {"already_applied": True, "admissible": not existing.state["halted"]}
        prior = Budget(previous_ledger).state
        state = copy.deepcopy(prior)
        state.update(schema_version=7, max_http_requests=13, halted=False, meter_state="created", scope="third_search_original_product_tools")
        state.pop("stop_reason", None)
        state["third_receipt"] = {"authorization": copy.deepcopy(authorization),
            "authorization_sha256": canonical_digest(authorization), "predecessor_json": raw.decode(), "base_request_count": 12}
        budget = Budget(ledger, _state=state)
        if budget.state["halted"] or budget.state["charged_upper_micro_cny"] + RESERVATION > SEARCH_LIMIT:
            raise ValueError("Third request cannot fit preserved budget")
        budget.save()
        assert previous_ledger.read_bytes() == raw
        return {"already_applied": False, "admissible": True}


class Observer:
    def __init__(self, diagnostics=False):
        self.buffer = b""; self.result = {}; self.invalid = False; self.terminals = 0
        self.diagnostics = diagnostics
        self.item_types = []

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
                known = {"message", "reasoning", "function_call", "custom_tool_call", "web_search_call", "tool_search_call", "image_generation_call", "compaction"}
                if self.diagnostics and event.get("type") == "response.output_item.done" and len(self.item_types) < 64:
                    kind = (event.get("item") or {}).get("type")
                    self.item_types.append(kind if kind in known else "other")
                    self.result["stream_completed_item_types"] = list(self.item_types)
                if event.get("type") in ["response.completed", "response.incomplete", "response.failed"]:
                    self.terminals += 1
                    response = event.get("response", {})
                    usage = response.get("usage")
                    if isinstance(usage, dict):
                        self.result["usage"] = {k: usage[k] for k in ["input_tokens", "output_tokens"] if k in usage}
                    output = response.get("output", [])
                    if self.diagnostics:
                        self.result["terminal_output_item_types"] = [i.get("type") if i.get("type") in known else "other" for i in output[:64] if isinstance(i, dict)]
                        self.result["terminal_output_item_count"] = len(output)
                    functions = [i for i in output if isinstance(i, dict) and i.get("type") == "function_call"]
                    sources = [source for i in output if isinstance(i, dict) and i.get("type") == "web_search_call"
                               for source in (i.get("action") or {}).get("sources", []) if isinstance(source, dict)]
                    self.result.update({"function_calls": len(functions), "function_arguments_sha256": [hashlib.sha256(str(i.get("arguments", "")).encode()).hexdigest() for i in functions],
                        "native_search_sources_count": len(sources), "native_search_sources_sha256": canonical_digest(sources)})
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
    parser.add_argument("--create-successor-from", type=Path)
    parser.add_argument("--successor-authorization", type=Path)
    parser.add_argument("--create-r5-from", type=Path)
    parser.add_argument("--r5-authorization", type=Path)
    parser.add_argument("--r5-budget-basis", type=Path)
    parser.add_argument("--create-functional-from", type=Path)
    parser.add_argument("--functional-authorization", type=Path)
    args = parser.parse_args()
    if args.create_functional_from or args.functional_authorization:
        if not (args.create_functional_from and args.functional_authorization) or any((args.create_successor_from,args.successor_authorization,args.apply_resume_authorization,args.create_r5_from,args.r5_authorization,args.r5_budget_basis,args.kimi_key_file,args.control_token_file)):
            parser.error("Functional creation requires only predecessor and authorization, no credentials")
        print(json.dumps(create_functional_ledger(args.create_functional_from,args.ledger,json.loads(args.functional_authorization.read_text()))))
        return
    if args.create_r5_from or args.r5_authorization or args.r5_budget_basis:
        if not (args.create_r5_from and args.r5_authorization and args.r5_budget_basis) or any((args.create_successor_from, args.successor_authorization, args.apply_resume_authorization, args.kimi_key_file, args.control_token_file)):
            parser.error("r5 creation requires predecessor, authorization and the explicit accounting basis without credentials")
        print(json.dumps(create_r5_ledger(args.create_r5_from, args.ledger, json.loads(args.r5_authorization.read_text()), json.loads(args.r5_budget_basis.read_text()))))
        return
    if args.create_successor_from or args.successor_authorization:
        if not (args.create_successor_from and args.successor_authorization) or args.apply_resume_authorization or args.kimi_key_file or args.control_token_file:
            parser.error("Successor creation is an offline paired action without credentials")
        print(json.dumps(create_successor_ledger(args.create_successor_from, args.ledger,
            json.loads(args.successor_authorization.read_text()))))
        return
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
                    payload, metadata = prepare_request(self.rfile.read(length), functional=budget.state.get("schema_version") in (5, 6, 7), search_only=budget.state.get("schema_version") == 6)
                    row = budget.admit(metadata)
                except (ValueError, TypeError, AttributeError):
                    budget.stop_resume_on_rejection()
                    self.send_error(429, "Verification admission unavailable"); return
                connection = http.client.HTTPSConnection("api.moonshot.cn", timeout=240)
                observer = Observer(diagnostics=budget.state.get("schema_version") == 7); digest = hashlib.sha256(); count = 0; error_bytes = bytearray(); complete = False
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
        print("FEAT-164 meter ready; bounded output; schema5 preserves search/images; schema6 search-only stops after every request; legacy policies unchanged; no automatic requests", flush=True)
        try:
            server.serve_forever()
        finally:
            server.server_close(); budget.state["meter_state"] = "stopped_normally"; budget.save()


if __name__ == "__main__":
    main()
