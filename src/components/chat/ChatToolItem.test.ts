// @vitest-environment happy-dom

import axe from "axe-core";
import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ConversationSafeText,
  ConversationSourceFact,
  ConversationToolExecution,
  ConversationToolProgress,
} from "../../domain/conversation-state";
import type { ConversationTimelineItemViewModel } from "../../domain/conversation-timeline";
import ChatToolItem from "./ChatToolItem.vue";

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

function safeText(text: string, truncated = false): ConversationSafeText {
  return deepFreeze({
    text,
    truncated,
    truncationReason: truncated ? "upstream_truncated" : null,
  });
}

function progress(index: number, text: string): ConversationToolProgress {
  return deepFreeze({
    ...source(String(index + 2)),
    progressIndex: index,
    summary: safeText(text),
  });
}

function execution(
  overrides: Partial<ConversationToolExecution> = {},
): ConversationToolExecution {
  return deepFreeze({
    kind: "tool",
    status: "completed",
    startedSource: source(),
    lastSource: source("5"),
    identity: { resolution: "known", serverName: "workspace", toolName: "inspect" },
    argumentsSummary: safeText("读取当前工作区状态"),
    progress: [],
    durationMs: 800,
    resultSummary: safeText("工作区状态可用"),
    error: null,
    ...overrides,
  });
}

