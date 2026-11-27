import { imageScenes, type SceneId } from "../image-agent/scenes";
import { changeDirection, requiredSlots, optionalSlots, selectedImages, settingsLabel, useLibraryExample, type ImageConfig } from "../image-agent/draft";
import { videoScenes, type VideoSceneId } from "../video-agent/scenes";
import { configureVideoDirection, primaryVideoSlot, videoOptionalSlots, videoSettingsLabel, useVideoLibraryExample, type VideoConfig } from "../video-agent/draft";
import type { MaterialSlot } from "./config";

export type AgentConfig = ImageConfig | VideoConfig;
export function describeConfig(config: AgentConfig) {
  const video = config.kind === "video";
  const primary = video ? primaryVideoSlot(config.direction) : "商品图";
  const required: MaterialSlot[] = video ? [primary] : requiredSlots(config.direction);
  const missing = required.filter(slot => !config.materials[slot]?.length);
  const images = video ? config.materials[primary] ?? [] : selectedImages(config);
  const imageLabel = !images.length || (images.length === 1 && config.materials.商品图?.length === 1) ? "商品图" : "图片";
  return {
    primary, required, missing, images,
    optional: video ? videoOptionalSlots(config.direction) : optionalSlots(config),
    agent: video ? "视频Agent" : "图片Agent",
    materialLabel: video ? primary : imageLabel,
    directionLabel: video ? videoScenes[config.direction].label + " · 生成视频" : imageScenes[config.direction].label,
    settingsLabel: video ? videoSettingsLabel(config) : settingsLabel(config),
  } as const;
}

export function setDialogDirection(config: AgentConfig, id: SceneId | VideoSceneId) {
  if (config.kind === "video" && id in videoScenes) configureVideoDirection(config, id as VideoSceneId);
  if (config.kind === "image" && id in imageScenes) changeDirection(config, id as SceneId);
}
export function chooseLibraryProduct(config: AgentConfig) {
  if (config.kind === "video") useVideoLibraryExample(config);
  else useLibraryExample(config);
}
