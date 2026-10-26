// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import process from "node:process";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { expect, it, vi } from "vitest";
import ChatDeliveryControl from "./ChatDeliveryControl.vue";
import { useChatDelivery } from "../../composables/useChatDelivery";
const transport = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: transport }));

const evidencePath = process.env.YIJIE_FEAT164_DELIVERY_EVIDENCE_FILE;
// Opt-in consumer conformance for the retained Native result. This replays only
// the IPC transport; it does not claim to run a WebView or a native command.
it.skipIf(!evidencePath)("renders and cancels the exact retained Native never-sent operation", async () => {
  const data = JSON.parse(readFileSync(evidencePath!, "utf8"));
  expect(data.dispatch_attempts).toBe(0);
  expect(data.message_rows_retained).toBe(1);
  expect(data.receipt).toEqual(data.replayed_receipt);
  const session = data.receipt.sessionId;
  let cancelled = false;
  transport.mockImplementation(async (command: string, args: { request: { requestId: string; contextId: string; payload: object } }) => {
    expect(args.request.contextId).toBe("retained-test-scope");
    let result: unknown;
    if (command === "chat_delivery_state_v1") {
      expect(args.request.payload).toEqual({ sessionId: session });
      result = cancelled ? [] : data.claimed;
    } else {
      expect(command).toBe("chat_cancel_unsent_delivery_v1");
      expect(args.request.payload).toEqual({ sessionId: session, operationId: data.receipt.operationId });
      cancelled = true;
      result = data.receipt;
    }
    return { schemaVersion: 1, requestId: args.request.requestId, data: result };
  });
  const resync = vi.fn().mockResolvedValue(undefined);
  const root = mount(defineComponent({ setup() {
    const delivery = useChatDelivery(() => "retained-test-scope", () => session, () => true, () => "same-operation", resync);
    return () => h(ChatDeliveryControl, {
      states: delivery.states.value, loading: delivery.loading.value,
      cancelling: delivery.cancelling.value, canCancel: true,
      error: delivery.error.value, notice: delivery.notice.value,
      onRefresh: delivery.refresh, onCancel: delivery.cancel,
    });
  } }));
  try {
    await flushPromises();
    expect(root.text()).toContain("此提交尚未发送");
    expect(cancelled).toBe(false);
    await root.findAll("button").find(button => button.text() === "刷新状态")!.trigger("click");
    await flushPromises();
    expect(cancelled).toBe(false);
    await root.findAll("button").find(button => button.text() === "取消未发送的提交")!.trigger("click");
    await flushPromises();
    expect(root.text()).toContain("提交已取消，原消息已保留");
    expect(root.text()).not.toContain("取消未发送的提交");
    expect(resync).toHaveBeenCalledOnce();
    expect(transport.mock.calls.filter(([command]) => command === "chat_cancel_unsent_delivery_v1")).toHaveLength(1);
  } finally { root.unmount(); vi.resetAllMocks(); }
});
