// FEAT-174 local candidate packaging. This copies sources, never installed data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,cpSync,renameSync,rmSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const skills=path.resolve(root,'../yijie-skills'),contracts=path.resolve(root,'../yijie-contracts');
const check=process.argv.includes('--check');assert(process.argv.slice(2).every(x=>x==='--check'));
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const consumer of ['desktop','skills'])execFileSync(process.execPath,['scripts/generate-skill-market-v2.mjs','--check','--consumer='+consumer],{cwd:contracts,stdio:'pipe'});
const source=path.join(skills,'dist/native-skill-marketplace'),destination=path.join(root,'.local/skill-marketplace');
const manifest=readFileSync(path.join(source,'presentation.json')),catalog=JSON.parse(manifest);assert.equal(catalog.schema_version,2);assert(Array.isArray(catalog.skills)&&catalog.skills.length<=512);
const files={};function walk(dir,relative=''){for(const name of readdirSync(dir).sort()){const p=path.join(dir,name),r=relative?relative+'/'+name:name;const info=lstatSync(p);assert(!info.isSymbolicLink());if(info.isDirectory())walk(p,r);else{assert(info.isFile());files[r]=hash(readFileSync(p));}}}walk(source);
const authority={schema_version:1,feature:'FEAT-174',mode:'local_worktree_candidate',release:false,skills_base_commit:execFileSync('git',['-C',skills,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),producer_sha256:hash(readFileSync(path.join(skills,'scripts/package-native-skill-marketplace.mjs'))),presentation_sha256:hash(manifest),files};
const pin=path.join(root,'contracts/native-skill-resources.candidate.json');
if(check){assert.deepEqual(JSON.parse(readFileSync(pin)),authority);for(const [name,sha]of Object.entries(files))assert.equal(hash(readFileSync(path.join(destination,name))),sha);}
else{
 const staging=destination+'.preparing';assert(!existsSync(staging));cpSync(source,staging,{recursive:true,errorOnExist:true});
 // Only generated resources in this project's canonical .local output slot.
 if(existsSync(destination))rmSync(destination,{recursive:true});renameSync(staging,destination);
 mkdirSync(path.dirname(pin),{recursive:true});writeFileSync(pin,JSON.stringify(authority,null,2)+'\n');
}
console.log('Native Skill source resources '+(check?'verified':'prepared')+'; installed=0.');
