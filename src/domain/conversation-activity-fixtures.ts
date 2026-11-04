import type { NativeConversationView, NativeItem } from "../api/generated/native-conversation-private.gen";
import { composeConversationView } from "./conversation-view";
import { selectConversationTimeline } from "./conversation-timeline";
export function traceTurn(items: NativeItem[], live = false) {
  const view: NativeConversationView = {sessionId: "trace-session", turnId: "trace-turn", runtimeThreadId: "runtime-thread", runtimeTurnId: "runtime-turn", revision: "1", source: "native_observed", availability: "available", statusSource: "runtime_notification", status: live ? "inProgress" : "completed", terminalObserved: !live, items: items.map((item, ordinal) => ({item, ordinal, lastMethod: item.status === "inProgress" ? "item/started" : "item/completed"}))};
  const state = composeConversationView({threads: [{threadId: view.sessionId, status: "ready"}], turns: [], items: []}, [view]);
  return {...selectConversationTimeline(state, view.sessionId, undefined, {protectApprovalProcessContent: false, liveTurnId: live ? view.turnId : null})!.turns[0]!};
}
export const traceItem = (id: string, type: NativeItem["type"], extra: Partial<NativeItem> = {}): NativeItem => ({id, type, availability: "available", ...(["commandExecution", "mcpToolCall"].includes(type) ? {status: "completed" as const} : {}), ...extra});
