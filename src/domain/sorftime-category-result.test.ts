import { describe, expect, it } from "vitest";
import type { NativeMcpDisplay } from "../api/generated/native-conversation-private.gen";
import { readSorftimeCategoryResult, sorftimeCategoryTool } from "./sorftime-category-result";

function receipt(text: string, fields: Partial<NativeMcpDisplay> = {}): NativeMcpDisplay {
  return {server: "yijie_market", tool: sorftimeCategoryTool, resultKind: "text", diagnostics: [],
    texts: [{index: 0, text}], ...fields};
}

describe("Sorftime category results", () => {
  it("only reports zero matches for a complete business list", () => {
    const empty = JSON.stringify({doc: {category_name: "Sub-category name."}, data: []});
    expect(readSorftimeCategoryResult(receipt(empty, {diagnostics: ["arguments_unavailable"]}))?.summary).toContain("没有找到匹配类目");
    for (const incomplete of [
      receipt(empty, {diagnostics: ["content_truncated"]}),
      receipt('{"doc":{"category_name":"Sub-category name."}}'),
      receipt('{"data":[{"category_name":"Example"'),
      receipt('{"error":"unavailable","data":[]}'),
      receipt("", {resultKind: "empty", texts: []}),
    ]) {
      expect(readSorftimeCategoryResult(incomplete)).toEqual({summary: expect.stringContaining("没有可展示的类目明细"), categories: []});
    }
  });

  it("keeps reported zeroes, omits unavailable metrics and preserves the node ID as text", () => {
    const text = JSON.stringify({data: [
      {category_name: "Seasonal", node_id: "012345678901234567890", top100_monthly_sales_volume: "0",
        average_price: "-1", average_star_rating: "6", peak_season: "均衡"},
      {category_name: "Lighting", node_id: 72001, top100_monthly_sales_volume: "", average_price: 0, average_star_rating: 0},
    ]});
    expect(readSorftimeCategoryResult(receipt(text))?.categories).toEqual([
      {name: "Seasonal", nodeId: "012345678901234567890", season: "全年较均衡", metrics: [{label: "月销量合计", value: "0 件"}]},
      {name: "Lighting", nodeId: "72001", season: undefined, metrics: [
        {label: "平均售价（当地货币）", value: "0.00"}, {label: "平均评分", value: "0 / 5"},
      ]},
    ]);
  });

  it("keeps available rows in provider order when some details are missing", () => {
    const result = readSorftimeCategoryResult(receipt("", {texts: [
      {index: 0, text: JSON.stringify({data: [{category_name: "First"}, null]})},
      {index: 2, text: JSON.stringify({data: [{category_name: "Second"}]})},
    ]}));
    expect(result?.categories.map(row => row.name)).toEqual(["First", "Second"]);
    expect(result?.summary).toBe("已保留 2 条类目结果，明细可能不完整。");
    expect(readSorftimeCategoryResult(receipt('{"data":[]}', {server: "another_service"}))).toBeUndefined();
    expect(readSorftimeCategoryResult(receipt('{"data":[]}', {tool: "another_tool"}))).toBeUndefined();
  });
});
