// Generated from scheduled execution source; DO NOT EDIT.
export type Identity = string;
export type ScheduleCapability = "schedule.read" | "schedule.manage" | "schedule.run";
export type WorkspaceSource = "user_project" | "managed_schedule";
export interface WorkspaceReference {
  source: WorkspaceSource;
  resource_id: Identity;
}
export type ExecutionErrorCode = "invalid_input" | "not_found" | "scope_denied" | "revision_conflict" | "request_conflict" | "target_unavailable" | "permission_denied" | "grant_missing" | "grant_expired" | "grant_exhausted" | "grant_stale" | "reservation_busy" | "storage_disabled" | "storage_unavailable" | "format_unsupported" | "execution_not_ready";
export type GrantState = "active" | "stale" | "expired" | "exhausted";
export interface GrantConfirmation {
  request_id: Identity;
  plan_id: Identity;
  expected_revision: number;
  max_runs: number;
  expires_at: number;
}
export interface GrantView {
  grant_id: Identity;
  plan_id: Identity;
  plan_revision: number;
  authorization_revision: number;
  definition_digest: string;
  workspace: WorkspaceReference;
  max_runs: number;
  occupied_runs: number;
  expires_at: number;
  state: GrantState;
}
export type RunTrigger = "automatic" | "manual" | "rerun";
export type DeliveryState = "reserved" | "sending" | "accepted" | "uncertain" | "terminal" | "cancelled";
export type NativeOutcome = "unobserved" | "completed" | "failed" | "interrupted";
export interface RunView {
  run_id: Identity;
  plan_id: Identity;
  plan_revision: number;
  schedule_epoch: number;
  request_id: Identity;
  operation_id: Identity;
  trigger: RunTrigger;
  original_run_id?: Identity;
  logical_slot?: string;
  grant_id: Identity;
  snapshot_digest: string;
  workspace: WorkspaceReference;
  permission_mode: RunViewPermissionMode;
  delivery_state: DeliveryState;
  native_outcome: NativeOutcome;
  needs_attention: boolean;
}
export type RunViewPermissionMode = "ask";
