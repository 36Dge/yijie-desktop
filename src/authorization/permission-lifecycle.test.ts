import { describe, expect, it, vi } from "vitest";
import { createPermissionLifecycle, type VisibilityDocument } from "./permission-lifecycle";

class FakeVisibilityDocument implements VisibilityDocument {
  visibilityState: DocumentVisibilityState = "visible";
  listener: (() => void) | null = null;

  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listener = listener;
  }

  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    if (this.listener === listener) {
      this.listener = null;
    }
  }

  changeTo(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    this.listener?.();
  }
}

describe("permission lifecycle", () => {
  it("LIFECYCLE-001 initializes once and refreshes after a hidden-to-visible transition", async () => {
    const visibilityDocument = new FakeVisibilityDocument();
    const ensureInitialized = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);
    const lifecycle = createPermissionLifecycle(
      { ensureInitialized, refresh },
      visibilityDocument,
    );

    await lifecycle.start();
    await lifecycle.start();
    visibilityDocument.changeTo("hidden");
    visibilityDocument.changeTo("visible");
    await Promise.resolve();
    await Promise.resolve();

    expect(ensureInitialized).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    lifecycle.stop();
    expect(visibilityDocument.listener).toBeNull();
  });

  it("LIFECYCLE-002 ignores repeated visible events", async () => {
    const visibilityDocument = new FakeVisibilityDocument();
    const refresh = vi.fn(async () => undefined);
    const lifecycle = createPermissionLifecycle(
      { ensureInitialized: async () => undefined, refresh },
      visibilityDocument,
    );
    await lifecycle.start();

    visibilityDocument.changeTo("visible");
    visibilityDocument.changeTo("visible");
    await Promise.resolve();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh the no-auth Demo profile when the window returns to foreground", async () => {
    const visibilityDocument = new FakeVisibilityDocument();
    const refresh = vi.fn(async () => undefined);
    const lifecycle = createPermissionLifecycle(
      { ensureInitialized: async () => undefined, refresh },
      visibilityDocument,
      false,
    );
    await lifecycle.start();

    visibilityDocument.changeTo("hidden");
    visibilityDocument.changeTo("visible");
    await Promise.resolve();

    expect(refresh).not.toHaveBeenCalled();
  });
});
