import { describe, expect, it } from "vitest";
import product from "../../contracts/market-catalog.json";
import { createMarketConnectorClient } from "./market-connectors-client";
import type { MutationResult } from "../domain/market-connectors.generated";
const context = "15700000-0000-4000-8000-000000000001";
const installation = "15700000-0000-4000-8000-000000000002";
const operation = "15700000-0000-4000-8000-000000000003";
const snapshot = () => ({ ...structuredClone(product), installations: [], capabilities: ["connector.read"], executionAvailable: false });
function client(data: unknown) {
  return createMarketConnectorClient(async (_, args) => {
    const request = args.request as { requestId: string };
    return { schemaVersion: 1, requestId: request.requestId, data };
  });
}
function installed(): MutationResult {
  return {
    operation: { operationId: operation, installationId: installation, serviceId: "cue", action: "install", status: "succeeded", revision: 1, cancellable: false },
    installation: { installationId: installation, serviceId: "cue", revision: 1, generation: 1, status: "installed", desiredEnabled: false, effectiveEnabled: false, configurationStatus: "unconfigured", authorizationStatus: "required", connectionStatus: "disconnected" },
  };
}
describe("market connector source-driven IPC", () => {
  it("reopens the exact original operation with its receipt revision and no credential fields", async () => {
    const calls: unknown[] = [];
    const api = createMarketConnectorClient(async (command, args) => {
      calls.push({ command, payload: (args.request as { payload: unknown }).payload });
      return { schemaVersion: 1, requestId: (args.request as { requestId: string }).requestId, data: { ...installed().operation, action: "authorize", status: "pending", revision: 4, cancellable: true } };
    });
    await api.reopen(context, operation, 3);
    expect(calls).toEqual([{ command: "market_connectors_operation_reopen_v1", payload: { operationId: operation, expectedRevision: 3 } }]);
  });
  it("reads the exact non-secret 49-service catalog without enabling execution", async () => {
    const result = await client(snapshot()).snapshot(context);
    expect(result.catalog).toHaveLength(49);
    expect(result.catalog.some(entry => ["taobao-flash-sale-retail", "doukou-doctor"].includes(entry.serviceId))).toBe(false);
    expect(result.executionAvailable).toBe(false);
  });
  it("tolerates future response fields while discarding them from UI state", async () => {
    const input = snapshot();
    Object.assign(input, { futureField: "unconsumed" });
    Object.assign(input.catalog[0]!, { futureField: "unconsumed" });
    const result = await client(input).snapshot(context);
    expect(result).not.toHaveProperty("futureField");
    expect(result.catalog[0]).not.toHaveProperty("futureField");
  });
  it("keeps incomplete or duplicate catalogs unavailable", async () => {
    const input = snapshot();
    input.catalog[1] = structuredClone(input.catalog[0]!);
    await expect(client(input).snapshot(context)).rejects.toMatchObject({ code: "unsupported_capability" });
  });
  it("does not reinterpret an unknown future state as available", async () => {
    const input = snapshot();
    Object.assign(input.catalog[0]!, { availability: "future_state" });
    await expect(client(input).snapshot(context)).rejects.toMatchObject({ code: "unsupported_capability" });
  });
  it("only exposes safe typed native errors", async () => {
    const api = createMarketConnectorClient(async (_, args) => {
      const request = args.request as { requestId: string };
      throw { schemaVersion: 1, requestId: request.requestId, code: "not_configured", retryable: false };
    });
    await expect(api.snapshot(context)).rejects.toMatchObject({ code: "not_configured" });
  });
  it("uses the supplied operation identity and revision for mutations", async () => {
    let captured: unknown;
    const api = createMarketConnectorClient(async (_, args) => {
      captured = args.request;
      const request = args.request as { requestId: string };
      throw { schemaVersion: 1, requestId: request.requestId, code: "revision_conflict", retryable: false };
    });
    const item = { installationId: installation, serviceId: "cue", revision: 4, generation: 2, status: "installed", desiredEnabled: false, effectiveEnabled: false, configurationStatus: "unconfigured", authorizationStatus: "required", connectionStatus: "disconnected" } as const;
    await expect(api.setEnabled(context, item, true, operation)).rejects.toMatchObject({ code: "revision_conflict" });
    expect(captured).toMatchObject({ contextId: context, payload: { operationId: operation, installationId: installation, expectedRevision: 4, desiredEnabled: true } });
  });
  it("keeps a committed mutation queryable when its response cannot be consumed", async () => {
    const result = installed();
    Object.assign(result.operation, { status: "future_status" });
    await expect(client(result).install(context, "cue", operation)).rejects.toMatchObject({ code: "outcome_unknown" });
    const wrongEnvelope = createMarketConnectorClient(async () => ({ schemaVersion: 1, requestId: context, data: installed() }));
    await expect(wrongEnvelope.install(context, "cue", operation)).rejects.toMatchObject({ code: "outcome_unknown" });
  });
  it("only accepts the receipt of the original operation and installation", async () => {
    await expect(client(installed()).install(context, "cue", operation)).resolves.toMatchObject(installed());
    const anotherOperation = installed();
    anotherOperation.operation.operationId = context;
    await expect(client(anotherOperation).install(context, "cue", operation)).rejects.toMatchObject({ code: "outcome_unknown" });
    await expect(client(anotherOperation.operation).operation(context, operation)).rejects.toMatchObject({ code: "outcome_unknown" });
    const anotherService = installed();
    anotherService.operation.serviceId = "future_service";
    await expect(client(anotherService).install(context, "cue", operation)).rejects.toMatchObject({ code: "outcome_unknown" });
    await expect(client(installed()).install(context, "another_service", operation)).rejects.toMatchObject({ code: "outcome_unknown" });
  });
});
