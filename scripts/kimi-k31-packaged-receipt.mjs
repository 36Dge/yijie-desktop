// FEAT-164 local worktree provenance, not an immutable source/G2V/release receipt.
// Reopen checks the same canonical bundle and inputs without rebuilding them.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {lstat,readdir,readFile,writeFile,rename,realpath} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {workerBuildInputs} from "./expert-packaged-receipt.mjs";
import {kimiCallSurfaces} from "./kimi-k31-build-candidate.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const hash=v=>createHash("sha256").update(v).digest("hex");
const qualification=process.env.YIJIE_FEAT164_QUALIFICATION==="true";
const daily=process.env.YIJIE_FEAT164_DAILY==="true";
const primaryGeneration=process.env.YIJIE_FEAT164_PRIMARY_GENERATION;
assert(!primaryGeneration || daily,"Primary requires the daily profile");
const primary=primaryGeneration?JSON.parse(execFileSync("python3",["-B",path.join(root,"scripts/feat164_primary.py"),"layout","--generation",primaryGeneration],{encoding:"utf8"})):null;
assert(!(daily&&qualification),"Daily and qualification receipts cannot be mixed");
const runtimeRoot=primary?path.relative(root,primary.output_root):daily?".local/feat164-daily":qualification?".local/feat164-qualification":".local/feat164-kimi-k31";
const receipt=primary?.receipt??path.join(root,runtimeRoot,"packaged-launch-receipt.json");
const bundleName=daily?"易界 AI.app":qualification?"易界 AI FEAT-164 验收.app":"易界 AI FEAT-164.app";
const identifier=daily?"com.yijie.ai":qualification?"com.yijie.ai.feat164-qualification-v1":"com.yijie.ai.feat164-kimi-k31-r1";
async function fileRecord(file){
 const stat=await lstat(file);assert(stat.isFile(),"Regular file required");
 const digest=createHash("sha256");for await(const bytes of createReadStream(file))digest.update(bytes);
 return {sha256:digest.digest("hex"),bytes:stat.size,mode:stat.mode&0o777};
}
async function inputs(){
 assert(process.env.YIJIE_KIMI_K31_PRO_CANDIDATE==="true" || (qualification && process.env.YIJIE_KIMI_K31_PRO_CANDIDATE==="false"));
 assert(!process.env.TAURI_CONFIG,"Ambient Tauri configuration is unsupported");
 const names=execFileSync("git",["-C",root,"ls-files","-co","--exclude-standard","-z","--","src","src-tauri","scripts","contracts","public","patches","tools","sidecars","package.json","pnpm-lock.yaml","pnpm-workspace.yaml","rust-toolchain.toml","index.html","vite.config.*","tsconfig*.json",".cargo",".npmrc",".gitignore",".gitattributes"],{encoding:"utf8",maxBuffer:32*1024*1024}).split("\0").filter(Boolean);
 for(const name of [".env",".env.local",".env.production",".env.production.local"]){try{await lstat(path.join(root,name));names.push(name);}catch(error){if(error.code!=="ENOENT")throw error;}}
 const sources={};for(const name of [...new Set(names)].sort())sources[name]=await fileRecord(path.join(root,name));
 const keys=[...new Set([...(daily?["YIJIE_FEAT164_DAILY","YIJIE_FEAT155_SCHEDULED_DAILY","YIJIE_FEAT155_SCHEDULED_CANDIDATE","YIJIE_KIMI_K31_ALLOW_MANAGED_PREDECESSOR"]:[]),"YIJIE_FEAT164_QUALIFICATION","YIJIE_KIMI_K31_PRO_CANDIDATE","YIJIE_KIMI_K31_CALL_SURFACES","YIJIE_MARKET_CONNECTORS_ENABLED","YIJIE_EXPERTS_ENABLED","YIJIE_ARTIFACT_MEDIA_ENABLED","YIJIE_RUNTIME_PERMISSIONS_ENABLED","YIJIE_MARKET_PROVIDER_ONLY","YIJIE_PERMISSION_VERIFICATION_BASE_URL","NODE_ENV","NODE_OPTIONS","CC","CXX","CFLAGS","CXXFLAGS","LDFLAGS","SDKROOT","MACOSX_DEPLOYMENT_TARGET","PKG_CONFIG_PATH",...Object.keys(process.env).filter(key=>/^(VITE_|TAURI_|CARGO_|RUST)/.test(key))])].sort();
 const environment=Object.fromEntries(keys.map(key=>[key,hash(JSON.stringify(process.env[key]??null))]));
 return {sources,environment,...(kimiCallSurfaces().market?{workerSources:await workerBuildInputs()}: {})};
}
async function tree(directory){
 assert((await lstat(directory)).isDirectory());const result={};
 async function visit(base){for(const entry of (await readdir(base,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(base,entry.name);if(entry.isDirectory())await visit(file);else result[path.relative(directory,file)]=await fileRecord(file);}}
 await visit(directory);return result;
}
const [action,runtimeBinary,runtimeManifest,expected,expectedWorker]=process.argv.slice(2);
const source=await inputs();
if(action==="--inputs-digest"){
 assert.equal(process.argv.length,3);process.stdout.write(hash(JSON.stringify(source))+"\n");
}else{
 assert(["--record","--check"].includes(action));assert.equal(process.argv.length,action==="--record"?7:5);
 assert(path.isAbsolute(runtimeBinary)&&path.isAbsolute(runtimeManifest));
 const bundle=primary?.bundle??path.join(root,"src-tauri/target/debug/bundle/macos",bundleName);
 assert.equal(execFileSync("/usr/bin/plutil",["-extract","CFBundleIdentifier","raw","-o","-",path.join(bundle,"Contents/Info.plist")],{encoding:"utf8"}).trim(),identifier);
 const bundleFiles=await tree(bundle);assert(bundleFiles["Contents/MacOS/yijie-desktop"].mode&0o111);
 if(kimiCallSurfaces().experts)for(const slot of ["skill-packages","skill-packages-experts"]){
  const expected=await tree(path.join(root,".local",slot==="skill-packages-experts"?"feat164-kimi-k31/skill-packages-experts":slot));
  const prefix=`Contents/Resources/${slot}/`;
  const actual=Object.fromEntries(Object.entries(bundleFiles).filter(([name])=>name.startsWith(prefix)).map(([name,v])=>[name.slice(prefix.length),v]));
  const content=files=>Object.fromEntries(Object.entries(files).map(([name,v])=>[name,{sha256:v.sha256,bytes:v.bytes}]));
  assert.deepEqual(content(actual),content(expected),"Packaged expert resources differ from the checked slot");
 }
 const current={schema_version:1,feature:"FEAT-164",mode:"local_worktree_candidate",release:false,...(daily?{deployment_policy:"feat164-daily-existing-homes-v1",activation_policy:"feat164-daily-activated-homes-v2"}:{}),inputs:source,artifacts:{bundle:bundleFiles,host:await fileRecord(path.join(root,runtimeRoot,"bin/yijie-agent-host")),runtime:await fileRecord(runtimeBinary),runtimeManifest:await fileRecord(runtimeManifest)}};
 if(primary){current.primary_policy="feat164-primary-existing-homes-v3";current.primary_source=primary;}
 if(kimiCallSurfaces().market){
  const manifest=primary?.worker_manifest??path.resolve(root,"../yijie-connectors/bin/market-worker/current.json");
  assert.equal(process.env.YIJIE_MARKET_WORKER_MANIFEST,manifest);
  const worker=JSON.parse(await readFile(manifest,"utf8"));
  assert.equal(worker.schemaVersion,2);assert.equal(worker.candidateOnly,true);assert.match(worker.sha256,/^[a-f0-9]{64}$/);
  assert.equal(worker.binary,path.join(await realpath(path.dirname(manifest)),worker.sha256,"yijie-mcp-worker"));
  current.artifacts.worker=await fileRecord(worker.binary);current.artifacts.workerManifest=await fileRecord(manifest);
  assert.equal(current.artifacts.worker.sha256,worker.sha256);assert.equal(current.artifacts.worker.bytes,worker.sizeBytes);
 }
 if(kimiCallSurfaces().media)current.artifacts.adapter=await fileRecord(path.join(root,runtimeRoot,"bin/yijie-artifact-mcp"));
 assert(current.artifacts.host.mode&0o111);assert(current.artifacts.runtime.mode&0o111);
 if(action==="--check"){
  assert.deepEqual(JSON.parse(await readFile(receipt,"utf8")),current,"Candidate sources/environment/artifacts changed; rebuild through the canonical entry");
  process.stdout.write("FEAT-164 same-build reopen verified; local provenance only.\n");
 }else{
  assert.equal(hash(JSON.stringify(source)),expected,"Candidate inputs changed during build");
  if(kimiCallSurfaces().market)assert.equal(hash(JSON.stringify(source.workerSources)),expectedWorker,"Worker inputs changed during build");
  const temporary=receipt+`.tmp-${process.pid}`;
  await writeFile(temporary,JSON.stringify(current,null,2)+"\n",{flag:"wx",mode:0o600});await rename(temporary,receipt);
  process.stdout.write("FEAT-164 canonical candidate build recorded; local provenance only.\n");
 }
}
