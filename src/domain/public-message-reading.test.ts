import { describe, expect, it } from "vitest";
import { readablePublicAssistantText, readablePublicCommentary } from "./public-message-reading";
import { traceItem, traceTurn } from "./conversation-activity-fixtures";

const marker = "[[yijie.public-message.v1:final_answer]]";
describe("saved public commentary reading", () => {
  it("hides the observed unknown-phase transport line without inferring a phase or changing facts", () => {
    const raw = "[[yijie-public-message-v1:commentary]]\n框架已定，接下来写正文。";
    const item = traceItem("unknown-spelling", "agentMessage", {text: raw});
    const before = JSON.stringify(item);
    const view = traceTurn([item]).items[0]!;
    expect(view.presentation).toBe("assistant_unclassified");
    expect(view.contentBlocks).toMatchObject([{type: "text", text: "框架已定，接下来写正文。"}]);
    expect(JSON.stringify(item)).toBe(before);
    expect(readablePublicAssistantText(raw, "final_answer")).toBe(raw);
    expect(readablePublicAssistantText(`\`\`\`text\n${raw}\n\`\`\``, undefined)).toBe(`\`\`\`text\n${raw}\n\`\`\``);
    expect(readablePublicAssistantText("> " + raw, undefined)).toBe("> " + raw);
  });
  it("removes the observed standalone control line while keeping all answer text", () => {
    const raw = `我按几个角度说明。\n\n${marker}\n**城市介绍**\n\n完整正文。`;
    expect(readablePublicCommentary(raw)).toBe("我按几个角度说明。\n\n**城市介绍**\n\n完整正文。");
  });
  it("keeps inline, quoted, indented and fenced examples literal", () => {
    const raw = `inline ${marker} example\n> ${marker}\n    ${marker}\n\`\`\`\`text\n${marker}\n\`\`\`\n${marker}\n\`\`\`\`\n~~~\n${marker}\n~~~\n`;
    expect(readablePublicCommentary(raw)).toBe(raw);
  });
  it("changes only the native commentary reading projection and preserves records", () => {
    const raw = `开场内容。\n${marker}\n保留的正文。`;
    const items = [
      traceItem("note", "agentMessage", {text: raw, phase: "commentary"}),
      traceItem("answer", "agentMessage", {text: marker, phase: "final_answer"}),
      traceItem("unknown", "agentMessage", {text: marker}),
      traceItem("user", "userMessage", {text: marker}),
    ];
    const original = JSON.stringify(items);
    const turn = traceTurn(items);
    const text = (id: string) => turn.items.find(item => item.itemId === id)!.contentBlocks.flatMap(block => block.type === "text" ? [block.text] : []).join("");
    expect(text("note")).toBe("开场内容。\n保留的正文。");
    for (const id of ["answer", "unknown", "user"]) expect(text(id)).toBe(marker);
    expect(turn.items.find(item => item.itemId === "note")!.presentation).toBe("commentary");
    expect(JSON.stringify(items)).toBe(original);
  });
});
