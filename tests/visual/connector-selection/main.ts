import { computed, createApp, defineComponent, h, ref, watch } from "vue";
import { darkTheme, NConfigProvider } from "naive-ui";
import ChatComposer from "../../../src/components/chat/ChatComposer.vue";
import ChatConnectorControl from "../../../src/components/chat/ChatConnectorControl.vue";
import ChatSkillControl from "../../../src/components/chat/ChatSkillControl.vue";
import { createNaiveThemeOverrides } from "../../../src/design/theme/naive-theme";
import { insertDraftSkill, type SkillPosition, type SkillSelectionRange } from "../../../src/domain/chat-skill-placement";
import type { ChatSkillChip } from "../../../src/domain/chat-skills";
import type { ConnectorView } from "../../../src/domain/connector-ui";
import { installedSkill } from "../../../src/test/skill-fixture";
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
  const prompt = ref("");
  const skills = ref<ChatSkillChip[]>([{ ...installedSkill, offset: 0, unavailableReason: null }]);
  watch(dark, value => document.documentElement.setAttribute("data-theme", value ? "dark" : "light"), { immediate: true, flush: "sync" });
  const overrides = computed(() => { void dark.value; const style = getComputedStyle(document.documentElement); return createNaiveThemeOverrides(name => style.getPropertyValue(name)); });

  return () => h(NConfigProvider, { theme: dark.value ? darkTheme : null, themeOverrides: overrides.value }, { default: () => h("main", [
    h("h1", "对话连接器选用验证"),
    h("nav", [h("button", { onClick: () => { dark.value = !dark.value; } }, dark.value ? "切换亮色" : "切换暗色"),
      h("button", { onClick: () => { available.value = !available.value; } }, available.value ? "检查禁用样式" : "恢复可选用")]),
    h(ChatComposer, {
      mode: "new", modelValue: prompt.value, projects: [], selectedProjectId: null,
      readiness: { title: "本地预览", detail: "", actionLabel: null, tone: "success" },
      canSend: true, canAttach: false, submissionState: "idle", streaming: false, recoveryAvailable: false,
      connectors: entries.filter(entry => selected.value.includes(entry.id)), skills: skills.value,
      "onUpdate:modelValue": (value: string) => { prompt.value = value; },
      onInsertSkill: (_id: string, range: SkillSelectionRange) => {
        const next = insertDraftSkill(prompt.value, skills.value, installedSkill, range);
        prompt.value = next.text;
        skills.value = next.skills.map(skill => ({ ...skill, unavailableReason: null }));
      },
      onRemoveSkill: () => { skills.value = []; },
      onEditSkillDraft: (value: string, positions: readonly SkillPosition[]) => {
        prompt.value = value;
        skills.value = positions.map(position => ({ ...installedSkill, ...position, unavailableReason: null }));
      },
    }, {
      "connector-control": ({ close }) => h(ChatConnectorControl, {
        entries, selectedIds: selected.value, selectionAvailable: available.value, onClose: close,
        onSelectionChange: (id: string, checked: boolean) => {
          selected.value = checked ? [...selected.value, id] : selected.value.filter(item => item !== id);
        },
      }),
      "skill-control": ({ close, select }) => h(ChatSkillControl, {
        entries: [installedSkill], selectedIds: skills.value.map(skill => skill.id), disabled: false,
        loading: false, error: null, operations: {}, operationErrors: {}, onSelect: select, onClose: close,
      }),
    }),
  ]) });
} })).mount("#app");
