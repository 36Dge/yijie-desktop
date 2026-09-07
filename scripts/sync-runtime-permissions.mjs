import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractRoot=path.resolve(root,'../yijie-contracts');
const requireContract=createRequire(path.join(contractRoot,'package.json'));
const { compile }=requireContract('json-schema-to-typescript');
const schema=JSON.parse(await fs.readFile(path.join(root,'src-tauri/schemas/chat-runtime-permissions-v1.schema.json'),'utf8'));
const privateTypes=await compile({...schema.definitions.PermissionState, definitions:schema.definitions},'ChatPermissionState',{bannerComment:'/* Generated from chat-runtime-permissions-v1.schema.json. Do not edit. */'});
const publicTypes=await fs.readFile(path.join(contractRoot,'sdks/typescript/src/openapi/runtime-permissions.gen.ts'),'utf8');
for(const [relative,content] of [['src/api/generated/chat-permission-state.gen.ts',privateTypes],['src/api/generated/runtime-permissions.gen.ts',publicTypes]]) {
 const target=path.join(root,relative);
 if(process.argv.includes('--check')) {if(await fs.readFile(target,'utf8')!==content) throw new Error(`Runtime permission source drift: ${relative}`);}
 else {await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content);}
}
