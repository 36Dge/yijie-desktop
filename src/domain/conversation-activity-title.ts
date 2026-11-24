import { activityNativeItem, activityToolSourceLabel, type ConversationActivityEntry as Entry } from "./conversation-activity-entry";
import { sorftimeTool, type SorftimeMethod } from "./sorftime-tools";
import { sorftimeActivityTitle } from "./sorftime-activity-title";
import type { ResultCache, ResultRevision } from "./sorftime-result";

type Action = {
  key: string;
  label: string;
  priority: "primary" | "auxiliary" | "fallback";
  source?: string;
  method?: SorftimeMethod;
};
type ActionGroup = Action & {entries: Entry[]; firstIndex: number};

const genericToolTitles = new Set(["调用工具", "调用了工具", "工具调用", "连接器工具", "使用工具", "使用连接器"]);
const categoryLabels = {read: "读取文件", listFiles: "查看目录", search: "搜索项目内容", command: "运行命令", unknown: "其他活动"};

function describeAction(entry: Entry): Action {
  const {item, category} = entry;
  if (category === "web_search") {
    const action = item.webSearch?.action;
    const label = action === "search" ? "搜索网页" : action === "openPage" ? "阅读网页" : action === "findInPage" ? "查找网页内容" : "网页活动";
    return {key: `web:${action}`, label, priority: "primary"};
  }
  if (category !== "tool") return {key: category, label: categoryLabels[category], priority: category === "unknown" ? "fallback" : "primary"};
  const native = activityNativeItem(item);
  if (native?.type === "imageView") return {key: "imageView", label: "查看图片", priority: "primary"};
  const execution = item.execution;
  const legacy = execution?.kind === "tool" && !("native" in execution) && execution.identity.resolution === "known" ? execution.identity : undefined;
  const mcp = native?.type === "mcpToolCall" ? native.mcp : undefined;
  const server = mcp?.server ?? legacy?.serverName;
  const tool = mcp?.tool ?? legacy?.toolName;
  const sorftime = sorftimeTool(server, tool);
  const source = activityToolSourceLabel(item) ?? sorftime?.source;
  // The action portion is display copy. Result identities and counts never come from its wording.
  const label = sorftime?.title ?? entry.title.split(" · ", 1)[0]!;
  if (genericToolTitles.has(label) || label === source || label === `使用 ${source}`) {
    return {key: JSON.stringify(["unnamed", source]), label: "工具调用", priority: "fallback", source};
  }
  return {
    key: JSON.stringify([native?.type ?? "tool", server, tool, source, label]), label, source, method: sorftime?.method,
    priority: sorftime?.auxiliary ? "auxiliary" : "primary",
  };
}

function visibleTargets(entry: Entry): readonly string[] {
  const item = entry.item;
  if (entry.category === "web_search") {
    if (item.webSearch?.action === "search") return item.webSearch.queries ?? [];
    return item.webSearch?.pageLabel ? [item.webSearch.pageLabel] : [];
  }
  const native = activityNativeItem(item);
  if (entry.category === "tool" && native?.toolDisplay?.provenance === "registeredTool") {
    const fields = entry.title.split(" · ");
    return fields.length === 2 ? [fields[1]!] : [];
  }
  if (entry.category === "read" || entry.category === "listFiles") {
    const action = native?.commandActions?.find(action => action.index === entry.actionIndex);
    if (action?.label) return [action.label];
  }
  return [];
}

function groupTitle(group: ActionGroup, cache?: ResultRevision): string {
  const {entries, method, label} = group;
  const count = entries.length;
  if (group.priority === "fallback") {
    if (group.key === "unknown") return count === 1 ? label : `${count} 项其他活动`;
    return group.source ? `调用 ${group.source} 工具 ${count} 次` : `工具调用 ${count} 次`;
  }
  if (method) {
    const title = sorftimeActivityTitle(method, label, entries, cache);
    if (title) return title;
  }
  if (count === 1) {
    if (group.key === "imageView") return "查看了图片";
    if (entries[0]!.title === "运行命令") return "运行了命令";
    return entries[0]!.title;
  }
  if (!method) {
    if (entries.every(entry => entry.title === entries[0]!.title)) return `${entries[0]!.title} ${count} 次`;
    const targets = entries.map(visibleTargets);
    if (targets.every(values => values.length > 0)) {
      const distinct = [...new Set(targets.flat())];
      const preview = distinct.slice(0, 2).join("、");
      if (preview.length <= 28) return `${label}（${preview}${distinct.length > 2 ? `等 ${distinct.length} 项` : ""}）`;
    }
  }
  return `${label} ${count} 次`;
}

/** Summarize only the visible rows of this group. Preserve arrival order when equally ranked. */
export function activitySummaryTitle(entries: readonly Entry[], cache?: ResultRevision): string {
  const actions = new Map<string, ActionGroup>();
  for (const [index, entry] of entries.entries()) {
    const action = describeAction(entry);
    const existing = actions.get(action.key);
    if (existing) existing.entries.push(entry);
    else actions.set(action.key, {...action, entries: [entry], firstIndex: index});
  }
  const groups = [...actions.values()];
  const priority = groups.some(group => group.priority === "primary") ? "primary" :
    groups.some(group => group.priority === "auxiliary") ? "auxiliary" : "fallback";
  const candidates = groups.filter(group => group.priority === priority);
  const selected = candidates.sort((a, b) => b.entries.length - a.entries.length || a.firstIndex - b.firstIndex).slice(0, 2);
  return selected.map(group => {
    const title = groupTitle(group, cache);
    const distinguishSource = group.source && group.priority !== "fallback" &&
      candidates.some(other => other.label === group.label && other.source && other.source !== group.source);
    const phrase = distinguishSource ? `${group.source} · ${title}` : title;
    if (selected.length === 1 || phrase.length <= 48) return phrase;
    const chars = Array.from(phrase);
    return chars.length > 48 ? chars.slice(0, 47).join("") + "…" : phrase;
  }).join("，") || "其他活动";
}

// Native notifications can replace every JS object even when only one item
// changed. Keep one revision per mounted group; removed items leave the cache.
export function createActivityTitleSelector() {
  let previous: ResultCache = new Map();
  return (entries: readonly Entry[]) => {
    const current: ResultCache = new Map();
    const title = activitySummaryTitle(entries, {previous, current});
    previous = current;
    return title;
  };
}
