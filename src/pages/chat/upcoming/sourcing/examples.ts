import type { YjIconName } from "../../../../icons/registry";
import type { SelectionMode, StepId } from "./workflow";

const images = import.meta.glob<string>("./assets/*.webp", { eager: true, query: "?url", import: "default" });
function product(id: string, name: string, feature: string, budget: number, detailId?: string) {
  return {
    name, feature, budget,
    image: images[`./assets/${id}.webp`],
    detailImage: detailId ? images[`./assets/${detailId}.webp`] : undefined,
  };
}

// All amounts are local example assumptions in CNY per unit.
export const products = {
  sweaterBlue: product("sweater-blue-cable", "雾蓝绞花圆领毛衣", "细绞花 · 罗纹下摆", 46),
  sweaterCream: product("sweater-cream-cable", "米白菱纹绞花毛衣", "菱形绞花 · 宽松长袖", 59),
  sweaterBow: product("sweater-red-bow", "红色系带 V 领毛衣", "前襟蝴蝶结 · 短衣长", 48),
  sweaterIvory: product("sweater-ivory-turtleneck", "象牙白高领毛衣", "翻折高领 · 修身长袖", 40),
  sweaterCardigan: product("sweater-green-cardigan", "苔绿长款针织开衫", "敞开前襟 · 贴袋", 65),
  sweaterPattern: product("sweater-geometric", "几何纹 V 领毛衣", "双色纹样 · 波浪领边", 49),
  sweaterCocoa: product("sweater-cocoa", "可可色宽袖毛衣", "圆领 · 罗纹袖口", 52),
  sweaterKnot: product("sweater-grey-knot", "灰色打结下摆毛衣", "短款衣身 · 系结下摆", 44),

  hatStraw: product("hat-straw-braid", "草编饰带宽檐帽", "圆顶帽冠 · 编织饰带", 22, "hat-straw-band-detail"),
  hatRound: product("hat-natural-round", "自然色圆顶遮阳帽", "上翻宽檐 · 素色编纹", 32),
  hatCord: product("hat-ivory-cord", "系绳编织遮阳帽", "宽平帽檐 · 防风系绳", 28),
  hatBucket: product("hat-red-bucket", "莓红渔夫帽", "短帽檐 · 环形饰带", 19),
  hatMesh: product("hat-black-organza", "黑色花饰纱帽", "透纱宽檐 · 立体花饰", 36),

  shoeRose: product("shoe-rose-runner", "藕粉厚底跑鞋", "系带鞋面 · 加厚中底", 78),
  shoeRetro: product("shoe-cream-retro", "奶油色复古运动鞋", "拼接鞋面 · 深色外底", 68),
  shoeNavy: product("shoe-navy-mesh", "深蓝网面运动鞋", "网眼鞋面 · 后跟气垫", 56),
  shoeTeal: product("shoe-teal-walking", "青蓝拼色健走鞋", "网面低帮 · 分块纹路外底", 54),
  shoePurple: product("shoe-purple-runner", "紫色网面跑鞋", "系带低帮 · 弧形白底", 70),
  shoeRoad: product("shoe-white-road", "白色低帮公路跑鞋", "网布鞋身 · 浅色中底", 73),
  shoeKnit: product("shoe-white-knit", "白金配色针织运动鞋", "针织鞋身 · 一体式鞋口", 67),
  shoeBlack: product("shoe-black-runner", "黑色厚底跑鞋", "同色鞋带 · 加厚外底", 65),
  shoeWide: product("shoe-brown-walking", "棕色宽头健走鞋", "宽鞋头 · 拼色分区外底", 56),
  shoeLilac: product("shoe-ice-lilac", "冰紫拼色跑鞋", "浅色鞋身 · 三条纹侧饰", 74),

  bottlePink: product("bottle-pink-freesip", "粉色双饮口水瓶", "撞色翻盖 · 直筒瓶身", 35),
  bottleNavy: product("bottle-navy-loop", "深蓝提环运动水瓶", "提环瓶盖 · 旋拧饮口", 30),
  bottleMint: product("bottle-mint-twist", "薄荷绿旋盖水瓶", "撞色瓶盖 · 窄口瓶肩", 29),
  bottleSmoke: product("bottle-smoke-strap", "烟灰渐变提带水瓶", "渐变瓶身 · 侧边提带", 24),
  bottleDot: product("bottle-polka-dot", "黑白波点水瓶", "波点瓶身 · 黑色瓶盖", 27),
  bottleLids: product("bottle-multi-lid", "大容量多盖运动水瓶", "宽口瓶身 · 三种瓶盖", 42),

  gownLace: product("gown-champagne-lace", "香槟色蕾丝晚礼服", "蕾丝上身 · 开衩长裙", 126, "gown-lace-bodice-detail"),
  gownSequin: product("gown-burgundy-sequin", "酒红亮片流苏礼服", "V 领亮片 · 流苏袖饰", 138),
  gownPleated: product("gown-black-pleated", "黑色单肩晚礼服", "不对称领口 · 收褶腰线", 108),

  headphoneMauve: product("headphone-mauve-overear", "灰紫色包耳式头戴耳机", "宽头梁 · 椭圆耳罩", 85),
  headphoneBlue: product("headphone-blue-overear", "深蓝色头戴式耳机", "弧形头梁 · 圆角耳罩", 110),
  headphoneHinge: product("headphone-black-hinge", "铰链式头戴耳机", "可见铰链 · 厚耳垫", 72),
  headphoneSlim: product("headphone-charcoal-overear", "炭黑色头戴耳机", "纤细头梁 · 内凹耳罩", 88),
} as const;
export type ProductId = keyof typeof products;

