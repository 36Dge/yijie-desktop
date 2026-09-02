import { nextTick, type Component } from "vue";
import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
  type RouteMeta,
  type RouteRecordRaw,
  type RouterHistory,
} from "vue-router";
import {
  requiredCapabilityForPath,
  resolveRootRoute,
  type PermissionPolicySnapshot,
} from "../authorization/app-permission-policy";
import { authoritativePermissionUiEnabled } from "../authorization/permission-ui-config";
import { localChatUiEnabled } from "../authorization/chat-ui-config";
import { skillMarketplaceUiEnabled } from "../authorization/skill-marketplace-ui-config";
import { storeShowcaseUiEnabled } from "../authorization/store-showcase-ui-config";
import { workflowShowcaseUiEnabled } from "../authorization/workflow-showcase-ui-config";
import type { KnownCapability } from "../domain/permissions";
import { usePermissionStore } from "../stores/permission.store";

const RootRoutePage: Component = { render: () => null };

export interface AppPageLoaders {
  chat: () => Promise<Component>;
  store: () => Promise<Component>;
  workflows: () => Promise<Component>;
  plugins: () => Promise<Component>;
  settings: () => Promise<Component>;
  accessDenied: () => Promise<Component>;
}

const APP_PAGE_LOADERS: AppPageLoaders = {
  chat: async () => (await import("../pages/chat/ChatPage.vue")).default,
  store: async () => (await import("../pages/store/StorePage.vue")).default,
  workflows: async () => (await import("../pages/workflows/WorkflowPage.vue")).default,
  plugins: async () => (await import("../pages/plugins/SkillMarketplacePage.vue")).default,
  settings: async () => (await import("../pages/settings/SettingsPage.vue")).default,
  accessDenied: async () => (await import("../pages/access/AccessDeniedPage.vue")).default,
};

export interface RouterPermissionBoundary {
  readonly enabled: boolean;
  readonly ready: boolean;
  ensureInitialized(): Promise<void>;
  hasCapability(capability: KnownCapability): boolean;
}

const productionPermissionBoundary: RouterPermissionBoundary = {
  get enabled() {
    return authoritativePermissionUiEnabled;
  },
  get ready() {
    return usePermissionStore().isReady;
  },
  async ensureInitialized() {
    await usePermissionStore().ensureInitialized();
  },
  hasCapability(capability) {
    return usePermissionStore().hasCapability(capability);
  },
};

function policySnapshot(boundary: RouterPermissionBoundary): PermissionPolicySnapshot {
  return {
    enabled: boundary.enabled,
    ready: boundary.ready,
    hasCapability: (capability) => boundary.hasCapability(capability),
  };
}

export function createAppRouteRecords(
  pageLoaders: AppPageLoaders = APP_PAGE_LOADERS,
  chatUiEnabled = localChatUiEnabled,
  skillUiEnabled = skillMarketplaceUiEnabled,
  storeUiEnabled = storeShowcaseUiEnabled,
  workflowUiEnabled = workflowShowcaseUiEnabled,
): readonly RouteRecordRaw[] {
  const records: RouteRecordRaw[] = [
    {
      path: "/",
      name: "root",
      component: RootRoutePage,
      meta: { documentTitle: "易界 AI" },
    },
  ];
  if (chatUiEnabled) records.push(
    {
      path: "/chat",
      name: "chat",
      component: pageLoaders.chat,
      meta: {
        navKey: "newTask",
        documentTitle: "新建任务 · 易界 AI",
      },
    },
    {
      path: "/chat/:sessionId",
      name: "chat-session",
      component: pageLoaders.chat,
      meta: {
        navKey: "newTask",
        documentTitle: "任务对话 · 易界 AI",
      },
    },
  );
  if (skillUiEnabled) records.push({
    path: "/plugins",
    name: "plugins",
    component: pageLoaders.plugins,
    meta: {
      navKey: "plugin",
      documentTitle: "Skill 广场 · 易界 AI",
    },
  });
  if (storeUiEnabled) records.push({
    path: "/store",
    name: "store",
    component: pageLoaders.store,
    meta: {
      navKey: "store",
      documentTitle: "我的店铺 · 易界 AI",
    },
  });
  if (workflowUiEnabled) records.push({
    path: "/workflows",
    name: "workflows",
    component: pageLoaders.workflows,
    meta: {
      navKey: "workspace",
      documentTitle: "工作流 · 易界 AI",
    },
  });
  records.push(
    {
      path: "/settings",
      name: "settings",
      component: pageLoaders.settings,
      meta: {
        navKey: "settings",
        documentTitle: "设置 · 易界 AI",
      },
    },
    {
      path: "/access-denied",
      name: "access-denied",
      component: pageLoaders.accessDenied,
      meta: { documentTitle: "无权访问 · 易界 AI" },
    },
  );
  return records;
}

export const APP_ROUTE_RECORDS = createAppRouteRecords();

export function syncRouteTitle(routeMeta: RouteMeta, routeDocument: Document): void {
  if (typeof routeMeta.documentTitle === "string") {
    routeDocument.title = routeMeta.documentTitle;
  }
}

export function focusRouteHeading(routeDocument: Document): void {
  const heading = routeDocument.querySelector<HTMLElement>("main h1");

  if (!heading) {
    return;
  }

  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

export function createAppRouter(
  history: RouterHistory,
  permissionBoundary: RouterPermissionBoundary = productionPermissionBoundary,
  pageLoaders: AppPageLoaders = APP_PAGE_LOADERS,
  chatUiEnabled = localChatUiEnabled,
  skillUiEnabled = skillMarketplaceUiEnabled,
  storeUiEnabled = storeShowcaseUiEnabled,
  workflowUiEnabled = workflowShowcaseUiEnabled,
) {
  const appRouter = createRouter({
    history,
    routes: createAppRouteRecords(
      pageLoaders,
      chatUiEnabled,
      skillUiEnabled,
      storeUiEnabled,
      workflowUiEnabled,
    ),
  });

  appRouter.beforeEach(async (route) => {
    if (route.path === "/") {
      if (permissionBoundary.enabled) {
        await permissionBoundary.ensureInitialized();
      }
      return resolveRootRoute({ ...policySnapshot(permissionBoundary), chatUiEnabled });
    }

    if (!chatUiEnabled && (route.path === "/chat" || route.path.startsWith("/chat/"))) {
      return { path: "/settings", replace: true };
    }
    if (!skillUiEnabled && route.path === "/plugins") {
      return { path: "/settings", replace: true };
    }
    if (!storeUiEnabled && route.path === "/store") {
      return { path: "/settings", replace: true };
    }
    if (!workflowUiEnabled && route.path === "/workflows") {
      return { path: "/settings", replace: true };
    }

    const requiredCapability = requiredCapabilityForPath(route.path);
    if (requiredCapability === null) {
      return true;
    }
    if (!permissionBoundary.enabled) {
      return { path: "/settings", replace: true };
    }

    await permissionBoundary.ensureInitialized();
    if (!permissionBoundary.ready) {
      return { path: "/settings", replace: true };
    }
    if (!permissionBoundary.hasCapability(requiredCapability)) {
      return {
        path: "/access-denied",
        query: { from: route.path },
        replace: true,
      };
    }
    return true;
  });

  appRouter.afterEach((route) => {
    if (typeof document === "undefined") {
      return;
    }

    syncRouteTitle(route.meta, document);
    void nextTick(() => focusRouteHeading(document));
  });

  return appRouter;
}

const defaultHistory =
  typeof window === "undefined" ? createMemoryHistory() : createWebHistory();

export const router = createAppRouter(defaultHistory);
