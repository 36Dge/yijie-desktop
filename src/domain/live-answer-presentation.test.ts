import { describe, expect, it } from "vitest";
import type { NativeConversationView, NativeConversationViewEvent } from "../api/generated/native-conversation-private.gen";
import { createLiveAnswerPresentation } from "./live-answer-presentation";

describe("declared live public text", () => {
  const base: NativeConversationView = {sessionId:"s",turnId:"t",runtimeTurnId:"rt",runtimeThreadId:"rs",
    status:"inProgress",statusSource:"runtime_notification",source:"native_observed",revision:"1",
    terminalObserved:false,availability:"available",items:[]};
  const event = (view: NativeConversationView, text?: string): NativeConversationViewEvent => ({
    schemaVersion: text ? 8 : 7, contextId:"c", subscriptionId:"sub", sessionId:"s", view,
    ...(text && {previews:[{itemId:"a",text}]}),
  });
  it("keeps the preview on one row and lets a following tool and completion establish commentary", () => {
    const live = createLiveAnswerPresentation();
    live.observe(event(base, "准备资料"), base);
    const preview = live.view(base);
    expect(base.items).toHaveLength(0);
    expect(preview.items[0]?.item).toMatchObject({id:"a",text:"准备资料"});
    expect(preview.items[0]?.item.phase).toBeUndefined();
    expect(live.take({sessionId:"s",turnId:"t",itemId:"a"})).toBe(true);
    const confirmed: NativeConversationView = {...base, revision:"2", items:[{ordinal:0,lastMethod:"item/completed",
      item:{id:"a",type:"agentMessage",availability:"available",phase:"commentary",text:"准备资料"}}]};
    live.observe(event(confirmed),base);
    expect(live.view(confirmed)).toBe(confirmed);
    expect(live.take({sessionId:"s",turnId:"t",itemId:"a"})).toBe(false);
  });
  it("preserves partial text across an empty formal start and clears live state on reopen", () => {
    const live = createLiveAnswerPresentation();
    const started: NativeConversationView = {...base, revision:"2",items:[{ordinal:0,lastMethod:"item/started",
      item:{id:"a",type:"agentMessage",availability:"available",phase:"final_answer",text:""}}]};
    live.observe(event(started,"逐步显示"),base);
    expect(live.view(started).items).toHaveLength(1);
    expect(live.view(started).items[0]?.item.phase).toBeUndefined();
    const completed: NativeConversationView = {...started,revision:"3",status:"completed",terminalObserved:true,
      items:[{...started.items[0]!,lastMethod:"item/completed",item:{...started.items[0]!.item,text:"逐步显示"}}]};
    live.observe(event(completed),started);
    expect(live.view(completed)).toBe(completed);
    live.clear();
    expect(live.take({sessionId:"s",turnId:"t",itemId:"a"})).toBe(false);
  });
});
