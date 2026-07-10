import type { GlobalThemeOverrides } from 'naive-ui'

export const naiveThemeOverrides: GlobalThemeOverrides = {
  common: {
    fontFamily: 'var(--yj-font-family-sans)',
    primaryColor: 'var(--yj-color-brand-primary)',
    primaryColorHover: 'var(--yj-color-brand-hover)',
    primaryColorPressed: 'var(--yj-color-brand-active)',
    primaryColorSuppl: 'var(--yj-color-brand-hover)',
    borderRadius: '8px',
    textColorBase: 'var(--yj-color-text-primary)',
    textColor1: 'var(--yj-color-text-primary)',
    textColor2: 'var(--yj-color-text-secondary)',
    textColor3: 'var(--yj-color-text-tertiary)',
    bodyColor: 'var(--yj-color-bg-app)',
    cardColor: 'var(--yj-color-bg-card)',
    modalColor: 'var(--yj-color-bg-elevated)',
    borderColor: 'var(--yj-color-border-default)',
    dividerColor: 'var(--yj-color-border-subtle)'
  },
  Button: {
    borderRadiusMedium: '8px',
    heightMedium: '36px',
    fontWeight: '500'
  },
  Card: {
    borderRadius: '12px',
    paddingMedium: '20px'
  },
  Input: {
    borderRadius: '8px',
    heightMedium: '36px'
  },
  DataTable: {
    borderRadius: '12px',
    thColor: 'var(--yj-color-bg-subtle)',
    borderColor: 'var(--yj-color-border-subtle)'
  },
  Tag: {
    borderRadius: '6px'
  }
}
