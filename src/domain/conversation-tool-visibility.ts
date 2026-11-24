import { activityNativeItem, deepSearchReceipt } from "./conversation-activity-entry";
import type { ConversationTimelineItemViewModel as Item } from "./conversation-timeline";
import { hasWebRetrievalError } from "./web-retrieval-display";

export function isToolActivity(item: Item): boolean {
  return item.execution != null || ["command", "tool", "web_search"].includes(item.presentation);
}

/** Read the call's own outcome, including receipts that report an error after execution completed. */
export function toolActivityStatus(item: Item) {
  const execution = item.execution;
  if (item.activityLabel || item.availability === "unavailable") return "unknown";
  if (!execution) {
    if (item.presentation !== "web_search") return "unknown";
    if (item.busy === true) return "running";
    return item.domainStatus === "completed" ? "success" : "unknown";
  }
  if (execution.status === "declined") return "declined";
  if (execution.status === "failed" || ("error" in execution && execution.error)) return "failed";
  if (execution.status === "incomplete") return "incomplete";

  const running = item.busy === true && (execution.status === "running" || execution.status === "in_progress");
  if (!running && execution.status !== "completed") return "unknown";
  const status = running ? "running" : "success";
  if (execution.kind === "command") {
    const exitCode = "native" in execution ? execution.native.item.exitCode : execution.exitCode;
    if (exitCode == null && !running) return "unknown";
    return exitCode != null && exitCode !== 0 ? "failed" : status;
  }
  const receipt = deepSearchReceipt(item);
  if (receipt) {
    if (receipt.dispatch === "not_dispatched") return "not_dispatched";
    if (receipt.outcome === "failed") return "failed";
    const pending = running && receipt.outcome === "pending";
    const hasResult = receipt.dispatch === "responded" && ["results", "empty", "partial"].includes(receipt.outcome);
    if (receipt.availability === "unavailable" || (!pending && !hasResult)) return "unknown";
  }
  const mcp = activityNativeItem(item)?.mcp;
  if (mcp && (mcp.server === "yijie_web" || mcp.server === "yijie_market") &&
      mcp.texts.some(block => hasWebRetrievalError(mcp.tool, block.text))) return "failed";
  return status;
}

/** Reading policy only. The original items still establish message order and approval identity. */
export function showConversationActivity(item: Item): boolean {
  if (!isToolActivity(item)) return true;
  const status = toolActivityStatus(item);
  return status === "running" || status === "success";
}
