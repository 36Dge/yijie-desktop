import { computed, createApp, defineComponent, h, ref, watch } from "vue";
import { darkTheme, NConfigProvider } from "naive-ui";
import ChatConnectorControl from "../../../src/components/chat/ChatConnectorControl.vue";
import { createNaiveThemeOverrides } from "../../../src/design/theme/naive-theme";
import type { ConnectorView } from "../../../src/domain/connector-ui";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import "../../../src/styles/component-colors.css";
import "./preview.css";

// Ordinary component-only fixture: no Native IPC, provider or model request.
const entries: ConnectorView[] = [
  ["shopify", "Shopify MCP"], ["sorftime", "Sorftime"], ["tushareMcp", "Tushare·金融数据"], ["kimi-web", "Kimi 网页检索"],
].map(([id, name]) => ({ id: id!, name: name!, iconAssetId: id!, installed: true, enabled: true, selectable: true,
  desiredEnabled: true, status: { label: "已启用", tone: "success" }, busy: false, actions: ["disable"],
  categoryId: "test", categoryLabel: "组件验证", description: "合成状态", explanation: null, configurationLabel: "" }));

createApp(defineComponent({ setup() {
  const dark = ref(false), available = ref(true), selected = ref<string[]>([]);
  watch(dark, value => document.documentElement.setAttribute("data-theme", value ? "dark" : "light"), { immediate: true, flush: "sync" });
  const overrides = computed(() => { void dark.value; const style = getComputedStyle(document.documentElement); return createNaiveThemeOverrides(name => style.getPropertyValue(name)); });
  return () => h(NConfigProvider, { theme: dark.value ? darkTheme : null, themeOverrides: overrides.value }, { default: () => h("main", [
    h("h1", "连接器选用开关验证"), h("p", "合成组件状态，不代表真实供应商连接。"),
    h("nav", [h("button", { onClick: () => { dark.value = !dark.value; } }, dark.value ? "切换亮色" : "切换暗色"),
      h("button", { onClick: () => { available.value = !available.value; } }, available.value ? "检查禁用样式" : "恢复可选用")]),
    h("div", { class: "preview-panel" }, [h(ChatConnectorControl, { entries, selectedIds: selected.value,
      selectionAvailable: available.value, canManage: true,
      "onSelection-change": (id: string, value: boolean) => { selected.value = value ? [...selected.value, id] : selected.value.filter(item => item !== id); },
    })]),
    h("output", `当前对话选用：${selected.value.length}；连接器全局启用：4`),
  ]) });
} })).mount("#app");
