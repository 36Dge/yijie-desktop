export interface ChatAuthoritySnapshot {
  readonly ready: boolean;
  readonly tenantId: string | null;
  readonly authorizationRevision: number | null;
  readonly expiresAt: string | null;
  readonly canCreateTask: boolean;
  readonly canReadTask: boolean;
}

export interface ChatAuthorityStoreBoundary {
  bind(tenantSelector: string): Promise<boolean | void>;
  isAuthorityBound?(): boolean;
  dispose(): Promise<void>;
}

export interface ChatPermissionLifecycle {
  synchronize(snapshot: ChatAuthoritySnapshot): Promise<boolean>;
  retry(): Promise<boolean>;
  stop(): Promise<void>;
}

export function createChatPermissionLifecycle(
  store: ChatAuthorityStoreBoundary,
  enabled: boolean,
): ChatPermissionLifecycle {
  let epoch = 0;
  let desiredAuthorityKey: string | null = null;
  let boundAuthorityKey: string | null = null;
  let latestSnapshot: ChatAuthoritySnapshot | null = null;
  let pending: Readonly<{
    key: string | null;
    epoch: number;
    promise: Promise<boolean>;
  }> | null = null;

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

  function synchronizeSnapshot(
    snapshot: ChatAuthoritySnapshot,
    force: boolean,
  ): Promise<boolean> {
    const nextAuthorityKey = authorityKey(snapshot);
    const previousDesiredAuthorityKey = desiredAuthorityKey;
    latestSnapshot = snapshot;
    desiredAuthorityKey = nextAuthorityKey;

    if (pending?.key === nextAuthorityKey) return pending.promise;
    if (!force && nextAuthorityKey !== null && nextAuthorityKey === boundAuthorityKey) {
      return Promise.resolve(true);
    }
    if (
      nextAuthorityKey === null &&
      previousDesiredAuthorityKey === null &&
      boundAuthorityKey === null
    ) {
      return Promise.resolve(false);
    }

    boundAuthorityKey = null;
    const current = ++epoch;
    const attempt = {
      key: nextAuthorityKey,
      epoch: current,
      promise: Promise.resolve(false),
    };
    attempt.promise = Promise.resolve().then(async () => {
      try {
        await store.dispose();
        if (
          current !== epoch ||
          desiredAuthorityKey !== nextAuthorityKey ||
          nextAuthorityKey === null ||
          snapshot.tenantId === null
        ) {
          return false;
        }
        const result = await store.bind(snapshot.tenantId);
        if (current !== epoch || desiredAuthorityKey !== nextAuthorityKey) return false;
        const succeeded = result !== false && (store.isAuthorityBound?.() ?? true);
        boundAuthorityKey = succeeded ? nextAuthorityKey : null;
        return succeeded;
      } catch {
        if (current === epoch && desiredAuthorityKey === nextAuthorityKey) {
          boundAuthorityKey = null;
        }
        return false;
      }
    }).finally(() => {
      if (pending?.epoch === current) pending = null;
    });
    pending = attempt;
    return attempt.promise;
  }

  return {
    synchronize(snapshot) {
      return synchronizeSnapshot(snapshot, false);
    },
    retry() {
      if (latestSnapshot === null) return Promise.resolve(false);
      return synchronizeSnapshot(latestSnapshot, true);
    },
    async stop() {
      epoch += 1;
      desiredAuthorityKey = null;
      boundAuthorityKey = null;
      latestSnapshot = null;
      pending = null;
      await store.dispose();
    },
  };
}
