// Generated from web-retrieval; DO NOT EDIT.

export type HttpsSchemasYijieAiWebRetrievalV1Display = SearchOutput | ProOutput | FetchOutput;
export type SearchOutput = SearchSuccess | ContentSuccess | ErrorOutput;
/**
 * Public HTTP(S) URL. Connector additionally parses authority, rejects userinfo/control characters and local/private literal destinations; no local request to this target is made.
 */
export type PublicUrl = string;
export type ContentStatus = "available" | "unavailable" | "truncated";
export type ToolError = {
  [k: string]: unknown;
} & {
  code: ErrorCode;
  message: string;
};
export type ErrorCode =
  | "invalid_arguments"
  | "authentication_failed"
  | "permission_denied"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "no_content"
  | "response_too_large"
  | "invalid_response"
  | "cancelled";
export type ProOutput = ProSuccess | ErrorOutput;
/**
 * Finite query-relative score. No cross-query trust threshold.
 */
export type ChunkScore = number;
export type FetchOutput = FetchSuccess | ErrorOutput;

export interface SearchSuccess {
  /**
   * @maxItems 20
   */
  results: SearchResult[];
  truncated: boolean;
}
export interface SearchResult {
  title: string;
  url: PublicUrl;
  snippet: string;
}
export interface ContentSuccess {
  /**
   * @maxItems 20
   */
  results: ContentResult[];
  truncated: boolean;
  dropped_results: number;
}
export interface ContentResult {
  title: string;
  url: PublicUrl;
  snippet: string;
  text: string;
  content_status: ContentStatus;
}
export interface ErrorOutput {
  error: ToolError;
}
export interface ProSuccess {
  /**
   * @maxItems 20
   */
  results: ProResult[];
  truncated: boolean;
  dropped_results: number;
}
export interface ProResult {
  title: string;
  url: PublicUrl;
  snippet: string;
  site_name: string;
  date: string;
  authority: string;
  chunks: SearchChunk[];
  content_status: ContentStatus;
}
export interface SearchChunk {
  text: string;
  score: ChunkScore;
}
export interface FetchSuccess {
  url: PublicUrl;
  title: string;
  markdown: string;
  truncated: boolean;
}
