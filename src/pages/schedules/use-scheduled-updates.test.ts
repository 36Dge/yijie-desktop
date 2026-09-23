// @vitest-environment happy-dom
import { effectScope, reactive, nextTick } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { createScheduledTaskNativeClient } from "../../api/scheduled-task-native-client";
import type { ImportantUpdate, Requests } from "../../api/generated/scheduled-task-ipc.gen";
import { useScheduledUpdates } from "./use-scheduled-updates";
const stores = vi.hoisted(() => ({ chat: {} as object, permission: {} as object }));
vi.mock("../../stores/chat.store", () => ({ useChatStore: () => stores.chat }));
vi.mock("../../stores/permission.store", () => ({ usePermissionStore: () => stores.permission }));
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(f => f()); });
function harness() {
  const chat = reactive({ context: { contextId: crypto.randomUUID() } as { contextId: string } | null });
  const permission = reactive({ selectedTenantId: crypto.randomUUID(), authorizationRevision: 1, isReady: true, canRead: true, hasCapability: () => permission.canRead });
  stores.chat = chat; stores.permission = permission;
  let items: ImportantUpdate[] = []; let delay: Promise<void> | null = null;
  const read = vi.fn(async (command: string, args: Record<string, unknown>) => {
    expect(command).toBe("schedule_list_important_updates_v1");
    const request = args.request as Requests["schedule_list_important_updates_v1"];
    const snapshot = structuredClone(items);
    if (delay) await delay;
    return { schemaVersion: 1, requestId: request.requestId, data: { items: snapshot, truncated: false } };
  });
  const changed = vi.fn(); const clear = vi.fn(); const scope = effectScope();
  const observer = scope.run(() => useScheduledUpdates(changed, clear, createScheduledTaskNativeClient(read)))!;
  cleanup.push(() => scope.stop());
  return { chat, permission, read, changed, clear, observer, items: (v: ImportantUpdate[]) => { items = v; }, delay: (v: Promise<void> | null) => { delay = v; }, stop: () => scope.stop() };
}
const item = (state: ImportantUpdate["state"]): ImportantUpdate => ({ run_id: crypto.randomUUID(), plan_id: crypto.randomUUID(), name: "同名计划", state });
it("deduplicates run identity and state, never announces old completions on first read", async () => {
  const h = harness(); await vi.waitFor(() => expect(h.read).toHaveBeenCalledOnce());
  await h.observer.refresh();
  const first = item("pending"); const other = item("pending");
  h.items([first, other]); await h.observer.refresh();
  expect(h.changed.mock.calls.filter(c => c[1])).toHaveLength(0);
  first.state = "needs_attention"; h.items([first, other]); await h.observer.refresh(); await h.observer.refresh();
  expect(h.changed.mock.calls.filter(c => c[1])).toHaveLength(1);
  first.state = "completed"; other.state = "failed"; h.items([first, other]); await h.observer.refresh();
  expect(h.changed.mock.calls.filter(c => c[1]).map(c => c[0].state)).toEqual(["needs_attention", "completed", "failed"]);
  h.chat.context = null; await nextTick(); h.items([first, other, item("needs_attention")]); h.chat.context = { contextId: crypto.randomUUID() };
  await vi.waitFor(() => expect(h.changed.mock.calls.filter(c => c[1])).toHaveLength(4));
  expect(h.changed.mock.calls.slice(-3).map(c => c[1])).toEqual([false, false, true]);
});
it("keeps only one read in flight and discards late results after revocation", async () => {
  const h = harness(); await vi.waitFor(() => expect(h.read).toHaveBeenCalledOnce());
  await h.observer.refresh(); h.changed.mockClear(); h.read.mockClear();
  let release!: () => void; h.delay(new Promise<void>(resolve => { release = resolve; }));
  h.items([item("needs_attention")]); const read = h.observer.refresh(); await h.observer.refresh();
  expect(h.read).toHaveBeenCalledOnce(); h.permission.canRead = false; await nextTick(); release(); await read;
  expect(h.changed).not.toHaveBeenCalled(); expect(h.clear).toHaveBeenCalled();
  await h.observer.refresh(); expect(h.read).toHaveBeenCalledOnce();
});
it("context renewal keeps dedup within the same scope, but changing scope resets and clears", async () => {
  const h = harness(); await vi.waitFor(() => expect(h.read).toHaveBeenCalledOnce()); await h.observer.refresh();
  const current = item("needs_attention"); h.items([current]); await h.observer.refresh();
  h.changed.mockClear(); h.chat.context = { contextId: crypto.randomUUID() };
  await nextTick(); await h.observer.refresh(); expect(h.changed).not.toHaveBeenCalled();
  h.items([]); h.permission.selectedTenantId = crypto.randomUUID(); await nextTick();
  expect(h.clear).toHaveBeenCalled(); h.stop();
});
