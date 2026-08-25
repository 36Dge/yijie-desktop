import { invoke } from "@tauri-apps/api/core";
import {
  parseSkillCatalogSnapshot,
  SkillProjectionError,
  type SkillCatalogSnapshot,
} from "../domain/skill-marketplace";

export const SKILL_SCAN_REASONS = [
  "startup",
  "page_open",
  "app_upgrade",
  "window_resume",
  "directory_changed",
  "user_retry",
] as const;

export type SkillScanReason = (typeof SKILL_SCAN_REASONS)[number];
export type SkillNativeFailureKind =
  | "aborted"
  | "unauthorized"
  | "permission-denied"
  | "not-found"
  | "not-installable"
  | "conflict"
  | "busy"
  | "bundle-invalid"
  | "unavailable"
  | "operation-failed"
  | "incompatible";

export interface SkillNativeClient {
  list(signal?: AbortSignal): Promise<SkillCatalogSnapshot>;
  scan(reason: SkillScanReason, signal?: AbortSignal): Promise<SkillCatalogSnapshot>;
  install(skillId: string): Promise<SkillCatalogSnapshot>;
  setEnabled(skillId: string, enabled: boolean): Promise<SkillCatalogSnapshot>;
  uninstall(skillId: string): Promise<SkillCatalogSnapshot>;
}

export type SkillNativeInvoker = (
  command: string,
  arguments_?: Record<string, unknown>,
) => Promise<unknown>;

export class SkillNativeClientError extends Error {
  constructor(readonly kind: SkillNativeFailureKind) {
    super(`skill-native-${kind}`);
    this.name = "SkillNativeClientError";
  }
}

const SKILL_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const SKILL_SCAN_REASON_SET = new Set<string>(SKILL_SCAN_REASONS);

async function tauriInvoker(
  command: string,
  arguments_?: Record<string, unknown>,
): Promise<unknown> {
  return invoke<unknown>(command, arguments_);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.code === "string") return value.code;
  if (isRecord(value.error) && typeof value.error.code === "string") return value.error.code;
  return null;
}

function mapNativeFailure(error: unknown): SkillNativeClientError {
  if (error instanceof SkillNativeClientError) return error;
  if (error instanceof SkillProjectionError) return new SkillNativeClientError("incompatible");
  switch (errorCode(error)) {
    case "unauthorized":
    case "native_auth_signed_out":
    case "native_auth_session_expired":
    case "skill_owner_credential_unavailable":
      return new SkillNativeClientError("unauthorized");
    case "capability_denied":
      return new SkillNativeClientError("permission-denied");
    case "skill_not_found":
      return new SkillNativeClientError("not-found");
    case "skill_not_installable":
      return new SkillNativeClientError("not-installable");
    case "skill_operation_conflict":
      return new SkillNativeClientError("conflict");
    case "skill_busy":
      return new SkillNativeClientError("busy");
    case "bundle_missing":
    case "bundle_manifest_invalid":
    case "archive_checksum_mismatch":
    case "archive_unsafe":
    case "archive_too_large":
    case "skill_marketplace_disabled":
    case "skill_resource_unavailable":
      return new SkillNativeClientError("bundle-invalid");
    case "runtime_unavailable":
    case "runtime_sync_failed":
    case "skill_native_unavailable":
    case "skill_host_configuration_invalid":
    case "skill_host_unavailable":
      return new SkillNativeClientError("unavailable");
    case "skill_contract_mismatch":
      return new SkillNativeClientError("incompatible");
    case "invalid_request":
    case "install_failed":
    case "uninstall_failed":
    case "scan_failed":
    case "internal_error":
      return new SkillNativeClientError("operation-failed");
    default:
      return new SkillNativeClientError("unavailable");
  }
}

function validateSkillId(skillId: string): void {
  if (skillId.length < 3 || skillId.length > 128 || !SKILL_ID.test(skillId)) {
    throw new SkillNativeClientError("incompatible");
  }
}

function validateScanReason(reason: string): void {
  if (!SKILL_SCAN_REASON_SET.has(reason)) {
    throw new SkillNativeClientError("incompatible");
  }
}

function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation;
  if (signal.aborted) return Promise.reject(new SkillNativeClientError("aborted"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new SkillNativeClientError("aborted"));
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

export function createSkillNativeClient(
  nativeInvoke: SkillNativeInvoker = tauriInvoker,
): SkillNativeClient {
  async function run(
    command: string,
    arguments_?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<SkillCatalogSnapshot> {
    if (signal?.aborted) throw new SkillNativeClientError("aborted");
    try {
      const response = arguments_ === undefined
        ? nativeInvoke(command)
        : nativeInvoke(command, arguments_);
      return parseSkillCatalogSnapshot(await withAbort(response, signal));
    } catch (error: unknown) {
      throw mapNativeFailure(error);
    }
  }

  return {
    list: (signal) => run("skills_list_v1", undefined, signal),
    async scan(reason, signal) {
      validateScanReason(reason);
      return await run("skills_scan_v1", { reason }, signal);
    },
    async install(skillId) {
      validateSkillId(skillId);
      return await run("skills_install_v1", { skillId });
    },
    async setEnabled(skillId, enabled) {
      validateSkillId(skillId);
      return await run("skills_set_enabled_v1", { skillId, enabled });
    },
    async uninstall(skillId) {
      validateSkillId(skillId);
      return await run("skills_uninstall_v1", { skillId });
    },
  };
}

export const skillNativeClient = createSkillNativeClient();
