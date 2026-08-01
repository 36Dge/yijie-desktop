import { computed, onScopeDispose, ref } from "vue";
import { defineStore } from "pinia";
import { permissionClient, PermissionClientError, type PermissionClient } from "../api/permission-client";
import type {
  KnownCapability,
  PermissionFailureKind,
  PermissionPhase,
  PermissionProjection,
  TenantOption,
} from "../domain/permissions";

const STORE_ID = "permissions";

function phaseForFailure(kind: PermissionFailureKind): PermissionPhase {
  return kind === "aborted" ? "idle" : kind;
}

export function createPermissionStoreDefinition(
  client: PermissionClient,
  storeId = STORE_ID,
) {
  return defineStore(storeId, () => {
    const phase = ref<PermissionPhase>("idle");
    const tenants = ref<readonly TenantOption[]>(Object.freeze([]));
    const selectedTenantId = ref<string | null>(null);
    const authorizationRevision = ref<number | null>(null);
    const expiresAt = ref<string | null>(null);
    const capabilities = ref<readonly KnownCapability[]>(Object.freeze([]));
    const lastFailure = ref<PermissionFailureKind | null>(null);
    const isReady = computed(() => phase.value === "ready" || phase.value === "ready-empty");

    let requestEpoch = 0;
    let activeController: AbortController | null = null;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    let expiresAtEpochMs: number | null = null;
    const lastAcceptedRevision = new Map<
      string,
      { revision: number; capabilityKey: string }
    >();

    function clearExpiryTimer(): void {
      if (expiryTimer !== null) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
      }
    }

    function clearProjection(): void {
      clearExpiryTimer();
      authorizationRevision.value = null;
      expiresAt.value = null;
      expiresAtEpochMs = null;
      capabilities.value = Object.freeze([]);
    }

    function startRequest(nextPhase: PermissionPhase): {
      epoch: number;
      controller: AbortController;
    } {
      activeController?.abort();
      clearProjection();
      requestEpoch += 1;
      const controller = new AbortController();
      activeController = controller;
      phase.value = nextPhase;
      lastFailure.value = null;
      return { epoch: requestEpoch, controller };
    }

    function isCurrent(epoch: number, controller: AbortController): boolean {
      return requestEpoch === epoch && activeController === controller && !controller.signal.aborted;
    }

    function completeRequest(epoch: number, controller: AbortController): boolean {
      if (!isCurrent(epoch, controller)) {
        return false;
      }
      activeController = null;
      return true;
    }

    function applyFailure(
      error: unknown,
      epoch: number,
      controller: AbortController,
    ): void {
      if (!isCurrent(epoch, controller)) {
        return;
      }
      activeController = null;
      clearProjection();
      const kind = error instanceof PermissionClientError ? error.kind : "unavailable";
      if (kind === "aborted") {
        return;
      }
      lastFailure.value = kind;
      phase.value = phaseForFailure(kind);
      if (kind === "unauthorized" || kind === "user-access-denied") {
        tenants.value = Object.freeze([]);
        selectedTenantId.value = null;
        lastAcceptedRevision.clear();
      } else if (kind === "tenant-access-denied" || kind === "invalid-tenant-context") {
        selectedTenantId.value = null;
      }
    }

    function scheduleExpiry(projection: PermissionProjection): void {
      clearExpiryTimer();
      const scheduledEpoch = requestEpoch;
      const scheduledTenant = projection.tenantId;
      const delay = Math.max(0, projection.expiresAtEpochMs - Date.now());
      expiryTimer = setTimeout(() => {
        expiryTimer = null;
        if (
          requestEpoch !== scheduledEpoch ||
          selectedTenantId.value !== scheduledTenant ||
          !isReady.value
        ) {
          return;
        }
        clearProjection();
        void loadTenant(scheduledTenant);
      }, delay);
    }

    async function loadTenant(tenantId: string): Promise<void> {
      const selected = tenants.value.find((tenant) => tenant.tenantId === tenantId);
      if (!selected) {
        activeController?.abort();
        requestEpoch += 1;
        activeController = null;
        clearProjection();
        selectedTenantId.value = null;
        lastFailure.value = "invalid-tenant-context";
        phase.value = "invalid-tenant-context";
        return;
      }

      const { epoch, controller } = startRequest("loading");
      selectedTenantId.value = selected.tenantId;
      try {
        const projection = await client.getMyCapabilities(
          selected.tenantId,
          controller.signal,
          Date.now(),
        );
        if (!isCurrent(epoch, controller)) {
          return;
        }
        const previousRevision = lastAcceptedRevision.get(selected.tenantId);
        const capabilityKey = projection.capabilities.join("\u0000");
        if (
          previousRevision !== undefined &&
          (projection.authorizationRevision < previousRevision.revision ||
            (projection.authorizationRevision === previousRevision.revision &&
              capabilityKey !== previousRevision.capabilityKey))
        ) {
          throw new PermissionClientError("invalid-projection");
        }
        if (!completeRequest(epoch, controller)) {
          return;
        }

        const nextCapabilities = Object.freeze([...projection.capabilities]);
        lastAcceptedRevision.set(selected.tenantId, {
          revision: projection.authorizationRevision,
          capabilityKey,
        });
        authorizationRevision.value = projection.authorizationRevision;
        expiresAt.value = projection.expiresAt;
        expiresAtEpochMs = projection.expiresAtEpochMs;
        capabilities.value = nextCapabilities;
        phase.value = nextCapabilities.length === 0 ? "ready-empty" : "ready";
        lastFailure.value = null;
        scheduleExpiry(projection);
      } catch (error: unknown) {
        applyFailure(error, epoch, controller);
      }
    }

    async function discoverTenants(): Promise<void> {
      const { epoch, controller } = startRequest("discovering");
      tenants.value = Object.freeze([]);
      selectedTenantId.value = null;
      lastAcceptedRevision.clear();
      try {
        const discovered = await client.listMyTenants(controller.signal);
        if (!completeRequest(epoch, controller)) {
          return;
        }
        tenants.value = Object.freeze([...discovered]);
        if (discovered.length === 0) {
          phase.value = "recovery";
          return;
        }
        if (discovered.length > 1) {
          phase.value = "tenant-selection-required";
          return;
        }
        await loadTenant(discovered[0].tenantId);
      } catch (error: unknown) {
        applyFailure(error, epoch, controller);
      }
    }

    async function selectTenant(tenantId: string): Promise<void> {
      await loadTenant(tenantId);
    }

    async function refresh(): Promise<void> {
      if (selectedTenantId.value !== null) {
        await loadTenant(selectedTenantId.value);
      } else {
        await discoverTenants();
      }
    }

    function hasCapability(capability: KnownCapability): boolean {
      return (
        isReady.value &&
        expiresAtEpochMs !== null &&
        expiresAtEpochMs > Date.now() &&
        capabilities.value.includes(capability)
      );
    }

    function clearForLogout(): void {
      activeController?.abort();
      activeController = null;
      requestEpoch += 1;
      clearProjection();
      tenants.value = Object.freeze([]);
      selectedTenantId.value = null;
      lastFailure.value = null;
      phase.value = "idle";
      lastAcceptedRevision.clear();
    }

    onScopeDispose(clearForLogout);

    return {
      phase,
      tenants,
      selectedTenantId,
      authorizationRevision,
      expiresAt,
      capabilities,
      lastFailure,
      isReady,
      discoverTenants,
      selectTenant,
      refresh,
      hasCapability,
      clearForLogout,
    };
  });
}

export const usePermissionStore = createPermissionStoreDefinition(permissionClient);
