// Generated from chat-ipc-v1.schema.json sessionPurpose. DO NOT EDIT.
export const sessionPurposes = ["ordinary","scheduled_plan_draft"] as const;
export type SessionPurpose = typeof sessionPurposes[number];
export interface SessionPurposeView { readonly sessionId: string; readonly purpose: SessionPurpose }
export function isSessionPurposeView(value: unknown): value is SessionPurposeView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return Object.keys(object).length === 2 && typeof object.sessionId === "string" &&
    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").test(object.sessionId) &&
    sessionPurposes.some(purpose => purpose === object.purpose);
}
