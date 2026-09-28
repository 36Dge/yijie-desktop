import type { ConversationTimelineItemViewModel } from "./conversation-timeline";

/** Only explicit process kinds participate; an unclassified answer stays readable. */
export function isCollapsibleProcessItem(item: ConversationTimelineItemViewModel): boolean {
  if (!["commentary", "reasoning", "command", "tool"].includes(item.presentation)) return false;
  // Keep decisions and incomplete/error information visible even when the Turn is folded.
  if (item.approval?.status === "pending" || item.domainStatus === "incomplete" || item.activityLabel ||
      (item.availability && item.availability !== "available")) return false;
  if (item.reasoning && (item.reasoning.reasonCode !== null ||
      !["complete", "in_progress"].includes(item.reasoning.status))) return false;
  if (item.presentation === "command" || item.presentation === "tool") {
    if (!item.execution || !["running", "in_progress", "completed"].includes(item.execution.status)) return false;
    if ("error" in item.execution && item.execution.error !== null) return false;
  }
  return true;
}
