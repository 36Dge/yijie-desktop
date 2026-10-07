/** Synthetic UI data only. Never use these IDs in a request or model prompt. */
export interface PreviewShop {
  readonly id: string;
  readonly name: string;
  readonly platform: "TikTok Shop" | "Amazon";
  readonly market: string;
  readonly category: string;
}

export const PREVIEW_SHOPS: readonly PreviewShop[] = Object.freeze([
  { id: "demo-tk-home", name: "拾光家居", platform: "TikTok Shop", market: "美国站", category: "家居生活" },
  { id: "demo-tk-outdoor", name: "山海户外", platform: "TikTok Shop", market: "英国站", category: "运动户外" },
  { id: "demo-tk-living", name: "晴日生活", platform: "TikTok Shop", market: "新加坡站", category: "日用百货" },
  { id: "demo-amazon-home", name: "Northstar Home", platform: "Amazon", market: "美国站", category: "家居收纳" },
  { id: "demo-amazon-living", name: "Luma Living", platform: "Amazon", market: "德国站", category: "生活家电" },
]);

export type ShopPreviewStage = "empty" | "authorizing" | "list" | "linking" | "success" | "error" | "expired";
export type ShopPreviewScenario = "authorization-error" | "list-error" | "expired-current" | "expired-others";
export const SHOP_PREVIEW_TIMING = { authorization: 1500, authorizationStep: 650, linking: 450, refresh: 700 } as const;
