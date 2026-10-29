"""FEAT-162 current Owner authorization: 20 CNY is a soft stop threshold.

No fee hard-bound requirement; no rewriting of model requests. Native UI owns
all tool approvals and normal cancellation. This observer never grants a tool.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import threading

spec = importlib.util.spec_from_file_location('feat162_policy_v2', Path(__file__).with_name('feat162-basic-pro-meter.py'))
v2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(v2)
legacy, require, digest = v2.legacy, v2.require, v2.digest
AUTHORITY = 'FEAT-162-soft-budget-v3'
THRESHOLD = 20_000_000
ESTIMATE = 1_000_000  # Accounting estimate, never a maximum or a send condition.


def prepare(payload):
    outgoing, metadata = v2.prepare(payload)
    body = json.loads(payload)
    cache = body.get('prompt_cache_key')
    # The fixed Runtime uses its thread ID as the ordinary cache key. It varies
    # between the seven fresh sessions, while the actual product configuration
    # must stay fixed. Validate identity separately; forward all original bytes.
    require(cache is None or (isinstance(cache, str) and cache
            and cache == metadata.get('runtime_thread_id')), 'Unbound prompt cache identity')
    metadata['full_model_config_sha256'] = metadata['model_config_sha256']
    metadata['model_config_sha256'] = digest({k: v for k, v in body.items()
        if k not in {'input', 'client_metadata', 'prompt_cache_key'}})
    metadata['prompt_cache_key_sha256'] = digest(cache)
    return outgoing, metadata


class Budget(v2.Budget):
    def prepare_request(self, payload):
        return prepare(payload)

    def __init__(self, path, plan, offline=False):
        self.path, self.lock, self.offline = Path(path), threading.RLock(), offline
        self.plan = copy.deepcopy(plan)
        self.owner_stop = None
        self.enforces_owner_stop = True
        require(plan.get('schema_version') == 3 and plan.get('feature') == 'FEAT-162', 'New v3 plan required')
        self.carried_count, self.carried_cost = 0, 0
        if plan.get('prior_ledger'):
            previous = json.loads(Path(plan['prior_ledger']).read_text())
            require(previous.get('authorization') == AUTHORITY and previous.get('offline') is offline
                    and previous.get('halted') is True and not previous.get('armed')
                    and not any(r['status'] == 'inflight' for r in previous['requests']), 'Closed same-policy predecessor required')
            require(digest(previous) == plan.get('prior_ledger_sha256'), 'Previous ledger changed')
            self.carried_count = previous.get('carried_count', 0) + len(previous['requests'])
            self.carried_cost = previous.get('carried_cost_micro_cny', 0) + previous['model_upper_micro_cny']
        self.state = json.loads(self.path.read_text()) if self.path.exists() else {
            'schema_version': 3, 'feature': 'FEAT-162', 'authorization': AUTHORITY,
            'plan_sha256': digest(plan), 'offline': offline, 'budget_policy': 'soft_stop_after_observation',
            'accounting_kind': 'conservative_observation_or_estimate_not_billing_or_hard_bound',
            'model_http_limit': 17, 'total_limit_micro_cny': THRESHOLD,
            'carried_count': self.carried_count, 'carried_cost_micro_cny': self.carried_cost,
            'tool_reserved_micro_cny': v2.REST_RESERVE, 'model_upper_micro_cny': 0,
            'requests': [], 'tool_approvals': [], 'armed': False, 'armed_once': False,
            'halted': False, 'meter_state': 'created', 'case': None, 'finished_cases': []}
        require(self.state['schema_version'] == 3 and self.state['authorization'] == AUTHORITY
                and self.state['plan_sha256'] == digest(plan) and self.state['offline'] is offline,
                'Do not reuse old or changed ledgers')
        require(self.state['model_upper_micro_cny'] == sum(r.get('charged_upper_micro_cny', r['reserved_micro_cny']) for r in self.state['requests']), 'Accounting mismatch')
        if self.state['meter_state'] != 'created' or self.state['requests']:
            self.halt('prior_run_cannot_resume')

    def live_ready(self, require_owner=True):
        p = self.plan
        require(p.get('paid_authorized') is True and p.get('activation_qualified') is True, 'Paid and exact-App authority required')
        require(p.get('budget_policy') == 'soft_stop_after_observation'
                and p.get('soft_threshold_micro_cny') == THRESHOLD
                and p.get('allow_inflight_overshoot') is True, 'Current explicit soft-budget authorization required')
        require(p.get('stop_mode') == 'native_ui' and p.get('native_ui_stop_verified') is True,
                'Normal Native UI stop preflight required')
        for key in ['model_config_sha256', 'artifact_receipt_sha256', 'authorization_evidence_sha256']:
            require(isinstance(p.get(key), str) and legacy.re.fullmatch('[0-9a-f]{64}', p[key]), 'Missing exact run evidence')
        receipt = Path(p.get('artifact_receipt_file', ''))
        require(receipt.is_absolute() and receipt.is_file()
                and hashlib.sha256(receipt.read_bytes()).hexdigest() == p['artifact_receipt_sha256'], 'Actual App receipt differs')

    def halt(self, reason):
        with self.lock:
            legacy.Budget.halt(self, reason)
            self.state['native_stop'] = {'status': 'operator_native_ui_required', 'reason': reason}
            self.save()

    def observed_total(self):
        return self.carried_cost + self.state['model_upper_micro_cny'] + self.state['tool_reserved_micro_cny']

    def admit(self, metadata):
        with self.lock:
            case = self.state['case']; rows = self.state['requests']
            require(self.state['armed'] and not self.state['halted'] and case in v2.CASES, 'No model allowance')
            require(len(rows) < 17 and sum(r['case'] == case for r in rows) < v2.CASES[case][0]
                    and not any(r['status'] == 'inflight' for r in rows), 'Request limit or concurrency')
            for result in metadata.get('tool_results', []):
                require(any(r['call_ref'] == result['call_ref'] and r['case'] == case and r['kind'] == result['kind'] for r in self.state['tool_approvals']), 'Unknown result provenance')
            if not self.offline:
                self.live_ready()
                if self.observed_total() >= THRESHOLD:
                    self.halt('soft_budget_reached')
                    raise ValueError('Observed soft threshold reached; no next paid request')
                require(metadata['model_config_sha256'] == self.plan['model_config_sha256'], 'Product request differs')
            # Deliberately no cost+next-reserve <= threshold check and no token/native hard bounds.
            reserve = 0 if self.offline else ESTIMATE
            row = {**metadata, 'case': case, 'ordinal': len(rows)+1, 'status': 'inflight',
                   'reserved_micro_cny': reserve, 'reserve_kind': 'estimate_only', 'supplier_http_started': False}
            rows.append(row); self.state['model_upper_micro_cny'] += reserve; self.save()
            return row

    def settle(self, row, observation):
        with self.lock:
            row.update(observation)
            usage = observation.get('usage', {})
            known = isinstance(usage, dict) and all(type(usage.get(k)) is int and usage[k] >= 0 for k in ['input_tokens', 'output_tokens'])
            known = known and observation.get('terminal_count') == 1 and observation.get('stream_complete') is True
            known = known and observation.get('response_model') == legacy.shared.MODEL and observation.get('cache_ttl', '5m') == '5m'
            # Native item counts are not billing counts. A routing failure stops the batch anyway.
            known = known and observation.get('native_search_calls', 0) == 0
            if known:
                charge = 0 if self.offline else usage['input_tokens']*13 + usage['output_tokens']*68
                row.update(status='settled', charged_upper_micro_cny=charge, charge_kind='conservative_usage_observation')
                self.state['model_upper_micro_cny'] += charge - row['reserved_micro_cny']
            else:
                row['status'] = 'unknown_reserved'
            if not known or not legacy.shared.successful_terminal(row) or observation.get('native_search_calls', 0):
                self.halt('failure_or_unknown_or_native_search')
            elif not self.offline and self.observed_total() >= THRESHOLD:
                self.halt('soft_budget_reached_after_request')
            self.save()
