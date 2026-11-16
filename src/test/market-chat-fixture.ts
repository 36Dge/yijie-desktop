import type { DecisionFact, GatewayCallReceipt, MarketApproval, NativeObservation } from "../domain/market-host-v2-native.generated";
export const marketTestId = (tail: number) => `15700000-0000-4000-8000-${tail.toString().padStart(12, "0")}`;
export function marketApproval(): MarketApproval {
  const reference = { installationId: marketTestId(1), revision: 2, generation: 1 };
  return {
    approvalId: marketTestId(2), agentSessionId: marketTestId(3), kind: "mcp_market", revision: 1, state: "pending",
    expiresAtUnixMs: Date.now() + 60_000,
    identity: { binding: { context: { process: { hostInstanceId: marketTestId(4), runtimeGeneration: marketTestId(5) }, scope: { ownerUserId: marketTestId(6), tenantId: marketTestId(7), nativeProcessEpoch: marketTestId(8), authorizationRevision: 1, authorizationExpiresAtUnixMs: Date.now() + 120_000 }, agentSessionId: marketTestId(3), nativeThreadId: null }, capabilityRef: marketTestId(9), turnOperationId: marketTestId(10), selectionDigest: "a".repeat(64) }, nativeTurnId: marketTestId(11), callRef: marketTestId(12), serviceId: "tushareMcp", reference, toolName: "daily", argsDigest: "b".repeat(64), argsEncoding: "worker-json-v1", nativeThreadId: marketTestId(13) },
    review: { title: "查询每日行情", summary: "读取合成标的指定日期的一条行情数据。", risk: "read" },
  };
}
export function marketObservation(): NativeObservation {
  const approval = marketApproval();
  return { managed: true, selectionDisplay: [{ reference: approval.identity.reference, serviceId: "tushareMcp", displayName: "Tushare·金融数据" }], approvals: { agentSessionId: marketTestId(3), requests: [approval] }, tools: { agentSessionId: marketTestId(3), nativeTurnId: marketTestId(11), items: [{ nativeItemId: "native-item-1", nativeThreadId: marketTestId(13), nativeTurnId: marketTestId(11), serverName: "yijie_market", toolName: "lookup", state: "in_progress", truncated: false }], truncated: false } };
}
export function marketCallReceipt(): GatewayCallReceipt {
  const { identity } = marketApproval();
  return {
    schemaVersion: 1, callRef: identity.callRef, serviceId: identity.serviceId,
    reference: identity.reference, nativeThreadId: identity.nativeThreadId, nativeTurnId: identity.nativeTurnId,
    turnOperationId: identity.binding.turnOperationId, selectionDigest: identity.binding.selectionDigest,
    toolName: "lookup", argsDigest: identity.argsDigest, argsEncoding: identity.argsEncoding,
    decisionReceipt: { approvalId: marketTestId(2), decisionId: marketTestId(30), decision: "approve_once" },
    admissionConsumed: true,
  };
}
export function marketDecisionFact(kind: DecisionFact["kind"] = "acknowledged"): DecisionFact {
  const call = marketCallReceipt();
  return {
    schemaVersion: 1, approvalId: call.decisionReceipt!.approvalId, decisionId: call.decisionReceipt!.decisionId,
    callRef: call.callRef, serviceId: call.serviceId, reference: call.reference,
    nativeThreadId: call.nativeThreadId, nativeTurnId: call.nativeTurnId,
    turnOperationId: call.turnOperationId, selectionDigest: call.selectionDigest,
    toolName: call.toolName, argsDigest: call.argsDigest, argsEncoding: call.argsEncoding,
    decision: "approve_once", kind, observedAtUnixMs: Date.now(),
  };
}
