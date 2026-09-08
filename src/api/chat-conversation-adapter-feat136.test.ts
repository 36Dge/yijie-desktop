import { describe,expect,it } from "vitest";
import {
type ChatHistoryPageV5
} from "../domain/chat-ipc";
import {
selectConversationItem,
viewFromLegacySnapshot
} from "../domain/conversation-view";
import {
historyPageV5ToConversationSnapshot
} from "./chat-conversation-adapter";

const SESSION_ID = "019fbf59-3000-7000-8000-000000000002";
const TURN_ID = "019fbf59-3000-7000-8000-000000000003";
const LEGACY_TURN_ID = "019fbf59-3000-7000-8000-000000000005";
const V4_TURN_ID = "019fbf59-3000-7000-8000-000000000006";

function source(sequence: number) {
  return Object.freeze({
    sourceEventId: `019fbf59-3000-7000-8000-${String(100 + sequence).padStart(12, "0")}`,
    sourceSequence: String(sequence),
    sourceOccurredAt: "2026-08-29T08:00:00Z",
  });
}

const commandSummary = Object.freeze({
  text: "Inspect repository status",
  truncated: false,
  truncationReason: null,
});
const cwd = Object.freeze({ kind: "workspace_root" as const, segments: Object.freeze([]) });

describe("FEAT-136 v5 conversation adapter", () => {

  it("hydrates mixed legacy/v4/v5 authority without disguising older Turns", () => {
    const page: ChatHistoryPageV5 = Object.freeze({
      schemaVersion: 5,
      turns: Object.freeze([Object.freeze({
        turnId: LEGACY_TURN_ID,
        status: "completed",
        terminalAt: 1,
        reasoningStatus: "complete",
        reasoningReasonCode: null,
        messages: Object.freeze([Object.freeze({
          messageId: "019fbf59-3000-7000-8000-000000000020",
          role: "assistant",
          content: "legacy final",
          contentBlocks: Object.freeze([Object.freeze({ type: "text", text: "legacy final" })]),
          status: "completed",
          ordinal: 0,
          createdAt: 1,
        })]),
        reasoning: Object.freeze([]),
        projectionAuthority: "legacy",
        artifacts: Object.freeze([]),
        terminalCode: null,
        timelineItems: Object.freeze([]),
        plan: null,
        notices: Object.freeze([]),
      }), Object.freeze({
        turnId: V4_TURN_ID,
        status: "completed",
        terminalAt: 2,
        reasoningStatus: "unavailable",
        reasoningReasonCode: "reasoning_not_emitted",
        messages: Object.freeze([]),
        reasoning: Object.freeze([]),
        projectionAuthority: "v4",
        artifacts: Object.freeze([]),
        terminalCode: null,
        timelineItems: Object.freeze([Object.freeze({
          ...source(2),
          itemId: "v4-final",
          itemOrdinal: 1,
          itemType: "agentMessage",
          phase: "final_answer",
          status: "completed",
          text: "v4 final",
          reasoningStatus: null,
          reasoningReasonCode: null,
          reasoningParts: Object.freeze([]),
          startedAtMs: 1,
          completedAtMs: 2,
        })]),
        plan: null,
        notices: Object.freeze([]),
      }), Object.freeze({
        turnId: TURN_ID,
        status: "streaming",
        terminalAt: null,
        reasoningStatus: "pending",
        reasoningReasonCode: null,
        messages: Object.freeze([]),
        reasoning: Object.freeze([]),
        projectionAuthority: "v5",
        artifacts: Object.freeze([]),
        terminalCode: null,
        timelineItems: Object.freeze([Object.freeze({
          ...source(3),
          itemId: "command-history",
          itemOrdinal: 1,
          itemType: "command",
          phase: null,
          status: "completed",
          text: "",
          reasoningStatus: null,
          reasoningReasonCode: null,
          reasoningParts: Object.freeze([]),
          startedAtMs: 1,
          completedAtMs: 2,
          execution: Object.freeze({
            kind: "command",
            status: "failed",
            startedSource: source(1),
            lastSource: source(3),
            commandSummary,
            cwd,
            liveOutput: Object.freeze({
              text: "partial output\n",
              truncated: false,
              truncationReason: null,
            }),
            output: Object.freeze({
              retention: "unavailable",
              text: null,
              head: null,
              tail: null,
              reason: "not_available",
              truncated: false,
              truncationReason: null,
            }),
            durationMs: 4,
            exitCode: 1,
            error: Object.freeze({ code: "command_failed", summary: "non-zero status" }),
          }),
        })]),
        plan: null,
        notices: Object.freeze([]),
      })]),
      nextCursor: null,
      sessionNotices: Object.freeze([]),
      durableSequenceCut: "3",
    });
    const snapshot = historyPageV5ToConversationSnapshot(SESSION_ID, page);
    const state = viewFromLegacySnapshot(snapshot);

    expect(snapshot.schemaVersion).toBe(3);
    expect(state.schemaVersion).toBe(3);
    expect(selectConversationItem(
      state,
      SESSION_ID,
      LEGACY_TURN_ID,
      `${LEGACY_TURN_ID}:assistant:0`,
    )).toMatchObject({
      kind: "assistant_message",
      contentBlocks: [{ text: "legacy final" }],
    });
    expect(selectConversationItem(state, SESSION_ID, V4_TURN_ID, "v4-final"))
      .toMatchObject({
        kind: "assistant_message",
        execution: null,
        contentBlocks: [{ text: "v4 final" }],
      });
    expect(selectConversationItem(state, SESSION_ID, TURN_ID, "command-history")?.execution)
      .toMatchObject({
        kind: "command",
        status: "failed",
        output: { retention: "unavailable", reason: "not_available" },
      });
  });
});
