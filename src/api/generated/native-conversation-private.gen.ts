/* Generated from native conversation source contracts. Do not edit. */

export interface NativeConversationViewEvent {
  schemaVersion: 1;
  contextId: string;
  subscriptionId: string;
  sessionId: string;
  view: NativeConversationView;
}
export interface NativeConversationView {
  sessionId: string;
  turnId: string;
  runtimeThreadId: string;
  runtimeTurnId: string;
  source: "native_observed" | "native_rebuilt" | "legacy_archive";
  revision: string;
  availability: "available" | "partial" | "unavailable";
  status?: ("inProgress" | "completed" | "interrupted" | "failed") | null;
  terminalObserved: boolean;
  /**
   * @maxItems 512
   */
  items: NativeDisplayItem[];
  plan?: NativePlanStep[] | null;
  explanation?: string | null;
  diagnostic?: string | null;
  cursor?: NativeViewCursor | null;
  terminalErrorCode?: string | null;
  ordinal?: number;
  statusSource?: "runtime_notification" | "runtime_read";
}
export interface NativeDisplayItem {
  item: NativeItem;
  lastMethod: "item/started" | "item/completed" | "thread/read";
  ordinal: number;
}
export interface NativeItem {
  id: string;
  type: "userMessage" | "agentMessage" | "reasoning" | "commandExecution" | "mcpToolCall" | "unknown";
  clientId?: string | null;
  text?: string;
  phase?: ("commentary" | "final_answer") | null;
  /**
   * @maxItems 128
   */
  summary?: string[];
  /**
   * @maxItems 128
   */
  content?: string[];
  status?: ("inProgress" | "completed" | "failed" | "declined") | null;
  exitCode?: number | null;
  durationMs?: number | null;
  /**
   * Metadata display only; raw native arguments never leave Host.
   */
  argumentsSummary?: string;
  /**
   * Metadata display only, omitted when native result is absent or null.
   */
  resultSummary?: string;
  /**
   * Completeness of this safe display projection, independent of the native execution status.
   */
  availability: "available" | "partial" | "unavailable";
  /**
   * Security projection label, not the original command. No execution semantics are inferred.
   */
  commandLabel?: string;
  /**
   * Workspace-relative display label; never the native absolute path.
   */
  cwdLabel?: string;
  /**
   * Bounded, redacted projection of native aggregatedOutput. Omitted when native output is null or unavailable.
   */
  outputText?: string;
  /**
   * Safe display label, not a registered tool identifier. Tool registration is outside FEAT-132.
   */
  toolLabel?: string;
}
export interface NativePlanStep {
  step: string;
  status: "pending" | "inProgress" | "completed";
}
export interface NativeViewCursor {
  streamId: string;
  sequence: string;
  eventId: string;
}
