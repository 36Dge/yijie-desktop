import {expect,it,vi} from "vitest";
import {createMarketHostNativeClient} from "./market-host-native-client";
import {createExpertNativeClient} from "./expert-native-client";
import {executionModelIntent} from "./chat-model-client";
import {marketTestId as id} from "../test/market-chat-fixture";
it.each(["market","expert"] as const)("v2 %s wrapper sends the exact active model and original operation",async family=>{
 const submission={operationId:id(24),projectId:null,contentBlocks:[{type:"text" as const,text:"普通本机提交"}],intent:executionModelIntent({profileId:"kimi-k3-1-pro-max-v1",expectedRevision:0})!,selection:[]};
 expect(submission.intent.profileId).toBe("kimi-k3-1-pro-max-v1");
 expect(executionModelIntent({profileId:"kimi-k3-max-v1",expectedRevision:0})).toBeUndefined();
 const receipt={outcome:"local_durable_accepted",sessionId:id(21),localTurnId:id(23),submissionOperationId:id(24),turnOperationId:id(25),selectionDigest:"c".repeat(64)};
 const transport=vi.fn(async (_command:string,{request}:{request:unknown})=>({schemaVersion:1,requestId:(request as {requestId:string}).requestId,data:family==="market"?receipt:{receipt,bindingRevision:0,expert:null}}));
 if(family==="market")await createMarketHostNativeClient(transport).submit(id(20),submission);
 else await createExpertNativeClient(transport).submit(id(20),{submission,expectedBindingRevision:0,expert:null});
 expect(transport).toHaveBeenCalledOnce();
 const sent=transport.mock.calls[0]?.[1].request;
 expect(JSON.stringify(sent)).toContain('"profileId":"kimi-k3-1-pro-max-v1"');
 expect(JSON.stringify(sent)).toContain(id(24));
});
