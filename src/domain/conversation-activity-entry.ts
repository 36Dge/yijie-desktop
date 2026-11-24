import type { YjIconName } from "../icons/registry";
import type { ConversationTimelineItemViewModel as Item } from "./conversation-timeline";
import { legacyMcpTitle, nativeMcpLabels, nativeMcpRowTitle } from "./native-mcp-display";

/** A reading row references a native fact; it is never another execution. */
export type ConversationActivityEntry = Readonly<{
  identity: string;
  item: Item;
  actionIndex?: number;
  imageViewNumber?: number;
  repeatCallTimeMs?: number;
  searchCalls?: readonly Item[];
  category: "command" | "read" | "listFiles" | "search" | "tool" | "web_search" | "unknown";
  title: string;
}>;

export function activityNativeItem(item: Item) {
  return item.execution && "native" in item.execution ? item.execution.native.item : null;
}

export function activityItemIcon(item: Item, mcp = activityNativeItem(item)?.mcp): YjIconName {
  switch (item.presentation) {
    case "user_message": return "user";
    case "final_answer":
    case "assistant_unclassified": return "assistant";
    case "commentary":
    case "reasoning": return "pending";
    case "artifact": return "file";
    case "command": return item.execution?.kind === "command" ? "terminal" : "workspace";
    case "web_search": return "globe";
    case "tool": {
      const type = activityNativeItem(item)?.type;
      if (type === "fileChange") return "fileEdit";
      if (type === "imageView") return "viewImage";
      if (mcp?.server === "yijie_web") {
        if (mcp.tool === "kimi_web_search_pro") return "scanSearch";
        if (mcp.tool === "kimi_web_fetch") return "readPage";
      }
      return type === "mcpToolCall" ? "connector" : "skillOperations";
    }
    default: return "warning";
  }
}

export function deepSearchReceipt(item: Item) {
  const mcp = activityNativeItem(item)?.mcp;
  return mcp?.server === "yijie_web" && mcp.tool === "kimi_web_search_pro" && mcp.searchReceipt?.version === 2 ? mcp.searchReceipt : undefined;
}

/** Pick the best settled evidence for the primary card without moving its position. */
export function deepSearchEvidence(item: Item, calls?: readonly Item[]): Item {
  function rank(candidate: Item) {
    const receipt = deepSearchReceipt(candidate);
    if (!receipt) return 0;
    const terminal = ["results", "empty", "partial", "failed"].includes(receipt.outcome);
    return (receipt.dispatch === "responded" ? 8 : receipt.dispatch === "attempted" ? 4 : 0) +
      (terminal ? 2 : 0) + (receipt.availability === "available" ? 1 : 0);
  }
  let best = item;
  let score = rank(item);
  for (const candidate of calls ?? []) {
    const next = rank(candidate);
    if (next > score) { best = candidate; score = next; }
  }
  return best;
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

export function activityToolSourceLabel(item: Item): string | undefined {
  const native = activityNativeItem(item);
  return native?.type === "mcpToolCall" ? nativeMcpLabels(native).source : native?.toolDisplay?.sourceLabel;
}
export function activityToolTitle(item: Item): string {
  const native = activityNativeItem(item);
  if (native?.type === "imageView") return "查看图片";
  if (native?.type === "mcpToolCall") return nativeMcpRowTitle(native);
  if (item.execution?.kind === "tool" && !("native" in item.execution)) return legacyMcpTitle(item.execution);
  return native?.toolDisplay?.title || native?.toolLabel || native?.toolDisplay?.sourceLabel || "调用工具";
}

export function mcpCallStart(item: Item): number | undefined {
  const execution = item.execution;
  if (execution?.kind !== "tool") return;
  if ("native" in execution) return execution.native.item.type === "mcpToolCall" ? execution.native.callStartedAtMs : undefined;
  const start = Date.parse(execution.startedSource.sourceOccurredAt);
  return Number.isFinite(start) ? start : undefined;
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
