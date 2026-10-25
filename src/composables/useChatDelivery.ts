import { ref, watch } from "vue";
import { chatDeliveryClient, type DeliveryState } from "../api/chat-delivery-client";

export function useChatDelivery(
  context: () => string | null, session: () => string | null,
  canCancel: () => boolean, change: () => string, onCancelled: () => Promise<void>,
) {
  const states = ref<readonly DeliveryState[]>([]);
  const loading = ref(false), cancelling = ref<string | null>(null), error = ref(""), notice = ref("");
  let epoch = 0;
  async function refresh() {
    const ctx = context(), target = session(), current = ++epoch;
    if (!ctx || !target) { states.value = []; loading.value = false; return; }
    loading.value = true; error.value = "";
    try {
      const result = await chatDeliveryClient.read(ctx, target);
      if (current === epoch && ctx === context() && target === session()) states.value = result;
    } catch {
      if (current === epoch) { states.value = []; error.value = "暂时无法核对提交状态，请刷新后重试。"; }
    } finally { if (current === epoch) loading.value = false; }
  }
  async function cancel(operationId: string) {
    const ctx = context(), target = session(), item = states.value.find(row => row.operationId === operationId);
    if (!ctx || !target || !canCancel() || !item?.cancellable || loading.value || cancelling.value) return;
    const current = ++epoch;
    cancelling.value = operationId; error.value = ""; notice.value = "";
    try {
      await chatDeliveryClient.cancel(ctx, target, item);
      if (current !== epoch || ctx !== context() || target !== session()) return;
      states.value = states.value.filter(row => row.operationId !== operationId);
      notice.value = "提交已取消，原消息已保留。";
      await onCancelled();
    } catch {
      if (current === epoch) { states.value = []; error.value = "取消结果待核实，提交可能已开始。请刷新查看原提交。"; }
    } finally { if (current === epoch) cancelling.value = null; }
  }
  watch([context, session], () => { epoch++; states.value = []; loading.value = false; cancelling.value = null; error.value = ""; notice.value = ""; void refresh(); }, { immediate: true });
  watch(change, () => { if (!cancelling.value) void refresh(); });
  return { states, loading, cancelling, error, notice, refresh, cancel };
}
