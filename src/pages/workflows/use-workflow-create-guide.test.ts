// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

const legacyKey = "yijie.desktop.ui.workflow-create-guide.v1";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

it("ignores the old durable preference, shares visits across route mounts, and resets on client restart", async () => {
  const storage = {
    getItem: vi.fn((key: string) => key === legacyKey ? "seen" : null),
    setItem: vi.fn(),
  };
  vi.stubGlobal("localStorage", storage);
  expect(window.localStorage).toBe(storage);
  const firstRuntime = await import("./use-workflow-create-guide");
  const firstPage = firstRuntime.useWorkflowCreateGuide();
  expect(firstPage.show.value).toBe(false);
  firstPage.enter();
  expect(firstPage.show.value).toBe(true);
  firstPage.dismiss();
  expect(firstPage.show.value).toBe(false);
  const revisitedPage = firstRuntime.useWorkflowCreateGuide();
  revisitedPage.enter();
  expect(revisitedPage.show.value).toBe(false);

  vi.resetModules();
  const nextRuntime = await import("./use-workflow-create-guide");
  const restartedPage = nextRuntime.useWorkflowCreateGuide();
  restartedPage.enter();
  expect(restartedPage.show.value).toBe(true);
  expect(storage.getItem).not.toHaveBeenCalled();
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(storage.getItem(legacyKey)).toBe("seen");
});

it("directly opening creation consumes only the current runtime visit", async () => {
  const { useWorkflowCreateGuide } = await import("./use-workflow-create-guide");
  const page = useWorkflowCreateGuide();
  page.dismiss();
  page.enter();
  expect(page.show.value).toBe(false);
});
