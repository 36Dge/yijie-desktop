import { describe, expect, it } from "vitest";
import { createChatMarkdownParser } from "./chat-markdown";
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
