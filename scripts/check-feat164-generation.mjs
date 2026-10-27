// Explicit, read-only FEAT-164 generation qualification; never a product launcher.
import assert from 'node:assert/strict';
import {spawnSync, execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, openSync, closeSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const sourcePins = Object.freeze({
  'yijie-contracts':'d5792d6aad18352ce8d1c5d510d345004cab3bd6',
  'yijie-agent-host':'a3d8767add3855a28c18adbbd51251fae3520ac0',
  'yijie-connectors':'cc56cdaa616c9d9eff8efa1f9e1307d084f3dff9',
  'yijie-codex':'11fd4504c28afd0f65c6f5f62a6b5328dd437f5a',
  'yijie-skills':'595c927ae101d3d31c234f60565041eee0864680',
});
const desktopStep=(id,file,args=[])=>({id,repository:'yijie-desktop',args:[`scripts/${file}.mjs`,...args]});
const contractsStep=(id,file,args=[])=>({id,repository:'yijie-contracts',args:[`scripts/${file}.mjs`,...args]});
export function generationPlan() {
  return [
    desktopStep('public-api','generate-public-api',['--check']),
    desktopStep('host-v2','check-agent-host-contract',['--check']),
    desktopStep('host-v3','check-agent-host-v3-contract'),
    desktopStep('host-skills','check-agent-host-skills-contract'),
    desktopStep('host-v4','check-agent-host-v4-contract'),
    desktopStep('native-timing','generate-chat-turn-timing',['--check']),
    desktopStep('session-purpose','generate-chat-session-purpose',['--check']),
    desktopStep('native-conversation','generate-native-conversation',['--check']),
    desktopStep('native-source','check-native-conversation',['--require-committed']),
    desktopStep('scheduled-ipc-v1','generate-scheduled-ipc',['--check']),
    contractsStep('market-connectors','sync-market-connectors',['--consumer=desktop','--check']),
    desktopStep('feat164-catalog','feat164-market-catalog',['--check']),
    contractsStep('market-selection-v1','sync-market-selection',['--consumer=desktop','--check']),
    contractsStep('market-provider','sync-market-provider',['--consumer=desktop','--check']),
    contractsStep('market-host-v1','sync-market-host',['--consumer=desktop','--check']),
    contractsStep('runtime-k31','generate-runtime-kimi-k31-pro',['--check']),
    contractsStep('models-v2','generate-chat-models-v2',['--check']),
    desktopStep('scheduled-ipc-v2','generate-scheduled-ipc-v2',['--check']),
    desktopStep('v2-source-closure','kimi-k31-build-candidate'),
  ];
}
export function checkSourceFacts(facts) {
  const root=facts['yijie-desktop'];
  assert(root && !root.dirty && /^[a-f0-9]{40}$/.test(root.head),'Desktop must be a committed clean checkout');
  const parent=path.dirname(root.realPath);
  for(const [name,pin] of Object.entries(sourcePins)) {
    const fact=facts[name];assert(fact && fact.head===pin && !fact.dirty,`Clean pinned source required: ${name}`);
    if(['yijie-contracts','yijie-agent-host','yijie-connectors'].includes(name)) {
      assert.equal(fact.realPath,path.join(parent,name),`Generator sibling path must target this qualification tree: ${name}`);
    }
  }
}
export function checkEnvironment(env) {
  const child=Object.fromEntries(['PATH','HOME','TMPDIR','CARGO_HOME','RUSTUP_HOME','SDKROOT','DEVELOPER_DIR','PKG_CONFIG_PATH'].filter(k=>env[k]!==undefined).map(k=>[k,env[k]]));
  return {...child,CARGO_NET_OFFLINE:'true',GOPROXY:'off',GOSUMDB:'off',GOTOOLCHAIN:'local',npm_config_offline:'true',YIJIE_ENV:'local',YIJIE_LOCAL_PROFILE:'demo_fast',YIJIE_CHAT_MODELS_ENABLED:'true',YIJIE_KIMI_K31_PRO_CANDIDATE:'true',YIJIE_KIMI_K31_CALL_SURFACES:'ordinary',YIJIE_MARKET_CONNECTORS_ENABLED:'false',YIJIE_EXPERTS_ENABLED:'false',YIJIE_ARTIFACT_MEDIA_ENABLED:'false',YIJIE_RUNTIME_PERMISSIONS_ENABLED:'true'};
}
export function executePlan(plan, run, record) {
  for(const step of plan) {const result=run(step);record(step,result);if(result!==0)return false;}
  return true;
}
function main(args) {
  assert(args.length===1 && path.isAbsolute(args[0]),'Pass one fresh absolute evidence directory');
  const output=args[0];assert(!existsSync(output),'Never overwrite prior qualification evidence');
  const desktop=realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')),workspace=path.dirname(desktop);
  const roots=Object.fromEntries(['yijie-desktop',...Object.keys(sourcePins)].map(name=>[name,realpathSync(path.join(workspace,name))]));
  const env=checkEnvironment(process.env),facts={};
  for(const [name,root] of Object.entries(roots)) {
    const git=(...argv)=>execFileSync('git',['-C',root,...argv],{env,encoding:'utf8',maxBuffer:8*1024*1024}).trim();
    facts[name]={head:git('rev-parse','HEAD'),dirty:!!git('status','--porcelain'),realPath:root};
  }
  checkSourceFacts(facts);
  const plan=generationPlan();for(const s of plan)assert(existsSync(path.join(roots[s.repository],s.args[0])),s.id);
  mkdirSync(output,{recursive:false});
  const report={feature:'FEAT-164',scope:'source generation only; legacy default check unchanged; not App/G2V/G3/release',sources:facts,real_model_http:0,checks:[],status:'RUNNING'};
  const save=()=>writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');save();
  const pass=executePlan(plan,step=>{
    const fd=openSync(path.join(output,step.id+'.log'),'wx');
    try {const run=spawnSync(process.execPath,step.args,{cwd:roots[step.repository],env,stdio:['ignore',fd,fd]});return run.status??-1;}
    finally {closeSync(fd);}
  },(step,status)=>{
    report.checks.push({id:step.id,repository:step.repository,command:['node',...step.args],exit_code:status,sha256:createHash('sha256').update(readFileSync(path.join(output,step.id+'.log'))).digest('hex')});
    report.status=status===0?'RUNNING':'FAIL';save();process.stdout.write(`${step.id}: ${status===0?'PASS':'FAIL'}\n`);
  });
  report.status=pass?'PASS':'FAIL';save();if(!pass)process.exitCode=1;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {main(process.argv.slice(2));}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}
}
