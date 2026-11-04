import type { ConversationTimelineItemViewModel as Item } from "./conversation-timeline";
import type { ConversationActivityGroup } from "./conversation-activity-presentation";
import { activityEntriesForItem, activityNativeItem, activityToolTitle, activityWebTitle } from "./conversation-activity-entry";

export function activityItemTitle(item: Item): string {
  if (item.presentation === "web_search") return activityWebTitle(item);
  if (item.presentation === "tool") return activityToolTitle(item);
  if (item.presentation === "command") {
    const entries = activityEntriesForItem(item);
    return entries.length === 1 ? entries[0]!.title : "运行命令";
  }
  return item.presentation === "reasoning" ? "过程记录" : "其他活动";
}

export function summarizeActivity(group: ConversationActivityGroup, live: boolean) {
  const calls = group.items.filter(item => ["command", "tool", "web_search"].includes(item.presentation));
  const toolSources = [...new Set(calls.flatMap(item => {
    const label = item.presentation === "tool" ? activityNativeItem(item)?.toolDisplay?.sourceLabel : null;
    return label ? [label] : [];
  }))];
  const sources = new Set(calls.flatMap(item => item.webSearch?.sources?.map(source => source.url) ?? []));
  const actions = calls.reduce((count, item) => count + (activityNativeItem(item)?.commandActions?.length ?? 0), 0);
  const categories = new Set(group.entries.map(entry => entry.category));
  const parts: string[] = [];
  if (toolSources.length) parts.push(`已使用 ${toolSources.join("、")}`);
  if (calls.some(item => item.presentation === "tool" && !activityNativeItem(item)?.toolDisplay?.sourceLabel)) parts.push("调用了工具");
  if (categories.has("read") || categories.has("listFiles") || categories.has("search")) parts.push("查看了项目内容");
  if (categories.has("command")) parts.push("运行了命令");
  const webActions = new Set(calls.filter(item => item.presentation === "web_search").map(item => item.webSearch?.action));
  if (webActions.has("search")) parts.push("搜索了网页");
  if (webActions.has("openPage")) parts.push("阅读了网页");
  if (webActions.has("findInPage")) parts.push("查找了网页内容");
  if ([...webActions].some(action => !["search", "openPage", "findInPage"].includes(action ?? ""))) parts.push("网页活动");
  const state = live ? group.state : {kind: "summary" as const};
  return {
    title: state.kind === "active" ? `正在${state.entry.title}` : state.kind === "thinking" ? state.label ?? "正在思考" : parts.join("、") || "其他活动",
    state: state.kind,
    key: state.kind === "active" ? `active:${state.entry.identity}` : state.kind,
    icon: categories.has("tool") ? "skillOperations" as const : categories.has("web_search") ? "globe" as const : "terminal" as const,
    callCount: calls.length, actionCount: actions, sourceCount: sources.size,
    counts: [calls.length ? `${calls.length} 次调用` : "", actions ? `${actions} 个命令动作` : "", sources.size ? `${sources.size} 个来源` : ""].filter(Boolean).join(" · "),
  };
}
