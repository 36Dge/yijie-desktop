// Source authority for the versioned display extension; no execution machinery.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const local=process.env.YIJIE_ENV==='local'&&process.env.YIJIE_LOCAL_PROFILE==='demo_fast';
const args=process.argv.slice(2);
assert(args.every(arg=>['--candidate','--require-committed'].includes(arg)));
assert(!(args.includes('--candidate')&&args.includes('--require-committed')));
assert(!args.includes('--candidate')||local,'Working-tree candidates require local/demo_fast');
const candidate=local&&!args.includes('--require-committed');
const source=path.resolve(process.env.YIJIE_DESKTOP_CONTRACTS_DIR||path.join(root,'../yijie-contracts'));
const mode=candidate?['--candidate']:['--commit',JSON.parse(readFileSync(path.join(root,'contracts/native-process.lock.json'))).contracts.full_commit];
for(const [script,extra] of [['generate-native-process.mjs',[]],['sync-native-process.mjs',mode]]) {
  execFileSync(process.execPath,[`scripts/${script}`,...extra,'--check'],{cwd:source,stdio:'inherit'});
}
execFileSync(process.execPath,['scripts/generate-native-conversation.mjs','--check'],{cwd:root,stdio:'inherit'});
console.log(`Native process authority checked (${candidate?'local candidate, release=false':'committed source'}).`);
