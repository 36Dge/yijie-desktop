import { invoke } from "@tauri-apps/api/core";
import type { components } from "./generated/public.gen";
import {
  isKnownCapability,
  type KnownCapability,
  type PermissionFailureKind,
  type PermissionProjection,
  type TenantOption,
} from "../domain/permissions";

type TenantSelectionListWire = components["schemas"]["TenantSelectionList"];
type TenantSelectionWire = components["schemas"]["TenantSelection"];
type CapabilityProjectionWire = components["schemas"]["CapabilityProjection"];
type ErrorResponseWire = components["schemas"]["ErrorResponse"];

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY_KEY = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const RFC3339_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_CAPABILITY_COUNT = 256;
const MAX_PROJECTION_LIFETIME_MS = 5 * 60_000;
const FORBIDDEN_RESPONSE_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authorization",
  "setcookie",
]);

export type PermissionOperationIntent =
  | { kind: "listMyTenants" }
  | { kind: "getMyCapabilities"; tenantId: string };

type NativePermissionInvoker = <T>(
  command: string,
  arguments_?: Record<string, unknown>,
) => Promise<T>;

interface NativeOperationEnvelope {
  status: number;
  cacheControl: string;
  wwwAuthenticate?: string;
  retryAfter?: string;
  body: unknown;
}

export interface PermissionClient {
  listMyTenants(signal?: AbortSignal): Promise<readonly TenantOption[]>;
  getMyCapabilities(
    tenantId: string,
    signal?: AbortSignal,
    nowEpochMs?: number,
  ): Promise<PermissionProjection>;
}

export class PermissionClientError extends Error {
  readonly kind: PermissionFailureKind;
  readonly status?: number;

