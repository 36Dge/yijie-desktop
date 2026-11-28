import amazonPortrait from "./assets/amazon-portrait.webp";
import amazonKnit from "./assets/amazon-knit.webp";
import tkJar from "./assets/tk-jar.webp";
import tkTexture from "./assets/tk-texture.webp";
import camera from "./assets/shopify-camera.webp";
import pov from "./assets/shopify-pov.webp";
import bottle from "./assets/shopee-bottle.webp";
import pour from "./assets/shopee-serving.webp";
import lamp from "./assets/shein-lamp.webp";
import shade from "./assets/shein-shade.webp";
import sneaker from "./assets/ozon-sneaker.webp";
import walking from "./assets/ozon-walking.webp";

export type ReportPlatform = "amazon" | "tk";
type Platform = ReportPlatform | "shopify" | "shopee" | "shein" | "ozon";
export interface ListingPhoto { src: string; label: string; contain?: boolean }
export interface ListingScene {
  id: Platform;
  label: string;
  detail: string;
  productId: string;
  photos: [ListingPhoto, ListingPhoto];
}
export const listingScenes: ListingScene[] = [
  { id: "amazon", label: "Amazon 平台", detail: "绞花高领毛衣 · 搜索与转化", productId: "B07QC4GG7R",
    photos: [{ src: amazonPortrait, label: "正面版型" }, { src: amazonKnit, label: "绞花针法" }] },
  { id: "tk", label: "TK 平台", detail: "胶原保湿面霜 · 商品与内容", productId: "1729471516161183979",
    photos: [{ src: tkJar, label: "罐装面霜", contain: true }, { src: tkTexture, label: "乳霜质地" }] },
  { id: "shopify", label: "Shopify 平台", detail: "双机位数码相机", productId: "B0H5J9QCKP",
    photos: [{ src: camera, label: "相机套装", contain: true }, { src: pov, label: "挂戴拍摄" }] },
  { id: "shopee", label: "Shopee 平台", detail: "无酒精黑姜开胃饮", productId: "B0CCQMLB55",
    photos: [{ src: bottle, label: "瓶身包装", contain: true }, { src: pour, label: "倒饮场景" }] },
  { id: "shein", label: "SHEIN 平台", detail: "亚麻灯罩调光落地灯", productId: "B0FZGW3MY5",
    photos: [{ src: lamp, label: "客厅陈列" }, { src: shade, label: "灯罩细节" }] },
  { id: "ozon", label: "Ozon 平台", detail: "米绿拼色宽楦童鞋", productId: "B0F1K7WWPM",
    photos: [{ src: sneaker, label: "宽鞋头", contain: true }, { src: walking, label: "上脚场景" }] },
];
export function hasListingReport(scene: ListingScene): scene is ListingScene & { id: ReportPlatform } {
  return scene.id === "amazon" || scene.id === "tk";
}
