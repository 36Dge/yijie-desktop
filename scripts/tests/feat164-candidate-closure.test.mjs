import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kimiCallSurfaces} from '../kimi-k31-build-candidate.mjs';
for(const [mode,flags] of Object.entries({ordinary:[false,false,false],market:[true,false,false],experts:[true,true,false],media:[true,true,true]}))test('FEAT-164 explicit '+mode+' profile',()=>{
 const env={YIJIE_KIMI_K31_CALL_SURFACES:mode,YIJIE_MARKET_CONNECTORS_ENABLED:String(flags[0]),YIJIE_EXPERTS_ENABLED:String(flags[1]),YIJIE_ARTIFACT_MEDIA_ENABLED:String(flags[2]),YIJIE_RUNTIME_PERMISSIONS_ENABLED:'true'};
 assert.deepEqual(kimiCallSurfaces(env),{mode,market:flags[0],experts:flags[1],media:flags[2]});
 assert.throws(()=>kimiCallSurfaces({...env,YIJIE_MARKET_CONNECTORS_ENABLED:String(!flags[0])}));
 if(flags[0])assert.throws(()=>kimiCallSurfaces({...env,YIJIE_RUNTIME_PERMISSIONS_ENABLED:'false'}));
 assert.throws(()=>kimiCallSurfaces({...env,YIJIE_WORKFLOW_ENABLED:'true'}));
});
test('FEAT-164 default stays ordinary and unknown profile cannot activate',()=>{
 assert.equal(kimiCallSurfaces({}).mode,'ordinary');
 assert.throws(()=>kimiCallSurfaces({YIJIE_KIMI_K31_CALL_SURFACES:'future'}));
});
