export interface PermissionLifecycleStore {
  ensureInitialized(): Promise<void>;
  refresh(): Promise<void>;
}

export interface VisibilityDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface PermissionLifecycle {
  start(): Promise<void>;
  stop(): void;
}

export function createPermissionLifecycle(
  store: PermissionLifecycleStore,
  routeToRecovery: () => Promise<void> | void,
  visibilityDocument: VisibilityDocument,
): PermissionLifecycle {
  let started = false;
  let wasHidden = visibilityDocument.visibilityState === "hidden";
  let foregroundRefresh: Promise<void> | null = null;

  async function refreshOnForeground(): Promise<void> {
    if (foregroundRefresh !== null) {
      return foregroundRefresh;
    }
    await routeToRecovery();
    const refresh = store.refresh();
    foregroundRefresh = refresh.finally(() => {
      foregroundRefresh = null;
    });
    return foregroundRefresh;
  }

  function handleVisibilityChange(): void {
    if (visibilityDocument.visibilityState === "hidden") {
      wasHidden = true;
      return;
    }
    if (wasHidden) {
      wasHidden = false;
      void refreshOnForeground();
    }
  }

  return {
    async start(): Promise<void> {
      if (started) {
        return;
      }
      started = true;
      visibilityDocument.addEventListener("visibilitychange", handleVisibilityChange);
      await store.ensureInitialized();
    },
    stop(): void {
      if (!started) {
        return;
      }
      started = false;
      visibilityDocument.removeEventListener("visibilitychange", handleVisibilityChange);
    },
  };
}
