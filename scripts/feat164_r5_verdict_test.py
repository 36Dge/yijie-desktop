"""Normal oracle inputs; no provider or application state changes."""
import copy
import unittest
import feat164_r5_meter_test as fixture
meter, settle_success = fixture.meter, fixture.settle_success
from feat164_r5_verdict import REQUIRED, evaluate

class R5Verdict(unittest.TestCase):
    def setUp(self):fixture.R5Controls.setUp(self)
    def tearDown(self):fixture.R5Controls.tearDown(self)
    def create(self):return fixture.R5Controls.create(self)
    # Reuse only fixture construction, not the accounting test methods.
    def fixture(self):
        b=self.create();row=b.admit({'image_count':0});settle_success(b,row);b.state['meter_state']='stopped_normally'
        observation={name:True for name in REQUIRED};observation.update(runtime_sha256=meter.R5_BINARY_SHA256,app_sha256=meter.R5_APP_SHA256)
        return b.state,observation
    def test_complete_real_observation_is_required(self):
        ledger,observation=self.fixture();self.assertEqual(evaluate(ledger,observation)['status'],'PASS')
        for name in REQUIRED:
            self.assertEqual(evaluate(ledger,{**observation,name:False})['status'],'FAIL',name)
    def test_source_and_incomplete_response_fail(self):
        ledger,observation=self.fixture()
        self.assertEqual(evaluate(ledger,{**observation,'runtime_sha256':'0'*64})['status'],'FAIL')
        for key,value in [('terminal','response.incomplete'),('output_text_present',False),('status','unknown_reserved')]:
            bad=copy.deepcopy(ledger);bad['requests'][5][key]=value
            self.assertEqual(evaluate(bad,observation)['status'],'FAIL')
