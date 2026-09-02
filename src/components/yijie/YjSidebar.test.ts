// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import axe from "axe-core";
import { defineComponent } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it } from "vitest";
import { resolveNavigationVisibility } from "../../authorization/app-permission-policy";
import type { KnownCapability } from "../../domain/permissions";
import { resolveAppNavigation } from "../../navigation/app-nav";
import { useChatStore } from "../../stores/chat.store";
import YjSidebar from "./YjSidebar.vue";

async function mountSidebar(capabilities: readonly KnownCapability[]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const chatStore = useChatStore(pinia);
  chatStore.phase = "ready";
  chatStore.projects = [{
    projectId: "019c1a00-0000-7000-8000-000000000001",
    safeName: "Synthetic Workspace",
    pinnedAt: null,
    lastUsedAt: 2,
    available: true,
  }];
  chatStore.sessions = [{
    sessionId: "019c1a00-0000-7000-8000-000000000002",
    projectId: chatStore.projects[0]!.projectId,
    title: "Synthetic Session",
    titleSource: "fallback",
    pinnedAt: null,
    lastActivityAt: 3,
    latestTurnStatus: "completed",
    projectAvailable: true,
  }];
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/chat", component: defineComponent({ template: "<div />" }) },
      { path: "/chat/:sessionId", component: defineComponent({ template: "<div />" }) },
      { path: "/store", component: defineComponent({ template: "<div />" }) },
      { path: "/workflows", component: defineComponent({ template: "<div />" }) },
      { path: "/plugins", component: defineComponent({ template: "<div />" }) },
      { path: "/settings", component: defineComponent({ template: "<div />" }) },
    ],
  });
  await router.push("/settings");
  await router.isReady();

  return mount(YjSidebar, {
    attachTo: document.body,
    props: {
      entries: resolveAppNavigation(
        undefined,
        resolveNavigationVisibility({
          enabled: true,
          ready: true,
          hasCapability: (capability) => capabilities.includes(capability),
        }),
      ),
      collapsed: false,
      currentPath: "/settings",
    },
    global: { plugins: [pinia, router] },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("YjSidebar permission rendering", () => {
  it("A11Y-001 omits denied modules from both DOM and accessible labels", async () => {
    const wrapper = await mountSidebar(["task.create"]);

    expect(wrapper.text()).toContain("新建任务");
    expect(wrapper.text()).toContain("设置");
    expect(wrapper.text()).not.toContain("任务记录");
    expect(wrapper.text()).not.toContain("我的店铺");
    expect(wrapper.text()).not.toContain("插件");
    expect(wrapper.find('[aria-label*="插件"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label*="我的店铺"]').exists()).toBe(false);
  });

  it("A11Y-002 renders the allowed Skill marketplace as an enabled route", async () => {
    const wrapper = await mountSidebar(["plugin.read"]);
    const pluginLink = wrapper.findAll("a").find((link) => link.text().includes("插件"));

    expect(pluginLink?.attributes("href")).toBe("/plugins");
    expect(wrapper.find('[aria-label="插件，即将开放"]').exists()).toBe(false);
  });

  it("FEAT-150 renders the allowed store showcase as an enabled selected route", async () => {
    const wrapper = await mountSidebar(["store.read"]);
    await wrapper.setProps({ currentPath: "/store" });
    const storeLink = wrapper.findAll("a").find((link) => link.text().includes("我的店铺"));

    expect(storeLink?.attributes("href")).toBe("/store");
    expect(storeLink?.attributes("aria-current")).toBe("page");
    expect(wrapper.find('[aria-label="我的店铺，即将开放"]').exists()).toBe(false);
  });

  it("FEAT-151 renders the allowed workflow showcase as an enabled selected route", async () => {
    const wrapper = await mountSidebar(["workspace.use"]);
    await wrapper.setProps({ currentPath: "/workflows" });
    const workflowLink = wrapper.findAll("a").find((link) => link.text().includes("工作流"));

    expect(workflowLink?.attributes("href")).toBe("/workflows");
    expect(workflowLink?.attributes("aria-current")).toBe("page");
    expect(wrapper.find('[aria-label="工作流，即将开放"]').exists()).toBe(false);
  });

  it("FEAT-126 hides the sidebar visibility control when chat owns the fixed App Shell", async () => {
    const wrapper = await mountSidebar(["task.create"]);
    await wrapper.setProps({ allowToggle: false, currentPath: "/chat" });

    expect(wrapper.find('[aria-label="收起侧栏"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="展开侧栏"]').exists()).toBe(false);
  });

  it("emits a recovery request when the selected new-task entry is activated again", async () => {
    const wrapper = await mountSidebar(["task.create"]);
    await wrapper.setProps({ currentPath: "/chat" });
    const newTask = wrapper.findAll("a").find((link) => link.text().includes("新建任务"));

    await newTask?.trigger("click");

    expect(wrapper.emitted("recover-new-task")).toHaveLength(1);
  });

  it("FEAT-130 renders the approved main order and a non-navigable history tree", async () => {
    const wrapper = await mountSidebar([
      "task.create",
      "task.read",
      "store.read",
      "workspace.use",
      "schedule.read",
      "plugin.read",
      "knowledge.read",
    ]);
    await wrapper.setProps({ currentPath: "/chat", showChatTree: true });

    expect(wrapper.findAll(
      ".yj-sidebar__list--main > li > .yj-nav-item .yj-nav-item__label, " +
      ".yj-sidebar__list--main > li > .yj-sidebar__section .yj-sidebar__section-label",
    ).map((entry) => entry.text())).toEqual([
      "新建任务",
      "我的店铺",
      "工作流",
      "定时任务",
      "插件",
      "资料库",
      "任务记录",
    ]);
    const history = wrapper.get(".yj-sidebar__history-entry");
    expect(history.get('[role="heading"]').text()).toBe("任务记录");
    expect(history.find("a").exists()).toBe(false);
    expect(history.get('[aria-label="任务记录：项目与对话"]').attributes("aria-busy")).toBe("false");
    expect(wrapper.findAll("a").some((link) => link.text().includes("任务记录"))).toBe(false);
  });

  it("FEAT-130 associates an active conversation with history instead of new task", async () => {
    const wrapper = await mountSidebar(["task.create", "task.read"]);
    const sessionPath = "/chat/019c1a00-0000-7000-8000-000000000002";
    await wrapper.setProps({ currentPath: sessionPath, showChatTree: true });

    const newTask = wrapper.findAll("a").find((link) => link.text().includes("新建任务"));
    expect(newTask?.attributes("aria-current")).toBeUndefined();
    expect(wrapper.get('.chat-tree__session-link[aria-current="page"]').text()).toContain("Synthetic Session");
    expect(wrapper.get(".yj-sidebar__section--active").text()).toBe("任务记录");
  });

  it("FEAT-130 has no serious or critical axe violations in the expanded history shell", async () => {
    const wrapper = await mountSidebar([
      "task.create",
      "task.read",
      "store.read",
      "workspace.use",
      "schedule.read",
      "plugin.read",
      "knowledge.read",
    ]);
    await wrapper.setProps({ currentPath: "/chat", showChatTree: true });

    const results = await axe.run(wrapper.element, {
      rules: { region: { enabled: false } },
    });
    expect(results.violations.filter((violation) =>
      violation.impact === "serious" || violation.impact === "critical"
    )).toEqual([]);
  });
});
