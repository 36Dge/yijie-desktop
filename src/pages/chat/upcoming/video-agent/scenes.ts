import type { YjIconName } from "../../../../icons/registry";
import type { Product } from "../agent/config";
import seedingInput from "./assets/video-real-seeding-input.png";
import seedingOutputClip from "./assets/video-real-seeding-output.mp4";
import talkingInput from "./assets/video-real-talking-input.png";
import talkingOutputClip from "./assets/video-real-talking-output.mp4";
import unboxingInput from "./assets/video-real-unboxing-input.jpg";
import unboxingOutputClip from "./assets/video-real-unboxing-output.mp4";
import adInput from "./assets/video-real-ad-input.png";
import adOutputClip from "./assets/video-real-ad-output.mp4";
import replicateInput from "./assets/video-real-replicate-input.png";
import replicateReferenceClip from "./assets/video-real-replicate-reference.mp4";
import replicateOutputClip from "./assets/video-real-replicate-output.mp4";
import imageMotionInput from "./assets/video-real-image-motion-input.png";
import imageMotionOutputClip from "./assets/video-real-image-motion-output.mp4";

export type VideoSceneId = "seeding" | "talking" | "unboxing" | "advertising" | "replicate" | "motion";
export interface VideoExample { src: string; poster: string; label: string }
export interface VideoCoverFrame {
  src: string;
  label: string;
  kind: "image" | "reference" | "result";
}
export interface VideoScene {
  id: VideoSceneId;
  label: string;
  icon: YjIconName;
  detail: string;
  title: string;
  description: string;
  cover: readonly VideoCoverFrame[];
  input: { src: string; thumbnail: string; alt: string; name: string };
  reference?: VideoExample & { name: string };
  result: VideoExample;
  duration: number;
  product: Omit<Product, "source"> | null;
}

const previews = import.meta.glob<string>("./assets/previews/*.webp", { eager: true, query: "?url", import: "default" });
function preview(stem: string) { return previews[`./assets/previews/${stem}.webp`]; }
function frame(stem: string, label: string, kind: VideoCoverFrame["kind"] = "result"): VideoCoverFrame {
  return { src: preview(stem), label, kind };
}

// Frame filenames identify the original clip and the timestamp of the shot.
const covers = {
  seeding: [
    frame("seeding-input", "商品图", "image"), frame("seeding-output-4.40s", "触摸"), frame("seeding-output-6.60s", "试背"),
  ],
  talking: [frame("talking-output-1.05s", "出镜讲解"), frame("talking-output-4.65s", "细节演示")],
  unboxing: [frame("unboxing-output-0.40s", "拆盒"), frame("unboxing-output-1.40s", "取出"), frame("unboxing-output-8.65s", "展示")],
  advertising: [frame("ad-output-2.45s", "特写"), frame("ad-output-6.65s", "注水"), frame("ad-output-8.75s", "定版")],
  replicate: [
    frame("replicate-input", "商品图", "image"), frame("replicate-reference-6.40s", "参考片", "reference"), frame("replicate-output-5.40s", "复刻片"),
  ],
  motion: [frame("image-motion-input", "起始图", "image"), frame("image-motion-output-3.80s", "转身"), frame("image-motion-output-7.30s", "拉衣摆")],
} satisfies Record<VideoSceneId, [VideoCoverFrame, VideoCoverFrame, ...VideoCoverFrame[]]>;

