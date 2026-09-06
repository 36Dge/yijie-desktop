<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useRoute } from "vue-router";
import { darkTheme, NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider } from "naive-ui";
import YjAppShell from "@src/components/yijie/YjAppShell.vue";
import { createNaiveThemeOverrides } from "@src/design/theme/naive-theme";
import { createCandidateThemeOverrides } from "./candidate-theme";
import PreviewControls from "./PreviewControls.vue";

const props = defineProps<{ theme: "light" | "dark"; variant: "current" | "candidate" }>();
const route = useRoute();
const theme = ref(props.theme);
const variant = ref(props.variant);
const isAtlas = computed(() => route.path === "/atlas");
const showControls = new URLSearchParams(location.search).get('controls') === '1';

function applyAppearance(event: Event): void {
  const detail = (event as CustomEvent<{ theme?: string; variant?: string }>).detail;
  if (detail?.theme === "light" || detail?.theme === "dark") {
    document.documentElement.dataset.theme = detail.theme;
    theme.value = detail.theme;
  }
  if (detail?.variant === "current" || detail?.variant === "candidate") {
    document.documentElement.dataset.palette = detail.variant;
    variant.value = detail.variant;
  }
}

window.addEventListener("component-color-preview-appearance", applyAppearance);
onBeforeUnmount(() => window.removeEventListener("component-color-preview-appearance", applyAppearance));

const overrides = computed(() => {
  void theme.value;
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string) => styles.getPropertyValue(name);
  return variant.value === "candidate"
    ? createCandidateThemeOverrides(read)
    : createNaiveThemeOverrides(read);
});
</script>

<template>
  <NConfigProvider :theme="theme === 'dark' ? darkTheme : null" :theme-overrides="overrides">
    <NMessageProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <RouterView v-if="isAtlas" />
          <YjAppShell v-else><RouterView /></YjAppShell>
          <PreviewControls v-if="showControls" />
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
