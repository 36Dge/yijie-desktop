// FEAT-156 explicit local source candidate; never a release pin or commit claim.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyKimiK31BuildCandidate } from './kimi-k31-build-candidate.mjs';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const inputs=['cmd','internal','api','go.mod','go.sum'];
const modelFamilies=['chat-models','scheduled-plan','scheduled-execution','scheduled-draft','scheduled-task-recovery','runtime-input-only','runtime-chat-models','native-turn-timing'];
const expertFamilies=['market-connectors','market-host','market-provider','market-selection','market-catalog','experts'];
const expertSourceLocks=['experts','market-connectors','market-host','market-provider','market-selection','market-broker-control'];
const digest=b=>createHash('sha256').update(b).digest('hex');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024*1024}).trim();
export function chatModelBuildCandidateSelection(environment=process.env){
 assert(environment.YIJIE_ENV==='local'&&environment.YIJIE_LOCAL_PROFILE==='demo_fast'&&environment.YIJIE_CHAT_MODELS_ENABLED==='true','Model candidate is local-only');
 assert([undefined,'','false','true'].includes(environment.YIJIE_EXPERTS_ENABLED),'Invalid expert candidate selection');
 if(environment.YIJIE_FEAT164_QUALIFICATION==='true'){
  assert(environment.YIJIE_EXPERTS_ENABLED!=='true' && environment.YIJIE_MARKET_CONNECTORS_ENABLED!=='true' && environment.YIJIE_ARTIFACT_MEDIA_ENABLED!=='true','Legacy qualification is ordinary only');
  return {feature:'FEAT-156',file:'feat164-legacy-host-build.candidate.json'};
 }
 if(environment.YIJIE_EXPERTS_ENABLED==='true'){
  assert(environment.YIJIE_MARKET_CONNECTORS_ENABLED==='true'&&environment.YIJIE_RUNTIME_PERMISSIONS_ENABLED==='true','Expert candidate requires the existing model, permission and market families');
  return environment.YIJIE_ARTIFACT_MEDIA_ENABLED==='true' ? {feature:'FEAT-159',file:'artifact-media-host-build.candidate.json'} : {feature:'FEAT-158',file:'experts-host-build.candidate.json'};
 }
 return environment.YIJIE_ARTIFACT_MEDIA_ENABLED==='true' ? {feature:'FEAT-159',file:'artifact-media-host-build.candidate.json'} : {feature:'FEAT-156',file:'chat-model-host-build.candidate.json'};
}
function snapshot(root,media=false){
 const files=[...new Set(git(root,'ls-files','-co','--exclude-standard','--',...inputs,...(media?['artifact-mcp/Cargo.toml','artifact-mcp/Cargo.lock','artifact-mcp/src','scripts/build-artifact-adapter.sh','scripts/artifact_build_output.py']:[])).split('\n'))].sort();
 return {base_commit:git(root,'rev-parse','HEAD'),repository:git(root,'remote','get-url','origin'),sources:Object.fromEntries(files.map(f=>{assert(!path.isAbsolute(f)&&!f.split('/').includes('..'));assert(lstatSync(path.join(root,f)).isFile());return [f,digest(readFileSync(path.join(root,f)))];}))};
}
function candidateContracts(desktopRoot,expert){
 const files=modelFamilies.map(f=>[f,`${f}.candidate.json`]);
 files.push(['native-process','native-process.candidate.json']);
 if(expert){
  files.push(...expertFamilies.map(f=>[f,`${f}.candidate.json`]));
  files.push(['experts-assets','experts-assets.candidate.json'],['runtime-permissions','runtime-permissions.lock.json'],['desktop-skill-bundle-local','desktop-skill-bundle-local.lock.json']);
 }
 return Object.fromEntries(files.map(([key,file])=>[key,digest(readFileSync(path.join(desktopRoot,'contracts',file)))]));
}
function expertAuthority(contractsRoot){
 return Object.fromEntries(expertSourceLocks.map(f=>[f,digest(readFileSync(path.join(contractsRoot,`compatibility/${f}/source.lock.json`)))]));
}
function verifyConsumers(desktopRoot,contractsRoot,expert){
 execFileSync(process.execPath,['scripts/generate-native-process.mjs','--check'],{cwd:contractsRoot,stdio:'pipe'});
 execFileSync(process.execPath,['scripts/sync-native-process.mjs','--candidate','--check'],{cwd:contractsRoot,stdio:'pipe'});
 for(const family of modelFamilies){
  execFileSync(process.execPath,[`scripts/sync-${family}.mjs`,'--check'],{cwd:contractsRoot,stdio:'pipe'});
 }
 if(!expert)return;
 for(const [family,consumers] of [
  ['market-connectors',['desktop','agent-host','connectors']],
  ['market-host',['desktop','agent-host']],
  ['market-provider',['desktop','agent-host','connectors']],
  ['market-broker',['agent-host','connectors']],
  ['market-selection',['desktop']],
  ['experts',['desktop','agent-host','skills']],
 ])for(const consumer of consumers){
  execFileSync(process.execPath,[`scripts/sync-${family}.mjs`,`--consumer=${consumer}`,'--check'],{cwd:contractsRoot,stdio:'pipe'});
 }
 // The source-owned asset validator checks both producer bytes and the separate
 // packaged resource slot. Check mode never installs or rebuilds resources.
 execFileSync(process.execPath,['scripts/sync-market-catalog.mjs','--check'],{cwd:desktopRoot,stdio:'pipe'});
 execFileSync(process.execPath,['scripts/sync-desktop-expert-resources.mjs','--check'],{cwd:desktopRoot,stdio:'pipe',env:{...process.env,YIJIE_ENV:'local',YIJIE_LOCAL_PROFILE:'demo_fast',YIJIE_DESKTOP_CONTRACTS_DIR:contractsRoot}});
}

