/* Generated from private IPC and pinned native timing schemas. Do not edit. */

/**
 * Canonical non-zero UUID; identity is checked against the managed mapping.
 */
export type CanonicalID = string;
export type TimingSource = "runtime_read";
/**
 * Runtime Unix seconds, not local receipt/schedule time. Omitted/null native field is unknown; malformed or out-of-range is invalid. Zero is valid.
 */
export type UnixSecondsFact = {
  [k: string]: unknown;
} & {
  state: TimeFieldState;
  value?: number;
};
export type TimeFieldState = "known" | "unknown" | "invalid";
/**
 * Runtime whole-turn elapsed milliseconds, including its waits. Not item/model-only time and not derived from integer seconds.
 */
export type DurationMsFact = {
  [k: string]: unknown;
} & {
  state: TimeFieldState;
  value?: number;
};

export interface TurnTimingView {
  sessionId: CanonicalID;
  turnId: CanonicalID;
  timing: NativeTurnTiming | null;
}
export interface NativeTurnTiming {
  schema_version: 1;
  agent_session_id: CanonicalID;
  thread_id: CanonicalID;
  turn_id: CanonicalID;
  source: TimingSource;
  started_at: UnixSecondsFact;
  completed_at: UnixSecondsFact;
  duration_ms: DurationMsFact;
}
