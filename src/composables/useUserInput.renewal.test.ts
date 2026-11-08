// @vitest-environment happy-dom
import { defineComponent, h, ref, watch } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatUserInput from "../components/chat/ChatUserInput.vue";
import { userInputClient, type UserInputRequest } from "../api/user-input-client";
import { useUserInput } from "./useUserInput";
import { ChatClientError } from "../domain/chat-ipc";
import { createPinia, setActivePinia } from "pinia";
import { createPermissionStoreDefinition } from "../stores/permission.store";
import { createChatPermissionLifecycle } from "../authorization/chat-permission-lifecycle";
import { userInputDraftScope } from "../domain/user-input-draft-scope";
vi.mock("../api/user-input-client", () => ({ userInputClient: { snapshot: vi.fn(), read: vi.fn(), touch: vi.fn(), answer: vi.fn() } }));
const generation = "10000000-0000-4000-8000-000000000011";
const pending: UserInputRequest = { request_id: "10000000-0000-4000-8000-000000000001", turn_id: "ordinary-turn", item_id: "ordinary-item", state: "pending", timeout_paused: true, questions: [{ id: "note", header: "备注", question: "普通合成备注", isOther: true, isSecret: true }] };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-08T14:00:00Z")); vi.resetAllMocks();
  vi.mocked(userInputClient.snapshot).mockResolvedValue({ enabled: true, generation, requests: [pending] });
});
afterEach(() => vi.useRealTimers());
function harness() {
  const context = ref<string | null>("context-one"), session = ref("session-one"), canAnswer = ref(true);
  const scope = ref<{ key: string; expiresAt: number } | null>({ key: "native-local-tenant:7:read,create", expiresAt: Date.now() + 300_000 });
  let model!: ReturnType<typeof useUserInput>;
  const wrapper = mount(defineComponent({ setup() {
    model = useUserInput(() => context.value, () => session.value, () => canAnswer.value, () => scope.value);
    return () => model.current.value && ["pending", "submitting"].includes(model.current.value.state)
      ? h(ChatUserInput, { key: model.formKey.value, request: model.current.value, disabled: model.blocked.value, submitting: model.submitting.value, revalidating: model.revalidating.value, onInteract: model.touch, onAnswer: model.answer }) : null;
  } }));
  return { context, session, canAnswer, scope, wrapper, get model() { return model; } };
}
describe("question drafts across ordinary Native context renewal", () => {
  it("keeps a masked draft for the same verified question after a normal context replacement", async () => {
    const t = harness(); await flushPromises();
    await t.wrapper.get("input").setValue("ordinary synthetic note");
    await t.wrapper.get(".user-input__secret button").trigger("click");
    t.context.value = null; t.canAnswer.value = false; await flushPromises();
    expect(t.wrapper.find("input").exists()).toBe(false);
    expect(userInputClient.answer).not.toHaveBeenCalled();
    t.canAnswer.value = true; t.context.value = "context-two"; await flushPromises();
    expect((t.wrapper.get("input").element as HTMLInputElement).value).toBe("ordinary synthetic note");
    expect(t.wrapper.get("input").attributes("type")).toBe("password");
    await t.wrapper.get(".primary").trigger("click");
    expect(userInputClient.answer).toHaveBeenCalledOnce();
    expect(userInputClient.answer).toHaveBeenCalledWith("context-two", "session-one", pending.request_id, expect.objectContaining({ answers: { note: { answers: ["ordinary synthetic note"] } } }));
    t.wrapper.unmount();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function fill(t: ReturnType<typeof harness>) {
  await flushPromises(); await t.wrapper.get("input").setValue("ordinary private draft");
}
async function renew(t: ReturnType<typeof harness>) {
  t.context.value = null; t.canAnswer.value = false; await flushPromises();
  t.canAnswer.value = true; t.context.value = "renewed-context"; await flushPromises();
}
describe("question draft safety during revalidation", () => {
  it.each(["tenant", "revision", "capability", "logout"])("clears the draft on %s changes, including change-away then change-back", async kind => {
    const t = harness(); await fill(t);
    const original = t.scope.value!;
    t.context.value = null;
    t.scope.value = kind === "logout" ? null : { ...original, key: `${kind}-changed` };
    await flushPromises();
    t.scope.value = original; t.context.value = "renewed-context"; await flushPromises();
    expect((t.wrapper.get("input").element as HTMLInputElement).value).toBe("");
    expect(userInputClient.answer).not.toHaveBeenCalled(); t.wrapper.unmount();
  });
  it.each(["generation", "request", "turn", "item", "question", "secret flag", "missing generation"])("requires an exact %s match before reusing input", async changed => {
    const t = harness(); await fill(t);
    const row = { ...pending, questions: pending.questions.map(q => ({ ...q })) };
    let nextGeneration: string | undefined = generation;
    if (changed === "generation") nextGeneration = "10000000-0000-4000-8000-000000000012";
    if (changed === "missing generation") nextGeneration = undefined;
    if (changed === "request") row.request_id = "10000000-0000-4000-8000-000000000002";
    if (changed === "turn") row.turn_id = "next-turn";
    if (changed === "item") row.item_id = "next-item";
    if (changed === "question") row.questions[0]!.question = "另一个普通问题";
    if (changed === "secret flag") row.questions[0]!.isSecret = false;
    vi.mocked(userInputClient.snapshot).mockResolvedValue({ enabled: true, generation: nextGeneration, requests: [row] });
    await renew(t);
    expect((t.wrapper.get("input, textarea").element as HTMLInputElement).value).toBe("");
    expect(userInputClient.answer).not.toHaveBeenCalled(); t.wrapper.unmount();
  });
  it("does not restore a draft when the original question has ended", async () => {
    const t = harness(); await fill(t);
    vi.mocked(userInputClient.snapshot).mockResolvedValue({ enabled: true, generation, requests: [] });
    vi.mocked(userInputClient.read).mockResolvedValue({ ...pending, state: "cancelled", questions: [] });
    await renew(t);
    expect(t.wrapper.find("input").exists()).toBe(false);
    expect(t.model.notice.value).toBe("问题已结束");
    expect(userInputClient.answer).not.toHaveBeenCalled(); t.wrapper.unmount();
  });
  it("keeps content out of the DOM and disables send until the new native read finishes", async () => {
    const t = harness(); await fill(t);
    const read = deferred<Awaited<ReturnType<typeof userInputClient.snapshot>>>();
    vi.mocked(userInputClient.snapshot).mockReturnValueOnce(read.promise);
    await renew(t);
    expect(t.wrapper.find("input").exists()).toBe(false);
    expect(t.model.blocked.value).toBe(true);
    await t.model.answer({ note: { answers: ["ordinary value"] } });
    await t.model.touch();
    expect(userInputClient.answer).not.toHaveBeenCalled(); expect(userInputClient.touch).not.toHaveBeenCalled();
    read.resolve({ enabled: true, generation, requests: [pending] }); await flushPromises();
    expect((t.wrapper.get("input").element as HTMLInputElement).value).toBe("ordinary private draft");
    t.wrapper.unmount();
  });
  it("discards input on a Native permission rejection and does not restore it on retry", async () => {
    const t = harness(); await fill(t);
    vi.mocked(userInputClient.snapshot).mockRejectedValueOnce(new ChatClientError({ schemaVersion: 1, code: "chat_context_invalid", retryable: false, recovery: "resync" }));
    await renew(t);
    expect(t.wrapper.find("input").exists()).toBe(false);
    await t.model.refresh();
    expect((t.wrapper.get("input").element as HTMLInputElement).value).toBe("");
    t.wrapper.unmount();
  });
  it("does not retain secret input when a new context is read-only", async () => {
    const t = harness(); await fill(t);
    t.context.value = null; t.canAnswer.value = false; await flushPromises();
    t.context.value = "read-only-context"; await flushPromises();
    expect((t.wrapper.get("input").element as HTMLInputElement).value).toBe("");
    expect(t.model.blocked.value).toBe(true); t.wrapper.unmount();
  });
  it("ends temporary retention after 60 seconds without sending an answer", async () => {
    const t = harness(); await fill(t); t.context.value = null; await flushPromises();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(t.model.current.value).toBeNull();
    expect(t.model.notice.value).toContain("未发送的回答已清除");
    t.context.value = "renewed-context"; await flushPromises();
    expect((t.wrapper.get("input").element as HTMLInputElement).value).toBe("");
    expect(userInputClient.answer).not.toHaveBeenCalled(); t.wrapper.unmount();
  });
  it("clears input at projection expiry and ignores a late successful read", async () => {
    const t = harness(); await fill(t);
    t.scope.value = { ...t.scope.value!, expiresAt: Date.now() + 1_000 };
    const read = deferred<Awaited<ReturnType<typeof userInputClient.snapshot>>>();
    vi.mocked(userInputClient.snapshot).mockReturnValueOnce(read.promise);
    await renew(t); await vi.advanceTimersByTimeAsync(1_001);
    read.resolve({ enabled: true, generation, requests: [pending] }); await flushPromises();
    expect(t.model.current.value).toBeNull(); expect(t.wrapper.find("input").exists()).toBe(false);
    expect(userInputClient.answer).not.toHaveBeenCalled(); t.wrapper.unmount();
  });
  it("does not carry input to another chat or after leaving the page", async () => {
    const t = harness(); await fill(t); t.session.value = "session-two"; await flushPromises();
    expect((t.wrapper.get("input").element as HTMLInputElement).value).toBe("");
    await fill(t); t.wrapper.unmount();
    const next = harness(); await flushPromises();
    expect((next.wrapper.get("input").element as HTMLInputElement).value).toBe(""); next.wrapper.unmount();
  });
  it("preserves choices, freeform text and the current page during routine renewal", async () => {
    const row = { ...pending, questions: [{ id: "choice", header: "颜色", question: "普通选项", options: [{ label: "蓝色", description: "普通" }, { label: "绿色", description: "普通" }] }, { id: "text", header: "备注", question: "普通文本", isOther: true }] };
    vi.mocked(userInputClient.snapshot).mockResolvedValue({ enabled: true, generation, requests: [row] });
    const t = harness(); await flushPromises();
    await t.wrapper.findAll(".user-input__option")[1]!.trigger("click");
    await t.wrapper.get(".primary").trigger("click");
    await t.wrapper.get("textarea").setValue("普通未发送文本");
    await renew(t);
    expect((t.wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("普通未发送文本");
    await t.wrapper.get('[aria-label="上一题"]').trigger("click");
    expect(t.wrapper.findAll('.user-input__option[aria-pressed="true"]')[0]!.text()).toContain("绿色");
    t.wrapper.unmount();
  });
});

it("preserves a draft through two real permission-store timer renewals without bypassing dispose/bind", async () => {
  setActivePinia(createPinia());
  const tenant = "10000000-0000-4000-8000-000000000021";
  const permissionClient = {
    listMyTenants: vi.fn(async () => [{ tenantId: tenant, displayName: "普通本地租户" }]),
    getMyCapabilities: vi.fn(async () => ({ tenantId: tenant, authorizationRevision: 7, expiresAt: new Date(Date.now() + 300_000).toISOString(), expiresAtEpochMs: Date.now() + 300_000, capabilities: ["task.read", "task.create"] as const })),
  };
  const permissions = createPermissionStoreDefinition(permissionClient, "question-renewal-projection")();
  const t = harness();
  let bound = 0;
  const boundary = {
    dispose: vi.fn(async () => { t.context.value = null; t.canAnswer.value = false; }),
    bind: vi.fn(async () => { t.canAnswer.value = true; t.context.value = `native-context-${++bound}`; }),
  };
  const lifecycle = createChatPermissionLifecycle(boundary, true);
  // Same source values and sync ordering used by App and ChatPage. Neither
  // permission refresh nor Chat dispose/bind is replaced by draft retention.
  const stop = watch(() => [permissions.phase, permissions.selectedTenantId, permissions.authorizationRevision, permissions.expiresAt, permissions.capabilities] as const, () => {
    t.scope.value = userInputDraftScope({ ready: permissions.isReady, tenantId: permissions.selectedTenantId, authorizationRevision: permissions.authorizationRevision, expiresAt: permissions.expiresAt, capabilities: permissions.capabilities });
    void lifecycle.synchronize({ ready: permissions.isReady, tenantId: permissions.selectedTenantId, authorizationRevision: permissions.authorizationRevision, expiresAt: permissions.expiresAt, canCreateTask: permissions.hasCapability("task.create"), canReadTask: permissions.hasCapability("task.read") });
  }, { immediate: true, flush: "sync" });
  await permissions.ensureInitialized(); await fill(t);
  const before = boundary.bind.mock.calls.length;
  await vi.advanceTimersByTimeAsync(270_001); await flushPromises();
  expect(boundary.bind.mock.calls.length).toBe(before + 1);
  expect((t.wrapper.get("input").element as HTMLInputElement).value).toBe("ordinary private draft");
  await vi.advanceTimersByTimeAsync(270_001); await flushPromises();
  expect(boundary.bind.mock.calls.length).toBe(before + 2);
  expect(boundary.dispose).toHaveBeenCalledTimes(boundary.bind.mock.calls.length);
  expect((t.wrapper.get("input").element as HTMLInputElement).value).toBe("ordinary private draft");
  expect(userInputClient.answer).not.toHaveBeenCalled();
  stop(); t.wrapper.unmount(); await lifecycle.stop(); permissions.$dispose();
});

it("ignores an old context proof after another renewal begins", async () => {
  const t = harness(); await fill(t);
  const older = deferred<Awaited<ReturnType<typeof userInputClient.snapshot>>>();
  const newer = deferred<Awaited<ReturnType<typeof userInputClient.snapshot>>>();
  vi.mocked(userInputClient.snapshot).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  await renew(t);
  t.context.value = "third-context"; await flushPromises();
  older.resolve({ enabled: true, generation, requests: [pending] }); await flushPromises();
  expect(t.model.blocked.value).toBe(true); expect(t.wrapper.find("input").exists()).toBe(false);
  newer.resolve({ enabled: true, generation, requests: [pending] }); await flushPromises();
  expect((t.wrapper.get("input").element as HTMLInputElement).value).toBe("ordinary private draft");
  t.wrapper.unmount();
});
