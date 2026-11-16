import { describe, expect, it, vi } from "vitest";
import { createMarketHostNativeClient, MarketChatError, marketChatErrorMessage } from "./market-host-native-client";
import { marketCallReceipt, marketDecisionFact, marketObservation, marketTestId as id } from "../test/market-chat-fixture";

describe("market Native UI wire", () => {
  it("keeps offline decision facts readable without granting live approval", async () => {
    const observation = marketObservation();
    observation.approvals = undefined; observation.tools = undefined;
    observation.decisionFacts = [marketDecisionFact("unconfirmed")]; observation.remoteIssue = "not_ready";
    const transport = vi.fn(async (_command, { request }) => ({ schemaVersion: 1, requestId: request.requestId, data: observation }));
    const result = await createMarketHostNativeClient(transport).observe(id(20), id(21), undefined, "none");
    expect(result.decisionFacts?.[0]?.kind).toBe("unconfirmed"); expect(result.approvals).toBeUndefined();
    expect(result.remoteIssue).toBe("not_ready");
    expect(transport.mock.calls[0]![1].request.payload.toolsRead).toBe("none");
  });
  it("falls back once to an older Native read without retrying decisions", async () => {
    const transport = vi.fn(async (_command, { request }) => {
      if (request.payload.toolsRead) throw { schemaVersion: 1, requestId: request.requestId, code: "invalid_request", retryable: false };
      return { schemaVersion: 1, requestId: request.requestId, data: marketObservation() };
    });
    const client = createMarketHostNativeClient(transport);
    await client.observe(id(20), id(21), undefined, "events");
    await client.observe(id(20), id(21), undefined, "none");
    expect(transport.mock.calls.map(call => call[1].request.payload.toolsRead)).toEqual(["events", undefined, undefined]);
    expect(transport.mock.calls.every(call => call[0] === "chat_market_observe_v1")).toBe(true);
  });
  it("preserves a bounded correlation receipt and its required nullable decision", async () => {
    const observation = marketObservation();
    const item = observation.tools!.items[0]!;
    item.correlation = marketCallReceipt(); item.callRef = item.correlation.callRef;
    const transport = vi.fn(async (_command, { request }) => ({ schemaVersion: 1, requestId: request.requestId, data: observation }));
    const client = createMarketHostNativeClient(transport);
    expect((await client.observe(id(20), id(21))).tools?.items[0]?.correlation).toEqual(item.correlation);
    item.correlation = { ...item.correlation, admissionConsumed: false, decisionReceipt: null };
    expect((await client.observe(id(20), id(21))).tools?.items[0]?.correlation?.decisionReceipt).toBeNull();
    expect(transport).toHaveBeenCalledTimes(2);
  });
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
  it("explains unavailable shared credentials without retrying the request", async () => {
    const transport = vi.fn(async (_command, { request }) => { throw { schemaVersion: 1, requestId: request.requestId, code: "not_configured", retryable: false }; });
    const error = await createMarketHostNativeClient(transport).observe(id(20), id(21)).catch((failure: unknown) => failure);
    expect(error).toEqual(new MarketChatError("not_configured"));
    expect(marketChatErrorMessage(error)).toBe("连接器所需凭据暂不可用，请检查对应模型或连接器的配置。");
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
