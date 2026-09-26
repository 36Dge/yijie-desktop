// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { NDropdown, NModal } from "naive-ui";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../../stores/chat.store";
import ChatSidebarTree from "./ChatSidebarTree.vue";

const PROJECT_ID = "019c1a00-0000-7000-8000-000000000001";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000002";

async function mountTree(prepare?: (store: ReturnType<typeof useChatStore>) => void) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useChatStore(pinia);
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
  return { wrapper, store, router };
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
    expect(wrapper.find('[aria-label="项目 任务目录 的操作菜单"]').exists()).toBe(false);
  });
  it("renders project/session metadata from the authoritative store", async () => {
    const { wrapper } = await mountTree();
    expect(wrapper.text()).toContain("Synthetic Workspace");
    expect(wrapper.text()).toContain("Synthetic Session");
    expect(wrapper.get('[aria-current="page"]').text()).toContain("Synthetic Session");
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

  it("exposes mutation actions only for the route-selected conversation", async () => {
    const { wrapper, store } = await mountTree();
    store.sessions = [...store.sessions, {
      ...store.sessions[0]!,
      sessionId: "019c1a00-0000-7000-8000-000000000006",
      title: "Background Session",
    }];
    await flushPromises();

    expect(wrapper.text()).toContain("Background Session");
    expect(wrapper.findAllComponents(NDropdown)).toHaveLength(2);
    expect(wrapper.find('[aria-label="任务 Background Session 的操作菜单"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="任务 Synthetic Session 的操作菜单"]').exists()).toBe(true);
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
    expect(document.body.textContent).toContain("历史任务将移至“任务记录”顶层末尾");
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
    const pin = vi.spyOn(store, "setSelectedPinned").mockResolvedValue();
    const menu = wrapper.findAllComponents(NDropdown).slice(-1)[0]!;
    expect(menu.props("options")!.filter(option => option.type !== "divider").map(option => option.label)).toEqual(["重命名", "置顶", "永久删除"]);
    menu.vm.$emit("select", "pin");
    await flushPromises();
    expect(pin).toHaveBeenCalledWith(true);
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
    expect(wrapper.get(".chat-tree").attributes("aria-label")).toBe("任务记录：项目与对话");
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
