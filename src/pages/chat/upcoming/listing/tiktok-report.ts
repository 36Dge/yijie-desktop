import jar from "./assets/tk-jar.webp";
import texture from "./assets/tk-texture.webp";
import routine from "./assets/tk-routine.webp";
import type { PlatformReport } from "./report-model";

const comparisons = [
  { name: "Dr.Althea 345", price: "$19.70", floor: 19.70, units: 63920 },
  { name: "medicube", price: "$15.20", floor: 15.20, units: 55401 },
  { name: "ILLIYOON", price: "$9.80–58.90", floor: 9.80, units: 35891 },
  { name: "EVIL GOODS", price: "$27.20", floor: 27.20, units: 19909 },
  { name: "Prequel", price: "$20.80", floor: 20.80, units: 4408 },
];
const tkTerms = [
  { term: "medicube collagen cream", searches: 1800, products: 15, use: "品牌商品卡" },
  { term: "collagen face cream", searches: 3200, products: 40, use: "标题品类词" },
  { term: "niacinamide moisturizer", searches: 2400, products: 60, use: "成分副图" },
  { term: "hydrating face cream", searches: 6900, products: 230, use: "口播开场" },
];

export const tiktokReport: PlatformReport = {
  name: "Triple Collagen 胶原保湿面霜", market: "TikTok Shop 美国站", identifier: "商品 ID",
  summary: "标题先讲清品类和容量，用开盖质地与使用顺序承接短视频流量。",
  metrics: [
    { label: "展示价", value: "$15.20" }, { label: "近 90 天销量", value: "55,401 件" },
    { label: "关联达人", value: "4,067 位" }, { label: "关联视频", value: "8,529 条" },
  ],
  sections: [
    {
      id: "basics", nav: "商品诊断", title: "商品基础信息诊断",
      lead: "长串成分把保湿用途挤到了标题末尾。将品类和 50 ml 容量提前。",
      blocks: [
        { type: "rewrite", before: "[medicube] Triple Collagen Cream (Collagen+Hyaluronic Acid+Niacinamide+Shea Butter) l Hydrating Moisturizer",
          after: "medicube Triple Collagen Cream Hydrating Face Moisturizer, 50 ml, with Niacinamide and Hyaluronic Acid",
          reason: "品牌、品类、容量依次呈现，完整成分表留给详情。" },
        { type: "photos", photos: [
          { src: jar, title: "先认出商品", caption: "用粉色罐身和产品名建立第一眼识别。", contain: true },
          { src: texture, title: "再看质地", caption: "开盖近景适合承接视频里的取用镜头。" },
          { src: routine, title: "说明使用顺序", caption: "以商品页护肤步骤图解释面霜的使用位置。", contain: true },
        ] },
      ],
    },
    {
      id: "market", nav: "市场竞争", title: "市场竞争格局与价格带",
      lead: "目标面霜近 90 天销量居五款样本第二。其 $15.20 展示价落在中间价带。",
      blocks: [
        { type: "charts", charts: [
          { type: "chart", kind: "bar", title: "五款面霜的 90 天销量", note: "美国站同类目样本，按销量排序。", unit: "销量（件）",
            points: comparisons.map(p => [p.name, p.units]) },
          { type: "chart", kind: "pie", title: "样本起售价分布", note: "每个商品计一款，按展示价下限归组。", unit: "商品数（款）",
            points: [["低于 $10", comparisons.filter(p => p.floor < 10).length], ["$10–19.99", comparisons.filter(p => p.floor >= 10 && p.floor < 20).length], ["$20 起", comparisons.filter(p => p.floor >= 20).length]] },
        ] },
        { type: "table", title: "比价样本", columns: ["商品", "展示价（USD）", "近 90 天销量"],
          rows: comparisons.map(p => [p.name, p.price, p.units.toLocaleString("en-US")]) },
      ],
    },
    {
      id: "search", nav: "关键词", title: "关键词与搜索机会",
      lead: "品牌词承接找同款的买家，品类词和成分词用于测试新流量。",
      blocks: [
        { type: "table", title: "TK 蓝海关键词 · 构造样本", columns: ["候选用词", "示例搜索量", "匹配商品", "机会指数", "建议位置"],
          rows: tkTerms.map(p => [p.term, p.searches.toLocaleString("en-US"), String(p.products), String(p.searches / p.products), p.use]) },
        { type: "charts", charts: [
          { type: "chart", kind: "bar", title: "TK 关键词机会", note: "示例搜索量 ÷ 匹配商品数。", unit: "机会指数",
            points: tkTerms.map(p => [p.term, p.searches / p.products]) },
          { type: "chart", kind: "bar", title: "Amazon 跨平台参考", note: "Amazon US 月搜索量，与左图口径独立。", unit: "月搜索量",
            points: [["face moisturizer", 354109], ["collagen moisturizer", 10758], ["niacinamide moisturizer", 1214]] },
        ] },
      ],
    },
    {
      id: "assessment", nav: "综合诊断", title: "Listing 综合诊断",
      lead: "每项可见证据计一分。转化表现留给店铺数据核对。",
      blocks: [{ type: "table", title: "商品页证据评分", columns: ["维度", "覆盖", "本次核对的两项证据", "优先级"],
        rows: [["标题信息", "1 / 2", "品类清楚，容量可前移", "优先改"], ["视觉说明", "2 / 2", "罐身图与质地近景齐备", "保留"], ["使用说明", "2 / 2", "有成分与使用顺序图", "保留"], ["内容覆盖", "2 / 2", "已有视频与达人关联", "对接商品页"], ["转化表现", "待核对", "待补商品卡点击与成交", "安排对照"]] }],
    },
    {
      id: "actions", nav: "行动方案", title: "Listing 优化行动方案",
      lead: "用同款素材把达人视频和商品页首屏接起来。",
      blocks: [{ type: "flow", title: "优先级与交付", steps: [
        { title: "P0 · 今天", text: "重排标题，补容量与开盖近景。" },
        { title: "P1 · 本周", text: "拍开盖、取用、推开三个镜头。" },
        { title: "P2 · 复盘", text: "在相近促销条件下比较点击与成交。" },
      ] }],
    },
    {
      id: "conclusion", nav: "结论", title: "核心结论",
      lead: "优先验证标题和质地近景。用同一周期的商品卡点击后成交率判断改版效果。",
      blocks: [{ type: "chart", kind: "line", title: "一周销售观察示例", note: "7 日合计 11,121 件，曲线为演示构造的每日分布。", unit: "示例销量（件）",
        points: [["11/21", 1234], ["11/22", 1472], ["11/23", 1390], ["11/24", 1638], ["11/25", 1714], ["11/26", 1909], ["11/27", 1764]] }],
    },
  ],
  sourceNote: "商品图来自 medicube US Store。商品及竞品快照参考 FastMoss，Amazon 词量参考 Sorftime。TK 关键词指数、逐日曲线与编辑评分为演示数据。",
};
