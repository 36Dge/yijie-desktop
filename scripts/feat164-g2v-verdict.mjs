// Real-provider G2V verdict. Reads evidence only; never sends or retries HTTP.
import assert from "node:assert/strict";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {classifyFEAT164Observation} from "./feat164-verdict.mjs";

const fields=["sourcePinned","harnessQualified","controllerHealthy","platformReady",
  "productionObserved","answerVisible","answerExpected","persisted","reopened","noResend","normalCleanup"];
const model="kimi-k3.1-pro";
export function classifyFEAT164RealG2V(ledger,observation){
  assert(observation&&typeof observation==="object"&&!Array.isArray(observation));
  assert.deepEqual(Object.keys(observation).sort(),[...fields].sort(),"Closed UI observation required");
  for(const key of fields)assert(observation[key]===null||typeof observation[key]==="boolean");
  assert(ledger&&typeof ledger==="object"&&Array.isArray(ledger.requests));
  const prerequisite=classifyFEAT164Observation({sourcePinned:observation.sourcePinned,
    controllerHealthy:observation.controllerHealthy,platformReady:observation.platformReady,
    productionObserved:observation.productionObserved,modelMatched:true,persisted:true,reopened:true,normalCleanup:true});
  if(prerequisite.status!=="PASS")return {...prerequisite,failed_checks:["observation_prerequisites"]};
  if(observation.harnessQualified!==true)return {status:observation.harnessQualified===false?"FAIL":"DIAGNOSIS_REQUIRED",
    failure_class:observation.harnessQualified===false?"gate_failure":null,code:"harness_not_qualified",failed_checks:["harnessQualified"]};
  const request=ledger.requests[1]??{};
  const checks={
    approved_ledger:ledger.feature==="FEAT-164"&&ledger.schema_version===2&&ledger.limit_micro_cny===30_000_000&&
      ledger.max_http_requests===2&&ledger.resume_receipt?.authorization?.authorization_id==="FEAT-164-20261025-30CNY-ONE-HTTP",
    one_new_http:ledger.requests.length===2&&request.ordinal===2,
    preserved_old_reservation:ledger.requests[0]?.ordinal===1&&ledger.requests[0]?.status==="unknown_reserved"&&
      ledger.requests[0]?.reserved_micro_cny===14_188_544&&ledger.requests[0]?.charged_upper_micro_cny===undefined,
    requested_model:request.model===model&&request.effort==="max",
    http_success:request.http_status===200,
    response_model:request.response_model===model,
    completed:request.terminal==="response.completed"&&request.response_status==="completed"&&request.terminal_count===1,
    stream_complete:request.stream_complete===true&&request.forwarded_response_bytes>0&&/^[a-f0-9]{64}$/.test(request.forwarded_response_sha256??""),
    answer_present:request.output_text_present===true,
    settled_usage:request.status==="settled"&&Number.isInteger(request.usage?.input_tokens)&&request.usage.input_tokens>=0&&
      request.usage.input_tokens<=1_048_576&&Number.isInteger(request.usage?.output_tokens)&&
      request.usage.output_tokens>=0&&request.usage.output_tokens<=8192&&
      request.charged_upper_micro_cny===request.usage.input_tokens*13+request.usage.output_tokens*68,
    budget_closed:ledger.halted===true&&ledger.meter_state==="stopped_normally"&&
      Number.isInteger(ledger.charged_upper_micro_cny)&&ledger.charged_upper_micro_cny<=30_000_000,
    accounting_matches:ledger.charged_upper_micro_cny===14_188_544+request.charged_upper_micro_cny,
    answerVisible:observation.answerVisible,answerExpected:observation.answerExpected,
    persisted:observation.persisted,reopened:observation.reopened,noResend:observation.noResend,normalCleanup:observation.normalCleanup,
  };
  const failed=Object.entries(checks).filter(([,value])=>value===false).map(([key])=>key);
  const unknown=Object.entries(checks).filter(([,value])=>value!==true&&value!==false).map(([key])=>key);
  if(failed.length)return {status:"FAIL",failure_class:null,code:"real_g2v_expectations_not_met",failed_checks:failed};
  if(unknown.length)return {status:"DIAGNOSIS_REQUIRED",failure_class:null,code:"real_g2v_observation_incomplete",failed_checks:unknown};
  return {status:"PASS",failure_class:null,code:"real_answer_saved_reopened_and_cleaned",failed_checks:[]};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{
    const [ledgerFile,observationFile,...extra]=process.argv.slice(2);
    assert(ledgerFile&&observationFile&&extra.length===0);
    const ledger=JSON.parse(fs.readFileSync(ledgerFile,"utf8"));
    const raw=JSON.parse(fs.readFileSync(observationFile,"utf8"));
    const result=classifyFEAT164RealG2V(ledger,raw.observation??raw);
    console.log(JSON.stringify(result,null,2));
    process.exitCode=result.status==="PASS"?0:result.status==="FAIL"?1:2;
  }catch{
    console.error("Invalid FEAT-164 G2V evidence; no request was sent.");process.exitCode=2;
  }
}
