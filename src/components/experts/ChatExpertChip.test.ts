// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { expertDisplay } from "../../test/expert-fixture";
import ChatExpertChip from "./ChatExpertChip.vue";
describe("single expert chip", () => {
  it("has separate accessible detail and remove controls", async () => {
    const view = mount(ChatExpertChip, { props: { expert: expertDisplay } });
    expect(view.text()).toBe(expertDisplay.displayName);
    expect(view.text()).not.toContain(expertDisplay.subtitle);
    expect(view.findAll("button")[0]!.attributes("aria-label")).toBe("移除专家");
    await view.get('[aria-label="移除专家"]').trigger("click");
    expect(view.emitted("remove")).toHaveLength(1); expect(view.emitted("details")).toBeUndefined();
    await view.get('[aria-label^="查看已选专家"]').trigger("click");
    expect(view.emitted("details")).toHaveLength(1); view.unmount();
  });
  it("retains the current label while Native applies and disables removal", () => {
    const view = mount(ChatExpertChip, { props: { expert: expertDisplay, pending: true } });
    expect(view.get('[aria-label^="查看已选专家"]').text()).toBe(expertDisplay.displayName);
    expect(view.get('[role="status"]').text()).toBe("正在切换专家");
    expect(view.find('.chat-expert-chip--removable').exists()).toBe(false);
    expect(view.get('[aria-label="移除专家"]').attributes("disabled")).toBeDefined(); view.unmount();
  });
  it("does not remove a disabled selection while keeping details available", async () => {
    const view = mount(ChatExpertChip, { props: { expert: expertDisplay, disabled: true } });
    await view.get('[aria-label="移除专家"]').trigger('click');
    expect(view.emitted('remove')).toBeUndefined();
    await view.get('[aria-label^="查看已选专家"]').trigger('click');
    expect(view.emitted('details')).toHaveLength(1);
    view.unmount();
  });
});
