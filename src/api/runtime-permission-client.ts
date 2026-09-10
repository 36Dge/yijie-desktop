import { invoke } from "@tauri-apps/api/core";
import type { ChatPermissionState, PermissionMode } from "./generated/chat-permission-state.gen";
import type { components } from "./generated/runtime-permissions-v2.gen";

export type { ChatPermissionState, PermissionMode };
export type RuntimeApproval = components["schemas"]["RuntimeApproval"];
export type RuntimeApprovalDecision = components["schemas"]["RuntimeApprovalDecision"]["decision"];

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("审批数据暂不可用，请重试。");
  return value as Record<string, unknown>;
}

export function parsePermissionState(value: unknown): ChatPermissionState {
  const v = record(value);
  if (!["ask", "auto", "full"].includes(v.mode as string) || typeof v.fullAccessConfirmed !== "boolean" || typeof v.busy !== "boolean") throw new Error("权限状态暂不可用，请重试。");
  return { mode: v.mode as PermissionMode, fullAccessConfirmed: v.fullAccessConfirmed, busy: v.busy };
}

export function parseRuntimeApproval(value: unknown): RuntimeApproval {
  const v = record(value);
  if (typeof v.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.id) ||
    !["command", "file_change", "permissions", "auto_review", "mcp"].includes(v.kind as string) ||
    !["pending", "approved", "rejected", "unavailable", "cancelled"].includes(v.status as string) ||
    [v.summary, v.scope, v.reason].some((text) => typeof text !== "string" || text.length > 4096)) throw new Error("审批状态暂不可用，请重试。");
  if (Object.keys(v).some((key) => !["id", "kind", "summary", "scope", "reason", "status", "mcp"].includes(key))) throw new Error("审批字段暂不支持。");
  if (v.kind === "mcp") {
    const scope = record(v.mcp);
    if (Object.keys(scope).length !== 4 || scope.server !== "sorftime" || scope.tool !== "product_detail" || scope.marketplace !== "US" || typeof scope.asin !== "string" || !/^[A-Z0-9]{10}$/.test(scope.asin)) throw new Error("工具审批范围不可用。");
  } else if (v.mcp != null || v.status === "cancelled") throw new Error("审批范围不匹配。");
  return v as unknown as RuntimeApproval;
}

async function call(command: string, contextId: string, payload: Record<string, unknown>): Promise<unknown> {
  const requestId = crypto.randomUUID();
  try {
    const response = record(await invoke(command, { request: { schemaVersion: 1, requestId, contextId, payload } }));
    if (response.schemaVersion !== 1 || response.requestId !== requestId) throw new Error("权限响应不匹配，请重试。");
    return response.data;
  } catch {
    throw new Error("暂时无法同步权限或审批。请先正常结束活跃任务；若无法确认工具停用，请正常退出并重新启动。");
  }
}

export const runtimePermissionClient = {
  async get(contextId: string, sessionId: string | null): Promise<ChatPermissionState> {
    return parsePermissionState(await call("chat_get_permissions_v1", contextId, { sessionId }));
  },
  async set(contextId: string, sessionId: string | null, mode: PermissionMode, confirmFullAccess: boolean): Promise<ChatPermissionState> {
    return parsePermissionState(await call("chat_set_permissions_v1", contextId, { sessionId, mode, confirmFullAccess }));
  },
  async approvals(contextId: string, sessionId: string): Promise<RuntimeApproval[]> {
    const snapshot = record(await call("chat_runtime_approvals_v2", contextId, { sessionId }));
    if (!Array.isArray(snapshot.requests) || snapshot.requests.length > 128) throw new Error("审批状态暂不可用，请重试。");
    const requests = snapshot.requests.map(parseRuntimeApproval);
    if (new Set(requests.map((r) => r.id)).size !== requests.length) throw new Error("审批状态暂不可用，请重试。");
    return requests;
  },
  async decide(contextId: string, sessionId: string, approvalId: string, decision: RuntimeApprovalDecision): Promise<RuntimeApproval> {
    const result = parseRuntimeApproval(await call("chat_decide_runtime_approval_v2", contextId, { sessionId, approvalId, decision }));
    if (result.id !== approvalId) throw new Error("审批响应不匹配，请重试。");
    return result;
  },
};
