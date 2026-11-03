// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { NDropdown, NModal } from "naive-ui";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../../stores/chat.store";
import { useSidebarStore } from "../../stores/sidebar.store";
import { useChatReadingStore } from "../../stores/chat-reading.store";
import ChatSidebarTree from "./ChatSidebarTree.vue";

const PROJECT_ID = "019c1a00-0000-7000-8000-000000000001";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000002";

async function mountTree(prepare?: (store: ReturnType<typeof useChatStore>) => void) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useChatStore(pinia);
  const savedPreferences = new Map<string, string>();
  const sidebar = useSidebarStore(pinia);
  sidebar.hydrate({ getItem: (key) => savedPreferences.get(key) ?? null, setItem: (key, value) => { savedPreferences.set(key, value); } });
  store.phase = "ready";
  store.context = {
    contextId: "019c1a00-0000-7000-8000-000000000010",
    expiresAtEpochSeconds: 1_800_000_000,
    allowedActions: [
      "read_sessions", "read_projects", "rename_session", "pin_session", "delete_session",
      "pin_project", "remove_project",
    ],
  };
  store.projects = [{ projectId: PROJECT_ID, safeName: "Synthetic Workspace", pinnedAt: null, lastUsedAt: 1, available: true }];
  store.sessions = [{
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    title: "Synthetic Session",
    titleSource: "fallback",
    pinnedAt: null,
    lastActivityAt: 2,
    latestTurnStatus: "completed",
    projectAvailable: true,
  }];
  prepare?.(store);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/chat/:sessionId", component: { template: "<div />" } }],
  });
  await router.push(`/chat/${SESSION_ID}`);
  await router.isReady();
  const wrapper = mount(ChatSidebarTree, {
    attachTo: document.body,
    props: { currentPath: `/chat/${SESSION_ID}` },
    global: { plugins: [pinia, router] },
  });
  await flushPromises();
  return { wrapper, store, router, sidebar };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ChatSidebarTree", () => {
  it("keeps a native available managed directory distinct from a removed project", async () => {
    const { wrapper, store } = await mountTree();
    store.projects = [];
    await flushPromises();
    expect(wrapper.text()).toContain("任务目录");
    expect(wrapper.text()).not.toContain("项目已移除");
    expect(wrapper.text()).toContain("Synthetic Session");
    expect(wrapper.find('[aria-label="项目 任务目录 的操作菜单"]').exists()).toBe(true);
  });
  it("renders project/session metadata from the authoritative store", async () => {
    const { wrapper } = await mountTree();
    expect(wrapper.text()).toContain("Synthetic Workspace");
    expect(wrapper.text()).toContain("Synthetic Session");
    expect(wrapper.get('[aria-current="page"]').text()).toBe("Synthetic Session");
    const selected = wrapper.get('[aria-current="page"]');
    expect(selected.find(".chat-tree__session-completed").exists()).toBe(true);
    const descriptionId = selected.attributes("aria-describedby");
    expect(document.getElementById(descriptionId!)?.textContent).toBe("任务已完成，尚未查看");
    expect(wrapper.find(".chat-tree__more--session").exists()).toBe(false);
  });

  it("marks only the latest completed turn, including when the session is not selected", async () => {
    const statuses = ["completed", "queued", "pending", "streaming", "inProgress", "waiting_approval", "failed", "interrupted", "unknown", null];
    const { wrapper } = await mountTree(store => {
      const original = store.sessions[0]!;
      store.sessions = statuses.map((status, index) => ({
        ...original,
        sessionId: `${SESSION_ID}-${index}`,
        title: `Session ${index}`,
        latestTurnStatus: status,
      }));
    });
    expect(wrapper.find('[aria-current="page"]').exists()).toBe(false);
    const rows = wrapper.findAll(".chat-tree__session-link");
    expect(rows).toHaveLength(statuses.length);
    for (const [index, status] of statuses.entries()) {
      const row = rows.find(entry => entry.text() === `Session ${index}`)!;
      expect(row.find(".chat-tree__session-completed").exists()).toBe(status === "completed");
      expect(Boolean(row.attributes("aria-describedby"))).toBe(status === "completed");
    }
    wrapper.unmount();
  });

  it("clears completion as soon as another turn queues and restores it only on completion", async () => {
    const { wrapper, store } = await mountTree();
    for (const status of ["queued", "streaming", "failed", "completed"]) {
      store.sessions = store.sessions.map(session => ({ ...session, latestTurnStatus: status }));
      await flushPromises();
      const selected = wrapper.get('[aria-current="page"]');
      expect(selected.text()).toBe("Synthetic Session");
      expect(selected.find(".chat-tree__session-completed").exists()).toBe(status === "completed");
    }
    await wrapper.setProps({ currentPath: "/chat" });
    expect(wrapper.find(".chat-tree__session-completed").exists()).toBe(true);
    wrapper.unmount();
  });

  it("dismisses completion only on opening and requests the latest turn on every same-route click", async () => {
    const { wrapper } = await mountTree();
    const reading = useChatReadingStore();
    const row = wrapper.get('[aria-current="page"]');
    await row.trigger("contextmenu", { clientX: 50, clientY: 100 });
    expect(row.find(".chat-tree__session-completed").exists()).toBe(true);
    await row.trigger("click");
    await flushPromises();
    expect(row.find(".chat-tree__session-completed").exists()).toBe(false);
    expect(row.attributes("aria-describedby")).toBeUndefined();
    const first = reading.latestRequest!.id;
    await row.trigger("click");
    await flushPromises();
    expect(reading.latestRequest!.id).toBeGreaterThan(first);
    expect(reading.latestRequest!.sessionId).toBe(SESSION_ID);
    wrapper.unmount();
  });

  it("does not mark a task viewed or request scrolling when navigation is cancelled", async () => {
    const { wrapper, router } = await mountTree(store => {
      store.sessions = [{ ...store.sessions[0]!, sessionId: "019c1a00-0000-7000-8000-000000000009" }];
    });
    router.beforeEach(() => false);
    await wrapper.get(".chat-tree__session-link").trigger("click");
    await flushPromises();
    expect(wrapper.find(".chat-tree__session-completed").exists()).toBe(true);
    expect(useChatReadingStore().latestRequest).toBeNull();
    wrapper.unmount();
  });

  it("offers only pin/remove project and rename/pin/delete session actions", async () => {
    const { wrapper } = await mountTree();
    const dropdowns = wrapper.findAllComponents(NDropdown);
    expect(dropdowns).toHaveLength(2);
    const projectMenu = dropdowns[0]!;
    const sessionMenu = dropdowns[1]!;
    const projectOptions = projectMenu.props("options") ?? [];
    const sessionOptions = sessionMenu.props("options") ?? [];
    expect(projectOptions.filter((option) => option.type !== "divider").map((option) => option.label)).toEqual(["置顶项目", "移除"]);
    expect(sessionOptions.filter((option) => option.type !== "divider").map((option) => option.label)).toEqual(["重命名", "置顶", "永久删除"]);
  });

  it("opens the app menu for an unselected task, suppresses the native menu and keeps only one task menu open", async () => {
    const { wrapper, store, router } = await mountTree();
    store.sessions = [...store.sessions, {
      ...store.sessions[0]!,
      sessionId: "019c1a00-0000-7000-8000-000000000006",
      title: "Background Session",
    }];
    await flushPromises();

    expect(wrapper.text()).toContain("Background Session");
    expect(wrapper.findAllComponents(NDropdown)).toHaveLength(3);
    expect(wrapper.find('[aria-label="任务 Background Session 的操作菜单"]').exists()).toBe(false);
    const selected = wrapper.get('.chat-tree__session-link[aria-current="page"]');
    const background = wrapper.findAll(".chat-tree__session-link").find(row => row.text() === "Background Session")!;
    const menu = wrapper.findAllComponents(NDropdown)[1]!;
    const backgroundMenu = wrapper.findAllComponents(NDropdown)[2]!;
    expect(selected.attributes("aria-haspopup")).toBe("menu");
    expect(background.attributes("aria-haspopup")).toBe("menu");
    const nativeEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 80, button: 2 });
    background.element.dispatchEvent(nativeEvent);
    await flushPromises();
    expect(nativeEvent.defaultPrevented).toBe(true);
    expect(backgroundMenu.props("show")).toBe(true);
    expect(menu.props("show")).toBe(false);
    expect(router.currentRoute.value.path).toBe(`/chat/${SESSION_ID}`);
    expect(useChatReadingStore().latestRequest).toBeNull();
    expect(background.find(".chat-tree__session-completed").exists()).toBe(true);
    await selected.trigger("contextmenu", { clientX: 50, clientY: 90 });
    expect(menu.props("show")).toBe(true);
    expect(backgroundMenu.props("show")).toBe(false);
    expect(menu.props("x")).toBe(50);
    expect(menu.props("y")).toBe(90);
    expect(document.activeElement).toBe(selected.element);
    menu.vm.$emit("clickoutside");
    await flushPromises();
    expect(menu.props("show")).toBe(false);
    wrapper.unmount();
  });

  it("prevents title selection and treats Control-click as a context gesture without dismissing unread completion", async () => {
    const { wrapper } = await mountTree();
    const row = wrapper.get(".chat-tree__session-link");
    const title = row.get(".chat-tree__session-title");
    const select = new Event("selectstart", { bubbles: true, cancelable: true });
    title.element.dispatchEvent(select);
    expect(select.defaultPrevented).toBe(true);
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(title.element);
    selection.addRange(range);
    await row.trigger("contextmenu");
    expect(selection.toString()).toBe("");
    await row.trigger("click", { ctrlKey: true, button: 0 });
    expect(useChatReadingStore().latestRequest).toBeNull();
    expect(row.find(".chat-tree__session-completed").exists()).toBe(true);
    wrapper.unmount();
  });

  it("pins and renames the right-clicked background task without switching the active conversation", async () => {
    const backgroundId = "019c1a00-0000-7000-8000-000000000006";
    const { wrapper, store, router } = await mountTree(state => {
      state.sessions = [...state.sessions, { ...state.sessions[0]!, sessionId: backgroundId, title: "Background Session" }];
      state.selectedSessionId = SESSION_ID;
    });
    const pin = vi.spyOn(store, "setSessionPinned").mockResolvedValue();
    const rename = vi.spyOn(store, "renameSession").mockResolvedValue();
    const select = vi.spyOn(store, "selectSession");
    const row = wrapper.findAll(".chat-tree__session-link").find(entry => entry.text() === "Background Session")!;
    const menu = wrapper.findAllComponents(NDropdown)[2]!;
    await row.trigger("contextmenu");
    menu.vm.$emit("select", "pin");
    await flushPromises();
    expect(pin).toHaveBeenCalledWith(backgroundId, true);
    await row.trigger("contextmenu");
    menu.vm.$emit("select", "rename");
    await flushPromises();
    const input = document.body.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    expect(input.value).toBe("Background Session");
    input.value = "Updated background title";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "保存")!.click();
    await flushPromises();
    expect(rename).toHaveBeenCalledWith(backgroundId, "Updated background title");
    expect(select).not.toHaveBeenCalled();
    expect(store.selectedSessionId).toBe(SESSION_ID);
    expect(router.currentRoute.value.path).toBe(`/chat/${SESSION_ID}`);
    expect(useChatReadingStore().latestRequest).toBeNull();
    wrapper.unmount();
  });

  it("opens the session menu from the keyboard and restores focus after cancelling rename", async () => {
    const { wrapper } = await mountTree();
    const selected = wrapper.get('.chat-tree__session-link[aria-current="page"]');
    const menu = wrapper.findAllComponents(NDropdown)[1]!;
    await selected.trigger("keydown", { key: "F10", shiftKey: true });
    expect(menu.props("show")).toBe(true);
    await selected.trigger("keydown", { key: "Escape" });
    expect(menu.props("show")).toBe(false);
    await selected.trigger("keydown", { key: "ContextMenu" });
    expect(menu.props("show")).toBe(true);
    await selected.trigger("keydown", { key: "ArrowDown" });
    await selected.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(menu.props("show")).toBe(false);
    expect(wrapper.findAllComponents(NModal)[0]!.props("show")).toBe(true);
    const cancel = [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "取消")!;
    cancel.click();
    await flushPromises();
    expect(wrapper.findAllComponents(NModal)[0]!.props("show")).toBe(false);
    expect(document.activeElement).toBe(selected.element);
    wrapper.unmount();
  });

  it("dismisses the session menu on navigation or permission changes", async () => {
    const { wrapper, store } = await mountTree();
    const selected = wrapper.get(".chat-tree__session-link");
    await selected.trigger("contextmenu");
    expect(selected.attributes("aria-expanded")).toBe("true");
    await wrapper.setProps({ currentPath: "/chat/other" });
    expect(wrapper.findAllComponents(NDropdown)).toHaveLength(2);
    await wrapper.setProps({ currentPath: `/chat/${SESSION_ID}` });
    expect(selected.attributes("aria-expanded")).toBe("false");
    await selected.trigger("contextmenu");
    store.context = { ...store.context!, allowedActions: ["read_sessions", "read_projects"] };
    await flushPromises();
    expect(wrapper.findAllComponents(NDropdown)).toHaveLength(0);
    await selected.trigger("keydown", { key: "F10", shiftKey: true });
    expect(selected.attributes("aria-expanded")).toBeUndefined();
    wrapper.unmount();
  });

  it("keeps task.read-only history browsable without exposing mutation menus", async () => {
    const { wrapper, store } = await mountTree();
    store.context = {
      ...store.context!,
      allowedActions: ["read_sessions", "read_projects", "read_cleanup"],
    };
    await flushPromises();

    expect(wrapper.text()).toContain("Synthetic Session");
    expect(wrapper.findAllComponents(NDropdown)).toHaveLength(0);
    expect(wrapper.get(".chat-tree__session-link").attributes("aria-current")).toBe("page");
    const nativeEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    wrapper.get(".chat-tree__session-link").element.dispatchEvent(nativeEvent);
    expect(nativeEvent.defaultPrevented).toBe(true);
  });

  it("does not misreport a write denial as loss of history read access", async () => {
    const { wrapper, store } = await mountTree();
    store.context = {
      ...store.context!,
      allowedActions: ["read_sessions", "read_projects"],
    };
    store.phase = "permission-denied";
    await flushPromises();

    expect(wrapper.text()).toContain("Synthetic Session");
    expect(wrapper.text()).not.toContain("无权读取任务记录");

    store.context = { ...store.context, allowedActions: [] };
    await flushPromises();
    expect(wrapper.text()).toContain("无权读取任务记录");
  });

  it("keeps cached history visible when a refresh becomes unavailable", async () => {
    const { wrapper, store } = await mountTree();
    store.phase = "unavailable";
    await flushPromises();

    expect(wrapper.text()).toContain("任务记录更新失败，已显示上次读取内容");
    expect(wrapper.text()).toContain("Synthetic Session");
  });

  it("does not present a required context resync as an empty history", async () => {
    const { wrapper, store } = await mountTree();
    store.context = null;
    store.projects = [];
    store.sessions = [];
    store.phase = "resync-required";
    await flushPromises();

    expect(wrapper.text()).toContain("任务记录需要重新同步，请稍后重试");
    expect(wrapper.text()).not.toContain("暂无任务记录");
  });

  it("opens rename and destructive confirmation dialogs without mutating first", async () => {
    const { wrapper, store } = await mountTree();
    const deleteSelected = vi.spyOn(store, "deleteSelected").mockResolvedValue(null);
    const dropdowns = wrapper.findAllComponents(NDropdown);

    dropdowns[1].vm.$emit("select", "delete");
    await flushPromises();
    expect(wrapper.findAllComponents(NModal)[1].props("show")).toBe(true);
    expect(document.body.textContent).toContain("此操作不能撤销");
    expect(deleteSelected).not.toHaveBeenCalled();
  });

  it("requires confirmed navigation to the background deletion target and never deletes the still-active task", async () => {
    const targetId = "019c1a00-0000-7000-8000-000000000006";
    const { wrapper, store, router } = await mountTree(state => {
      state.sessions = [...state.sessions, { ...state.sessions[0]!, sessionId: targetId, title: "Background Session" }];
      state.selectedSessionId = SESSION_ID;
    });
    const deletedTargets: Array<string | null> = [];
    const deletion = vi.spyOn(store, "deleteSelected").mockImplementation(async () => { deletedTargets.push(store.selectedSessionId); return null; });
    const selection = vi.spyOn(store, "selectSession").mockImplementation(async id => { store.selectedSessionId = id; });
    wrapper.findAllComponents(NDropdown)[2]!.vm.$emit("select", "delete");
    await flushPromises();
    expect(document.body.querySelector('[role="alertdialog"]')?.textContent).toContain("Background Session");
    expect(deletion).not.toHaveBeenCalled();
    const removeGuard = router.beforeEach(() => false);
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "永久删除")!;
    confirm.click();
    await flushPromises();
    expect(deletion).not.toHaveBeenCalled();
    expect(selection).not.toHaveBeenCalled();
    expect(store.selectedSessionId).toBe(SESSION_ID);
    removeGuard();
    confirm.click();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/chat/${targetId}`);
    expect(deletedTargets).toEqual([targetId]);
    wrapper.unmount();
  });

  it("closes a pending mutation dialog when its authority is revoked", async () => {
    const { wrapper, store } = await mountTree();
    wrapper.findAllComponents(NDropdown)[1].vm.$emit("select", "delete");
    await flushPromises();
    expect(wrapper.findAllComponents(NModal)[1].props("show")).toBe(true);

    store.context = {
      ...store.context!,
      allowedActions: ["read_sessions", "read_projects"],
    };
    await flushPromises();

    expect(wrapper.findAllComponents(NModal)[1].props("show")).toBe(false);
    expect(wrapper.text()).toContain("操作权限已更新，请重新打开菜单");
  });

  it("uses the existing store action for project pinning", async () => {
    const { wrapper, store } = await mountTree();
    const pin = vi.spyOn(store, "setProjectPinned").mockResolvedValue();
    wrapper.findAllComponents(NDropdown)[0].vm.$emit("select", "pin");
    await flushPromises();
    expect(pin).toHaveBeenCalledWith(PROJECT_ID, true);
  });

  it("opens the same managed-directory menu from right click and keyboard, and pins without native project mutation", async () => {
    const managed = "019c1a00-0000-7000-8000-000000000020";
    const { wrapper, store, sidebar } = await mountTree((state) => {
      state.sessions = [...state.sessions, { ...state.sessions[0]!, projectId: managed, sessionId: "managed-session" }];
    });
    const nativePin = vi.spyOn(store, "setProjectPinned").mockResolvedValue();
    const row = wrapper.get('[aria-label="折叠项目 任务目录"]');
    await row.trigger("contextmenu", { clientX: 48, clientY: 120 });
    const menu = wrapper.findAllComponents(NDropdown).find((entry) => entry.props("show"))!;
    expect(menu.props("x")).toBe(48);
    expect(menu.props("y")).toBe(120);
    expect((menu.props("options") ?? []).filter((entry) => entry.type !== "divider").map((entry) => entry.label)).toEqual(["置顶项目", "移除"]);
    menu.vm.$emit("select", "pin");
    await flushPromises();
    expect(nativePin).not.toHaveBeenCalled();
    expect(sidebar.taskDirectoryPreferences[0]?.projectId).toBe(managed);
    expect(wrapper.findAll(".chat-tree__project-name").map((entry) => entry.text())).toEqual(["任务目录", "Synthetic Workspace"]);
    await row.trigger("keydown", { key: "F10", shiftKey: true });
    const pinnedMenu = wrapper.findAllComponents(NDropdown).find((entry) => entry.props("show"))!;
    expect(pinnedMenu.props("options")?.[0]?.label).toBe("取消置顶");
    pinnedMenu.vm.$emit("select", "pin");
    await flushPromises();
    expect(sidebar.taskDirectoryPreferences).toEqual([]);
    expect(nativePin).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("removes only the managed directory grouping after confirmation and keeps native task availability", async () => {
    const { wrapper, store, sidebar } = await mountTree((state) => { state.projects = []; });
    const nativeRemove = vi.spyOn(store, "removeProject").mockResolvedValue();
    const original = JSON.stringify(store.sessions);
    await wrapper.get('[aria-label="项目 任务目录 的操作菜单"]').trigger("click");
    wrapper.findAllComponents(NDropdown).find((entry) => entry.props("show"))!.vm.$emit("select", "remove");
    await flushPromises();
    expect(sidebar.taskDirectoryPreferences).toEqual([]);
    expect(document.body.textContent).toContain("也不会停止定时任务");
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((button) => button.textContent === "移除")!;
    confirm.click();
    await flushPromises();
    expect(nativeRemove).not.toHaveBeenCalled();
    expect(JSON.stringify(store.sessions)).toBe(original);
    expect(wrapper.find(".chat-tree__project").exists()).toBe(false);
    expect(wrapper.get(".chat-tree__projects > .chat-tree__session").text()).toContain("Synthetic Session");
    expect(sidebar.taskDirectoryPreferences).toEqual([{ projectId: PROJECT_ID, pinnedAt: null, removed: true }]);
    wrapper.unmount();
  });

  it("closes managed directory actions on permission or context changes", async () => {
    const { wrapper, store, sidebar } = await mountTree((state) => { state.projects = []; });
    const row = wrapper.get('[aria-label="折叠项目 任务目录"]');
    await row.trigger("contextmenu");
    store.context = { ...store.context!, allowedActions: ["read_projects", "read_sessions"] };
    await flushPromises();
    expect(wrapper.find('[aria-label="项目 任务目录 的操作菜单"]').exists()).toBe(false);
    expect(sidebar.taskDirectoryPreferences).toEqual([]);
    store.context = { ...store.context!, allowedActions: ["read_projects", "read_sessions", "remove_project"] };
    await flushPromises();
    await row.trigger("contextmenu");
    wrapper.findComponent(NDropdown).vm.$emit("select", "remove");
    await flushPromises();
    expect(wrapper.findAllComponents(NModal)[2]!.props("show")).toBe(true);
    store.context = { ...store.context!, contextId: "019c1a00-0000-7000-8000-000000000030" };
    await flushPromises();
    expect(wrapper.findAllComponents(NModal)[2]!.props("show")).toBe(false);
    expect(sidebar.taskDirectoryPreferences).toEqual([]);
    wrapper.unmount();
  });

  it("places all removed-project sessions at the top level after every directory, even when pinned or newest", async () => {
    const { wrapper, store } = await mountTree();
    const session = store.sessions[0]!;
    store.sessions = [
      { ...session, sessionId: "removed-pinned", projectId: "removed-a", title: "Removed Pinned", pinnedAt: 9, lastActivityAt: 100, projectAvailable: false },
      session,
      { ...session, sessionId: "managed", projectId: "managed", title: "Managed Session" },
      { ...session, sessionId: "removed-b", projectId: "removed-b", title: "Removed B", projectAvailable: false },
      { ...session, sessionId: "removed-a", projectId: "removed-a", title: "Removed A", projectAvailable: false },
    ];
    await flushPromises();

    expect(wrapper.findAll(".chat-tree__project-name").map(row => row.text())).toEqual(["Synthetic Workspace", "任务目录"]);
    expect(wrapper.findAll(".chat-tree__projects > .chat-tree__session .chat-tree__session-title").map(row => row.text())).toEqual([
      "Removed Pinned", "Removed B", "Removed A",
    ]);
    expect(wrapper.findAll(".chat-tree__projects > li").map(row => row.classes()[0])).toEqual([
      "chat-tree__project", "chat-tree__project", "chat-tree__session", "chat-tree__session", "chat-tree__session",
    ]);
    expect(wrapper.findAll(".chat-tree__session")).toHaveLength(5);
    expect(wrapper.text()).not.toContain("项目已移除");
  });

  it("shows available projectless tasks at the top level ahead of removed-project history", async () => {
    const { wrapper, store } = await mountTree();
    const existing = store.sessions[0]!;
    store.sessions = [
      { ...existing, sessionId: "removed", projectAvailable: false, title: "Removed" },
      { ...existing, projectId: null, title: "No Project" },
    ];
    await flushPromises();
    expect(wrapper.findAll(".chat-tree__projects > .chat-tree__session .chat-tree__session-title").map(row => row.text())).toEqual(["No Project", "Removed"]);
    expect(wrapper.text()).not.toContain("任务目录");
    expect(wrapper.get('[aria-current="page"]').text()).toContain("No Project");
    store.projects = [];
    await flushPromises();
    expect(wrapper.find(".chat-tree__project").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("暂无任务记录");
  });

  it("moves every session out of a collapsed directory after confirming removal", async () => {
    const { wrapper, store } = await mountTree();
    store.sessions = [...store.sessions, { ...store.sessions[0]!, sessionId: "second", title: "Second Session" }];
    const removeProject = vi.spyOn(store, "removeProject").mockImplementation(async (projectId) => {
      store.projects = store.projects.filter(project => project.projectId !== projectId);
      store.sessions = store.sessions.map(session => session.projectId === projectId ? { ...session, projectAvailable: false } : session);
    });
    await wrapper.get('[aria-label="折叠项目 Synthetic Workspace"]').trigger("click");
    wrapper.findComponent(NDropdown).vm.$emit("select", "remove");
    await flushPromises();
    expect(removeProject).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("历史任务将移至“任务”顶层末尾");
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "移除")!;
    confirm.click();
    await flushPromises();

    expect(removeProject).toHaveBeenCalledWith(PROJECT_ID);
    expect(wrapper.findAllComponents(NModal)[2].props("show")).toBe(false);
    expect(wrapper.find(".chat-tree__project").exists()).toBe(false);
    expect(wrapper.findAll(".chat-tree__projects > .chat-tree__session")).toHaveLength(2);
    expect(wrapper.get('[aria-current="page"]').text()).toContain("Synthetic Session");
    expect(store.sessions.every(session => session.projectId === PROJECT_ID)).toBe(true);
    expect(wrapper.text()).not.toContain("暂无任务记录");
    expect(wrapper.text()).not.toContain("项目已移除");
  });

  it("restores previously removed history directly without folders or false empty/error states", async () => {
    const { wrapper, store } = await mountTree(store => {
      store.projects = [];
      store.sessions = store.sessions.map(session => ({ ...session, projectAvailable: false }));
    });
    expect(wrapper.find(".chat-tree__project").exists()).toBe(false);
    expect(wrapper.findAll(".chat-tree__projects > .chat-tree__session")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("暂无任务记录");

    store.phase = "unavailable";
    await flushPromises();
    expect(wrapper.text()).toContain("任务记录更新失败，已显示上次读取内容");
    expect(wrapper.text()).not.toContain("任务记录暂不可用");
    expect(wrapper.text()).toContain("Synthetic Session");

    store.phase = "ready";
    store.sessions = [];
    await flushPromises();
    expect(wrapper.text()).toContain("暂无任务记录");
  });

  it("keeps paginated removed history last while retaining navigation and session actions", async () => {
    const { wrapper, store, router } = await mountTree();
    store.sessionsCursor = "next-page";
    const loadMore = vi.spyOn(store, "loadMoreSessions").mockImplementation(async () => {
      const session = store.sessions[0]!;
      store.sessions = [...store.sessions,
        { ...session, sessionId: "removed-page", projectId: "removed", title: "Removed Page", projectAvailable: false },
        { ...session, sessionId: "managed-page", projectId: "managed", title: "Managed Page" },
      ];
      store.sessionsCursor = null;
    });
    await flushPromises();
    await wrapper.get(".chat-tree__load-more").trigger("click");
    await flushPromises();
    expect(loadMore).toHaveBeenCalledOnce();
    expect(wrapper.findAll(".chat-tree__projects > li").slice(-1)[0]!.text()).toContain("Removed Page");
    expect(wrapper.find(".chat-tree__load-more").exists()).toBe(false);

    await wrapper.get(".chat-tree__projects > .chat-tree__session .chat-tree__session-link").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/chat/removed-page");
    await wrapper.setProps({ currentPath: router.currentRoute.value.path });
    store.selectedSessionId = "removed-page";
    const pin = vi.spyOn(store, "setSessionPinned").mockResolvedValue();
    const menu = wrapper.findAllComponents(NDropdown).slice(-1)[0]!;
    expect(menu.props("options")!.filter(option => option.type !== "divider").map(option => option.label)).toEqual(["重命名", "置顶", "永久删除"]);
    menu.vm.$emit("select", "pin");
    await flushPromises();
    expect(pin).toHaveBeenCalledWith("removed-page", true);
    expect(wrapper.get('[aria-current="page"]').text()).toContain("Removed Page");

    store.context = { ...store.context!, allowedActions: ["read_sessions", "read_projects"] };
    await flushPromises();
    expect(wrapper.findAllComponents(NDropdown)).toHaveLength(0);
    expect(wrapper.get('[aria-current="page"]').text()).toContain("Removed Page");
  });

  it("toggles from the directory name and icon without a separate arrow or route change", async () => {
    const { wrapper, router } = await mountTree();
    const toggle = wrapper.get(".chat-tree__project-toggle");
    expect(wrapper.find(".chat-tree__expand").exists()).toBe(false);
    expect(toggle.element.tagName).toBe("BUTTON");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    await toggle.get(".chat-tree__project-name").trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find(".chat-tree__session-link").exists()).toBe(false);
    expect(router.currentRoute.value.path).toBe(`/chat/${SESSION_ID}`);

    await toggle.get("svg").trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    await wrapper.get(".chat-tree__session-link").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/chat/${SESSION_ID}`);
    expect(wrapper.get(".chat-tree").attributes("aria-label")).toBe("任务：项目与对话");
  });

  it("FEAT-130 keeps scrolling inside the history tree", () => {
    const source = readFileSync("src/components/chat/ChatSidebarTree.vue", "utf8");
    expect(source).toContain(`.chat-tree {
  min-height: 0;
  flex: 1;`);
    expect(source).toContain("overflow-y: auto;");
    expect(source).toContain("scrollbar-width: thin;");
  });
});
