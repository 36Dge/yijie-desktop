// Generated from skills/market-v2; DO NOT EDIT.

export type SkillMarketplaceV2 =
  | Origin
  | InstallState
  | DependencyState
  | OperationState
  | MutationKind
  | FileEntry
  | CatalogSource
  | Bundle
  | Skill
  | Catalog
  | Mutation
  | ImportRequest
  | Operation
  | ErrorResponse
  | PendingOperation;
export type Origin = "builtin" | "user" | "unknown";
export type InstallState = "not_installed" | "installed" | "partial" | "invalid" | "unknown";
export type DependencyState = "ready" | "missing" | "needs_authorization" | "unknown";
/**
 * pending and needs_attention are both unresolved durable intents. Neither permits compatibility rollback or new task admission until reconciliation or cancellation completes.
 */
export type OperationState = "pending" | "complete" | "cancelled" | "needs_attention";
export type MutationKind = "install" | "enable" | "disable" | "uninstall" | "refresh" | "rollback";

export interface FileEntry {
  path: string;
  sha256: string;
  bytes: number;
}
export interface CatalogSource {
  id: string;
  content_version: string;
  content_sha256: string;
  source_revision: string;
  native_package_version: string;
  plugin_name: string;
  display_name: string;
  description: string;
  category: string;
  order: number;
  icon_key: string;
  /**
   * @maxItems 128
   */
  required_tools: string[];
  source_path: string;
  /**
   * @maxItems 2048
   */
  files: FileEntry[];
}
/**
 * Current redistributable built-in offers, from zero to 512 entries. The initial release has 38 offers; this is not a fixed inventory size. Removed or blocked offers do not erase previously installed identities or their sources.
 */
export interface Bundle {
  schema_version: 2;
  marketplace_name: "yijie-builtin";
  /**
   * @maxItems 512
   */
  skills: CatalogSource[];
}
export interface Skill {
  id: string;
  version: string;
  runtime_name: string;
  display_name: string;
  description: string;
  category: string;
  order: number;
  icon_key: string;
  origin: Origin;
  installation_state: InstallState;
  enabled: boolean;
  runtime_visible: boolean;
  /**
   * No longer offered by the current App, including receipt-validated installations first discovered during migration. Existing native inventory remains manageable; this does not authorize a fresh installation.
   */
  retired: boolean;
  dependency_state: DependencyState;
  /**
   * @maxItems 128
   */
  required_tools: string[];
  epoch: number;
  failure_code: string;
}
/**
 * At most 512 current built-in offers plus 512 authoritative native/pending installation identities. Durable tombstones do not consume a live installation slot. Installation admission reserves slots before side effects; no installed user identity is dropped to fit an upgraded offer catalog. The local catalog transport is bounded at 256 MiB, sufficient for 1024 fully populated schema-valid rows (including JSON escaping); it must not inherit the unrelated 1 MiB chat envelope limit.
 */
export interface Catalog {
  schema_version: 2;
  revision: string;
  /**
   * @maxItems 1024
   */
  skills: Skill[];
  /**
   * @maxItems 512
   */
  operations: PendingOperation[];
  notice?: string;
}
export interface PendingOperation {
  operation_id: string;
  state: OperationState;
  skill_id: string;
  epoch: number;
  error_code: string;
}
export interface Mutation {
  operation_id: string;
  skill_id: string;
  kind: MutationKind;
  expected_epoch: number;
}
export interface ImportRequest {
  operation_id: string;
  file_name: string;
  format: "zip" | "markdown";
  sha256: string;
  bytes: number;
}
export interface Operation {
  operation_id: string;
  state: OperationState;
  skill_id: string;
  epoch: number;
  error_code: string;
  catalog?: Catalog;
}
export interface ErrorResponse {
  code: string;
  retryable: boolean;
}
