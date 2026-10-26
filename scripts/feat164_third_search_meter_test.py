"""Ordinary recorded-state controls; no network or Runtime execution."""
import hashlib
import json
import unittest
import feat164_search_meter_test as fixtures
meter = fixtures.meter


class ThirdControls(unittest.TestCase):
    def setUp(self):
        self.parent = fixtures.SearchControls(); self.parent.setUp()
        b = self.parent.create(); b.settle(b.admit(self.parent.metadata), fixtures.completed())
        b.state['meter_state'] = 'stopped_normally'; b.save()
        meter.review_second_search_attempt(self.parent.path, 'ordinary reviewed second query')
        b = meter.Budget(self.parent.path); b.settle(b.admit(self.parent.metadata), fixtures.completed())
        b.state['meter_state'] = 'stopped_normally'; b.save()
        self.old = self.parent.path; self.raw = self.old.read_bytes(); self.path = self.old.parent/meter.THIRD_NAME
        self.auth = {**self.parent.auth, 'authorization_id': meter.THIRD_ID, 'approval_source':'owner-20261027-third-attempt',
                     'additional_http_requests':1,'scope':'third_search_original_product_tools', 'successor_ledger_name':meter.THIRD_NAME,
                     'failure_policy':'stop','previous_ledger_sha256':hashlib.sha256(self.raw).hexdigest()}

    def tearDown(self):
        self.assertEqual(self.old.read_bytes(), self.raw); self.parent.tearDown()

    def create(self):
        meter.create_third_search_ledger(self.old,self.path,self.auth)
        return meter.Budget(self.path)

    def test_original_twelve_rows_and_two_reserves_survive(self):
        b=self.create(); prior=json.loads(self.raw)
        self.assertEqual(b.state['requests'],prior['requests'])
        self.assertEqual(b.state['charged_upper_micro_cny'],prior['charged_upper_micro_cny'])
        self.assertEqual(b.state['max_http_requests'],13)
        self.assertEqual(b.acknowledged_unknown,{1,10})

    def test_one_request_then_no_fourth_and_no_refill(self):
        b=self.create(); b.settle(b.admit(self.parent.metadata),fixtures.completed(1))
        self.assertEqual(b.state['requests'][-1]['status'],'unknown_reserved')
        self.assertTrue(meter.Budget(self.path).state['halted'])
        self.assertFalse(meter.create_third_search_ledger(self.old,self.path,self.auth)['admissible'])
        with self.assertRaises(ValueError):meter.Budget(self.path).admit(self.parent.metadata)

    def test_scope_is_one_and_cap_stays_45(self):
        for change in [{'additional_http_requests':2},{'limit_micro_cny':60_000_000},{'preserve_unknown_reservations':False}]:
            with self.assertRaises(ValueError):meter.create_third_search_ledger(self.old,self.path,{**self.auth,**change})
        b=self.create(); b.admit(self.parent.metadata)
        with self.assertRaises(ValueError):meter.Budget(self.path).admit(self.parent.metadata)

    def test_diagnostics_record_only_types_and_original_tools_survive(self):
        body={'model':meter.MODEL,'reasoning':{'effort':'max'},'stream':True,'input':'ordinary question',
              'tools':[{'type':'web_search'},{'type':'function','name':'ordinary_function'}],
              'include':['web_search_call.action.sources']}
        payload,meta=meter.prepare_request(json.dumps(body),functional=True)
        self.assertEqual(json.loads(payload),{**body,'max_output_tokens':8192})
        self.assertNotIn('search_only_tool_declarations',meta['request_adjustments'])
        o=meter.Observer(diagnostics=True)
        item={'type':'reasoning','summary':[{'text':'ordinary private text not for metadata'}]}
        for event in [{'type':'response.output_item.done','item':item}, {'type':'response.completed','response':{'output':[item],'model':meter.MODEL,'status':'completed'}}]:
            o.feed(('data: '+json.dumps(event)+'\n\n').encode())
        self.assertEqual(o.result['stream_completed_item_types'],['reasoning'])
        self.assertEqual(o.result['terminal_output_item_types'],['reasoning'])
        self.assertNotIn('ordinary private text',json.dumps(o.result))


if __name__=='__main__':unittest.main()
