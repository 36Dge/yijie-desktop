// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { expect, it, vi } from "vitest";
import { useChatShopPreview } from "../../composables/useChatShopPreview";
import ChatModelControl from "./ChatModelControl.vue";
import ChatPermissionControl from "./ChatPermissionControl.vue";
import ChatShopControl from "./ChatShopControl.vue";
import ChatWorkspaceControl from "./ChatWorkspaceControl.vue";

const controls = [
  {
    name: "permission", panel: ".permission-menu",
    setup: () => () => h(ChatPermissionControl, {
      state: { mode: "ask", busy: false, fullAccessConfirmed: false }, disabled: false, saving: false,
    }),
  },
  {
    name: "shop", panel: ".shop-panel",
    setup: () => {
      const model = useChatShopPreview(() => "demo", () => "new");
      return () => h(ChatShopControl, { model, disabled: false });
    },
  },
  {
    name: "model", panel: ".model-menu",
    setup: () => () => h(ChatModelControl, {
      catalog: null, profile: null, disabled: false, loading: false, saving: false, error: "",
    }),
  },
  {
    name: "workspace", panel: ".workspace-menu",
    setup: () => () => h(ChatWorkspaceControl, {
      entries: [], selectedProjectId: null, disabled: false, loading: false, error: "",
      rootPath: "", createOpen: false, creating: false, createError: "",
    }),
  },
];

it.each(controls)("positions the $name popover at its visible composer button", async ({ setup, panel }) => {
  const view = mount(defineComponent({ setup }), {
    attachTo: document.body,
    // The popover measures its anchor in the real transition's enter hook.
    global: { stubs: { transition: false } },
  });
  try {
    const button = view.get("button");
    const bounds = new DOMRect(480, 440, 112, 32);
    // happy-dom has no layout. Supply the button's position to its layout box
    // and let the real popover find its target and calculate the placement.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.contains(button.element) ? bounds : new DOMRect();
    });
    await button.trigger("click");
    await flushPromises();
    const follower = document.querySelector(panel)?.closest<HTMLElement>("[v-placement]");
    expect(follower?.style.getPropertyValue("--v-target-width")).toBe("112px");
    expect(follower?.style.getPropertyValue("--v-target-height")).toBe("32px");
    expect(follower?.style.transform).toContain("translateY(440px)");
  } finally {
    view.unmount();
    vi.restoreAllMocks();
  }
});
