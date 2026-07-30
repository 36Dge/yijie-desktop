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
      bodyColor: token('--yj-color-bg-app'),
      cardColor: token('--yj-color-bg-card'),
      modalColor: token('--yj-color-bg-elevated'),
      borderColor: token('--yj-color-border-default'),
      dividerColor: token('--yj-color-border-subtle')
    },
    Button: {
      borderRadiusMedium: token('--yj-radius-md'),
      heightMedium: '36px',
      fontWeight: '500'
    },
    Card: {
      borderRadius: token('--yj-radius-lg'),
      paddingMedium: token('--yj-space-5')
    },
    Input: {
      borderRadius: token('--yj-radius-md'),
      heightMedium: '36px'
    },
    DataTable: {
      borderRadius: token('--yj-radius-lg'),
      thColor: token('--yj-color-bg-subtle'),
      borderColor: token('--yj-color-border-subtle')
    },
    Tag: {
      borderRadius: token('--yj-radius-sm')
    }
  }
}
