export const UI_ZOOM_DEFAULT_PERCENT = 100;
export const UI_ZOOM_MIN_PERCENT = 80;
export const UI_ZOOM_MAX_PERCENT = 200;
export const UI_ZOOM_STEP_PERCENT = 20;
export const UI_ZOOM_BASE_WINDOW_MIN_WIDTH = 1180;
export const UI_ZOOM_BASE_WINDOW_MIN_HEIGHT = 760;

export type UiZoomShortcut = Readonly<{
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}>;

export function nextUiZoomPercent(
  currentPercent: number,
  shortcut: UiZoomShortcut,
): number | null {
  if ((!shortcut.metaKey && !shortcut.ctrlKey) || shortcut.altKey) return null;
  if (shortcut.key === "0") return UI_ZOOM_DEFAULT_PERCENT;
  if (shortcut.key === "+" || shortcut.key === "=") {
    return Math.min(UI_ZOOM_MAX_PERCENT, currentPercent + UI_ZOOM_STEP_PERCENT);
  }
  if (shortcut.key === "-") {
    return Math.max(UI_ZOOM_MIN_PERCENT, currentPercent - UI_ZOOM_STEP_PERCENT);
  }
  return null;
}

export function uiZoomCssValue(percent: number): string {
  return String(percent / 100);
}

export function uiZoomedWindowMinimumCss(percent: number): {
  width: string;
  height: string;
} {
  return {
    width: `${UI_ZOOM_BASE_WINDOW_MIN_WIDTH * 100 / percent}px`,
    height: `${UI_ZOOM_BASE_WINDOW_MIN_HEIGHT * 100 / percent}px`,
  };
}

export function uiZoomedViewportCss(percent: number): {
  width: string;
  height: string;
} {
  const percentage = 10_000 / percent;
  return {
    width: `${percentage}vw`,
    height: `${percentage}vh`,
  };
}
