import { describe, expect, it } from "vitest";
import type { NativeConversationView } from "../api/generated/native-conversation-private.gen";
import { composeConversationView, selectConversationTurn, type ConversationSnapshot } from "./conversation-view";
import { validateNativeHistory, validateNativeViewEvent } from "../api/generated/native-conversation-validator.gen.js";
const legacy: ConversationSnapshot = {threads:[{threadId:"local-session",status:"ready"}],turns:[{threadId:"local-session",turnId:"local-turn",ordinal:0,status:"failed",terminalStatus:"failed"}],items:[{threadId:"local-session",turnId:"local-turn",itemId:"old-display",ordinal:0,kind:"assistant_message",status:"completed",contentBlocks:[{type:"text",blockIndex:0,text:"old archive"}]}]};
const native: NativeConversationView = {sessionId:"local-session",turnId:"local-turn",runtimeThreadId:"runtime-thread",runtimeTurnId:"runtime-turn",source:"native_observed",revision:"2",availability:"partial",status:"failed",terminalObserved:true,items:[{item:{id:"native-a",type:"agentMessage",phase:"final_answer",text:"original final",availability:"available"},ordinal:0,lastMethod:"item/completed"},{item:{id:"native-r",type:"reasoning",content:["unfinished"],availability:"available"},ordinal:1,lastMethod:"item/started"}]};
describe("FEAT-132 readonly native view",()=>{
 it("uses a whole native Item set without joining legacy identities or content",()=>{const view=composeConversationView(legacy,[native]);expect(Object.values(view.items).map(i=>i.itemId)).toEqual(["native-a","native-r"]);expect(selectConversationTurn(view,"local-session","local-turn")).toMatchObject({source:"native_observed",status:"failed",terminalStatus:"failed",availability:"partial"});});
 it("does not seal unfinished Items from a terminal Turn",()=>{const view=composeConversationView(legacy,[native]);expect(Object.values(view.items).find(i=>i.itemId==="native-r")).toMatchObject({status:"streaming",reasoning:{status:"in_progress"}});});
 it("renders final values directly without prefix comparison",()=>{const view=composeConversationView(legacy,[{...native,items:[{...native.items[0]!,item:{...native.items[0]!.item,text:"completely revised final"}}]}]);expect(Object.values(view.items)[0]?.contentBlocks).toEqual([{type:"text",blockIndex:0,text:"completely revised final"}]);});
 it("keeps legacy IDs and archive provenance when no native facts exist",()=>{const view=composeConversationView(legacy,[]);expect(Object.values(view.items)[0]?.itemId).toBe("old-display");expect(Object.values(view.turns)[0]?.source).toBe("legacy_archive");});
 it("marks queued submission failure separately from native execution",()=>{const view=composeConversationView(legacy,[],[{turnId:"local-turn",operationId:"operation",status:"failed"}]);expect(Object.values(view.turns)[0]).toMatchObject({source:"local_submission",submissionStatus:"failed",status:"queued",terminalStatus:null});});
 it("validates the generated private boundary and rejects unknown status/version",()=>{
   const event={schemaVersion:1,contextId:"c",subscriptionId:"s",sessionId:native.sessionId,view:native};expect(validateNativeViewEvent(event)).toBe(true);
   expect(validateNativeViewEvent({...event,schemaVersion:2})).toBe(false);expect(validateNativeViewEvent({...event,view:{...native,status:"guess-failed"}})).toBe(false);
   expect(validateNativeHistory({views:[native],submissions:[],remainingTurnIds:[],historyAvailability:"partial"})).toBe(true);
 });
});
