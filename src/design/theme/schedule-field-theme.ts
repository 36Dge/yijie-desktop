import type { GlobalThemeOverrides } from "naive-ui";

const border = "var(--yj-border-width) solid var(--yj-color-border-subtle)";
const borderHover = "var(--yj-border-width) solid var(--yj-color-border-default)";
const borderFocus = "var(--yj-border-width) solid var(--yj-color-border-strong)";

export const scheduleFieldTheme: GlobalThemeOverrides = {
  Input: { border, borderDisabled: border, borderHover, borderFocus },
  InternalSelection: { border, borderHover, borderFocus, borderActive: borderFocus },
  Checkbox: { border, borderDisabled: border, borderFocus },
};
