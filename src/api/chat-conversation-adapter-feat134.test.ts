import { describe,expect,it } from "vitest";
import type {
ChatHistoryPageV4,
ChatTimelineItemV4
} from "../domain/chat-ipc";
import {
selectConversationItem,
viewFromLegacySnapshot
} from "../domain/conversation-view";
import {
conversationMessageItemId,
historyPageV4ToConversationSnapshot
} from "./chat-conversation-adapter";

const SESSION_ID = "019fbf58-0000-7000-8000-000000000002";
const TURN_ID = "019fbf58-0000-7000-8000-000000000003";

function source(sequence: number) {
  return {
    sourceEventId: `source-event-${sequence}`,
    sourceSequence: String(sequence),
    sourceOccurredAt: "2026-08-28T00:00:00Z",
  } as const;
}

function timelineItem(
  overrides: Partial<ChatTimelineItemV4> & Pick<ChatTimelineItemV4, "itemId" | "itemOrdinal" | "itemType">,
): ChatTimelineItemV4 {
  return {
    ...source(overrides.itemOrdinal + 10),
    phase: null,
    status: "completed",
    text: "",
    reasoningStatus: null,
    reasoningReasonCode: null,
    reasoningParts: [],
    startedAtMs: 1,
    completedAtMs: 2,
    ...overrides,
  };
}

describe("FEAT-134 private projection conversation adapter", () => {

  it("preserves pre-v4 assistant history only when no timeline AgentMessage authority exists", () => {
    const legacyPage: ChatHistoryPageV4 = {
      turns: [{
        turnId: TURN_ID,
        projectionAuthority: "legacy",
        status: "completed",
        terminalAt: 2,
        reasoningStatus: "unavailable",
        reasoningReasonCode: "reasoning_not_emitted",
        messages: [{
          messageId: "019fbf58-0000-7000-8000-000000000021",
          role: "assistant",
          content: "legacy answer",
          contentBlocks: [{ type: "text", text: "legacy answer" }],
          status: "committed",
          ordinal: 0,
          createdAt: 1,
        }],
        reasoning: [],
        artifacts: [],
        terminalCode: null,
        timelineItems: [],
        plan: null,
        notices: [],
      }],
      nextCursor: null,
      sessionNotices: [],
      durableSequenceCut: "0",
    };
    const legacy = viewFromLegacySnapshot(
      historyPageV4ToConversationSnapshot(SESSION_ID, legacyPage),
    );
    expect(selectConversationItem(
      legacy,
      SESSION_ID,
      TURN_ID,
      conversationMessageItemId(TURN_ID, "assistant"),
    )).toMatchObject({
      agentMessagePhase: "final_answer",
      contentBlocks: [{ text: "legacy answer" }],
    });

    const withV4Authority = viewFromLegacySnapshot(historyPageV4ToConversationSnapshot(
      SESSION_ID,
      {
        ...legacyPage,
        turns: [{
          ...legacyPage.turns[0]!,
          projectionAuthority: "v4",
          timelineItems: [timelineItem({
            itemId: "v4-final",
            itemOrdinal: 1,
            itemType: "agentMessage",
            phase: "final_answer",
            text: "v4 answer",
          })],
        }],
      },
    ));
    expect(selectConversationItem(
      withV4Authority,
      SESSION_ID,
      TURN_ID,
      conversationMessageItemId(TURN_ID, "assistant"),
    )).toBeNull();
    expect(selectConversationItem(withV4Authority, SESSION_ID, TURN_ID, "v4-final"))
      .toMatchObject({ contentBlocks: [{ text: "v4 answer" }] });
  });

  it("does not project the active legacy pending assistant scaffold as a final answer", () => {
    const activePage: ChatHistoryPageV4 = {
      turns: [{
        turnId: TURN_ID,
        projectionAuthority: "legacy",
        status: "streaming",
        terminalAt: null,
        reasoningStatus: "pending",
        reasoningReasonCode: null,
        messages: [
          {
            messageId: "019fbf58-0000-7000-8000-000000000031",
            role: "user",
            content: "request",
            contentBlocks: [{ type: "text", text: "request" }],
            status: "committed",
            ordinal: 0,
            createdAt: 1,
          },
          {
            messageId: "019fbf58-0000-7000-8000-000000000032",
            role: "assistant",
            content: "",
            contentBlocks: [{ type: "text", text: " " }],
            status: "pending",
            ordinal: 1,
            createdAt: 2,
          },
        ],
        reasoning: [],
        artifacts: [],
        terminalCode: null,
        timelineItems: [],
        plan: null,
        notices: [],
      }],
      nextCursor: null,
      sessionNotices: [],
      durableSequenceCut: "0",
    };
    const active = viewFromLegacySnapshot(
      historyPageV4ToConversationSnapshot(SESSION_ID, activePage),
    );
    expect(selectConversationItem(
      active,
      SESSION_ID,
      TURN_ID,
      conversationMessageItemId(TURN_ID, "assistant"),
    )).toBeNull();

    const partial = viewFromLegacySnapshot(historyPageV4ToConversationSnapshot(
      SESSION_ID,
      {
        ...activePage,
        turns: [{
          ...activePage.turns[0]!,
          messages: activePage.turns[0]!.messages.map((message) => message.role === "assistant"
            ? { ...message, content: "confirmed legacy partial", contentBlocks: [
                { type: "text" as const, text: "confirmed legacy partial" },
              ] }
            : message),
        }],
      },
    ));
    expect(selectConversationItem(
      partial,
      SESSION_ID,
      TURN_ID,
      conversationMessageItemId(TURN_ID, "assistant"),
    )).toMatchObject({ contentBlocks: [{ text: "confirmed legacy partial" }] });
  });
});
