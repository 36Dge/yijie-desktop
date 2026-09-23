import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as validators from '../src/api/generated/scheduled-task-ipc-validator.gen.js';
const require=createRequire(new URL('../../yijie-contracts/package.json',import.meta.url));
const Ajv=require('ajv/dist/2020.js').default, addFormats=require('ajv-formats').default;
const schema=JSON.parse(readFileSync(new URL('../src-tauri/schemas/scheduled-task-ipc-resolved.schema.json',import.meta.url),'utf8'));
const source=JSON.parse(readFileSync(new URL('../src-tauri/schemas/scheduled-task-ipc-v1.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv({strict:true,allErrors:true});addFormats(ajv);ajv.addSchema(schema);
const producer=process.argv[2];if(!producer)throw Error('Pass actual native producer JSON');
const rows=JSON.parse(readFileSync(producer,'utf8'));
for(const row of rows){
 const command=source['x-commands'].find(c=>c.name===row.command);if(!command)throw Error('Unknown native command');
 for(const direction of ['request','response']){
  const name=command[direction];const validate=ajv.compile({$ref:schema.$id+'#/$defs/'+name});
  if(!validate(row[direction])||!validators['validate'+name](row[direction]))throw Error('Producer mismatch '+name+JSON.stringify(validate.errors));
 }
}
if(process.argv[3]){
 for(const row of JSON.parse(readFileSync(process.argv[3],'utf8'))){
  const validate=ajv.compile({$ref:schema.$id+'#/$defs/'+row.schema});
  if(validate(row.value)!==row.valid||validators['validate'+row.schema](row.value)!==row.valid)throw Error('Native validator parity '+row.schema);
 }
}
for(const c of source['x-commands'])if(!rows.some(r=>r.command===c.name))throw Error('Missing native producer coverage '+c.name);
const lib=readFileSync(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');
for(const c of source['x-commands'])if(!lib.includes('ipc_commands_generated::'+c.name+','))throw Error('Unregistered command '+c.name);
console.log(`Private IPC strict AJV/native/TS producer parity PASS (${rows.length} exchanges); ${source['x-commands'].length} commands registered.`);
