// FEAT-164 local worktree provenance, not an immutable source/G2V/release receipt.
// Reopen checks the same canonical bundle and inputs without rebuilding them.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {lstat,readdir,readFile,writeFile,rename} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const hash=v=>createHash("sha256").update(v).digest("hex");
const receipt=path.join(root,".local/feat164-kimi-k31/packaged-launch-receipt.json");
async function fileRecord(file){
 const stat=await lstat(file);assert(stat.isFile(),"Regular file required");
 const digest=createHash("sha256");for await(const bytes of createReadStream(file))digest.update(bytes);
 return {sha256:digest.digest("hex"),bytes:stat.size,mode:stat.mode&0o777};
}
async function inputs(){
 assert.equal(process.env.YIJIE_KIMI_K31_PRO_CANDIDATE,"true");
 assert(!process.env.TAURI_CONFIG,"Ambient Tauri configuration is unsupported");
 const names=execFileSync("git",["-C",root,"ls-files","-co","--exclude-standard","-z","--","src","src-tauri","scripts","contracts","public","patches","tools","sidecars","package.json","pnpm-lock.yaml","pnpm-workspace.yaml","rust-toolchain.toml","index.html","vite.config.*","tsconfig*.json",".cargo",".npmrc",".gitignore",".gitattributes"],{encoding:"utf8",maxBuffer:32*1024*1024}).split("\0").filter(Boolean);
 for(const name of [".env",".env.local",".env.production",".env.production.local"]){try{await lstat(path.join(root,name));names.push(name);}catch(error){if(error.code!=="ENOENT")throw error;}}
 const sources={};for(const name of [...new Set(names)].sort())sources[name]=await fileRecord(path.join(root,name));
 const keys=[...new Set(["NODE_ENV","NODE_OPTIONS","CC","CXX","CFLAGS","CXXFLAGS","LDFLAGS","SDKROOT","MACOSX_DEPLOYMENT_TARGET","PKG_CONFIG_PATH",...Object.keys(process.env).filter(key=>/^(VITE_|TAURI_|CARGO_|RUST)/.test(key))])].sort();
 const environment=Object.fromEntries(keys.map(key=>[key,hash(JSON.stringify(process.env[key]??null))]));
 return {sources,environment};
}
async function tree(directory){
 assert((await lstat(directory)).isDirectory());const result={};
 async function visit(base){for(const entry of (await readdir(base,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(base,entry.name);if(entry.isDirectory())await visit(file);else result[path.relative(directory,file)]=await fileRecord(file);}}
 await visit(directory);return result;
}
const [action,runtimeBinary,runtimeManifest,expected]=process.argv.slice(2);
const source=await inputs();
if(action==="--inputs-digest"){
 assert.equal(process.argv.length,3);process.stdout.write(hash(JSON.stringify(source))+"\n");
}else{
 assert(["--record","--check"].includes(action));assert.equal(process.argv.length,action==="--record"?6:5);
 assert(path.isAbsolute(runtimeBinary)&&path.isAbsolute(runtimeManifest));
 const bundle=path.join(root,"src-tauri/target/debug/bundle/macos/易界 AI FEAT-164.app");
 assert.equal(execFileSync("/usr/bin/plutil",["-extract","CFBundleIdentifier","raw","-o","-",path.join(bundle,"Contents/Info.plist")],{encoding:"utf8"}).trim(),"com.yijie.ai.feat164-kimi-k31-r1");
 const bundleFiles=await tree(bundle);assert(bundleFiles["Contents/MacOS/yijie-desktop"].mode&0o111);
 const current={schema_version:1,feature:"FEAT-164",mode:"local_worktree_candidate",release:false,inputs:source,artifacts:{bundle:bundleFiles,host:await fileRecord(path.join(root,".local/feat164-kimi-k31/bin/yijie-agent-host")),runtime:await fileRecord(runtimeBinary),runtimeManifest:await fileRecord(runtimeManifest)}};
 assert(current.artifacts.host.mode&0o111);assert(current.artifacts.runtime.mode&0o111);
 if(action==="--check"){
  assert.deepEqual(JSON.parse(await readFile(receipt,"utf8")),current,"Candidate sources/environment/artifacts changed; rebuild through the canonical entry");
  process.stdout.write("FEAT-164 same-build reopen verified; local provenance only.\n");
 }else{
  assert.equal(hash(JSON.stringify(source)),expected,"Candidate inputs changed during build");
  const temporary=receipt+`.tmp-${process.pid}`;
  await writeFile(temporary,JSON.stringify(current,null,2)+"\n",{flag:"wx",mode:0o600});await rename(temporary,receipt);
  process.stdout.write("FEAT-164 canonical candidate build recorded; local provenance only.\n");
 }
}
