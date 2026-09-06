import type { GlobalThemeOverrides } from 'naive-ui'
import {
  createNaiveThemeOverrides,
  type CssVariableReader,
} from '../../../../../src/design/theme/naive-theme'

/** Adds only candidate color mappings to the actual shared Naive UI theme. */
export function createCandidateThemeOverrides(readVariable: CssVariableReader): GlobalThemeOverrides {
  const base = createNaiveThemeOverrides(readVariable)
  const token = (name: string) => {
    const value = readVariable(name).trim()
    if (!value) throw new Error(`Missing candidate color token: ${name}`)
    return value
  }
  const ink = token('--yj-color-text-primary')
  const body = token('--yj-color-text-body')
  const secondary = token('--yj-color-text-secondary')
  const disabled = token('--yj-color-text-disabled')
  const surface = token('--yj-color-bg-card')
  const nav = token('--yj-color-bg-nav')
  const elevated = token('--yj-color-bg-elevated')
  const hover = token('--yj-color-control-hover')
  const pressed = token('--yj-color-control-pressed')
  const disabledBg = token('--yj-color-control-disabled-bg')
  const border = `1px solid ${token('--yj-color-border-control')}`
  const hoverBorder = `1px solid ${token('--yj-color-border-control-hover')}`
  const focusColor = token('--yj-color-focus-ring')
  const focusBorder = `1px solid ${focusColor}`
  const focus = token('--yj-shadow-control-focus')
  const error = token('--yj-color-error')
  const onBrand = token('--yj-color-on-brand')
  const overlayShadow = token('--yj-shadow-popover')
  const successInk = token('--yj-color-semantic-success-ink')
  const warningInk = token('--yj-color-semantic-warning-ink')
  const errorInk = token('--yj-color-semantic-error-ink')
  const infoInk = token('--yj-color-semantic-info-ink')

  return {
    ...base,
    common: {
      ...base.common,
      textColorBase: body,
      textColor2: secondary,
      inputColorDisabled: disabledBg,
      buttonColor2: surface,
      buttonColor2Hover: hover,
      buttonColor2Pressed: pressed,
      hoverColor: hover,
      pressedColor: pressed,
      tableColorHover: hover,
      tableColorStriped: surface,
      boxShadow1: overlayShadow,
      boxShadow2: overlayShadow,
      boxShadow3: overlayShadow,
    },
    Button: {
      ...base.Button,
      color: surface,
      colorHover: hover,
      colorPressed: pressed,
      colorFocus: surface,
      colorDisabled: disabledBg,
      textColor: ink,
      textColorDisabled: disabled,
      textColorDisabledPrimary: disabled,
      colorDisabledPrimary: disabledBg,
      borderDisabledPrimary: `1px solid ${token('--yj-color-border-default')}`,
      textColorTextDisabled: disabled,
      textColorTextDisabledPrimary: disabled,
      textColorGhostDisabled: disabled,
      textColorGhostDisabledPrimary: disabled,
      opacityDisabled: '1',
      borderHover: hoverBorder,
      borderPressed: hoverBorder,
      borderFocus: focusBorder,
      borderPrimary: border,
      borderHoverPrimary: hoverBorder,
      borderPressedPrimary: hoverBorder,
      borderFocusPrimary: focusBorder,
      colorSecondary: surface,
      colorSecondaryHover: hover,
      colorSecondaryPressed: pressed,
      colorTertiary: surface,
      colorTertiaryHover: hover,
      colorTertiaryPressed: pressed,
      colorQuaternaryHover: hover,
      colorQuaternaryPressed: pressed,
    },
    Menu: {
      ...base.Menu,
      itemColorHover: hover,
      itemColorActive: nav,
      itemColorActiveHover: hover,
      itemColorActiveCollapsed: nav,
    },
    Input: {
      ...base.Input,
      textColor: body,
      textColorDisabled: disabled,
      loadingColor: ink,
      loadingColorError: errorInk,
      loadingColorWarning: warningInk,
      color: surface,
      colorDisabled: disabledBg,
      border,
      borderHover: hoverBorder,
      borderFocus: focusBorder,
      boxShadowFocus: focus,
      // Focus remains visible while the validation border retains error semantics.
      borderError: `1px solid ${error}`,
      borderHoverError: `1px solid ${error}`,
      borderFocusError: `1px solid ${error}`,
      boxShadowFocusError: focus,
      boxShadowFocusWarning: focus,
    },
    InternalSelection: {
      ...base.InternalSelection,
      textColor: body,
      colorDisabled: disabledBg,
      textColorDisabled: disabled,
      border,
      borderHover: hoverBorder,
      borderActive: focusBorder,
      borderFocus: focusBorder,
      boxShadowHover: 'none',
      boxShadowActive: focus,
      boxShadowFocus: focus,
      boxShadowFocusError: focus,
      boxShadowActiveError: focus,
      boxShadowFocusWarning: focus,
      boxShadowActiveWarning: focus,
    },
    InternalSelectMenu: {
      ...base.InternalSelectMenu,
      optionColorPending: hover,
      optionColorActive: elevated,
      optionColorActivePending: hover,
      optionCheckColor: ink,
      optionTextColor: body,
    },
    Checkbox: {
      ...base.Checkbox,
      textColor: body,
      textColorDisabled: disabled,
      border,
      borderFocus: focusBorder,
      boxShadowFocus: focus,
      colorDisabled: disabledBg,
      colorDisabledChecked: disabledBg,
      checkMarkColorDisabledChecked: disabled,
    },
    Radio: {
      ...base.Radio,
      textColor: body,
      textColorDisabled: disabled,
      boxShadow: `inset 0 0 0 1px ${token('--yj-color-border-control')}`,
      boxShadowHover: `inset 0 0 0 1px ${token('--yj-color-border-control-hover')}`,
      boxShadowFocus: `inset 0 0 0 1px ${focusColor}, ${focus}`,
      buttonColorActive: token('--yj-color-brand-primary'),
      buttonTextColorActive: onBrand,
      buttonBorderColorActive: onBrand,
      buttonBoxShadowFocus: focus,
      colorDisabled: disabledBg,
    },
    Switch: { ...base.Switch, boxShadowFocus: focus },
    Tabs: {
      ...base.Tabs,
      colorSegment: surface,
      tabColorSegment: hover,
    },
    Tag: {
      ...base.Tag,
      color: surface,
      colorBordered: surface,
      textColor: secondary,
      colorPrimary: surface,
      colorBorderedPrimary: surface,
      textColorPrimary: ink,
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
      colorPressedCheckable: pressed,
    },
    Card: {
      ...base.Card,
      color: surface,
      textColor: body,
      boxShadow: 'none',
      actionColor: surface,
    },
    DataTable: {
      ...base.DataTable,
      tdTextColor: body,
      thTextColor: secondary,
      tdColor: surface,
      tdColorHover: hover,
      tdColorStriped: surface,
      tdColorSorting: surface,
      thColor: surface,
      thColorHover: hover,
      thColorSorting: surface,
      loadingColor: ink,
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
      iconColorInfo: infoInk,
    },
    Popover: { color: elevated, textColor: body, boxShadow: overlayShadow },
    Dropdown: {
      color: elevated,
      optionTextColor: body,
      optionTextColorActive: ink,
      optionTextColorChildActive: ink,
      optionColorHover: hover,
      optionColorActive: elevated,
    },
    Select: { ...base.Select, menuBoxShadow: overlayShadow },
    Spin: { color: ink, textColor: body },
  }
}
