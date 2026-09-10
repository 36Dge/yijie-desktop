import type {LocalSubmissionView, NativeRecordDiagnostic} from "../api/generated/native-conversation-history.gen";
import type { NativeConversationView } from "../api/generated/native-conversation-private.gen";
import { safeConversationDiagnostic } from "./conversation-diagnostics";

export const CONVERSATION_ITEM_KINDS = Object.freeze([
  "user_message",
  "assistant_message",
  "reasoning",
  // FEAT-136 projects command/tool directly; remaining unsupported kinds still fail soft.
  "command",
  "tool",
  "approval",
  "artifact",
  "unknown",
] as const);

export type ConversationItemKind = typeof CONVERSATION_ITEM_KINDS[number];
export type ConversationThreadStatus = "not_loaded" | "ready" | "active" | "archived" | "unavailable";
export type ConversationTurnStatus =
  | "queued"
  | "in_progress"
  | "waiting_approval"
  | "completed"
  | "interrupted"
  | "failed"
  | "recovery_required"
  | "unknown";
export type ConversationTerminalStatus = Extract<
  ConversationTurnStatus,
  "completed" | "failed" | "interrupted"
>;
export type ConversationItemStatus = "started" | "streaming" | "completed" | "incomplete";
export type ReconciliationStatus = "not_applicable" | "matched" | "mismatch";
export type ConversationAgentMessagePhase = "commentary" | "final_answer" | "unknown";
export type ConversationPlanStepStatus = "pending" | "in_progress" | "completed" | "unknown";
export type ConversationReasoningStatus =
  | "in_progress"
  | "complete"
  | "incomplete"
  | "unavailable"
  | "unknown";
export type ConversationReasoningReasonCode =
  | "reasoning_not_emitted"
  | "turn_interrupted"
  | "stream_gap"
  | "runtime_error"
  | "limit_exceeded"
  | "protocol_error"
  | "host_shutdown"
  | "unknown";

export type ConversationTruncationReason = "utf8_byte_limit" | "upstream_truncated";

export interface ConversationSafeText {
  readonly text: string;
  readonly truncated: boolean;
  readonly truncationReason: ConversationTruncationReason | null;
}

export interface ConversationSourceFact {
  readonly sourceEventId: string;
  readonly sourceSequence: string;
  readonly sourceOccurredAt: string;
}

export interface ConversationCommandCwd {
  readonly kind: "workspace_root" | "workspace_relative" | "redacted";
  readonly segments: readonly string[];
}

export interface ConversationExecutionError {
  readonly code:
    | "command_failed"
    | "command_declined"
    | "tool_failed"
    | "tool_declined"
    | "unknown_tool"
    | "projection_limit_exceeded"
    | "projection_redaction_failed"
    | "protocol_error";
  readonly summary: string;
}

export interface ConversationCommandOutput {
  readonly retention: "complete" | "head_tail" | "unavailable";
  readonly text: string | null;
  readonly head: string | null;
  readonly tail: string | null;
  readonly reason: "not_available" | null;
  readonly truncated: boolean;
  readonly truncationReason: ConversationTruncationReason | null;
}

export interface ConversationLegacyCommandExecution {
  readonly kind: "command";
  readonly status: "running" | "completed" | "failed" | "declined" | "incomplete" | "unknown";
  readonly startedSource: ConversationSourceFact;
  readonly lastSource: ConversationSourceFact;
  readonly commandSummary: ConversationSafeText;
  readonly cwd: ConversationCommandCwd;
  readonly liveOutput: ConversationSafeText | null;
  readonly output: ConversationCommandOutput | null;
  readonly durationMs: number | null;
  readonly exitCode: number | null;
  readonly error: ConversationExecutionError | null;
}

/** Native facts stay native; legacy retention and event identities do not apply. */
export interface ConversationNativeCommandExecution {
  readonly kind: "command";
  readonly status: ConversationLegacyCommandExecution["status"];
  readonly native: Readonly<{
    source: NativeConversationView["source"];
    lastMethod: NativeConversationView["items"][number]["lastMethod"];
    item: NativeConversationView["items"][number]["item"];
  }>;
}

export type ConversationCommandExecution = ConversationLegacyCommandExecution | ConversationNativeCommandExecution;

export interface ConversationToolIdentity {
  readonly resolution: "known" | "unknown";
  readonly serverName: string;
  readonly toolName: string;
}

export interface ConversationToolProgress extends ConversationSourceFact {
  readonly progressIndex: number;
  readonly summary: ConversationSafeText;
}

