// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
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
  return { wrapper, store };
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

  it("uses the existing store action for project pinning", async () => {
    const { wrapper, store } = await mountTree();
    const pin = vi.spyOn(store, "setProjectPinned").mockResolvedValue();
    wrapper.findAllComponents(NDropdown)[0].vm.$emit("select", "pin");
    await flushPromises();
    expect(pin).toHaveBeenCalledWith(PROJECT_ID, true);
  });
});
