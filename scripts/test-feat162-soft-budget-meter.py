import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('soft',Path(__file__).with_name('feat162-soft-budget-meter.py'))
soft=importlib.util.module_from_spec(spec);spec.loader.exec_module(soft)

class SoftBudgetTests(unittest.TestCase):
    def make(self, root):
        receipt=Path(root)/'ordinary-receipt.json';receipt.write_text('{"fixture":"ordinary receipt metadata, not App evidence"}')
        plan={'schema_version':3,'feature':'FEAT-162','paid_authorized':True,'activation_qualified':True,
              'budget_policy':'soft_stop_after_observation','soft_threshold_micro_cny':20_000_000,
              'allow_inflight_overshoot':True,'stop_mode':'native_ui','native_ui_stop_verified':True,
              'model_config_sha256':'a'*64,'authorization_evidence_sha256':'b'*64,
              'artifact_receipt_file':str(receipt),'artifact_receipt_sha256':soft.hashlib.sha256(receipt.read_bytes()).hexdigest()}
        return soft.Budget(Path(root)/'new-ledger.json',plan)

    def test_live_policy_needs_no_native_or_output_hard_bound(self):
        with tempfile.TemporaryDirectory() as root:
            b=self.make(root);b.arm();b.begin_case('E1')
            row=b.admit({'model_config_sha256':'a'*64,'max_output_tokens':None})
            self.assertFalse(row['supplier_http_started'])
            self.assertEqual(row['reserve_kind'],'estimate_only')
            self.assertEqual(row['reserved_micro_cny'],1_000_000)

    def test_request_may_cross_twenty_then_no_new_request(self):
        with tempfile.TemporaryDirectory() as root:
            b=self.make(root);b.carried_cost=19_800_000;b.arm();b.begin_case('E1')
            row=b.admit({'model_config_sha256':'a'*64,'max_output_tokens':None})
            self.assertGreater(b.observed_total(),20_000_000)
            b.settle(row,{'usage':{'input_tokens':10000,'output_tokens':10000},'terminal_count':1,
                          'stream_complete':True,'response_model':soft.legacy.shared.MODEL,
                          'terminal':'response.completed','response_status':'completed','http_status':200})
            self.assertTrue(b.state['halted'])
            self.assertEqual(b.state['stop_reason'],'soft_budget_reached_after_request')
            self.assertEqual(row['status'],'settled')
            with self.assertRaises(ValueError):b.admit({'model_config_sha256':'a'*64})

    def test_unknown_usage_keeps_estimate_and_stops(self):
        with tempfile.TemporaryDirectory() as root:
            b=self.make(root);b.arm();b.begin_case('E1')
            row=b.admit({'model_config_sha256':'a'*64});b.settle(row,{})
            self.assertEqual(row['status'],'unknown_reserved');self.assertEqual(b.state['model_upper_micro_cny'],1_000_000)
            self.assertTrue(b.state['halted'])

    def test_different_ledger_policy_cannot_reuse_existing_file(self):
        with tempfile.TemporaryDirectory() as root:
            b=self.make(root);b.arm()
            old=Path(root)/'new-ledger.json';data=json.loads(old.read_text());data['authorization']='FEAT-162-basic-pro-v2';old.write_text(json.dumps(data))
            with self.assertRaises(ValueError):soft.Budget(old,b.plan)
            self.assertEqual(json.loads(old.read_text())['authorization'],'FEAT-162-basic-pro-v2')

    def test_original_request_and_tools_remain_unchanged(self):
        body={'model':soft.legacy.shared.MODEL,'stream':True,'input':[],
              'tools':[{'type':'web_search'},{'type':'function','name':'ordinary_tool'}]}
        payload=json.dumps(body).encode();out,meta=soft.v2.prepare(payload)
        self.assertEqual(out,payload);self.assertIsNone(meta['max_output_tokens']);self.assertIn('web_search',meta['declared_tools'])

    def test_concurrent_second_request_is_rejected_without_http(self):
        with tempfile.TemporaryDirectory() as root:
            b=self.make(root);b.arm();b.begin_case('E1');b.admit({'model_config_sha256':'a'*64})
            with self.assertRaises(ValueError):b.admit({'model_config_sha256':'a'*64})
            self.assertEqual(len(b.state['requests']),1)
            self.assertFalse(b.state['requests'][0]['supplier_http_started'])

if __name__=='__main__':unittest.main()
