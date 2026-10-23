import { describe, expect, it, vi } from "vitest";
import { createExpertNativeClient } from "./expert-native-client";
import { expertDisplay, expertSnapshot, expertTestId as id } from "../test/expert-fixture";

describe("expert source-defined Native client", () => {
  it("reads developer metadata for the exact expert through the generated read-only interface", async () => {
    const transport = vi.fn(async (_command, { request }) => ({ schemaVersion: 1, requestId: request.requestId, data: { expert: request.payload, name: "易界 AI" } }));
    const result = await createExpertNativeClient(transport).developer(id(1), expertDisplay);
    expect(result.name).toBe("易界 AI");
    expect(transport.mock.calls[0]?.[0]).toBe("experts_developer_read_v1");
    expect(transport.mock.calls[0]?.[1].request.payload).toEqual({ expertId: expertDisplay.expertId, version: expertDisplay.version });
    expect(transport).toHaveBeenCalledOnce();
  });
  it("does not apply metadata returned for another version", async () => {
    const transport = vi.fn(async (_command, { request }) => ({ schemaVersion: 1, requestId: request.requestId, data: { expert: { ...request.payload, version: "0.2.0" }, name: "示例开发者" } }));
    await expect(createExpertNativeClient(transport).developer(id(1), expertDisplay)).rejects.toMatchObject({ code: "unsupported_capability" });
  });
  it("reads a normal source-validated catalog without promoting resource readiness to execution", async () => {
    const transport = vi.fn(async (_command, { request }) => ({ schemaVersion: 1, requestId: request.requestId, data: expertSnapshot() }));
    const result = await createExpertNativeClient(transport).snapshot(id(1));
    expect(result.experts[0]?.state).toBe("available");
    expect(result.executionAvailable).toBe(false);
    expect(transport.mock.calls[0]?.[0]).toBe("experts_snapshot_v1");
  });
  it("uses the requested operation for normal resource preparation and status reads", async () => {
    const expert = { expertId: expertDisplay.expertId, version: expertDisplay.version };
    const receipt = { operationId: id(2), expert, action: "prepare", state: "succeeded" };
    const transport = vi.fn(async (_command, { request }) => ({ schemaVersion: 1, requestId: request.requestId, data: receipt }));
    const client = createExpertNativeClient(transport);
    expect(await client.prepare(id(1), expert, id(2))).toEqual(receipt);
    expect(await client.operation(id(1), id(2))).toEqual(receipt);
    expect(transport.mock.calls.map(call => call[0])).toEqual(["experts_prepare_v1", "experts_operation_read_v1"]);
  });
  it.each(["prepare", "remove"] as const)("projects the normal display before the real %s request validator", async (action) => {
    const selection = { expertId: expertDisplay.expertId, version: expertDisplay.version };
    const transport = vi.fn(async (_command, { request }) => ({ schemaVersion: 1, requestId: request.requestId, data: { operationId: request.payload.operationId, expert: request.payload.expert, action, state: "succeeded" } }));
    const result = await createExpertNativeClient(transport)[action](id(1), expertDisplay, id(2));
    expect(result.expert).toEqual(selection);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[1].request.payload).toEqual({ operationId: id(2), expert: selection });
  });
  it("reports a missing Native command as unavailable without synthesizing a catalog", async () => {
    const transport = vi.fn(async () => { throw new Error("Native command unavailable"); });
    await expect(createExpertNativeClient(transport).snapshot(id(1))).rejects.toMatchObject({ code: "unsupported_capability" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("recovers only the original resource operation through its distinct generated command", async () => {
    const transport = vi.fn(async (_command, { request }) => ({ schemaVersion: 1, requestId: request.requestId, data: { operationId: request.payload.operationId, expert: { expertId: expertDisplay.expertId, version: expertDisplay.version }, action: "prepare", state: "rejected", errorCode: "request_conflict" } }));
    const result = await createExpertNativeClient(transport).recoverOperation(id(1), id(2));
    expect(result.state).toBe("rejected");
    expect(transport.mock.calls[0]?.[0]).toBe("experts_operation_recover_v1");
    expect(transport.mock.calls[0]?.[1].request.payload).toEqual({ operationId: id(2) });
    expect(transport).toHaveBeenCalledOnce();
  });
  it("recovers the exact session binding operation without a replacement selection or submit", async () => {
    const transport = vi.fn(async (_command, { request }) => ({ schemaVersion: 1, requestId: request.requestId, data: {
      binding: { sessionId: id(3), managed: true, bindingRevision: 2, expert: null, state: "none" },
      operation: { sessionId: id(3), operationId: id(2), expectedBindingRevision: 1, bindingRevision: 2, requestedExpert: null, state: "succeeded" },
    } }));
    const result = await createExpertNativeClient(transport).recoverBinding(id(1), id(3), id(2));
    expect(result.operation.operationId).toBe(id(2));
    expect(transport.mock.calls[0]?.[0]).toBe("chat_expert_binding_recover_v1");
    expect(transport.mock.calls[0]?.[1].request.payload).toEqual({ sessionId: id(3), operationId: id(2) });
    expect(transport).toHaveBeenCalledOnce();
  });
});
