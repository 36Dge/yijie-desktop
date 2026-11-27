import type { YjIconName } from "../../../../icons/registry";
import type { MaterialSlot } from "../agent/config";

interface SceneMedia { src: string; thumbnail: string }

const originals = import.meta.glob<string>("./assets/image-*.png", { eager: true, query: "?url", import: "default" });
const previews = import.meta.glob<string>("./assets/previews/image-*.webp", { eager: true, query: "?url", import: "default" });

function media(stem: string): SceneMedia {
  return {
    src: originals[`./assets/image-${stem}.png`],
    thumbnail: previews[`./assets/previews/image-${stem}.webp`],
  };
}

const suiteSpeakerReference = media("suite-speaker-reference");
const suiteSpeakerAplus = media("suite-speaker-aplus");
const suiteSpeakerSellingPoints = media("suite-speaker-selling-points");
const suiteSpeakerScene = media("suite-speaker-scene");
const modelDressProduct = media("model-dress-product");
const modelReference = media("model-reference");
const modelDressResult = media("model-dress-result");
const whiteHatSource = media("white-hat-source");
const whiteHatResult = media("white-hat-result");
const sceneShellDressSource = media("scene-shell-dress-source");
const sceneShellDressResult = media("scene-shell-dress-result");
const replaceFlowerProduct = media("replace-flower-product");
const replaceFlowerTarget = media("replace-flower-target");
const replaceFlowerResult = media("replace-flower-result");
const aplusJacketProduct = media("aplus-jacket-product");
const aplusJacketScene = media("aplus-jacket-scene");
const aplusJacketFeature = media("aplus-jacket-feature");

export type SceneId = "suite" | "model" | "white" | "scene" | "replace" | "aplus";
export interface SceneImage extends SceneMedia { title: string; alt: string; fit: "cover" | "contain" }
export interface SceneCard { badge: string; caption: string; detail: string; summary: string; images: SceneImage[] }
export interface ImageScene {
  id: SceneId;
  label: string;
  icon: YjIconName;
  detail: string;
  title: string;
  description: string;
  operation: string;
  comparison?: { source: SceneMedia; product?: SceneMedia; before: string; after: string; description: string };
  input: SceneCard;
  result: SceneCard;
  product: { name: string; core: string; brand: string; recognized: number };
  materials: { slot: MaterialSlot; name: string; src: string }[];
}

