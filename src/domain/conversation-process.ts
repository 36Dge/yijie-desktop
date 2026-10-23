import type { ConversationTimelineItemViewModel, ConversationTimelineTurnViewModel } from "./conversation-timeline";

/** Only explicit process kinds participate; an unclassified answer stays readable. */
export function isCollapsibleProcessItem(item: ConversationTimelineItemViewModel, observedProgress = false): boolean {
  if (!["commentary", "reasoning", "command", "tool", "web_search", "unknown"].includes(item.presentation) && !observedProgress) return false;
  // An unsupported display type is not a failed execution. Keep its original
  // record in details rather than turning every successful search into an alert.
  if (item.presentation === "unknown" && item.domainStatus === "completed" && !item.approval && !item.activityLabel) return true;
  // Keep decisions and incomplete/error information visible even when the Turn is folded.
  if (item.approval?.status === "pending" || item.domainStatus === "incomplete" || item.activityLabel ||
      (item.availability && item.availability !== "available" &&
        !(item.presentation === "web_search" && item.domainStatus === "completed"))) return false;
  if (item.reasoning && (item.reasoning.reasonCode !== null ||
      !["complete", "in_progress"].includes(item.reasoning.status))) return false;
  if (item.presentation === "command" || item.presentation === "tool") {
    if (!item.execution || !["running", "in_progress", "completed"].includes(item.execution.status)) return false;
    if ("error" in item.execution && item.execution.error !== null) return false;
  }
  return true;
}

/** Reading layout only: never rewrite a phase, lifecycle, Item, or saved view. */
export function observedProgressMessages(items: readonly ConversationTimelineItemViewModel[], terminal = false): ReadonlySet<string> {
  const result = new Set<string>();
  let continuation = false;
  let laterAnswer = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    const readable = item.contentBlocks.some(block =>
      (block.type === "text" || block.type === "code") && block.text.trim().length > 0);
    // User input and explicit final answers are barriers, not inferred progress.
    if (item.presentation === "user_message") { continuation = false; laterAnswer = false; }
    else if (item.presentation === "final_answer") { continuation = false; laterAnswer ||= readable; }
    else if (["web_search", "command", "tool", "reasoning"].includes(item.presentation)) continuation = true;
    else if (item.presentation === "assistant_unclassified") {
      // A terminal Turn must keep its last unclassified answer readable, even
      // when the provider emits trailing work with no subsequent answer.
      if (continuation && (!terminal || laterAnswer) && item.domainStatus === "completed") result.add(item.identity);
      laterAnswer ||= readable;
    }
  }
  return result;
}

export function processDetailItems(items: readonly ConversationTimelineItemViewModel[]): ReadonlySet<string> {
  return new Set(items.filter(item => {
    if (item.presentation === "reasoning" || item.presentation === "unknown") return true;
    const execution = item.execution;
    if (item.presentation !== "command" || execution?.kind !== "command" || execution.status !== "completed") return false;
    if ("native" in execution) return (execution.native.item.exitCode == null || execution.native.item.exitCode === 0) && !execution.native.item.outputText?.trim();
    return execution.exitCode === 0 && execution.output?.retention === "complete" && !execution.output.text?.trim();
  }).map(item => item.identity));
}

/** Collapse exact repeated completed summaries in details; retain every Item. */
export function repeatedSummaryItems(items: readonly ConversationTimelineItemViewModel[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const item of items) {
    if (item.presentation !== "reasoning" || item.domainStatus !== "completed" || item.availability === "unavailable" || item.activityLabel) continue;
    if (!item.contentBlocks.length || item.contentBlocks.some(block => block.type !== "text" || block.reasoningSource !== "summary" || !block.text.trim())) continue;
    const key = JSON.stringify(item.contentBlocks.map(block => block.type === "text" ? block.text : ""));
    if (seen.has(key)) repeated.add(item.identity);
    else seen.add(key);
  }
  return repeated;
}

export type ExecutionProgressDescription = Readonly<{
  source: "runtime_records";
  itemIdentities: readonly string[];
  text: string;
}>;

/** A reading projection of existing facts, never an assistant Item or event log. */
export function executionProgressDescriptions(
  turn: ConversationTimelineTurnViewModel,
  processKeys: ReadonlySet<string>,
  detailKeys: ReadonlySet<string>,
): ReadonlyMap<string, ExecutionProgressDescription> {
  const result = new Map<string, ExecutionProgressDescription>();
  if (turn.source !== "native_observed") return result;
  const live = turn.liveObserved === true && turn.statusSource === "runtime_notification" &&
    turn.domainStatus === "in_progress" && turn.availability !== "unavailable";
  type Group = { kind: string; noun: string; identities: string[]; completed: number; active: number };
  const groups: Group[] = [];
  let continuation = false;
  const seen = new Set<string>();
  for (const item of turn.items) {
    if (seen.has(item.identity)) continue;
    seen.add(item.identity);
    // Detailed records retain their original placement, but cannot generate
    // extra public prose or make an empty command appear active again.
    if (detailKeys.has(item.identity)) continue;
    if (!processKeys.has(item.identity) || item.activityLabel || item.approval?.status === "pending" ||
        item.availability === "unavailable") { continuation = false; continue; }
    let kind: string | null = null;
    let noun = "";
    if (item.presentation === "web_search") {
      const action = item.webSearch?.action;
      if (action === "search") { kind = action; noun = "网页搜索"; }
      else if (action === "openPage") { kind = action; noun = "网页读取"; }
      else if (action === "findInPage") { kind = action; noun = "网页内容查找"; }
    } else if ((item.presentation === "command" || item.presentation === "tool") &&
        item.execution && "native" in item.execution && item.availability === "available" &&
        ["running", "in_progress", "completed"].includes(item.execution.status) &&
        (!("error" in item.execution) || item.execution.error === null)) {
      // Do not turn a nonzero or unreported exit code into a success claim.
      if (item.presentation !== "command" || item.execution.native.item.exitCode === 0 || item.busy) {
        kind = item.presentation;
        noun = kind === "command" ? "命令执行" : "工具调用";
      }
    }
    const completed = item.domainStatus === "completed" && (!item.execution || item.execution.status === "completed");
    const active = live && item.busy === true;
    if (kind === null || (!completed && !active)) { continuation = false; continue; }
    const previous = groups[groups.length - 1];
    const group: Group = continuation && previous?.kind === kind ? previous : {kind, noun, identities: [], completed: 0, active: 0};
    if (group !== previous) groups.push(group);
    continuation = true;
    group.identities.push(item.identity);
    if (completed) group.completed++;
    else group.active++;
  }
  for (const {noun, completed, active, identities} of groups) {
    const ended = completed === 1 ? `已完成${noun}` : `已完成 ${completed} 次${noun}`;
    const text = active > 0
      ? completed > 0 ? `${ended}，另有 ${active} 次尚未收到结束记录。`
        : `${active === 1 ? `正在进行${noun}` : `正在进行 ${active} 次${noun}`}，尚未收到结束记录。`
      : `${ended}。具体情况可展开下方记录查看。`;
    result.set(identities[0]!, Object.freeze({source: "runtime_records", itemIdentities: Object.freeze(identities), text}));
  }
  return result;
}

export function nativeWaitingDescription(turn: ConversationTimelineTurnViewModel): string {
  return turn.items.some(item => item.presentation !== "user_message")
    ? "已收到本轮处理记录，正在等待模型的后续输出。"
    : "本轮已开始，正在等待模型输出。";
}
