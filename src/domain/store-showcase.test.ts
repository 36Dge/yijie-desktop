import { describe, expect, it } from "vitest";
import {
  formatDemoPopularity,
  getCuratedScenes,
  getRoleScenes,
  getStoreBusinessBrief,
  STORE_BUSINESS_BRIEFS,
  STORE_CURATED_FILTERS,
  STORE_ROLE_FILTERS,
  STORE_SCENES,
  STORE_SHOWCASE_NOTICE,
  type StoreCuratedFilterId,
  type StoreRoleFilterId,
} from "./store-showcase";

describe("Store showcase domain", () => {
  it("provides three explicitly synthetic business briefs with exactly five metrics", () => {
    expect(STORE_SHOWCASE_NOTICE).toBe("演示数据，不代表真实店铺");
    expect(STORE_BUSINESS_BRIEFS.map((brief) => brief.id)).toEqual([
      "sales",
      "ads",
      "inventory",
    ]);

    for (const brief of STORE_BUSINESS_BRIEFS) {
      expect(brief.metrics).toHaveLength(5);
      expect(new Set(brief.metrics.map((metric) => metric.id)).size).toBe(5);
      for (const metric of brief.metrics) {
        expect(metric.label).not.toBe("");
        expect(metric.value).not.toBe("");
        expect(metric.unit).not.toBe("");
        expect(metric.comparison).not.toBe("");
      }
      expect(getStoreBusinessBrief(brief.id)).toBe(brief);
    }
  });

  it("keeps the required curated and role filter labels in reference order", () => {
    expect(STORE_CURATED_FILTERS).toEqual([
      { id: "all", label: "全部" },
      { id: "reduce-acos", label: "降 ACOS" },
      { id: "improve-conversion", label: "提转化" },
      { id: "prevent-bad-reviews", label: "防差评" },
      { id: "prevent-stockout", label: "防断货" },
      { id: "check-sales", label: "查销量" },
      { id: "increase-traffic", label: "提流量" },
      { id: "track-competitors", label: "盯竞品" },
      { id: "health-check", label: "健康诊断" },
    ]);
    expect(STORE_ROLE_FILTERS).toEqual([
      { id: "all", label: "全部" },
      { id: "store-owner", label: "店铺负责人" },
      { id: "sourcing-manager", label: "选品经理" },
      { id: "operations-specialist", label: "运营专员" },
      { id: "ads-optimizer", label: "广告优化师" },
      { id: "supply-chain", label: "供应链" },
    ]);
  });

  it.each<[StoreCuratedFilterId, readonly string[]]>([
    [
      "reduce-acos",
      [
        "搜索词表现分析",
        "店铺广告健康诊断v2",
        "关键词投放诊断",
        "关键词埋词优化",
        "近7天广告点击多但无转化的",
      ],
    ],
    [
      "improve-conversion",
      [
        "Listing全漏斗转化分析",
        "Listing主图图片优化诊断",
        "全店广告和自然订单转化情况",
        "点击多不出单的ASIN",
        "广告点击多但转化低的SKU有哪些",
        "近14天转化率好的关键词有哪些",
      ],
    ],
    [
      "prevent-bad-reviews",
      ["30天差评归因", "近1年ASIN中差评分析", "店铺Feedback诊断", "7天中差评分析"],
    ],
    ["prevent-stockout", ["FBA库存盘点", "看FBA在途", "看FBA不可售", "看FBA冻结占用"]],
    [
      "check-sales",
      [
        "本周销售情况分析",
        "销量暴跌的商品",
        "本周销售TOP10子ASIN",
        "本月销售TOP10子ASIN",
        "近3天TOP10销售子ASIN排名",
        "运营负责人利润报表（近30天）",
      ],
    ],
    [
      "increase-traffic",
      ["Listing流量归因分析", "Alexa购物助手推荐诊断（竞品支持多asin）v3"],
    ],
    ["track-competitors", ["竞品归因2.0", "ABA搜索词分析"]],
    [
      "health-check",
      ["店铺销售健康诊断", "店铺客户体验健康诊断-v2", "每日异常Listing监控"],
    ],
  ])("maps curated filter %s to every reference scene", (filterId, titles) => {
    expect(getCuratedScenes(filterId).map((scene) => scene.title)).toEqual(titles);
  });

  it.each<[StoreRoleFilterId, readonly string[]]>([
    [
      "store-owner",
      [
        "店铺广告健康诊断v2",
        "点击多不出单的ASIN",
        "本周销售情况分析",
        "销量暴跌的商品",
        "近3天TOP10销售子ASIN排名",
        "店铺客户体验健康诊断-v2",
        "子体Listing表现",
        "本周销售战报（含广告）",
        "双周流量总览",
        "店铺今日销售",
      ],
    ],
    [
      "sourcing-manager",
      [
        "竞品归因2.0",
        "父ASIN变体退货归因分析",
        "子ASIN退货深度分析",
        "父ASIN变体二维诊断",
        "Amazon Listing文案对比竞品优化（2026新规版）",
        "ASIN变体扩展空间分析",
        "Amazon问答生成器",
        "ASIN多维度分析与优化",
      ],
    ],
    [
      "operations-specialist",
      [
        "Listing全漏斗转化分析",
        "Listing主图图片优化诊断",
        "30天差评归因",
        "近1年ASIN中差评分析",
        "店铺Feedback诊断",
        "7天中差评分析",
        "Listing流量归因分析",
        "每日异常Listing监控",
        "Listing质量分析",
        "Listing标题Alexa化优化（优化至75个字符）",
        "Listing图片AI生图",
        "ABA-ASIN关键词反查",
      ],
    ],
    [
      "ads-optimizer",
      [
        "搜索词表现分析",
        "关键词埋词优化",
        "广告位高杠杆场景分析",
        "店铺广告健康诊断",
        "广告矩阵生成",
        "广告结构诊断v2",
        "今昨两天预算花光的低产出广告活动",
      ],
    ],
    [
      "supply-chain",
      [
        "FBA库存盘点",
        "看FBA在途",
        "看FBA不可售",
        "看FBA冻结占用",
        "FBA丢损索赔建议",
        "看FBA促销清仓",
      ],
    ],
  ])("maps role filter %s to every reference scene", (filterId, titles) => {
    expect(getRoleScenes(filterId).map((scene) => scene.title)).toEqual(titles);
  });

  it("returns the exact default screenshot card sets for both all filters", () => {
    const curated = getCuratedScenes("all");
    const roles = getRoleScenes("all");

    expect(curated.map((scene) => scene.title)).toEqual([
      "搜索词表现分析",
      "店铺广告健康诊断v2",
      "关键词投放诊断",
      "关键词埋词优化",
      "近7天广告点击多但无转化的",
      "Listing全漏斗转化分析",
    ]);
    expect(roles.map((scene) => scene.title)).toEqual([
      "店铺广告健康诊断v2",
      "店铺客户体验健康诊断-v2",
      "子体Listing表现",
      "近3天TOP10销售子ASIN排名",
      "本周销售战报（含广告）",
      "点击多不出单的ASIN",
      "本周销售情况分析",
      "销量暴跌的商品",
      "双周流量总览",
      "店铺今日销售",
      "父ASIN变体退货归因分析",
      "子ASIN退货深度分析",
    ]);
    expect(new Set(curated.map((scene) => scene.id)).size).toBe(curated.length);
    expect(new Set(roles.map((scene) => scene.id)).size).toBe(roles.length);
    expect(new Set(STORE_SCENES.map((scene) => scene.id)).size).toBe(STORE_SCENES.length);
  });

  it("labels popularity as synthetic and exposes no excluded authorization semantics", () => {
    expect(formatDemoPopularity(STORE_SCENES[0])).toBe("演示热度 · 11,025");

    const serialized = JSON.stringify({
      briefs: STORE_BUSINESS_BRIEFS,
      scenes: STORE_SCENES,
    });
    expect(serialized).not.toContain("需授权");
    expect(serialized).not.toContain("立即授权");
  });
});
