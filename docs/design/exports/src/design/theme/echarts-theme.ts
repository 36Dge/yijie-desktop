export const yijieChartPalette = [
  '#95BF47', '#4C84FF', '#22B8CF', '#8B5CF6',
  '#F59E0B', '#F97316', '#EF4444', '#64748B'
]

export function createYijieEChartsTheme(isDark: boolean) {
  return {
    color: yijieChartPalette,
    backgroundColor: 'transparent',
    textStyle: {
      fontFamily: 'var(--yj-font-family-sans)',
      color: isDark ? '#C6D0BC' : '#526046'
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
      backgroundColor: isDark ? '#222B1C' : '#FFFFFF',
      borderColor: isDark ? 'rgba(221, 241, 183, 0.14)' : '#D6DEC8',
      textStyle: {
        color: isDark ? '#F4F7EF' : '#18230F'
      }
    },
    legend: {
      textStyle: {
        color: isDark ? '#C6D0BC' : '#526046'
      }
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: isDark ? 'rgba(221, 241, 183, 0.14)' : '#D6DEC8' } },
      axisTick: { show: false },
      axisLabel: { color: isDark ? '#98A58E' : '#7A8670' }
    },
    valueAxis: {
      splitLine: { lineStyle: { color: isDark ? 'rgba(221, 241, 183, 0.08)' : '#E6ECDD' } },
      axisLabel: { color: isDark ? '#98A58E' : '#7A8670' }
    }
  }
}
