import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(path.join(root,p),'utf8');
const spec=JSON.parse(read('src-tauri/contracts/native-skill-marketplace-v2.json'));
assert.equal(spec.schemaVersion,2);
const lib=read('src-tauri/src/lib.rs'),native=read('src-tauri/src/skills/market_v2.rs'),frontend=read('src/api/native-skill-market-client.ts');
for(const name of Object.keys(spec.commands)){assert(native.includes('pub async fn '+name+'('));assert(lib.includes('skills::market_v2::'+name+','));assert(frontend.includes('"'+name+'"'));}
assert(native.includes('pick_file()'));assert(native.includes('O_NOFOLLOW'));assert(native.includes('Sha256::digest'));
assert(!read('src/domain/native-skill-marketplace.ts').includes('new Ajv'));
assert(!read('src-tauri/src/skills/host.rs').includes('ensure_starter_skills'));
assert(read('src/pages/chat/ChatPage.vue').includes('VITE_YIJIE_FEAT174_NATIVE_SKILLS !== "true" || !nativeSkillInputEnabled()'));
execFileSync(process.execPath,['scripts/generate-skill-market-v2.mjs','--consumer=desktop','--check'],{cwd:path.resolve(root,'../yijie-contracts'),stdio:'pipe'});
console.log('Native Skill v2 bindings, source DTOs, picker boundary and retained readers verified.');
