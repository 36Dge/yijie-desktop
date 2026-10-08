import { watch, type Ref } from "vue";
import { usePermissionStore } from "../stores/permission.store";
import { useMarketConnectorStore } from "../stores/market-connectors.store";

/** The local Native identity is fixed; tenant changes are a different scope. */
export function useMarketConnectorBinding(context: Readonly<Ref<string | null>>): void {
  const permission = usePermissionStore(), connectors = useMarketConnectorStore();
  watch(() => [context.value, permission.selectedTenantId, permission.phase, permission.hasCapability("connector.read")] as const,
    ([contextId, tenantId, phase, canRead]) => {
      const revoked = ["idle", "unauthorized", "user-access-denied", "tenant-access-denied", "invalid-tenant-context", "invalid-projection", "ready-empty"].includes(phase) || (phase === "ready" && !canRead);
      const scope = !revoked && tenantId ? `local:${tenantId}` : null;
      void connectors.bind(phase === "ready" && canRead ? contextId : null, scope);
    }, { immediate: true, flush: "sync" });
}
