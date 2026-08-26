import type { YjIconName } from "../icons/registry";

export type AppRoutePath = "/chat" | "/store" | "/plugins" | "/settings";
export type AppNavPlacement = "main" | "bottom";
export type AppNavItemKey =
  | "newTask"
  | "taskHistory"
  | "store"
  | "workspace"
  | "scheduledTask"
  | "plugin"
  | "knowledge"
  | "settings";

interface AppNavItemBase {
  kind: "item";
  key: AppNavItemKey;
  label: string;
  icon: YjIconName;
  placement: AppNavPlacement;
}

export interface EnabledAppNavItem extends AppNavItemBase {
  disabled: false;
  to: AppRoutePath;
}

export interface DisabledAppNavItem extends AppNavItemBase {
  disabled: true;
}

export interface AppNavSection {
  kind: "section";
  key: "taskHistory";
  label: string;
  icon: YjIconName;
  placement: "main";
}

export type AppNavItem = EnabledAppNavItem | DisabledAppNavItem;
export type AppNavEntry = AppNavItem | AppNavSection;
export type AppNavVisibilityProjection = Readonly<Partial<Record<AppNavItemKey, boolean>>>;

export const APP_NAVIGATION = [
  {
    kind: "item",
    key: "newTask",
    label: "新建任务",
    icon: "newTask",
    placement: "main",
    disabled: false,
    to: "/chat",
  },
  {
    kind: "item",
    key: "store",
    label: "我的店铺",
    icon: "store",
    placement: "main",
    disabled: false,
    to: "/store",
  },
  {
    kind: "item",
    key: "workspace",
    label: "工作台",
    icon: "workspace",
    placement: "main",
    disabled: true,
  },
  {
    kind: "item",
    key: "scheduledTask",
    label: "定时任务",
    icon: "scheduledTask",
    placement: "main",
    disabled: true,
  },
  {
    kind: "item",
    key: "plugin",
    label: "插件",
    icon: "plugin",
    placement: "main",
    disabled: false,
    to: "/plugins",
  },
  {
    kind: "item",
    key: "knowledge",
    label: "资料库",
    icon: "knowledge",
    placement: "main",
    disabled: true,
  },
  {
    kind: "section",
    key: "taskHistory",
    label: "任务记录",
    icon: "taskHistory",
    placement: "main",
  },
  {
    kind: "item",
    key: "settings",
    label: "设置",
    icon: "settings",
    placement: "bottom",
    disabled: false,
    to: "/settings",
  },
] as const satisfies readonly AppNavEntry[];

export function resolveAppNavigation(
  entries: readonly AppNavEntry[] = APP_NAVIGATION,
  visibility: AppNavVisibilityProjection = {},
): AppNavEntry[] {
  return entries.filter((entry) => visibility[entry.key] !== false);
}
