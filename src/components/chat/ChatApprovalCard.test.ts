// @vitest-environment happy-dom

import axe from "axe-core";
import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatApprovalCard, {
  type ChatApprovalCardStatus,
  type ChatApprovalDecision,
} from "./ChatApprovalCard.vue";

const EXPIRES_AT = "2099-08-30T14:30:00.000Z";
const APPROVAL_REQUEST_ID = "66666666-6666-4666-8666-666666666666";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("ChatApprovalCard", () => {
  it("disables decisions exactly at expiresAt without inventing an expired lifecycle", async () => {
    const boundary = Date.parse("2026-08-30T14:30:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(boundary - 1);
    const wrapper = mount(ChatApprovalCard, {
      props: {
        approvalRequestId: APPROVAL_REQUEST_ID,
        status: "pending",
        expiresAt: "2026-08-30T14:30:00.000Z",
        actionable: true,
      },
    });
    const decisions = wrapper.findAll(".chat-approval-card__button");
    expect(decisions.every((button) => button.attributes("disabled") === undefined)).toBe(true);

    await vi.advanceTimersByTimeAsync(1);

    expect(decisions.every((button) => button.attributes("disabled") !== undefined)).toBe(true);
    expect(wrapper.get(".chat-approval-card__status").text()).toContain("等待确认");
    expect(wrapper.text()).not.toContain("确认已过期");
    await decisions[0]!.trigger("click");
    expect(wrapper.emitted("decision")).toBeUndefined();
    wrapper.unmount();
  });

  it.each<readonly [ChatApprovalCardStatus, string, string, boolean]>([
    ["pending", "等待确认", "等待你的确认", true],
    ["submitting", "正在提交", "等待 Host 和 Runtime", false],
    ["reconciling", "正在核对", "操作保持禁用", false],
    ["accepted", "已允许一次", "命令结果仍以执行终态为准", false],
    ["cancelled", "已取消本轮", "当前轮将按权威终态结束", false],
    ["expired", "确认已过期", "不可再用", false],
    ["resolved_elsewhere", "已由运行状态解决", "不可再操作", false],
    ["disconnected", "连接已中断", "操作保持禁用", false],
    ["error", "暂时无法确认", "核对最新状态", false],
  ])("renders the closed %s state with text, icon, and fail-safe actions", (
    status,
    label,
    summary,
    actionable,
  ) => {
    const wrapper = mount(ChatApprovalCard, {
      props: {
        approvalRequestId: APPROVAL_REQUEST_ID,
        status,
        expiresAt: EXPIRES_AT,
        actionable,
      },
    });

    expect(wrapper.get(".chat-approval-card__status").text()).toContain(label);
    expect(wrapper.get(".chat-approval-card__status svg").attributes("aria-hidden")).toBe("true");
    expect(wrapper.get(".chat-approval-card__state").text()).toContain(summary);
    const announcement = wrapper.get(".chat-approval-card__announcement");
    expect(announcement.text()).toContain(summary);
    expect(announcement.attributes("aria-live")).toBe("polite");
    expect(wrapper.get("section").attributes("aria-busy"))
      .toBe(String(status === "submitting" || status === "reconciling"));

    const decisions = wrapper.findAll(".chat-approval-card__button");
    expect(decisions.map((button) => button.text())).toEqual(["允许一次", "取消本轮"]);
    expect(decisions.every((button) => button.attributes("type") === "button")).toBe(true);
    expect(decisions.every((button) => button.attributes("disabled") !== undefined))
      .toBe(!actionable);
  });

  it.each<readonly [string, ChatApprovalDecision]>([
    ["允许一次", "accept_once"],
    ["取消本轮", "cancel_current_turn"],
  ])("emits only the typed decision for %s and locks duplicate activation", async (
    label,
    decision,
  ) => {
    const wrapper = mount(ChatApprovalCard, {
      attachTo: document.body,
      props: {
        approvalRequestId: APPROVAL_REQUEST_ID,
        status: "pending",
        expiresAt: EXPIRES_AT,
        actionable: true,
        authorityRevision: 1,
      },
    });
    const button = wrapper.findAll(".chat-approval-card__button")
      .find((candidate) => candidate.text() === label);
    if (button === undefined) throw new Error("fixture_missing_decision_button");
    (button.element as HTMLButtonElement).focus();

    await button.trigger("click", { detail: 0 });
    await button.trigger("click", { detail: 0 });

    expect(wrapper.emitted("decision")).toEqual([[{
      approvalRequestId: APPROVAL_REQUEST_ID,
      decision,
    }]]);
    expect(document.activeElement).toBe(button.element);
    expect(wrapper.findAll(".chat-approval-card__button")
      .every((candidate) => candidate.attributes("disabled") !== undefined)).toBe(true);
    wrapper.unmount();
  });

  it("unlocks only after fresh parent authority, including the same pending request", async () => {
    const wrapper = mount(ChatApprovalCard, {
      props: {
        approvalRequestId: APPROVAL_REQUEST_ID,
        status: "pending",
        expiresAt: EXPIRES_AT,
        actionable: true,
      },
    });
    const accept = wrapper.findAll(".chat-approval-card__button")[0]!;
    await accept.trigger("click");
    expect(accept.attributes("disabled")).toBeDefined();

    await wrapper.setProps({ status: "reconciling", actionable: false });
    await wrapper.setProps({
      status: "pending",
      actionable: true,
      authorityRevision: 2,
    });
    expect(accept.attributes("disabled")).toBeUndefined();
    await accept.trigger("click");
    expect(wrapper.emitted("decision")).toHaveLength(2);

    const replacementId = "77777777-7777-4777-8777-777777777777";
    await wrapper.setProps({ approvalRequestId: replacementId });
    expect(accept.attributes("disabled")).toBeUndefined();
    await accept.trigger("click");
    expect(wrapper.emitted("decision")).toEqual([
      [{ approvalRequestId: APPROVAL_REQUEST_ID, decision: "accept_once" }],
      [{ approvalRequestId: APPROVAL_REQUEST_ID, decision: "accept_once" }],
      [{ approvalRequestId: replacementId, decision: "accept_once" }],
    ]);
  });

  it("keeps a pending projection disabled until live snapshot authority is explicit", async () => {
    const wrapper = mount(ChatApprovalCard, {
      props: {
        approvalRequestId: APPROVAL_REQUEST_ID,
        status: "pending",
        expiresAt: EXPIRES_AT,
      },
    });
    const buttons = wrapper.findAll(".chat-approval-card__button");
    expect(buttons.every((button) => button.attributes("disabled") !== undefined)).toBe(true);
    await buttons[0]!.trigger("click");
    expect(wrapper.emitted("decision")).toBeUndefined();

    await wrapper.setProps({ actionable: true });
    expect(buttons.every((button) => button.attributes("disabled") === undefined)).toBe(true);
  });

  it("moves contained focus to the stable card only after authority resolves", async () => {
    const external = document.createElement("button");
    external.textContent = "外部稳定焦点";
    document.body.append(external);
    const wrapper = mount(ChatApprovalCard, {
      attachTo: document.body,
      props: {
        approvalRequestId: APPROVAL_REQUEST_ID,
        status: "pending",
        expiresAt: EXPIRES_AT,
        actionable: true,
      },
    });
    const accept = wrapper.findAll(".chat-approval-card__button")[0]!;
    (accept.element as HTMLButtonElement).focus();
    await wrapper.setProps({ status: "submitting" });
    expect(document.activeElement).toBe(accept.element);
    await wrapper.setProps({ status: "accepted" });
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get("section").element);

    external.focus();
    await wrapper.setProps({ status: "disconnected" });
    await wrapper.setProps({ status: "pending" });
    expect(document.activeElement).toBe(external);
    wrapper.unmount();
  });

  it("copies only the fixed safe projection and never copies Runtime authority", async () => {
    const writeText = vi.fn<(_: string) => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const wrapper = mount(ChatApprovalCard, {
      props: {
        approvalRequestId: APPROVAL_REQUEST_ID,
        status: "pending",
        expiresAt: EXPIRES_AT,
        errorCode: "unknown",
      },
      attrs: {
        rawCommand: "RAW_COMMAND_CANARY --token=private",
        cwd: "/Users/private/workspace",
        runtimeWire: "RUNTIME_WIRE_CANARY",
      },
    });

    expect(wrapper.text()).toContain("检查当前工作区是否为 Git 仓库");
    expect(wrapper.text()).toContain("不会修改文件");
    expect(wrapper.text()).toContain("不会访问网络");
    expect(wrapper.text()).toContain("取消本轮”会停止当前轮");
    expect(wrapper.text()).not.toContain("RAW_COMMAND_CANARY");
    expect(wrapper.text()).not.toContain("/Users/private/workspace");
    expect(wrapper.html()).not.toContain("RUNTIME_WIRE_CANARY");

    await wrapper.get("button[aria-label='复制文本']").trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledOnce();
    const copied = writeText.mock.calls[0]?.[0] ?? "";
    expect(copied).toContain("确认操作：检查当前工作区是否为 Git 仓库");
    expect(copied).toContain("影响范围：当前工作区");
    expect(copied).toContain("状态：等待确认");
    expect(copied).toContain("有效期至：");
    expect(copied).not.toMatch(/git rev-parse|\/Users\/|token|Runtime/i);
  });

  it.each([
    ["approval_version_mismatch" as const, "请更新应用"],
    ["unauthorized" as const, "当前身份无法确认"],
    ["approval_expired" as const, "确认已经过期"],
    ["approval_decision_conflict" as const, "状态已经变化"],
    ["invalid_approval_request" as const, "请求无效"],
    ["approval_unavailable" as const, "等待连接恢复"],
  ])("maps stable error %s to a safe recovery message", (errorCode, expected) => {
    const wrapper = mount(ChatApprovalCard, {
      props: {
        approvalRequestId: APPROVAL_REQUEST_ID,
        status: "error",
        expiresAt: EXPIRES_AT,
        errorCode,
      },
    });
    expect(wrapper.get(".chat-approval-card__state").text()).toContain(expected);
    expect(wrapper.text()).not.toContain(errorCode);
  });

  it("fails soft for an invalid expiry without inventing a countdown", () => {
    const wrapper = mount(ChatApprovalCard, {
      props: {
        approvalRequestId: APPROVAL_REQUEST_ID,
        status: "pending",
        expiresAt: "INVALID_PRIVATE_TIME",
      },
    });
    expect(wrapper.text()).toContain("有效时间不可用");
    expect(wrapper.find("time").exists()).toBe(false);
    expect(wrapper.html()).not.toContain("INVALID_PRIVATE_TIME");
  });

  it("is accessible and stays presentation-only, responsive, and token based", async () => {
    for (const status of ["pending", "disconnected", "error"] as const) {
      const wrapper = mount(ChatApprovalCard, {
        attachTo: document.body,
        props: {
          approvalRequestId: APPROVAL_REQUEST_ID,
          status,
          expiresAt: EXPIRES_AT,
          errorCode: "approval_unavailable",
        },
      });
      expect((await axe.run(wrapper.element)).violations).toEqual([]);
      wrapper.unmount();
    }

    const source = readFileSync("src/components/chat/ChatApprovalCard.vue", "utf8");
    expect(source).not.toMatch(/v-html|innerHTML|fetch\(|invoke\(|@tauri-apps|router|store|console\./i);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).toContain("browserChatClipboardAdapter");
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain(":focus-visible");
    expect(source).toContain("max-width: 100%");
    expect(source).toContain("overflow-wrap: anywhere");
    expect(source).toContain("@media (max-width: 40rem)");
  });
});
