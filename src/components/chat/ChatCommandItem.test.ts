// @vitest-environment happy-dom

import { flushPromises,mount } from "@vue/test-utils";
import axe from "axe-core";
import { readFileSync } from "node:fs";
import { afterEach,describe,expect,it,vi } from "vitest";
import type { ConversationApproval } from "../../domain/conversation-approval";
import type { ConversationTimelineItemViewModel } from "../../domain/conversation-timeline";
import type {
ConversationLegacyCommandExecution,
ConversationCommandOutput,
ConversationSafeText,
ConversationSourceFact,
} from "../../domain/conversation-view";
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
  overrides: Partial<ConversationLegacyCommandExecution> = {},
): ConversationLegacyCommandExecution {
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

function approval(
  overrides: Partial<ConversationApproval> = {},
): ConversationApproval {
  return deepFreeze({
    approvalRequestId: "66666666-6666-4666-8666-666666666666",
    threadId: "thread-demo",
    turnId: "turn-demo",
    itemId: "command-demo",
    revision: 1,
    status: "pending",
    actionId: "git_repository_check",
    workspaceScope: "current_workspace",
    decisions: { primary: "accept_once", secondary: "cancel_current_turn" },
    requestedAt: "2026-08-30T14:28:00.000Z",
    expiresAt: "2026-08-30T14:30:00.000Z",
    resolvedAt: null,
    decisionId: null,
    decision: null,
    outcome: null,
    authority: "actionable",
    authorityStreamId: "55555555-5555-4555-8555-555555555555",
    source: {
      sourceEventId: "44444444-4444-4444-8444-444444444444",
      sourceSequence: "3",
      sourceOccurredAt: "2026-08-30T14:28:00.000Z",
    },
    ...overrides,
  });
}

function item(command: ConversationLegacyCommandExecution): ConversationTimelineItemViewModel {
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
  vi.useRealTimers();
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

  it("keeps actionable authority disabled until a decision bridge is explicit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-08-30T14:29:00.000Z"));
    const command = execution({ status: "running", output: null, durationMs: null, exitCode: null });
    const pending = approval();
    const wrapper = mount(ChatCommandItem, {
      props: { item: item(command), execution: command, approval: pending },
    });

    expect(wrapper.get(".chat-approval-card__status").text()).toContain("暂时无法确认");
    const buttons = wrapper.findAll(".chat-approval-card__button");
    expect(buttons.every((button) => button.attributes("disabled") !== undefined)).toBe(true);
    expect(wrapper.text()).not.toContain(pending.approvalRequestId);
    expect(wrapper.text()).not.toContain(pending.authorityStreamId);

    await wrapper.setProps({ canDecideApproval: true });
    expect(wrapper.get(".chat-approval-card__status").text()).toContain("等待确认");
    expect(buttons.every((button) => button.attributes("disabled") === undefined)).toBe(true);
    await buttons[0]!.trigger("click");
    await buttons[0]!.trigger("click");
    expect(wrapper.emitted("approval-decision")).toEqual([[{
      itemIdentity: "timeline-command-demo",
      threadId: "thread-demo",
      turnId: "turn-demo",
      itemId: "command-demo",
      approvalRequestId: pending.approvalRequestId,
      decision: "accept_once",
    }]]);
  });

  it.each([
    [approval({ authority: "historical", authorityStreamId: null }), null, "连接已中断"],
    [approval(), { phase: "submitting" as const, errorCode: null }, "正在提交"],
    [approval(), { phase: "reconciling" as const, errorCode: null }, "正在核对"],
    [approval(), { phase: "error" as const, errorCode: "approval_stale" as const }, "暂时无法确认"],
  ])("maps pending authority and transient state without fail-open", (
    pending,
    approvalTransient,
    label,
  ) => {
    const command = execution({ status: "running", output: null, durationMs: null, exitCode: null });
    const wrapper = mount(ChatCommandItem, {
      props: {
        item: item(command),
        execution: command,
        approval: pending,
        approvalTransient,
        canDecideApproval: true,
      },
    });
    expect(wrapper.get(".chat-approval-card__status").text()).toContain(label);
    expect(wrapper.findAll(".chat-approval-card__button")
      .every((button) => button.attributes("disabled") !== undefined)).toBe(true);
  });

  it.each([
    ["accepted_once" as const, "accept_once" as const, "已允许一次"],
    ["cancelled_current_turn" as const, "cancel_current_turn" as const, "已取消本轮"],
    ["expired" as const, null, "确认已过期"],
    ["resolved_elsewhere" as const, null, "已由运行状态解决"],
  ])("renders resolved outcome %s as read-only", (outcome, decision, label) => {
    const command = execution();
    const resolved = approval({
      revision: 2,
      status: "resolved",
      resolvedAt: "2026-08-30T14:29:00.000Z",
      decisionId: decision === null ? null : "77777777-7777-4777-8777-777777777777",
      decision,
      outcome,
      authority: "historical",
      authorityStreamId: null,
    });
    const wrapper = mount(ChatCommandItem, {
      props: {
        item: item(command),
        execution: command,
        approval: resolved,
        canDecideApproval: true,
      },
    });
    expect(wrapper.find(".chat-approval-card").exists()).toBe(false);
    return wrapper.get(".chat-timeline-item-shell__disclosure").trigger("click").then(() => {
      expect(wrapper.get(".chat-approval-card__status").text()).toContain(label);
      expect(wrapper.findAll(".chat-approval-card__button")
        .every((button) => button.attributes("disabled") !== undefined)).toBe(true);
    });
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
