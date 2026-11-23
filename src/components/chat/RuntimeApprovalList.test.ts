// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, expect, it } from "vitest";
import type { NativeApprovalOption, RuntimeApproval } from "../../api/runtime-permission-client";
import RuntimeApprovalList from "./RuntimeApprovalList.vue";

const command: RuntimeApproval = { id: "01440000-0000-4000-8000-000000000001", kind: "command", summary: "git status --short", scope: "/workspace", reason: "允许检查工作区状态吗？", status: "pending" };
const wrappers: ReturnType<typeof mount>[] = [];
function setup(requests: RuntimeApproval[]) {
  const wrapper = mount(RuntimeApprovalList, { attachTo: document.body, props: { requests, connected: true, deciding: null } });
  wrappers.push(wrapper); return wrapper;
}
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); document.body.innerHTML = ""; });

it("shows only pending decisions, including after a refresh or returning to history", async () => {
  const next = { ...command, id: "01440000-0000-4000-8000-000000000002", reason: "允许读取文件吗？" };
  const wrapper = setup([command, next]);
  expect(wrapper.text()).toContain("待处理 2 项");
  expect(wrapper.text()).toContain(command.reason);
  expect(wrapper.text()).not.toContain(next.reason);
  await wrapper.get('button[aria-keyshortcuts="Enter"]').trigger("click");
  expect(wrapper.emitted("decision")).toEqual([[command.id, "approve_once"]]);
  await wrapper.setProps({ requests: [{ ...command, status: "approved" }, next] });
  expect(wrapper.text()).not.toContain(command.reason);
  await wrapper.get('[role="group"]').trigger("keydown", { key: "Escape" });
  expect(wrapper.emitted("decision")?.[1]).toEqual([next.id, "reject"]);
  for (const status of ["approved", "rejected", "unavailable", "cancelled"] as const) {
    await wrapper.setProps({ requests: [{ ...command, status }] });
    expect(wrapper.find("section").exists()).toBe(false);
  }
  await wrapper.setProps({ requests: [{ ...command, kind: "mcp", mcp: { server: "sorftime", tool: "product_detail", asin: "B07H9PZDQW", marketplace: "US" } }] });
  expect(wrapper.find("section").exists()).toBe(false);
});

it("opens the two native choices without approving and submits only the selected option", async () => {
  const wrapper = setup([{ ...command, commandPrefix: ["git", "status"] }]);
  const more = wrapper.get('button[aria-haspopup="menu"]');
  await more.trigger("click"); await flushPromises();
  const options = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
  expect([...options].map(o => o.textContent)).toEqual(["允许一次", "允许相似命令"]);
  document.querySelector<HTMLButtonElement>('[aria-label="查看相似命令的授权范围"]')!.click(); await flushPromises();
  const scope = document.getElementById(options[1]!.getAttribute("aria-describedby")!)!;
  expect(scope.textContent).toContain("git status");
  expect(wrapper.emitted("decision")).toBeUndefined();
  options[1]!.click(); await flushPromises();
  expect(wrapper.emitted("decision")).toEqual([[command.id, "approve_similar"]]);
});

it("keeps shortcuts scoped and unavailable offers or disconnected callbacks inert", async () => {
  const wrapper = setup([command]);
  await wrapper.get('[aria-haspopup="menu"]').trigger("click"); await flushPromises();
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  expect([...menu.querySelectorAll('[role="menuitem"]')].map(b => b.textContent?.trim())).toEqual(["允许一次"]);
  menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await flushPromises();
  await wrapper.get('[role="group"]').trigger("keydown", { key: "Enter", isComposing: true });
  expect(wrapper.emitted("decision")).toBeUndefined();
  await wrapper.get('[role="group"]').trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("decision")).toEqual([[command.id, "approve_once"]]);
  await wrapper.setProps({ connected: false });
  expect(wrapper.get('button[aria-keyshortcuts="Enter"]').attributes("disabled")).toBeDefined();
  await wrapper.get('[role="group"]').trigger("keydown", { key: "Escape" });
  expect(wrapper.emitted("decision")).toHaveLength(1);
});

it("uses the scoped menu for an untyped older callback without assuming a default choice", async () => {
  const nativeChoices = [{ id: "native_0", label: "在本会话允许" }, { id: "native_1", label: "取消本次" }];
  const wrapper = setup([{ ...command, scope: "", nativeChoices }]);
  await wrapper.get("article").trigger("keydown", { key: "Enter" });
  await wrapper.get('[aria-label="选择审批选项"]').trigger("click"); await flushPromises();
  const items = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
  expect([...items].map(button => button.textContent?.trim())).toEqual(nativeChoices.map(choice => choice.label));
  expect(wrapper.emitted("decision")).toBeUndefined();
  items[0]!.click();
  expect(wrapper.emitted("decision")).toEqual([[command.id, "native_0"]]);
});

it("uses the original handles for once and each exact native command prefix", async () => {
  const nativeChoices = [
    { id: "native_0", kind: "cancel", label: "取消本轮" },
    { id: "native_1", kind: "command_prefix", label: "范围一", detail: '["git","status"]' },
    { id: "native_2", kind: "allow_once", label: "允许一次" },
    { id: "native_3", kind: "command_prefix", label: "范围二", detail: '["git","log"]' },
  ] as const;
  const request = { ...command, nativeChoices };
  const wrapper = setup([request]);
  await wrapper.get('[aria-label="更多允许选项"]').trigger("click"); await flushPromises();
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  expect(items.map(button => button.textContent?.trim())).toEqual(["允许一次", "允许相似命令", "允许相似命令"]);
  expect(menu.innerText).toContain('["git","status"]');
  expect(menu.innerText).toContain('["git","log"]');
  await wrapper.setProps({ requests: [{ ...request, nativeChoices: [...nativeChoices] }] });
  expect(wrapper.get('[aria-haspopup="menu"]').attributes("aria-expanded")).toBe("true");
  items[2]!.click(); await flushPromises();
  expect(wrapper.emitted("decision")).toEqual([[command.id, "native_3"]]);
  await wrapper.get('button[aria-keyshortcuts="Enter"]').trigger("click");
  expect(wrapper.emitted("decision")?.[1]).toEqual([command.id,"native_2"]);
});

it.each([
  ["file_change", "本会话允许修改这些文件"],
  ["permissions", "仅本轮授予并启用严格自动审核"],
  ["permissions", "始终允许此工具"],
] as const)("shows the scope offered by %s without offering a command rule", async (kind, scopeLabel) => {
  const nativeChoices: NativeApprovalOption[] = [
    { id: "native_0", kind: "allow_scope", label: scopeLabel },
    { id: "native_1", kind: "allow_once", label: "允许一次" },
  ];
  const wrapper = setup([{ ...command, kind, nativeChoices }]);
  await wrapper.get('[aria-label="更多允许选项"]').trigger("click"); await flushPromises();
  const items = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
  expect([...items].map(b => b.textContent?.trim())).toEqual(["允许一次",scopeLabel]);
  items[1]!.click(); expect(wrapper.emitted("decision")).toEqual([[command.id,"native_0"]]);
});
