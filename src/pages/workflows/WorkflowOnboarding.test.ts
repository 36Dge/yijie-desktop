// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createMemoryHistory, RouterView } from "vue-router";
import { afterEach, expect, it, vi } from "vitest";
import { createAppRouter } from "../../router";
import { workflowNativeClient } from "../../api/workflow-native-client";
import WorkflowPage from "./WorkflowPage.vue";

vi.mock("../../authorization/workflow-local-ui-config", () => ({ workflowLocalUiEnabled: false }));
let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

it("shows onboarding in showcase mode with real route focus, dismisses for this launch, and leaves creation gated", async () => {
  const status = vi.spyOn(workflowNativeClient, "status");
  const list = vi.spyOn(workflowNativeClient, "list");
  const create = vi.spyOn(workflowNativeClient, "create");
  const otherPage = async () => defineComponent({ template: "<h1>其他页面</h1>" });
  const router = createAppRouter(createMemoryHistory(), {
    enabled: true, ready: true, ensureInitialized: async () => undefined, hasCapability: () => true,
  }, {
    chat: otherPage, store: otherPage, workflows: async () => WorkflowPage,
    plugins: otherPage, settings: otherPage, accessDenied: otherPage,
  }, true, true, true, true);
  await router.push("/chat");
  wrapper = mount(defineComponent({ components: { RouterView }, template: "<main><RouterView /></main>" }), {
    attachTo: document.body, global: { plugins: [router] },
  });
  await router.push("/workflows");
  await flushPromises();
  expect(router.currentRoute.value.path).toBe("/workflows");
  expect(wrapper.find(".workflow-page__create-card").exists()).toBe(true);
  expect(document.querySelector(".workflow-create-guide--ready")).not.toBeNull();
  expect(document.querySelector("#workflow-guide-title")?.textContent).toBe("从创建第一个工作流开始");
  expect(document.activeElement).toBe(wrapper.get(".workflow-page__create-card").element);
  document.querySelector<HTMLButtonElement>('[aria-label="关闭新手引导"]')!.click();
  await flushPromises();
  expect(document.querySelector(".workflow-create-guide")).toBeNull();

  await router.push("/chat");
  await router.push("/workflows");
  await flushPromises();
  expect(document.querySelector(".workflow-create-guide")).toBeNull();
  await wrapper.get(".workflow-page__create-card").trigger("click");
  await flushPromises();
  const dialog = document.querySelector(".workflow-create-dialog")!;
  expect(dialog.textContent).not.toContain("工作流服务尚未启用");
  const name = dialog.querySelector<HTMLInputElement>("#workflow-create-name")!;
  name.value = "内容整理";
  name.dispatchEvent(new Event("input", { bubbles: true }));
  const description = dialog.querySelector<HTMLTextAreaElement>("#workflow-create-description")!;
  description.value = "整理中文文本内容";
  description.dispatchEvent(new Event("input", { bubbles: true }));
  await flushPromises();
  expect(dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flushPromises();
  expect(status).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});
