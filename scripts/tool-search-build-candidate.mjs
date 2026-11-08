// FEAT-170 adds one exact Runtime selection to the existing development receipt.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyInteractionToolsBuildCandidate} from './interaction-tools-build-candidate.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=v=>createHash('sha256').update(v).digest('hex');
const name='contracts/tool-search-build.candidate.json';
function snapshot(desktop,contracts){
 execFileSync(process.execPath,['scripts/generate-runtime-tool-search.mjs','--check'],{cwd:contracts,stdio:'pipe'});
 const runtime=readFileSync(path.join(contracts,'compatibility/runtime-tool-search/source.lock.json'));
 assert.deepEqual(runtime,readFileSync(path.join(desktop,'contracts/runtime-tool-search.candidate.json')));
 return {schema_version:1,feature:'FEAT-170',mode:'local_worktree_candidate',release:false,
  runtime_lock_sha256:hash(runtime),base_build_sha256:hash(readFileSync(path.join(desktop,'contracts/interaction-tools-build.candidate.json')))};
}
export function verifyToolSearchBuildCandidate(desktop,contracts,host,env){
 assert.equal(env.YIJIE_FEAT170_TOOL_SEARCH_RUNTIME,'true');
 assert(['true','false'].includes(env.YIJIE_FEAT170_TOOL_SEARCH));
 const sources=verifyInteractionToolsBuildCandidate(desktop,contracts,host,env);
 assert.deepEqual(JSON.parse(readFileSync(path.join(desktop,name))),snapshot(desktop,contracts),'Tool-search candidate source changed');
 return sources;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 assert.deepEqual(process.argv.slice(2),['--freeze']);
 writeFileSync(path.join(root,name),JSON.stringify(snapshot(root,path.resolve(root,'../yijie-contracts')),null,2)+'\n');
 console.log('Tool-search local candidate receipt written; not live acceptance or a release.');
}
