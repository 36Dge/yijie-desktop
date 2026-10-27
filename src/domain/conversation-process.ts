import type { ConversationTimelineItemViewModel, ConversationTimelineTurnViewModel } from "./conversation-timeline";

/** Only explicit process kinds participate; an unclassified answer stays readable. */
export function isCollapsibleProcessItem(item: ConversationTimelineItemViewModel, observedProgress = false, rebuilt = false): boolean {
  if (!["commentary", "reasoning", "command", "tool", "web_search", "unknown"].includes(item.presentation) && !observedProgress) return false;
  if (item.presentation === "reasoning" && item.availability !== undefined) return true;
  // An unsupported display type is not a failed execution. Keep its original
  // record in details rather than turning every successful search into an alert.
  if (item.presentation === "unknown" && item.domainStatus === "completed" && !item.approval && !item.activityLabel) return true;
  // Keep decisions and incomplete/error information visible even when the Turn is folded.
  // A history read cannot establish live item completion. It can still supply
  // explicit commentary and confirmed execution facts for the reading layout.
  const readableHistory = rebuilt && item.availability === "available" &&
    (item.presentation === "commentary" || confirmedNativeExecution(item));
  if (item.approval?.status === "pending" || (item.domainStatus === "incomplete" && !readableHistory) || item.activityLabel ||
      (item.availability && item.availability !== "available" &&
        !(["web_search", "command", "tool"].includes(item.presentation) && item.availability === "partial"))) return false;
  if (item.reasoning && (item.reasoning.reasonCode !== null ||
      !["complete", "in_progress"].includes(item.reasoning.status))) return false;
  if (item.presentation === "command" || item.presentation === "tool") {
    // A confirmed native failure may use a compact record, but its group must
    // keep an attention marker visible even when the rest of the Turn folds.
    if (item.execution && "native" in item.execution && (item.domainStatus === "completed" || readableHistory) &&
        ["failed", "declined"].includes(item.execution.status)) return true;
    if (!item.execution || !["running", "in_progress", "completed"].includes(item.execution.status)) return false;
    if ("error" in item.execution && item.execution.error !== null) return false;
  }
  return true;
}

