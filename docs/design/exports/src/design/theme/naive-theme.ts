import type { GlobalThemeOverrides } from 'naive-ui'

export type CssVariableReader = (variableName: string) => string

function readRequiredToken(readVariable: CssVariableReader, variableName: string): string {
  const value = readVariable(variableName).trim()

  if (!value) {
    throw new Error(`Missing design token: ${variableName}`)
  }

  return value
}

export function createNaiveThemeOverrides(
  readVariable: CssVariableReader
): GlobalThemeOverrides {
  const token = (variableName: string) => readRequiredToken(readVariable, variableName)
  const onBrand = token('--yj-color-on-brand')
  const brandText = token('--yj-color-brand-text')
  const focusColor = token('--yj-color-focus-ring')
  const focusBorder = `1px solid ${focusColor}`
  const focusShadow = `0 0 0 2px ${focusColor}`
  const controlOutline = token('--yj-color-text-tertiary')
  const selectedInk = token('--yj-color-text-primary')
  const selectedSurface = token('--yj-color-brand-soft')
  const surface = token('--yj-color-bg-card')
  const brandFill = token('--yj-color-brand-primary')

  return {
    common: {
      fontFamily: token('--yj-font-family-sans'),
      primaryColor: token('--yj-color-brand-primary'),
      primaryColorHover: token('--yj-color-brand-hover'),
      primaryColorPressed: token('--yj-color-brand-active'),
      primaryColorSuppl: token('--yj-color-brand-hover'),
      borderRadius: token('--yj-radius-md'),
      textColorBase: token('--yj-color-text-primary'),
      textColor1: token('--yj-color-text-primary'),
      textColor2: token('--yj-color-text-secondary'),
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
      inputColorDisabled: token('--yj-color-bg-subtle'),
      actionColor: token('--yj-color-bg-subtle'),
      borderColor: token('--yj-color-border-default'),
      dividerColor: token('--yj-color-border-subtle')
    },
    Button: {
      borderRadiusMedium: token('--yj-radius-md'),
      heightMedium: '36px',
      fontWeight: '500',
      // Lime fills always carry graphite text, including dark mode.
      textColorPrimary: onBrand,
      textColorHoverPrimary: onBrand,
      textColorPressedPrimary: onBrand,
      textColorFocusPrimary: onBrand,
      textColorDisabledPrimary: onBrand,
      // Text and ghost controls need a readable ink color on a white surface.
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
      borderHover: focusBorder,
      borderPressed: focusBorder,
      borderFocus: focusBorder,
      borderFocusPrimary: focusBorder
    },
    // Menu ink must not inherit the lime fill color from common.primaryColor.
    Menu: {
      color: token('--yj-color-bg-nav'),
      itemColorHover: selectedSurface,
      itemColorActive: selectedSurface,
      itemColorActiveHover: selectedSurface,
      itemColorActiveCollapsed: selectedSurface,
      itemTextColorHover: selectedInk,
      itemTextColorActive: selectedInk,
      itemTextColorActiveHover: selectedInk,
      itemTextColorChildActive: selectedInk,
      itemTextColorChildActiveHover: selectedInk,
      itemTextColorHoverHorizontal: selectedInk,
      itemTextColorActiveHorizontal: selectedInk,
      itemTextColorActiveHoverHorizontal: selectedInk,
      itemTextColorChildActiveHorizontal: selectedInk,
      itemTextColorChildActiveHoverHorizontal: selectedInk,
      itemIconColorHover: selectedInk,
      itemIconColorActive: selectedInk,
      itemIconColorActiveHover: selectedInk,
      itemIconColorChildActive: selectedInk,
      itemIconColorChildActiveHover: selectedInk,
      itemIconColorHoverHorizontal: selectedInk,
      itemIconColorActiveHorizontal: selectedInk,
      itemIconColorActiveHoverHorizontal: selectedInk,
      itemIconColorChildActiveHorizontal: selectedInk,
      itemIconColorChildActiveHoverHorizontal: selectedInk,
      arrowColorHover: selectedInk,
      arrowColorActive: selectedInk,
      arrowColorActiveHover: selectedInk,
      arrowColorChildActive: selectedInk,
      arrowColorChildActiveHover: selectedInk,
      borderColorHorizontal: brandText
    },
    Checkbox: {
      color: surface,
      colorChecked: brandFill,
      checkMarkColor: onBrand,
      border: `1px solid ${controlOutline}`,
      borderChecked: `1px solid ${onBrand}`,
      borderFocus: focusBorder,
      boxShadowFocus: focusShadow
    },
    Radio: {
      color: surface,
      colorActive: brandFill,
      dotColorActive: onBrand,
      boxShadow: `inset 0 0 0 1px ${controlOutline}`,
      boxShadowActive: `inset 0 0 0 1px ${onBrand}`,
      boxShadowHover: `inset 0 0 0 1px ${focusColor}`,
      boxShadowFocus: `inset 0 0 0 1px ${focusColor}, ${focusShadow}`,
      buttonColor: surface,
      buttonColorActive: selectedSurface,
      buttonTextColorActive: selectedInk,
      buttonTextColorHover: brandText,
      buttonBorderColorActive: focusColor,
      buttonBorderColorHover: focusColor,
      buttonBoxShadowFocus: `inset 0 0 0 1px ${focusColor}, ${focusShadow}`
    },
    Switch: {
      railColor: token('--yj-color-control-track'),
      railColorActive: brandFill,
      buttonColor: onBrand,
      textColor: onBrand,
      iconColor: brandFill,
      loadingColor: brandFill,
      boxShadowFocus: focusShadow
    },
    Tabs: {
      colorSegment: token('--yj-color-bg-subtle'),
      tabColor: surface,
      tabColorSegment: selectedSurface,
      tabTextColorActiveLine: selectedInk,
      tabTextColorHoverLine: brandText,
      tabTextColorActiveBar: selectedInk,
      tabTextColorHoverBar: brandText,
      tabTextColorActiveCard: selectedInk,
      tabTextColorHoverCard: brandText,
      tabTextColorActiveSegment: selectedInk,
      tabTextColorHoverSegment: brandText,
      barColor: brandText
    },
    // These shared peers cover Select and other selectors that consume them.
    InternalSelection: {
      color: surface,
      colorActive: surface,
      textColor: selectedInk,
      caretColor: selectedInk,
      borderHover: focusBorder,
      borderActive: focusBorder,
      borderFocus: focusBorder,
      boxShadowActive: focusShadow,
      boxShadowFocus: focusShadow,
      loadingColor: brandText
    },
    InternalSelectMenu: {
      color: token('--yj-color-bg-elevated'),
      optionTextColorActive: selectedInk,
      optionTextColorPressed: selectedInk,
      optionCheckColor: brandText,
      optionColorPending: selectedSurface,
      optionColorActive: selectedSurface,
      optionColorActivePending: selectedSurface,
      loadingColor: brandText
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
      paddingMedium: token('--yj-space-5')
    },
    Input: {
      borderRadius: token('--yj-radius-md'),
      heightMedium: '36px',
      colorFocus: token('--yj-color-bg-card'),
      caretColor: token('--yj-color-text-primary'),
      borderHover: focusBorder,
      borderFocus: focusBorder
    },
    DataTable: {
      borderRadius: token('--yj-radius-lg'),
      thColor: token('--yj-color-bg-subtle'),
      borderColor: token('--yj-color-border-subtle')
    },
    Tag: {
      borderRadius: token('--yj-radius-sm'),
      color: token('--yj-color-bg-subtle'),
      colorBordered: token('--yj-color-bg-subtle'),
      textColorChecked: onBrand,
      colorChecked: brandFill,
      colorCheckedHover: token('--yj-color-brand-hover'),
      colorCheckedPressed: token('--yj-color-brand-active'),
      textColorPrimary: brandText,
      colorPrimary: selectedSurface,
      colorBorderedPrimary: selectedSurface,
      borderPrimary: `1px solid ${token('--yj-color-brand-border')}`,
      closeIconColorPrimary: brandText,
      closeIconColorHoverPrimary: brandText,
      closeIconColorPressedPrimary: brandText
    }
  }
}
