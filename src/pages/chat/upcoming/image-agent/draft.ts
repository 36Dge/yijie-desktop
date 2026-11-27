import { toRaw } from "vue";
import { imageScenes, type SceneId } from "./scenes";
import libraryScene from "../agent/assets/video-demo-ninja-scene.webp";
import { applyLibraryProduct, type DraftFields, type MaterialSlot } from "../agent/config";

export type OutputKind = "white" | "scene" | "selling" | "desktopAPlus" | "mobileAPlus";
export interface ImageConfig extends DraftFields {
  kind: "image";
  direction: SceneId;
  sizes: Record<SceneId, { ratio: string; count: number }>;
  suite: {
    outputs: Record<OutputKind, { enabled: boolean; count: number }>;
    aPlus: boolean; advanced: boolean; ratio: string; customRatio: string; noText: boolean;
  };
}
export interface ImageAgentState { selected: SceneId; config: ImageConfig | null }
export const newImageAgentState = (): ImageAgentState => ({ selected: "suite", config: null });
export const ratios = ["自适应", "1:1", "3:4", "4:3", "16:9", "9:16"];
export const ratioHints = ["有素材跟随素材，无素材按平台", "正方形", "竖版", "横版", "横屏", "竖屏"];
export const suiteTypes = { white: "白底图", scene: "场景图", selling: "卖点图" } as const;

function suiteSettings(demo: boolean): ImageConfig["suite"] {
  return {
    outputs: {
      white: { enabled: true, count: demo ? 1 : 3 }, scene: { enabled: true, count: demo ? 1 : 4 },
      selling: { enabled: true, count: demo ? 1 : 3 }, desktopAPlus: { enabled: true, count: demo ? 1 : 2 },
      mobileAPlus: { enabled: false, count: 0 },
    },
    aPlus: true, advanced: true, ratio: "自适应", customRatio: "", noText: false,
  };
}

export function demoConfig(id: SceneId, previous: ImageConfig | null): ImageConfig {
  const scene = imageScenes[id];
  const sizes = previous ? structuredClone(toRaw(previous.sizes))
    : Object.fromEntries(Object.keys(imageScenes).map(key => [key, { ratio: "自适应", count: 4 }])) as ImageConfig["sizes"];
  sizes[id] = { ratio: "自适应", count: id === "aplus" ? 2 : 1 };
  const materials: ImageConfig["materials"] = {};
  for (const material of scene.materials) materials[material.slot] = [{ name: material.name, src: material.src }];
  return {
    kind: "image", direction: id, productSource: "商品库", productLink: "",
    product: { ...scene.product, source: "一键试用演示" }, materials, manualFields: [],
    platform: "亚马逊", market: "美国站", language: "英语", sizes, removed: [],
    suite: id !== "suite" && previous ? structuredClone(toRaw(previous.suite)) : suiteSettings(id === "suite"),
  };
}

export function requiredSlots(id: SceneId): MaterialSlot[] {
  return id === "replace" ? ["商品图", "爆款参考图"] : ["商品图"];
}
export function optionalSlots(config: ImageConfig): MaterialSlot[] {
  switch (config.direction) {
    case "suite": return config.suite.aPlus ? ["场景图", "模特图", "风格图"] : ["场景图", "模特图"];
    case "model": return ["模特图", "场景图"];
    case "scene": return ["场景图"];
    case "aplus": return ["风格图"];
    default: return [];
  }
}
export function missingSlots(config: ImageConfig) {
  return requiredSlots(config.direction).filter(slot => !config.materials[slot]?.length);
}
export function selectedImages(config: ImageConfig) {
  return [...requiredSlots(config.direction), ...optionalSlots(config)].flatMap(slot => config.materials[slot] ?? []);
}
export function outputCount(config: ImageConfig) {
  if (config.direction !== "suite") return config.sizes[config.direction].count;
  const { outputs, aPlus, advanced } = config.suite;
  const count = (key: OutputKind) => outputs[key].enabled ? outputs[key].count : 0;
  return count("white") + count("scene") + count("selling") + (aPlus ? count("desktopAPlus") + (advanced ? count("mobileAPlus") : 0) : 0);
}
export const settingsLabel = (config: ImageConfig) => `${outputCount(config)}张 · ${config.sizes[config.direction].ratio}`;
export function changeDirection(config: ImageConfig, direction: SceneId) {
  config.direction = direction;
  if (direction === "suite" && config.materials.商品图?.length && !config.materials.场景图?.length)
    config.materials.场景图 = [{ name: "Ninja 场景图", src: libraryScene }];
}
export function useLibraryExample(config: ImageConfig) {
  applyLibraryProduct(config, "商品图", false);
  changeDirection(config, config.direction);
}
