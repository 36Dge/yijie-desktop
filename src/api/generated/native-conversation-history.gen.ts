/* Generated from native conversation source contracts. Do not edit. */

export interface NativeConversationHistory {
  /**
   * @maxItems 50
   */
  views: NativeConversationView[];
  historyAvailability: "partial" | "unavailable";
  /**
   * @maxItems 50
   */
  submissions: LocalSubmissionView[];
  /**
   * @maxItems 50
   */
  remainingTurnIds: string[];
  /**
   * @maxItems 50
   */
  recordDiagnostics?: NativeRecordDiagnostic[];
  /**
   * @maxItems 50
   */
  archivedViewsV5?: ArchiveV5NativeConversationView[];
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
  type: "userMessage" | "agentMessage" | "reasoning" | "commandExecution" | "mcpToolCall" | "webSearch" | "unknown";
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
  mcp?: NativeMcpDisplay;
  webSearch?: NativeWebSearchDisplay;
}
/**
 * Display-only native MCP facts. No raw arguments/error/meta/resources/structuredContent and no business field parsing. Limits do not change execution status. Host bounds total UTF-8 text at 256KiB and first 32 original content entries. Confidentiality may replace entire lines.
 */
export interface NativeMcpDisplay {
  server?: string;
  tool?: string;
  resultKind: "absent" | "null" | "empty" | "text" | "unsupported" | "omitted";
  /**
   * @maxItems 32
   */
  texts: NativeMcpText[];
  /**
   * @maxItems 8
   */
  diagnostics:
    | []
    | [
        | "identity_unavailable"
        | "arguments_unavailable"
        | "unsupported_content"
        | "content_redacted"
        | "content_truncated"
        | "content_limit"
        | "result_unavailable"
        | "display_limit"
      ]
    | [
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        )
      ]
    | [
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        )
      ]
    | [
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        )
      ]
    | [
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        )
      ]
    | [
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        )
      ]
    | [
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        )
      ]
    | [
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        )
      ];
}
export interface NativeMcpText {
  /**
   * Original native content array index; never renumber after filtering.
   */
  index: number;
  /**
   * Complete native text block after existing whole-line confidentiality projection, then UTF-8 truncation. Plain text only; links remain inert.
   */
  text: string;
}
/**
 * Safe display of the native WebSearchAction only. No execution or lifecycle inference. Queries/pattern are bounded and redacted; pageLabel is a hostname only, never an actionable URL. Optional sources are actual search hits, never inferred citations. Absence means no source metadata observed.
 */
export interface NativeWebSearchDisplay {
  action: "search" | "openPage" | "findInPage" | "other";
  /**
   * @maxItems 8
   */
  queries:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string];
  pageLabel?: string;
  pattern?: string;
  /**
   * @maxItems 32
   */
  sources?: NativeWebSearchSourceDisplay[];
}
/**
 * Actual provider search hit. Inert text only; not a verified citation or executable link. URL must be safe HTTP(S), no credentials, bounded and redacted; unsafe entries are omitted with partial availability.
 */
