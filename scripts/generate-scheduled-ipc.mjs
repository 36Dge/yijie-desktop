import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'../yijie-contracts/package.json'));
const Ajv=require('ajv/dist/2020.js').default, addFormats=require('ajv-formats').default, standalone=require('ajv/dist/standalone').default;
const read=p=>JSON.parse(readFileSync(path.join(root,p),'utf8'));
const sourcePath='src-tauri/schemas/scheduled-task-ipc-v1.schema.json', source=read(sourcePath);
const families=[['plan','contracts/scheduled-plan.schema.json','contracts/scheduled-plan.candidate.json','src-tauri/src/chat/schedules/generated.rs','src/domain/scheduled-plan.generated.ts'],['execution','contracts/scheduled-execution.schema.json','contracts/scheduled-execution.candidate.json','src-tauri/src/chat/schedules/execution_generated.rs','src/domain/scheduled-execution.generated.ts'],['draft','contracts/scheduled-draft.schema.json','contracts/scheduled-draft.candidate.json','src-tauri/src/chat/schedules/draft_generated.rs','src/domain/scheduled-draft.generated.ts']];
const publicSources=new Map(); const hashes=[];
const hash=p=>createHash('sha256').update(readFileSync(path.join(root,p))).digest('hex');
for(const [name,file,manifest,rust,ts]of families){
 const data=read(file),lock=read(manifest);
 for(const [local,remote]of [[file,`sdks/jsonschema/scheduled-${name}.schema.json`],[rust,`sdks/rust/scheduled-${name}/types.gen.rs`],[ts,`sdks/typescript/src/jsonschema/scheduled-${name}.gen.ts`]]){
  if(hash(local)!==lock.generated.find(f=>f.path===remote)?.sha256)throw Error('Shared generation drift: '+local);
  hashes.push({path:local,sha256:hash(local)});
 }
 publicSources.set(data.$id,{data,name});
}
function resolve(ref){const [id,pointer]=ref.split('#');const family=publicSources.get(id);if(!family)throw Error('Unregistered shared ref '+ref);let v=family.data;for(const key of pointer.split('/').slice(1))v=v[key];if(!v)throw Error('Missing reference '+ref);return {schema:v,name:family.name,pointer};}
function rewrite(value,prefix){
 if(Array.isArray(value))return value.map(v=>rewrite(v,prefix));if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).map(([k,v])=>{
  if(k!=='$ref')return [k,rewrite(v,prefix)];
  if(v.startsWith('#/$defs/'))return [k,`#/$defs/${prefix??''}${v.slice(8)}`];
  const {name,pointer}=resolve(v);return [k,`#/$defs/${name}_${pointer.slice(7)}`];
 }));
}
const resolved={...rewrite(source),$defs:{...rewrite(source.$defs)}};delete resolved['x-commands'];
for(const {data,name}of publicSources.values())for(const [key,value]of Object.entries(data.$defs))resolved.$defs[name+'_'+key]=rewrite(value,name+'_');
// Keep the native source-driven validator's supported vocabulary explicit.
const keywords=new Set('$id $schema $defs $ref description title type const enum properties required additionalProperties dependentRequired minimum maximum minLength maxLength pattern format minItems maxItems uniqueItems items allOf oneOf not if then else'.split(' '));
const patterns=new Set(['^[0-9a-f]{64}$','^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$','^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$','^(?:[01][0-9]|2[0-3]):[0-5][0-9]$']);
function vocabulary(s){if(typeof s==='boolean')return;for(const k of Object.keys(s))if(!keywords.has(k))throw Error('Unsupported native keyword '+k);if(s.pattern&&!patterns.has(s.pattern))throw Error('Unsupported native pattern');if(s.format&&!['uuid','date'].includes(s.format))throw Error('Unsupported native format');for(const k of ['$defs','properties'])for(const v of Object.values(s[k]??{}))vocabulary(v);for(const k of ['allOf','oneOf'])for(const v of s[k]??[])vocabulary(v);for(const k of ['items','not','if','then','else'])if(s[k]!==undefined)vocabulary(s[k]);}
vocabulary(resolved);
function variantType(v,name){const t=type(v,name,'rust');const target=v.$ref?.startsWith('#/$defs/')?source.$defs[v.$ref.slice(8)]:v.$ref?resolve(v.$ref).schema:v;return target.type==='object'||target.oneOf?`Box<${t}>`:t;}
const definitions=new Map(Object.entries(source.$defs));const pascal=s=>s.split(/[_.-]/).map(x=>x[0].toUpperCase()+x.slice(1)).join('');const snake=s=>s.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase();
function type(s,name,lang){
 if(s.$ref){if(s.$ref.startsWith('#/$defs/'))return s.$ref.slice(8);const r=resolve(s.$ref);const parts=r.pointer.split('/');if(parts.length===3)return (lang==='rust'?r.name+'::':pascal(r.name)+'.')+parts[2];return type(r.schema,name,lang);}
 if(s.enum){definitions.set(name,s);return name;}
 if(s.type==='array')return lang==='rust'?`Vec<${type(s.items,name+'Item',lang)}>`:`Array<${type(s.items,name+'Item',lang)}>`;
 if(s.type==='string')return lang==='rust'?'String':s.const!==undefined?JSON.stringify(s.const):'string';
 if(s.type==='integer')return lang==='rust'?'i64':s.const!==undefined?String(s.const):'number';
 if(s.type==='boolean')return lang==='rust'?'bool':s.const!==undefined?String(s.const):'boolean';
 throw Error('Unsupported generated type '+name);
}
let rust='// Generated from scheduled-task-ipc-v1.schema.json and pinned shared references. DO NOT EDIT.\nuse super::{generated as plan, execution_generated as execution, draft_generated as draft};\nuse serde::{Serialize,Deserialize};\nfn optional_non_null<\'de,D,T>(d:D)->Result<Option<T>,D::Error> where D:serde::Deserializer<\'de>,T:Deserialize<\'de>{T::deserialize(d).map(Some)}\n';
let ts='// Generated from the private IPC source and shared references. DO NOT EDIT.\nimport type * as Plan from "../../domain/scheduled-plan.generated";\nimport type * as Execution from "../../domain/scheduled-execution.generated";\nimport type * as Draft from "../../domain/scheduled-draft.generated";\n';
for(const [name,s]of definitions){
 if(s.enum){rust+=`#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize)]\npub enum ${name}{\n${s.enum.map(v=>`#[serde(rename=${JSON.stringify(v)})] ${pascal(v)},`).join('\n')}\n}\n`;ts+=`export type ${name} = ${s.enum.map(v=>JSON.stringify(v)).join(' | ')};\n`;}
 else if(s.oneOf){rust+=`#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]\n#[serde(untagged)]\npub enum ${name}{\n${s.oneOf.map((v,i)=>`Variant${i}(${variantType(v,name+'Value'+i)}),`).join('\n')}\n}\n`;ts+=`export type ${name} = ${s.oneOf.map((v,i)=>type(v,name+'Value'+i,'ts')).join(' | ')};\n`;}
 else if(s.type==='object'){
  rust+=`#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]\n#[serde(deny_unknown_fields)]\npub struct ${name}{\n`;ts+=Object.keys(s.properties).length ? `export interface ${name}{\n` : `export type ${name} = Record<string, never>;\n`;
  for(const [key,value]of Object.entries(s.properties)){const required=s.required.includes(key), rt=type(value,name+pascal(key),'rust');rust+=`#[serde(rename=${JSON.stringify(key)}${required?'':',default,skip_serializing_if="Option::is_none",deserialize_with="optional_non_null"'})]\npub ${snake(key)}:${required?rt:`Option<${rt}>`},\n`;ts+=`${key}${required?'':'?'}:${type(value,name+pascal(key),'ts')};\n`;}
  rust+='}\n';if(Object.keys(s.properties).length)ts+='}\n';
 }else throw Error('Unexpected source definition '+name);
 if(!s.enum)rust+=`impl std::fmt::Debug for ${name}{fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result{f.write_str("${name}([redacted])")}}\n`;
}
const commands=source['x-commands'];
ts+='export interface Requests {\n'+commands.map(c=>`"${c.name}":${c.request};`).join('\n')+'\n}\nexport interface Responses {\n'+commands.map(c=>`"${c.name}":${c.response};`).join('\n')+'\n}\n';
ts+='export const commands = '+JSON.stringify(Object.fromEntries(commands.map(c=>[c.name,{request:c.request,response:c.response,write:c.write,permission:c.permission}])),null,2)+' as const;\n';
let wrappers='// Generated command allowlist; no dynamic dispatch surface. DO NOT EDIT.\nuse super::ipc;\n';
for(const c of commands)wrappers+=`#[tauri::command]\npub async fn ${c.name}(request:serde_json::Value,chat_runtime:tauri::State<'_,crate::chat::ChatRuntime>,ipc_runtime:tauri::State<'_,ipc::ScheduleIpcRuntime>)->Result<serde_json::Value,super::ipc_generated::ErrorResponse>{ipc::command(request,&chat_runtime,&ipc_runtime,"${c.name}").await}\n`;
rust+='pub(crate) const COMMANDS:&[(&str,&str,&str,&str,bool)] = &[\n'+commands.map(c=>`(${[c.name,c.request,c.response,c.permission].map(JSON.stringify).join(',')},${c.write}),`).join('\n')+'\n];\n';
const ajv=new Ajv({strict:true,allErrors:true,code:{source:true,esm:true}});addFormats(ajv);ajv.addSchema(resolved);
const names=[...new Set(['ErrorResponse',...commands.flatMap(c=>[c.request,c.response])])];const exports={};
for(const name of names){ajv.addSchema({$id:name,$ref:resolved.$id+'#/$defs/'+name});exports['validate'+name]=name;}
let validator=standalone(ajv,exports).replaceAll('require("ajv/dist/runtime/ucs2length").default','ucs2length').replaceAll('require("ajv/dist/runtime/equal").default','equal').replaceAll('require("ajv-formats/dist/formats").fullFormats','formats');
if(validator.includes('require('))throw Error('Unmapped standalone validator runtime dependency');
validator='// Generated strict validators. DO NOT EDIT.\nimport ucs2lengthModule from "ajv/dist/runtime/ucs2length.js";\nimport equalModule from "ajv/dist/runtime/equal.js";\nconst equal=typeof equalModule==="function"?equalModule:equalModule.default;\nimport { fullFormats as formats } from "./scheduled-task-ipc-formats.gen.js";\nconst ucs2length=typeof ucs2lengthModule==="function"?ucs2lengthModule:ucs2lengthModule.default;\n'+validator;
const declarations='// Generated. DO NOT EDIT.\nimport type * as Types from "./scheduled-task-ipc.gen";\n'+names.map(n=>`export declare function validate${n}(value:unknown):value is Types.${n};`).join('\n')+'\n';
function format(code){const r=spawnSync('rustfmt',['--edition','2021'],{input:code,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout;}
const formatsPath=require.resolve('ajv-formats/dist/formats.js');
const formatsSource=readFileSync(formatsPath,'utf8');
if(formatsSource.includes('require('))throw Error('Unexpected format runtime dependency');
const formatsLicense=readFileSync(path.join(path.dirname(require.resolve('ajv-formats/package.json')),'LICENSE'),'utf8');
const formatsRuntime='/* '+formatsLicense+' */\n// Generated from ajv-formats '+require('ajv-formats/package.json').version+' (MIT). DO NOT EDIT.\n// '+require('ajv-formats/package.json').license+'; https://github.com/ajv-validator/ajv-formats\nconst exports={};\n'+formatsSource.replace(/\/\/# sourceMappingURL=.*$/m,'')+'\nexport const fullFormats=exports.fullFormats;\n';
const outputs={
 'src/api/generated/scheduled-task-ipc-formats.gen.js':formatsRuntime,
 'src-tauri/src/chat/schedules/ipc_generated.rs':format(rust),
 'src-tauri/src/chat/schedules/ipc_commands_generated.rs':format(wrappers),
 'src/api/generated/scheduled-task-ipc.gen.ts':ts,
 'src/api/generated/scheduled-task-ipc-validator.gen.js':validator,
 'src/api/generated/scheduled-task-ipc-validator.gen.d.ts':declarations,
 'src-tauri/schemas/scheduled-task-ipc-resolved.schema.json':JSON.stringify(resolved,null,2)+'\n',
};
const digest=s=>createHash('sha256').update(s).digest('hex');
outputs['contracts/scheduled-ipc.candidate.json']=JSON.stringify({schema_version:1,mode:'local_candidate',release:false,format_runtime:{package:'ajv-formats',version:require('ajv-formats/package.json').version,sha256:digest(formatsSource)},authority:sourcePath,sources:[{path:sourcePath,sha256:hash(sourcePath)},{path:'scripts/generate-scheduled-ipc.mjs',sha256:hash('scripts/generate-scheduled-ipc.mjs')},...hashes],generated:Object.entries(outputs).map(([path,content])=>({path,sha256:digest(content)}))},null,2)+'\n';
for(const [file,content]of Object.entries(outputs)){const p=path.join(root,file);if(process.argv.includes('--check')){if(readFileSync(p,'utf8')!==content)throw Error('Generation drift: '+file);}else{mkdirSync(path.dirname(p),{recursive:true});writeFileSync(p,content);}}
console.log('Scheduled private IPC source, pinned shared types and strict generation '+(process.argv.includes('--check')?'verified':'generated')+'.');
