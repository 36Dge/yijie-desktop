// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it } from "vitest";
import WorkflowSummaryCard from "./WorkflowSummaryCard.vue";
import { MY_WORKFLOWS, type WorkflowPublicationStatus } from "../../domain/workflow-showcase";

let wrapper: VueWrapper;
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ""; });

async function setup(status: WorkflowPublicationStatus, to?: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/workflows", component: { template: "<div />" } },
    { path: "/workflows/:workflowId", component: { template: "<h1>工作流页面</h1>" } },
  ] });
  await router.push("/workflows");
  wrapper = mount(WorkflowSummaryCard, { attachTo: document.body,
    props: { workflow: { ...MY_WORKFLOWS[0]!, status }, to },
    global: { plugins: [router] },
  });
  return router;
}

describe("workflow card actions", () => {
  it.each([
    ["published", "已发布", "进入工作流"],
    ["unpublished", "未发布", "进入编辑"],
  ] as const)("opens the existing resource for a %s workflow", async (status, label, action) => {
    const router = await setup(status, "/workflows/15301");
    expect(wrapper.get(".workflow-summary-card__status").text()).toBe(label);
    const link = wrapper.get(".workflow-summary-card__action");
    expect(link.text()).toBe(action);
    expect(link.attributes("aria-label")).toContain(MY_WORKFLOWS[0]!.title);
    await link.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/workflows/15301");
  });

  it.each(["published", "unpublished"] as const)("explains a %s example action without navigating, and closes with Escape", async status => {
    const router = await setup(status);
    const button = wrapper.get(".workflow-summary-card__action");
    await button.trigger("click");
    await flushPromises();
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(document.querySelector('[role="status"]')?.textContent).toContain("此工作流为示例方案，暂未开放");
    expect(router.currentRoute.value.path).toBe("/workflows");
    await button.trigger("keyup", { key: "Escape" });
    await flushPromises();
    expect(button.attributes("aria-expanded")).toBe("false");
  });
});
