// Private schema3 evidence reader. Never authorizes, sends, retries or edits a ledger.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {classifyFEAT164RealG2V} from './feat164-g2v-verdict.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const ascii=s=>s.replace(/[\u0080-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
const digest=v=>hash(ascii(JSON.stringify(sorted(v))));
const charge=r=>r.charged_upper_micro_cny??r.reserved_micro_cny;
const validCharge=n=>Number.isSafeInteger(n)&&n>=0;
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const authKeys=['schema_version','feature','authorization_id','approved_by','approved_on','approval_source',
  'previous_ledger_sha256','limit_micro_cny','additional_http_requests','preserve_unknown_reservations',
  'failure_policy','scope','successor_ledger_name'].sort();
export function classifyFEAT164SuccessorG2V(ledger,observation){
  assert(ledger&&Array.isArray(ledger.requests));
  const receipt=ledger.successor_receipt??{},auth=receipt.authorization??{},prior=receipt.predecessor_state;
  assert(prior?.schema_version===2&&Array.isArray(prior.requests),'Exact schema2 predecessor required');
  const priorVerdict=classifyFEAT164RealG2V(prior,observation);
  if(priorVerdict.status!=='PASS')return priorVerdict;
  const rows=ledger.requests,added=rows.slice(2);
  const checks={
    approved_ledger:ledger.feature==='FEAT-164'&&ledger.schema_version===3&&ledger.limit_micro_cny===30_000_000&&ledger.max_http_requests===5,
    authorization_shape:JSON.stringify(Object.keys(auth).sort())===JSON.stringify(authKeys),
    authorization:auth.schema_version===1&&auth.feature==='FEAT-164'&&auth.authorization_id==='FEAT-164-20261026-30CNY-THREE-HTTP'&&
      auth.approved_on==='2026-10-26'&&auth.approval_source==='current-user-confirmation-2026-10-26-plus-two'&&
      typeof auth.approved_by==='string'&&auth.approved_by.trim().length>0&&auth.approved_by.length<=128&&hex(auth.previous_ledger_sha256)&&
      auth.limit_micro_cny===30_000_000&&auth.additional_http_requests===3&&auth.preserve_unknown_reservations===true&&
      auth.failure_policy==='stop'&&auth.scope==='bounded_text_g2v_successor'&&auth.successor_ledger_name==='g2v-real-budget-ledger-r3.json',
    authorization_digest:receipt.authorization_sha256===digest(auth),
    exact_predecessor:typeof receipt.predecessor_json==='string'&&receipt.predecessor_json.length<=256*1024&&
      hash(receipt.predecessor_json)===auth.previous_ledger_sha256&&digest(JSON.parse(receipt.predecessor_json))===digest(prior),
    preserved_prefix:receipt.base_request_count===2&&prior.requests.length===2&&
      receipt.predecessor_state_sha256===digest(prior)&&digest(rows.slice(0,2))===digest(prior.requests)&&
      receipt.base_requests_sha256===digest(prior.requests),
    new_http_count:added.length>=1&&added.length<=3&&rows.every((r,i)=>r.ordinal===i+1),
    budget_closed:ledger.meter_state==='stopped_normally'&&validCharge(ledger.charged_upper_micro_cny)&&ledger.charged_upper_micro_cny<=30_000_000,
    accounting_matches:rows.every(r=>validCharge(charge(r)))&&rows.reduce((a,r)=>a+charge(r),0)===ledger.charged_upper_micro_cny,
  };
  for(const r of added){
    const usage=r.usage??{};
    checks['request_'+r.ordinal]=r.model==='kimi-k3.1-pro'&&r.effort==='max'&&r.image_count===0&&r.http_status===200&&
      r.response_model==='kimi-k3.1-pro'&&r.terminal==='response.completed'&&r.response_status==='completed'&&r.terminal_count===1&&
      r.stream_complete===true&&r.forwarded_response_bytes>0&&hex(r.forwarded_response_sha256)&&r.output_text_present===true&&
      r.status==='settled'&&validCharge(usage.input_tokens)&&usage.input_tokens<=1_048_576&&validCharge(usage.output_tokens)&&usage.output_tokens<=8192&&
      r.charged_upper_micro_cny===usage.input_tokens*13+usage.output_tokens*68&&r.reserved_micro_cny===14_188_544;
  }
  const failed=Object.entries(checks).filter(([,v])=>v!==true).map(([k])=>k);
  return {status:failed.length?'FAIL':'PASS',failure_class:null,code:failed.length?'successor_g2v_expectations_not_met':'successor_answer_saved_reopened_and_cleaned',failed_checks:failed,new_http_requests:added.length};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{
    const [ledgerFile,observationFile,...rest]=process.argv.slice(2);assert(ledgerFile&&observationFile&&!rest.length);
    const raw=JSON.parse(fs.readFileSync(observationFile,'utf8'));
    const result=classifyFEAT164SuccessorG2V(JSON.parse(fs.readFileSync(ledgerFile,'utf8')),raw.observation??raw);
    console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='PASS'?0:result.status==='FAIL'?1:2;
  }catch{console.error('Invalid successor G2V evidence; no request was sent.');process.exitCode=2;}
}
