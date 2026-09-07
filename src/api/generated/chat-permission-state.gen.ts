/* Generated from chat-runtime-permissions-v1.schema.json. Do not edit. */

export type PermissionMode = "ask" | "auto" | "full";

export interface ChatPermissionState {
  mode: PermissionMode;
  fullAccessConfirmed: boolean;
  busy: boolean;
}
