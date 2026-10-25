import { invoke } from "@tauri-apps/api/core";

// Private Native IPC, versioned with the Desktop SQL40 delivery proof reader.
export interface DeliveryState {
  readonly operationId: string;
  readonly turnId: string;
  readonly status: "never_sent" | "attempted" | "unclassified";
  readonly cancellable: boolean;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("提交状态暂不可用");
  return value as Record<string, unknown>;
}
export function parseDeliveryStates(value: unknown): readonly DeliveryState[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error("提交状态暂不可用");
  const seen = new Set<string>();
  return value.map(item => {
    const row = record(item);
    if (typeof row.operationId !== "string" || !uuid.test(row.operationId) || seen.has(row.operationId) ||
      typeof row.turnId !== "string" || !uuid.test(row.turnId) ||
      !["never_sent", "attempted", "unclassified"].includes(row.status as string) ||
      typeof row.cancellable !== "boolean" || row.cancellable !== (row.status === "never_sent")) throw new Error("提交状态暂不可用");
    seen.add(row.operationId);
    return { operationId: row.operationId, turnId: row.turnId, status: row.status, cancellable: row.cancellable } as DeliveryState;
  });
}
async function call(command: string, contextId: string, payload: object): Promise<unknown> {
  const requestId = crypto.randomUUID();
  const response = record(await invoke(command, { request: { schemaVersion: 1, requestId, contextId, payload } }));
  if (response.schemaVersion !== 1 || response.requestId !== requestId) throw new Error("提交响应不匹配");
  return response.data;
}
export const chatDeliveryClient = {
  async read(context: string, sessionId: string): Promise<readonly DeliveryState[]> {
    return parseDeliveryStates(await call("chat_delivery_state_v1", context, { sessionId }));
  },
  async cancel(context: string, sessionId: string, state: DeliveryState): Promise<void> {
    const receipt = record(await call("chat_cancel_unsent_delivery_v1", context, { sessionId, operationId: state.operationId }));
    if (receipt.schemaVersion !== 1 || receipt.sessionId !== sessionId || receipt.operationId !== state.operationId ||
      receipt.turnId !== state.turnId || receipt.outcome !== "cancelled_never_sent" ||
      !Number.isSafeInteger(receipt.cancelledAt) || (receipt.cancelledAt as number) < 0) throw new Error("取消结果待核实");
  },
};
