import {verifyDocumentBuildCandidate} from "./document-build-candidate.mjs";
// FEAT-164 local provenance. Immutable mode checks Git objects and actual build
// inputs independently. A source pin alone is not G2V or release qualification.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,lstatSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {verifyToolSearchBuildCandidate} from "./tool-search-build-candidate.mjs";
import {verifyInteractionToolsBuildCandidate} from "./interaction-tools-build-candidate.mjs";
import {verifyNativeToolsBuildCandidate} from "./native-tools-build-candidate.mjs";
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const contracts=path.resolve(desktop,"../yijie-contracts"),host=path.resolve(desktop,"../yijie-agent-host");
const hash=b=>createHash("sha256").update(b).digest("hex");
const commit="62070251d0da84ce4c5eba0c7b25d9a48e5d5929";
const lockFile="contracts/kimi-k31-host-build.candidate.json";
const imageLock="contracts/host-images-build.candidate.json";
function imageHostSnapshot(hostRoot, contractsRoot, hostCommit) {
 const pin = JSON.parse(readFileSync(path.join(hostRoot, "api/runtime-host-images.candidate.json")));
 assert.match(pin.source_commit, /^[a-f0-9]{40}$/);
 const lockPath = "compatibility/runtime-host-images/source.lock.json";
 const lock = execFileSync("git", ["-C", contractsRoot, "show", pin.source_commit + ":" + lockPath]);
 assert.equal(hash(lock), pin.source_lock_sha256);
 const {sources} = inputs(hostRoot, hostCommit);
 return {feature:"FEAT-168", mode:"immutable_local_candidate", release:false, host_commit:hostCommit,
   host_sources_sha256:hash(JSON.stringify(sources)), contracts_commit:pin.source_commit, runtime_lock_sha256:hash(lock)};
}
function inputs(hostRoot,ref){
 const git=(...args)=>execFileSync("git",["-C",hostRoot,...args],{encoding:"utf8",maxBuffer:16*1024*1024}).trim();
 if(ref){assert.match(ref,/^[a-f0-9]{40}$/);assert.equal(git("rev-parse",`${ref}^{commit}`),ref);}
 const paths=["cmd","internal","api","go.mod","go.sum","artifact-mcp/Cargo.toml","artifact-mcp/Cargo.lock","artifact-mcp/src","scripts/build-artifact-adapter.sh","scripts/artifact_build_output.py"];
 const names=[...new Set((ref?git("ls-tree","-r","--name-only",ref,"--",...paths):git("ls-files","-co","--exclude-standard","--",...paths)).split("\n"))].sort();
 const sources={};for(const name of names){assert(!path.isAbsolute(name)&&!name.split("/").includes(".."));if(ref){sources[name]=hash(execFileSync("git",["-C",hostRoot,"show",`${ref}:${name}`],{maxBuffer:16*1024*1024}));}else{assert(lstatSync(path.join(hostRoot,name)).isFile());sources[name]=hash(readFileSync(path.join(hostRoot,name)));}}
 return {base_commit:ref??git("rev-parse","HEAD"),sources};
}
function checkPins(desktopRoot,hostRoot){
 execFileSync("python3",["scripts/sync-kimi-k31-pro-contracts.py","--commit",commit,"--check"],{cwd:hostRoot,stdio:"pipe"});
 return Object.fromEntries(["chat-models-v2","runtime-kimi-k31-pro"].map(f=>[f,hash(readFileSync(path.join(desktopRoot,`contracts/${f}.candidate.json`)))]));
}
export function kimiCallSurfaces(env=process.env){
 const mode=env.YIJIE_KIMI_K31_CALL_SURFACES??"ordinary";
 const modes={ordinary:[false,false,false],market:[true,false,false],experts:[true,true,false],media:[true,true,true]};
 assert(Object.hasOwn(modes,mode),"Unknown FEAT-164 call surface profile");
 const [market,experts,media]=modes[mode];
 for(const [flag,expected] of [["YIJIE_MARKET_CONNECTORS_ENABLED",market],["YIJIE_EXPERTS_ENABLED",experts],["YIJIE_ARTIFACT_MEDIA_ENABLED",media]]) {
  assert([undefined,"false","true"].includes(env[flag]),"Invalid feature flag: "+flag);
  assert.equal(env[flag]==="true",expected,"Explicit call surface mismatch: "+flag);
 }
 const daily=env.YIJIE_FEAT164_DAILY==="true";
 assert([undefined,"false","true"].includes(env.YIJIE_FEAT164_DAILY),"Invalid daily selector");
 if(daily){
  assert.equal(mode,"media","Daily Kimi preserves the complete media surface");
  assert.equal(env.YIJIE_KIMI_K31_PRO_CANDIDATE,"true");
  assert.equal(env.YIJIE_FEAT155_SCHEDULED_DAILY,"true");
  assert.equal(env.YIJIE_FEAT155_SCHEDULED_CANDIDATE,"false");
  assert(env.YIJIE_FEAT164_QUALIFICATION!=="true","Daily identity cannot use qualification storage");
  assert(["false","true"].includes(env.VITE_YIJIE_WORKFLOW_ENABLED),"Daily workflow choice must be explicit");
 }else{
  assert(env.YIJIE_WORKFLOW_ENABLED!=="true"&&env.VITE_YIJIE_WORKFLOW_ENABLED!=="true","Workflow remains outside this candidate");
 }
 if(market)assert.equal(env.YIJIE_RUNTIME_PERMISSIONS_ENABLED,"true","Market requires original permission boundary");
 return {mode,market,experts,media};
}
function checkSurfaces(desktopRoot,contractsRoot,selection,env){
 for(const family of ["market-selection","market-host","experts"]){
  const lock=JSON.parse(readFileSync(path.join(desktopRoot,`contracts/${family}-v2.candidate.json`)));
  assert.equal(lock.source_commit,"64ed36dfb2c4df7645d969e0eaf1b3f3bb0a50c4");
 }
 for(const consumer of ["desktop","agent-host"])execFileSync(process.execPath,["scripts/sync-model-call-surfaces-v2.mjs",`--consumer=${consumer}`,"--check"],{cwd:contractsRoot,stdio:"pipe"});
 if(selection.market){
  for(const [family,consumers] of [["market-connectors",["desktop","agent-host","connectors"]],["market-provider",["desktop","agent-host","connectors"]],["market-broker",["agent-host","connectors"]]])for(const consumer of consumers)execFileSync(process.execPath,[`scripts/sync-${family}.mjs`,`--consumer=${consumer}`,"--check"],{cwd:contractsRoot,stdio:"pipe"});
  execFileSync(process.execPath,["scripts/feat164-market-catalog.mjs","--check"],{cwd:desktopRoot,stdio:"pipe"});
  execFileSync(process.execPath,["scripts/sync-web-retrieval.mjs","--consumer=connectors","--check"],{cwd:contractsRoot,stdio:"pipe"});
 }
 if(selection.experts)execFileSync(process.execPath,["scripts/sync-feat164-expert-resources.mjs","--check"],{cwd:desktopRoot,stdio:"pipe",env:{...process.env,...env,YIJIE_ENV:"local",YIJIE_LOCAL_PROFILE:"demo_fast",YIJIE_DESKTOP_CONTRACTS_DIR:contractsRoot}});
 if(selection.media)for(const consumer of ["host","desktop"])execFileSync(process.execPath,["scripts/generate-artifact-media.mjs","--check",`--consumer=${consumer}`],{cwd:contractsRoot,stdio:"pipe"});
}
export function verifyKimiK31BuildCandidate(desktopRoot,contractsRoot,hostRoot,env=process.env){
 assert(env.YIJIE_ENV==="local"&&env.YIJIE_LOCAL_PROFILE==="demo_fast"&&env.YIJIE_CHAT_MODELS_ENABLED==="true"&&env.YIJIE_KIMI_K31_PRO_CANDIDATE==="true","Explicit local candidate required");
 const selection=kimiCallSurfaces(env);
 checkSurfaces(desktopRoot,contractsRoot,selection,env);
 const planLock=JSON.parse(readFileSync(path.join(desktopRoot,"contracts/scheduled-plan-v2.candidate.json")));
 assert.equal(planLock.source_commit,"2dd214d6a702064edae78510c035442854bf9789");
 execFileSync(process.execPath,["scripts/sync-scheduled-plan-v2.mjs","--check"],{cwd:contractsRoot,stdio:"pipe"});
 execFileSync(process.execPath,["scripts/generate-scheduled-ipc-v2.mjs","--check"],{cwd:desktopRoot,stdio:"pipe"});
 const fixedDaily = env.YIJIE_DEVELOPMENT_CLIENT === "true" && env.YIJIE_FEAT164_DAILY === "true";
 if(env.YIJIE_FEAT171_DOCUMENT_RUNTIME === "true") return verifyDocumentBuildCandidate(desktopRoot,contractsRoot,hostRoot,env);
 if(env.YIJIE_FEAT169_NATIVE_TOOLS === "true") {
  checkPins(desktopRoot,hostRoot);
  if (env.YIJIE_FEAT170_TOOL_SEARCH_RUNTIME === "true") return verifyToolSearchBuildCandidate(desktopRoot,contractsRoot,hostRoot,env);
  return env.YIJIE_FEAT169_INTERACTION_TOOLS === "true" ? verifyInteractionToolsBuildCandidate(desktopRoot,contractsRoot,hostRoot,env) : verifyNativeToolsBuildCandidate(desktopRoot,contractsRoot,hostRoot,env);
 }
 if(fixedDaily || env.YIJIE_FEAT168_HOST_IMAGES==="true"){
  assert.equal(env.YIJIE_KIMI_K31_CALL_SURFACES,"media");
  if(fixedDaily) {
   assert(["true","false"].includes(env.YIJIE_FEAT168_DAILY_IMAGES));
   assert.equal(env.YIJIE_FEAT168_HOST_IMAGES,env.YIJIE_FEAT168_DAILY_IMAGES);
  } else assert.notEqual(env.YIJIE_FEAT164_DAILY,"true");
  checkPins(desktopRoot,hostRoot);
  const frozen=JSON.parse(readFileSync(path.join(desktopRoot,imageLock)));
  assert.deepEqual(frozen,imageHostSnapshot(hostRoot,contractsRoot,frozen.host_commit));
  const hostPin=readFileSync(path.join(hostRoot,"api/runtime-host-images.candidate.json"));
  assert.deepEqual(readFileSync(path.join(desktopRoot,"contracts/host-images-contracts.pin.json")),hostPin);
  if(env.YIJIE_FEAT168_HOST_IMAGES==="true") {
   execFileSync(process.execPath,["scripts/generate-runtime-host-images.mjs","--check","--pin="+frozen.contracts_commit],{cwd:contractsRoot});
  }
  const {sources}=inputs(hostRoot);
  assert.equal(hash(JSON.stringify(sources)),frozen.host_sources_sha256,"Host build inputs differ from their committed source");
  return sources;
 }
 const actual=JSON.parse(readFileSync(path.join(desktopRoot,lockFile)));
 assert.equal(actual.feature,"FEAT-164");assert(["local_worktree_candidate","immutable_local_candidate"].includes(actual.mode));assert.equal(actual.release,false);
 assert.equal(actual.contracts_commit,commit);
 assert.deepEqual(actual.contracts,checkPins(desktopRoot,hostRoot));
 if(actual.mode==="immutable_local_candidate")assert.deepEqual(actual.host,inputs(hostRoot,actual.host.base_commit),"Host committed source drift");
 assert.deepEqual(actual.host,inputs(hostRoot),"Host actual build source drift");
 execFileSync(process.execPath,["scripts/generate-runtime-kimi-k31-pro.mjs","--check"],{cwd:contractsRoot,stdio:"pipe"});
 return actual.host.sources;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args[0]==="--freeze-host-images"){
  assert.equal(args.length,1);
  const hostCommit=execFileSync("git",["-C",host,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
  const snapshot=imageHostSnapshot(host,contracts,hostCommit);
  assert.equal(hash(JSON.stringify(inputs(host).sources)),snapshot.host_sources_sha256);
  execFileSync(process.execPath,["scripts/generate-runtime-host-images.mjs","--check","--pin="+snapshot.contracts_commit],{cwd:contracts});
  writeFileSync(path.join(desktop,imageLock),JSON.stringify(snapshot,null,2)+"\n");
 }else if(args[0]==="--check-image-worker"){
  assert.equal(args.length,2);
  const dir = path.resolve(args[1]);
  assert.equal(path.dirname(dir),path.join(desktop,".local/feat168-images/worker"));
  assert.match(path.basename(dir),/^[0-9a-f]{64}$/);
  const m=JSON.parse(readFileSync(path.join(dir,"current.json")));
  assert.equal(m.schemaVersion,2);assert.equal(m.candidateOnly,true);
  assert.match(m.sha256,/^[0-9a-f]{64}$/);assert.equal(m.binary,path.join(dir,m.sha256,"yijie-mcp-worker"));
  assert(lstatSync(m.binary).isFile());assert.equal(hash(readFileSync(m.binary)),m.sha256);
 }else if(args[0]==="--freeze-commit"){
  assert.equal(args.length,2);
  writeFileSync(path.join(desktop,lockFile),JSON.stringify({schema_version:1,feature:"FEAT-164",mode:"immutable_local_candidate",release:false,contracts_commit:commit,contracts:checkPins(desktop,host),host:inputs(host,args[1])},null,2)+"\n");
  console.log("FEAT-164 committed Host inputs frozen; actual build checkout must independently match.");
 }else{
 assert(args.every(a=>a==="--freeze"));
 if(process.argv.includes("--freeze"))writeFileSync(path.join(desktop,lockFile),JSON.stringify({schema_version:1,feature:"FEAT-164",mode:"local_worktree_candidate",release:false,contracts_commit:commit,contracts:checkPins(desktop,host),host:inputs(host)},null,2)+"\n");
 verifyKimiK31BuildCandidate(desktop,contracts,host);
 console.log("FEAT-164 isolated draft build sources verified; not G2V or release qualification.");
 }
}
