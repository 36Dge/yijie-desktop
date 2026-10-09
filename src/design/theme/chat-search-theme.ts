import type { InputProps } from "naive-ui";

/** Compact composer searches keep the same borderless surface in every state. */
export const chatSearchTheme: NonNullable<InputProps["themeOverrides"]> = {
  color: "var(--yj-color-control-hover)",
  colorFocus: "var(--yj-color-control-hover)",
  border: "none",
  borderHover: "none",
  borderFocus: "none",
  boxShadowFocus: "none",
};
