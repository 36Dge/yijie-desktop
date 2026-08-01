<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  canRenderProtectedPath,
  requiredCapabilityForPath,
} from "./authorization/app-permission-policy";
import { createPermissionLifecycle, type PermissionLifecycle } from "./authorization/permission-lifecycle";
import { authoritativePermissionUiEnabled } from "./authorization/permission-ui-config";
import {
  darkTheme,
  type GlobalThemeOverrides,
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
  NNotificationProvider,
} from "naive-ui";
import YjAppShell from "./components/yijie/YjAppShell.vue";
import { createNaiveThemeOverrides } from "./design/theme/naive-theme";
import { usePermissionStore } from "./stores/permission.store";
import "./styles/variables.css";

const route = useRoute();
const router = useRouter();
const permissionStore = usePermissionStore();
const isDark = ref(false);
const themeOverrides = ref<GlobalThemeOverrides>();
let colorSchemeQuery: MediaQueryList | undefined;
let permissionLifecycle: PermissionLifecycle | undefined;

const permissionSnapshot = computed(() => ({
  enabled: authoritativePermissionUiEnabled,
  ready: permissionStore.isReady,
  hasCapability: permissionStore.hasCapability,
}));
const canRenderCurrentRoute = computed(() =>
  canRenderProtectedPath(route.path, permissionSnapshot.value),
);

function applyColorScheme(matches: boolean): void {
  isDark.value = matches;
  document.documentElement.dataset.theme = matches ? "dark" : "light";
  const rootStyles = getComputedStyle(document.documentElement);
  themeOverrides.value = createNaiveThemeOverrides((name) => rootStyles.getPropertyValue(name));
}

function handleColorSchemeChange(event: MediaQueryListEvent): void {
  applyColorScheme(event.matches);
}

async function routeProtectedViewToRecovery(): Promise<void> {
  if (requiredCapabilityForPath(route.path) !== null) {
    await router.replace("/settings");
  }
}

watch(
  [
    () => route.path,
    () => permissionStore.phase,
    () => permissionStore.authorizationRevision,
    () => permissionStore.capabilities,
  ],
  async () => {
    const requiredCapability = requiredCapabilityForPath(route.path);
    if (requiredCapability === null || canRenderCurrentRoute.value) {
      return;
    }
    if (authoritativePermissionUiEnabled && permissionStore.isReady) {
      await router.replace({
        path: "/access-denied",
        query: { from: route.path },
      });
      return;
    }
    await router.replace("/settings");
  },
  { flush: "sync" },
);

onMounted(() => {
  colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  applyColorScheme(colorSchemeQuery.matches);
  colorSchemeQuery.addEventListener("change", handleColorSchemeChange);

  if (authoritativePermissionUiEnabled) {
    permissionLifecycle = createPermissionLifecycle(
      permissionStore,
      routeProtectedViewToRecovery,
      document,
    );
    void permissionLifecycle.start();
  }
});

onBeforeUnmount(() => {
  colorSchemeQuery?.removeEventListener("change", handleColorSchemeChange);
  permissionLifecycle?.stop();
});
</script>

<template>
  <n-config-provider :theme="isDark ? darkTheme : null" :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <YjAppShell>
            <RouterView v-slot="{ Component }">
              <component :is="Component" v-if="canRenderCurrentRoute" />
            </RouterView>
          </YjAppShell>
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
