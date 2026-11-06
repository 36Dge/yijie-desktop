import { describe, expect, it } from "vitest";
import fileExamples from "../../src-tauri/schemas/fixtures/chat-message-file-references.json";
import { createChatMarkdownParser, type ChatContentNode } from "./chat-markdown";
const blocks = (text: string) => [{ identity: "body", blockIndex: 0, type: "text" as const, text }];
describe("incremental safe Markdown", () => {
  it("matches a fresh parse for every prefix across headings, lists, quotes, tables and code", () => {
    const text = "前言 **重点**。\n\n## 标题\n\n- 第一项\n  - 子项\n- 第二项\n\n> 引用 **内容**\n\n| 一 | 二 |\n| --- | --- |\n| a | b |\n\n```js\nconst a = 1;\n```\n\n末尾 `code`。";
    const parse = createChatMarkdownParser();
    for (let i = 0; i <= text.length; i++) {
      const input = blocks(text.slice(0, i));
      expect(parse(input, "rich", true)).toEqual(createChatMarkdownParser()(input, "rich", true));
    }
    expect(parse(blocks(text), "rich", false)).toEqual(createChatMarkdownParser()(blocks(text), "rich", false));
  });
  it.each([
    "小标题\n====\n\n正文\n\n3. 有序项\n4. 下一项\n\n结尾",
    "| 名称 | 值 |\n| --- | --- |\n| 一 |  |\n| 二 | 三 |\n\n后文",
    "> 段落\n>\n> - 条目\n>   - 子项\n\n尾段",
    "前段\n\n- 条目\n\n  续段\n- 下一条\n\n最后",
    "普通 [资料](https://example.org/page) 和 **强调**、~~旧值~~。\n\n下一段",
    "```txt\n普通内容\n\n继续\n```\n\n后文",
  ])("keeps ordinary partial syntax equivalent to the full parser: %s", text => {
    const parse = createChatMarkdownParser();
    for (let i = 1; i <= text.length; i++) expect(parse(blocks(text.slice(0, i)), "rich", true)).toEqual(createChatMarkdownParser()(blocks(text.slice(0, i)), "rich", true));
  });
  it("fully reparses revised non-live content when a closing fence changes earlier paragraphs", () => {
    const parse = createChatMarkdownParser();
    const source = "前言\n\n```txt\n第一行\n\n第二行\n\n第三行\n";
    parse(blocks(source), "rich", false);
    expect(parse(blocks(source + "```"), "rich", false)).toEqual(createChatMarkdownParser()(blocks(source + "```"), "rich", false));
  });
  it("reuses completed blocks and handles revisions without stale cached text", () => {
    const parse = createChatMarkdownParser();
    const first = parse(blocks("固定的首段。\n\n第二段"), "rich", true);
    const next = parse(blocks("固定的首段。\n\n第二段新增"), "rich", true);
    expect(next.nodes[0]).toBe(first.nodes[0]); expect(next.nodes[1]).not.toBe(first.nodes[1]);
    const revised = parse(blocks("修订首段。\n\n第二段"), "rich", true);
    expect(revised.text).not.toContain("固定的首段");
    expect(parse(blocks("**用户输入**"), "plain", false).text).toContain("**用户输入**");
  });
  it("indexes nested render text in document order with no raw Markdown delimiters", () => {
    const doc = createChatMarkdownParser()(blocks("**标题**\n\n- 内容\n  - `代码`\n\n[资料](https://example.org)"), "rich", true);
    expect(doc.text).toBe("标题内容代码资料");
    expect(doc.nodes[0]!.startOffset).toBe(0);
    expect(doc.nodes[doc.nodes.length - 1]!.endOffset).toBe(doc.text.length);
  });
  it("preserves a balanced URL destination without adding it to visible text", () => {
    const doc = createChatMarkdownParser()(blocks("[资料](https://example.org/Guide_(city)?q=1#part)"), "rich", false);
    expect(doc.text).toBe("资料");
    expect(doc.nodes[0]).toMatchObject({inlines: [{text: "资料", destination: "https://example.org/Guide_(city)?q=1#part"}]});
  });
  it("keeps the label stable at every live prefix while the URL arrives", () => {
    const parse = createChatMarkdownParser();
    for (const text of ["见[相关说明", "见[相关说明]", "见[相关说明](", "见[相关说明](https://example.org", "见[相关说明](https://example.org)"]) {
      expect(parse(blocks(text), "rich", true).text).toBe("见相关说明");
    }
    expect(parse(blocks("见[相关说明](https://example.org"), "rich", false).text).toBe("见[相关说明](https://example.org");
  });
});

