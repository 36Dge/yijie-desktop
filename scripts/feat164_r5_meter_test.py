"""Synthetic private ledger tests only. No real authorization, keys or network."""
import copy
import datetime
import fcntl
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from feat164_successor_meter_test import meter, successor_fixture, settle_success


class R5Controls(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='feat164-r5-budget-test-')
        root = Path(self.directory.name)
        _, self.old, auth3 = successor_fixture(root)
        meter.create_successor_ledger(root/'prior.json', self.old, auth3)
        b = meter.Budget(self.old)
        for _ in range(3):
            settle_success(b, b.admit({'image_count': 0}))
        b.state['meter_state'] = 'stopped_normally'; b.save()
        self.raw = self.old.read_bytes()
        self.path = root/meter.R5_NAME
        self.pricing = {'model':meter.MODEL,'basis':'retained_historical_estimate','exact_pricing_required':False,
                        'owner_instruction':'2026-10-26-functional-validation-no-exact-pricing',
                        'input_estimate_micro_cny_per_token':13,'output_estimate_micro_cny_per_token':68,'ttl':'5m'}
        self.auth = {'schema_version':1,'feature':'FEAT-164','authorization_id':meter.R5_ID,'approved_by':'synthetic fixture, not real consent',
                     'approved_on':'2026-10-26','approval_source':'explicit-user-r5-one-http',
                     'previous_ledger_sha256':hashlib.sha256(self.raw).hexdigest(),'limit_micro_cny':30_000_000,
                     'additional_http_requests':1,'preserve_unknown_reservations':True,'failure_policy':'stop','scope':'r5_single_text_qualification',
                     'successor_ledger_name':meter.R5_NAME,'runtime_sha256':meter.R5_BINARY_SHA256,'app_sha256':meter.R5_APP_SHA256,
                     'budget_basis_sha256':meter.canonical_digest(self.pricing)}

    def tearDown(self):
        self.assertEqual(self.old.read_bytes(),self.raw)
        self.directory.cleanup()

    def create(self):
        meter.create_r5_ledger(self.old,self.path,self.auth,self.pricing)
        return meter.Budget(self.path)

    def test_uncreated_r5_path_cannot_inherit_legacy_initial_budget(self):
        with self.assertRaises(ValueError):meter.Budget(self.path)
        self.assertFalse(self.path.exists())

    def test_one_request_keeps_five_rows_and_stays_exhausted(self):
        b=self.create(); prior=copy.deepcopy(b.state['requests']);row=b.admit({'image_count':0});self.assertEqual(row['ordinal'],6)
        settle_success(b,row);self.assertTrue(b.state['halted']);self.assertEqual(b.state['requests'][:5],prior)
        self.assertEqual(meter.create_r5_ledger(self.old,self.path,self.auth,self.pricing)['remaining_http_requests'],0)
        with self.assertRaises(ValueError):meter.Budget(self.path).admit({'image_count':0})

    def test_unknown_keeps_new_and_original_reservations(self):
        b=self.create();before=b.state['charged_upper_micro_cny'];row=b.admit({'image_count':0});b.settle(row,{'http_status':400})
        self.assertEqual(b.state['charged_upper_micro_cny'],before+meter.RESERVATION)
        self.assertEqual(row['status'],'unknown_reserved');self.assertEqual(b.state['requests'][0]['status'],'unknown_reserved')
        with self.assertRaises(ValueError):meter.Budget(self.path).admit({'image_count':0})

    def test_incomplete_with_usage_cannot_retry(self):
        b=self.create();row=b.admit({'image_count':0});settle_success(b,row,terminal='response.incomplete',response_status='incomplete')
        self.assertEqual(row['status'],'settled')
        with self.assertRaises(ValueError):meter.Budget(self.path).admit({'image_count':0})

    def test_inflight_restart_and_concurrent_admission_stop(self):
        b=self.create();b.admit({'image_count':0})
        with self.assertRaises(ValueError):b.admit({'image_count':0})
        with self.assertRaises(ValueError):meter.Budget(self.path).admit({'image_count':0})

    def test_old_authorization_or_expanded_scope_cannot_create(self):
        for changes in [{'authorization_id':meter.SUCCESSOR_ID},{'additional_http_requests':2},{'preserve_unknown_reservations':False},
                        {'runtime_sha256':'a'*64},{'app_sha256':'b'*64},{'limit_micro_cny':40_000_000},{'approved_on':'invalid'}]:
            with self.assertRaises(ValueError):meter.create_r5_ledger(self.old,self.path,{**self.auth,**changes},self.pricing)
            self.assertFalse(self.path.exists())

    def test_unapproved_or_changed_estimate_stops_before_ledger(self):
        for changes in [{'exact_pricing_required':True},{'owner_instruction':'old-scope'},{'input_estimate_micro_cny_per_token':14},{'output_estimate_micro_cny_per_token':69},{'ttl':'1h'},{'model':'kimi-k3'}]:
            price={**self.pricing,**changes};auth={**self.auth,'budget_basis_sha256':meter.canonical_digest(price)}
            with self.assertRaises(ValueError):meter.create_r5_ledger(self.old,self.path,auth,price)
            self.assertFalse(self.path.exists())
        with self.assertRaises(ValueError):meter.create_r5_ledger(self.old,self.path,self.auth,{**self.pricing,'basis':'unapproved'})

    def test_ledger_location_and_live_lock_are_enforced(self):
        with self.assertRaises(ValueError):meter.create_r5_ledger(self.old,self.path.parent/'other.json',self.auth,self.pricing)
        with open(self.old.with_suffix('.lock'),'a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):self.create()
        self.assertFalse(self.path.exists())

    def test_prefix_limits_and_receipts_are_not_refillable(self):
        b=self.create();original=copy.deepcopy(b.state)
        for change in ['prefix','max','pricing','authorization']:
            state=copy.deepcopy(original)
            if change=='prefix':state['requests'][1]['http_status']=400
            elif change=='max':state['max_http_requests']=7
            elif change=='pricing':state['r5_receipt']['budget_basis']['exact_pricing_required']=True
            else:state['r5_receipt']['authorization_sha256']='0'*64
            with self.assertRaises(ValueError):meter.Budget(self.path,_state=state)
        with self.assertRaises(ValueError):b.admit({'image_count':1})

if __name__=='__main__':unittest.main()
