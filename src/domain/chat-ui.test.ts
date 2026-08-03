import { describe, expect, it } from "vitest";
import type { ChatHistoryTurn, ChatLocalReadiness } from "./chat-ipc";
import {
  CHAT_BOTTOM_BUTTON_THRESHOLD_PX,
  CHAT_FOLLOW_THRESHOLD_PX,
  CHAT_INPUT_MAX_BYTES,
  cleanupNotice,
  errorNotice,
  inputValidationMessage,
  readinessNotice,
  reasoningStatusLabel,
  sortHistoryTurns,
  turnStatusLabel,
} from "./chat-ui";

function readiness(overrides: Partial<ChatLocalReadiness> = {}): ChatLocalReadiness {
  return {
    lifecycle: "ready",
    host: "ready",
    runtime: "ready",
    storage: "ready",
    canSend: true,
    issueCode: null,
    retryable: false,
    recovery: "none",
    ...overrides,
  };
}

function turn(turnId: string, ordinal: number): ChatHistoryTurn {
  return {
    turnId,
    status: "completed",
    terminalAt: 1,
    reasoningStatus: "complete",
    reasoningReasonCode: null,
    messages: [{
      messageId: `${turnId}-message`,
      role: "user",
      content: "synthetic",
      status: "complete",
      ordinal,
      createdAt: ordinal,
    }],
    reasoning: [],
  };
}

describe("FEAT-126 chat UI rules", () => {
  it("freezes the accepted scroll and input thresholds", () => {
    expect(CHAT_FOLLOW_THRESHOLD_PX).toBe(48);
    expect(CHAT_BOTTOM_BUTTON_THRESHOLD_PX).toBe(160);
    expect(CHAT_INPUT_MAX_BYTES).toBe(65_536);
  });

  it("maps every stable readiness issue to content-free Chinese recovery copy", () => {
    const issues = [
      "chat_host_starting",
      "chat_host_unavailable",
      "chat_runtime_starting",
      "chat_runtime_unavailable",
      "chat_runtime_version_mismatch",
      "chat_storage_read_only",
      "chat_storage_full",
      "chat_storage_corrupt",
      "chat_storage_migration_failed",
      "chat_storage_unavailable",
    ] as const;
    for (const issueCode of issues) {
      const notice = readinessNotice(readiness({ canSend: false, issueCode }));
      expect(notice.title.length).toBeGreaterThan(0);
      expect(notice.detail.length).toBeGreaterThan(0);
      expect(JSON.stringify(notice)).not.toMatch(/sql|token|bearer|\/private\//i);
    }
  });

  it("keeps corrupt and migration failures non-destructive", () => {
    expect(readinessNotice(readiness({ canSend: false, issueCode: "chat_storage_corrupt" })).actionLabel).toBeNull();
    expect(readinessNotice(readiness({ canSend: false, issueCode: "chat_storage_migration_failed" })).actionLabel).toBeNull();
  });

  it("rejects blank and over-cap text while preserving normal multiline text", () => {
    expect(inputValidationMessage("  \n")).toBe("请输入任务需求");
    expect(inputValidationMessage("A".repeat(CHAT_INPUT_MAX_BYTES))).toBeNull();
    expect(inputValidationMessage("界".repeat(22_000))).toContain("过长");
  });

  it("maps errors, turn and reasoning state without exposing raw detail", () => {
    expect(errorNotice("chat_capability_denied")?.title).toContain("无权");
    expect(errorNotice("unknown")).toBeNull();
    expect(turnStatusLabel("interrupted")).toBe("已停止");
    expect(reasoningStatusLabel("incomplete", "interrupted")).toContain("停止");
    expect(reasoningStatusLabel("unavailable", null)).toContain("不可用");
  });

  it("sorts paged history chronologically by authoritative message ordinal", () => {
    expect(sortHistoryTurns([turn("b", 10), turn("a", 2)]).map((item) => item.turnId)).toEqual(["a", "b"]);
  });

  it("does not claim deletion success before all three surfaces complete", () => {
    const base = {
      operationId: "019c1a00-0000-7000-8000-000000000001",
      desktopState: "complete" as const,
      hostState: "pending" as const,
      runtimeState: "pending" as const,
      outcomeCode: "pending",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    };
    expect(cleanupNotice(base)?.title).toContain("正在");
    expect(cleanupNotice({ ...base, hostState: "incomplete" })?.title).toContain("尚未完成");
    expect(cleanupNotice({ ...base, hostState: "complete", runtimeState: "complete" })?.title).toContain("已永久删除");
  });
});
