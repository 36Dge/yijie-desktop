import type { KnownCapability } from "./permissions";

/** UI retention identity from the existing Native permission projection.
 * It grants no authority; every read/touch/answer still uses the current IPC context.
 */
export interface UserInputDraftScope { readonly key: string; readonly expiresAt: number }
export function userInputDraftScope(value: {
  readonly ready: boolean;
  readonly tenantId: string | null;
  readonly authorizationRevision: number | null;
  readonly expiresAt: string | null;
  readonly capabilities: readonly KnownCapability[];
}): UserInputDraftScope | null {
  const expiresAt = Date.parse(value.expiresAt ?? "");
  if (!value.ready || !value.tenantId || !Number.isSafeInteger(value.authorizationRevision) ||
      (value.authorizationRevision ?? 0) <= 0 || !Number.isFinite(expiresAt) || expiresAt <= Date.now() ||
      !value.capabilities.includes("task.read")) return null;
  // Expiry may advance during ordinary renewal. Revision or capability changes
  // must clear drafts even if the visible question happens to be unchanged.
  return { key: JSON.stringify([value.tenantId, value.authorizationRevision, [...value.capabilities].sort()]), expiresAt };
}