export interface NativeWebSearchSourceDisplay {
  url: string;
  title?: string;
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
export interface LocalSubmissionView {
  turnId: string;
  operationId: string;
  status: "queued" | "submitted" | "failed" | "uncertain" | "cancelled";
}
export interface NativeRecordDiagnostic {
  sessionId: string;
  turnId: string;
  formatVersion: number;
  code: "format_unsupported";
}
export interface ArchiveV5NativeConversationView {
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
  items: ArchiveV5NativeDisplayItem[];
  plan?: ArchiveV5NativePlanStep[] | null;
  explanation?: string | null;
  diagnostic?: string | null;
  cursor?: ArchiveV5NativeViewCursor | null;
  terminalErrorCode?: string | null;
  ordinal?: number;
  statusSource?: "runtime_notification" | "runtime_read";
}
export interface ArchiveV5NativeDisplayItem {
  item: ArchiveV5NativeItem;
  lastMethod: "item/started" | "item/completed" | "thread/read";
  ordinal: number;
}
export interface ArchiveV5NativeItem {
  id: string;
  type:
    | "userMessage"
    | "agentMessage"
    | "reasoning"
    | "commandExecution"
    | "mcpToolCall"
    | "webSearch"
    | "fileChange"
    | "unknown";
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
  mcp?: ArchiveV5NativeMcpDisplay;
  webSearch?: ArchiveV5NativeWebSearchDisplay;
  /**
   * Bounded whole-line redacted native command; inert text, never execution input.
   */
  commandPreview?: string;
  /**
   * @maxItems 32
   */
  commandActions?: ArchiveV5NativeCommandActionDisplay[];
  fileChange?: ArchiveV5NativeFileChangeDisplay;
  appContext?: ArchiveV5NativeAppContextDisplay;
}
/**
 * Display-only native MCP facts. No raw arguments/error/meta/resources/structuredContent and no business field parsing. Limits do not change execution status. Host bounds total UTF-8 text at 256KiB and first 32 original content entries. Confidentiality may replace entire lines.
 */
export interface ArchiveV5NativeMcpDisplay {
  server?: string;
  tool?: string;
  resultKind: "absent" | "null" | "empty" | "text" | "unsupported" | "omitted";
  /**
   * @maxItems 32
   */
  texts: ArchiveV5NativeMcpText[];
  /**
   * @maxItems 8
   */
  diagnostics:
    | []
    | [
        | "identity_unavailable"
        | "arguments_unavailable"
        | "unsupported_content"
        | "content_redacted"
        | "content_truncated"
        | "content_limit"
        | "result_unavailable"
        | "display_limit"
      ]
    | [
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        )
      ]
    | [
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        )
      ]
    | [
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        )
      ]
    | [
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        )
      ]
    | [
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        )
      ]
    | [
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        )
      ]
    | [
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        ),
        (
          | "identity_unavailable"
          | "arguments_unavailable"
          | "unsupported_content"
          | "content_redacted"
          | "content_truncated"
          | "content_limit"
          | "result_unavailable"
          | "display_limit"
        )
      ];
}
export interface ArchiveV5NativeMcpText {
  /**
   * Original native content array index; never renumber after filtering.
   */
  index: number;
  /**
   * Complete native text block after existing whole-line confidentiality projection, then UTF-8 truncation. Plain text only; links remain inert.
   */
  text: string;
}
/**
 * Safe display of the native WebSearchAction only. No execution or lifecycle inference. Queries/pattern are bounded and redacted; pageLabel is a hostname only, never an actionable URL. Optional sources are actual search hits, never inferred citations. Absence means no source metadata observed.
 */
export interface ArchiveV5NativeWebSearchDisplay {
  action: "search" | "openPage" | "findInPage" | "other";
  /**
   * @maxItems 8
   */
  queries:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string];
  pageLabel?: string;
  pattern?: string;
  /**
   * @maxItems 32
   */
  sources?: ArchiveV5NativeWebSearchSourceDisplay[];
}
/**
 * Actual provider search hit. Inert text only; not a verified citation or executable link. URL must be safe HTTP(S), no credentials, bounded and redacted; unsafe entries are omitted with partial availability.
 */
export interface ArchiveV5NativeWebSearchSourceDisplay {
  url: string;
  title?: string;
}
/**
 * Original native action array index, not a distinct execution. Classification is best-effort. Path labels are safe workspace-relative paths only; absence means not displayable. No raw command parsing or filesystem discovery.
 */
export interface ArchiveV5NativeCommandActionDisplay {
  index: number;
  type: "read" | "listFiles" | "search" | "unknown";
  pathLabel?: string;
  name?: string;
  query?: string;
  commandPreview?: string;
}
/**
 * Existing native fileChange Item, at most 64KiB total projected diff per Item. Completion snapshot supplies definitive changes; patchUpdated chunks are not concatenated or promised live. Status remains native Item status.
 */
export interface ArchiveV5NativeFileChangeDisplay {
  /**
   * @maxItems 128
   */
  changes: ArchiveV5NativeFileUpdateDisplay[];
}
/**
 * One native reported file change; not a worktree net diff. Safe relative paths and whole-line redacted diff. Counts exist only for completed, fully observed and parseable changes: add/delete content lines, update unified diff hunks. Missing or truncated counts are unavailable, never zero. No actionable raw paths.
 */
export interface ArchiveV5NativeFileUpdateDisplay {
  index: number;
  kind: "add" | "delete" | "update" | "unknown";
  pathLabel?: string;
  movePathLabel?: string;
  diffText?: string;
  addedLines?: number;
  removedLines?: number;
}
/**
 * Only bounded redacted native display identity. No resourceUri, linkId, templateId or plugin payload. Does not grant access, fetch a resource, or infer business results. Empty context omitted.
 */
export interface ArchiveV5NativeAppContextDisplay {
  connectorId?: string;
  appName?: string;
  actionName?: string;
}
export interface ArchiveV5NativePlanStep {
  step: string;
  status: "pending" | "inProgress" | "completed";
}
export interface ArchiveV5NativeViewCursor {
  streamId: string;
  sequence: string;
  eventId: string;
}
