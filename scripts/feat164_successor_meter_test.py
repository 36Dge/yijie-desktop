"""Ordinary private-ledger transitions. No credentials, network or product database."""
import copy
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('meter', Path(__file__).with_name('feat164-budget-meter.py'))
meter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(meter)


def successor_fixture(root):
    old = root / 'prior.json'
    b = meter.Budget(old)
    row = b.admit({'image_count': 0})
    b.settle(row, {'http_status': 400})
    b.state['meter_state'] = 'stopped_normally'; b.save()
    auth = {'schema_version': 1, 'feature': 'FEAT-164', 'authorization_id': meter.RESUME_ID,
            'approved_by': '普通 Owner fixture', 'approved_on': '2026-10-25',
            'approval_source': 'current-user-confirmation-2026-10-25',
            'previous_ledger_sha256': hashlib.sha256(old.read_bytes()).hexdigest(),
            'limit_micro_cny': 30_000_000, 'additional_http_requests': 1,
            'preserve_unknown_reservations': True, 'failure_policy': 'stop', 'scope': 'one_budgeted_text_g2v'}
    meter.resume_ledger(old, auth)
    b = meter.Budget(old)
    row = b.admit({'image_count': 0, 'model': meter.MODEL, 'effort': 'max'})
    settle_success(b, row)
    b.state['meter_state'] = 'stopped_normally'; b.save()
    new_auth = {**auth, 'authorization_id': meter.SUCCESSOR_ID, 'approved_on': '2026-10-26',
                'approval_source': 'current-user-confirmation-2026-10-26-plus-two',
                'previous_ledger_sha256': hashlib.sha256(old.read_bytes()).hexdigest(),
                'additional_http_requests': 3, 'scope': 'bounded_text_g2v_successor',
                'successor_ledger_name': meter.SUCCESSOR_NAME}
    return old, root / meter.SUCCESSOR_NAME, new_auth


def settle_success(b, row, **changes):
    b.settle(row, {**{'http_status': 200, 'response_model': meter.MODEL, 'terminal': 'response.completed',
                     'response_status': 'completed', 'terminal_count': 1, 'stream_complete': True,
                     'output_text_present': True, 'forwarded_response_bytes': 100,
                     'forwarded_response_sha256': 'a' * 64,
                     'usage': {'input_tokens': 1000, 'output_tokens': 100}}, **changes})


class SuccessorControls(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='feat164-successor-')
        self.old, self.path, self.auth = successor_fixture(Path(self.directory.name))
        self.raw = self.old.read_bytes()

    def tearDown(self):
        self.assertEqual(self.old.read_bytes(), self.raw)
        self.directory.cleanup()

    def create(self):
        meter.create_successor_ledger(self.old, self.path, self.auth)
        return meter.Budget(self.path)

    def test_three_requests_preserve_old_rows_across_restart_and_idempotent_creation(self):
        b = self.create(); prior = copy.deepcopy(b.state['requests'])
        for ordinal in [3, 4, 5]:
            b = meter.Budget(self.path)
            row = b.admit({'image_count': 0, 'model': meter.MODEL, 'effort': 'max'})
            self.assertEqual(row['ordinal'], ordinal)
            self.assertLessEqual(b.state['charged_upper_micro_cny'], 30_000_000)
            settle_success(b, row)
        self.assertEqual(b.state['requests'][:2], prior)
        before = self.path.read_bytes()
        self.assertEqual(meter.create_successor_ledger(self.old, self.path, self.auth)['remaining_http_requests'], 0)
        self.assertEqual(self.path.read_bytes(), before)
        with self.assertRaises(ValueError): meter.Budget(self.path).admit({'image_count': 0})

    def test_incomplete_with_settled_usage_stops_remaining_requests(self):
        b = self.create(); row = b.admit({'image_count': 0})
        settle_success(b, row, terminal='response.incomplete', response_status='incomplete')
        self.assertEqual(row['status'], 'settled')
        with self.assertRaises(ValueError): meter.Budget(self.path).admit({'image_count': 0})

    def test_unknown_response_keeps_new_reservation_and_stops(self):
        b = self.create(); before = b.state['charged_upper_micro_cny']; row = b.admit({'image_count': 0})
        b.settle(row, {'http_status': 400})
        self.assertEqual(b.state['charged_upper_micro_cny'], before + meter.RESERVATION)
        self.assertEqual(row['status'], 'unknown_reserved')
        self.assertEqual(meter.create_successor_ledger(self.old, self.path, self.auth)['remaining_http_requests'], 0)
        with self.assertRaises(ValueError): meter.Budget(self.path).admit({'image_count': 0})

    def test_no_parallel_spending_or_restart_refill(self):
        b = self.create(); b.admit({'image_count': 0})
        with self.assertRaises(ValueError): b.admit({'image_count': 0})
        with self.assertRaises(ValueError): meter.Budget(self.path).admit({'image_count': 0})
        self.assertEqual(meter.create_successor_ledger(self.old, self.path, self.auth)['remaining_http_requests'], 0)

    def test_text_only_and_authenticated_rejection_stops(self):
        b = self.create()
        with self.assertRaises(ValueError): b.admit({'image_count': 1})
        b.stop_resume_on_rejection()
        with self.assertRaises(ValueError): meter.Budget(self.path).admit({'image_count': 0})
        self.assertEqual(len(b.state['requests']), 2)

    def test_unchanged_total_cap_can_stop_before_all_three_requests(self):
        b = self.create(); row = b.admit({'image_count': 0})
        settle_success(b, row, usage={'input_tokens': meter.CONTEXT, 'output_tokens': meter.MAX_OUTPUT})
        with self.assertRaises(ValueError): meter.Budget(self.path).admit({'image_count': 0})
        self.assertLessEqual(b.state['charged_upper_micro_cny'], 30_000_000)

    def test_authorization_scope_source_unique_destination_and_live_lock(self):
        for changes in [{'additional_http_requests': 4}, {'limit_micro_cny': 40_000_000},
                        {'previous_ledger_sha256': '0' * 64}, {'preserve_unknown_reservations': False}]:
            with self.assertRaises(ValueError): meter.create_successor_ledger(self.old, self.path, {**self.auth, **changes})
            self.assertFalse(self.path.exists())
        with self.assertRaises(ValueError): meter.create_successor_ledger(self.old, self.path.parent/'other.json', self.auth)
        other = self.path.parent/'other'; other.mkdir()
        with self.assertRaises(ValueError): meter.create_successor_ledger(self.old, other/self.path.name, self.auth)
        with open(self.old.with_suffix('.lock'), 'a') as guard:
            fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError): self.create()
        self.assertFalse(self.path.exists())

    def test_prefix_drift_and_unknown_ledger_version_are_rejected(self):
        b = self.create(); original = copy.deepcopy(b.state)
        for change in ['prefix', 'version']:
            state = copy.deepcopy(original)
            if change == 'prefix': state['requests'][1]['http_status'] = 400
            else: state['schema_version'] = 99
            with self.assertRaises(ValueError): meter.Budget(self.path, _state=state)


if __name__ == '__main__':
    unittest.main()