it("streams file references without exposing a repeated local path or altering a fenced example", () => {
  const parse = createChatMarkdownParser(true);
  const path = "/Users/example/Desktop/杭州旅游介绍.md";
  const answer = `**[指南](file://${path})**\n\n路径：\`${path}\``;
  for (let i = 1; i <= answer.length; i++) {
    const input = blocks(answer.slice(0, i));
    const frame = parse(input, "rich", true);
    expect(frame).toEqual(createChatMarkdownParser(true)(input, "rich", true));
    expect(frame.text).not.toContain("/Users/");
  }
  expect(parse(blocks(answer), "rich", false).text).toBe("《杭州旅游介绍.md》");
  expect(parse(blocks(`另见 /work/report.pdf。\n\n\`\`\`text\n${path}`), "rich", true).text).toBe("另见 《report.pdf》。"+path);
});

describe("shared conversation file reference examples", () => {
  it.each(fileExamples)("$label", ({source, targets, visible}) => {
    const doc = createChatMarkdownParser(true)(blocks(source), "rich", false);
    const found = new Set<string>();
    function visit(node: ChatContentNode) {
      if (node.kind === "paragraph" || node.kind === "heading") {
        for (const link of node.inlines) if (link.file) found.add(link.file.path);
      } else if (node.kind === "list") node.items.forEach(item => item.children.forEach(visit));
      else if (node.kind === "quote") node.children.forEach(visit);
      else if (node.kind === "table") for (const cell of [...node.headers,...node.rows.flat()]) {
        for (const link of cell.inlines) if (link.file) found.add(link.file.path);
      }
    }
    doc.nodes.forEach(visit);
    expect([...found].sort()).toEqual([...targets].sort());
    expect(doc.text).toBe(visible);
  });
  it("folds an unlabelled, space-containing path in a bullet only after its workspace identity is known", () => {
    const root = "/Users/example/Library/Application Support/易界/workspace";
    const text = "《[报告](./outputs/验收%20报告.html)\n![封面](./outputs/封面.svg)\n[视频](./outputs/演示.mp4)\n\n- `" + root + "/outputs/验收 报告.html`";
    const pending = createChatMarkdownParser(true)(blocks(text), "rich", false);
    expect(pending.relativeHint?.path).toBe("outputs/验收 报告.html");
    const rendered = createChatMarkdownParser(true, root)(blocks(text), "rich", false);
    expect(rendered.text).toBe("《验收 报告.html》 《封面.svg》 《演示.mp4》");
    expect(rendered.nodes.map(n => n.kind)).toEqual(["paragraph"]);
    const other = createChatMarkdownParser(true, "/other")(blocks(text),"rich",false);
    expect(other.text).toContain(root + "/outputs/验收 报告.html");
  });
  it("uses the session workspace to distinguish mixed relative and absolute references", () => {
    const text = "[行程](./out/行程.md)\n\n> - 路径：/work/out/行程.md\n\n- 路径：/else/out/行程.md";
    const unresolved = createChatMarkdownParser(true)(blocks(text),"rich",false);
    expect(unresolved.relativeHint?.path).toBe("out/行程.md");
    const resolved = createChatMarkdownParser(true, "/work")(blocks(text),"rich",false);
    expect(resolved.text).toBe("《行程.md》《行程.md》");
    expect(resolved.nodes.map(node=>node.kind)).toEqual(["paragraph","list"]);
  });
});
