import { applyLibraryProduct, type DraftFields, type MaterialSlot } from "../agent/config";
import libraryScene from "../agent/assets/video-demo-ninja-scene.webp";
import { videoScenes, type VideoSceneId } from "./scenes";

export type VideoRatio = "自适应" | "9:16" | "16:9" | "1:1";
export interface VideoConfig extends DraftFields {
  kind: "video";
  direction: VideoSceneId;
  duration: number;
  ratio: VideoRatio;
  generateAudio: boolean;
}
export interface VideoAgentState { selected: VideoSceneId; config: VideoConfig | null }
export const newVideoAgentState = (): VideoAgentState => ({ selected: "seeding", config: null });
export const primaryVideoSlot = (direction: VideoSceneId) => direction === "motion" ? "起始图" : "商品图";
export function videoOptionalSlots(direction: VideoSceneId): MaterialSlot[] {
  if (direction === "motion") return [];
  if (direction === "replicate") return ["参考视频", "场景图", "模特图"];
  return direction === "unboxing" ? ["包装图", "场景图"] : ["场景图", "模特图"];
}
export function videoDemoConfig(direction: VideoSceneId): VideoConfig {
  const scene = videoScenes[direction];
  const materials: VideoConfig["materials"] = { [primaryVideoSlot(direction)]: [{ name: scene.input.name, src: scene.input.src }] };
  if (scene.reference) materials.参考视频 = [{ name: scene.reference.name, src: scene.reference.src, poster: scene.reference.poster }];
  return {
    kind: "video", direction, materials, productSource: "商品库", productLink: "",
    product: scene.product ? { ...scene.product, source: "一键试用演示" } : { name: "", core: "", brand: "", recognized: 0, source: "" },
    manualFields: [], removed: [], platform: "TikTok", market: "美国站", language: "英语",
    duration: scene.duration, ratio: "9:16", generateAudio: true,
  };
}
export const videoSettingsLabel = (config: VideoConfig) =>
  `${config.duration}秒 · ${config.ratio} · 音频${config.generateAudio ? "开" : "关"}`;

// The configuration dialog matches available materials when changing direction.
export function configureVideoDirection(config: VideoConfig, next: VideoSceneId) {
  const previousInput = config.materials[primaryVideoSlot(config.direction)];
  config.direction = next;
  if (!config.product.source) return;
  const primary = primaryVideoSlot(next);
  if (!config.materials[primary]?.length && previousInput?.length) {
    config.materials[primary] = previousInput.map(item => ({ ...item }));
  }
  if (next === "replicate" && !config.materials.参考视频?.length) {
    const reference = videoScenes.replicate.reference!;
    config.materials.参考视频 = [{ name: reference.name, src: reference.src, poster: reference.poster }];
  } else if (next !== "motion" && next !== "replicate" && !config.materials.场景图?.length) {
    config.materials.场景图 = [{ name: "Ninja 场景图", src: libraryScene }];
  }
}
export function useVideoLibraryExample(config: VideoConfig) {
  applyLibraryProduct(config, primaryVideoSlot(config.direction), true);
  configureVideoDirection(config, config.direction);
}
