import { expect, it } from "vitest";
import type { NativeConversationView } from "../api/generated/native-conversation-private.gen";
import { validateNativeHistory, validateNativeViewEvent } from "../api/generated/native-conversation-validator.gen.js";
import { composeConversationView, selectConversationTurn, type ConversationSnapshot } from "./conversation-view";

it.each(["failed", "completed", "interrupted"] as const)("FEAT-164 preserves native read terminal %s with empty content", (status) => {
  const snapshot: ConversationSnapshot = {threads:[{threadId:"local-session",status:"ready"}],turns:[{threadId:"local-session",turnId:"local-turn",ordinal:0,status:"completed",terminalStatus:"completed"}],items:[]};
  const read: NativeConversationView = {sessionId:"local-session",turnId:"local-turn",runtimeThreadId:"runtime-thread",runtimeTurnId:"runtime-turn",source:"native_observed",statusSource:"runtime_read",revision:"2",availability:"available",status,terminalObserved:true,items:[]};
  const event = {schemaVersion:4,contextId:"c",subscriptionId:"s",sessionId:read.sessionId,view:read};
  expect(validateNativeViewEvent(event)).toBe(true);
  expect(validateNativeViewEvent({...event,schemaVersion:5})).toBe(false);
  expect(validateNativeHistory({views:[read],submissions:[],remainingTurnIds:[],historyAvailability:"partial"})).toBe(true);
  expect(selectConversationTurn(composeConversationView(snapshot,[read]),read.sessionId,read.turnId)).toMatchObject({status,terminalStatus:status});
});
