// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { NModal } from "naive-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatPermissionState } from "../../api/runtime-permission-client";
import ChatPermissionControl from "./ChatPermissionControl.vue";

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => { wrappers.splice(0).forEach((w) => w.unmount()); document.body.innerHTML = ""; });
function setup(state: Partial<ChatPermissionState> = {}) {
  // The default transition-stub wraps the modal root and prevents Naive UI's
  // focus trap from finding it. Exercise the real transition/DOM structure.
  const wrapper = mount(ChatPermissionControl, { attachTo: document.body, global: {stubs: {transition: false}}, props: { state: { mode: "ask", busy: false, fullAccessConfirmed: false, ...state }, disabled: false, saving: false } });
  wrappers.push(wrapper); return wrapper;
}
async function openFullAccess(wrapper: ReturnType<typeof setup>) {
  await wrapper.get(".permission-trigger").trigger("click"); await flushPromises();
  document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[2]!.click();
  await flushPromises();
}
function allowButton() { return document.querySelector<HTMLButtonElement>(".permission-confirm-primary")!; }
function acknowledgement() { return document.querySelector<HTMLElement>(".permission-confirm-acknowledgement")!; }
async function toggleAcknowledgement() { acknowledgement().click(); await flushPromises(); }

describe("permission menu interaction", () => {
  it("displays the complete risk descriptions and only enables allow while acknowledged", async () => {
    const wrapper = setup();
    await openFullAccess(wrapper);
    const dialog = document.querySelector('[role="dialog"]')!;
    await vi.waitFor(() => expect(document.activeElement).toBe(dialog.querySelector(".permission-confirm-cancel")));
    expect(dialog.textContent).toContain("确认允许完全访问?");
    expect([...dialog.querySelectorAll("h3")].map(node => node.textContent)).toEqual(["文件操作", "终端命令", "访问互联网"]);
    expect(dialog.textContent).toContain("读取、创建、修改、上传或删除此计算机上任意位置的文件");
    expect(dialog.textContent).toContain("运行命令、安装软件和更改系统设置");
    expect(dialog.textContent).toContain("访问网站、发送数据并使用已启用的连接器");
    expect(acknowledgement().getAttribute("aria-checked")).toBe("false");
    expect(allowButton().disabled).toBe(true);
    allowButton().click(); await flushPromises();
    expect(wrapper.emitted("select")).toBeUndefined();
    await toggleAcknowledgement();
    expect(allowButton().disabled).toBe(false);
    await toggleAcknowledgement();
    expect(allowButton().disabled).toBe(true);
    await toggleAcknowledgement();
    allowButton().click(); await flushPromises();
    expect(wrapper.emitted("select")).toEqual([["full", true]]);
    expect(wrapper.getComponent(NModal).props("show")).toBe(false);
  });

  it.each(["cancel", "close", "escape", "mask"] as const)("clears acknowledgement on %s and requires it again on reopening", async (action) => {
    const wrapper = setup();
    await openFullAccess(wrapper); await toggleAcknowledgement();
    if (action === "cancel") document.querySelector<HTMLButtonElement>(".permission-confirm-cancel")!.click();
    else if (action === "close") document.querySelector<HTMLButtonElement>(".permission-confirm-close")!.click();
    else if (action === "mask") document.querySelector<HTMLElement>(".permission-confirm-overlay .n-modal-mask")!.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", code: "Escape", bubbles: true}));
    await flushPromises();
    expect(wrapper.getComponent(NModal).props("show")).toBe(false);
    expect(wrapper.emitted("select")).toBeUndefined();
    expect(wrapper.get(".permission-trigger").text()).toContain("请求批准");
    await openFullAccess(wrapper);
    expect(acknowledgement().getAttribute("aria-checked")).toBe("false");
    expect(allowButton().disabled).toBe(true);
  });

  it("requires a fresh acknowledgement even if full access was previously confirmed", async () => {
    const wrapper = setup({mode: "auto", fullAccessConfirmed: true});
    await openFullAccess(wrapper);
    expect(wrapper.getComponent(NModal).props("show")).toBe(true);
    expect(allowButton().disabled).toBe(true);
    expect(wrapper.emitted("select")).toBeUndefined();
    await toggleAcknowledgement();
    allowButton().click(); await flushPromises();
    expect(wrapper.emitted("select")).toEqual([["full", true]]);
  });

  it.each([
    {disabled: true},
    {saving: true},
    {state: null},
    {state: {mode: "ask" as const, busy: true, fullAccessConfirmed: false}},
  ])("discards acknowledgement when the control becomes unavailable: %j", async (props) => {
    const wrapper = setup();
    await openFullAccess(wrapper); await toggleAcknowledgement();
    await wrapper.setProps(props); await flushPromises();
    expect(wrapper.getComponent(NModal).props("show")).toBe(false);
    expect(wrapper.get(".permission-trigger").attributes("disabled")).toBeDefined();
    allowButton()?.click(); await flushPromises();
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("focuses the current mode, supports arrows and closes with Escape", async () => {
    const wrapper = setup(); const trigger = wrapper.get(".permission-trigger");
    await trigger.trigger("click"); await flushPromises();
    const choices = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    expect(choices).toHaveLength(3);
    expect(choices.map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("请求批准"), expect.stringContaining("帮我批准"), expect.stringContaining("完全访问")]));
    expect(document.activeElement).toBe(choices[0]);
    choices[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(choices[1]);
    choices[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger.element);
  });

  it("keeps normal mode selection unchanged and closes the menu when busy", async () => {
    const wrapper = setup(); await wrapper.get(".permission-trigger").trigger("click"); await flushPromises();
    document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[1]!.click(); await flushPromises();
    expect(wrapper.emitted("select")).toEqual([["auto", false]]);
    expect(wrapper.getComponent(NModal).props("show")).toBe(false);
    await wrapper.get(".permission-trigger").trigger("click"); await flushPromises();
    await wrapper.setProps({ disabled: true }); await flushPromises();
    expect(wrapper.get(".permission-trigger").attributes("aria-expanded")).toBe("false");
    expect(wrapper.get(".permission-trigger").attributes("disabled")).toBeDefined();
    expect(wrapper.emitted("select")).toHaveLength(1);
  });
});
