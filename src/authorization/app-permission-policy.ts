import type { KnownCapability } from "../domain/permissions";
import type {
  AppNavItemKey,
  AppNavVisibilityProjection,
  AppRoutePath,
} from "../navigation/app-nav";

export interface PermissionPolicySnapshot {
  enabled: boolean;
  ready: boolean;
  chatUiEnabled?: boolean;
  skillMarketplaceUiEnabled?: boolean;
  storeShowcaseUiEnabled?: boolean;
  workflowShowcaseUiEnabled?: boolean;
  hasCapability(capability: KnownCapability): boolean;
}

export const NAVIGATION_CAPABILITIES = {
  newTask: "task.create",
  taskHistory: "task.read",
  store: "store.read",
  workspace: "workspace.use",
  scheduledTask: "schedule.read",
  plugin: "plugin.read",
  knowledge: "knowledge.read",
} as const satisfies Readonly<
  Record<Exclude<AppNavItemKey, "settings">, KnownCapability>
>;

export const ROUTE_CAPABILITIES = {
  "/chat": "task.create",
  "/store": "store.read",
  "/workflows": "workspace.use",
  "/plugins": "plugin.read",
} as const satisfies Readonly<Record<Exclude<AppRoutePath, "/settings">, KnownCapability>>;

export function resolveNavigationVisibility(
  snapshot: PermissionPolicySnapshot,
): AppNavVisibilityProjection {
  const visibility: Record<AppNavItemKey, boolean> = {
    newTask: false,
    taskHistory: false,
    store: false,
    workspace: false,
    scheduledTask: false,
    plugin: false,
    knowledge: false,
    settings: true,
  };

  if (!snapshot.enabled || !snapshot.ready) {
    return visibility;
  }

  for (const [key, capability] of Object.entries(NAVIGATION_CAPABILITIES) as Array<
    [Exclude<AppNavItemKey, "settings">, KnownCapability]
  >) {
    visibility[key] = snapshot.hasCapability(capability);
  }
  if (snapshot.chatUiEnabled === false) {
    visibility.newTask = false;
    visibility.taskHistory = false;
  }
  if (snapshot.skillMarketplaceUiEnabled === false) visibility.plugin = false;
  if (snapshot.storeShowcaseUiEnabled === false) visibility.store = false;
  if (snapshot.workflowShowcaseUiEnabled === false) visibility.workspace = false;

  return visibility;
}

export function resolveRootRoute(snapshot: PermissionPolicySnapshot): AppRoutePath {
  if (!snapshot.enabled || !snapshot.ready) {
    return "/settings";
  }
  if (snapshot.chatUiEnabled === false) {
    return "/settings";
  }
  if (snapshot.hasCapability("task.create")) {
    return "/chat";
  }
  return "/settings";
}

export function requiredCapabilityForPath(path: string): KnownCapability | null {
  if (/^\/chat\/[^/]+$/.test(path)) {
    return "task.read";
  }
  return ROUTE_CAPABILITIES[path as keyof typeof ROUTE_CAPABILITIES] ?? null;
}

export function canRenderProtectedPath(
  path: string,
  snapshot: PermissionPolicySnapshot,
): boolean {
  const capability = requiredCapabilityForPath(path);
  const chatUiAllowed = snapshot.chatUiEnabled !== false || (path !== "/chat" && !path.startsWith("/chat/"));
  const skillUiAllowed = snapshot.skillMarketplaceUiEnabled !== false || path !== "/plugins";
  const storeUiAllowed = snapshot.storeShowcaseUiEnabled !== false || path !== "/store";
  const workflowUiAllowed = snapshot.workflowShowcaseUiEnabled !== false || path !== "/workflows";
  return (
    chatUiAllowed && skillUiAllowed && storeUiAllowed && workflowUiAllowed && (capability === null ||
    (snapshot.enabled && snapshot.ready && snapshot.hasCapability(capability))
    )
  );
}