export const videoScenes: Record<VideoSceneId, VideoScene> = {
  seeding: {
    id: "seeding", label: "种草视频", icon: "skillBrandMood",
    detail: "编织手提包 · 触感与试背", title: "真实体验种草",
    description: "镜头先贴近包身的编织纹理，再跟随人物把包背上肩，展示手提包实际使用时的大小和垂感。",
    cover: covers.seeding,
    input: {
      src: seedingInput, thumbnail: preview("seeding-input"), alt: "JINSHANG 灰棕编织手提包商品图", name: "灰棕编织手提包商品图",
    },
    result: {
      src: seedingOutputClip, poster: covers.seeding[2].src, label: "播放真实体验种草成片",
    },
    duration: 10,
    product: {
      name: "JINSHANG 灰棕编织手提包", brand: "JINSHANG", core: "柔软编织纹理、弧形手柄、轻量通勤、自然松弛感",
      category: "女士手提包", sku: "WOVEN-HANDBAG", recognized: 7,
    },
  },
  talking: {
    id: "talking", label: "口播讲解", icon: "microphone",
    detail: "狐狸毛绒玩具 · 出镜讲解", title: "可信口播讲解",
    description: "讲解者面对镜头举起狐狸玩偶，边说边翻转玩偶，用近景展示绒面和造型。",
    cover: covers.talking,
    input: {
      src: talkingInput, thumbnail: preview("talking-input"), alt: "橙色狐狸毛绒玩具商品图", name: "狐狸毛绒玩具商品图",
    },
    result: {
      src: talkingOutputClip, poster: covers.talking[0].src, label: "播放可信口播讲解成片",
    },
    duration: 10,
    product: {
      name: "橙色狐狸毛绒玩具", brand: "演示商品", core: "橙棕配色、柔软长绒、趴卧造型、儿童陪伴与礼赠",
      category: "毛绒玩具", sku: "FOX-PLUSH", recognized: 6,
    },
  },
  unboxing: {
    id: "unboxing", label: "开箱视频", icon: "packageOpen",
    detail: "兔耳潮玩 · 拆盒展示", title: "完整开箱上手",
    description: "从桌上的包装盒开始，跟随双手开盒、取出手办，再看手办的正面、背面和全貌。",
    cover: covers.unboxing,
    input: {
      src: unboxingInput, thumbnail: preview("unboxing-input"), alt: "粉蓝兔耳潮玩手办商品图", name: "兔耳潮玩手办商品图",
    },
    result: {
      src: unboxingOutputClip, poster: covers.unboxing[1].src, label: "播放完整开箱上手成片",
    },
    duration: 10,
    product: {
      name: "粉蓝兔耳潮玩手办", brand: "演示商品", core: "粉蓝撞色、兔耳头盔、可爱潮玩造型、收藏礼赠",
      category: "潮玩手办", sku: "BUNNY-FIGURE", recognized: 6,
    },
  },
  advertising: {
    id: "advertising", label: "广告短片", icon: "skillContent",
    detail: "玻璃水具 · 卖点快切", title: "高质感转化广告",
    description: "从玻璃锤纹切到注水特写，最后用整套水具和卖点字幕收尾。",
    cover: covers.advertising,
    input: {
      src: adInput, thumbnail: preview("ad-input"), alt: "锤纹玻璃水壶杯具套装商品图", name: "玻璃水壶杯具套装商品图",
    },
    result: {
      src: adOutputClip, poster: covers.advertising[2].src, label: "播放高质感转化广告成片",
    },
    duration: 10,
    product: {
      name: "锤纹玻璃水壶杯具套装", brand: "演示商品", core: "透明锤纹玻璃、成套杯具、桌面待客、清透质感",
      category: "玻璃水具", sku: "GLASS-SET", recognized: 6,
    },
  },
  replicate: {
    id: "replicate", label: "复刻爆款", icon: "copy",
    detail: "抽绳阔腿裤 · 穿搭镜头复刻", title: "爆款结构复刻",
    description: "对照参考片的镜前抬腿和全身穿搭镜头，看同一组动作怎样用于展示卡其色阔腿裤。",
    cover: covers.replicate,
    input: {
      src: replicateInput, thumbnail: preview("replicate-input"), alt: "卡其色抽绳宽松阔腿裤商品图", name: "卡其阔腿裤商品图",
    },
    reference: {
      src: replicateReferenceClip, poster: covers.replicate[1].src, label: "播放宽腿裤爆款穿搭参考视频", name: "爆款穿搭参考视频",
    },
    result: {
      src: replicateOutputClip, poster: covers.replicate[2].src, label: "播放爆款结构复刻成片",
    },
    duration: 15,
    product: {
      name: "卡其色抽绳宽松阔腿裤", brand: "演示商品", core: "宽松直筒、抽绳腰头、垂坠面料、日常穿搭",
      category: "女士阔腿裤", sku: "WIDE-LEG-PANTS", recognized: 6,
    },
  },
  motion: {
    id: "motion", label: "图转视频", icon: "squarePlay",
    detail: "基础短袖 · 转身与拉衣摆", title: "静帧动态化",
    description: "从一张黑色短袖的正面图开始，成片接续模特侧身、面料近景和拉开衣摆的动作。",
    cover: covers.motion,
    input: {
      src: imageMotionInput, thumbnail: preview("image-motion-input"), alt: "男士黑色基础短袖 T 恤起始图", name: "黑色基础 T 恤起始图",
    },
    result: {
      src: imageMotionOutputClip, poster: covers.motion[1].src, label: "播放静帧动态化成片",
    },
    duration: 10,
    product: null,
  },
};
