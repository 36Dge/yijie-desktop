export const KNOWN_CAPABILITIES = [
  "knowledge.read",
  "plugin.read",
  "schedule.read",
  "store.read",
  "task.create",
  "task.read",
  "workspace.use",
] as const;

export type KnownCapability = (typeof KNOWN_CAPABILITIES)[number];

export interface TenantOption {
  tenantId: string;
  displayName: string;
}

export interface PermissionProjection {
  tenantId: string;
  authorizationRevision: number;
  expiresAt: string;
  expiresAtEpochMs: number;
  capabilities: readonly KnownCapability[];
}

export type PermissionFailureKind =
  | "aborted"
  | "unauthorized"
  | "user-access-denied"
  | "tenant-access-denied"
  | "invalid-tenant-context"
  | "unavailable"
  | "invalid-projection";

export type PermissionPhase =
  | "idle"
  | "discovering"
  | "tenant-selection-required"
  | "loading"
  | "ready"
  | "ready-empty"
  | "recovery"
  | "unauthorized"
  | "user-access-denied"
  | "tenant-access-denied"
  | "invalid-tenant-context"
  | "unavailable"
  | "invalid-projection";

const KNOWN_CAPABILITY_SET = new Set<string>(KNOWN_CAPABILITIES);

export function isKnownCapability(value: string): value is KnownCapability {
  return KNOWN_CAPABILITY_SET.has(value);
}
