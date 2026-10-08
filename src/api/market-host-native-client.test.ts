import { describe, expect, it, vi } from "vitest";
import { createMarketHostNativeClient, MarketChatError } from "./market-host-native-client";
import { marketObservation, marketTestId as id } from "../test/market-chat-fixture";

describe("market Native UI wire", () => {
  it("projects actual native tool identities and discards future response fields", async () => {
    const observation = marketObservation();
    const transport = vi.fn(async (_command, { request }) => ({ schemaVersion: 1, requestId: request.requestId, data: { ...observation, futureStatus: "future", tools: { ...observation.tools, extra: 1 } } }));
    const result = await createMarketHostNativeClient(transport).observe(id(20), id(21));
    expect(result).toEqual(observation);
    expect(result.tools?.items[0]?.callRef).toBeUndefined();
  });
  it("keeps an unconfirmed decision unknown without retrying transport", async () => {
    const transport = vi.fn(async () => { throw new Error("interrupted"); });
    const pending = createMarketHostNativeClient(transport).decide(id(20), { sessionId: id(21), approvalId: id(2), expectedRevision: 1, decisionId: id(22), decision: "approve_once" });
    await expect(pending).rejects.toMatchObject({ code: "operation_uncertain", outcomeUnknown: true });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("maps a Native local receipt without promoting it to Runtime acceptance", async () => {
    const transport = vi.fn(async (_command, { request }) => ({ schemaVersion: 1, requestId: request.requestId, data: { outcome: "local_durable_accepted", sessionId: id(21), localTurnId: id(23), submissionOperationId: id(24), turnOperationId: id(25), selectionDigest: "c".repeat(64), future: "ignored" } }));
    const result = await createMarketHostNativeClient(transport).submit(id(20), { operationId: id(24), projectId: null, contentBlocks: [{ type: "text", text: "普通合成查询" }], intent: { profileId: "kimi-k3-max-v1", expectedRevision: 0 }, selection: [] });
    expect(result.outcome).toBe("local_durable_accepted");
    expect(result).not.toHaveProperty("nativeTurnId");
    expect(result).not.toHaveProperty("future");
  });
  it("renders only typed errors from Native", async () => {
    const transport = vi.fn(async (_command, { request }) => { throw { schemaVersion: 1, requestId: request.requestId, code: "permission_mode_unavailable", retryable: false }; });
    await expect(createMarketHostNativeClient(transport).observe(id(20), id(21))).rejects.toEqual(new MarketChatError("permission_mode_unavailable"));
  });
});
