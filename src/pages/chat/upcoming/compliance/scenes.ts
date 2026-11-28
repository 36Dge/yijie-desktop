import ring from "./assets/B0GRK9KZ2P.webp";
import rim from "./assets/B0GRK9KZ2P-rim.webp";
import bidet from "./assets/B0FCSW4DNS.webp";
import controller from "./assets/B0FCSW4DNS-control.webp";
import brush from "./assets/B0G67KHJ47.webp";
import mark from "./assets/B0G67KHJ47-mark.webp";
import chair from "./assets/B07WP389M9.webp";
import perfume from "./assets/B00O9MZ1UY.webp";
import tee from "./assets/B0H2DCF4M2.webp";
import print from "./assets/B0H2DCF4M2-print.webp";

export type CheckId = "appearance" | "invention" | "graphic" | "word" | "policy" | "copyright";
export interface ReviewPoint { title: string; note: string }
export interface ComplianceScene {
  id: CheckId;
  label: string;
  detail: string;
  product: string;
  asin: string;
  photo: string;
  focusPhoto?: string;
  controlPhoto?: string;
  photoLabel?: string;
  coverLabels: [string, string];
  stages: [string, string, string];
  keyword?: { label: string; value: string };
  watchWords?: string[];
  listing?: { title: string; description: string; language: "英文" | "中英文"; descriptionLimit: number; titleLimit?: number };
  target?: "country" | "site";
  checks: ReviewPoint[];
}

export const complianceScenes: ComplianceScene[] = [
  {
    id: "appearance", label: "外观专利", detail: "智能戒指 · 戒圈轮廓比对",
    product: "Oura Ring 5 金色智能戒指", asin: "B0GRK9KZ2P", photo: ring, focusPhoto: rim,
    photoLabel: "商品图", coverLabels: ["商品外观", "戒圈轮廓"],
    stages: ["准备外观图", "对照设计特征", "复核记录"],
    keyword: { label: "关键词", value: "smart ring" }, target: "country",
    checks: [
      { title: "整体轮廓", note: "用同一视角对照商品外廓、比例与候选设计的附图。" },
      { title: "局部细节", note: "标出内外表面的过渡、边缘和开口，记录相同与不同之处。" },
      { title: "权利文件", note: "按所选国家核对候选文献的图号、权利状态与查询日期。" },
    ],
  },
  {
    id: "invention", label: "发明专利", detail: "电子坐便盖 · 功能与结构",
    product: "TOTO WASHLET KS6 电子坐便盖", asin: "B0FCSW4DNS", photo: bidet, controlPhoto: controller,
    photoLabel: "产品参考图", coverLabels: ["产品资料", "技术特征"],
    stages: ["描述产品", "拆解技术特征", "复核记录"],
    listing: { title: "TOTO WASHLET KS6 Electronic Bidet Seat", description: "An elongated electronic bidet seat with an instant water heater and a self-cleaning spray wand.", language: "英文", descriptionLimit: 30000 },
    target: "country",
    checks: [
      { title: "部件与功能", note: "从描述中区分部件、工作顺序和实现方式，列出需要技术资料佐证的特征。" },
      { title: "权利要求比对", note: "把各项技术特征与候选专利的具体权利要求逐项对应，保留原文出处。" },
      { title: "国家与状态", note: "复核文献所属国家及当前权利状态，记录仍需补充的结构说明。" },
    ],
  },
  {
    id: "graphic", label: "图形商标", detail: "电动牙刷 · 包装图标提取",
    product: "Philips Sonicare 7300 电动牙刷", asin: "B0G67KHJ47", photo: brush, focusPhoto: mark,
    photoLabel: "商标图像", coverLabels: ["商品包装", "包装图标"],
    stages: ["准备标识图", "比对图形要素", "复核记录"],
    keyword: { label: "产品关键词", value: "electric toothbrush" }, target: "country",
    checks: [
      { title: "图形构成", note: "核对标识的外框、内部图案和文字排列，保留原图与清晰局部。" },
      { title: "相似标识", note: "将候选标识与上传图像并列观察，记录近似点及差异。" },
      { title: "注册范围", note: "在所选国家复核商品或服务类别、权利人及登记状态。" },
    ],
  },
  {
    id: "word", label: "文本商标", detail: "儿童坐便椅 · 标题品牌词",
    product: "BabyBjörn 深绿色儿童坐便椅", asin: "B07WP389M9", photo: chair,
    coverLabels: ["示例商品", "标题用词"], stages: ["填写英文文案", "提取待查词", "复核记录"], watchWords: ["BabyBjörn", "BabyBjorn"],
    listing: { title: "BabyBjörn Potty Chair, Deep Green/White", description: "BabyBjörn potty chair with a high backrest and a removable white inner bowl.", language: "英文", titleLimit: 300, descriptionLimit: 5000 },
    target: "country",
    checks: [
      { title: "标题与描述用词", note: "标出品牌名、系列名与其上下文，保留原文拼写。" },
      { title: "近似拼写", note: "对照大小写、重音符号和相近拼写，记录需要检索的词组。" },
      { title: "使用依据", note: "结合目标国家及商品类别，复核品牌词使用依据和候选登记信息。" },
    ],
  },
  {
    id: "policy", label: "政策合规", detail: "男士淡香水 · 站点与包装",
    product: "Banderas King of Seduction 淡香水", asin: "B00O9MZ1UY", photo: perfume,
    photoLabel: "商品与包装图", coverLabels: ["商品包装", "站点核对"],
    stages: ["准备商品资料", "核对站点要求", "复核记录"],
    listing: { title: "Banderas King of Seduction Eau de Toilette, 3.4 fl oz", description: "Men’s eau de toilette in a glass spray bottle. The carton displays the fragrance name and the 100 ml / 3.4 fl oz volume.", language: "中英文", descriptionLimit: 5000 },
    target: "site",
    checks: [
      { title: "刊登文案", note: "对照商品图、标题与描述，核对用途、剂型和净含量表述是否一致。" },
      { title: "平台与站点", note: "按所选平台、销售地和类目查阅适用政策，保存来源与版本。" },
    ],
  },
  {
    id: "copyright", label: "版权", detail: "花卉印花 T 恤 · 图案溯源",
    product: "rosemia 米色花卉印花 T 恤", asin: "B0H2DCF4M2", photo: tee, focusPhoto: print,
    photoLabel: "作品或商品图", coverLabels: ["商品原图", "印花局部"],
    stages: ["准备作品图", "核对创作来源", "复核记录"],
    checks: [
      { title: "作品要素", note: "标明需要比对的图案、文字与构图，保留作品在商品上的使用位置。" },
      { title: "来源对照", note: "核对原稿、首次发布来源或候选作品，记录可追溯的时间与出处。" },
      { title: "授权范围", note: "检查许可材料中列出的商品用途、地域和期限，记录缺失项。" },
    ],
  },
];
