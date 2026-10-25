import { beforeEach, expect, it, vi } from "vitest";
import { chatDeliveryClient, parseDeliveryStates } from "./chat-delivery-client";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const row = { operationId: "11111111-1111-4111-8111-111111111111", turnId: "22222222-2222-4222-8222-222222222222", status: "never_sent" as const, cancellable: true };
beforeEach(() => vi.resetAllMocks());
it("unknown or contradictory delivery state cannot enable cancellation", () => {
  expect(parseDeliveryStates([row])).toEqual([row]);
  for (const item of [{ ...row, status: "future" }, { ...row, status: "attempted" }, { ...row, cancellable: undefined }]) expect(() => parseDeliveryStates([item])).toThrow();
  expect(() => parseDeliveryStates([row, row])).toThrow();
});
it("cancel IPC keeps the original operation and verifies its receipt", async () => {
  invoke.mockImplementation(async (_command, { request }) => ({ schemaVersion: 1, requestId: request.requestId, data: { schemaVersion: 1, sessionId: "session", operationId: row.operationId, turnId: row.turnId, outcome: "cancelled_never_sent", cancelledAt: 1 } }));
  await chatDeliveryClient.cancel("scope", "session", row);
  expect(invoke.mock.calls[0]?.[0]).toBe("chat_cancel_unsent_delivery_v1"); expect(invoke.mock.calls[0]?.[1].request.payload).toEqual({ sessionId: "session", operationId: row.operationId });
  await expect(chatDeliveryClient.cancel("scope", "different", row)).rejects.toThrow();
});
