// FEAT-164 draft build provenance. This is not an immutable implementation pin
// or a G2V qualification receipt; source freeze remains a separate gate.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,lstatSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const contracts=path.resolve(desktop,"../yijie-contracts"),host=path.resolve(desktop,"../yijie-agent-host");
const hash=b=>createHash("sha256").update(b).digest("hex");
const commit="b0060c8bc4fb924cec14d98b193c32c69482b7b7";
const lockFile="contracts/kimi-k31-host-build.candidate.json";
function inputs(hostRoot){
 const git=(...args)=>execFileSync("git",["-C",hostRoot,...args],{encoding:"utf8",maxBuffer:16*1024*1024}).trim();
 const names=[...new Set(git("ls-files","-co","--exclude-standard","--","cmd","internal","api","go.mod","go.sum").split("\n"))].sort();
 const sources={};for(const name of names){assert(!path.isAbsolute(name)&&!name.split("/").includes(".."));assert(lstatSync(path.join(hostRoot,name)).isFile());sources[name]=hash(readFileSync(path.join(hostRoot,name)));}
 return {base_commit:git("rev-parse","HEAD"),sources};
}
function checkPins(desktopRoot,hostRoot){
 execFileSync("python3",["scripts/sync-kimi-k31-pro-contracts.py","--commit",commit,"--check"],{cwd:hostRoot,stdio:"pipe"});
 return Object.fromEntries(["chat-models-v2","runtime-kimi-k31-pro"].map(f=>[f,hash(readFileSync(path.join(desktopRoot,`contracts/${f}.candidate.json`)))]));
}
export function verifyKimiK31BuildCandidate(desktopRoot,contractsRoot,hostRoot,env=process.env){
 assert(env.YIJIE_ENV==="local"&&env.YIJIE_LOCAL_PROFILE==="demo_fast"&&env.YIJIE_CHAT_MODELS_ENABLED==="true"&&env.YIJIE_KIMI_K31_PRO_CANDIDATE==="true","Explicit local candidate required");
 for(const flag of ["YIJIE_EXPERTS_ENABLED","YIJIE_MARKET_CONNECTORS_ENABLED","YIJIE_ARTIFACT_MEDIA_ENABLED","YIJIE_WORKFLOW_ENABLED"])assert(env[flag]!=="true","Ordinary walking skeleton only: "+flag);
 const actual=JSON.parse(readFileSync(path.join(desktopRoot,lockFile)));
 assert.equal(actual.feature,"FEAT-164");assert.equal(actual.mode,"local_worktree_candidate");assert.equal(actual.release,false);
 assert.equal(actual.contracts_commit,commit);
 assert.deepEqual(actual.contracts,checkPins(desktopRoot,hostRoot));
 assert.deepEqual(actual.host,inputs(hostRoot),"Host draft build source drift");
 execFileSync(process.execPath,["scripts/generate-runtime-kimi-k31-pro.mjs","--check"],{cwd:contractsRoot,stdio:"pipe"});
 return actual.host.sources;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 assert(process.argv.slice(2).every(a=>a==="--freeze"));
 if(process.argv.includes("--freeze"))writeFileSync(path.join(desktop,lockFile),JSON.stringify({schema_version:1,feature:"FEAT-164",mode:"local_worktree_candidate",release:false,contracts_commit:commit,contracts:checkPins(desktop,host),host:inputs(host)},null,2)+"\n");
 verifyKimiK31BuildCandidate(desktop,contracts,host);
 console.log("FEAT-164 isolated draft build sources verified; not G2V or release qualification.");
}
