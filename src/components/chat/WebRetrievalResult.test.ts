// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import WebRetrievalResult from "./WebRetrievalResult.vue";
import { readWebRetrievalResult } from "../../domain/web-retrieval-display";

describe("FEAT-162 source-bound web retrieval presentation", () => {
  it("distinguishes upstream absence, clipped content and dropped pages without opening URLs", () => {
    const base = { title: "公开文档", url: "https://example.org/docs", snippet: "摘要", text: "" };
    const text = JSON.stringify({ results: [{ ...base, content_status: "unavailable" }, { ...base, content_status: "truncated" }], truncated: true, dropped_results: 1 });
    const view = mount(WebRetrievalResult, { props: { tool: "kimi_web_search", text } });
    expect(view.text()).toContain("未取得正文");
    expect(view.text()).toContain("正文已截断");
    expect(view.text()).toContain("1 条结果未交付");
    expect(view.findAll("details")).toHaveLength(2);
    expect(view.findAll("a,img,iframe")).toHaveLength(0);
  });
  it("keeps legacy lists readable and treats unparseable archived text as text", () => {
    expect(readWebRetrievalResult("kimi_web_search", '{"results":[],"truncated":false}')).not.toBeNull();
    expect(readWebRetrievalResult("kimi_web_search_pro", '{"results":[],"truncated":false}')).toBeNull();
    const view = mount(WebRetrievalResult, { props: { tool: "kimi_web_search", text: "普通历史文本" } });
    expect(view.get("pre").text()).toBe("普通历史文本");
  });
  it("keeps Pro chunks with their own actual source and decodes the Runtime text wrapper", () => {
    const value = { results: [{ title: "文档", url: "https://example.org/", snippet: "摘要", site_name: "Example", date: "2026-10-29", authority: "", chunks: [{ text: "材料", score: 0.25 }], content_status: "available" }], truncated: false, dropped_results: 0 };
    const view = mount(WebRetrievalResult, { props: { tool: "kimi_web_search_pro", text: `Wall time: 0.1 seconds\nOutput:\n${JSON.stringify(value)}` } });
    expect(view.text()).toContain("https://example.org/");
    expect(view.text()).toContain("材料");
    expect(view.text()).toContain("不保证包含完整网页");
  });
});
