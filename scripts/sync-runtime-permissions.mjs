import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractRoot=path.resolve(root,'../yijie-contracts');
const requireContract=createRequire(path.join(contractRoot,'package.json'));
const { compile }=requireContract('json-schema-to-typescript');
const args=process.argv.slice(2);
assert(args.length===0 || (args.length===1 && args[0]==='--check') || (args.length===2 && args[0]==='--commit' && /^[a-f0-9]{40}$/.test(args[1])), 'Use --check or --commit <full Contracts SHA>');
// The permission bundle references the ordinary file-input schema. Advance
// its Contracts authority through Git objects when that input changes, while
// retaining the independently verified Host baseline/candidate build policy.
if(args[0]==='--commit') {
 const commit=args[1],hostRoot=path.resolve(root,'../yijie-agent-host');
 const git=(...parts)=>execFileSync('git',['-C',contractRoot,...parts],{maxBuffer:16*1024*1024});
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(git('rev-parse',`${commit}^{commit}`).toString().trim(),commit);
 const desktopLockPath=path.join(root,'contracts/runtime-permissions.lock.json');
 const hostLockPath=path.join(hostRoot,'api/runtime-permissions.lock.json');
 const desktopLock=JSON.parse(await fs.readFile(desktopLockPath,'utf8'));
 const hostLock=JSON.parse(await fs.readFile(hostLockPath,'utf8'));
 const sources={};
 for(const name of Object.keys(desktopLock.contracts.sources)) {
  assert(!path.isAbsolute(name) && !name.split('/').includes('..'));
  const bytes=git('show',`${commit}:${name}`);
  assert.deepEqual(await fs.readFile(path.join(contractRoot,name)),bytes,`Uncommitted permission authority: ${name}`);
  sources[name]=hash(bytes);
 }
 const authority={repository:desktopLock.contracts.repository,full_commit:commit,sources};
 await fs.writeFile(path.join(hostRoot,'api/openapi/runtime-permissions.yaml'),git('show',`${commit}:sdks/go/openapi/runtime-permissions/source.bundle.yaml`));
 const generated=execFileSync('go',['tool','oapi-codegen','-generate','types','-package','runtimepermissions','api/openapi/runtime-permissions.yaml'],{cwd:hostRoot,maxBuffer:8*1024*1024});
 await fs.writeFile(path.join(hostRoot,'internal/contracts/runtimepermissions/types.gen.go'),generated);
 hostLock.contracts=authority;
 hostLock.consumption.generated_types_sha256=hash(generated);
 desktopLock.contracts=authority;
 // agent_host remains the historical immutable baseline. The existing
 // scheduled/K3.1 verifier separately checks every actual Host build input.
 await fs.writeFile(hostLockPath,JSON.stringify(hostLock,null,2)+'\n');
 await fs.writeFile(desktopLockPath,JSON.stringify(desktopLock,null,2)+'\n');
}
const schema=JSON.parse(await fs.readFile(path.join(root,'src-tauri/schemas/chat-runtime-permissions-v1.schema.json'),'utf8'));
const privateTypes=await compile({...schema.definitions.PermissionState, definitions:schema.definitions},'ChatPermissionState',{bannerComment:'/* Generated from chat-runtime-permissions-v1.schema.json. Do not edit. */'});
const publicTypes=await fs.readFile(path.join(contractRoot,'sdks/typescript/src/openapi/runtime-permissions.gen.ts'),'utf8');
for(const [relative,content] of [['src/api/generated/chat-permission-state.gen.ts',privateTypes],['src/api/generated/runtime-permissions.gen.ts',publicTypes]]) {
 const target=path.join(root,relative);
 if(process.argv.includes('--check')) {if(await fs.readFile(target,'utf8')!==content) throw new Error(`Runtime permission source drift: ${relative}`);}
 else {await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content);}
}
