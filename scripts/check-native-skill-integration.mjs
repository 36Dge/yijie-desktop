import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(path.join(root,p),'utf8');
const spec=JSON.parse(read('src-tauri/contracts/native-skill-marketplace-v2.json'));
assert.equal(spec.schemaVersion,2);
const lib=read('src-tauri/src/lib.rs'),frontend=read('src/api/native-skill-market-client.ts');
const modules = Object.fromEntries(['market_v2', 'import_dialog'].map(name => [name, read('src-tauri/src/skills/' + name + '.rs')]));
for (const name of Object.keys(spec.commands)) {
  const owner = Object.keys(modules).find(module => modules[module].includes('fn ' + name + '('));
  assert(owner, name + ' needs a native implementation');
  assert(lib.includes('skills::' + owner + '::' + name + ','));
  assert(frontend.includes('"' + name + '"'));
}
for (const marker of ['pick_file()', 'O_NOFOLLOW', 'Sha256::digest', 'DragDropEvent::Drop']) {
  assert(modules.import_dialog.includes(marker), 'missing native file boundary: ' + marker);
}
assert(modules.market_v2.includes('import_dialog::read_file(path)'));
assert(!read('src/domain/native-skill-marketplace.ts').includes('new Ajv'));
assert(!read('src-tauri/src/skills/host.rs').includes('ensure_starter_skills'));
assert(read('src/pages/chat/ChatPage.vue').includes('VITE_YIJIE_FEAT174_NATIVE_SKILLS !== "true" || !nativeSkillInputEnabled()'));
execFileSync(process.execPath,['scripts/generate-skill-market-v2.mjs','--consumer=desktop','--check'],{cwd:path.resolve(root,'../yijie-contracts'),stdio:'pipe'});
console.log('Native Skill v2 bindings, source DTOs, picker boundary and retained readers verified.');
