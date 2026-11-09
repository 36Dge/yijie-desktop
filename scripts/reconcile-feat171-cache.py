#!/usr/bin/env python3
"""Offline reconciliation of known Kimi usage; never refund unknown requests.

Preserve the exact old ledger. Match the native provider-usage observation by
thread, exact input/output counts and bounded delivery time. Unmatched rows
retain the full-price upper bound. No HTTP, provider credentials or task replay.
"""
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('meter', Path(__file__).with_name('feat171-budget-meter.py'))
meter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(meter)


def instant(value):
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))


def observed_cache(row, events):
    matches = []
    for event in events:
        payload = event.get('payload', {})
        usage = (payload.get('info') or {}).get('last_token_usage') or {}
        if payload.get('type') != 'token_count' or any(usage.get(k) != row['usage'][k] for k in ('input_tokens', 'output_tokens')):
            continue
        # Native consumes the same SSE immediately after the proxy writes it;
        # its event may follow the proxy EOF settlement by a few milliseconds.
        stamp = instant(event['timestamp'])
        if not instant(row['admitted_at']) <= stamp <= instant(row['settled_at']) + datetime.timedelta(seconds=5):
            continue
        cached = usage.get('cached_input_tokens')
        if type(cached) is int and 0 <= cached <= usage['input_tokens']:
            matches.append((cached, event['timestamp']))
    return matches[0] if len(matches) == 1 else None


def main():
    os.umask(0o077)
    directory = ROOT / '.local/feat171-real-acceptance'
    with (directory / 'ledger.lock').open('a') as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        path = directory / 'ledger.json'
        original = path.read_bytes()
        budget = meter.Budget(path)
        assert budget.state['meter_state'] == 'stopped_normally' and not budget.state['halted']
        assert not (directory / 'cache-reconciliation.json').exists(), 'Reconciliation is one-time and never refills quota'
        before = budget.state['charged_upper_micro_cny']
        observations = []
        for row in budget.state['requests'][:24]:
            assert row['status'] == 'settled' and row['model'] == 'kimi-k3.1-pro' and row['http_status'] == 200
            assert row['terminal_count'] == 1 and row['stream_complete'] and row.get('cache_ttl', '5m') == '5m'
            assert row.get('native_search_calls', 0) == 0 and 'cache_evidence' not in row
            paths = list((ROOT / '.local/demo-fast/codex-home/sessions/2026/11/09').glob('*' + row['thread_id'] + '.jsonl'))
            assert len(paths) == 1 and paths[0].resolve() == paths[0]
            raw = paths[0].read_bytes()
            events = [json.loads(line) for line in raw.splitlines()]
            assert events[0]['type'] == 'session_meta' and events[0]['payload']['id'] == row['thread_id']
            match = observed_cache(row, events)
            if match is None:
                continue
            cached, timestamp = match
            usage = row['usage']
            cost = ((usage['input_tokens'] - cached) * 130 + cached * 13 + usage['output_tokens'] * 680 + 9) // 10
            assert cost <= row['charged_upper_micro_cny'] <= row['reserved_micro_cny']
            row['full_price_upper_micro_cny'] = row['charged_upper_micro_cny']
            row['charged_upper_micro_cny'] = cost
            row['usage']['cached_input_tokens'] = cached
            row['cache_evidence'] = {'source': str(paths[0]), 'sha256': hashlib.sha256(raw).hexdigest(), 'observed_at': timestamp,
                                     'policy': 'unique exact token counts; same native thread; within admission to EOF+5s'}
            observations.append({'ordinal': row['ordinal'], 'cached_tokens': cached, 'cost_micro_cny': cost})
        budget.state['charged_upper_micro_cny'] = sum(r['charged_upper_micro_cny'] for r in budget.state['requests'])
        receipt = {'feature': 'FEAT-171', 'original_ledger_sha256': hashlib.sha256(original).hexdigest(),
                   'previous_upper_micro_cny': before, 'reconciled_upper_micro_cny': budget.state['charged_upper_micro_cny'],
                   'max_http_requests': 80, 'limit_micro_cny': 30000000, 'request_count': len(budget.state['requests']),
                   'observations': observations, 'unmatched_policy': 'retain prior full-price upper bound',
                   'unknown_refunds': 0, 'recorded_at': meter.now()}
        with (directory / 'ledger-before-cache-reconciliation.json').open('xb') as target:
            target.write(original); target.flush(); os.fsync(target.fileno())
        with (directory / 'cache-reconciliation.json').open('x') as target:
            json.dump(receipt, target, indent=2); target.write('\n'); target.flush(); os.fsync(target.fileno())
        budget.save()
        meter.Budget(path)  # Recheck the exact persisted accounting before reuse.
        print(json.dumps(receipt))


if __name__ == '__main__':
    main()
