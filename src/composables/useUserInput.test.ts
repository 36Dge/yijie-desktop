// @vitest-environment happy-dom
import { defineComponent, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userInputClient, type UserInputRequest } from "../api/user-input-client";
import { ChatClientError } from "../domain/chat-ipc";
import { useUserInput } from "./useUserInput";
vi.mock("../api/user-input-client", () => ({ userInputClient: { snapshot: vi.fn(), read: vi.fn(), touch: vi.fn(), answer: vi.fn() } }));
const pending: UserInputRequest = { request_id: "10000000-0000-4000-8000-000000000001", turn_id: "turn", item_id: "item", state: "pending", timeout_paused: false, questions: [{ id: "colour", header: "颜色", question: "普通样例", isOther: true }] };
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); vi.mocked(userInputClient.snapshot).mockResolvedValue({ enabled: true, requests: [pending] }); });
afterEach(() => { vi.useRealTimers(); });
function harness(canAnswer = true) {
  const session = ref("session-one"); let model!: ReturnType<typeof useUserInput>;
  const wrapper = mount(defineComponent({ setup() { model = useUserInput(() => "context", () => session.value, () => canAnswer); return () => null; } }));
  return { wrapper, session, get model() { return model; } };
}
describe("user input request coordination", () => {
  it("reads the original receipt after an uncertain write and never resends", async () => {
    const h = harness(); await flushPromises();
    vi.mocked(userInputClient.answer).mockRejectedValue(new Error("ordinary transport closure"));
    vi.mocked(userInputClient.read).mockResolvedValue({ ...pending, state: "answered", questions: [] });
    await h.model.answer({ colour: { answers: ["blue"] } }); await flushPromises();
    expect(userInputClient.answer).toHaveBeenCalledTimes(1);
    expect(userInputClient.read).toHaveBeenCalledWith("context", "session-one", pending.request_id);
    expect(h.model.current.value?.state).toBe("answered");
    h.wrapper.unmount();
  });
  it("updates a pending snapshot when another window pauses the timer", async () => {
    const h = harness(); await flushPromises();
    vi.mocked(userInputClient.snapshot).mockResolvedValue({ enabled: true, requests: [{ ...pending, timeout_paused: true }] });
    await h.model.refresh();
    expect(h.model.current.value?.timeout_paused).toBe(true);
    h.wrapper.unmount();
  });
  it("clears old pending state when the Host generation changes", async () => {
    vi.mocked(userInputClient.snapshot).mockResolvedValue({ enabled: true, generation: "10000000-0000-4000-8000-000000000011", requests: [pending] });
    const h = harness(); await flushPromises();
    vi.mocked(userInputClient.snapshot).mockResolvedValue({ enabled: true, generation: "10000000-0000-4000-8000-000000000012", requests: [] });
    await h.model.refresh();
    expect(h.model.current.value).toBeNull();
    expect(h.model.notice.value).toContain("旧问题不能继续回答");
    expect(userInputClient.read).not.toHaveBeenCalled();
    h.wrapper.unmount();
  });
  it("ignores an old session response after switching chats", async () => {
    let resolve!: (v: { enabled: boolean; requests: UserInputRequest[] }) => void;
    vi.mocked(userInputClient.snapshot).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const h = harness();
    vi.mocked(userInputClient.snapshot).mockResolvedValue({ enabled: true, requests: [] });
    h.session.value = "session-two"; await flushPromises();
    resolve({ enabled: true, requests: [pending] }); await flushPromises();
    expect(h.model.current.value).toBeNull();
    expect(userInputClient.answer).not.toHaveBeenCalled();
    h.wrapper.unmount();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const notFound = () => new ChatClientError({ schemaVersion: 1, requestId: pending.request_id, code: "chat_resource_not_found", retryable: false, recovery: "reload" });
const optional = { ...pending, deadline_at: "2026-11-08T08:00:00Z" };
describe("user input lifecycle regressions", () => {
  it("retires an expired receipt only after an empty snapshot and typed not-found", async () => {
    const h = harness(); await flushPromises();
    vi.mocked(userInputClient.snapshot).mockResolvedValue({ enabled: true, requests: [] });
    vi.mocked(userInputClient.read).mockRejectedValue(notFound());
    await h.model.refresh();
    expect(h.model.current.value).toBeNull();
    expect(h.model.connected.value).toBe(true);
    expect(h.model.notice.value).toContain("历史回答结果暂时无法确认");
    await h.model.refresh();
    expect(userInputClient.read).toHaveBeenCalledTimes(1);
    expect(userInputClient.answer).not.toHaveBeenCalled();
    h.wrapper.unmount();
  });
  it("keeps an uncertain answer when the current snapshot still contains its request", async () => {
    const h = harness(); await flushPromises();
    vi.mocked(userInputClient.answer).mockRejectedValue(new Error("ordinary connection ended"));
    vi.mocked(userInputClient.read).mockRejectedValue(notFound());
    await h.model.answer({ colour: { answers: ["blue"] } }); await flushPromises();
    expect(h.model.current.value?.request_id).toBe(pending.request_id);
    expect(h.model.blocked.value).toBe(true);
    vi.mocked(userInputClient.snapshot).mockResolvedValue({ enabled: true, requests: [] });
    await h.model.refresh();
    expect(h.model.current.value).toBeNull();
    expect(h.model.notice.value).toContain("历史回答结果暂时无法确认");
    expect(userInputClient.answer).toHaveBeenCalledTimes(1);
    h.wrapper.unmount();
  });
  it.each([new Error("ordinary HTTP 404"), new ChatClientError({ schemaVersion: 1, requestId: pending.request_id, code: "chat_protocol_error", retryable: false, recovery: "resync" })])("does not treat an unconfirmed read failure as a retired receipt", async failure => {
    const h = harness(); await flushPromises();
    vi.mocked(userInputClient.snapshot).mockResolvedValue({ enabled: true, requests: [] });
    vi.mocked(userInputClient.read).mockRejectedValue(failure);
    await h.model.refresh();
    expect(h.model.current.value?.request_id).toBe(pending.request_id);
    expect(h.model.connected.value).toBe(false);
    expect(h.model.notice.value).toBeNull();
    h.wrapper.unmount();
  });
  it.each(["success", "failure"])("ignores late touch %s after answer and preserves the newer receipt read", async outcome => {
    vi.mocked(userInputClient.snapshot).mockResolvedValue({ enabled: true, requests: [optional] });
    const h = harness(); await flushPromises();
    const touched = deferred<UserInputRequest>();
    vi.mocked(userInputClient.touch).mockReturnValue(touched.promise);
    const touch = h.model.touch();
    const receipt = deferred<UserInputRequest>();
    vi.mocked(userInputClient.answer).mockResolvedValue({ ...pending, state: "submitting" });
    vi.mocked(userInputClient.read).mockReturnValue(receipt.promise);
    await h.model.answer({ colour: { answers: ["blue"] } }); await flushPromises();
    expect(userInputClient.read).toHaveBeenCalledTimes(1);
    if (outcome === "success") touched.resolve({ ...optional, timeout_paused: true });
    else touched.reject(new Error("ordinary connection ended"));
    await touch;
    expect(h.model.current.value?.state).toBe("submitting");
    expect(h.model.error.value).toBeNull();
    receipt.resolve({ ...pending, state: "answered", questions: [] }); await flushPromises();
    expect(h.model.current.value?.state).toBe("answered");
    expect(h.model.notice.value).toBe("回答已发送");
    expect(h.model.blocked.value).toBe(false);
    h.wrapper.unmount();
  });
  it("discards an old poll error without clearing a newer read's loading state", async () => {
    const h = harness(); await flushPromises();
    type Snapshot = Awaited<ReturnType<typeof userInputClient.snapshot>>;
    const older = deferred<Snapshot>(), newer = deferred<Snapshot>();
    vi.mocked(userInputClient.snapshot).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const first = h.model.refresh(), second = h.model.refresh();
    older.reject(new Error("ordinary transport closure")); await first;
    expect(h.model.loading.value).toBe(true);
    expect(h.model.error.value).toBeNull();
    expect(h.model.connected.value).toBe(true);
    newer.resolve({ enabled: true, requests: [{ ...pending, timeout_paused: true }] }); await second;
    expect(h.model.current.value?.timeout_paused).toBe(true);
    expect(h.model.loading.value).toBe(false);
    h.wrapper.unmount();
  });
  it("does not let an older poll replace a newer snapshot", async () => {
    const h = harness(); await flushPromises();
    const older = deferred<Awaited<ReturnType<typeof userInputClient.snapshot>>>();
    vi.mocked(userInputClient.snapshot).mockReturnValueOnce(older.promise).mockResolvedValueOnce({ enabled: true, requests: [{ ...pending, timeout_paused: true }] });
    const first = h.model.refresh(); await h.model.refresh();
    older.resolve({ enabled: true, requests: [pending] }); await first;
    expect(h.model.current.value?.timeout_paused).toBe(true);
    h.wrapper.unmount();
  });
  it("ignores a poll failure from before a successful answer", async () => {
    const h = harness(); await flushPromises();
    const older = deferred<Awaited<ReturnType<typeof userInputClient.snapshot>>>();
    vi.mocked(userInputClient.snapshot).mockReturnValueOnce(older.promise);
    const poll = h.model.refresh();
    vi.mocked(userInputClient.answer).mockResolvedValue({ ...pending, state: "answered", questions: [] });
    await h.model.answer({ colour: { answers: ["blue"] } }); await flushPromises();
    older.reject(new Error("ordinary old connection ended")); await poll;
    expect(h.model.current.value?.state).toBe("answered");
    expect(h.model.notice.value).toBe("回答已发送");
    expect(h.model.error.value).toBeNull();
    expect(h.model.connected.value).toBe(true);
    h.wrapper.unmount();
  });
  it("prevents read-only touch and answer at the UI entry point", async () => {
    vi.mocked(userInputClient.snapshot).mockResolvedValue({ enabled: true, requests: [optional] });
    const h = harness(false); await flushPromises();
    await h.model.touch(); await h.model.answer({});
    expect(userInputClient.touch).not.toHaveBeenCalled();
    expect(userInputClient.answer).not.toHaveBeenCalled();
    h.wrapper.unmount();
  });
});
