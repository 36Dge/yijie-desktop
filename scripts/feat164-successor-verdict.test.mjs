import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {classifyFEAT164SuccessorG2V as verdict} from './feat164-successor-verdict.mjs';
const observation=Object.fromEntries(['sourcePinned','harnessQualified','controllerHealthy','platformReady',
  'productionObserved','answerVisible','answerExpected','persisted','reopened','noResend','normalCleanup'].map(k=>[k,true]));
// The actual Python writer produces a temporary ledger for the JS reader.
const code=`import sys,tempfile,json
from pathlib import Path
sys.path.insert(0,'scripts')
from feat164_successor_meter_test import successor_fixture,settle_success,meter
with tempfile.TemporaryDirectory() as p:
 old,new,a=successor_fixture(Path(p));meter.create_successor_ledger(old,new,a);b=meter.Budget(new)
 row=b.admit({'image_count':0,'model':meter.MODEL,'effort':'max'});settle_success(b,row)
 b.state['meter_state']='stopped_normally';b.save();print(json.dumps(b.state))
`;
const fixture=JSON.parse(execFileSync('python3',['-c',code],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
test('exact Python successor and Unicode receipt qualify only the new successful observation',()=>{
 assert.equal(verdict(fixture,observation).status,'PASS');
 for(const field of ['answerVisible','answerExpected','persisted','reopened','noResend','normalCleanup','harnessQualified'])
  assert.notEqual(verdict(fixture,{...observation,[field]:false}).status,'PASS');
 assert.throws(()=>verdict(fixture,{...observation,answerText:'not retained'}));
});
test('old success cannot substitute for missing or unsuccessful new HTTP',()=>{
 const empty=structuredClone(fixture);empty.requests=empty.requests.slice(0,2);empty.charged_upper_micro_cny=empty.successor_receipt.predecessor_state.charged_upper_micro_cny;
 assert.equal(verdict(empty,observation).status,'FAIL');
 for(const change of [{http_status:400},{status:'unknown_reserved'},{terminal:'response.failed'},
   {stream_complete:false},{response_model:'MiniMax-M3'},{image_count:1},{output_text_present:false},{usage:null}]){
  const value=structuredClone(fixture);Object.assign(value.requests[2],change);assert.equal(verdict(value,observation).status,'FAIL');
 }
});
test('prefix, receipt, cap, aggregate charge and extra request drift fail closed',()=>{
 for(const change of ['prefix','receipt','cap','charge','extra']){
  const value=structuredClone(fixture);
  if(change==='prefix')value.requests[0].reserved_micro_cny=0;
  if(change==='receipt')value.successor_receipt.authorization.additional_http_requests=4;
  if(change==='cap')value.max_http_requests=6;
  if(change==='charge')value.charged_upper_micro_cny-=1;
  if(change==='extra')value.requests.push(...[4,5,6].map(ordinal=>({...value.requests[2],ordinal})));
  assert.equal(verdict(value,observation).status,'FAIL',change);
 }
});
