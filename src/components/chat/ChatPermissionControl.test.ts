// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import ChatPermissionControl from "./ChatPermissionControl.vue";

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => { wrappers.splice(0).forEach((w) => w.unmount()); document.body.innerHTML = ""; });
function setup() {
  const wrapper = mount(ChatPermissionControl, { attachTo: document.body, props: { state: { mode: "ask", busy: false, fullAccessConfirmed: false }, disabled: false, saving: false } });
  wrappers.push(wrapper); return wrapper;
}
describe("permission menu interaction", () => {
  it("does not save full access when its first confirmation is cancelled", async () => {
    const wrapper = setup();
    await wrapper.get(".permission-trigger").trigger("click"); await flushPromises();
    document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[2]!.click();
    await flushPromises();
    expect(wrapper.emitted("select")).toBeUndefined();
    const buttons = document.querySelectorAll<HTMLButtonElement>(".permission-confirm button");
    expect(buttons).toHaveLength(2);
    buttons[0]!.click(); await flushPromises();
    expect(wrapper.emitted("select")).toBeUndefined();
    expect(wrapper.get(".permission-trigger").text()).toContain("请求批准");
  });
  it("saves full access only after confirmation and discards it if the task becomes busy", async () => {
    const wrapper = setup();
    await wrapper.get(".permission-trigger").trigger("click"); await flushPromises();
    document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[2]!.click(); await flushPromises();
    document.querySelectorAll<HTMLButtonElement>(".permission-confirm button")[1]!.click(); await flushPromises();
    expect(wrapper.emitted("select")).toEqual([["full", true]]);
    await wrapper.get(".permission-trigger").trigger("click"); await flushPromises();
    document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[2]!.click(); await flushPromises();
    await wrapper.setProps({ disabled: true }); await flushPromises();
    document.querySelectorAll<HTMLButtonElement>(".permission-confirm button")[1]?.click(); await flushPromises();
    expect(wrapper.emitted("select")).toHaveLength(1);
  });
  it("focuses the current mode, supports arrows and closes with Escape", async () => {
    const wrapper = setup(); const trigger = wrapper.get(".permission-trigger");
    await trigger.trigger("click"); await flushPromises();
    const choices = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    expect(choices).toHaveLength(3);
    expect(choices.map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("请求批准"), expect.stringContaining("帮我批准"), expect.stringContaining("完全访问权限")]));
    expect(document.activeElement).toBe(choices[0]);
    choices[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(choices[1]);
    choices[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger.element);
  });
  it("closes an open menu when the task becomes busy", async () => {
    const wrapper = setup(); await wrapper.get(".permission-trigger").trigger("click"); await flushPromises();
    await wrapper.setProps({ disabled: true }); await flushPromises();
    expect(wrapper.get(".permission-trigger").attributes("aria-expanded")).toBe("false");
    expect(wrapper.get(".permission-trigger").attributes("disabled")).toBeDefined();
    expect(wrapper.emitted("select")).toBeUndefined();
  });
});
