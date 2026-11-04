import { describe, expect, it } from "vitest";
import { readablePublicCommentary } from "./public-message-reading";
import { traceItem, traceTurn } from "./conversation-activity-fixtures";

const marker = "[[yijie.public-message.v1:final_answer]]";
describe("saved public commentary reading", () => {
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
