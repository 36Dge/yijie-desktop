// @vitest-environment happy-dom

import axe from "axe-core";
import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ConversationCommandExecution,
  ConversationCommandOutput,
  ConversationSafeText,
  ConversationSourceFact,
} from "../../domain/conversation-state";
import type { ConversationTimelineItemViewModel } from "../../domain/conversation-timeline";
import ChatCommandItem from "./ChatCommandItem.vue";

const RAW_COMMAND_CANARY = "RAW_COMMAND_MUST_NOT_RENDER --token=private";

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

function source(sequence = "1"): ConversationSourceFact {
  return deepFreeze({
    sourceEventId: `event-${sequence}`,
    sourceSequence: sequence,
    sourceOccurredAt: "2026-08-29T09:00:00.000Z",
  });
}

function safeText(
  text: string,
  truncated = false,
): ConversationSafeText {
  return deepFreeze({
    text,
    truncated,
    truncationReason: truncated ? "utf8_byte_limit" : null,
  });
}

function completeOutput(text = "安全输出"): ConversationCommandOutput {
  return deepFreeze({
    retention: "complete",
    text,
    head: null,
    tail: null,
    reason: null,
    truncated: false,
    truncationReason: null,
  });
}

function execution(
  overrides: Partial<ConversationCommandExecution> = {},
): ConversationCommandExecution {
  return deepFreeze({
    kind: "command",
    status: "completed",
    startedSource: source(),
    lastSource: source("2"),
    commandSummary: safeText("检查工作区状态"),
    cwd: { kind: "workspace_root", segments: [] },
    liveOutput: null,
    output: completeOutput(),
    durationMs: 1_250,
    exitCode: 0,
    error: null,
    ...overrides,
  });
}

