// Fixed input-only archive authority. Never activate a live Host route or writer.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const sourcePath='compatibility/native-display-archive-v5.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function readArchiveAuthority(root){
 const lock=JSON.parse(await fs.readFile(path.join(root,'contracts/native-display-archive-v5.lock.json'),'utf8'));
 if(!/^[a-f0-9]{40}$/.test(lock.sourceCommit)||lock.sourcePath!==sourcePath)throw Error('Archive authority identity unavailable');
 const bytes=await fs.readFile(path.join(root,'src-tauri/contracts/native-display-archive-v5.json'));
 if(sha(bytes)!==lock.sha256)throw Error('Archive source drift');
 const authority=execFileSync('git',['show',`${lock.sourceCommit}:${sourcePath}`],{cwd:path.join(root,'../yijie-contracts'),maxBuffer:1024*1024});
 if(!authority.equals(bytes))throw Error('Archive authority object differs');
 const value=JSON.parse(bytes);
 if(value.contract_id!=='native-display-archive-v5'||value.version!=='0.1.0')throw Error('Unsupported archive authority');
 return value;
}
export function archiveDefinitions(publicSpec,privateSpec,archive){
 const all={...publicSpec.components.schemas,...archive.schemas,...privateSpec.definitions};
 const needed={};
 const visit=name=>{if(needed[name])return;if(!all[name])throw Error('Missing archive type '+name);needed[name]=all[name];walk(all[name]);};
 const walk=value=>{if(!value||typeof value!=='object')return;if(value.$ref)visit(value.$ref.split('/').at(-1));for(const child of Object.values(value))walk(child);};
 visit('NativeConversationView');
 const rename=value=>{if(Array.isArray(value))return value.map(rename);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='$ref'?'#/definitions/ArchiveV5'+v.split('/').at(-1):rename(v)]));};
 return Object.fromEntries(Object.entries(needed).map(([k,v])=>['ArchiveV5'+k,rename(v)]));
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 if(process.argv[2]==='--sync'){
  const commit=process.argv[3];if(!/^[a-f0-9]{40}$/.test(commit??''))throw Error('Full source commit required');
  const contracts=path.join(root,'../yijie-contracts');
  if(execFileSync('git',['status','--porcelain'],{cwd:contracts,encoding:'utf8'}).trim())throw Error('Archive source must be clean');
  const bytes=execFileSync('git',['show',`${commit}:${sourcePath}`],{cwd:contracts,maxBuffer:1024*1024});
  await fs.writeFile(path.join(root,'src-tauri/contracts/native-display-archive-v5.json'),bytes);
  await fs.writeFile(path.join(root,'contracts/native-display-archive-v5.lock.json'),JSON.stringify({contractId:'native-display-archive-v5',version:'0.1.0',sourceCommit:commit,sourcePath,sha256:sha(bytes),scope:'read-only saved display; no live protocol or writer activation'},null,2)+'\n');
 }else if(process.argv[2]!=='--check')throw Error('Use --sync FULL_COMMIT or --check');
 await readArchiveAuthority(root);console.log('Native archive v5 exact source verified; read-only consumer only.');
}
