// Offline-only S3 matrix. Each exact selector must execute one test; no skip PASS.
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const [output,...extra]=process.argv.slice(2);assert(output && !extra.length,'Pass a new output directory');
mkdirSync(output,{recursive:false});
const tests=[['feat164_plan_retirement_before_dispatch',false],['feat164_s3_explicit_save_reauthorize_and_bound_target',false],['feat164_s3_paused_candidate_preserves_authority',true],['feat164_s3_schema_upgrade_and_replay',false],['feat164_s3_worker_starts_after_retirement',false]];
const results=[];
for(const [test,paused] of tests){
 const args=['test','--offline','--locked','--manifest-path','src-tauri/Cargo.toml','--lib','--features','kimi-k31-pro-candidate',`chat::schedules::model_retirement_tests::${test}`,'--','--exact','--nocapture'];
 const env={...process.env,YIJIE_ENV:'local',YIJIE_LOCAL_PROFILE:'demo_fast',YIJIE_CHAT_MODELS_ENABLED:'true',YIJIE_KIMI_K31_PRO_CANDIDATE:'true',YIJIE_KIMI_K31_EXECUTION_PAUSED:String(paused)};
 // No timeout/kill: tests own only ordinary temporary storage, with no child services.
 const run=spawnSync('cargo',args,{env,encoding:'utf8',maxBuffer:8*1024*1024});
 const log=(run.stdout??'')+(run.stderr??'');writeFileSync(path.join(output,test+'.log'),log);
 const pass=run.status===0 && /test result: ok\. 1 passed; 0 failed; 0 ignored;/.test(log);
 results.push({test,paused,command:['cargo',...args],exit_code:run.status,passed:pass});
 console.log(test+': '+(pass?'PASS':'FAIL'));
 if(!pass) break;
}
const result={feature:'FEAT-164',slice:'S3',source_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),real_model_http:0,app_platform:'NOT RUN',results,passed:results.length===tests.length&&results.every(r=>r.passed)};
writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
assert(result.passed,'S3 conformance failed; preserve logs, no automatic retries');
