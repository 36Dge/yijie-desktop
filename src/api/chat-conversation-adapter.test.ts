import { describe,expect,it } from "vitest";
import type { ChatHistoryPage } from "../domain/chat-ipc";
import {
selectConversationItem,
selectConversationTurn,
viewFromLegacySnapshot
} from "../domain/conversation-view";
import {
conversationArtifactItemId,
conversationMessageItemId,
conversationReasoningItemId,
historyPageToConversationSnapshot
} from "./chat-conversation-adapter";

const SESSION_ID = "019c1a00-0000-7000-8000-000000000002";
const TURN_ID = "019c1a00-0000-7000-8000-000000000003";

function history(): ChatHistoryPage {
  return Object.freeze({
    turns: Object.freeze([Object.freeze({
      turnId: TURN_ID,
      status: "completed",
      terminalAt: 2,
      reasoningStatus: "complete",
      reasoningReasonCode: null,
      messages: Object.freeze([
        Object.freeze({
          messageId: "019c1a00-0000-7000-8000-000000000011",
          role: "user" as const,
          content: "hello",
          contentBlocks: Object.freeze([
            Object.freeze({ type: "text" as const, text: "hello" }),
            Object.freeze({
              attachmentId: "019c1a00-0000-7000-8000-000000000012",
              type: "file" as const,
              name: "synthetic.txt",
              mediaType: "text/plain" as const,
              sizeBytes: 5,
              status: "bound" as const,
              expiresAt: 100,
            }),
          ]),
          status: "committed",
          ordinal: 0,
          createdAt: 1,
        }),
        Object.freeze({
          messageId: "019c1a00-0000-7000-8000-000000000013",
          role: "assistant" as const,
          content: "answer",
          contentBlocks: Object.freeze([Object.freeze({ type: "text" as const, text: "answer" })]),
          status: "committed",
          ordinal: 1,
          createdAt: 2,
        }),
      ]),
      reasoning: Object.freeze([Object.freeze({
        itemOrdinal: 0,
        status: "complete" as const,
        reasonCode: null,
        totalBytes: 4,
        partCount: 1,
        finalizedAtMs: 2_000,
      })]),
      artifacts: Object.freeze([Object.freeze({
        artifactId: "019c1a00-0000-7000-8000-000000000014",
        kind: "report" as const,
        provenance: "synthetic" as const,
        status: "ready" as const,
        ordinal: 0,
        progressStage: null,
        progressPercent: null,
        displayName: "Synthetic report",
        mediaType: "application/pdf",
        sizeBytes: 10,
        localCommittedAt: 2,
        expiresAt: 100,
        hasPoster: false,
        errorCode: null,
        retryable: null,
      })]),
    })]),
    nextCursor: null,
  });
}

describe("FEAT-132 chat conversation adapters", () => {
  it("hydrates messages, attachment, reasoning metadata, and artifact into stable local items", () => {
    const state = viewFromLegacySnapshot(historyPageToConversationSnapshot(SESSION_ID, history()));

    expect(selectConversationTurn(state, SESSION_ID, TURN_ID)).toMatchObject({
      status: "completed",
      terminalStatus: "completed",
    });
    expect(selectConversationItem(
      state,
      SESSION_ID,
      TURN_ID,
      conversationMessageItemId(TURN_ID, "user"),
    )?.contentBlocks).toEqual([
      { blockIndex: 0, type: "text", text: "hello" },
      expect.objectContaining({
        blockIndex: 1,
        type: "attachment_reference",
        attachmentId: "019c1a00-0000-7000-8000-000000000012",
      }),
    ]);
    expect(selectConversationItem(
      state,
      SESSION_ID,
      TURN_ID,
      conversationReasoningItemId(TURN_ID, 0),
    )?.kind).toBe("reasoning");
    expect(selectConversationItem(
      state,
      SESSION_ID,
      TURN_ID,
      conversationArtifactItemId(TURN_ID, "019c1a00-0000-7000-8000-000000000014"),
    )?.kind).toBe("artifact");
  });
});
