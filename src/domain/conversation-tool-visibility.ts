import { activityNativeItem, deepSearchReceipt } from "./conversation-activity-entry";
import type { ConversationTimelineItemViewModel as Item } from "./conversation-timeline";
import { hasWebRetrievalError } from "./web-retrieval-display";

export function isToolActivity(item: Item): boolean {
  return item.execution != null || ["command", "tool", "web_search"].includes(item.presentation);
}

/** Reading policy only. The original items still establish message order and approval identity. */
export function showConversationActivity(item: Item): boolean {
  if (!isToolActivity(item)) return true;
  const execution = item.execution;
  if (item.activityLabel || item.availability === "unavailable") return false;
  if (!execution) return item.presentation === "web_search" && (item.busy === true || item.domainStatus === "completed");
  if ("error" in execution && execution.error) return false;

  const running = item.busy === true && (execution.status === "running" || execution.status === "in_progress");
  if (!running && execution.status !== "completed") return false;
  if (execution.kind === "command") {
    const exitCode = "native" in execution ? execution.native.item.exitCode : execution.exitCode;
    return exitCode == null ? running : exitCode === 0;
  }
  const receipt = deepSearchReceipt(item);
  if (receipt) {
    const pending = running && receipt.outcome === "pending" && receipt.dispatch !== "not_dispatched";
    const hasResult = receipt.dispatch === "responded" && ["results", "empty", "partial"].includes(receipt.outcome);
    if (receipt.availability === "unavailable" || (!pending && !hasResult)) return false;
  }
  const mcp = activityNativeItem(item)?.mcp;
  return !mcp || (mcp.server !== "yijie_web" && mcp.server !== "yijie_market") ||
    !mcp.texts.some(block => hasWebRetrievalError(mcp.tool, block.text));
}
