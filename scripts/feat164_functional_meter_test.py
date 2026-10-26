"""Normal synthetic metadata only; no model, credentials, process faults or app data."""
import copy
import hashlib
import json
import unittest
import feat164_r5_meter_test as r5_fixture
meter = r5_fixture.meter
settle_success = r5_fixture.settle_success


class FunctionalControls(unittest.TestCase):
    def setUp(self):
        self.previous = r5_fixture.R5Controls()
        self.previous.setUp()
        prior = self.previous.create()
        settle_success(prior, prior.admit({'image_count': 0}))
        prior.state['meter_state'] = 'stopped_normally'; prior.save()
        self.old = self.previous.path; self.raw = self.old.read_bytes()
        self.path = self.old.parent / meter.FUNCTIONAL_NAME
        self.auth = {'schema_version': 1, 'feature': 'FEAT-164', 'authorization_id': meter.FUNCTIONAL_ID,
                     'approval_source': 'owner-necessary-functional-calls-search-images',
                     'approved_by': 'synthetic fixture, not human consent', 'approved_on': '2026-10-26',
                     'previous_ledger_sha256': hashlib.sha256(self.raw).hexdigest(), 'app_sha256': 'a'*64,
                     'runtime_sha256': meter.R5_BINARY_SHA256, 'additional_http_requests': 4,
                     'limit_micro_cny': 30_000_000, 'scope': 'image_function_roundtrip_then_search',
                     'successor_ledger_name': meter.FUNCTIONAL_NAME, 'preserve_unknown_reservations': True,
                     'failure_policy': 'stop'}

    def tearDown(self):
        self.assertEqual(self.old.read_bytes(), self.raw)
        self.previous.tearDown()

    def create(self):
        meter.create_functional_ledger(self.old, self.path, self.auth)
        return meter.Budget(self.path)

    def test_image_and_followups_keep_all_six_historical_rows(self):
        b = self.create(); original = copy.deepcopy(b.state['requests'])
        for count in [1, 0, 0, 0]:
            settle_success(b, b.admit({'image_count': count}))
        self.assertEqual(b.state['requests'][:6], original)
        self.assertEqual(len(b.state['requests']), 10)
        self.assertTrue(b.state['halted'])
        self.assertEqual(meter.create_functional_ledger(self.old, self.path, self.auth)['remaining_http_requests'], 0)
        with self.assertRaises(ValueError): meter.Budget(self.path).admit({'image_count': 0})

    def test_completed_search_keeps_full_reserve_and_stops(self):
        b = self.create(); before = b.state['charged_upper_micro_cny']
        row = b.admit({'image_count': 0})
        b.settle(row, {'usage': {'input_tokens': 20, 'output_tokens': 10}, 'http_status': 200,
                      'terminal': 'response.completed', 'response_status': 'completed', 'terminal_count': 1,
                      'stream_complete': True, 'response_model': meter.MODEL, 'native_search_calls': 1})
        self.assertTrue(meter.successful_terminal(row))
        self.assertEqual(row['status'], 'unknown_reserved')
        self.assertEqual(b.state['charged_upper_micro_cny'], before + meter.RESERVATION)
        self.assertTrue(b.state['halted'])
        self.assertEqual(row['accounting_reason'], 'native_search_fee_unreconciled_full_reserve_retained')
        with self.assertRaises(ValueError): meter.Budget(self.path).admit({'image_count': 0})

    def test_failure_and_inflight_do_not_reopen_on_restart(self):
        b = self.create(); row = b.admit({'image_count': 0})
        with self.assertRaises(ValueError): meter.Budget(self.path).admit({'image_count': 0})
        b.settle(row, {'http_status': 400})
        with self.assertRaises(ValueError): meter.Budget(self.path).admit({'image_count': 0})

    def test_scope_and_location_are_exact(self):
        with self.assertRaises(ValueError): meter.Budget(self.path)
        for changes in [{'additional_http_requests': 5}, {'limit_micro_cny': 40_000_000}, {'preserve_unknown_reservations': False}]:
            with self.assertRaises(ValueError): meter.create_functional_ledger(self.old, self.path, {**self.auth, **changes})
        with self.assertRaises(ValueError): meter.create_functional_ledger(self.old, self.path.parent/'different.json', self.auth)
        self.assertFalse(self.path.exists())

    def test_functional_preserves_image_search_and_tool_return(self):
        body = {'model': meter.MODEL, 'reasoning': {'effort': 'max'}, 'stream': True,
                'tools': [{'type': 'web_search'}, {'type': 'function', 'name': 'read_synthetic', 'parameters': {}}],
                'include': ['web_search_call.action.sources'],
                'input': [{'role': 'user', 'content': [{'type': 'input_image', 'image_url': 'data:image/png;base64,synthetic-metadata-only'}]},
                          {'type': 'function_call_output', 'call_id': 'normal-call', 'output': 'synthetic'}]}
        payload, meta = meter.prepare_request(json.dumps(body), functional=True)
        actual = json.loads(payload)
        self.assertEqual(actual['input'], body['input']); self.assertEqual(actual['tools'], body['tools'])
        self.assertEqual(actual['include'], body['include']); self.assertEqual(meta['native_search_omitted'], 0)
        self.assertEqual(meta['image_count'], 1); self.assertEqual(meta['function_output_inputs'], 1)
        legacy, _ = meter.prepare_request(json.dumps(body))
        self.assertEqual(json.loads(legacy)['include'], [])
        self.assertEqual(len(json.loads(legacy)['tools']), 1)

    def test_sse_telemetry_is_metadata_only(self):
        o = meter.Observer()
        event = {'type': 'response.completed', 'response': {'model': meter.MODEL, 'status': 'completed',
                  'usage': {'input_tokens': 1, 'output_tokens': 1}, 'output': [
                      {'type': 'function_call', 'arguments': '{"value":1}'},
                      {'type': 'web_search_call', 'action': {'sources': [{'url': 'https://example.org/ordinary'}]}}]}}
        o.feed(('data: '+json.dumps(event)+'\n\n').encode())
        self.assertEqual(o.result['function_calls'], 1); self.assertEqual(o.result['native_search_sources_count'], 1)
        self.assertNotIn('ordinary', json.dumps(o.result)); self.assertNotIn('value', json.dumps(o.result))

if __name__ == '__main__': unittest.main()
