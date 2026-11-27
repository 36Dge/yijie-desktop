import libraryProduct from "./assets/video-demo-ninja-product.webp";

export type ConfigSection = "direction" | "product" | "targeting" | "settings";
export type OptionalChip = Exclude<ConfigSection, "product">;
export type ProductField = "name" | "core" | "brand" | "category" | "sku";
export type MaterialSlot = "商品图" | "模特图" | "场景图" | "风格图" | "爆款参考图" | "参考视频" | "包装图" | "起始图";
export interface Material { name: string; src: string | File; poster?: string }
export interface Product {
  name: string; core: string; brand: string; category?: string; sku?: string;
  recognized: number; source: string;
}
export interface DraftFields {
  productSource: "链接" | "商品库" | "文档" | "上传图片";
  productLink: string;
  product: Product;
  manualFields: ProductField[];
  materials: Partial<Record<MaterialSlot, Material[]>>;
  platform: string;
  market: string;
  language: string;
  removed: OptionalChip[];
}
export const languagesByMarket: Record<string, string> = { 美国站: "英语", 英国站: "英语", 日本站: "日语", 德国站: "德语" };
export const targetingLabel = (config: DraftFields) => [config.platform, config.market, config.language].join(" · ");

export function applyLibraryProduct(config: DraftFields, primary: MaterialSlot, includeDetails: boolean) {
  const example = {
    name: "Ninja BC151BK Blast Cordless Portable Blender, 18 oz, Black",
    core: "无线便携、18 oz 容量、Sip Lid 直饮杯盖、USB-C 充电", brand: "Ninja", category: "便携式搅拌机", sku: "BC151BK",
  };
  const fields: ProductField[] = ["name", "core", "brand"];
  if (includeDetails) fields.push("category", "sku");
  for (const field of fields) if (!config.manualFields.includes(field)) config.product[field] = example[field];
  config.product.source = "商品库";
  config.product.recognized = 8;
  config.materials[primary] = [{ name: "Ninja Blast Blender", src: libraryProduct }];
  config.platform = "亚马逊";
  config.market = "美国站";
  config.language = "英语";
}
