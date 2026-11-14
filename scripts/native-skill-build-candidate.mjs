// FEAT-174 exact local source closure; no tag, publication or release implied.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyHostCandidateBase} from './native-tools-build-candidate.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=b=>createHash('sha256').update(b).digest('hex');
function snapshot(desktop,contracts,host,base){
 execFileSync(process.execPath,['scripts/generate-runtime-skill-marketplace.mjs','--check'],{cwd:contracts,stdio:'pipe'});
 for(const consumer of ['host','desktop','skills'])execFileSync(process.execPath,['scripts/generate-skill-market-v2.mjs','--check','--consumer='+consumer],{cwd:contracts,stdio:'pipe'});
 for(const consumer of ['host','desktop'])execFileSync(process.execPath,['scripts/generate-submission-rejection.mjs','--check','--consumer='+consumer],{cwd:contracts,stdio:'pipe'});
 execFileSync(process.execPath,['scripts/sync-native-skill-resources.mjs','--check'],{cwd:desktop,stdio:'pipe'});
 const runtime=readFileSync(path.join(contracts,'compatibility/runtime-skill-marketplace/source.lock.json'));
 assert.deepEqual(runtime,readFileSync(path.join(desktop,'contracts/runtime-skill-marketplace.candidate.json')));
 const names=[...new Set(execFileSync('git',['-C',host,'ls-files','-co','--exclude-standard','--','cmd','internal','api','go.mod','go.sum','artifact-mcp/Cargo.toml','artifact-mcp/Cargo.lock','artifact-mcp/src','scripts/build-artifact-adapter.sh','scripts/artifact_build_output.py'],{encoding:'utf8'}).trim().split('\n'))].sort();
 const sources={};for(const name of names){assert(lstatSync(path.join(host,name)).isFile());sources[name]=sha(readFileSync(path.join(host,name)));}
 return {schema_version:1,feature:'FEAT-174',mode:'local_worktree_candidate',release:false,host_base_commit:verifyHostCandidateBase(host,base??execFileSync('git',['-C',host,'rev-parse','HEAD'],{encoding:'utf8'}).trim()),host_sources:sources,runtime_lock_sha256:sha(runtime),submission_rejection_sha256:sha(readFileSync(path.join(desktop,'contracts/submission-rejection.candidate.json'))),skill_contract_sha256:sha(readFileSync(path.join(desktop,'contracts/skill-market-v2.candidate.json'))),source_resources_sha256:sha(readFileSync(path.join(desktop,'contracts/native-skill-resources.candidate.json')))};
}
export function verifyNativeSkillBuildCandidate(desktop,contracts,host,env){
 assert.equal(env.YIJIE_ENV,'local');assert.equal(env.YIJIE_LOCAL_PROFILE,'demo_fast');assert.equal(env.YIJIE_FEAT174_NATIVE_SKILLS,'true');assert.equal(env.YIJIE_FEAT169_NATIVE_TOOLS,'true');
 const expected=JSON.parse(readFileSync(path.join(desktop,'contracts/native-skill-build.candidate.json')));
 assert.deepEqual(expected,snapshot(desktop,contracts,host,expected.host_base_commit),'native Skill source candidate changed');return expected.host_sources;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 assert.deepEqual(process.argv.slice(2),['--freeze']);
 writeFileSync(path.join(root,'contracts/native-skill-build.candidate.json'),JSON.stringify(snapshot(root,path.resolve(root,'../yijie-contracts'),path.resolve(root,'../yijie-agent-host')),null,2)+'\n');
 console.log('FEAT-174 local source closure frozen; no release or model acceptance.');
}
