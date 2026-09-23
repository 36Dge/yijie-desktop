export interface ChatAuthoritySnapshot {
  readonly ready: boolean;
  readonly managementOnly?: boolean;
  readonly canReadSchedule?: boolean;
  readonly tenantId: string | null;
  readonly authorizationRevision: number | null;
  readonly expiresAt: string | null;
  readonly canCreateTask: boolean;
  readonly canReadTask: boolean;
}

export interface ChatAuthorityStoreBoundary {
  bind(tenantSelector: string, managementOnly?: boolean): Promise<boolean | void>;
  isAuthorityBound?(): boolean;
  dispose(): Promise<void>;
}

export interface ChatPermissionLifecycle {
  synchronize(snapshot: ChatAuthoritySnapshot): Promise<boolean>;
  retry(): Promise<boolean>;
  prepareExecution(): Promise<boolean>;
  stop(): Promise<void>;
}

export function createChatPermissionLifecycle(
  store: ChatAuthorityStoreBoundary,
  enabled: boolean,
): ChatPermissionLifecycle {
  let epoch = 0;
  let boundManagementOnly = false;
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
      (!snapshot.canCreateTask && !snapshot.canReadTask && !snapshot.canReadSchedule)
    ) {
      return null;
    }
    return [
      snapshot.tenantId,
      snapshot.authorizationRevision,
      snapshot.expiresAt ?? "",
      snapshot.canCreateTask ? "create" : "",
      snapshot.canReadTask ? "read" : "",
      snapshot.canReadSchedule ? "schedule" : "",
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

    if (pending?.key === nextAuthorityKey) {
      return pending.promise.then(result => result && !snapshot.managementOnly && boundManagementOnly
        ? synchronizeSnapshot(snapshot, false) : result);
    }
    if (!force && nextAuthorityKey !== null && nextAuthorityKey === boundAuthorityKey && (store.isAuthorityBound?.() ?? true) && (snapshot.managementOnly || !boundManagementOnly)) {
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
        const result = snapshot.managementOnly
          ? await store.bind(snapshot.tenantId, true)
          : await store.bind(snapshot.tenantId);
        if (current !== epoch || desiredAuthorityKey !== nextAuthorityKey) return false;
        const succeeded = result !== false && (store.isAuthorityBound?.() ?? true);
        boundAuthorityKey = succeeded ? nextAuthorityKey : null;
        boundManagementOnly = succeeded && snapshot.managementOnly === true;
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
    prepareExecution() {
      if (latestSnapshot === null || !latestSnapshot.canCreateTask || !latestSnapshot.canReadTask) return Promise.resolve(false);
      return synchronizeSnapshot({ ...latestSnapshot, managementOnly: false }, false);
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
