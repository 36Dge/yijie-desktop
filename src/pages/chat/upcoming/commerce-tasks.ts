import type { YjIconName } from "../../../icons/registry";

export const homeCommerceTasks = {
  image: {
    label: "电商生图", icon: "image",
    hint: "描述商品、背景和画面风格，也可以添加一张参考图…",
  },
  video: {
    label: "电商视频", icon: "video",
    hint: "描述商品卖点、视频时长和发布平台…",
  },
  sourcing: {
    label: "选品分析", icon: "skillSourcing",
    hint: "输入目标市场、商品类目和价格区间…",
  },
  listing: {
    label: "listing 优化", icon: "fileEdit",
    hint: "粘贴商品链接或现有文案，描述想优化的部分…",
  },
  compliance: {
    label: "合规检测", icon: "shield",
    hint: "输入销售地区、平台和需要核查的商品或文案…",
  },
  outreach: {
    label: "达人建联", icon: "message",
    hint: "描述目标达人、合作平台和想洽谈的合作方式…",
  },
} as const satisfies Record<string, { label: string; icon: YjIconName; hint: string }>;

export type HomeCommerceTask = keyof typeof homeCommerceTasks;
