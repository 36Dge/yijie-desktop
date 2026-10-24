// Content-free observation classifier used by the manual canonical-App harness.
// An observation file is evidence input, never an instruction to run a model,
// migrate a database, repair a process, or grant a gate.
import assert from "node:assert/strict";
const fields=["sourcePinned","controllerHealthy","platformReady","productionObserved","modelMatched","persisted","reopened","normalCleanup"];
export function classifyFEAT164Observation(value){
 assert(value&&typeof value==="object"&&!Array.isArray(value),"Observation object required");
 assert.deepEqual(Object.keys(value).sort(),[...fields].sort(),"Closed observation fields required");
 for(const key of fields)assert(value[key]===null||typeof value[key]==="boolean","Only boolean or unknown observations are allowed");
 const unknown={status:"DIAGNOSIS_REQUIRED",failure_class:null,code:"observation_incomplete"};
 const causes=[];
 if(value.sourcePinned===false)causes.push(["gate_failure","source_pin_mismatch"]);
 if(value.controllerHealthy===false)causes.push(["harness_failure","controller_unavailable"]);
 if(value.platformReady===false)causes.push(["platform_failure","platform_not_ready"]);
 // Attribute a product failure only after the real production observation
 // point and its three prerequisites have been established.
 if(value.sourcePinned&&value.controllerHealthy&&value.platformReady&&value.productionObserved){
  if(["modelMatched","persisted","reopened","normalCleanup"].some(key=>value[key]===false))causes.push(["product_failure","product_expectation_failed"]);
 }
 if(causes.length>1)return {...unknown,code:"ambiguous_failure"};
 if(causes.length===1)return {status:"FAIL",failure_class:causes[0][0],code:causes[0][1]};
 if(fields.some(key=>value[key]!==true))return unknown;
 return {status:"PASS",failure_class:null,code:"observed_expected_result"};
}

// Ordinary cooperative cancellation boundary. No process signal or executable
// replacement is available here. The caller owns application lifecycle actions.
export async function observeWithDeadline(observe,cleanup,timeoutMs){
 assert(Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=60000);
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{return await observe(controller.signal);}finally{clearTimeout(timer);await cleanup();}
}
