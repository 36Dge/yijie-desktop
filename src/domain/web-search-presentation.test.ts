import {describe, expect, it} from "vitest";
import {webSearchOccurrences, webSearchQueryTitle} from "./web-search-presentation";

describe("native search reading labels", () => {
  it("compacts the repeated topic in flattened provider keywords", () => {
    const raw = ["新丰小吃 推荐分店 新丰小吃 必点小吃 新丰小吃 分店 人气"];
    expect(webSearchQueryTitle(raw)).toBe("新丰小吃 · 推荐分店、必点小吃、分店人气");
    expect(raw).toEqual(["新丰小吃 推荐分店 新丰小吃 必点小吃 新丰小吃 分店 人气"]);
    expect(webSearchQueryTitle(["杭州 必吃 美食 店铺 推荐 杭州 特色 餐厅 排名 杭州 老字号 美食 门店"]))
      .toBe("杭州 · 必吃美食店铺推荐、特色餐厅排名、老字号美食门店");
  });
  it("keeps ordinary queries, years, Latin terms and unrelated queries intact", () => {
    expect(webSearchQueryTitle(["杭州市人民政府 杭州概况 行政区划 面积 人口 2025"]))
      .toBe("杭州市人民政府 杭州概况 行政区划 面积 人口 2025");
    expect(webSearchQueryTitle(["杭州 GDP 2025", "杭州 GDP 2024"])) .toBe("杭州 GDP · 2025、2024");
    expect(webSearchQueryTitle(["城市产业", "生活成本"])).toBe("城市产业 / 生活成本");
    expect(webSearchQueryTitle(["杭州 西湖 杭州"])).toBe("杭州 西湖 杭州");
    expect(webSearchQueryTitle([])).toBe("");
  });
  it("counts distinct calls, not duplicated delivery identities or unknown queries", () => {
    const source = (identity: string, query: string) => ({identity, webSearch: {action: "search" as const, queries: [query] as [string]}});
    const items = [source("first", "新丰小吃 推荐"), source("first", "新丰小吃 推荐"), source("second", "新丰小吃 推荐"), source("different", "新丰小吃 小吃"), source("third", "新丰小吃 推荐"), source("unknown", "")];
    expect([...webSearchOccurrences(items)]).toEqual([["first", 1], ["second", 2], ["different", 1], ["third", 3]]);
    expect([...webSearchOccurrences([items[2]!])]).toEqual([["second", 1]]);
  });
});