function confirmedNativeExecution(item: ConversationTimelineItemViewModel): boolean {
  return !!item.execution && "native" in item.execution &&
    ["completed", "failed", "declined"].includes(item.execution.status);
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
  return new Set(items.filter(item => item.presentation === "reasoning" || item.presentation === "unknown").map(item => item.identity));
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

export type ProcessActivityGroup = Readonly<{
  identity: string;
  source: "runtime_records";
  itemIdentities: readonly string[];
  text: string;
  active: number;
  failed: number;
  declined: number;
}>;

/** Compact adjacent work, not generated prose. Original Items remain in order. */
export function processActivityGroups(
  turn: ConversationTimelineTurnViewModel,
  processKeys: ReadonlySet<string>,
  detailKeys: ReadonlySet<string>,
): ReadonlyMap<string, ProcessActivityGroup> {
  const result = new Map<string, ProcessActivityGroup>();
  if (turn.source !== "native_observed" && turn.source !== "native_rebuilt") return result;
  const live = turn.liveObserved === true && turn.statusSource === "runtime_notification" &&
    turn.domainStatus === "in_progress" && turn.availability !== "unavailable";
  type Group = { actions: Map<string, {label: string; completed: string; paths: Set<string>}>; identities: string[]; active: number; failed: number; declined: number };
  const groups: Group[] = [];
  let continuation = false;
  const seen = new Set<string>();
  for (const item of turn.items) {
    if (seen.has(item.identity)) continue;
    seen.add(item.identity);
    // Reasoning and unsupported details do not interrupt adjacent tool work.
    // Empty commands still count as actual executions, with details available.
    if (detailKeys.has(item.identity) && item.presentation !== "command") continue;
    if (!processKeys.has(item.identity) || item.activityLabel || item.approval?.status === "pending" ||
        item.availability === "unavailable") { continuation = false; continue; }
    const actions = nativeActivityDescriptions(item);
    const ended = turn.source === "native_rebuilt" ? confirmedNativeExecution(item) :
      item.domainStatus === "completed" && (!item.execution || ["completed", "failed", "declined"].includes(item.execution.status));
    const active = live && item.busy === true;
    if (!actions.length || (!ended && !active)) { continuation = false; continue; }
    const previous = groups[groups.length - 1];
    const group: Group = continuation && previous ? previous : {actions: new Map(), identities: [], active: 0, failed: 0, declined: 0};
    if (group !== previous) groups.push(group);
    continuation = true;
    group.identities.push(item.identity);
    for (const action of actions) {
      const previous = group.actions.get(action.key);
      if (previous) { for (const path of action.paths) previous.paths.add(path); }
      else group.actions.set(action.key, {...action, paths: new Set(action.paths)});
    }
    if (active && !ended) group.active++;
    if (item.execution?.status === "failed") group.failed++;
    if (item.execution?.status === "declined") group.declined++;
  }
  for (const {actions, active, failed, declined, identities} of groups) {
    const identity = identities[0]!;
    const text = [...actions.values()].map(action => {
      const label = active || failed || declined ? action.label : action.completed;
      return action.paths.size > 1 ? label.replace("文件", "多个文件") : label;
    }).join("、");
    result.set(identity, Object.freeze({identity, source: "runtime_records", itemIdentities: Object.freeze(identities), text, active, failed, declined}));
  }
  return result;
}

type ActivityDescription = { key: string; label: string; completed: string; paths: string[] };

/** Deterministic reading labels from native facts, never from model/tool prose. */
export function nativeActivityDescriptions(item: ConversationTimelineItemViewModel): ActivityDescription[] {
  const action = (key: string, label: string, completed: string, paths: string[] = []): ActivityDescription => ({key, label, completed, paths});
  if (item.presentation === "web_search") {
    const kind = item.webSearch?.action;
    return [kind === "openPage" ? action("web_read", "读取网页", "读取了网页") :
      kind === "findInPage" ? action("web_find", "查找网页内容", "查找了网页内容") : action("web_search", "搜索网页", "搜索了网页")];
  }
  if (!item.execution || !("native" in item.execution)) return [];
  const native = item.execution.native.item;
  if (native.type === "commandExecution") return (native.commandActions?.length ? native.commandActions : [{type: "unknown"}]).map(a => {
    const path = "pathLabel" in a && a.pathLabel ? [a.pathLabel] : [];
    if (a.type === "read") return action("read", "读取文件", "读取了文件", path);
    if (a.type === "listFiles") return action("listFiles", "列出文件", "列出了文件");
    if (a.type === "search") return action("search", "搜索文件", "搜索了文件");
    return action("command", "运行命令", "运行了命令");
  });
  if (native.type === "fileChange") return native.fileChange?.changes.map(change => {
    const path = change.pathLabel ? [change.pathLabel] : [];
    if (change.kind === "add") return action("add", "创建文件", "创建了文件", path);
    if (change.kind === "delete") return action("delete", "删除文件", "删除了文件", path);
    return action("edit", "编辑文件", "编辑了文件", path);
  }) ?? [action("file", "变更文件", "变更了文件")];
  const app = native.appContext?.appName;
  if (app && app !== "[内容已脱敏]") return [action(`app:${native.appContext?.connectorId ?? app}`, `使用 ${app}`, `已使用 ${app}`)];
  const tool = native.mcp?.tool;
  return [tool ? action(`tool:${native.mcp?.server ?? ""}:${tool}`, `调用 ${tool}`, `已调用 ${tool}`) : action("tool", "调用工具", "调用了工具")];
}

export function nativeWaitingDescription(turn: ConversationTimelineTurnViewModel): string {
  return turn.items.some(item => item.presentation !== "user_message")
    ? "正在处理…"
    : "正在处理…";
}
