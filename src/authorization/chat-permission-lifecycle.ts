export interface ChatAuthoritySnapshot {
  readonly ready: boolean;
  readonly tenantId: string | null;
  readonly authorizationRevision: number | null;
  readonly expiresAt: string | null;
  readonly canCreateTask: boolean;
  readonly canReadTask: boolean;
}

export interface ChatAuthorityStoreBoundary {
  bind(tenantSelector: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface ChatPermissionLifecycle {
  synchronize(snapshot: ChatAuthoritySnapshot): Promise<void>;
  stop(): Promise<void>;
}

export function createChatPermissionLifecycle(
  store: ChatAuthorityStoreBoundary,
  enabled: boolean,
): ChatPermissionLifecycle {
  let epoch = 0;
  let desiredAuthorityKey: string | null = null;

  function authorityKey(snapshot: ChatAuthoritySnapshot): string | null {
    if (
      !enabled ||
      !snapshot.ready ||
      snapshot.tenantId === null ||
      snapshot.authorizationRevision === null ||
      (!snapshot.canCreateTask && !snapshot.canReadTask)
    ) {
      return null;
    }
    return [
      snapshot.tenantId,
      snapshot.authorizationRevision,
      snapshot.expiresAt ?? "",
      snapshot.canCreateTask ? "create" : "",
      snapshot.canReadTask ? "read" : "",
    ].join(":");
  }

  return {
    async synchronize(snapshot) {
      const nextAuthorityKey = authorityKey(snapshot);
      if (nextAuthorityKey === desiredAuthorityKey) return;
      desiredAuthorityKey = nextAuthorityKey;
      const current = ++epoch;
      await store.dispose();
      if (
        current !== epoch ||
        nextAuthorityKey === null ||
        snapshot.tenantId === null
      ) {
        return;
      }
      await store.bind(snapshot.tenantId);
    },
    async stop() {
      epoch += 1;
      desiredAuthorityKey = null;
      await store.dispose();
    },
  };
}
