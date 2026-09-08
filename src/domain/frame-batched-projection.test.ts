import { describe,expect,it,vi } from "vitest";
import {
createFrameBatchedProjection,
type FrameProjectionScheduler,
} from "./frame-batched-projection";

function controlledScheduler() {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;
  const scheduler: FrameProjectionScheduler = {
    request(callback) {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      callbacks.delete(handle);
    },
  };
  return {
    scheduler,
    callbacks,
    runFrame() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
  };
}

describe("frame-batched presentation projection", () => {
  it("publishes only the latest value once per frame without dropping semantic input", () => {
    const controlled = controlledScheduler();
    const publish = vi.fn();
    const projection = createFrameBatchedProjection(publish, controlled.scheduler);

    for (let value = 1; value <= 1_000; value += 1) projection.push(value, true);
    expect(controlled.callbacks.size).toBe(1);
    expect(publish).not.toHaveBeenCalled();

    controlled.runFrame();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenLastCalledWith(1_000);
  });

  it("holds a pending render while text is selected and flushes exactly once after release", () => {
    const controlled = controlledScheduler();
    const publish = vi.fn();
    let selectionActive = true;
    const projection = createFrameBatchedProjection(
      publish,
      controlled.scheduler,
      () => !selectionActive,
    );

    projection.push("partial", true);
    controlled.runFrame();
    projection.push("final", false);
    expect(publish).not.toHaveBeenCalled();

    selectionActive = false;
    expect(projection.flush()).toBe(true);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith("final");
    controlled.runFrame();
    expect(publish).toHaveBeenCalledOnce();
  });

  it("cancels pending publication on disposal", () => {
    const controlled = controlledScheduler();
    const publish = vi.fn();
    const projection = createFrameBatchedProjection(publish, controlled.scheduler);
    projection.push("stale", true);
    projection.dispose();
    controlled.runFrame();
    expect(publish).not.toHaveBeenCalled();
  });

  it("replaces a pending session publication before the next frame", () => {
    const controlled = controlledScheduler();
    const publish = vi.fn();
    const projection = createFrameBatchedProjection(publish, controlled.scheduler);

    projection.push({ sessionId: "old", revision: 1 }, true);
    projection.push({ sessionId: "new", revision: 2 }, false);

    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith({ sessionId: "new", revision: 2 });
    controlled.runFrame();
    expect(publish).toHaveBeenCalledOnce();
  });
});
