// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { chatWorkspaceClient } from "../api/chat-workspace-client";
import type { WorkspaceCreation } from "../domain/chat-workspace";
import { useChatStore } from "./chat.store";

const entry = { project: { projectId: "019c1a00-0000-7000-8000-000000000001", safeName: "市场调研", pinnedAt: null, lastUsedAt: 1, available: true }, path: "/Users/example/Yijie/Workspaces/市场调研" };
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => vi.restoreAllMocks());
function setup() {
  const store = useChatStore();
  store.context = { contextId: "019c1a00-0000-7000-8000-000000000002", expiresAtEpochSeconds: 2_000_000_000, allowedActions: ["use_project", "read_projects"] };
  return store;
}
describe("workspace registration in chat store", () => {
  it("immediately adds a native-created space to the ordinary project list", async () => {
    vi.spyOn(chatWorkspaceClient, "create").mockResolvedValue({ status: "created", workspace: entry });
    const store = setup();
    await store.createWorkspace("市场调研");
    expect(store.projects).toEqual([entry.project]);
    store.dispose();
  });
  it("does not register an old-context creation response", async () => {
    let resolve!: (result: WorkspaceCreation) => void;
    vi.spyOn(chatWorkspaceClient, "create").mockImplementation(() => new Promise(done => { resolve = done; }));
    const store = setup(); const pending = store.createWorkspace("市场调研");
    store.context = null;
    resolve({ status: "created", workspace: entry });
    expect(await pending).toBeNull(); expect(store.projects).toEqual([]);
    store.dispose();
  });
});
