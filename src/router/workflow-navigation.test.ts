// @vitest-environment happy-dom
import { defineComponent, nextTick } from "vue";
import { createMemoryHistory, isNavigationFailure } from "vue-router";
import { expect, it, vi } from "vitest";
import { createAppRouter } from "./index";

it("preserves workflow title and focus when leaving is cancelled, then updates after a successful Chat navigation", async () => {
  const page = async () => defineComponent({ template: "<div />" });
  const router = createAppRouter(
    createMemoryHistory(),
    { enabled: true, ready: true, ensureInitialized: async () => undefined, hasCapability: () => true },
    { chat: page, store: page, workflows: page, plugins: page, settings: page, accessDenied: page },
    true, true, true, true,
  );
  const originalTitle = document.title;
  const main = document.createElement("main");
  const heading = document.createElement("h1");
  main.append(heading);
  document.body.append(main);
  const focus = vi.spyOn(heading, "focus");
  try {
    await router.push("/workflows");
    await nextTick();
    expect(document.title).toBe("工作流 · 易界 AI");
    focus.mockClear();
    const removeGuard = router.beforeEach((to) => to.path !== "/chat");
    expect(isNavigationFailure(await router.push("/chat"))).toBe(true);
    await nextTick();
    expect(router.currentRoute.value.path).toBe("/workflows");
    expect(document.title).toBe("工作流 · 易界 AI");
    expect(focus).not.toHaveBeenCalled();
    removeGuard();
    await router.push("/chat");
    await nextTick();
    expect(document.title).toBe("新建任务 · 易界 AI");
    expect(focus).toHaveBeenCalledOnce();
  } finally {
    focus.mockRestore();
    main.remove();
    document.title = originalTitle;
  }
});

it("applies the same workspace capability and local feature gate to create and editor deep links", async () => {
  const page = async () => defineComponent({ template: "<div />" });
  const editor = vi.fn(page);
  const loaders = { chat: page, store: page, workflows: page, workflowEditor: editor, plugins: page, settings: page, accessDenied: page };
  for (const path of ["/workflows/new", "/workflows/7684526620584968192"]) {
    const denied = createAppRouter(createMemoryHistory(), { enabled: true, ready: true, ensureInitialized: async () => undefined, hasCapability: capability => capability !== "workspace.use" }, loaders, true, true, true, true);
    await denied.push(path);
    expect(denied.currentRoute.value.path).toBe("/access-denied");
    expect(editor).not.toHaveBeenCalled();
    const gated = createAppRouter(createMemoryHistory(), { enabled: true, ready: true, ensureInitialized: async () => undefined, hasCapability: () => true }, loaders, true, true, true, false);
    await gated.push(path);
    expect(gated.currentRoute.value.path).toBe("/settings");
    expect(editor).not.toHaveBeenCalled();
  }
});
