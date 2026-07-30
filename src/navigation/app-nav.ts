import type { YjIconName } from "../icons/registry";

export type AppRoutePath = "/chat" | "/tasks" | "/settings";
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

export interface AppNavDivider {
  kind: "divider";
  key: "businessDivider";
  placement: "main";
}

export type AppNavItem = EnabledAppNavItem | DisabledAppNavItem;
export type AppNavEntry = AppNavItem | AppNavDivider;
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
    key: "taskHistory",
    label: "任务记录",
    icon: "taskHistory",
    placement: "main",
    disabled: false,
    to: "/tasks",
  },
  {
    kind: "divider",
    key: "businessDivider",
    placement: "main",
  },
  {
    kind: "item",
    key: "store",
    label: "我的店铺",
    icon: "store",
    placement: "main",
    disabled: true,
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
    disabled: true,
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
  const resolved: AppNavEntry[] = [];
  let pendingDivider: AppNavDivider | undefined;

  for (const entry of entries) {
    if (entry.kind === "divider") {
      pendingDivider = entry;
      continue;
    }

    if (visibility[entry.key] === false) {
      continue;
    }

    const previousEntry = resolved[resolved.length - 1];
    if (
      pendingDivider &&
      previousEntry?.kind === "item" &&
      previousEntry.placement === pendingDivider.placement &&
      entry.placement === pendingDivider.placement
    ) {
      resolved.push(pendingDivider);
    }

    pendingDivider = undefined;
    resolved.push(entry);
  }

  return resolved;
}
