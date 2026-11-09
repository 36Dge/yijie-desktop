// FEAT-171 local source closure. No commit/tag or release qualification implied.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyHostCandidateBase} from './native-tools-build-candidate.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=b=>createHash('sha256').update(b).digest('hex');
function snapshot(desktop,contracts,host,base){
 for(const script of ['generate-runtime-documents.mjs','generate-document-runtime.mjs']) execFileSync(process.execPath,['scripts/'+script,'--check'],{cwd:contracts,stdio:'pipe'});
 for(const consumer of ['host','desktop']) execFileSync(process.execPath,['scripts/generate-document-runtime.mjs','--check','--consumer='+consumer],{cwd:contracts,stdio:'pipe'});
 const runtime=readFileSync(path.join(contracts,'compatibility/runtime-documents/source.lock.json'));
 assert.deepEqual(runtime,readFileSync(path.join(desktop,'contracts/runtime-documents.candidate.json')));
 const names=[...new Set(execFileSync('git',['-C',host,'ls-files','-co','--exclude-standard','--','cmd','internal','api','go.mod','go.sum','artifact-mcp/Cargo.toml','artifact-mcp/Cargo.lock','artifact-mcp/src','scripts/build-artifact-adapter.sh','scripts/artifact_build_output.py'],{encoding:'utf8'}).trim().split('\n'))].sort();
 const sources={};for(const name of names){assert(lstatSync(path.join(host,name)).isFile());sources[name]=hash(readFileSync(path.join(host,name)));}
 return {schema_version:1,feature:'FEAT-171',mode:'local_worktree_candidate',release:false,
  host_base_commit:verifyHostCandidateBase(host,base??execFileSync('git',['-C',host,'rev-parse','HEAD'],{encoding:'utf8'}).trim()),host_sources:sources,
  runtime_lock_sha256:hash(runtime),document_contract_sha256:hash(readFileSync(path.join(desktop,'contracts/document-runtime.candidate.json'))),
  dependency_lock_sha256:hash(readFileSync(path.join(desktop,'document-runtime/dependencies.lock.json')))};
}
export function verifyDocumentBuildCandidate(desktop,contracts,host,env){
 assert.equal(env.YIJIE_ENV,'local');assert.equal(env.YIJIE_LOCAL_PROFILE,'demo_fast');
 assert.equal(env.YIJIE_FEAT171_DOCUMENT_RUNTIME,'true');assert.equal(env.YIJIE_FEAT169_INTERACTION_TOOLS,'true');
 const expected=JSON.parse(readFileSync(path.join(desktop,'contracts/document-build.candidate.json')));
 assert.deepEqual(expected,snapshot(desktop,contracts,host,expected.host_base_commit),'document source candidate changed');
 return expected.host_sources;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 assert.deepEqual(process.argv.slice(2),['--freeze']);
 writeFileSync(path.join(root,'contracts/document-build.candidate.json'),JSON.stringify(snapshot(root,path.resolve(root,'../yijie-contracts'),path.resolve(root,'../yijie-agent-host')),null,2)+'\n');
 console.log('FEAT-171 local source closure frozen; no release or model acceptance.');
}
