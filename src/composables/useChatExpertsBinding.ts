import { watch, type Ref } from "vue";
import { usePermissionStore } from "../stores/permission.store";
import { useChatExpertsStore } from "../stores/chat-experts.store";

export function useChatExpertsBinding(context: Readonly<Ref<string | null>>, session: Readonly<Ref<string | null>>) {
  const permission = usePermissionStore(), experts = useChatExpertsStore();
  watch(() => [context.value, permission.selectedTenantId, permission.phase, permission.hasCapability("task.read"), session.value] as const,
    ([contextId, tenant, phase, canRead, selected]) => {
      const revoked = ["idle", "unauthorized", "user-access-denied", "tenant-access-denied", "invalid-tenant-context", "invalid-projection", "ready-empty"].includes(phase) || (phase === "ready" && !canRead);
      experts.bind(phase === "ready" && canRead ? contextId : null, !revoked && tenant ? `local:${tenant}` : null);
      if (selected && experts.contextId) void experts.refresh(selected);
    }, { immediate: true, flush: "sync" });
}
