// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, expect, it } from "vitest";
import type { RuntimeApproval } from "../../api/runtime-permission-client";
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
  expect([...options].map(o => o.textContent)).toEqual(["允许一次", expect.stringContaining("允许类似命令")]);
  const scope = document.getElementById(options[1]!.getAttribute("aria-describedby")!)!;
  expect(scope.textContent).toContain("git status");
  document.querySelector<HTMLButtonElement>('[aria-label="了解类似命令的授权范围"]')!.click(); await flushPromises();
  expect(scope.textContent).toContain("重新打开易界");
  expect(wrapper.emitted("decision")).toBeUndefined();
  options[1]!.click(); await flushPromises();
  expect(wrapper.emitted("decision")).toEqual([[command.id, "approve_similar"]]);
});

it("keeps shortcuts scoped and unavailable offers or disconnected callbacks inert", async () => {
  const wrapper = setup([command]);
  expect(wrapper.find('[aria-haspopup="menu"]').exists()).toBe(false);
  await wrapper.get('[role="group"]').trigger("keydown", { key: "Enter", isComposing: true });
  expect(wrapper.emitted("decision")).toBeUndefined();
  await wrapper.get('[role="group"]').trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("decision")).toEqual([[command.id, "approve_once"]]);
  await wrapper.setProps({ connected: false });
  expect(wrapper.get('button[aria-keyshortcuts="Enter"]').attributes("disabled")).toBeDefined();
  await wrapper.get('[role="group"]').trigger("keydown", { key: "Escape" });
  expect(wrapper.emitted("decision")).toHaveLength(1);
});
