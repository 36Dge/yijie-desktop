export interface FrameProjectionScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export interface FrameBatchedProjection<T> {
  push(value: T, defer: boolean): void;
  flush(): boolean;
  dispose(): void;
}

export function browserFrameProjectionScheduler(): FrameProjectionScheduler {
  const scheduler: FrameProjectionScheduler = {
    request: (callback: () => void): number => window.requestAnimationFrame(() => callback()),
    cancel: (handle: number): void => window.cancelAnimationFrame(handle),
  };
  return Object.freeze(scheduler);
}

/**
 * Keeps the semantic authority synchronous while bounding presentation updates
 * to one per frame. A temporary publication gate can preserve an active text
 * selection; the caller flushes after the selection is released.
 */
export function createFrameBatchedProjection<T>(
  publish: (value: T) => void,
  scheduler: FrameProjectionScheduler,
  canPublish: () => boolean = () => true,
): FrameBatchedProjection<T> {
  let pending: T | undefined;
  let hasPending = false;
  let frame: number | null = null;
  let disposed = false;

  function cancelFrame(): void {
    if (frame === null) return;
    scheduler.cancel(frame);
    frame = null;
  }

  function flush(): boolean {
    if (disposed || !hasPending || !canPublish()) return false;
    cancelFrame();
    const value = pending as T;
    pending = undefined;
    hasPending = false;
    publish(value);
    return true;
  }

  function schedule(): void {
    if (disposed || frame !== null) return;
    frame = scheduler.request(() => {
      frame = null;
      void flush();
    });
  }

  return Object.freeze({
    push(value: T, defer: boolean): void {
      if (disposed) return;
      pending = value;
      hasPending = true;
      if (!defer && flush()) return;
      schedule();
    },
    flush,
    dispose(): void {
      disposed = true;
      cancelFrame();
      pending = undefined;
      hasPending = false;
    },
  });
}
