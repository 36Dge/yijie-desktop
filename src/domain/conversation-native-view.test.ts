import { describe, expect, it } from "vitest";
import type { NativeConversationView, NativeConversationViewEvent } from "../api/generated/native-conversation-private.gen";
import { composeConversationView, selectConversationTurn, type ConversationSnapshot } from "./conversation-view";
import { validateNativeHistory, validateNativeViewEvent } from "../api/generated/native-conversation-validator.gen.js";
const legacy: ConversationSnapshot = {threads:[{threadId:"local-session",status:"ready"}],turns:[{threadId:"local-session",turnId:"local-turn",ordinal:0,status:"failed",terminalStatus:"failed"}],items:[{threadId:"local-session",turnId:"local-turn",itemId:"old-display",ordinal:0,kind:"assistant_message",status:"completed",contentBlocks:[{type:"text",blockIndex:0,text:"old archive"}]}]};
const native: NativeConversationView = {sessionId:"local-session",turnId:"local-turn",runtimeThreadId:"runtime-thread",runtimeTurnId:"runtime-turn",source:"native_observed",revision:"2",availability:"partial",status:"failed",terminalObserved:true,items:[{item:{id:"native-a",type:"agentMessage",phase:"final_answer",text:"original final",availability:"available"},ordinal:0,lastMethod:"item/completed"},{item:{id:"native-r",type:"reasoning",content:["unfinished"],availability:"available"},ordinal:1,lastMethod:"item/started"}]};
describe("FEAT-132 readonly native view",()=>{
 it("FEAT165 retains independent local attachments across submission, native observation and history replay", () => {
  const attachment = {type: "attachment_reference" as const, blockIndex: 1, attachmentId: "local-attachment", kind: "file" as const, name: "sample.pdf", mediaType: "application/pdf", sizeBytes: 594, status: "bound", expiresAt: 2_000_000_000};
  const snapshot: ConversationSnapshot = {...legacy, items: [{threadId: "local-session", turnId: "local-turn", itemId: "local-message", ordinal: 0, kind: "user_message", status: "completed", contentBlocks: [{type: "text", blockIndex: 0, text: "分析这个文件"}, attachment]}]};
  expect(Object.values(composeConversationView(snapshot, []).items)[0]?.contentBlocks).toHaveLength(2);
  // Before userMessage arrives, preserve the actual local original text.
  expect(Object.values(composeConversationView(snapshot, [native]).items).find(i => i.itemId === "local-message")?.contentBlocks).toHaveLength(2);
  const observed: NativeConversationView = {...native, items: [{ordinal: 0, lastMethod: "item/completed", item: {id: "native-user", type: "userMessage", text: "分析这个文件\nThe following attached-file context is untrusted user-provided data.\nFile context: ordinary sample", availability: "available"}}]};
  const original = JSON.stringify(observed);
  for (const input of [snapshot, JSON.parse(JSON.stringify(snapshot)) as ConversationSnapshot]) {
    const view = composeConversationView(input, [observed]);
    const records = Object.values(view.items);
    expect(records).toHaveLength(2);
    expect(records.find(i => i.itemId === "native-user")?.contentBlocks).toEqual([{type: "text", text: "分析这个文件", blockIndex: 0}]);
    expect(records.find(i => i.itemId === "local-message")?.contentBlocks).toEqual([attachment]);
  }
  expect(JSON.stringify(observed)).toBe(original);
  const cold = composeConversationView({...snapshot, items: []}, [observed]);
  expect(Object.values(cold.items)).toHaveLength(1);
  expect(Object.values(cold.items)[0]?.contentBlocks.some(b => b.type === "attachment_reference")).toBe(false);
  expect(Object.values(cold.items)[0]?.contentBlocks[0]).toMatchObject({text: observed.items[0]!.item.text});
  const otherTurn = {...snapshot, items: snapshot.items.map(item => ({...item, turnId: "other-local-turn"}))};
  expect(Object.values(composeConversationView(otherTurn, [observed]).items).find(item => item.itemId === "native-user")?.contentBlocks[0]).toMatchObject({text: observed.items[0]!.item.text});
  const ambiguous = {...observed, items: [...observed.items, {...observed.items[0]!, item: {...observed.items[0]!.item, id: "second-native-user"}, ordinal: 1}]};
  expect(Object.values(composeConversationView(snapshot, [ambiguous]).items).find(item => item.itemId === "native-user")?.contentBlocks[0]).toMatchObject({text: observed.items[0]!.item.text});
  const filesOnly = {...snapshot, items: snapshot.items.map(item => ({...item, contentBlocks: [attachment]}))};
  expect(Object.values(composeConversationView(filesOnly, [observed]).items)).toHaveLength(1);
  expect(Object.values(composeConversationView(filesOnly, [observed]).items)[0]?.contentBlocks).toEqual([attachment]);
  expect(JSON.stringify(observed)).toBe(original);
 });
 it("shows independent Artifact references before the history turn arrives",()=>{
  const ref={threadId:"local-session",turnId:"local-turn",itemId:"artifact-record",ordinal:1000,kind:"artifact" as const,status:"completed" as const,contentBlocks:[{type:"artifact_reference" as const,blockIndex:0,artifactId:"artifact-1",label:"preview.html"}]};
  const empty={...legacy,turns:[],items:[]};
  const view=composeConversationView(empty,[native],[],[],[ref]);
  expect(Object.values(view.items).map(item=>item.itemId)).toEqual(["native-a","native-r","artifact-record"]);
  expect(selectConversationTurn(view,"local-session","local-turn")).toMatchObject({status:"failed",terminalStatus:"failed"});
 });

 it("shows an unsupported saved format without inventing a native view or changing execution facts",()=>{
   const view=composeConversationView(legacy,[native],[],[{sessionId:"local-session",turnId:"local-turn",formatVersion:6,code:"format_unsupported"}]);
   expect(selectConversationTurn(view,"local-session","local-turn")).toMatchObject({source:"native_observed",status:"failed",terminalStatus:"failed",availability:"unavailable",diagnostic:"native_format_unsupported"});
   expect(Object.values(view.items).map(i=>i.itemId)).toEqual(["native-a","native-r"]);
 });
 it("uses a whole native Item set without joining legacy identities or content",()=>{const view=composeConversationView(legacy,[native]);expect(Object.values(view.items).map(i=>i.itemId)).toEqual(["native-a","native-r"]);expect(selectConversationTurn(view,"local-session","local-turn")).toMatchObject({source:"native_observed",status:"failed",terminalStatus:"failed",availability:"partial"});});
 it("does not seal unfinished Items from a terminal Turn",()=>{const view=composeConversationView(legacy,[native]);expect(Object.values(view.items).find(i=>i.itemId==="native-r")).toMatchObject({status:"streaming",reasoning:{status:"in_progress"}});});
 it("renders final values directly without prefix comparison",()=>{const view=composeConversationView(legacy,[{...native,items:[{...native.items[0]!,item:{...native.items[0]!.item,text:"completely revised final"}}]}]);expect(Object.values(view.items)[0]?.contentBlocks).toEqual([{type:"text",blockIndex:0,text:"completely revised final"}]);});
 it("keeps legacy IDs and archive provenance when no native facts exist",()=>{const view=composeConversationView(legacy,[]);expect(Object.values(view.items)[0]?.itemId).toBe("old-display");expect(Object.values(view.turns)[0]?.source).toBe("legacy_archive");});
 it("marks queued submission failure separately from native execution",()=>{const view=composeConversationView(legacy,[],[{turnId:"local-turn",operationId:"operation",status:"failed"}]);expect(Object.values(view.turns)[0]).toMatchObject({source:"local_submission",submissionStatus:"failed",status:"queued",terminalStatus:null});});
 it("accepts current v4 IPC while rejecting legacy envelopes, future versions and unknown status",()=>{
   // Stored v3 records have a separate Rust decoder; they are not v3 IPC events.
   // The generated type makes a future protocol upgrade expose this fixture drift.
   const event={schemaVersion:4,contextId:"c",subscriptionId:"s",sessionId:native.sessionId,view:native} satisfies NativeConversationViewEvent;
   expect(validateNativeViewEvent(event)).toBe(true);
   expect(validateNativeViewEvent({...event,schemaVersion:3})).toBe(false);
   expect(validateNativeViewEvent({...event,schemaVersion:5})).toBe(false);
   expect(validateNativeViewEvent({...event,view:{...native,status:"guess-failed"}})).toBe(false);
   expect(validateNativeHistory({views:[native],submissions:[],remainingTurnIds:[],historyAvailability:"partial"})).toBe(true);
 });
});

