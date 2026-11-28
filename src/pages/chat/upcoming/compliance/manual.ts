import type { CheckId, ComplianceScene, ReviewPoint } from "./scenes";

export const countries = ["US 美国", "GB 英国", "DE 德国", "JP 日本"];
export const sites = ["Amazon · 美国站", "Amazon · 英国站", "Amazon · 德国站", "TikTok Shop · 美国站", "TikTok Shop · 英国站"];

export type CheckImage = { name: string; source: File | string } | { name: string; link: string };
export interface ManualDraft {
  image: CheckImage | null;
  keyword: string;
  markText: string;
  title: string;
  description: string;
  targets: string[];
  sku: string;
  wordList: string;
  features: string;
  extended: boolean;
}

export function makeDraft(scene: ComplianceScene, sample: boolean): ManualDraft {
  const target = scene.target === "site" ? sites[0] : countries[0];
  const image = sample && scene.photoLabel
    ? { name: scene.id === "graphic" ? "Sonicare 包装图标" : scene.product,
      source: scene.id === "graphic" ? scene.focusPhoto ?? scene.photo : scene.photo }
    : null;
  return {
    image, keyword: sample ? scene.keyword?.value ?? "" : "",
    markText: sample && scene.id === "graphic" ? "PHILIPS" : "",
    title: sample ? scene.listing?.title ?? "" : "", description: sample ? scene.listing?.description ?? "" : "",
    targets: scene.target ? [target] : [], sku: "", wordList: "", features: sample && scene.id === "policy" ? "喷雾包装、净含量" : "", extended: false,
  };
}

function supportsLanguage(value: string, language: "英文" | "中英文") {
  const letters = language === "英文" ? /\p{Script=Latin}/u : /[\p{Script=Han}\p{Script=Latin}]/u;
  return (letters.test(value) || /\d/.test(value)) && [...value].every(c => !/\p{L}/u.test(c) || letters.test(c));
}

export function draftIssue(scene: ComplianceScene, draft: ManualDraft): string {
  const needsImage = ["appearance", "graphic", "copyright"].includes(scene.id) || (scene.id === "invention" && draft.extended);
  if (needsImage && !draft.image) return "请添加" + scene.photoLabel;
  if (scene.id === "appearance" && draft.keyword.trim() && !supportsLanguage(draft.keyword, "中英文")) return "请使用中文或英文填写关键词";
  if (scene.listing) {
    const { language } = scene.listing;
    if (!draft.title.trim() || !draft.description.trim()) return "请填写产品标题与产品描述";
    if (![draft.title, draft.description].every(value => supportsLanguage(value, language))) {
      return "请使用" + language + "填写产品标题与描述";
    }
    if (scene.listing.titleLimit && draft.title.length > scene.listing.titleLimit) return "产品标题超过字数上限";
    if (draft.description.length > scene.listing.descriptionLimit) return "产品描述超过字数上限";
  }
  if (scene.target && draft.targets.length === 0) return scene.target === "site" ? "请选择上架平台与站点" : "请选择上架国家";
  return "";
}

export interface CheckRecord {
  id: number;
  mode: CheckId;
  name: string;
  time: string;
  sku: string;
  material: CheckImage | null;
  fields: { label: string; value: string }[];
  points: ReviewPoint[];
  reviewed: string[];
}

export function recordFromDraft(scene: ComplianceScene, draft: ManualDraft, id: number): CheckRecord {
  const fields: CheckRecord["fields"] = [];
  const add = (label: string, value: string | undefined) => {
    if (value?.trim()) fields.push({ label, value: value.trim() });
  };
  if (scene.photoLabel && draft.image) add(scene.photoLabel, "link" in draft.image ? draft.image.link : draft.image.name);
  if (scene.keyword) add(scene.keyword.label, draft.keyword);
  if (scene.id === "graphic") add("商标文字", draft.markText);
  if (scene.listing) { add("产品标题", draft.title); add("产品描述", draft.description); }
  if (scene.target) add(scene.target === "site" ? "上架平台与站点" : "上架国家", draft.targets.join("、"));
  if (scene.id === "word") add("词库", draft.wordList);
  if (scene.id === "policy") add("待查特征", draft.features);
  add("SKU", draft.sku);
  const points = [...scene.checks];
  if (scene.watchWords && draft.wordList) {
    const text = (draft.title + " " + draft.description).toLocaleLowerCase();
    const terms = scene.watchWords.filter(term => text.includes(term.toLocaleLowerCase()));
    points.push({ title: "关注词定位", note: terms.length
      ? "文案中出现了 " + terms.join("、") + "，请核对使用位置与登记资料。"
      : "当前文案未包含示例词库中的词条，其他用词可继续人工核对。" });
  }
  if (scene.id === "policy" && draft.features.trim()) {
    points.push({ title: "商品特征", note: "对照实物、包装与刊登文案，逐项核对“" + draft.features.trim() + "”并记录来源。" });
  }
  if (scene.id === "invention" && draft.extended) points.push({ title: "智能识别复核", note: "对照参考图片和产品描述，核实待识别的部件与功能。" });
  if (scene.id === "copyright" && draft.extended) points.push({ title: "全网扫描范围", note: "整理公开图片的比对范围，待查询后保存来源与比对证据。" });
  return {
    id, mode: scene.id, time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    name: draft.title.trim() || draft.keyword.trim() || draft.image?.name || scene.product,
    sku: draft.sku.trim(), material: scene.photoLabel ? draft.image : null, fields, points, reviewed: [],
  };
}

export function isReviewed(record: CheckRecord) { return record.points.every(point => record.reviewed.includes(point.title)); }