export const imageScenes: Record<SceneId, ImageScene> = {
  suite: {
    id: "suite", label: "商品套图", icon: "workflowBatchImages",
    detail: "便携音箱 · 成套商品图", title: "整套商品图",
    description: "把同一款音箱放进家居场景、卖点拆解和 A+ 版面，整套图沿用同一组产品细节。", operation: "批量组合",
    comparison: {
      source: suiteSpeakerReference, before: "原图", after: "套图",
      description: "一张音箱白底原图生成详情页横幅、卖点拆解图和家居场景图。",
    },
    input: {
      badge: "商品基础素材", caption: "商品基础素材", detail: "白底参考图", summary: "原始商品图 · 已提供",
      images: [
        { ...suiteSpeakerReference, title: "商品基础素材", alt: "音响白底商品基础素材", fit: "contain" },
      ],
    },
    result: {
      badge: "整套商品图结果", caption: "整套商品图预览", detail: "A+ 图 · 卖点图 · 场景图", summary: "多图输出 · 统一视觉",
      images: [
        { ...suiteSpeakerAplus, title: "详情横幅", alt: "音响 A+ 商品详情图", fit: "contain" },
        { ...suiteSpeakerSellingPoints, title: "卖点拆解", alt: "音响产品卖点图", fit: "cover" },
        { ...suiteSpeakerScene, title: "家居场景", alt: "音响家居使用场景图", fit: "cover" },
      ],
    },
    product: { name: "40W RGB 防水便携蓝牙音响", core: "40W 音效、IPX7 防水、30 小时续航、TWS 立体声、RGB 灯效", brand: "Magic", recognized: 8 },
    materials: [
      { slot: "商品图", name: "音响商品基础素材", src: suiteSpeakerReference.src },
    ],
  },
  model: {
    id: "model", label: "模特上身", icon: "shirt",
    detail: "印花连衣裙 · 试穿效果", title: "模特上身效果",
    description: "搭配服装原图与人物参考，预览系带连衣裙穿在模特身上的版型与花纹。", operation: "模特合成",
    input: {
      badge: "商品与模特参考", caption: "待合成素材", detail: "商品原图 · 模特参考", summary: "2 项输入 · 已提供",
      images: [
        { ...modelDressProduct, title: "商品原图", alt: "佩斯利印花连衣裙商品原图", fit: "contain" },
        { ...modelReference, title: "模特参考", alt: "模特人物参考图", fit: "contain" },
      ],
    },
    result: {
      badge: "上身生成结果", caption: "模特上身效果", detail: "商品保真 · 模特适配", summary: "3:4 · 人群适配 · 服饰保真",
      images: [
        { ...modelDressResult, title: "模特上身", alt: "佩斯利印花连衣裙模特卧室场景生成结果", fit: "contain" },
      ],
    },
    product: { name: "佩斯利印花长袖系带连衣裙", core: "米杏底色、橙粉佩斯利印花、V 领、长袖、腰带收腰", brand: "演示商品", recognized: 7 },
    materials: [
      { slot: "商品图", name: "佩斯利印花连衣裙商品图", src: modelDressProduct.src },
      { slot: "模特图", name: "模特人物参考图", src: modelReference.src },
    ],
  },
  white: {
    id: "white", label: "白底主图", icon: "scan",
    detail: "格纹宽檐帽 · 白底精修", title: "平台白底主图",
    description: "从海边佩戴照中提取帽子。白底主图保留帽檐轮廓、蓝白格纹与红色滚边。", operation: "白底精修",
    input: {
      badge: "商品与环境参考", caption: "待处理素材", detail: "原始商品图", summary: "1 项输入 · 已提供",
      images: [
        { ...whiteHatSource, title: "原始商品图", alt: "海边人物佩戴蓝色格纹防晒帽的原始商品图", fit: "contain" },
      ],
    },
    result: {
      badge: "白底主图结果", caption: "平台白底主图", detail: "主体提取 · 构图规范", summary: "1:1 · 纯白背景 · 商品居中",
      images: [
        { ...whiteHatResult, title: "白底主图", alt: "蓝色格纹防晒帽亚马逊白底主图生成结果", fit: "contain" },
      ],
    },
    product: { name: "蓝色格纹宽檐防晒帽", core: "蓝白格纹、小花图案、宽檐遮阳、红色滚边、可调节系带", brand: "Kiano Studio", recognized: 7 },
    materials: [
      { slot: "商品图", name: "蓝色格纹帽海边佩戴图", src: whiteHatSource.src },
    ],
  },
  scene: {
    id: "scene", label: "场景图", icon: "shopOutdoors",
    detail: "印花吊带裙 · 海边场景", title: "真实场景生成",
    description: "将城市街景里的连衣裙移到海边，保留服装纹样并调整光线与环境。", operation: "场景替换",
    comparison: {
      source: sceneShellDressSource, before: "街景", after: "海边",
      description: "同一位模特穿同一条印花裙，背景从城市街道换成海滩。",
    },
    input: {
      badge: "商品与原场景", caption: "待替换场景", detail: "城市街景商品图", summary: "1 项输入 · 已提供",
      images: [
        { ...sceneShellDressSource, title: "原始场景图", alt: "贝壳印花连衣裙城市街景原始商品图", fit: "contain" },
      ],
    },
    result: {
      badge: "场景图结果", caption: "海边场景生成", detail: "人物保真 · 场景融合", summary: "3:4 · 海边度假 · 光影匹配",
      images: [
        { ...sceneShellDressResult, title: "海边场景", alt: "贝壳印花连衣裙海边场景生成结果", fit: "contain" },
      ],
    },
    product: { name: "蓝白贝壳印花吊带连衣裙", core: "蓝白贝壳与海星印花、肩部系带、收腰裙摆、夏日度假风", brand: "演示商品", recognized: 7 },
    materials: [
      { slot: "商品图", name: "贝壳印花裙城市穿搭图", src: sceneShellDressSource.src },
    ],
  },
  replace: {
    id: "replace", label: "商品替换", icon: "copy",
    detail: "花瓶与花束 · 参考图替换", title: "参考图商品替换",
    description: "沿用参考画面的构图和光线，把主角换成白色牡丹与竖纹花瓶。", operation: "主体替换",
    comparison: {
      source: replaceFlowerTarget, product: replaceFlowerProduct, before: "参考图", after: "替换后",
      description: "给定桌上兰花的参考图和白牡丹花瓶商品图，在同一张茶几上将兰花替换为白牡丹花瓶。",
    },
    input: {
      badge: "替换输入素材", caption: "商品与参考画面", detail: "商品原图 · 待替换素材", summary: "2 项输入 · 已提供",
      images: [
        { ...replaceFlowerProduct, title: "商品原始素材", alt: "商品替换使用的原始花瓶商品图", fit: "cover" },
        { ...replaceFlowerTarget, title: "待替换素材", alt: "等待替换主体的兰花场景素材", fit: "cover" },
      ],
    },
    result: {
      badge: "商品替换结果", caption: "替换后效果", detail: "主体替换后的场景图", summary: "主体保真 · 场景重组",
      images: [
        { ...replaceFlowerResult, title: "替换效果", alt: "替换为白色花束后的生成结果", fit: "cover" },
      ],
    },
    product: { name: "白色牡丹花束与竖纹花瓶", core: "白色牡丹花头、深绿叶片、白色竖纹花瓶、家居摆件", brand: "演示商品", recognized: 7 },
    materials: [
      { slot: "商品图", name: "白色牡丹花束商品图", src: replaceFlowerProduct.src },
      { slot: "爆款参考图", name: "兰花场景参考图", src: replaceFlowerTarget.src },
    ],
  },
  aplus: {
    id: "aplus", label: "A+ 图", icon: "layoutTemplate",
    detail: "轻量连帽外套 · 详情页横幅", title: "A+ 详情页排版",
    description: "用两张横幅分别展示外套的穿着场景和防水细节，组成可上下排列的亚马逊 A+ 模块。", operation: "A+ 排版",
    input: {
      badge: "商品基础素材", caption: "待排版素材", detail: "冰蓝连帽外套", summary: "1 项输入 · 已提供",
      images: [
        { ...aplusJacketProduct, title: "商品原图", alt: "冰蓝色轻量防水连帽外套商品原图", fit: "contain" },
      ],
    },
    result: {
      badge: "A+ 图结果", caption: "A+ 模块预览", detail: "场景展示 · 功能说明", summary: "2 张横图 · 上下排布",
      images: [
        { ...aplusJacketScene, title: "穿着场景", alt: "冰蓝连帽外套三栏场景 A+ 图", fit: "contain" },
        { ...aplusJacketFeature, title: "防水细节", alt: "冰蓝连帽外套防水功能场景 A+ 图", fit: "contain" },
      ],
    },
    product: { name: "冰蓝色轻量防水连帽外套", core: "轻量防水、可调节连帽、高领、拉链口袋、日常户外通勤", brand: "演示商品", recognized: 7 },
    materials: [
      { slot: "商品图", name: "冰蓝连帽外套商品图", src: aplusJacketProduct.src },
    ],
  },
};
