import { watch, type Ref } from "vue";
import { usePermissionStore } from "../stores/permission.store";
import { useExpertsStore } from "../stores/experts.store";

export function useExpertsBinding(context: Readonly<Ref<string | null>>): void {
  const permission = usePermissionStore(), experts = useExpertsStore();
  watch(() => [context.value, permission.selectedTenantId, permission.phase, permission.hasCapability("plugin.read")] as const,
    ([contextId, tenantId, phase, canRead]) => {
      const revoked = ["idle", "unauthorized", "user-access-denied", "tenant-access-denied", "invalid-tenant-context", "invalid-projection", "ready-empty"].includes(phase) || (phase === "ready" && !canRead);
      const scope = !revoked && tenantId ? `local:${tenantId}` : null;
      void experts.bind(phase === "ready" && canRead ? contextId : null, scope);
    }, { immediate: true, flush: "sync" });
}
