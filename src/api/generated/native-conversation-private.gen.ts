/* Generated from native conversation source contracts. Do not edit. */

export interface NativeConversationViewEvent {
  schemaVersion: 6;
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
  /**
   * @maxItems 32
   */
  notices?: NativeTraceNotice[];
}
export interface NativeDisplayItem {
  item: NativeItem;
  lastMethod: "item/started" | "item/completed" | "thread/read";
  ordinal: number;
}
export interface NativeItem {
  id: string;
  type:
    | "userMessage"
    | "agentMessage"
    | "reasoning"
    | "commandExecution"
    | "mcpToolCall"
    | "webSearch"
    | "fileChange"
    | "subAgentActivity"
    | "imageView"
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
   * Metadata display only; raw native arguments never leave Host. For yijie_web/kimi_web_search_pro this may contain the validated, displayable query alone.
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
  /**
   * @maxItems 64
   */
  commandActions?: NativeCommandActionDisplay[];
  toolDisplay?: NativeToolDisplay;
}
/**
 * Display-only native MCP facts. No raw arguments/error/meta/resources/structuredContent and no business field parsing. Native list_mcp_resources/list_mcp_resource_templates may expose a validated resource count and redacted resource names/titles, never resource URIs, cursors or metadata. Empty resource lists are successful real results, not omitted content. For yijie_web/kimi_web_search_pro only, Host validates the closed built-in web result and projects the ordered source summaries from its native text block. Raw page content and chunks are excluded. Other tools retain their existing display policies. Limits do not change execution status; partial content availability must not suppress a known execution outcome. Host bounds total UTF-8 text at 256KiB and first 32 original content entries. Confidentiality may replace entire lines.
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
  searchReceipt?: DeepSearchReceipt;
}
export interface NativeMcpText {
  /**
   * Original native content array index; never renumber after filtering.
   */
  index: number;
  /**
   * Plain text after confidentiality projection and UTF-8 truncation. At index 0, built-in deep search may project SearchSuccess (title, url and snippet) or a validated public retrieval error. For newly observed results, url preserves the public HTTP(S) article address permitted by the native source URL policy, falling back to its displayable origin when necessary. Existing site-only receipts retain their origin. Desktop may open an exact result URL after user activation and independent native history authorization.
   */
  text: string;
}
export interface DeepSearchReceipt {
  version: number;
  operation_id?: string;
  relation: "first" | "joined" | "reused";
  dispatch: "not_dispatched" | "uncertain" | "attempted" | "responded";
  outcome: "pending" | "results" | "empty" | "partial" | "failed" | "unknown";
  availability: "pending" | "available" | "unavailable";
  error_code?:
    | "invalid_arguments"
    | "session_expired"
    | "not_entitled"
    | "quota_exceeded"
    | "busy"
    | "upstream_unavailable"
    | "timeout"
    | "no_content"
    | "response_too_large"
    | "invalid_response"
    | "cancelled"
    | "outcome_unknown"
    | "operation_conflict"
    | "operation_expired"
    | "result_unavailable";
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
/**
 * Safe projection of the original native command action. Index identifies a display action under its parent Item, not an independent execution.
 */
export interface NativeCommandActionDisplay {
  index: number;
  kind: "read" | "listFiles" | "search" | "unknown";
  label?: string;
  query?: string;
}
/**
 * Safe display labels only. Never tool identity, authority, raw arguments or arbitrary metadata.
 */
export interface NativeToolDisplay {
  provenance: "nativeAppContext" | "registeredTool" | "allowedTitle";
  sourceLabel?: string;
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
export interface NativeTraceNotice {
  eventId: string;
  sequence: string;
  method: "error" | "warning";
  code: string;
  scope: "thread" | "turn";
  willRetry?: boolean | null;
  itemId?: string;
}
