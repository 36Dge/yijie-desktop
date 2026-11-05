import type { ConversationTimelineItemViewModel as Item } from "./conversation-timeline";

/** A reading row references a native fact; it is never another execution. */
export type ConversationActivityEntry = Readonly<{
  identity: string;
  item: Item;
  actionIndex?: number;
  category: "command" | "read" | "listFiles" | "search" | "tool" | "web_search" | "unknown";
  title: string;
}>;

export function activityNativeItem(item: Item) {
  return item.execution && "native" in item.execution ? item.execution.native.item : null;
}

const genericCommandLabels = new Set(["执行命令", "命令执行", "运行命令", "读取工作区内容", "列出工作区文件", "搜索工作区内容"]);
function commandTitle(item: Item, action?: NonNullable<NonNullable<ReturnType<typeof activityNativeItem>>["commandActions"]>[number]): string {
  const label = action?.label?.trim();
  switch (action?.kind) {
    case "read": return label ? `读取 ${label}` : "读取文件";
    case "listFiles": return label ? `查看 ${label}` : "查看目录";
    case "search": return ["搜索", action.query?.trim(), label].filter(Boolean).join(" · ");
  }
  const preview = label || activityNativeItem(item)?.commandLabel?.trim();
  return preview && !genericCommandLabels.has(preview) ? `运行 ${preview}` : "运行命令";
}

// Display labels for the existing canonical broker tools, not registration or
// permission identities. Unknown services and meaningful native titles keep
// their existing presentation; the underlying fact is never rewritten.
const brokerWebTitles = new Map([
  ["kimi_web_search", "搜索网页（Kimi Basic）"],
  ["kimi_web_search_pro", "搜索网页（Kimi Pro）"],
  ["kimi_web_fetch", "读取网页（Kimi）"],
]);
function knownBrokerWebTitle(item: Item): string | undefined {
  const mcp = activityNativeItem(item)?.mcp;
  return mcp?.server === "yijie_market" ? brokerWebTitles.get(mcp.tool ?? "") : undefined;
}
export function activityToolSourceLabel(item: Item): string | undefined {
  const native = activityNativeItem(item);
  const source = native?.toolDisplay?.sourceLabel;
  return knownBrokerWebTitle(item) && (!source || source === native?.mcp?.server) ? "Kimi 网页检索" : source;
}
export function activityToolTitle(item: Item): string {
  const native = activityNativeItem(item);
  const title = native?.toolDisplay?.title || native?.toolLabel;
  const mcp = native?.mcp;
  const genericIdentity = !title || title === mcp?.tool || title === `${mcp?.server} / ${mcp?.tool}` || title === `${mcp?.server}/${mcp?.tool}` || title === "调用工具";
  return (genericIdentity ? knownBrokerWebTitle(item) : undefined) || title || activityToolSourceLabel(item) || "调用工具";
}

export function activityWebTitle(item: Item): string {
  switch (item.webSearch?.action) {
    case "search": return "搜索网页";
    case "openPage": return "阅读网页";
    case "findInPage": return "查找网页内容";
    default: return "网页活动";
  }
}

export function activityEntriesForItem(item: Item): readonly ConversationActivityEntry[] {
  if (item.presentation === "reasoning") return [];
  const native = activityNativeItem(item);
  if (item.presentation === "command") {
    const actions = native?.status === "declined" ? undefined : native?.commandActions;
    if (actions?.length) return actions.map(action => ({
      identity: actions.length === 1 ? item.identity : `${item.identity}:action:${action.index}`, item, actionIndex: action.index,
      category: action.kind === "unknown" ? "command" : action.kind,
      title: commandTitle(item, action),
    }));
    return [{identity: item.identity, item, category: "command", title: commandTitle(item)}];
  }
  if (item.presentation === "tool") return [{identity: item.identity, item, category: "tool", title: activityToolTitle(item)}];
  if (item.presentation === "web_search") {
    const detail = item.webSearch?.action === "findInPage"
      ? [item.webSearch.pattern, item.webSearch.pageLabel].filter(Boolean).join(" · ")
      : item.webSearch?.queries?.join(" · ") || item.webSearch?.pageLabel;
    return [{identity: item.identity, item, category: "web_search", title: [activityWebTitle(item), detail].filter(Boolean).join(" ")}];
  }
  return [{identity: item.identity, item, category: "unknown", title: "其他活动"}];
}
