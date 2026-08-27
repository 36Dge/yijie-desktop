// @vitest-environment happy-dom

import axe from "axe-core";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { h } from "vue";
import { describe, expect, it } from "vitest";
import type {
  ConversationTimelineArtifactReferenceContentBlock,
  ConversationTimelineAttachmentReferenceContentBlock,
  ConversationTimelineContentBlock,
} from "../../domain/conversation-timeline";
import ChatSafeContent from "./ChatSafeContent.vue";

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

function textBlock(
  text: string,
  identity = "block-text",
): ConversationTimelineContentBlock {
  return deepFreeze({ identity, blockIndex: 0, type: "text", text });
}

describe("ChatSafeContent", () => {
  it("renders the supported rich-text subset in source order without executable links", () => {
    const wrapper = mount(ChatSafeContent, {
      props: {
        blocks: [textBlock([
          "首段 **重点**、*补充*、`inline` 与 [参考](https://docs.invalid/guide)。",
          "",
          "- 第一项",
          "- 第二项",
          "",
          "| 名称 | 状态 |",
          "| --- | --- |",
          "| 示例 | 完成 |",
          "",
          "```ts",
          "const value = 1;",
          "```",
        ].join("\n"))],
      },
    });

    expect(wrapper.find("strong").text()).toBe("重点");
    expect(wrapper.find("em").text()).toBe("补充");
    expect(wrapper.find(".chat-safe-content__inline-code").text()).toBe("inline");
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.find("[href]").exists()).toBe(false);
    expect(wrapper.get(".chat-safe-content__inert-link").text())
      .toBe("参考（https://docs.invalid/guide）");
    expect(wrapper.findAll("ul li").map((item) => item.text())).toEqual(["第一项", "第二项"]);
    expect(wrapper.findAll("th").map((cell) => cell.text())).toEqual(["名称", "状态"]);
    expect(wrapper.findAll("td").map((cell) => cell.text())).toEqual(["示例", "完成"]);
    expect(wrapper.get(".chat-safe-content__language").text()).toBe("ts");
    expect(wrapper.get("pre code").text()).toBe("const value = 1;");

    const topLevelKinds = Array.from((wrapper.element as HTMLElement).children)
      .map((element) => element.tagName);
    expect(topLevelKinds).toEqual(["P", "UL", "DIV", "DIV"]);
  });

  it("preserves explicit code whitespace and keeps scroll regions keyboard reachable", () => {
    const codeText = "  const first = 1;\n\nconst second = 2;  ";
    const blocks: readonly ConversationTimelineContentBlock[] = deepFreeze([{
      identity: "block-code",
      blockIndex: 0,
      type: "code",
      language: "typescript",
      text: codeText,
    }, textBlock("| 左 | 右 |\n| --- | --- |\n| A | B |", "block-table")]);
    const wrapper = mount(ChatSafeContent, { props: { blocks } });

    expect(wrapper.get("pre code").element.textContent).toBe(codeText);
    expect(wrapper.get(".chat-safe-content__code-region").attributes("tabindex")).toBe("0");
    expect(wrapper.get(".chat-safe-content__code-region").attributes("aria-label"))
      .toContain("横向滚动");
    expect(wrapper.get(".chat-safe-content__table-region").attributes("tabindex")).toBe("0");
  });

  it("renders benign markup as literal text and offers an unparsed plain mode", () => {
    const rich = mount(ChatSafeContent, {
      props: {
        blocks: [textBlock("<demo-card data-note=\"literal\">普通内容</demo-card>")],
      },
    });
    expect(rich.find("demo-card").exists()).toBe(false);
    expect(rich.text()).toContain("<demo-card data-note=\"literal\">普通内容</demo-card>");

    const plainText = "**保持原样**\n`同样保持`";
    const plain = mount(ChatSafeContent, {
      props: { blocks: [textBlock(plainText)], mode: "plain" },
    });
    expect(plain.find("strong, em, code").exists()).toBe(false);
    expect(plain.text()).toBe(plainText);
  });

  it("fails soft within a bounded budget for a long incomplete Markdown draft", () => {
    const incompleteDraft = Array.from({ length: 5_000 }, (_, index) =>
      index % 2 === 0 ? "```draft" : "[unfinished draft note").join("\n");
    const startedAt = performance.now();
    const wrapper = mount(ChatSafeContent, {
      props: { blocks: [textBlock(incompleteDraft)] },
    });
    const elapsedMs = performance.now() - startedAt;

    expect(wrapper.find(".chat-safe-content__code-region, table").exists()).toBe(false);
    expect(wrapper.text()).toContain("```draft");
    expect(wrapper.text()).toContain("[unfinished draft note");
    expect(elapsedMs).toBeLessThan(1_500);
  });

  it("passes frozen artifact and attachment references to typed slots exactly once", () => {
    const artifact = deepFreeze<ConversationTimelineArtifactReferenceContentBlock>({
      identity: "block-artifact",
      blockIndex: 0,
      type: "artifact_reference",
      artifactId: "artifact-demo",
      label: "演示内容",
    });
    const attachment = deepFreeze<ConversationTimelineAttachmentReferenceContentBlock>({
      identity: "block-attachment",
      blockIndex: 1,
      type: "attachment_reference",
      attachmentId: "attachment-demo",
      kind: "file",
      name: "说明.txt",
      mediaType: "text/plain",
      sizeBytes: 32,
      status: "ready",
      expiresAt: 2_000_000_000,
    });
    const seenArtifacts: ConversationTimelineArtifactReferenceContentBlock[] = [];
    const seenAttachments: ConversationTimelineAttachmentReferenceContentBlock[] = [];
    const wrapper = mount(ChatSafeContent, {
      props: { blocks: deepFreeze([artifact, attachment]) },
      slots: {
        "artifact-reference": ({ block }: { block: ConversationTimelineArtifactReferenceContentBlock }) => {
          seenArtifacts.push(block);
          return h("span", { class: "artifact-reference-slot" }, block.label ?? "生成内容");
        },
        "attachment-reference": ({ block }: { block: ConversationTimelineAttachmentReferenceContentBlock }) => {
          seenAttachments.push(block);
          return h("span", { class: "attachment-reference-slot" }, block.name);
        },
      },
    });

    expect(seenArtifacts).toEqual([artifact]);
    expect(seenAttachments).toEqual([attachment]);
    expect(seenArtifacts[0]).toBe(artifact);
    expect(seenAttachments[0]).toBe(attachment);
    expect(wrapper.get(".artifact-reference-slot").text()).toBe("演示内容");
    expect(wrapper.get(".attachment-reference-slot").text()).toBe("说明.txt");
  });

  it("uses inert fallback references and a closed unknown message", async () => {
    const blocks: readonly ConversationTimelineContentBlock[] = deepFreeze([{
      identity: "block-artifact",
      blockIndex: 0,
      type: "artifact_reference",
      artifactId: "artifact-demo",
      label: null,
    }, {
      identity: "block-attachment",
      blockIndex: 1,
      type: "attachment_reference",
      attachmentId: "attachment-demo",
      kind: "image",
      name: "示例.png",
      mediaType: "image/png",
      sizeBytes: 64,
      status: "ready",
      expiresAt: 2_000_000_000,
    }, {
      identity: "block-unknown",
      blockIndex: 2,
      type: "unknown",
      code: "unsupported_content",
    }]);
    const wrapper = mount(ChatSafeContent, { attachTo: document.body, props: { blocks } });

    expect(wrapper.text()).toContain("生成内容引用：生成内容");
    expect(wrapper.text()).toContain("附件引用：示例.png");
    expect(wrapper.text()).toContain("此内容暂不支持（unsupported_content）");
    expect(wrapper.find("a, button, iframe").exists()).toBe(false);
    expect((await axe.run(wrapper.element)).violations).toEqual([]);
    wrapper.unmount();
  });

  it("keeps the component inside the presentation-only safety boundary", () => {
    const source = readFileSync("src/components/chat/ChatSafeContent.vue", "utf8");
    expect(source).not.toMatch(/v-html|<a\b|href\s*=|window\.|fetch\(|invoke\(|router|store|client/i);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).toContain("ConversationTimelineContentBlock");
  });
});
