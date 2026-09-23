// Generated from scheduled plan source; DO NOT EDIT.
export type Identity = string;
export interface TimeRule {
  frequency: TimeRuleFrequency;
  time_zone: string;
  local_time: string;
  local_date?: string;
  weekdays?: Array<number>;
}
export type TargetMode = "dedicated_chat" | "new_chat_each_run" | "existing_chat";
export type PlanState = "paused" | "enabled" | "completed" | "deleted";
export type TargetState = "ready" | "unbound" | "missing";
export type ScheduleErrorCode = "invalid_input" | "target_unavailable" | "not_found" | "revision_conflict" | "request_conflict" | "storage_disabled" | "storage_unavailable" | "time_query_exhausted" | "rule_version_unsupported" | "execution_not_ready";
export interface TargetReference {
  mode: TargetMode;
  conversation_id?: Identity;
}
export interface PlanDefinition {
  name: string;
  content: string;
  rule: TimeRule;
  target: TargetReference;
}
export interface SavePlanRequest {
  request_id: Identity;
  plan_id?: Identity;
  expected_revision?: number;
  definition: PlanDefinition;
}
export interface PlanView {
  plan_id: Identity;
  revision: number;
  schedule_epoch: number;
  definition: PlanDefinition;
  state: PlanState;
  target_state: TargetState;
  effective_from: number;
  next_at?: number;
  rule_version: number;
  tzdb_version: string;
  authorization_ref?: Identity;
  authorization_expires_at?: number;
}
export interface TimePreview {
  next_at?: number;
  logical_slot?: string;
  skipped_slots: Array<string>;
  candidates_examined: number;
  rule_version: number;
  tzdb_version: string;
}
export type TimeRuleFrequency = "once" | "daily" | "weekdays" | "weekly";
