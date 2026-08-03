// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it } from "vitest";
import { resolveNavigationVisibility } from "../../authorization/app-permission-policy";
import type { KnownCapability } from "../../domain/permissions";
import { resolveAppNavigation } from "../../navigation/app-nav";
import YjSidebar from "./YjSidebar.vue";

async function mountSidebar(capabilities: readonly KnownCapability[]) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/chat", component: defineComponent({ template: "<div />" }) },
      { path: "/settings", component: defineComponent({ template: "<div />" }) },
    ],
  });
  await router.push("/settings");
  await router.isReady();

  return mount(YjSidebar, {
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
    global: { plugins: [router] },
  });
}

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

  it("A11Y-002 renders an allowed unpublished module disabled with no route", async () => {
    const wrapper = await mountSidebar(["plugin.read"]);
    const disabled = wrapper.find('[aria-label="插件，即将开放"]');

    expect(disabled.exists()).toBe(true);
    expect(disabled.attributes("aria-disabled")).toBe("true");
    expect(disabled.element.tagName).toBe("DIV");
    expect(wrapper.findAll("a").some((link) => link.text().includes("插件"))).toBe(false);
  });

  it("FEAT-126 hides the sidebar visibility control when chat owns the fixed App Shell", async () => {
    const wrapper = await mountSidebar(["task.create"]);
    await wrapper.setProps({ allowToggle: false, currentPath: "/chat" });

    expect(wrapper.find('[aria-label="收起侧栏"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="展开侧栏"]').exists()).toBe(false);
  });
});
