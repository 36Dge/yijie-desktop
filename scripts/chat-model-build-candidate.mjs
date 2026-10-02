// FEAT-156 explicit local source candidate; never a release pin or commit claim.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const inputs=['cmd','internal','api','go.mod','go.sum'];
const digest=b=>createHash('sha256').update(b).digest('hex');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024*1024}).trim();
function snapshot(root){
 const files=[...new Set(git(root,'ls-files','-co','--exclude-standard','--',...inputs).split('\n'))].sort();
 return {base_commit:git(root,'rev-parse','HEAD'),repository:git(root,'remote','get-url','origin'),sources:Object.fromEntries(files.map(f=>{assert(!path.isAbsolute(f)&&!f.split('/').includes('..'));assert(lstatSync(path.join(root,f)).isFile());return [f,digest(readFileSync(path.join(root,f)))];}))};
}
export function verifyChatModelBuildCandidate(desktopRoot,contractsRoot,hostRoot){
 assert(process.env.YIJIE_ENV==='local'&&process.env.YIJIE_LOCAL_PROFILE==='demo_fast'&&process.env.YIJIE_CHAT_MODELS_ENABLED==='true','Model candidate is local-only');
 const actual=JSON.parse(readFileSync(path.join(desktopRoot,'contracts/chat-model-host-build.candidate.json')));
 assert.equal(actual.feature,'FEAT-156');assert.equal(actual.mode,'local_worktree_candidate');assert.equal(actual.release,false);
 if(JSON.stringify(actual.host)!==JSON.stringify(snapshot(hostRoot)))throw Error('Model Host source candidate drift; freeze a newly reviewed local snapshot before building.');
 for(const family of ['chat-models','scheduled-plan','scheduled-execution','scheduled-draft','scheduled-task-recovery','runtime-input-only','runtime-chat-models','native-turn-timing']){
  assert.equal(digest(readFileSync(path.join(desktopRoot,`contracts/${family}.candidate.json`))),actual.contracts[family],family);
  execFileSync(process.execPath,[`scripts/sync-${family}.mjs`,'--check'],{cwd:contractsRoot,stdio:'pipe'});
 }
 return actual.host.sources;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const hostRoot=path.resolve(desktop,'../yijie-agent-host'),contractsRoot=path.resolve(desktop,'../yijie-contracts');
 if(process.argv.includes('--freeze')){
  assert(process.env.YIJIE_ENV==='local'&&process.env.YIJIE_LOCAL_PROFILE==='demo_fast'&&process.env.YIJIE_CHAT_MODELS_ENABLED==='true');
  const contracts=Object.fromEntries(['chat-models','scheduled-plan','scheduled-execution','scheduled-draft','scheduled-task-recovery','runtime-input-only','runtime-chat-models','native-turn-timing'].map(f=>[f,digest(readFileSync(path.join(desktop,`contracts/${f}.candidate.json`)))]));
  writeFileSync(path.join(desktop,'contracts/chat-model-host-build.candidate.json'),JSON.stringify({schema_version:1,feature:'FEAT-156',mode:'local_worktree_candidate',release:false,host:snapshot(hostRoot),contracts},null,2)+'\n');
 }
 verifyChatModelBuildCandidate(desktop,contractsRoot,hostRoot);
 console.log('FEAT-156 local source candidate verified; release=false.');
}
