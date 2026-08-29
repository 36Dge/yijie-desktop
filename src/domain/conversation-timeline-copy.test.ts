import { describe, expect, it } from "vitest";
import type { ConversationTimelineItemViewModel } from "./conversation-timeline";
import { copyableTimelineItemText } from "./conversation-timeline-copy";

function item(
  contentBlocks: ConversationTimelineItemViewModel["contentBlocks"],
): ConversationTimelineItemViewModel {
  return Object.freeze({
    identity: "item-identity",
    threadId: "thread-demo",
    turnId: "turn-demo",
    itemId: "item-demo",
    ordinal: 0,
    kind: "assistant_message",
    presentation: "final_answer",
    role: "assistant",
    domainStatus: "completed",
    phase: "complete",
    assistantPhase: "final_answer",
    reasoning: null,
    execution: null,
    contentMode: "rich",
    collapsible: false,
    defaultExpanded: true,
    copyPolicy: "text_and_code",
    reconciliation: "matched",
    contentBlocks: Object.freeze(contentBlocks),
  });
}

describe("copyableTimelineItemText", () => {
  it("preserves exact text and code segments in projected order", () => {
    const value = copyableTimelineItemText(item([{
      identity: "text",
      blockIndex: 0,
      type: "text",
      text: "  first line  ",
    }, {
      identity: "attachment",
      blockIndex: 1,
      type: "attachment_reference",
      attachmentId: "attachment-demo",
      kind: "file",
      name: "safe.txt",
      mediaType: "text/plain",
      sizeBytes: 4,
      status: "ready",
      expiresAt: 2_000_000_000,
    }, {
      identity: "code",
      blockIndex: 2,
      type: "code",
      language: "ts",
      text: "const value = 1;\n",
    }]));

    expect(value).toBe("  first line  \n\nconst value = 1;\n");
  });

  it("returns null when the Item has no copyable projected content", () => {
    expect(copyableTimelineItemText(item([{
      identity: "unknown",
      blockIndex: 0,
      type: "unknown",
      code: "unsupported_content",
    }]))).toBeNull();
  });

  it("never exposes raw reasoning text to product-level copy", () => {
    const reasoning = Object.freeze({
      ...item([{
        identity: "reasoning-text",
        blockIndex: 0,
        type: "text" as const,
        text: "raw reasoning must stay non-copyable",
      }]),
      kind: "reasoning" as const,
      presentation: "reasoning" as const,
      role: "process" as const,
      assistantPhase: null,
      reasoning: Object.freeze({ status: "complete" as const, reasonCode: null }),
      contentMode: "plain" as const,
      collapsible: true,
      defaultExpanded: false,
      copyPolicy: "none" as const,
    });

    expect(copyableTimelineItemText(reasoning)).toBeNull();
  });
});
