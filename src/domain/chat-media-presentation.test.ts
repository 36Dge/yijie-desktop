import { describe, expect, it } from "vitest";
import { mediaDisplayName, mediaRequestTitle, hideMediaIdMetadata, presentMediaTimeline } from "./chat-media-presentation";
import { viewFromLegacySnapshot, type ConversationSnapshot } from "./conversation-view";
import { selectConversationTimeline } from "./conversation-timeline";
import type { ArtifactProjection } from "./chat-artifact";

const ID = "019c1a00-0000-7000-8000-000000000421";
const OTHER = "019c1a00-0000-7000-8000-000000000422";
const REQUEST = "一瓶冰镇气泡果汁，瓶身带有冷凝水珠，动态飞溅摄影，商业食品摄影，超写实。";
function artifact(kind: ArtifactProjection["kind"] = "image"): ArtifactProjection {
  return { sessionId: "session", turnId: "turn", artifactId: ID, kind, provenance: "provider", status: "ready", ordinal: 0,
    progressStage: null, progressPercent: null, displayName: kind === "video" ? "生成的视频.mp4" : "generated-image",
    mediaType: kind === "video" ? "video/mp4" : "image/jpeg", sizeBytes: 32, localCommittedAt: 1000, expiresAt: 2000,
    hasPoster: false, errorCode: null, retryable: null };
}
function timeline(request = REQUEST, answer = `图片已交付。\n\n产物 ID：\`${ID}\``) {
  const identity = { threadId: "session", turnId: "turn" };
  const snapshot: ConversationSnapshot = {
    threads: [{ threadId: "session", status: "ready" }],
    turns: [{ ...identity, ordinal: 0, status: "completed", terminalStatus: "completed" }],
    items: [
      { ...identity, itemId: "user", ordinal: 0, kind: "user_message", status: "completed", contentBlocks: [{ blockIndex: 0, type: "text", text: request }] },
      { ...identity, itemId: "answer", ordinal: 1, kind: "assistant_message", status: "completed", agentMessagePhase: "final_answer", contentBlocks: [{ blockIndex: 0, type: "text", text: answer }] },
      { ...identity, itemId: "media", ordinal: 2, kind: "artifact", status: "completed", contentBlocks: [{ blockIndex: 0, type: "artifact_reference", artifactId: ID, label: "generated-image" }] },
    ],
  };
  return selectConversationTimeline(viewFromLegacySnapshot(snapshot), "session")!;
}

describe("media presentation", () => {
  it("names the media from the request and uses its actual MIME extension", () => {
    expect(mediaRequestTitle(REQUEST)).toBe("冰镇气泡果汁-动态飞溅摄影");
    expect(mediaDisplayName(artifact(), REQUEST)).toBe("冰镇气泡果汁-动态飞溅摄影.jpg");
    expect(mediaDisplayName({ ...artifact(), mediaType: "image/png" }, REQUEST)).toBe("冰镇气泡果汁-动态飞溅摄影.png");
    expect(mediaDisplayName(artifact("video"), "一只白色马克杯缓缓旋转，产品展示")).toBe("白色马克杯缓缓旋转-产品展示.mp4");
  });
  it("preserves specific existing names and corrects a mismatched extension", () => {
    expect(mediaDisplayName({ ...artifact(), displayName: "山林清晨.jpeg" }, REQUEST)).toBe("山林清晨.jpeg");
    expect(mediaDisplayName({ ...artifact(), displayName: "山林清晨.png" }, REQUEST)).toBe("山林清晨.jpg");
    expect(mediaDisplayName({ ...artifact(), displayName: ID + ".jpg" }, REQUEST)).toBe("冰镇气泡果汁-动态飞溅摄影.jpg");
  });
  it("does not invent a file extension before the media format is available", () => {
    expect(mediaDisplayName({ ...artifact(), mediaType: null }, REQUEST)).toBe("冰镇气泡果汁-动态飞溅摄影");
    expect(mediaRequestTitle("请重新生成一张图片")).toBeNull();
    expect(mediaRequestTitle("生成16:9的产品旋转视频")).toBe("产品旋转视频");
  });
  it.each([`产物 ID：\`${ID}\``, `- **Artifact ID**: \`${ID}\``, `视频 ID: ${ID}`, `视频产物 ID: ${ID}`, ID, `产物 ID：\`${ID.slice(0, 12)}`])("hides known media metadata: %s", line => {
    expect(hideMediaIdMetadata(`已生成。\n\n${line}`, [ID])).toBe("已生成。");
  });
  it("keeps normal prose, unrelated identifiers and original whitespace", () => {
    const text = `  普通说明。\n\n订单 ID：${OTHER}\n产物 ID：${OTHER}\n`;
    expect(hideMediaIdMetadata(text, [ID])).toBe(text);
    expect(hideMediaIdMetadata(`图片已交付（产物 ID：\`${ID}\`）。`, [ID])).toBe("图片已交付。");
    expect(hideMediaIdMetadata(`图片已交付（\`artifact_id\`: \`${ID}\`）。`, [ID])).toBe("图片已交付。");
  });
  it("removes a metadata-only fenced block without leaving an empty code box", () => {
    expect(hideMediaIdMetadata("已交付。\n\n```text\n" + ID + "\n```", [ID])).toBe("已交付。");
    expect(hideMediaIdMetadata("```json\n{\"artifact_id\":\"" + ID + "\"}\n```", [ID])).toBe("");
  });
  it("preserves actual code while hiding a separate media metadata line", () => {
    const code = "```js\nconst artifact_id = \"" + ID + "\";\n\n\nconsole.log(artifact_id);\n```";
    expect(hideMediaIdMetadata(code + "\n\n产物 ID：" + ID, [ID])).toBe(code);
  });
  it.each(["image", "video"] as const)("filters only the assistant presentation for %s while retaining source and reference identity", kind => {
    const source = timeline(REQUEST + "\n" + ID);
    const before = JSON.stringify(source);
    const result = presentMediaTimeline(source, () => [artifact(kind)]);
    const turn = result.timeline!.turns[0]!;
    expect(turn.items.find(item => item.kind === "assistant_message")!.contentBlocks).toMatchObject([{ type: "text", text: "图片已交付。" }]);
    expect(turn.items.find(item => item.kind === "user_message")!.contentBlocks).toMatchObject([{ type: "text", text: REQUEST + "\n" + ID }]);
    expect(turn.items.find(item => item.kind === "artifact")!.contentBlocks).toMatchObject([{ artifactId: ID }]);
    expect(JSON.stringify(source)).toBe(before);
    expect(result.requests.turn).toBe(REQUEST + "\n" + ID);
  });
  it("leaves file artifacts and unresolved media untouched", () => {
    const source = timeline();
    expect(presentMediaTimeline(source, () => [artifact("file")]).timeline).toBe(source);
    expect(presentMediaTimeline(source, () => []).timeline).toBe(source);
  });
  it("uses the preceding media request for an explicit retry without renaming native artifacts", () => {
    const first = timeline();
    const second = timeline("重新生成一张图片");
    const retry = { ...second.turns[0]!, turnId: "retry", items: second.turns[0]!.items.map(item => ({ ...item, turnId: "retry" })) };
    const source = { ...first, turns: [...first.turns, retry] };
    const original = artifact();
    const result = presentMediaTimeline(source, () => [original]);
    expect(result.requests.retry).toBe(REQUEST);
    expect(original.displayName).toBe("generated-image");
  });
});
