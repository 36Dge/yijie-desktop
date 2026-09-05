export const yijieChartPalette = [
  '#C3F35B', '#4C84FF', '#22B8CF', '#8B5CF6',
  '#F59E0B', '#F97316', '#EF4444', '#64748B'
]

// Thin lines and points need a readable brand ink on a white chart surface.
// The remaining series retain their established semantic palette.
export const yijieChartPaletteLight = ['#4B651D', ...yijieChartPalette.slice(1)]

export function createYijieEChartsTheme(isDark: boolean) {
  return {
    color: isDark ? yijieChartPalette : yijieChartPaletteLight,
    backgroundColor: 'transparent',
    textStyle: {
      fontFamily: 'var(--yj-font-family-sans)',
      color: isDark ? '#C2C7CE' : '#60666E'
    },
    grid: {
      left: 32,
      right: 24,
      top: 32,
      bottom: 32,
      containLabel: true
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? '#2E3237' : '#FFFFFF',
      borderColor: isDark ? '#414850' : '#E2E5E8',
      textStyle: {
        color: isDark ? '#F5F7FA' : '#25282B'
      }
    },
    legend: {
      textStyle: {
        color: isDark ? '#C2C7CE' : '#60666E'
      }
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: isDark ? '#414850' : '#E2E5E8' } },
      axisTick: { show: false },
      axisLabel: { color: isDark ? '#969EA8' : '#6F757D' }
    },
    valueAxis: {
      splitLine: { lineStyle: { color: isDark ? '#30363D' : '#ECEEF0' } },
      axisLabel: { color: isDark ? '#969EA8' : '#6F757D' }
    }
  }
}
