import { describe, expect, it } from "vitest";
import {
  parseChatProjectionEventV5,
  type ChatHistoryPageV5,
  type ChatProjectionEventV5,
} from "../domain/chat-ipc";
import {
  createConversationState,
  hydrateConversationState,
  reduceConversationEvent,
  selectConversationItem,
} from "../domain/conversation-state";
import {
  historyPageV5ToConversationSnapshot,
  projectionEventToConversation,
} from "./chat-conversation-adapter";

const CONTEXT_ID = "019fbf59-3000-7000-8000-000000000001";
const SESSION_ID = "019fbf59-3000-7000-8000-000000000002";
const TURN_ID = "019fbf59-3000-7000-8000-000000000003";
const SUBSCRIPTION_ID = "019fbf59-3000-7000-8000-000000000004";
const LEGACY_TURN_ID = "019fbf59-3000-7000-8000-000000000005";
const V4_TURN_ID = "019fbf59-3000-7000-8000-000000000006";

function source(sequence: number) {
  return Object.freeze({
    sourceEventId: `019fbf59-3000-7000-8000-${String(100 + sequence).padStart(12, "0")}`,
    sourceSequence: String(sequence),
    sourceOccurredAt: "2026-08-29T08:00:00Z",
  });
}

function event(
  sequence: number,
  kind: ChatProjectionEventV5["kind"],
  payload: ChatProjectionEventV5["payload"],
): ChatProjectionEventV5 {
  return {
    schemaVersion: 5,
    subscriptionId: SUBSCRIPTION_ID,
    contextId: CONTEXT_ID,
    sessionId: SESSION_ID,
    turnId: TURN_ID,
    projectionSequence: String(sequence),
    eventId: `019fbf59-3000-7000-8000-${String(sequence).padStart(12, "0")}`,
    durableSequence: String(sequence),
    kind,
    payload,
  } as ChatProjectionEventV5;
}

const commandSummary = Object.freeze({
  text: "Inspect repository status",
  truncated: false,
  truncationReason: null,
});
const cwd = Object.freeze({ kind: "workspace_root" as const, segments: Object.freeze([]) });

function reduceV5(events: readonly ChatProjectionEventV5[]) {
  return events.reduce((state, input) => {
    const adapted = projectionEventToConversation(input);
    expect(adapted.kind).toBe("domain_event");
    return adapted.kind === "domain_event"
      ? reduceConversationEvent(state, adapted.event)
      : state;
  }, createConversationState());
}

describe("FEAT-136 v5 conversation adapter", () => {
  it("maps Command lifecycle into the typed execution model", () => {
    const state = reduceV5([
      event(1, "command_started", {
        ...source(1),
        itemId: "command-1",
        itemOrdinal: 1,
        status: "running",
        commandSummary,
        cwd,
      }),
      event(2, "command_output_append", {
        ...source(2),
        itemId: "command-1",
        itemOrdinal: 1,
        text: "working tree clean\n",
        truncated: false,
        truncationReason: null,
      }),
      event(3, "command_completed", {
        ...source(3),
        itemId: "command-1",
        itemOrdinal: 1,
        status: "completed",
        commandSummary,
        cwd,
        durationMs: 9,
        exitCode: 0,
        output: {
          retention: "complete",
          text: "working tree clean\n",
          head: null,
          tail: null,
          reason: null,
          truncated: false,
          truncationReason: null,
        },
        error: null,
      }),
    ]);

    expect(selectConversationItem(state, SESSION_ID, TURN_ID, "command-1"))
      .toMatchObject({
        kind: "command",
        status: "completed",
        execution: {
          kind: "command",
          status: "completed",
          liveOutput: { text: "working tree clean\n" },
          output: { retention: "complete", text: "working tree clean\n" },
        },
      });
  });

  it("keeps an unknown Tool as a Tool card model", () => {
    const identity = Object.freeze({
      resolution: "unknown" as const,
      serverName: "unknown",
      toolName: "unknown",
    });
    const argumentsSummary = Object.freeze({
      text: "request metadata unavailable",
      truncated: false,
      truncationReason: null,
    });
    const state = reduceV5([
      event(1, "tool_started", {
        ...source(1),
        itemId: "tool-unknown",
        itemOrdinal: 1,
        status: "in_progress",
        identity,
        argumentsSummary,
      }),
      event(2, "tool_completed", {
        ...source(2),
        itemId: "tool-unknown",
        itemOrdinal: 1,
        status: "failed",
        identity,
        argumentsSummary,
        durationMs: null,
        resultSummary: null,
        error: { code: "unknown_tool", summary: "tool is not registered" },
      }),
    ]);

    expect(selectConversationItem(state, SESSION_ID, TURN_ID, "tool-unknown"))
      .toMatchObject({
        kind: "tool",
        execution: { kind: "tool", identity, status: "failed" },
      });
  });

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
    const state = hydrateConversationState(snapshot);

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

  it("maps allowlisted generic v5 Items to inert unknown presentation", () => {
    const adapted = projectionEventToConversation(event(1, "item_started", {
      ...source(1),
      itemId: "web-search-1",
      itemOrdinal: 1,
      itemType: "webSearch",
      phase: null,
      text: null,
    }));
    expect(adapted).toMatchObject({
      kind: "domain_event",
      event: { kind: "item.started", itemKind: "unknown" },
    });
  });

  it("maps sticky v4 generic Command/Tool Items to unknown without execution", () => {
    for (const [index, itemType] of ["commandExecution", "mcpToolCall"].entries()) {
      const parsed = parseChatProjectionEventV5({
        ...event(index + 1, "item_started", {
          ...source(index + 1),
          itemId: `sticky-${index}`,
          itemOrdinal: index + 1,
          itemType,
          phase: null,
          text: null,
        }),
        sourceSchemaVersion: 4,
      });
      const adapted = projectionEventToConversation(parsed);
      expect(adapted).toMatchObject({
        kind: "domain_event",
        event: { kind: "item.started", itemKind: "unknown" },
      });
      if (adapted.kind === "domain_event") {
        expect(adapted.event).not.toHaveProperty("execution");
      }
    }
  });
});
