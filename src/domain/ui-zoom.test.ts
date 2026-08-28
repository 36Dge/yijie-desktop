import { describe, expect, it } from "vitest";
import {
  nextUiZoomPercent,
  UI_ZOOM_DEFAULT_PERCENT,
  UI_ZOOM_MAX_PERCENT,
  UI_ZOOM_MIN_PERCENT,
  uiZoomCssValue,
  uiZoomedViewportCss,
  uiZoomedWindowMinimumCss,
} from "./ui-zoom";

function shortcut(
  key: string,
  overrides: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {},
) {
  return {
    key,
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("UI zoom keyboard policy", () => {
  it("uses 20 percent steps, reaches exactly 200 percent, and resets", () => {
    let percent = UI_ZOOM_DEFAULT_PERCENT;
    for (let index = 0; index < 5; index += 1) {
      percent = nextUiZoomPercent(percent, shortcut("+"))!;
    }
    expect(percent).toBe(UI_ZOOM_MAX_PERCENT);
    expect(nextUiZoomPercent(percent, shortcut("+"))).toBe(UI_ZOOM_MAX_PERCENT);
    expect(nextUiZoomPercent(percent, shortcut("0"))).toBe(UI_ZOOM_DEFAULT_PERCENT);
    expect(uiZoomCssValue(percent)).toBe("2");
  });

  it("supports Command or Control, clamps zoom out, and ignores unrelated chords", () => {
    expect(nextUiZoomPercent(100, shortcut("=", { metaKey: false, ctrlKey: true }))).toBe(120);
    expect(nextUiZoomPercent(UI_ZOOM_MIN_PERCENT, shortcut("-"))).toBe(UI_ZOOM_MIN_PERCENT);
    expect(nextUiZoomPercent(100, shortcut("+", { metaKey: false }))).toBeNull();
    expect(nextUiZoomPercent(100, shortcut("+", { altKey: true }))).toBeNull();
    expect(nextUiZoomPercent(100, shortcut("k"))).toBeNull();
  });

  it("keeps the shell minimum inside the visible window after zoom", () => {
    expect(uiZoomedWindowMinimumCss(100)).toEqual({ width: "1180px", height: "760px" });
    expect(uiZoomedWindowMinimumCss(200)).toEqual({ width: "590px", height: "380px" });
    expect(uiZoomedViewportCss(100)).toEqual({ width: "100vw", height: "100vh" });
    expect(uiZoomedViewportCss(200)).toEqual({ width: "50vw", height: "50vh" });
  });
});
