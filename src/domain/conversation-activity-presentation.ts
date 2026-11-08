import { observedProgressMessages, tailCommentaryCandidate } from "./conversation-process";
import { traceDiagnosticBlocksLive } from "./conversation-trace-liveness";
import { reasoningSummaryIsCurrent } from "./conversation-reasoning-summary";
import { activityEntriesForItem, type ConversationActivityEntry } from "./conversation-activity-entry";
import type { ConversationTimelineItemViewModel as Item, ConversationTimelineTurnViewModel as Turn } from "./conversation-timeline";

export type ConversationActivityHeaderState =
  | Readonly<{kind: "summary" | "thinking"; label?: string}>
  | Readonly<{kind: "active"; entry: ConversationActivityEntry}>;
export type ConversationActivityGroup = Readonly<{ identity: string; items: readonly Item[]; entries: readonly ConversationActivityEntry[]; state: ConversationActivityHeaderState }>;
export type ConversationReadingNode =
  | Readonly<{ kind: "activity"; identity: string; group: ConversationActivityGroup }>
  | Readonly<{ kind: "message" | "attention"; identity: string; item: Item; process: boolean; answerCandidate: boolean }>;

/** Pure reading index. Ordinary reasoning is context, not a tool row or boundary.
 * Original phases and identities are never rewritten; there is no event reduction or persistence. */
export function conversationActivityPresentation(turn: Turn, attentionIds: ReadonlySet<string> = new Set(), preserveUnclassified = false, commentaryMode: "all" | "latest" = "all"): readonly ConversationReadingNode[] {
  const nodes: ConversationReadingNode[] = [];
  // Current providers may omit phase. Reuse the existing Codex-compatible
  // reading rule: only an observed continuation can fold an intermediate
  // message, and the last readable answer is never hidden by trailing work.
  const observed = preserveUnclassified ? new Set<string>() : observedProgressMessages(turn.items);
  const candidate = tailCommentaryCandidate(turn.items);
  let pending: Item[] = [];
  const flush = () => {
    if (!pending.length) return;
    const identity = `${turn.identity}:activity:${pending[0]!.identity}`;
    nodes.push({kind: "activity", identity, group: {identity, items: pending, entries: pending.flatMap(activityEntriesForItem), state: {kind: "summary"}}});
    pending = [];
  };
  for (const item of turn.items) {
    // Every fact stays in turn.items. Only explicit reasoning diagnostics are
    // attention rows; ordinary reasoning never anchors a tool group.
    if (item.presentation === "reasoning" && !["stream_gap", "runtime_error", "protocol_error", "host_shutdown", "limit_exceeded"].includes(item.reasoning?.reasonCode ?? "")) continue;
    const attention = attentionIds.has(item.identity) || item.approval?.status === "pending" ||
      Boolean(item.activityLabel) || (item.availability === "partial" && ["commentary", "assistant_unclassified", "final_answer"].includes(item.presentation)) || (item.reasoning != null && (item.reasoning.reasonCode != null || item.reasoning.status === "incomplete")) || item.execution?.status === "incomplete" || item.availability === "unavailable" ||
      (item.execution != null && ["failed", "declined", "cancelled"].includes(item.execution.status));
    if (attention || !["reasoning", "command", "tool", "web_search", "unknown"].includes(item.presentation)) {
      flush();
      const answerCandidate = item.identity === candidate;
      nodes.push({kind: attention ? "attention" : "message", identity: item.identity, item, answerCandidate,
        process: !answerCandidate && (item.presentation === "commentary" || observed.has(item.identity))});
    } else pending.push(item);
  }
  flush();
  const latest = nodes[nodes.length - 1];
  if (latest?.kind === "activity" && traceIsLive(turn)) {
    const active = [...latest.group.entries].reverse().find(entry => entry.item.busy);
    const retry = turn.traceNotices?.[turn.traceNotices.length - 1];
    const retrying = retry?.scope === "turn" && retry.method === "error" && retry.willRetry === true && retry.sequence === turn.traceSequence;
    nodes[nodes.length - 1] = {...latest, group: {...latest.group, state: retrying ? {kind: "thinking", label: "运行时正在重试"} : active ? {kind: "active", entry: active} : reasoningSummaryIsCurrent(turn) ? {kind: "summary"} : {kind: "thinking"}}};
  }
  if (commentaryMode === "latest") {
    const latestCommentary = [...nodes].reverse().find(node => node.kind === "message" && node.item.presentation === "commentary" && (node.item.busy || node.item.contentBlocks.some(block => (block.type === "text" || block.type === "code") && block.text.trim())));
    // Build boundaries before hiding older commentary. Adjacent groups remain
    // separate even when the public separator is omitted in latest mode.
    return nodes.filter(node => node.kind !== "message" || node.item.presentation !== "commentary" || node === latestCommentary);
  }
  return nodes;
}

export function traceIsLive(turn: Turn): boolean {
  return turn.liveObserved === true && turn.source === "native_observed" &&
    turn.statusSource === "runtime_notification" && turn.domainStatus === "in_progress" && turn.availability !== "unavailable" && !traceDiagnosticBlocksLive(turn.diagnostic);
}

export function traceCurrentStatus(turn: Turn): string | null {
  if ((turn.liveObserved === true && turn.source === "native_observed" && turn.statusSource === "runtime_notification" && turn.domainStatus === "waiting_approval") || turn.items.some(item => item.approval?.status === "pending")) return "等待你的确认";
  if (!traceIsLive(turn)) return null;
  if (reasoningSummaryIsCurrent(turn)) return null;
  // Current tool/thinking feedback belongs to the latest group's header.
  const nodes = conversationActivityPresentation(turn);
  const lastNode = nodes[nodes.length - 1];
  if (lastNode?.kind === "activity") return null;
  const retry = turn.traceNotices?.[turn.traceNotices.length - 1];
  if (retry?.scope === "turn" && retry.method === "error" && retry.willRetry === true && retry.sequence === turn.traceSequence) return "运行时正在重试";
  const latest = turn.items[turn.items.length - 1];
  if (latest?.presentation === "context_update" && latest.contextUpdateState === "in_progress") return null;
  if (latest?.presentation === "commentary" && latest.busy && latest.contentBlocks.some(block => (block.type === "text" || block.type === "code") && block.text.trim())) return null;
  if (latest && ["final_answer", "assistant_unclassified"].includes(latest.presentation) && latest.contentBlocks.some(block => (block.type === "text" || block.type === "code") && block.text.trim())) return null;
  if (latest?.busy && ["command", "tool", "web_search"].includes(latest.presentation)) return null;
  if (latest?.presentation === "reasoning") return "正在思考";
  return "等待模型继续输出";
}
