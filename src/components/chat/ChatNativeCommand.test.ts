// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeConversationView } from "../../api/generated/native-conversation-private.gen";
import { composeConversationView, type ConversationSnapshot } from "../../domain/conversation-view";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import { conversationDiagnosticMessage } from "../../domain/conversation-diagnostics";
import ChatCommandItem from "./ChatCommandItem.vue";

const archive: ConversationSnapshot = {
  threads: [{threadId: "session", status: "ready"}],
  turns: [{threadId: "session", turnId: "turn", ordinal: 0, status: "completed", terminalStatus: "completed"}],
  items: [],
};
type NativeItem = NativeConversationView["items"][number]["item"];
function view(item: Partial<NativeItem> = {}, overrides: Partial<NativeConversationView> = {}): NativeConversationView {
  return {sessionId: "session", turnId: "turn", runtimeThreadId: "runtime-thread", runtimeTurnId: "runtime-turn",
    source: "native_observed", revision: "1", availability: "partial", status: "completed", statusSource: "runtime_notification",
    terminalObserved: true, items: [{ordinal: 0, lastMethod: "item/completed", item: {
      id: "command", type: "commandExecution", status: "completed", commandLabel: "检查项目",
      cwdLabel: "当前项目", outputText: "普通安全输出", exitCode: 0, durationMs: 0, availability: "available", ...item,
    }}], ...overrides};
}
function project(nativeView: NativeConversationView, liveTurnId: string | null = null) {
  const timeline = selectConversationTimeline(composeConversationView(archive, [nativeView]), "session", undefined,
    {protectApprovalProcessContent: false, liveTurnId})!;
  const item = timeline.turns[0]!.items[0]!;
  if (item.execution?.kind !== "command") throw new Error("Expected command");
  return {item, execution: item.execution};
}
function setup(nativeView: NativeConversationView, liveTurnId: string | null = null) {
  return mount(ChatCommandItem, {props: project(nativeView, liveTurnId), attachTo: document.body});
}
enableAutoUnmount(afterEach);
async function expand(wrapper: ReturnType<typeof setup>) {
  const button = wrapper.get(".chat-timeline-item-shell__disclosure");
  if (button.attributes("aria-expanded") === "false") await button.trigger("click");
}
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", {configurable: true, value: undefined});
});

