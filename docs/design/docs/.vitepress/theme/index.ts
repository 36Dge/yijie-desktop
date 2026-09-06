import DefaultTheme from 'vitepress/theme'
import { useData, type Theme } from 'vitepress'
import { watch } from 'vue'
import '../../../exports/src/styles/variables.css'
import '../../../exports/src/styles/component-colors.css'
import './style.css'
import ColorBrandPreview from './components/ColorBrandPreview.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ColorBrandPreview', ColorBrandPreview)
  },
  setup() {
    const { isDark } = useData()

    // VitePress owns theme preference; reference tokens consume the same state.
    if (typeof document !== 'undefined') {
      watch(isDark, (dark) => {
        document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      }, { immediate: true })
    }
  }
} satisfies Theme
