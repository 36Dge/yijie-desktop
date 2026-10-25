import test from "node:test";
import assert from "node:assert/strict";
import {classifyFEAT164RealG2V as verdict} from "./feat164-g2v-verdict.mjs";
const observation=Object.fromEntries(["sourcePinned","harnessQualified","controllerHealthy","platformReady",
  "productionObserved","answerVisible","answerExpected","persisted","reopened","noResend","normalCleanup"].map(k=>[k,true]));
function ledger(){return {feature:"FEAT-164",schema_version:2,limit_micro_cny:30_000_000,max_http_requests:2,
  resume_receipt:{authorization:{authorization_id:"FEAT-164-20261025-30CNY-ONE-HTTP"}},halted:true,meter_state:"stopped_normally",
  charged_upper_micro_cny:14_188_544+19800,requests:[{ordinal:1,status:"unknown_reserved",reserved_micro_cny:14_188_544},
    {ordinal:2,model:"kimi-k3.1-pro",effort:"max",http_status:200,response_model:"kimi-k3.1-pro",terminal:"response.completed",
      response_status:"completed",terminal_count:1,stream_complete:true,output_text_present:true,status:"settled",
      usage:{input_tokens:1000,output_tokens:100},charged_upper_micro_cny:19800,forwarded_response_bytes:100,
      forwarded_response_sha256:"a".repeat(64)}]};}
test("real G2V requires provider success plus visible preserved answer and cleanup",()=>{
  assert.equal(verdict(ledger(),observation).status,"PASS");
  for(const changes of [{http_status:400},{response_model:"MiniMax-M3"},{terminal:"response.incomplete",response_status:"incomplete"},
    {terminal:"response.failed",response_status:"failed"},{output_text_present:false},{usage:null},{terminal_count:2},
    {stream_complete:false},{status:"unknown_reserved"}]){
    const value=ledger();Object.assign(value.requests[1],changes);assert.equal(verdict(value,observation).status,"FAIL");
  }
});
test("saved failure and replayed history cannot qualify as a real successful answer",()=>{
  for(const field of ["answerVisible","answerExpected","persisted","reopened","noResend","normalCleanup"])
    assert.equal(verdict(ledger(),{...observation,[field]:false}).status,"FAIL");
  assert.equal(verdict(ledger(),{...observation,answerExpected:null}).status,"DIAGNOSIS_REQUIRED");
  const value=ledger();value.requests.push({...value.requests[1],ordinal:3});assert.equal(verdict(value,observation).status,"FAIL");
});
test("current source, harness and observation prerequisites cannot be bypassed",()=>{
  for(const field of ["sourcePinned","harnessQualified","controllerHealthy","platformReady"])
    assert.equal(verdict(ledger(),{...observation,[field]:false}).status,"FAIL");
  assert.equal(verdict(ledger(),{...observation,productionObserved:null}).status,"DIAGNOSIS_REQUIRED");
  assert.throws(()=>verdict(ledger(),{...observation,answerText:"ordinary extra field"}));
  const value=ledger();value.limit_micro_cny=40_000_000;assert.equal(verdict(value,observation).status,"FAIL");
});