function verifyArtifactMedia(desktopRoot,contractsRoot,record){
 assert.equal(record.artifact_media,digest(readFileSync(path.join(desktopRoot,'contracts/artifact-media.candidate.json'))),'Artifact media pin drift');
 for(const consumer of ['host','desktop'])execFileSync(process.execPath,['scripts/generate-artifact-media.mjs','--check',`--consumer=${consumer}`],{cwd:contractsRoot,stdio:'pipe'});
}

export function verifyChatModelBuildCandidate(desktopRoot,contractsRoot,hostRoot,environment=process.env){
 if(environment.YIJIE_KIMI_K31_PRO_CANDIDATE==='true')return verifyKimiK31BuildCandidate(desktopRoot,contractsRoot,hostRoot,environment);
 const selected=chatModelBuildCandidateSelection(environment),expert=environment.YIJIE_EXPERTS_ENABLED==='true',media=selected.feature==='FEAT-159';
 const actual=JSON.parse(readFileSync(path.join(desktopRoot,'contracts',selected.file)));
 assert.equal(actual.schema_version,1);assert.equal(actual.feature,selected.feature);assert.equal(actual.mode,'local_worktree_candidate');assert.equal(actual.release,false);
 if(JSON.stringify(actual.host)!==JSON.stringify(snapshot(hostRoot,media)))throw Error('Model Host source candidate drift; freeze a newly reviewed local snapshot before building.');
 assert.deepEqual(actual.contracts,candidateContracts(desktopRoot,expert),'Candidate contract pin drift');
 if(expert)assert.deepEqual(actual.contracts_source_locks,expertAuthority(contractsRoot),'Expert source authority drift');
 verifyConsumers(desktopRoot,contractsRoot,expert);
 if(media)verifyArtifactMedia(desktopRoot,contractsRoot,actual);
 return actual.host.sources;
}
export function freezeChatModelBuildCandidate(desktopRoot,contractsRoot,hostRoot,environment=process.env){
 const selected=chatModelBuildCandidateSelection(environment),expert=environment.YIJIE_EXPERTS_ENABLED==='true',media=selected.feature==='FEAT-159';
 // An explicit freeze records reviewed implementation bytes only after all
 // generated projections and resource evidence pass their existing checks.
 verifyConsumers(desktopRoot,contractsRoot,expert);
 const record={schema_version:1,feature:selected.feature,mode:'local_worktree_candidate',release:false,host:snapshot(hostRoot,media),contracts:candidateContracts(desktopRoot,expert)};
 if(media)record.artifact_media=digest(readFileSync(path.join(desktopRoot,'contracts/artifact-media.candidate.json')));
 if(media)verifyArtifactMedia(desktopRoot,contractsRoot,record);
 if(expert)record.contracts_source_locks=expertAuthority(contractsRoot);
 writeFileSync(path.join(desktopRoot,'contracts',selected.file),JSON.stringify(record,null,2)+'\n');
 return selected;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const hostRoot=path.resolve(desktop,'../yijie-agent-host'),contractsRoot=path.resolve(desktop,'../yijie-contracts');
 assert(process.argv.slice(2).every(argument=>argument==='--freeze'),'Expected only --freeze');
 if(process.argv.includes('--freeze')){
  freezeChatModelBuildCandidate(desktop,contractsRoot,hostRoot);
 }
 verifyChatModelBuildCandidate(desktop,contractsRoot,hostRoot);
 console.log(`${chatModelBuildCandidateSelection().feature} local source candidate verified; release=false.`);
}
