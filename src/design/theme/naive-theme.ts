import type { GlobalThemeOverrides } from 'naive-ui'

export type CssVariableReader = (variableName: string) => string

function readRequiredToken(readVariable: CssVariableReader, variableName: string): string {
  const value = readVariable(variableName).trim()

  if (!value) {
    throw new Error(`Missing design token: ${variableName}`)
  }

  return value
}

/** Resolves the approved component color roles into one shared Naive UI theme. */
export function createNaiveThemeOverrides(
  readVariable: CssVariableReader
): GlobalThemeOverrides {
  const token = (variableName: string) => readRequiredToken(readVariable, variableName)
  const fontFamily = token('--yj-font-family-sans')
  const onBrand = token('--yj-color-on-brand')
  const brandText = token('--yj-color-brand-text')
  const focusColor = token('--yj-color-focus-ring')
  const focusBorder = `1px solid ${focusColor}`
  const surface = token('--yj-color-bg-card')
  const brandFill = token('--yj-color-brand-primary')
  const ink = token('--yj-color-text-primary')
  const body = token('--yj-color-text-body')
  const secondary = token('--yj-color-text-secondary')
  const disabled = token('--yj-color-text-disabled')
  const nav = token('--yj-color-bg-nav')
  const elevated = token('--yj-color-bg-elevated')
  const hover = token('--yj-color-control-hover')
  const pressed = token('--yj-color-control-pressed')
  const disabledBg = token('--yj-color-control-disabled-bg')
  const border = `1px solid ${token('--yj-color-border-control')}`
  const hoverBorder = `1px solid ${token('--yj-color-border-control-hover')}`
  const focus = token('--yj-shadow-control-focus')
  const error = token('--yj-color-error')
  const overlayShadow = token('--yj-shadow-popover')
  const successInk = token('--yj-color-semantic-success-ink')
  const warningInk = token('--yj-color-semantic-warning-ink')
  const errorInk = token('--yj-color-semantic-error-ink')
  const infoInk = token('--yj-color-semantic-info-ink')

  return {
    common: {
      fontFamily,
      primaryColor: token('--yj-color-brand-primary'),
      primaryColorHover: token('--yj-color-brand-hover'),
      primaryColorPressed: token('--yj-color-brand-active'),
      primaryColorSuppl: token('--yj-color-brand-hover'),
      borderRadius: token('--yj-radius-md'),
      textColorBase: body,
      textColor1: token('--yj-color-text-primary'),
      textColor2: secondary,
      textColor3: token('--yj-color-text-tertiary'),
      textColorDisabled: token('--yj-color-text-disabled'),
      placeholderColor: token('--yj-color-text-tertiary'),
      placeholderColorDisabled: token('--yj-color-text-disabled'),
      iconColor: token('--yj-color-icon-default'),
      iconColorHover: token('--yj-color-text-primary'),
      iconColorPressed: token('--yj-color-text-primary'),
      iconColorDisabled: token('--yj-color-text-disabled'),
      bodyColor: token('--yj-color-bg-app'),
      cardColor: token('--yj-color-bg-card'),
      modalColor: token('--yj-color-bg-elevated'),
      popoverColor: token('--yj-color-bg-elevated'),
      tableColor: token('--yj-color-bg-card'),
      tableHeaderColor: token('--yj-color-bg-subtle'),
      inputColor: token('--yj-color-bg-card'),
      inputColorDisabled: disabledBg,
      actionColor: token('--yj-color-bg-subtle'),
      borderColor: token('--yj-color-border-default'),
      dividerColor: token('--yj-color-border-subtle'),
      buttonColor2: surface,
      buttonColor2Hover: hover,
      buttonColor2Pressed: pressed,
      hoverColor: hover,
      pressedColor: pressed,
      tableColorHover: hover,
      tableColorStriped: surface,
      boxShadow1: overlayShadow,
      boxShadow2: overlayShadow,
      boxShadow3: overlayShadow
    },
    Button: {
      borderRadiusMedium: token('--yj-radius-md'),
      heightMedium: '36px',
      fontWeight: '500',
      textColorPrimary: onBrand,
      textColorHoverPrimary: onBrand,
      textColorPressedPrimary: onBrand,
      textColorFocusPrimary: onBrand,
      textColorDisabledPrimary: disabled,
      textColorTextPrimary: brandText,
      textColorTextHoverPrimary: brandText,
      textColorTextPressedPrimary: brandText,
      textColorTextFocusPrimary: brandText,
      textColorGhostPrimary: brandText,
      textColorGhostHoverPrimary: brandText,
      textColorGhostPressedPrimary: brandText,
      textColorGhostFocusPrimary: brandText,
      textColorHover: brandText,
      textColorPressed: brandText,
      textColorFocus: brandText,
      textColorTextHover: brandText,
      textColorTextPressed: brandText,
      textColorTextFocus: brandText,
      textColorGhostHover: brandText,
      textColorGhostPressed: brandText,
      textColorGhostFocus: brandText,
      borderHover: hoverBorder,
      borderPressed: hoverBorder,
      borderFocus: focusBorder,
      borderFocusPrimary: focusBorder,
      color: surface,
      colorHover: hover,
      colorPressed: pressed,
      colorFocus: surface,
      colorDisabled: disabledBg,
      textColor: ink,
      textColorDisabled: disabled,
      colorDisabledPrimary: disabledBg,
      borderDisabledPrimary: `1px solid ${token('--yj-color-border-default')}`,
      textColorTextDisabled: disabled,
      textColorTextDisabledPrimary: disabled,
      textColorGhostDisabled: disabled,
      textColorGhostDisabledPrimary: disabled,
      opacityDisabled: '1',
      borderPrimary: border,
      borderHoverPrimary: hoverBorder,
      borderPressedPrimary: hoverBorder,
      colorSecondary: surface,
      colorSecondaryHover: hover,
      colorSecondaryPressed: pressed,
      colorTertiary: surface,
      colorTertiaryHover: hover,
      colorTertiaryPressed: pressed,
      colorQuaternaryHover: hover,
      colorQuaternaryPressed: pressed
    },
    Menu: {
      color: token('--yj-color-bg-nav'),
      itemColorHover: hover,
      itemColorActive: nav,
      itemColorActiveHover: hover,
      itemColorActiveCollapsed: nav,
      itemTextColorHover: ink,
      itemTextColorActive: ink,
      itemTextColorActiveHover: ink,
      itemTextColorChildActive: ink,
      itemTextColorChildActiveHover: ink,
      itemTextColorHoverHorizontal: ink,
      itemTextColorActiveHorizontal: ink,
      itemTextColorActiveHoverHorizontal: ink,
      itemTextColorChildActiveHorizontal: ink,
      itemTextColorChildActiveHoverHorizontal: ink,
      itemIconColorHover: ink,
      itemIconColorActive: ink,
      itemIconColorActiveHover: ink,
      itemIconColorChildActive: ink,
      itemIconColorChildActiveHover: ink,
      itemIconColorHoverHorizontal: ink,
      itemIconColorActiveHorizontal: ink,
      itemIconColorActiveHoverHorizontal: ink,
      itemIconColorChildActiveHorizontal: ink,
      itemIconColorChildActiveHoverHorizontal: ink,
      arrowColorHover: ink,
      arrowColorActive: ink,
      arrowColorActiveHover: ink,
      arrowColorChildActive: ink,
      arrowColorChildActiveHover: ink,
      borderColorHorizontal: brandText
    },
    Checkbox: {
      color: surface,
      colorChecked: brandFill,
      checkMarkColor: onBrand,
      border,
      borderChecked: `1px solid ${onBrand}`,
      borderFocus: focusBorder,
      boxShadowFocus: focus,
      textColor: body,
      textColorDisabled: disabled,
      colorDisabled: disabledBg,
      colorDisabledChecked: disabledBg,
      checkMarkColorDisabledChecked: disabled
    },
    Radio: {
      color: surface,
      colorActive: brandFill,
      dotColorActive: onBrand,
      boxShadow: `inset 0 0 0 1px ${token('--yj-color-border-control')}`,
      boxShadowActive: `inset 0 0 0 1px ${onBrand}`,
      boxShadowHover: `inset 0 0 0 1px ${token('--yj-color-border-control-hover')}`,
      boxShadowFocus: `inset 0 0 0 1px ${focusColor}, ${focus}`,
      buttonColor: surface,
      buttonColorActive: token('--yj-color-brand-primary'),
      buttonTextColorActive: onBrand,
      buttonTextColorHover: brandText,
      buttonBorderColorActive: onBrand,
      buttonBorderColorHover: focusColor,
      buttonBoxShadowFocus: focus,
      textColor: body,
      textColorDisabled: disabled,
      colorDisabled: disabledBg
    },
    Switch: {
      railColor: token('--yj-color-control-track'),
      railColorActive: brandFill,
      buttonColor: onBrand,
      textColor: onBrand,
      iconColor: brandFill,
      loadingColor: brandFill,
      boxShadowFocus: focus
    },
    Tabs: {
      colorSegment: surface,
      tabColor: surface,
      tabColorSegment: hover,
      tabTextColorActiveLine: ink,
      tabTextColorHoverLine: brandText,
      tabTextColorActiveBar: ink,
      tabTextColorHoverBar: brandText,
      tabTextColorActiveCard: ink,
      tabTextColorHoverCard: brandText,
      tabTextColorActiveSegment: ink,
      tabTextColorHoverSegment: brandText,
      barColor: brandText
    },
    InternalSelection: {
      border,
      color: surface,
      colorActive: surface,
      textColor: body,
      caretColor: ink,
      borderHover: hoverBorder,
      borderActive: focusBorder,
      borderFocus: focusBorder,
      boxShadowActive: focus,
      boxShadowFocus: focus,
      loadingColor: brandText,
      colorDisabled: disabledBg,
      textColorDisabled: disabled,
      boxShadowHover: 'none',
      boxShadowFocusError: focus,
      boxShadowActiveError: focus,
      boxShadowFocusWarning: focus,
      boxShadowActiveWarning: focus
    },
    InternalSelectMenu: {
      color: token('--yj-color-bg-elevated'),
      optionTextColorActive: ink,
      optionTextColorPressed: ink,
      optionCheckColor: ink,
      optionColorPending: hover,
      optionColorActive: elevated,
      optionColorActivePending: hover,
      loadingColor: brandText,
      optionTextColor: body
    },
    Pagination: {
      itemTextColorHover: brandText,
      itemTextColorPressed: brandText,
      itemTextColorActive: onBrand,
      itemColorActive: brandFill,
      itemColorActiveHover: token('--yj-color-brand-hover'),
      itemBorderActive: `1px solid ${onBrand}`,
      itemBorderHover: focusBorder,
      itemBorderPressed: focusBorder,
      buttonIconColorHover: brandText,
      buttonIconColorPressed: brandText,
      buttonBorderHover: focusBorder,
      buttonBorderPressed: focusBorder
    },
    Card: {
      borderRadius: token('--yj-radius-lg'),
      paddingMedium: token('--yj-space-5'),
      color: surface,
      textColor: body,
      boxShadow: 'none',
      actionColor: surface
    },
    Input: {
      border,
      borderRadius: token('--yj-radius-md'),
      heightMedium: '36px',
      colorFocus: token('--yj-color-bg-card'),
      caretColor: token('--yj-color-text-primary'),
      boxShadowFocus: focus,
      borderHover: hoverBorder,
      borderFocus: focusBorder,
      textColor: body,
      textColorDisabled: disabled,
      loadingColor: ink,
      loadingColorError: errorInk,
      loadingColorWarning: warningInk,
      color: surface,
      colorDisabled: disabledBg,
      borderError: `1px solid ${error}`,
      borderHoverError: `1px solid ${error}`,
      borderFocusError: `1px solid ${error}`,
      boxShadowFocusError: focus,
      boxShadowFocusWarning: focus
    },
    DataTable: {
      borderRadius: token('--yj-radius-lg'),
      thColor: surface,
      borderColor: token('--yj-color-border-subtle'),
      tdTextColor: body,
      thTextColor: secondary,
      tdColor: surface,
      tdColorHover: hover,
      tdColorStriped: surface,
      tdColorSorting: surface,
      thColorHover: hover,
      thColorSorting: surface,
      loadingColor: ink
    },
    Tag: {
      borderRadius: token('--yj-radius-sm'),
      color: surface,
      colorBordered: surface,
      textColorChecked: onBrand,
      colorChecked: brandFill,
      colorCheckedHover: token('--yj-color-brand-hover'),
      colorCheckedPressed: token('--yj-color-brand-active'),
      textColorPrimary: ink,
      colorPrimary: surface,
      colorBorderedPrimary: surface,
      borderPrimary: `1px solid ${token('--yj-color-brand-border')}`,
      closeIconColorPrimary: brandText,
      closeIconColorHoverPrimary: brandText,
      closeIconColorPressedPrimary: brandText,
      textColor: secondary,
      textColorSuccess: successInk,
      closeIconColorSuccess: successInk,
      textColorWarning: warningInk,
      closeIconColorWarning: warningInk,
      textColorError: errorInk,
      closeIconColorError: errorInk,
      textColorInfo: infoInk,
      closeIconColorInfo: infoInk,
      textColorCheckable: ink,
      colorHoverCheckable: hover,
      colorPressedCheckable: pressed
    },
    Alert: {
      contentTextColorSuccess: body,
      contentTextColorWarning: body,
      contentTextColorError: body,
      contentTextColorInfo: body,
      titleTextColorSuccess: successInk,
      iconColorSuccess: successInk,
      titleTextColorWarning: warningInk,
      iconColorWarning: warningInk,
      titleTextColorError: errorInk,
      iconColorError: errorInk,
      titleTextColorInfo: infoInk,
      iconColorInfo: infoInk
    },
    Popover: {
      color: elevated,
      textColor: body,
      boxShadow: overlayShadow
    },
    Dropdown: {
      color: elevated,
      optionTextColor: body,
      optionTextColorActive: ink,
      optionTextColorChildActive: ink,
      optionColorHover: hover,
      optionColorActive: elevated
    },
    Select: {
      menuBoxShadow: overlayShadow
    },
    Spin: {
      color: ink,
      textColor: body
    }
  }
}