type CoverPanel =
  | { label: string; photos: ProductId[]; closeup?: boolean }
  | { label: string; notes: { icon: YjIconName; text: string }[] };
export interface SelectionScene {
  id: SelectionMode;
  label: string;
  detail: string;
  premise: string;
  overview: [string, string];
  products: ProductId[];
  cover: CoverPanel[];
  notes: Partial<Record<StepId, string>>;
}

export const selectionScenes: SelectionScene[] = [
  {
    id: "full", label: "全量", detail: "从市场机会到逐站核对",
    premise: "以女式毛衣为例，从通勤、叠穿需求出发，筛选款式、核对货源，再逐站测算。",
    overview: ["对照圆领套头衫、高领毛衣和长开衫，整理不同穿搭场景需要的领型、针法与尺码。", "记录候选款的纱线成分、洗护说明和样衣来源，供后续比款与核价使用。"],
    products: ["sweaterBlue", "sweaterCream", "sweaterBow", "sweaterIvory", "sweaterCardigan", "sweaterPattern", "sweaterCocoa", "sweaterKnot"],
    cover: [
      { label: "市场与商品", photos: ["sweaterBlue", "sweaterBow", "sweaterIvory"] },
      { label: "逐站复核", notes: [{ icon: "globe", text: "TikTok" }, { icon: "store", text: "Amazon" }] },
    ],
    notes: { definition: "若发现值得开发的缺口，在这里整理概念、规格和验收标准。现成商品可沿既有规格继续核对。" },
  },
  {
    id: "follow", label: "跟卖", detail: "对标同款 · 核价与准入",
    premise: "从一顶草编宽檐女帽开始核对同款，再按目标站点比较履约成本和销售资格。",
    overview: ["用帽冠形状、帽檐宽度和饰带编法对照外观，再核实款号、帽围与颜色。", "向供货方核对包装、来源凭据和销售资格，资料齐备后再比较同款成本。"],
    products: ["hatStraw", "hatRound", "hatCord", "hatBucket", "hatMesh"],
    cover: [{ label: "对标商品", photos: ["hatStraw"] }, { label: "同款核验", photos: ["hatStraw"], closeup: true }],
    notes: { competition: "对齐帽款、帽围与颜色后，再比较同款的售价区间与竞争卖家。", sourcing: "按对标款核对尺寸、材质和可追溯的供货依据。示例报价用于比较采购条件。" },
  },
  {
    id: "bulk", label: "铺货", detail: "批量筛选 · 低成本试卖",
    premise: "从十款女式运动鞋中批量筛选试卖款，按尺码备货，再逐站比较履约成本。",
    overview: ["先按跑步、健走和日常穿搭整理鞋款，核对每款可订的颜色、尺码和补货周期。", "把鞋盒尺寸和单箱双数计入试卖预算，避免同款多色、多码占用过多首批库存。"],
    products: ["shoeRose", "shoeRetro", "shoeNavy", "shoeTeal", "shoePurple", "shoeRoad", "shoeKnit", "shoeBlack", "shoeWide", "shoeLilac"],
    cover: [{ label: "批量候选", photos: ["shoeRose", "shoeRetro", "shoePurple", "shoeNavy", "shoeTeal", "shoeRoad"] }],
    notes: { filter: "按采购预算、尺码覆盖和鞋盒体积分批筛入，优先保留能及时补码的款式。", targets: "同一批商品分别核对各目标站点的履约、利润与准入，试卖后再复看表现。" },
  },
  {
    id: "curated", label: "精铺", detail: "垂类精筛 · 小批试款",
    premise: "聚焦随行水瓶（Water Bottle），比较容量、饮口和携带方式，选出首批试款组合。",
    overview: ["对照通勤包、健身房和户外补水场景，比较双饮口、提环和多盖水瓶。", "核对容量、瓶盖结构和颜色能否混批，先用小批试款验证需求，再决定补货。"],
    products: ["bottlePink", "bottleNavy", "bottleMint", "bottleSmoke", "bottleDot", "bottleLids"],
    cover: [{ label: "垂类候选", photos: ["bottleNavy", "bottleDot", "bottlePink"] }, { label: "小批试款", photos: ["bottlePink"] }],
    notes: { demand: "分别记录通勤与运动人群对容量、开盖方式和清洗便利性的偏好。", inquiry: "确认小批起订量、补货交期与混批条件，再决定首批 SKU 组合。" },
  },
  {
    id: "boutique", label: "精品", detail: "单品深研 · 质量与收益",
    premise: "以一款女式晚礼服为主样，核对版型、装饰做工和批次质量，再评估单品投入。",
    overview: ["以香槟色蕾丝礼服为主样，对照全身裙型和近景，核对肩部花饰、蕾丝拼接与腰褶做工。", "用不同尺码的样衣复核胸腰围与裙长，再估算包装、退换和小批备货成本。"],
    products: ["gownLace", "gownSequin", "gownPleated"],
    cover: [{ label: "重点单品", photos: ["gownLace"] }, { label: "做工核验", photos: ["gownLace"], closeup: true }],
    notes: { demand: "围绕宴会穿着场合、尺码反馈和购买季节判断主推款。", sourcing: "核对面料色差、装饰牢固度和批次一致性，并保留备选货源。", inquiry: "记录样衣各尺码的成衣尺寸、装饰工艺和运输防护，再确认批量交付条件。" },
  },
  {
    id: "develop", label: "开品", detail: "需求洞察 · 产品定义与打样",
    premise: "从头戴式耳机的佩戴需求出发，用参考样品明确头梁与耳罩规格，再通过打样验证。",
    overview: ["对照不同头梁和耳罩结构，记录佩戴时的夹力、耳垫贴合度和调节行程。", "将待验证的问题写进规格草案，复核制造可行性并验样后，再逐站测算。"],
    products: ["headphoneMauve", "headphoneBlue", "headphoneHinge", "headphoneSlim"],
    cover: [
      { label: "参考样品", photos: ["headphoneMauve"] },
      { label: "规格草案", notes: [{ icon: "skillProductAttributes", text: "头梁调节" }, { icon: "checkmark", text: "耳罩贴合" }] },
    ],
    notes: { definition: "将整机重量、头梁调节范围和耳罩尺寸写入规格，约定试戴与反复伸缩的验样方法。", sourcing: "按设计要求寻找能配合样件和工艺验证的工厂，先评估可行性，再决定是否投入打样。", inquiry: "按验收项检查样件。若需返工，回到对应的需求、方案或工艺环节。通过后定版规格、报价与包装重量。" },
  },
];

export const marketplaces = [
  { id: "tk-us", label: "TikTok Shop · 美国站", route: "跨境直发报价", shipping: 12, fees: 6 },
  { id: "tk-gb", label: "TikTok Shop · 英国站", route: "本地仓与尾程报价", shipping: 14, fees: 7 },
  { id: "amz-us", label: "Amazon · 美国站", route: "头程与仓配报价", shipping: 16, fees: 8 },
  { id: "amz-de", label: "Amazon · 德国站", route: "入仓与本地配送报价", shipping: 18, fees: 9 },
] as const;
export type MarketId = typeof marketplaces[number]["id"];
