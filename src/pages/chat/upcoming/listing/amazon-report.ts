import main from "./assets/amazon-main.webp";
import front from "./assets/amazon-front.webp";
import knit from "./assets/amazon-knit.webp";
import back from "./assets/amazon-back.webp";
import type { PlatformReport } from "./report-model";

export const amazonReport: PlatformReport = {
  name: "奶油色绞花高领毛衣", market: "Amazon 美国站", identifier: "ASIN",
  summary: "绞花和翻领在照片里一眼可见。标题应补上纯棉，尺码说明应回答袖长与叠穿余量。",
  metrics: [{ label: "展示价", value: "$18.90" }, { label: "商品页评分", value: "4.5 / 5" },
    { label: "关联评分数", value: "13,670" }, { label: "关联变体", value: "108" }],
  overview: [{ title: "产品定位", text: "常规版型的纯棉针织衫" }, { title: "目标用户", text: "偏爱棉质秋冬基础款的买家" }, { title: "核心场景", text: "通勤叠穿与周末单穿" }],
  sections: [
    {
      id: "copy", nav: "文案质量", title: "文案质量分析", lead: "把材质放回标题前段，五点描述依次回答选料、织法、领型、版型和洗护。",
      blocks: [
        { type: "rewrite", before: "Amazon Essentials Women’s Long Sleeve Fisherman Cable Knit Turtleneck Sweater, Cream, Large",
          after: "Amazon Essentials Women's 100% Cotton Fisherman Cable Knit Turtleneck Sweater, Long Sleeve, Cream, Large",
          reason: "保留颜色和尺码，将商品属性里已有的 100% Cotton 提前。" },
        { type: "flow", title: "五点描述与关键参数", steps: [
          { title: "材质", text: "100% 棉" }, { title: "纹理", text: "渔夫绞花" }, { title: "领口", text: "可翻折高领" },
          { title: "版型", text: "常规剪裁、长袖" }, { title: "洗护", text: "冷水机洗、平摊晾干" },
        ] },
      ],
    },
    {
      id: "visuals", nav: "视觉图片", title: "视觉图片分析", lead: "先辨认款式，再验证穿着比例与针法。图片顺序也为商品识别提供了品类、领型和面料线索。",
      blocks: [
        { type: "photos", photos: [
          { src: main, title: "白底主图", caption: "交代颜色与完整款式。", contain: true },
          { src: front, title: "正面上身", caption: "看肩宽、袖长和下摆。" },
          { src: knit, title: "领口与绞花", caption: "放大织纹，验证标题卖点。" },
          { src: back, title: "背面版型", caption: "补足背部松量与衣长。" },
        ] },
        { type: "notes", items: [{ title: "下一张图", text: "把模特身高、所穿尺码与袖长放在同一张上身图，减少买家来回查找。" }] },
      ],
    },
    {
      id: "traffic", nav: "关键词与流量", title: "关键词与流量分析", lead: "品类词承接宽泛需求，材质和领型词更适合写入标题与属性。广告测试单独观察各组转化。",
      blocks: [
        { type: "charts", charts: [
          { type: "chart", kind: "pie", title: "按搜索意图归因", note: "构造的 100 次访问，各按一个主要意图归组。", unit: "示例访问次数",
            points: [["核心品类", 46], ["棉质面料", 27], ["高领版型", 18], ["品牌", 9]] },
          { type: "chart", kind: "line", title: "入秋销量走势", note: "2026 年 5–10 月，商品关联变体的月销量估算。", unit: "月销量（件）",
            points: [["5 月", 412], ["6 月", 558], ["7 月", 399], ["8 月", 465], ["9 月", 1201], ["10 月", 4263]] },
        ] },
        { type: "table", title: "重点关键词", columns: ["关键词", "月搜索量", "最近自然位置", "落点"],
          rows: [["cotton sweaters for women", "100,940", "第 2 页第 4 位", "标题、材质属性"],
            ["turtle neck sweater for women", "70,090", "第 1 页第 15 位", "领型、五点描述"],
            ["cable knit sweater", "33,524", "第 1 页第 48 位", "织纹副图"]] },
      ],
    },
    {
      id: "reviews", nav: "口碑评价", title: "口碑评价分析", lead: "关联变体的评论提到棉质手感，也出现袖长和不同颜色尺码不一的反馈。先解决买家选码时的问题。",
      blocks: [
        { type: "chart", kind: "bar", title: "买家最想确认什么", note: "100 条构造的评论，每条按一个主要主题计数。", unit: "示例评论数",
          points: [["尺码与衣长", 42], ["面料手感", 28], ["领口舒适度", 18], ["洗后变化", 12]] },
        { type: "flow", title: "核心使用场景与买家关注点", steps: [
          { title: "通勤叠穿", text: "外套下是否臃肿" }, { title: "周末单穿", text: "衣长与下摆落点" }, { title: "室内久穿", text: "棉质手感与领口贴合" },
        ] },
      ],
    },
    {
      id: "strategy", nav: "竞品与策略", title: "竞品打法总复盘与我方策略",
      lead: "同类款通过宽松、短款或羊毛混纺形成区隔。这件毛衣更适合围绕纯棉、常规剪裁和清晰尺码建立购买理由。",
      blocks: [
        { type: "chart", kind: "bar", title: "四款针织衫的展示价", note: "同站选样，按展示价比较。目标款为 Amazon Essentials。", unit: "售价（USD）",
          points: [["目标款", 18.90], ["ANRABESS", 25.99], ["Trendy Queen", 29.99], ["ZAFUL", 33.99]] },
        { type: "matrix", title: "卖点四维体检 · 示例评估", columns: ["标题", "五点", "图片", "参数"], rows: [
          { label: "纯棉材质", values: ["可补", "已有", "可补", "已有"] },
          { label: "渔夫绞花", values: ["已有", "已有", "已有", "已有"] },
          { label: "穿着与尺码", values: ["已有", "可补", "可补", "待核"] },
        ] },
        { type: "flow", title: "人货场三维罗盘", steps: [
          { title: "人", text: "想买棉质基础款，希望一次选对码。" }, { title: "货", text: "纯棉与翻折领可用织纹近景验证。" }, { title: "场", text: "用通勤叠穿照说明厚度和松量。" },
        ] },
        { type: "notes", items: [
          { title: "立即改", text: "前移纯棉信息，补齐关键尺寸与洗护说明。" },
          { title: "补一张图", text: "拍同款与外套叠穿，在图旁标注模特和实物尺寸。" },
          { title: "验证效果", text: "在相同价格条件下，对照商品页转化与尺码相关退货原因。" },
        ] },
      ],
    },
  ],
  sourceNote: "章节依据提供的全景分析报告。商品照片、规格、关键词和价格参考 Amazon US 与 Sorftime。访问分布、评论主题占比与四维体检为展示用示例。",
};