export interface ConversationToolExecution {
  readonly kind: "tool";
  readonly status: "in_progress" | "completed" | "failed" | "declined" | "incomplete" | "unknown";
  readonly startedSource: ConversationSourceFact;
  readonly lastSource: ConversationSourceFact;
  readonly identity: ConversationToolIdentity;
  readonly argumentsSummary: ConversationSafeText;
  readonly progress: readonly ConversationToolProgress[];
  readonly durationMs: number | null;
  readonly resultSummary: ConversationSafeText | null;
  readonly error: ConversationExecutionError | null;
}

export interface ConversationNativeToolExecution {
  readonly kind: "tool";
  readonly status: ConversationToolExecution["status"];
  readonly native: ConversationNativeCommandExecution["native"];
}

export type ConversationExecution = ConversationCommandExecution | ConversationToolExecution | ConversationNativeToolExecution;

export interface ConversationPlanStep {
  readonly ordinal: number;
  readonly text: string;
  readonly status: ConversationPlanStepStatus;
}

export interface ConversationPlanSnapshot {
  readonly explanation: string | null;
  readonly steps: readonly ConversationPlanStep[];
}

export interface ConversationReasoningState {
  readonly status: ConversationReasoningStatus;
  readonly reasonCode: ConversationReasoningReasonCode | null;
}

export interface TextContentBlock {
  readonly reasoningSource?: "summary" | "content";
  readonly blockIndex: number;
  readonly type: "text";
  readonly text: string;
}

export interface CodeContentBlock {
  readonly blockIndex: number;
  readonly type: "code";
  readonly language: string | null;
  readonly text: string;
}

export interface ArtifactReferenceContentBlock {
  readonly blockIndex: number;
  readonly type: "artifact_reference";
  readonly artifactId: string;
  readonly label: string | null;
}

export interface AttachmentReferenceContentBlock {
  readonly blockIndex: number;
  readonly type: "attachment_reference";
  readonly attachmentId: string;
  readonly kind: "file" | "image";
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly status: string;
  readonly expiresAt: number;
}

export interface UnknownContentBlock {
  readonly blockIndex: number;
  readonly type: "unknown";
  readonly code: "unsupported_content";
}

export type ConversationContentBlock =
  | TextContentBlock
  | CodeContentBlock
  | ArtifactReferenceContentBlock
  | AttachmentReferenceContentBlock
  | UnknownContentBlock;

export interface ConversationThread {
  readonly threadId: string;
  readonly status: ConversationThreadStatus;
  readonly turnKeys: readonly string[];
  readonly notices: readonly ConversationNotice[];
}

export interface ConversationNotice {
  readonly severity: "error" | "warning";
  readonly code: "conversation_error" | "conversation_warning";
  readonly diagnostic?: string;
}

export interface ConversationTurn {
  readonly diagnostic?: string;
  readonly source?: "native_observed" | "native_rebuilt" | "legacy_archive" | "local_submission";
  readonly submissionStatus?: LocalSubmissionView["status"];
  readonly availability?: "available" | "partial" | "unavailable";
  readonly nativeStatus?: NativeConversationView["status"];
  readonly statusSource?: NativeConversationView["statusSource"];
  readonly threadId: string;
  readonly turnId: string;
  readonly ordinal: number;
  readonly status: ConversationTurnStatus;
  readonly terminalStatus: ConversationTerminalStatus | null;
  readonly terminalCode: string | null;
  readonly plan: ConversationPlanSnapshot | null;
  readonly itemKeys: readonly string[];
  readonly notices: readonly ConversationNotice[];
}

export interface ConversationItem {
  readonly availability?: NativeConversationView["availability"];
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly ordinal: number;
  readonly kind: ConversationItemKind;
  readonly status: ConversationItemStatus;
  readonly agentMessagePhase: ConversationAgentMessagePhase | null;
  readonly reasoning: ConversationReasoningState | null;
  readonly execution: ConversationExecution | null;
  readonly contentBlocks: readonly ConversationContentBlock[];
  readonly reconciliation: ReconciliationStatus;
}

/** A readonly rendering index. Execution is never reduced in Vue. */
export interface ConversationView {
  readonly schemaVersion: 3;
  readonly syncStatus: "synchronized" | "recovery_required"
  | "unknown";
  readonly threads: Readonly<Record<string, ConversationThread>>;
  readonly turns: Readonly<Record<string, ConversationTurn>>;
  readonly items: Readonly<Record<string, ConversationItem>>;
}

export interface ConversationThreadSnapshot {
  readonly threadId: string;
  readonly status: ConversationThreadStatus;
  readonly notices?: readonly ConversationNotice[];
}

export interface ConversationTurnSnapshot {
  readonly threadId: string;
  readonly turnId: string;
  readonly ordinal: number;
  readonly status: ConversationTurnStatus;
  readonly terminalStatus: ConversationTerminalStatus | null;
  readonly terminalCode?: string | null;
  readonly plan?: ConversationPlanSnapshot | null;
  readonly notices?: readonly ConversationNotice[];
}

