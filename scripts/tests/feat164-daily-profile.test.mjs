import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {kimiCallSurfaces} from '../kimi-k31-build-candidate.mjs';
const daily={YIJIE_FEAT164_DAILY:'true',YIJIE_KIMI_K31_PRO_CANDIDATE:'true',YIJIE_FEAT155_SCHEDULED_DAILY:'true',YIJIE_FEAT155_SCHEDULED_CANDIDATE:'false',YIJIE_KIMI_K31_CALL_SURFACES:'media',YIJIE_MARKET_CONNECTORS_ENABLED:'true',YIJIE_EXPERTS_ENABLED:'true',YIJIE_ARTIFACT_MEDIA_ENABLED:'true',YIJIE_RUNTIME_PERMISSIONS_ENABLED:'true',VITE_YIJIE_WORKFLOW_ENABLED:'true'};
test('daily K31 preserves workflow and complete market/expert/media assembly',()=>{
 assert.deepEqual(kimiCallSurfaces(daily),{mode:'media',market:true,experts:true,media:true});
 assert.equal(kimiCallSurfaces({...daily,VITE_YIJIE_WORKFLOW_ENABLED:'false'}).media,true);
});
test('daily storage and identity selectors cannot be mixed or implicit',()=>{
 for(const patch of [{YIJIE_FEAT164_DAILY:'future'},{YIJIE_FEAT164_QUALIFICATION:'true'},{YIJIE_FEAT155_SCHEDULED_CANDIDATE:'true'},{YIJIE_FEAT155_SCHEDULED_DAILY:'false'},{YIJIE_KIMI_K31_PRO_CANDIDATE:'false'},{VITE_YIJIE_WORKFLOW_ENABLED:undefined}]) assert.throws(()=>kimiCallSurfaces({...daily,...patch}));
 assert.throws(()=>kimiCallSurfaces({...daily,YIJIE_FEAT164_DAILY:'false'}));
});
test('canonical selector rejects invalid action pairs before any preparation',()=>{
 const env={PATH:process.env.PATH,HOME:process.env.HOME};
 for(const args of [['--kimi-k31-daily'],['--packaged','--kimi-k31-daily','--migrate-isolated-k3'],['--packaged','--kimi-k31-pro','--migrate-daily-k3'],['--packaged','--kimi-k31-daily','--prepare-only','--migrate-daily-k3']]){
  const r=spawnSync('bash',['scripts/run-local-demo-fast.sh',...args],{env,encoding:'utf8'});
  assert.equal(r.status,1);assert.match(r.stderr,/local demo startup failed:/);assert.equal(r.stdout,'');
 }
 const r=spawnSync('bash',['scripts/run-local-demo-fast.sh'],{env:{...env,YIJIE_FEAT164_DAILY:'true'},encoding:'utf8'});
 assert.equal(r.status,1);assert.match(r.stderr,/explicit canonical selector/);assert.equal(r.stdout,'');
});
