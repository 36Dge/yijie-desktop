"""Ordinary state/metadata controls only; no network, credentials or Runtime."""
import copy
import hashlib
import json
import unittest
import feat164_functional_meter_test as fixtures
meter = fixtures.meter


def completed(search=0):
    return {'usage': {'input_tokens': 20, 'output_tokens': 10}, 'http_status': 200,
            'terminal': 'response.completed', 'response_status': 'completed', 'terminal_count': 1,
            'stream_complete': True, 'response_model': meter.MODEL, 'native_search_calls': search}


class SearchControls(unittest.TestCase):
    def setUp(self):
        self.parent = fixtures.FunctionalControls(); self.parent.setUp()
        prior = self.parent.create()
        for _ in range(3):
            fixtures.settle_success(prior, prior.admit({'image_count': 0}))
        prior.settle(prior.admit({'image_count': 0}), completed(1))
        prior.state['meter_state'] = 'stopped_normally'; prior.save()
        self.old = self.parent.path; self.raw = self.old.read_bytes()
        self.path = self.old.parent / meter.SEARCH_NAME
        self.auth = {'schema_version': 1, 'feature': 'FEAT-164', 'authorization_id': meter.SEARCH_ID,
                     'approval_source': 'owner-20261027-cap45-then-two-attempts', 'approved_on': '2026-10-27',
                     'approved_by': 'ordinary fixture; not human consent', 'app_sha256': meter.SEARCH_APP,
                     'runtime_sha256': meter.R5_BINARY_SHA256, 'additional_http_requests': 2,
                     'limit_micro_cny': meter.SEARCH_LIMIT, 'scope': 'source_specific_native_search_one_at_a_time',
                     'successor_ledger_name': meter.SEARCH_NAME, 'preserve_unknown_reservations': True,
                     'failure_policy': 'stop_and_review_before_second', 'previous_ledger_sha256': hashlib.sha256(self.raw).hexdigest()}
        self.metadata = {'image_count': 0, 'native_search_offered': 1, 'function_output_inputs': 0}

    def tearDown(self):
        self.assertEqual(self.raw, self.old.read_bytes()); self.parent.tearDown()

    def create(self):
        meter.create_search_ledger(self.old, self.path, self.auth)
        return meter.Budget(self.path)

    def test_preserves_ten_rows_and_both_reserves(self):
        b = self.create(); old = json.loads(self.raw)
        self.assertEqual(b.state['requests'], old['requests'])
        self.assertEqual(b.state['charged_upper_micro_cny'], old['charged_upper_micro_cny'])
        self.assertEqual(b.acknowledged_unknown, {1, 10})
        self.assertTrue(meter.create_search_ledger(self.old, self.path, self.auth)['already_applied'])

    def test_native_search_keeps_new_full_reserve_and_blocks_second_over_cap(self):
        b = self.create(); before = b.state['charged_upper_micro_cny']
        row = b.admit(self.metadata); b.settle(row, completed(1))
        b.state['meter_state'] = 'stopped_normally'; b.save()
        self.assertEqual(b.state['charged_upper_micro_cny'], before + meter.RESERVATION)
        self.assertEqual(row['status'], 'unknown_reserved'); self.assertTrue(meter.successful_terminal(row))
        self.assertTrue(meter.Budget(self.path).state['halted'])
        with self.assertRaises(ValueError): meter.review_second_search_attempt(self.path, 'ordinary result review')
        with self.assertRaises(ValueError): meter.Budget(self.path).admit(self.metadata)

    def test_second_requires_review_and_third_is_never_admitted(self):
        b = self.create(); b.settle(b.admit(self.metadata), completed())
        with self.assertRaises(ValueError): b.admit(self.metadata)
        b.state['meter_state'] = 'stopped_normally'; b.save()
        meter.review_second_search_attempt(self.path, 'first response completed without native search; reviewed changed query')
        b = meter.Budget(self.path); b.settle(b.admit(self.metadata), completed())
        self.assertEqual(len(b.state['requests']), 12); self.assertTrue(b.state['halted'])
        with self.assertRaises(ValueError): meter.review_second_search_attempt(self.path, 'no third')
        with self.assertRaises(ValueError): meter.Budget(self.path).admit(self.metadata)

    def test_settled_incomplete_can_only_continue_after_explicit_review(self):
        b = self.create(); result = {**completed(), 'terminal': 'response.incomplete', 'response_status': 'incomplete'}
        b.settle(b.admit(self.metadata), result); self.assertTrue(b.state['halted'])
        b.state['meter_state'] = 'stopped_normally'; b.save()
        meter.review_second_search_attempt(self.path, 'observed bounded incomplete result reviewed; new task only')
        self.assertFalse(meter.Budget(self.path).state['halted'])

    def test_inflight_and_unknown_cannot_resume(self):
        b = self.create(); row = b.admit(self.metadata)
        with self.assertRaises(ValueError): meter.Budget(self.path).admit(self.metadata)
        b.settle(row, {'http_status': 400}); b.state['meter_state'] = 'stopped_normally'; b.save()
        with self.assertRaises(ValueError): meter.review_second_search_attempt(self.path, 'unknown is not refundable')

    def test_cap_and_scope_are_closed(self):
        for change in [{'limit_micro_cny': 50_000_000}, {'additional_http_requests': 3}, {'app_sha256': 'a'*64}, {'preserve_unknown_reservations': False}]:
            with self.assertRaises(ValueError): meter.create_search_ledger(self.old, self.path, {**self.auth, **change})
        b = self.create()
        for change in [{'image_count': 1}, {'native_search_offered': 0}, {'function_output_inputs': 1}]:
            with self.assertRaises(ValueError): b.admit({**self.metadata, **change})
        self.assertEqual(len(b.state['requests']), 10)

    def test_search_only_preserves_question_and_sources_but_excludes_execution_tools(self):
        body = {'model': meter.MODEL, 'reasoning': {'effort': 'max'}, 'stream': True, 'input': [{'role': 'user', 'content': 'ordinary official URL question'}],
                'tools': [{'type': 'web_search'}, {'type': 'function', 'name': 'ordinary_tool'}, {'type': 'namespace', 'name': 'ordinary_namespace'}],
                'include': ['web_search_call.action.sources'], 'max_output_tokens': 20000, 'tool_choice': 'auto'}
        raw, meta = meter.prepare_request(json.dumps(body), functional=True, search_only=True); result = json.loads(raw)
        self.assertEqual(result, {**body, 'max_output_tokens':8192, 'tools':[{'type':'web_search'}]})
        self.assertEqual(meta['native_search_offered'], 1)
        self.assertIn('search_only_tool_declarations', meta['request_adjustments'])
        functional, _ = meter.prepare_request(json.dumps(body), functional=True)
        self.assertEqual(json.loads(functional)['tools'], body['tools'])


if __name__ == '__main__': unittest.main()