export interface ConversationItemSnapshot {
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly ordinal: number;
  readonly kind: ConversationItemKind;
  readonly status: ConversationItemStatus;
  readonly agentMessagePhase?: ConversationAgentMessagePhase | null;
  readonly reasoning?: ConversationReasoningState | null;
  readonly execution?: ConversationExecution | null;
  readonly contentBlocks: readonly ConversationContentBlock[];
  readonly reconciliation?: ReconciliationStatus;
}

export interface ConversationSnapshot {
  readonly schemaVersion?: 2 | 3;
  readonly threads: readonly ConversationThreadSnapshot[];
  readonly turns: readonly ConversationTurnSnapshot[];
  readonly items: readonly ConversationItemSnapshot[];
  readonly streamPositions?: readonly {
    readonly streamId: string;
    readonly lastSequence: string;
  }[];
}

function compositeKey(...parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("|");
}

function turnKey(threadId: string, turnId: string): string {
  return compositeKey(threadId, turnId);
}

function itemKey(threadId: string, turnId: string, itemId: string): string {
  return compositeKey(threadId, turnId, itemId);
}

export function selectConversationTurn(
  state: ConversationView,
  threadId: string,
  turnId: string,
): ConversationTurn | null {
  return state.turns[turnKey(threadId, turnId)] ?? null;
}

export function selectConversationItem(
  state: ConversationView,
  threadId: string,
  turnId: string,
  itemId: string,
): ConversationItem | null {
  return state.items[itemKey(threadId, turnId, itemId)] ?? null;
}


