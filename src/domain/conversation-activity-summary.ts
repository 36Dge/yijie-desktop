import type { ConversationTimelineItemViewModel as Item } from "./conversation-timeline";
import type { ConversationActivityGroup } from "./conversation-activity-presentation";
import { deepSearchEvidence, deepSearchReceipt, activityEntriesForItem, activityItemIcon, activityNativeItem, activityToolTitle, activityWebTitle } from "./conversation-activity-entry";
import { activitySummaryTitle } from "./conversation-activity-title";

export function activityItemTitle(item: Item): string {
  if (item.presentation === "web_search") return activityWebTitle(item);
  if (item.presentation === "tool") return activityToolTitle(item);
  if (item.presentation === "command") {
    const entries = activityEntriesForItem(item);
    return entries.length === 1 ? entries[0]!.title : "运行命令";
  }
  return item.presentation === "reasoning" ? "过程记录" : "其他活动";
}

export function summarizeActivity(group: ConversationActivityGroup, live: boolean, titleForEntries = activitySummaryTitle) {
  const calls = group.items.filter(item => ["command", "tool", "web_search"].includes(item.presentation));
  const sources = new Set(calls.flatMap(item => item.webSearch?.sources?.map(source => source.url) ?? []));
  const typed = group.entries.filter(e => deepSearchReceipt(e.item));
  const facts = typed.map(entry => deepSearchReceipt(deepSearchEvidence(entry.item, entry.searchCalls))!);
  const dispatched = facts.filter(fact => fact.dispatch === "responded").length;
  const fetches = typed.filter(entry => activityNativeItem(entry.item)?.mcp?.tool === "kimi_web_fetch" && deepSearchReceipt(deepSearchEvidence(entry.item, entry.searchCalls))?.dispatch === "responded").length;
  const attempted = facts.filter(fact => fact.dispatch === "attempted").length;
  const receipts = typed.flatMap(entry => entry.searchCalls ?? [entry.item]).map(deepSearchReceipt);
  const reused = receipts.filter(fact => fact?.relation === "reused").length;
  const joined = receipts.filter(fact => fact?.relation === "joined").length;
  const ordinary = calls.length - typed.length;
  const actions = calls.reduce((count, item) => count + (activityNativeItem(item)?.commandActions?.length ?? 0), 0);
  const unsupported = group.items.filter(item => item.presentation === "unknown").length;
  const state = live ? group.state : {kind: "summary" as const};
  const activeItem = state.kind === "summary" ? undefined : state.entry?.item;
  const iconItem = activeItem ?? calls[calls.length - 1];
  return {
    title: state.kind === "active" ? `正在${state.entry.title}` : state.kind === "thinking" ? state.label ?? "正在思考" : titleForEntries(group.entries),
    state: state.kind,
    key: state.kind === "active" ? `active:${state.entry.identity}` : state.kind,
    icon: iconItem ? activityItemIcon(iconItem) : "warning" as const,
    callCount: calls.length, actionCount: actions, sourceCount: sources.size,
    counts: [dispatched > fetches ? `${dispatched - fetches} 次实际搜索` : "", fetches ? `${fetches} 次实际取页` : "", reused ? `复用 ${reused} 次` : "", joined ? `并发合并 ${joined} 次` : "", attempted ? `${attempted} 项已尝试发送` : "", ordinary ? `${ordinary} 次调用` : "", actions ? `${actions} 个命令动作` : "", sources.size ? `${sources.size} 个来源` : "", unsupported ? `${unsupported} 项暂不支持展示` : ""].filter(Boolean).join(" · "),
  };
}