function item(tool: ConversationToolExecution): ConversationTimelineItemViewModel {
  const active = tool.status === "in_progress";
  const incomplete = tool.status === "incomplete";
  return deepFreeze({
    identity: "timeline-tool-demo",
    threadId: "thread-demo",
    turnId: "turn-demo",
    itemId: "tool-demo",
    ordinal: 0,
    kind: "tool",
    presentation: "tool",
    role: "process",
    domainStatus: active ? "streaming" : incomplete ? "incomplete" : "completed",
    phase: active ? "active" : incomplete ? "incomplete" : "complete",
    assistantPhase: null,
    reasoning: null,
    execution: tool,
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

describe("ChatToolItem", () => {
  it.each([
    ["in_progress" as const, "执行中", true],
    ["completed" as const, "已完成", false],
    ["failed" as const, "调用失败", false],
    ["declined" as const, "已拒绝", false],
    ["incomplete" as const, "未完整结束", false],
  ])("renders %s with status text, an icon, and the correct initial disclosure", (
    status,
    label,
    expanded,
  ) => {
    const tool = execution({
      status,
      durationMs: status === "in_progress" ? null : 800,
      resultSummary: status === "in_progress" ? null : safeText("完成"),
    });
    const wrapper = mount(ChatToolItem, { props: { item: item(tool), execution: tool } });

    const disclosure = wrapper.get(".chat-timeline-item-shell__disclosure");
    const visibleStatus = wrapper.get(".chat-timeline-item-shell__status");
    expect(disclosure.attributes("aria-expanded")).toBe(String(expanded));
    expect(disclosure.attributes("type")).toBe("button");
    expect(visibleStatus.text()).toBe(label);
    expect(visibleStatus.find("svg").exists()).toBe(true);
    expect(wrapper.find(".chat-tool-item__details").exists()).toBe(expanded);
  });

  it("keeps unknown identity inside the Tool renderer and exposes the capability gap", async () => {
    const unknown = execution({
      identity: { resolution: "unknown", serverName: "unknown", toolName: "unknown" },
      resultSummary: safeText(""),
    });
    const wrapper = mount(ChatToolItem, {
      props: { item: item(unknown), execution: unknown },
    });
    await wrapper.get(".chat-timeline-item-shell__disclosure").trigger("click");

    expect(wrapper.text()).toContain("工具调用");
    expect(wrapper.text()).toContain("未知工具");
    expect(wrapper.text()).toContain("工具身份尚未解析");
    expect(wrapper.text()).toContain("工具返回的结果摘要为空");
    expect(wrapper.text()).toContain("真实工具能力仍待生产方确认");
    expect(wrapper.text()).not.toContain("unsupported_content");
    expect(wrapper.text()).not.toContain("unsupported_execution");
  });

  it("renders known identity, arguments, ordered progress, result, error, duration and safe copy", async () => {
    const writeText = vi.fn<(_: string) => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const failed = execution({
      status: "failed",
      identity: { resolution: "known", serverName: "files", toolName: "inspect_metadata" },
      argumentsSummary: safeText("文件名与只读选项", true),
      progress: [progress(0, "已解析参数"), progress(1, "已读取元数据")],
      resultSummary: safeText("返回安全元数据摘要", true),
      durationMs: 2_400,
      error: { code: "tool_failed", summary: "工具返回失败状态" },
    });
    const wrapper = mount(ChatToolItem, {
      props: { item: item(failed), execution: failed },
    });
    await wrapper.get(".chat-timeline-item-shell__disclosure").trigger("click");

    expect(wrapper.text()).toContain("files · inspect_metadata");
    expect(wrapper.text()).toContain("文件名与只读选项");
    expect(wrapper.findAll(".chat-tool-item__progress li").map((entry) => entry.text()))
      .toEqual(["步骤 1已解析参数", "步骤 2已读取元数据"]);
    expect(wrapper.text()).toContain("返回安全元数据摘要");
    expect(wrapper.text()).toContain("工具返回失败状态");
    expect(wrapper.text()).toContain("tool_failed");
    expect(wrapper.text()).toContain("2.4 秒");
    expect(wrapper.text()).toContain("上游仅提供了部分内容");

    const copyButtons = wrapper.findAll(".chat-copy-action__button");
    expect(copyButtons).toHaveLength(2);
    await copyButtons[0]!.trigger("click");
    await flushPromises();
    await copyButtons[1]!.trigger("click");
    await flushPromises();
    expect(writeText.mock.calls).toEqual([
      ["文件名与只读选项"],
      ["返回安全元数据摘要"],
    ]);
  });

  it("announces only the stable status instead of every progress delta", async () => {
    const running = execution({
      status: "in_progress",
      progress: [progress(0, "PROGRESS_DELTA_A")],
      durationMs: null,
      resultSummary: null,
    });
    const wrapper = mount(ChatToolItem, {
      props: { item: item(running), execution: running },
    });

    const disclosure = wrapper.get(".chat-timeline-item-shell__disclosure");
    const controlledId = disclosure.attributes("aria-controls");
    expect(disclosure.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find(`#${controlledId}`).exists()).toBe(true);
    expect(wrapper.get(".chat-tool-item__status-announcement").text())
      .toBe("工具正在执行。");
    expect(wrapper.get(".chat-tool-item__status-announcement").text())
      .not.toContain("PROGRESS_DELTA_A");

    const updated = execution({
      status: "in_progress",
      progress: [progress(0, "PROGRESS_DELTA_B")],
      durationMs: null,
      resultSummary: null,
    });
    await wrapper.setProps({ item: item(updated), execution: updated });
    expect(wrapper.text()).toContain("PROGRESS_DELTA_B");
    expect(wrapper.get(".chat-tool-item__status-announcement").text())
      .toBe("工具正在执行。");
  });

  it("is accessible and keeps rendering, layout and producer authority closed", async () => {
    const tool = execution({
      status: "in_progress",
      progress: [progress(0, "正在读取状态")],
      durationMs: null,
      resultSummary: null,
    });
    const wrapper = mount(ChatToolItem, {
      attachTo: document.body,
      props: { item: item(tool), execution: tool },
    });
    expect((await axe.run(wrapper.element)).violations).toEqual([]);
    wrapper.unmount();

    const sourceText = readFileSync("src/components/chat/ChatToolItem.vue", "utf8");
    expect(sourceText).not.toMatch(/v-html|innerHTML|fetch\(|invoke\(|@tauri-apps|console\./i);
    expect(sourceText).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(sourceText).toContain("browserChatClipboardAdapter");
    expect(sourceText).toContain('aria-live="polite"');
    expect(sourceText).toContain("min-width: 0");
    expect(sourceText).toContain("overflow-wrap: anywhere");
    expect(sourceText).toContain("@media (max-width: 40rem)");
  });
});
