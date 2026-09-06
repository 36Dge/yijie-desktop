import type { ButtonProps } from "naive-ui";

/** Local to Skill installation: parent hover/focus may emphasize the actual
 * action without turning the surrounding content card into a click target. */
export const skillInstallButtonTheme: NonNullable<ButtonProps["themeOverrides"]> = {
  color: "var(--yj-skill-install-bg, transparent)",
  colorHover: "var(--yj-color-brand-primary)",
  colorFocus: "var(--yj-color-brand-primary)",
  colorPressed: "var(--yj-color-brand-active)",
  colorDisabled: "transparent",
  textColor: "var(--yj-skill-install-ink, var(--yj-color-text-primary))",
  textColorHover: "var(--yj-color-on-brand)",
  textColorFocus: "var(--yj-color-on-brand)",
  textColorPressed: "var(--yj-color-on-brand)",
  textColorDisabled: "var(--yj-color-text-disabled)",
};