  constructor(kind: PermissionFailureKind, status?: number) {
    super(kind);
    this.name = "PermissionClientError";
    this.kind = kind;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalizeTenantId(value: unknown): string {
  if (typeof value !== "string" || !CANONICAL_UUID.test(value)) {
    throw new PermissionClientError("invalid-projection");
  }
  const normalized = value.toLowerCase();
  if (normalized === "00000000-0000-0000-0000-000000000000") {
    throw new PermissionClientError("invalid-projection");
  }
  return normalized;
}

function containsForbiddenResponseKey(value: unknown): boolean {
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    const next = pending.pop();
    visited += 1;
    if (visited > 8192) {
      return true;
    }
    if (Array.isArray(next)) {
      for (const value of next) {
        pending.push(value);
      }
      continue;
    }
    if (!isRecord(next)) {
      continue;
    }
    for (const [key, nested] of Object.entries(next)) {
      const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
      if (FORBIDDEN_RESPONSE_KEYS.has(normalizedKey)) {
        return true;
      }
      pending.push(nested);
    }
  }
  return false;
}

function parseRfc3339DateTime(value: unknown): number {
  if (typeof value !== "string") {
    return Number.NaN;
  }
  const match = RFC3339_DATE_TIME.exec(value);
  if (!match) {
    return Number.NaN;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (
    year < 1970 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return Number.NaN;
  }
  return Date.parse(value);
}

function decodeEnvelope(raw: unknown, intent: PermissionOperationIntent): NativeOperationEnvelope {
  if (!isRecord(raw) || !Number.isInteger(raw.status) || raw.cacheControl !== "no-store") {
    throw new PermissionClientError("invalid-projection");
  }
  const status = raw.status as number;
  const allowedStatuses =
    intent.kind === "listMyTenants"
      ? new Set([200, 401, 403, 500, 503])
      : new Set([200, 400, 401, 403, 500, 503]);
  if (!allowedStatuses.has(status)) {
    throw new PermissionClientError("invalid-projection");
  }
  if (
    (raw.wwwAuthenticate !== undefined && typeof raw.wwwAuthenticate !== "string") ||
    (raw.retryAfter !== undefined && typeof raw.retryAfter !== "string") ||
    (status === 401 ? raw.wwwAuthenticate !== "Bearer" : raw.wwwAuthenticate !== undefined) ||
    (status === 503 ? raw.retryAfter !== "1" : raw.retryAfter !== undefined) ||
    !isRecord(raw.body) ||
    containsForbiddenResponseKey(raw)
  ) {
    throw new PermissionClientError("invalid-projection");
  }
  return {
    status,
    cacheControl: raw.cacheControl,
    wwwAuthenticate: raw.wwwAuthenticate,
    retryAfter: raw.retryAfter,
    body: raw.body,
  };
}

function decodeTenantList(body: unknown): readonly TenantOption[] {
  if (!isRecord(body) || !Array.isArray(body.tenants)) {
    throw new PermissionClientError("invalid-projection");
  }
  const wire = body as unknown as TenantSelectionListWire;
  const seen = new Set<string>();
  return wire.tenants.map((tenant: TenantSelectionWire) => {
    if (!isRecord(tenant)) {
      throw new PermissionClientError("invalid-projection");
    }
    const tenantId = canonicalizeTenantId(tenant.tenant_id);
    if (
      typeof tenant.display_name !== "string" ||
      tenant.display_name.length < 1 ||
      tenant.display_name.length > 200 ||
      seen.has(tenantId)
    ) {
      throw new PermissionClientError("invalid-projection");
    }
    seen.add(tenantId);
    return { tenantId, displayName: tenant.display_name };
  });
}

function decodeProjection(
  body: unknown,
  expectedTenantId: string,
  nowEpochMs: number,
): PermissionProjection {
  if (!isRecord(body)) {
    throw new PermissionClientError("invalid-projection");
  }
  const wire = body as unknown as CapabilityProjectionWire;
  const tenantId = canonicalizeTenantId(wire.tenant_id);
  const expiresAtEpochMs = parseRfc3339DateTime(wire.expires_at);
  if (
    wire.schema_version !== 1 ||
    tenantId !== expectedTenantId ||
    !Number.isSafeInteger(wire.authorization_revision) ||
    wire.authorization_revision < 1 ||
    wire.authorization_revision > Number.MAX_SAFE_INTEGER ||
    !Number.isFinite(expiresAtEpochMs) ||
    expiresAtEpochMs <= nowEpochMs ||
    expiresAtEpochMs > nowEpochMs + MAX_PROJECTION_LIFETIME_MS ||
    !Array.isArray(wire.capabilities) ||
    wire.capabilities.length > MAX_CAPABILITY_COUNT
  ) {
    throw new PermissionClientError("invalid-projection");
  }

  const capabilities: KnownCapability[] = [];
  let previous = "";
  for (const capability of wire.capabilities) {
    if (
      typeof capability !== "string" ||
      capability.length < 3 ||
      capability.length > 128 ||
      !CAPABILITY_KEY.test(capability) ||
      (previous !== "" && capability <= previous)
    ) {
      throw new PermissionClientError("invalid-projection");
    }
    previous = capability;
    if (isKnownCapability(capability)) {
      capabilities.push(capability);
    }
  }

  return {
    tenantId,
    authorizationRevision: wire.authorization_revision,
    expiresAt: new Date(expiresAtEpochMs).toISOString(),
    expiresAtEpochMs,
    capabilities,
  };
}

function decodeErrorBody(body: unknown, expectedCode: string): ErrorResponseWire {
  if (
    !isRecord(body) ||
    body.code !== expectedCode ||
    typeof body.message !== "string" ||
    body.message.length === 0
  ) {
    throw new PermissionClientError("invalid-projection");
  }
  return body as unknown as ErrorResponseWire;
}

function errorForEnvelope(
  envelope: NativeOperationEnvelope,
  intent: PermissionOperationIntent,
): PermissionClientError {
  const status = envelope.status;
  if (status === 401) {
    decodeErrorBody(envelope.body, "unauthorized");
    return new PermissionClientError("unauthorized", status);
  }
  if (status === 403 && intent.kind === "listMyTenants") {
    decodeErrorBody(envelope.body, "user_access_denied");
    return new PermissionClientError("user-access-denied", status);
  }
  if (status === 403) {
    decodeErrorBody(envelope.body, "tenant_access_denied");
    return new PermissionClientError("tenant-access-denied", status);
  }
  if (status === 400) {
    decodeErrorBody(envelope.body, "invalid_tenant_context");
    return new PermissionClientError("invalid-tenant-context", status);
  }
  if (status === 500) {
    decodeErrorBody(envelope.body, "internal_error");
    return new PermissionClientError("unavailable", status);
  }
  if (status === 503) {
    decodeErrorBody(envelope.body, "authorization_unavailable");
    return new PermissionClientError("unavailable", status);
  }
  return new PermissionClientError("invalid-projection", status);
}

function nativeFailureKind(error: unknown): PermissionFailureKind {
  if (!isRecord(error) || typeof error.code !== "string") {
    return "unavailable";
  }
  switch (error.code) {
    case "native_auth_signed_out":
    case "native_auth_session_expired":
      return "unauthorized";
    case "native_auth_tenant_invalid":
      return "invalid-tenant-context";
    case "native_auth_response_rejected":
      return "invalid-projection";
    default:
      return "unavailable";
  }
}

function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return operation;
  }
  if (signal.aborted) {
    return Promise.reject(new PermissionClientError("aborted"));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new PermissionClientError("aborted"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function tauriInvoker<T>(
  command: string,
  arguments_?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(command, arguments_);
}

export function createPermissionClient(
  nativeInvoke: NativePermissionInvoker = tauriInvoker,
): PermissionClient {
  async function runIntent(
    intent: PermissionOperationIntent,
    signal?: AbortSignal,
  ): Promise<NativeOperationEnvelope> {
    if (signal?.aborted) {
      throw new PermissionClientError("aborted");
    }
    const invocation =
      intent.kind === "listMyTenants"
        ? nativeInvoke<unknown>("list_my_tenants")
        : nativeInvoke<unknown>("get_my_capabilities", { tenantId: intent.tenantId });
    let raw: unknown;
    try {
      raw = await withAbort(invocation, signal);
    } catch (error: unknown) {
      if (error instanceof PermissionClientError) {
        throw error;
      }
      throw new PermissionClientError(nativeFailureKind(error));
    }
    return decodeEnvelope(raw, intent);
  }

  return {
    async listMyTenants(signal?: AbortSignal): Promise<readonly TenantOption[]> {
      const intent = { kind: "listMyTenants" } as const;
      const envelope = await runIntent(intent, signal);
      if (envelope.status !== 200) {
        throw errorForEnvelope(envelope, intent);
      }
      return decodeTenantList(envelope.body);
    },

    async getMyCapabilities(
      tenantId: string,
      signal?: AbortSignal,
      nowEpochMs?: number,
    ): Promise<PermissionProjection> {
      let canonicalTenantId: string;
      try {
        canonicalTenantId = canonicalizeTenantId(tenantId);
      } catch {
        throw new PermissionClientError("invalid-tenant-context");
      }
      const intent = { kind: "getMyCapabilities", tenantId: canonicalTenantId } as const;
      const envelope = await runIntent(intent, signal);
      if (envelope.status !== 200) {
        throw errorForEnvelope(envelope, intent);
      }
      return decodeProjection(envelope.body, canonicalTenantId, nowEpochMs ?? Date.now());
    },
  };
}

export const permissionClient = createPermissionClient();
