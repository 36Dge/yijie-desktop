// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import RuntimeApprovalList from "./RuntimeApprovalList.vue";
import type { RuntimeApproval } from "../../api/runtime-permission-client";

it("keeps old Sorftime receipts readable with no decision action", () => {
  const old: RuntimeApproval = { id: "01440000-0000-4000-8000-000000000001", kind: "mcp", summary: "查询商品资料", scope: "Sorftime / product_detail", reason: "确认本次参数", status: "pending", mcp: { server: "sorftime", tool: "product_detail", asin: "B07H9PZDQW", marketplace: "US" } };
  for (const status of ["pending", "approved", "rejected"] as const) {
    const wrapper = mount(RuntimeApprovalList, { props: { requests: [{ ...old, status }], deciding: null, connected: true } });
    expect(wrapper.text()).toContain("B07H9PZDQW");
    expect(wrapper.text()).toContain("仅供查看");
    expect(wrapper.findAll("button")).toHaveLength(0);
    wrapper.unmount();
  }
  const wrapper = mount(RuntimeApprovalList, { props: { requests: [{ ...old, kind: "command", mcp: undefined }], deciding: null, connected: true } });
  expect(wrapper.findAll("button")).toHaveLength(2);
  wrapper.unmount();
});
