import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExpertClientError, type ExpertNativeClient } from "../api/expert-native-client";
import type { BindingResult, BindingSetPayload, BindingView, NativeSubmitPayload } from "../domain/experts-v2.generated";
import { expertDisplay, expertTestId as id } from "../test/expert-fixture";
import { bindingTurnIntent, createChatExpertsStoreDefinition } from "./chat-experts.store";

const view = (): BindingView => ({ sessionId: id(2), managed: true, bindingRevision: 1, expert: expertDisplay, state: "ready" });
function setup() {
  const client = { developer: vi.fn(), snapshot: vi.fn(), prepare: vi.fn(), remove: vi.fn(), operation: vi.fn(), recoverOperation: vi.fn(), binding: vi.fn().mockResolvedValue(view()), setBinding: vi.fn(), bindingOperation: vi.fn(), recoverBinding: vi.fn(), submit: vi.fn() } satisfies ExpertNativeClient;
  const store = createChatExpertsStoreDefinition(client, `chat-expert-${crypto.randomUUID()}`)();
  store.bind(id(1), "scope-one");
  return { client, store };
}
function payload(): NativeSubmitPayload { return { expectedBindingRevision: 1, expert: { expertId: expertDisplay.expertId, version: expertDisplay.version }, submission: { operationId: id(3), projectId: null, sessionId: id(2), contentBlocks: [{ type: "text", text: "普通任务" }], intent: { profileId: "kimi-k3-max-v1", expectedRevision: 1 }, selection: [] } }; }
beforeEach(() => setActivePinia(createPinia()));
describe("Native expert binding and immutable local submission", () => {
  it("keeps managed ordinary revision zero in the expert family while unbound history stays ordinary", async () => {
    const ordinary: BindingView = { sessionId: id(2), managed: false, bindingRevision: 0, expert: null, state: "none" };
    expect(bindingTurnIntent(ordinary)).toBeUndefined();
    expect(bindingTurnIntent({ ...ordinary, managed: true })).toEqual({ expectedBindingRevision: 0, expert: null });
    const { client, store } = setup();
    const original = { ...payload(), expectedBindingRevision: 0, expert: null };
    client.submit.mockResolvedValue({ bindingRevision: 0, expert: null, receipt: { outcome: "local_durable_accepted", sessionId: id(2), localTurnId: id(5), turnOperationId: id(6), submissionOperationId: id(3), selectionDigest: "a".repeat(64) } });
    await store.submit(id(1), original);
    expect(store.bindings[id(2)]).toMatchObject({ managed: true, bindingRevision: 0, expert: null });
    expect(bindingTurnIntent(store.bindings[id(2)])).toEqual({ expectedBindingRevision: 0, expert: null });
  });
  it("keeps the effective expert until the Native remove receipt and retains explicit ordinary revision", async () => {
    const { client, store } = setup(); await store.refresh(id(2));
    let resolve!: (value: BindingResult) => void;
    client.setBinding.mockImplementation(() => new Promise<BindingResult>(done => { resolve = done; }));
    const removing = store.select(id(2), null);
    expect(store.bindings[id(2)]?.expert).toEqual(expertDisplay);
    expect(store.bindings[id(2)]?.state).toBe("applying");
    expect(await store.select(id(2), null)).toBe(false);
    const requested = client.setBinding.mock.calls[0]![1];
    resolve({ binding: { sessionId: id(2), managed: true, bindingRevision: 2, expert: null, state: "none" }, operation: { ...requested, requestedExpert: null, bindingRevision: 2, state: "succeeded" } });
    expect(await removing).toBe(true);
    expect(store.bindings[id(2)]).toMatchObject({ expert: null, bindingRevision: 2, state: "none" });
    expect(client.setBinding).toHaveBeenCalledTimes(1);
  });
  it("queries the original pending binding operation after same-scope context renewal", async () => {
    const { client, store } = setup(); await store.refresh(id(2));
    client.setBinding.mockImplementation(async (_ctx, request) => ({ binding: { ...view(), state: "applying", operationId: request.operationId }, operation: { ...request, requestedExpert: null, bindingRevision: 1, state: "pending" } }));
    expect(await store.select(id(2), null)).toBe(false);
    const original = store.pending[id(2)]!;
    store.bind(id(4), "scope-one");
    client.bindingOperation.mockResolvedValue({ binding: { sessionId: id(2), managed: true, bindingRevision: 2, expert: null, state: "none" }, operation: { ...original, bindingRevision: 2, requestedExpert: null, state: "succeeded" } });
    await store.refresh(id(2));
    expect(client.bindingOperation).toHaveBeenCalledWith(id(4), id(2), original.operationId);
    expect(client.setBinding).toHaveBeenCalledTimes(1);
    expect(store.pending[id(2)]).toBeUndefined();
  });
  it("keeps a complete unknown send and reuses its exact operation after renewal", async () => {
    const { client, store } = setup(); const original = payload();
    client.submit.mockRejectedValueOnce(new ExpertClientError("outcome_unknown"));
    await expect(store.submit(id(1), original)).rejects.toMatchObject({ code: "outcome_unknown" });
    store.bind(id(4), "scope-one");
    client.submit.mockRejectedValueOnce(new ExpertClientError("permission_denied"));
    await expect(store.submit(id(4), original)).rejects.toMatchObject({ code: "permission_denied" });
    expect(store.submissions[id(2)]).toEqual(original);
    await expect(store.submit(id(4), { ...original, expert: null })).rejects.toMatchObject({ code: "operation_pending" });
    expect(client.submit).toHaveBeenCalledTimes(2);
    client.submit.mockResolvedValue({ bindingRevision: 1, expert: expertDisplay, receipt: { outcome: "local_durable_accepted", sessionId: id(2), localTurnId: id(5), turnOperationId: id(6), submissionOperationId: id(3), selectionDigest: "a".repeat(64) } });
    await store.submit(id(4), original);
    expect(client.submit).toHaveBeenLastCalledWith(id(4), original);
    expect(store.submissions[id(2)]).toEqual(original);
    const calls = client.submit.mock.calls.length;
    await store.submit(id(4), original);
    expect(client.submit).toHaveBeenCalledTimes(calls);
    store.acknowledgeSubmission(original.submission.operationId);
    expect(store.submissions[id(2)]).toBeUndefined();
  });
  it("drops former-scope asynchronous bindings and pending intents", async () => {
    const { client, store } = setup(); let resolve!: (value: BindingView) => void;
    client.binding.mockImplementation(() => new Promise<BindingView>(done => { resolve = done; }));
    const reading = store.refresh(id(2)); store.bind(id(7), "scope-two"); resolve(view()); await reading;
    expect(store.bindings).toEqual({}); expect(store.pending).toEqual({}); expect(store.submissions).toEqual({});
  });
  it("keeps an accepted original submission when the subsequent binding read is unavailable", async () => {
    const { client, store } = setup(); const original = payload();
    client.submit.mockResolvedValue({ bindingRevision: 1, expert: expertDisplay, receipt: { outcome: "local_durable_accepted", sessionId: id(2), localTurnId: id(5), turnOperationId: id(6), submissionOperationId: id(3), selectionDigest: "a".repeat(64) } });
    await store.submit(id(1), original);
    client.binding.mockRejectedValue(new ExpertClientError("binding_unavailable"));
    await store.refresh(id(2));
    expect(store.errors[id(2)]).toBeDefined();
    expect(store.submissions[id(2)]).toEqual(original);
    await store.submit(id(1), original);
    expect(client.submit).toHaveBeenCalledOnce();
    store.acknowledgeSubmission(original.submission.operationId);
    expect(store.submissions[id(2)]).toBeUndefined();
  });
  it("a definitive busy rejection retains the old binding and can refresh without a fictitious journal", async () => {
    const { client, store } = setup(); await store.refresh(id(2));
    client.setBinding.mockRejectedValue(new ExpertClientError("busy"));
    expect(await store.select(id(2), null)).toBe(false);
    expect(store.pending[id(2)]).toBeUndefined(); expect(store.bindings[id(2)]).toEqual(view());
    await store.refresh(id(2)); expect(client.bindingOperation).not.toHaveBeenCalled(); expect(store.errors[id(2)]).toBeUndefined();
  });
  it("recovers only the original unknown binding and retains it through a normal busy guard", async () => {
    const { client, store } = setup();
    const original: BindingSetPayload = { operationId: id(8), sessionId: id(2), expectedBindingRevision: 1, expert: null };
    store.bindings = { [id(2)]: { ...view(), state: "unknown", operationId: original.operationId } };
    store.pending = { [id(2)]: original };
    const unchanged = store.bindings[id(2)];
    client.recoverBinding.mockRejectedValueOnce(new ExpertClientError("busy"));
    expect(await store.recover(id(2), id(8))).toBe(false);
    expect(store.bindings[id(2)]).toEqual(unchanged); expect(store.pending[id(2)]).toEqual(original);
    client.recoverBinding.mockResolvedValue({ binding: { sessionId: id(2), managed: true, bindingRevision: 2, expert: null, state: "none" }, operation: { operationId: id(8), sessionId: id(2), expectedBindingRevision: 1, bindingRevision: 2, requestedExpert: null, state: "succeeded" } });
    expect(await store.recover(id(2), id(8))).toBe(true);
    expect(store.pending[id(2)]).toBeUndefined(); expect(store.bindings[id(2)]).toMatchObject({ bindingRevision: 2, expert: null });
    expect(client.recoverBinding).toHaveBeenLastCalledWith(id(1), id(2), id(8));
    expect(client.setBinding).not.toHaveBeenCalled(); expect(client.bindingOperation).not.toHaveBeenCalled(); expect(client.submit).not.toHaveBeenCalled();
  });
});
