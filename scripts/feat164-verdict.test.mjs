import test from "node:test";
import assert from "node:assert/strict";
import {classifyFEAT164Observation,observeWithDeadline} from "./feat164-verdict.mjs";
const positive={sourcePinned:true,controllerHealthy:true,platformReady:true,productionObserved:true,modelMatched:true,persisted:true,reopened:true,normalCleanup:true};
test("FEAT-164 verdict controls preserve attribution and reject ambiguous evidence",()=>{
 assert.equal(classifyFEAT164Observation(positive).status,"PASS");
 for(const [field,kind] of [["sourcePinned","gate_failure"],["controllerHealthy","harness_failure"],["platformReady","platform_failure"],["modelMatched","product_failure"]])assert.equal(classifyFEAT164Observation({...positive,[field]:false}).failure_class,kind);
 assert.equal(classifyFEAT164Observation({...positive,platformReady:false,sourcePinned:false}).status,"DIAGNOSIS_REQUIRED");
 assert.equal(classifyFEAT164Observation({...positive,productionObserved:false,modelMatched:false}).status,"DIAGNOSIS_REQUIRED");
 assert.equal(classifyFEAT164Observation({...positive,persisted:null}).status,"DIAGNOSIS_REQUIRED");
});
test("FEAT-164 evidence is closed and content-free",()=>{
 assert.throws(()=>classifyFEAT164Observation({...positive,unexpected:"ordinary extra text"}));
 assert.throws(()=>classifyFEAT164Observation({...positive,modelMatched:"yes"}));
 assert.deepEqual(Object.keys(classifyFEAT164Observation(positive)).sort(),["code","failure_class","status"]);
});
test("FEAT-164 deadline uses cooperative cancellation and exactly one cleanup",async()=>{
 let cleanup=0;
 const result=await observeWithDeadline(signal=>new Promise(resolve=>signal.addEventListener("abort",()=>resolve("cancelled"),{once:true})),async()=>{cleanup++;},10);
 assert.equal(result,"cancelled");assert.equal(cleanup,1);
});
test("FEAT-164 ordinary observer completion also cleans up exactly once",async()=>{
 let cleanup=0;
 assert.equal(await observeWithDeadline(async()=>"observed",async()=>{cleanup++;},1000),"observed");
 assert.equal(cleanup,1);
});