describe("FEAT-136 native Command display", () => {
  it("keeps native provenance and safe fields without manufacturing legacy metadata", async () => {
    const input = view();
    const before = JSON.stringify(input);
    const props = project(input);
    expect(props.execution).not.toHaveProperty("startedSource");
    expect(props.execution).not.toHaveProperty("output.retention");
    expect(props.execution).toMatchObject({native: {source: "native_observed", lastMethod: "item/completed", item: input.items[0]!.item}});
    const wrapper = setup(input);
    await expand(wrapper);
    expect(wrapper.text()).toContain("当前项目");
    expect(wrapper.text()).toContain("0 毫秒");
    expect(wrapper.get(".chat-command-item__facts").text()).toContain("退出码0");
    expect(wrapper.get("pre").text()).toBe("普通安全输出");
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(["completed", "failed", "declined"] as const)("shows %s from native status, independent of exit and Turn result", async status => {
    const wrapper = setup(view({status, exitCode: status === "completed" ? 128 : 0}, {status: "failed"}));
    await expand(wrapper);
    if (status === "completed") {
      expect(wrapper.get(".chat-timeline-item-shell__status").text()).toBe("已完成");
      expect(wrapper.find(".chat-command-item__error").exists()).toBe(false);
    } else {
      expect(wrapper.get(".chat-command-item__error code").text()).toBe(`command_${status}`);
    }
  });

  it.each(["completed", "failed", "declined"] as const)("preserves legal empty output for %s without calling it success", async status => {
    const wrapper = setup(view({status, outputText: ""}));
    await expand(wrapper);
    expect(wrapper.text()).toContain("已收到的安全输出为空");
    expect(wrapper.text()).not.toContain("命令已完成，没有输出内容");
    expect(wrapper.find('[aria-label="复制代码"]').exists()).toBe(false);
  });

  it("does not infer output truncation from partial metadata", async () => {
    const wrapper = setup(view({availability: "partial", durationMs: null}));
    await expand(wrapper);
    expect(wrapper.text()).toContain("此项信息不完整");
    expect(wrapper.text()).not.toContain("截断");
    expect(wrapper.text()).not.toContain("上游仅提供");
    expect(wrapper.get("pre").text()).toBe("普通安全输出");
    expect(wrapper.find(".chat-command-item__error").exists()).toBe(false);
  });

  it.each(["短", "完全不同的最终输出", ""])("replaces the whole native Item without prefix reconciliation: %s", async outputText => {
    const first = view({outputText: "原先更长的安全输出"});
    const wrapper = setup(first);
    await expand(wrapper);
    await wrapper.setProps(project(view({outputText}, {revision: "2"})));
    expect(wrapper.findAll("article")).toHaveLength(1);
    expect(wrapper.get("pre").text()).toBe(outputText);
    expect(wrapper.text()).not.toContain("原先更长的安全输出");
  });

  it.each(["completed", "interrupted", "failed"] as const)("stops live claims when Turn is %s without sealing the Command", async status => {
    const input = view({}, {status, items: [{ordinal: 0, lastMethod: "item/started", item: {
      id: "command", type: "commandExecution", status: "inProgress", availability: "available",
    }}]});
    const props = project(input, "turn");
    expect(props.execution.status).toBe("running");
    expect(props.item.domainStatus).toBe("streaming");
    const wrapper = setup(input, "turn");
    expect(wrapper.get("article").attributes("aria-busy")).toBe("false");
    expect(wrapper.get(".chat-timeline-item-shell__disclosure").attributes("aria-expanded")).toBe("false");
    expect(wrapper.get(".chat-timeline-item-shell__status").text()).toContain("本轮已结束，未观察到该项结束记录");
    await expand(wrapper);
    expect(wrapper.get('[aria-live="polite"]').text()).toContain("本轮已结束，未观察到该项结束记录");
    expect(wrapper.text()).not.toContain("命令正在执行");
    expect(wrapper.text()).not.toContain("等待安全输出");
    expect(wrapper.text()).toContain("未观察到命令结束记录，暂无结果输出");
    expect(input.items[0]!.lastMethod).toBe("item/started");
  });

  it("shows waiting only with the existing trusted live policy and retains no output accumulator", async () => {
    const input = view({}, {status: "inProgress", terminalObserved: false, items: [{ordinal: 0, lastMethod: "item/started",
      item: {id: "command", type: "commandExecution", status: "inProgress", availability: "available"}}]});
    const wrapper = setup(input, "turn");
    expect(wrapper.get("article").attributes("aria-busy")).toBe("true");
    expect(wrapper.text()).toContain("输出将在收到命令结束记录后展示");
    await wrapper.setProps(project({...input, diagnostic: "stream_gap"}, "turn"));
    expect(wrapper.get("article").attributes("aria-busy")).toBe("false");
    expect(wrapper.text()).not.toContain("命令正在执行");
    expect(wrapper.text()).not.toContain("输出将在收到命令结束记录后展示");
  });

  it("distinguishes missing cold history from an empty completed output", async () => {
    const input = view({}, {source: "native_rebuilt", statusSource: "runtime_read", terminalObserved: false,
      items: [{ordinal: 0, lastMethod: "thread/read", item: {id: "command", type: "commandExecution", status: "inProgress", availability: "partial"}}]});
    const wrapper = setup(input, "turn");
    await expand(wrapper);
    expect(wrapper.get("article").attributes("aria-busy")).toBe("false");
    expect(wrapper.text()).toContain("原生历史未提供可显示的输出");
    expect(wrapper.text()).not.toContain("命令正在执行");
    expect(wrapper.text()).not.toContain("已收到的安全输出为空");
  });

  it("copies only the displayed safe final text and keeps accessible status independent of output", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {configurable: true, value: {writeText}});
    const wrapper = setup(view());
    await expand(wrapper);
    await wrapper.get('.chat-copy-action button').trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledExactlyOnceWith("普通安全输出");
    expect(wrapper.get(".chat-command-item__status-announcement").text()).toBe("命令已完成。");
    const result = await axe.run(wrapper.element, {rules: {"color-contrast": {enabled: false}}});
    expect(result.violations).toEqual([]);
  });

  it("describes retained pending-final diagnostics as observations, not permanent activity", () => {
    expect(conversationDiagnosticMessage("command_output_pending_final")).toContain("曾观察到");
  });
});