function item(command: ConversationCommandExecution): ConversationTimelineItemViewModel {
  const active = command.status === "running";
  const incomplete = command.status === "incomplete";
  return deepFreeze({
    identity: "timeline-command-demo",
    threadId: "thread-demo",
    turnId: "turn-demo",
    itemId: "command-demo",
    ordinal: 0,
    kind: "command",
    presentation: "command",
    role: "process",
    domainStatus: active ? "streaming" : incomplete ? "incomplete" : "completed",
    phase: active ? "active" : incomplete ? "incomplete" : "complete",
    assistantPhase: null,
    reasoning: null,
    execution: command,
    contentMode: "plain",
    collapsible: false,
    defaultExpanded: true,
    copyPolicy: "none",
    reconciliation: "matched",
    contentBlocks: [],
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("ChatCommandItem", () => {
  it.each([
    ["running" as const, "执行中", true],
    ["completed" as const, "已完成", false],
    ["failed" as const, "执行失败", false],
    ["declined" as const, "已拒绝", false],
    ["incomplete" as const, "未完整结束", false],
  ])("renders %s with text, an icon, and the correct initial disclosure", (
    status,
    label,
    expanded,
  ) => {
    const command = execution({
      status,
      output: status === "running" ? null : completeOutput(),
      durationMs: status === "running" ? null : 100,
      exitCode: status === "running" || status === "declined" ? null : 0,
    });
    const wrapper = mount(ChatCommandItem, {
      props: { item: item(command), execution: command },
    });

    const disclosure = wrapper.get(".chat-timeline-item-shell__disclosure");
    const visibleStatus = wrapper.get(".chat-timeline-item-shell__status");
    expect(disclosure.attributes("aria-expanded")).toBe(String(expanded));
    expect(disclosure.attributes("type")).toBe("button");
    expect(visibleStatus.text()).toBe(label);
    expect(visibleStatus.find("svg").exists()).toBe(true);
    expect(wrapper.find(".chat-command-item__details").exists()).toBe(expanded);
  });

  it("shows only the safe summary, safe cwd, terminal facts and safe copy payload", async () => {
    const writeText = vi.fn<(_: string) => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const command = execution({
      commandSummary: safeText("运行安全检查"),
      cwd: { kind: "workspace_relative", segments: ["packages", "desktop"] },
      output: completeOutput("只包含安全投影的输出"),
      durationMs: 1_250,
      exitCode: 7,
      ...({ rawCommand: RAW_COMMAND_CANARY } as Record<string, unknown>),
    });
    const wrapper = mount(ChatCommandItem, {
      props: { item: item(command), execution: command },
    });

    await wrapper.get(".chat-timeline-item-shell__disclosure").trigger("click");
    expect(wrapper.text()).toContain("运行安全检查");
    expect(wrapper.text()).toContain("packages/desktop");
    expect(wrapper.text()).toContain("1.3 秒");
    expect(wrapper.text()).toContain("退出码");
    expect(wrapper.text()).toContain("7");
    expect(wrapper.text()).toContain("只包含安全投影的输出");
    expect(wrapper.text()).not.toContain(RAW_COMMAND_CANARY);
    expect(wrapper.html()).not.toContain("rawCommand");

    await wrapper.get("button[aria-label='复制代码']").trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("只包含安全投影的输出");
  });

  it.each([
    [
      "complete",
      completeOutput("完整输出"),
      ["完整输出"],
      ["输出开头", "输出结尾", "运行时未提供"],
    ],
    [
      "complete_empty",
      completeOutput(""),
      ["命令已完成，没有输出内容"],
      ["运行时未提供", "输出已截断"],
    ],
    [
      "head_tail",
      deepFreeze<ConversationCommandOutput>({
        retention: "head_tail",
        text: null,
        head: "输出开头",
        tail: "输出结尾",
        reason: null,
        truncated: true,
        truncationReason: "upstream_truncated",
      }),
      ["输出开头", "输出结尾", "输出已截断", "上游仅提供了部分内容"],
      ["完整输出", "运行时未提供"],
    ],
    [
      "unavailable",
      deepFreeze<ConversationCommandOutput>({
        retention: "unavailable",
        text: null,
        head: null,
        tail: null,
        reason: "not_available",
        truncated: false,
        truncationReason: null,
      }),
      ["运行时未提供可用的聚合输出"],
      ["完整输出", "输出开头", "输出结尾"],
    ],
  ])("renders the %s retention mode without inventing unavailable content", async (
    _retention,
    output,
    included,
    excluded,
  ) => {
    const command = execution({ output });
    const wrapper = mount(ChatCommandItem, {
      props: { item: item(command), execution: command },
    });
    await wrapper.get(".chat-timeline-item-shell__disclosure").trigger("click");

    for (const text of included) expect(wrapper.text()).toContain(text);
    for (const text of excluded) expect(wrapper.text()).not.toContain(text);
  });

  it("announces only the status summary while live output changes", async () => {
    const running = execution({
      status: "running",
      liveOutput: safeText("DELTA_CANARY_A"),
      output: null,
      durationMs: null,
      exitCode: null,
    });
    const wrapper = mount(ChatCommandItem, {
      props: { item: item(running), execution: running },
    });
    const disclosure = wrapper.get(".chat-timeline-item-shell__disclosure");
    const controlledId = disclosure.attributes("aria-controls");

    expect(disclosure.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find(`#${controlledId}`).exists()).toBe(true);
    expect(wrapper.get(".chat-command-item__status-announcement").text())
      .toBe("命令正在执行。");
    expect(wrapper.get(".chat-command-item__status-announcement").text())
      .not.toContain("DELTA_CANARY_A");

    const updated = execution({
      status: "running",
      liveOutput: safeText("DELTA_CANARY_B"),
      output: null,
      durationMs: null,
      exitCode: null,
    });
    await wrapper.setProps({ item: item(updated), execution: updated });
    expect(wrapper.text()).toContain("DELTA_CANARY_B");
    expect(wrapper.get(".chat-command-item__status-announcement").text())
      .toBe("命令正在执行。");
  });

  it("is accessible and keeps rendering, layout and execution authority closed", async () => {
    const command = execution({
      commandSummary: safeText("安全摘要", true),
      output: deepFreeze({
        retention: "head_tail",
        text: null,
        head: "头部输出",
        tail: "尾部输出",
        reason: null,
        truncated: true,
        truncationReason: "utf8_byte_limit",
      }),
      error: { code: "command_failed", summary: "命令返回失败状态" },
      status: "failed",
    });
    const wrapper = mount(ChatCommandItem, {
      attachTo: document.body,
      props: { item: item(command), execution: command },
    });
    await wrapper.get(".chat-timeline-item-shell__disclosure").trigger("click");
    expect((await axe.run(wrapper.element)).violations).toEqual([]);
    wrapper.unmount();

    const sourceText = readFileSync("src/components/chat/ChatCommandItem.vue", "utf8");
    expect(sourceText).not.toMatch(/rawCommand|v-html|innerHTML|fetch\(|invoke\(|@tauri-apps|console\./i);
    expect(sourceText).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(sourceText).toContain("browserChatClipboardAdapter");
    expect(sourceText).toContain('aria-live="polite"');
    expect(sourceText).toContain("max-width: 100%");
    expect(sourceText).toContain("overflow-wrap: anywhere");
    expect(sourceText).toContain("@media (max-width: 40rem)");
  });
});
