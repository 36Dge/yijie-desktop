// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { expertDisplay } from "../../test/expert-fixture";
import ChatExpertChip from "./ChatExpertChip.vue";
describe("single expert chip", () => {
  it("has separate accessible detail and remove controls", async () => {
    const view = mount(ChatExpertChip, { props: { expert: expertDisplay } });
    expect(view.get(".chat-expert-chip__subtitle").text()).toBe(expertDisplay.subtitle);
    await view.get('[aria-label="移除专家"]').trigger("click");
    expect(view.emitted("remove")).toHaveLength(1); expect(view.emitted("details")).toBeUndefined();
    await view.get('[aria-label^="查看已选专家"]').trigger("click");
    expect(view.emitted("details")).toHaveLength(1); view.unmount();
  });
  it("retains the current label while Native applies and disables removal", () => {
    const view = mount(ChatExpertChip, { props: { expert: expertDisplay, pending: true } });
    expect(view.text()).toContain(expertDisplay.displayName); expect(view.text()).toContain("处理中");
    expect(view.get('[aria-label="移除专家"]').attributes("disabled")).toBeDefined(); view.unmount();
  });
});