export function conversationAgentMessagePhase(phase: string | null | undefined): ConversationAgentMessagePhase {
  return phase === "commentary" || phase === "final_answer" ? phase : "unknown";
}
export function conversationReasoningReasonCode(code: string | null | undefined): ConversationReasoningReasonCode | null {
  if (code == null) return null;
  const known = ["reasoning_not_emitted", "turn_interrupted", "stream_gap", "runtime_error", "limit_exceeded", "protocol_error", "host_shutdown", "unknown"];
  return known.includes(code) ? code as ConversationReasoningReasonCode : "unknown";
}
export function emptyConversationView(): ConversationView {
  return { schemaVersion: 3, syncStatus: "synchronized", threads: {}, turns: {}, items: {} };
}
/** Old database records are readonly archives. This does not replay or reconcile events. */
export function viewFromLegacySnapshot(snapshot: ConversationSnapshot): ConversationView {
  const turns: Record<string, ConversationTurn> = {};
  const items: Record<string, ConversationItem> = {};
  for (const item of snapshot.items) items[itemKey(item.threadId, item.turnId, item.itemId)] = {
    ...item, agentMessagePhase: item.agentMessagePhase === undefined ? (item.kind === "assistant_message" ? "unknown" : null) : item.agentMessagePhase, reasoning: item.reasoning ?? null,
    execution: item.execution ?? null, reconciliation: item.reconciliation ?? "not_applicable",
  };
  for (const turn of snapshot.turns) turns[turnKey(turn.threadId, turn.turnId)] = {
    ...turn, source: "legacy_archive", availability: "partial", terminalCode: turn.terminalCode ?? null,
    plan: turn.plan ?? null, notices: turn.notices ?? [],
    itemKeys: Object.keys(items).filter(key => items[key]?.turnId === turn.turnId && items[key]?.threadId === turn.threadId),
  };
  return {schemaVersion: 3, syncStatus: "synchronized", turns, items,
    threads: Object.fromEntries(snapshot.threads.map(thread => [thread.threadId, {
      ...thread, notices: thread.notices ?? [],
      turnKeys: Object.keys(turns).filter(key => turns[key]?.threadId === thread.threadId),
    }]))};
}
function nativeExecution(entry: NativeConversationView["items"][number], view: NativeConversationView): ConversationExecution | null {
  const item = entry.item;
  if (item.type === "commandExecution") return {
    kind: "command", status: item.status === "inProgress" ? "running" :
      item.status === "completed" || item.status === "failed" || item.status === "declined" ? item.status : "unknown",
    native: {source: view.source, lastMethod: entry.lastMethod, item},
  };
  if (item.type === "mcpToolCall") return {
    kind: "tool", status: item.status === "inProgress" ? "in_progress" :
      item.status === "completed" || item.status === "failed" || item.status === "declined" ? item.status : "unknown",
    native: {source: view.source, lastMethod: entry.lastMethod, item},
  };
  return null;
}
/** Select whole Item sets by documented source. Never match cold and live IDs or compare content. */
export function composeConversationView(snapshot: ConversationSnapshot, nativeViews: readonly NativeConversationView[], submissions: readonly LocalSubmissionView[] = [], recordDiagnostics: readonly NativeRecordDiagnostic[] = []): ConversationView {
  const legacy = viewFromLegacySnapshot(snapshot);
  const turns = {...legacy.turns}; const items = {...legacy.items}; const threads = {...legacy.threads};
  for (const view of nativeViews) {
    if (!threads[view.sessionId]) continue;
    const key = turnKey(view.sessionId, view.turnId);
    const old = turns[key];
    // Local attachments and Artifact references are separate product records, not native Items.
    const localReferences = old?.itemKeys.flatMap(k => {
      const item = items[k];
      if (!item) return [];
      const blocks = item.contentBlocks.filter(b => b.type === "attachment_reference" || b.type === "artifact_reference");
      return blocks.length ? [{...item, contentBlocks: blocks}] : [];
    }) ?? [];
    for (const k of old?.itemKeys ?? []) delete items[k];
    const nativeItems: ConversationItem[] = view.items.map(entry => {
      const item = entry.item;
      const kind: ConversationItemKind = item.type === "userMessage" ? "user_message" : item.type === "agentMessage" ? "assistant_message" : item.type === "reasoning" ? "reasoning" : item.type === "commandExecution" ? "command" : item.type === "mcpToolCall" ? "tool" : "unknown";
      const contentBlocks: TextContentBlock[] = item.type === "reasoning"
        ? (["summary", "content"] as const).flatMap(reasoningSource =>
          (item[reasoningSource] ?? []).map((text, blockIndex) => ({type: "text", text, blockIndex, reasoningSource})))
        : item.text == null ? [] : [{type: "text", text: item.text, blockIndex: 0}];
      return {threadId: view.sessionId, turnId: view.turnId, itemId: item.id, ordinal: entry.ordinal, kind,
        availability: item.availability,
        status: entry.lastMethod === "item/completed" ? "completed" : entry.lastMethod === "thread/read" ? "incomplete" : "streaming",
        agentMessagePhase: item.type === "agentMessage" ? conversationAgentMessagePhase(item.phase) : null,
        reasoning: item.type === "reasoning" ? {status: entry.lastMethod === "item/completed" ? "complete" : entry.lastMethod === "thread/read" ? "unknown" : "in_progress", reasonCode: null} : null,
        execution: nativeExecution(entry, view), reconciliation: "not_applicable",
        contentBlocks,
      };
    });
    for (const item of [...nativeItems, ...localReferences]) items[itemKey(item.threadId, item.turnId, item.itemId)] = item;
    const terminal = view.terminalObserved && (view.status === "completed" || view.status === "failed" || view.status === "interrupted") ? view.status : null;
    turns[key] = {threadId: view.sessionId, turnId: view.turnId, ordinal: view.ordinal ?? old?.ordinal ?? 0,
      source: view.source, availability: view.availability, nativeStatus: view.status, statusSource: view.statusSource,
      diagnostic: view.diagnostic ? safeConversationDiagnostic(view.diagnostic) : undefined,
      status: view.status === "inProgress" ? "in_progress" : view.status ?? "unknown",
      terminalStatus: terminal, terminalCode: view.terminalErrorCode ?? null,
      plan: view.plan == null ? null : {explanation: view.explanation ?? null, steps: view.plan.map((s, ordinal) => ({ordinal, text: s.step, status: s.status === "inProgress" ? "in_progress" : s.status}))},
      // The private view does not carry diagnostic scope. Do not assign a
      // thread-only warning to the Turn whose stream happened to observe it.
      notices: [],
      itemKeys: [...nativeItems, ...localReferences].map(item => itemKey(item.threadId, item.turnId, item.itemId)),
    };
    const thread = threads[view.sessionId];
    const diagnostic = view.diagnostic ? safeConversationDiagnostic(view.diagnostic) : null;
    if (thread) threads[view.sessionId] = {...thread,
      turnKeys: thread.turnKeys.includes(key) ? thread.turnKeys : [...thread.turnKeys, key],
      notices: diagnostic && !thread.notices.some(n => n.diagnostic === diagnostic)
        ? [...thread.notices, {severity: "warning", code: "conversation_warning", diagnostic}]
        : thread.notices,
    };
  }
  for (const submission of submissions) {
    const turn = Object.values(turns).find(t => t.turnId === submission.turnId);
    if (turn && turn.source === "legacy_archive") turns[turnKey(turn.threadId, turn.turnId)] = {...turn, source: "local_submission", submissionStatus: submission.status, status: "queued", terminalStatus: null};
  }
  // Local format diagnostics have an exact local record scope, not a guessed
  // native Item/Turn identity. Keep any observed execution facts unchanged.
  for (const record of recordDiagnostics) {
    const key = turnKey(record.sessionId, record.turnId);
    const turn = turns[key];
    if (turn) turns[key] = {...turn, availability: "unavailable", diagnostic: "native_format_unsupported"};
  }
  return {...legacy, turns, items, threads};
}