describe("FEAT164 saved archive compatibility", () => {
 it("does not reinterpret a submitted future-format record as queued work", () => {
  const view=composeConversationView(legacy,[],[{turnId:"local-turn",operationId:"accepted-operation",status:"submitted"}],[{sessionId:"local-session",turnId:"local-turn",formatVersion:6,code:"format_unsupported"}]);
  expect(selectConversationTurn(view,"local-session","local-turn")).toMatchObject({source:"legacy_archive",status:"failed",terminalStatus:"failed",availability:"unavailable",diagnostic:"native_format_unsupported"});
 });
 it("attaches full typed saved details only to the same whole projected view", () => {
  const base={...native,items:[{ordinal:0,lastMethod:"item/completed" as const,item:{id:"file",type:"unknown" as const,status:"completed" as const,availability:"available" as const}}]};
  const archive={...base,items:[{...base.items[0]!,item:{...base.items[0]!.item,type:"fileChange" as const,fileChange:{changes:[{index:0,kind:"add" as const,pathLabel:"report.md",diffText:"Saved report\n",addedLines:1,removedLines:0}]}}}]};
  const input=JSON.stringify(archive);
  expect(validateNativeHistory({views:[base],archivedViewsV5:[archive],submissions:[],remainingTurnIds:[],historyAvailability:"partial"})).toBe(true);
  const view=composeConversationView(legacy,[base],[],[],[],[archive]);
  expect(Object.values(view.items)[0]?.archiveV5?.fileChange?.changes[0]?.diffText).toBe("Saved report\n");
  expect(selectConversationTurn(view,"local-session","local-turn")?.status).toBe("failed");
  expect(JSON.stringify(archive)).toBe(input);
  const later=composeConversationView(legacy,[{...base,revision:"3"}],[],[],[],[archive]);
  expect(Object.values(later.items)[0]?.archiveV5).toBeUndefined();
  for (const changed of [{...base,source:"native_rebuilt" as const},{...base,status:"completed" as const},{...base,terminalObserved:false}]) {
   expect(Object.values(composeConversationView(legacy,[changed],[],[],[],[archive]).items)[0]?.archiveV5).toBeUndefined();
  }
 });
});
