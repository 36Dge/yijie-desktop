export interface ChatAuthoritySnapshot {
  readonly ready: boolean;
  readonly tenantId: string | null;
  readonly authorizationRevision: number | null;
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

  return {
    async synchronize(snapshot) {
      const current = ++epoch;
      await store.dispose();
      if (
        current !== epoch ||
        !enabled ||
        !snapshot.ready ||
        snapshot.tenantId === null ||
        snapshot.authorizationRevision === null ||
        (!snapshot.canCreateTask && !snapshot.canReadTask)
      ) {
        return;
      }
      await store.bind(snapshot.tenantId);
    },
    async stop() {
      epoch += 1;
      await store.dispose();
    },
  };
}
