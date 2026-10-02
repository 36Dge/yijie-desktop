import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import { chatModelClient, chatModelsEnabled, type ProfileId } from "../api/chat-model-client";
import { useChatStore } from "../stores/chat.store";
import type { TargetMode } from "../domain/scheduled-plan.generated";

/** Plan execution selection is independent of the conversation used to draft it. */
export function useScheduledPlanModel(
  form: { modelProfile: ProfileId; mode: TargetMode; conversationId: string | null },
  boundConversation: () => string | null = () => null,
) {
  const chat = chatModelsEnabled ? useChatStore() : null;
  const modelOptions = reactive<{ label: string; value: string; disabled: boolean }[]>([
    { label: "Kimi K3 · max", value: "kimi-k3-max-v1", disabled: false },
    { label: "MiniMax M3", value: "minimax-m3-high-v1", disabled: false },
  ]);
  const target = computed(() => form.mode === "existing_chat" ? form.conversationId : form.mode === "dedicated_chat" ? boundConversation() : null);
  const modelLocked = computed(() => form.mode === "existing_chat" || target.value !== null);
  const modelReady = ref(!chatModelsEnabled), notice = ref("");
  let epoch = 0;
  const modelNotice = computed(() => modelReady.value && modelOptions.some(m => m.value === form.modelProfile && m.disabled)
    ? "执行模型未配置，请选择可用模型。" : notice.value);
  watch([() => form.mode, target, () => chat?.context?.contextId], async () => {
    const current = ++epoch;
    if (!chatModelsEnabled) return;
    modelReady.value = false; notice.value = "正在确认执行模型…";
    if (form.mode === "existing_chat" && !target.value) {
      notice.value = "选择已有聊天后，读取该聊天当前已确认的模型。";
      return;
    }
    try {
      const ctx = chat?.context?.contextId;
      if (!ctx) throw new Error();
      const conversation = target.value;
      const catalog = await chatModelClient.catalog(ctx);
      const selection = conversation ? await chatModelClient.state(ctx, conversation) : null;
      if (current !== epoch) return;
      if (modelLocked.value) {
        if (!selection || selection.state !== "ready" || !selection.profileId || selection.pending) throw new Error();
        form.modelProfile = selection.profileId;
      }
      modelOptions.splice(0, modelOptions.length, ...catalog.models.map(m => ({
        label: m.profile.label + (m.profile.effort === "max" ? " · max" : "") + (m.available ? "" : "（未配置）"),
        value: m.profile.profile_id, disabled: !m.available,
      })));
      modelReady.value = true;
      notice.value = modelLocked.value
        ? "采用关联聊天当前已确认的模型；保存后需按新配置重新授权，聊天不会被自动切换。"
        : "按此模型执行，不随聊天框的选择改变。";
    } catch {
      if (current === epoch) notice.value = "暂时无法确认执行模型，请关闭后重试。";
    }
  }, { immediate: true });
  onScopeDispose(() => { epoch++; });
  return { modelOptions, modelReady, modelNotice, modelLocked };
}
