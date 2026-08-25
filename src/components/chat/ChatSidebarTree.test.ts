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

async function mountTree() {
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

  it("keeps sessions from removed projects discoverable under the required fallback folder", async () => {
    const { wrapper, store } = await mountTree();
    store.sessions = [...store.sessions, {
      sessionId: "019c1a00-0000-7000-8000-000000000003",
      projectId: "019c1a00-0000-7000-8000-000000000009",
      title: "Removed Project Session",
      titleSource: "fallback",
      pinnedAt: null,
      lastActivityAt: 1,
      latestTurnStatus: "completed",
      projectAvailable: false,
    }];
    await flushPromises();

    expect(wrapper.findAll(".chat-tree__project")).toHaveLength(2);
    expect(wrapper.text()).toContain("项目已移除");
    expect(wrapper.text()).toContain("Removed Project Session");
    expect(wrapper.find('[aria-label="项目 项目已移除 的操作菜单"]').exists()).toBe(false);
  });

  it("uses an expandable project-first hierarchy and routes only from a conversation", async () => {
    const { wrapper, router } = await mountTree();
    const collapse = wrapper.get('[aria-label="折叠项目 Synthetic Workspace"]');
    await collapse.trigger("click");
    expect(wrapper.find(".chat-tree__session-link").exists()).toBe(false);

    await wrapper.get('[aria-label="展开项目 Synthetic Workspace"]').trigger("click");
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
