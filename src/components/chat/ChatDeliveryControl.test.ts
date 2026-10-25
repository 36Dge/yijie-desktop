// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import ChatDeliveryControl from "./ChatDeliveryControl.vue";
it("shows explicit cancellation only for a proven unsent submission and retains permission states", async () => {
  const wrapper = mount(ChatDeliveryControl, { props: { states: [{ operationId: "op", turnId: "turn", status: "unclassified", cancellable: false }], loading: false, cancelling: null, canCancel: true, error: "", notice: "" } });
  try {
    expect(wrapper.text()).toContain("暂不可取消"); expect(wrapper.text()).not.toContain("取消未发送");
    await wrapper.setProps({ states: [{ operationId: "op", turnId: "turn", status: "never_sent", cancellable: true }], canCancel: false });
    expect(wrapper.findAll("button")[0]!.attributes("disabled")).toBeDefined(); expect(wrapper.text()).toContain("没有取消权限");
    await wrapper.setProps({ canCancel: true }); await wrapper.findAll("button")[0]!.trigger("click"); expect(wrapper.emitted("cancel")).toEqual([["op"]]);
  } finally { wrapper.unmount(); }
});
