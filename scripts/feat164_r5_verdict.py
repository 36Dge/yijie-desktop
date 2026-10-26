"""Strict r5 live-result oracle; no network and no ledger writes."""
import argparse
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('r5_meter', Path(__file__).with_name('feat164-budget-meter.py'))
meter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(meter)
REQUIRED = ('source_verified', 'harness_qualified', 'platform_ready', 'app_request_observed',
            'answer_is_42', 'persisted', 'reopened', 'no_resend', 'normal_cleanup')


def evaluate(ledger, observation):
    failed = []
    try:
        budget = meter.Budget(Path(meter.R5_NAME), _state=ledger)
    except (ValueError, TypeError, KeyError, AttributeError):
        return {'status': 'FAIL', 'failure_class': 'gate_failure', 'failed_checks': ['r5_ledger_invalid']}
    if budget.state.get('schema_version') != 4:
        failed.append('exact_r5_ledger')
    rows = budget.state['requests']
    if len(rows) != 6:
        failed.append('one_new_request')
    elif not (rows[5]['status'] == 'settled' and meter.successful_terminal(rows[5]) and rows[5].get('output_text_present') is True):
        failed.append('complete_successful_current_model_answer')
    if not ledger.get('halted') or ledger.get('meter_state') != 'stopped_normally':
        failed.append('meter_stopped_and_exhausted')
    if observation.get('runtime_sha256') != meter.R5_BINARY_SHA256 or observation.get('app_sha256') != meter.R5_APP_SHA256:
        failed.append('exact_runtime_and_app')
    failed += [name for name in REQUIRED if observation.get(name) is not True]
    return {'status': 'FAIL' if failed else 'PASS', 'failure_class': 'qualification_incomplete' if failed else None,
            'scope': 'r5 one bounded real text request, persistence, reopen and normal cleanup only',
            'failed_checks': failed, 'whole_feature_complete': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--ledger', type=Path, required=True)
    parser.add_argument('--observation', type=Path, required=True)
    args = parser.parse_args()
    result = evaluate(json.loads(args.ledger.read_text()), json.loads(args.observation.read_text()))
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['status'] == 'PASS' else 1)
