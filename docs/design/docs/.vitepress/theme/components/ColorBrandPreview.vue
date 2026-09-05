<script setup lang="ts">
import { onMounted, ref, shallowRef, type ComponentPublicInstance } from 'vue'
import { withBase } from 'vitepress'
import { NButton, NCheckbox, NConfigProvider, NMenu, darkTheme, type GlobalThemeOverrides, type MenuOption } from 'naive-ui'
import YjLogo from '../../../../exports/src/components/yijie/YjLogo.vue'
import { createNaiveThemeOverrides } from '../../../../exports/src/design/theme/naive-theme'

type Mode = 'light' | 'dark'
const modes: Mode[] = ['light', 'dark']
const panels: Partial<Record<Mode, HTMLElement>> = {}
const overrides = shallowRef<Partial<Record<Mode, GlobalThemeOverrides>>>({})
const colors = ref<Record<Mode, Record<string, string>>>({ light: {}, dark: {} })
const details = ref<Record<Mode, boolean>>({ light: false, dark: false })
const analyzed = ref<Record<Mode, boolean>>({ light: false, dark: false })
const showUnits = ref<Record<Mode, boolean>>({ light: true, dark: true })
const selectedMenu = ref<Record<Mode, string | number>>({ light: 'store', dark: 'store' })
const navigation: MenuOption[] = [
  { key: 'store', label: '我的店铺' },
  { key: 'workflow', label: '工作流' }
]
const swatches = [
  { name: '页面底色', token: '--yj-color-bg-page' },
  { name: '卡片底色', token: '--yj-color-bg-card' },
  { name: '主要文字', token: '--yj-color-text-primary' },
  { name: '主操作', token: '--yj-color-brand-primary' }
]
const sizes = [24, 32, 128]
const assets: { file: string; label: string; surface: Mode; wide?: boolean }[] = [
  { file: 'yijie-mark.svg', label: '主标志 · 亮色', surface: 'light' },
  { file: 'yijie-mark-dark.svg', label: '主标志 · 暗色', surface: 'dark' },
  { file: 'yijie-mark-mono.svg', label: '石墨单色', surface: 'light' },
  { file: 'yijie-mark-mono-inverse.svg', label: '白色反白', surface: 'dark' },
  { file: 'yijie-horizontal.svg', label: '完整组合 · 亮色', surface: 'light', wide: true },
  { file: 'yijie-horizontal-dark.svg', label: '完整组合 · 暗色', surface: 'dark', wide: true },
  { file: 'yijie-app-icon.svg', label: 'App Icon', surface: 'light' },
  { file: 'yijie-bag-logo.svg', label: '兼容路径 · 新标志', surface: 'light' }
]

function setPanel(mode: Mode, element: Element | ComponentPublicInstance | null) {
  if (element instanceof HTMLElement) panels[mode] = element
}

onMounted(() => {
  const resolved: Partial<Record<Mode, GlobalThemeOverrides>> = {}
  for (const mode of modes) {
    const element = panels[mode]
    if (!element) continue
    const styles = getComputedStyle(element)
    const readToken = (name: string) => styles.getPropertyValue(name).trim()
    resolved[mode] = createNaiveThemeOverrides(readToken)
    colors.value[mode] = Object.fromEntries(swatches.map(({ token }) => [token, readToken(token)]))
  }
  overrides.value = resolved
})
</script>

<template>
  <div class="color-brand-preview">
    <div class="preview-spaces">
      <section
        v-for="mode in modes"
        :key="mode"
        :ref="(element) => setPanel(mode, element)"
        :data-theme="mode"
        class="preview-space"
        :aria-labelledby="`preview-title-${mode}`"
      >
        <div class="preview-heading">
          <h3 :id="`preview-title-${mode}`" class="preview-title">
            {{ mode === 'light' ? '亮色 · 纯白通透' : '暗色 · 石墨空间' }}
          </h3>
          <span class="preview-caption">同一套青柠主操作</span>
        </div>

        <div class="preview-swatches" aria-label="当前主题色值">
          <div v-for="swatch in swatches" :key="swatch.token" class="preview-swatch">
            <span class="preview-swatch-color" :style="{ backgroundColor: `var(${swatch.token})` }" />
            <span class="preview-swatch-name">{{ swatch.name }}</span>
            <code>{{ colors[mode][swatch.token] || '—' }}</code>
          </div>
        </div>

        <div class="sample-window">
          <header class="sample-navigation">
            <YjLogo variant="horizontal" size="md" :theme="mode" />
            <NConfigProvider v-if="overrides[mode]" :theme="mode === 'dark' ? darkTheme : null" :theme-overrides="overrides[mode]" abstract>
              <NMenu v-model:value="selectedMenu[mode]" class="sample-menu" mode="horizontal" :options="navigation" aria-label="导航配色样例" />
            </NConfigProvider>
            <span v-else class="preview-caption">正在准备导航示例…</span>
          </header>
          <div class="sample-content">
            <div class="sample-heading">
              <h4>近 7 天销售战报</h4>
              <span class="preview-caption">固定演示数据</span>
            </div>
            <div class="sample-metrics">
              <div class="sample-metric">
                <span>销售额</span>
                <div class="sample-number">128,640 <small v-if="showUnits[mode]">元</small></div>
              </div>
              <div class="sample-metric">
                <span>订单量</span>
                <div class="sample-number">1,286 <small v-if="showUnits[mode]">单</small></div>
              </div>
            </div>

            <NConfigProvider v-if="overrides[mode]" :theme="mode === 'dark' ? darkTheme : null" :theme-overrides="overrides[mode]" abstract>
              <div class="sample-control-row">
                <NCheckbox v-model:checked="showUnits[mode]">显示指标单位</NCheckbox>
                <div class="sample-actions">
                  <NButton :aria-expanded="details[mode]" :aria-controls="`sample-details-${mode}`" @click="details[mode] = !details[mode]">
                    {{ details[mode] ? '收起详情' : '查看详情' }}
                  </NButton>
                  <NButton type="primary" @click="analyzed[mode] = true">开始分析 ↗</NButton>
                </div>
              </div>
            </NConfigProvider>
            <div v-else class="sample-actions sample-loading" aria-label="正在准备控件示例">正在准备控件示例…</div>
            <div v-show="details[mode]" :id="`sample-details-${mode}`" class="sample-detail">
              最近 7 天 · 销售额 128,640 元 · 订单量 1,286 单。此处仅演示控件状态。
            </div>
            <p class="sample-status" role="status">{{ analyzed[mode] ? '示例分析已完成 · 不连接店铺数据' : '仅为配色样例 · 不连接店铺数据' }}</p>
          </div>
        </div>

        <div class="preview-icon-heading">App Icon · 实际显示尺寸</div>
        <div class="preview-icon-sizes">
          <figure v-for="size in sizes" :key="size" class="preview-icon-size">
            <div class="preview-icon-stage">
              <img :src="withBase('/brand/yijie-app-icon.svg')" :width="size" :height="size" :alt="`易界 App Icon ${size} 像素`" />
            </div>
            <figcaption>{{ size }} × {{ size }} px</figcaption>
          </figure>
        </div>
      </section>
    </div>

    <h3 class="preview-assets-title">统一 SVG 资产</h3>
    <div class="preview-assets">
      <figure v-for="asset in assets" :key="asset.file" class="preview-asset">
        <div class="preview-asset-stage" :data-theme="asset.surface">
          <img :src="withBase(`/brand/${asset.file}`)" :alt="asset.label" :class="{ 'preview-asset-wide': asset.wide }" />
        </div>
        <figcaption>
          <strong>{{ asset.label }}</strong>
          <a :href="withBase(`/brand/${asset.file}`)" download>{{ asset.file }}</a>
        </figcaption>
      </figure>
    </div>
  </div>
</template>

<style scoped>
.color-brand-preview {
  margin: var(--yj-space-6) 0;
  font-family: var(--yj-font-family-sans);
}

.preview-spaces {
  display: grid;
  gap: var(--yj-space-6);
}

.preview-space {
  min-width: 0;
  padding: var(--yj-space-6);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-page);
  border: 1px solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-lg);
}

.preview-heading,
.sample-heading,
.sample-navigation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--yj-space-3);
}

.color-brand-preview .preview-title {
  margin: 0;
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-section-title);
  line-height: var(--yj-line-height-section-title);
}

.preview-caption {
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
}

.preview-swatches {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--yj-space-3);
  margin: var(--yj-space-5) 0 var(--yj-space-6);
}

.preview-swatch {
  min-width: 0;
  display: grid;
  gap: var(--yj-space-1);
}

.preview-swatch-color {
  height: 36px;
  border: 1px solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-sm);
}

.preview-swatch-name,
.preview-swatch code {
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.color-brand-preview .preview-swatch code {
  padding: 0;
  color: var(--yj-color-text-secondary);
  background: transparent;
}

.sample-window {
  overflow: hidden;
  border: 1px solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-page);
}

.sample-navigation {
  padding: var(--yj-space-4);
  border-bottom: 1px solid var(--yj-color-border-default);
  background: var(--yj-color-bg-nav);
}

.sample-menu {
  width: auto;
  max-width: 100%;
}

.sample-content {
  padding: var(--yj-space-5);
}

.color-brand-preview .sample-heading h4 {
  margin: 0;
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-card-title);
}

.sample-metrics {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: var(--yj-space-3);
  margin: var(--yj-space-5) 0;
}

.sample-metric {
  min-width: 0;
  padding: var(--yj-space-4);
  border: 1px solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-md);
  background: var(--yj-color-bg-card);
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-body);
}

.sample-number {
  margin-top: var(--yj-space-3);
  color: var(--yj-color-text-primary);
  font-size: clamp(22px, 2.6vw, 32px);
  line-height: var(--yj-line-height-display);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.sample-number small {
  font-size: var(--yj-font-size-caption);
  font-weight: 400;
  color: var(--yj-color-text-secondary);
}

.sample-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--yj-space-3);
}

.sample-control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--yj-space-4);
}

.sample-loading {
  min-height: 36px;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
}

.sample-detail {
  margin-top: var(--yj-space-4);
  padding-top: var(--yj-space-4);
  border-top: 1px solid var(--yj-color-border-default);
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
}

.color-brand-preview .sample-status {
  margin: var(--yj-space-4) 0 0;
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.preview-icon-heading {
  margin-top: var(--yj-space-6);
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
}

.preview-icon-sizes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--yj-space-2);
  margin-top: var(--yj-space-3);
}

.preview-icon-size,
.preview-asset {
  margin: 0;
  min-width: 0;
}

.preview-icon-stage {
  min-height: 144px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.preview-icon-stage img {
  display: block;
  max-width: none;
}

.preview-icon-size figcaption {
  text-align: center;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
}

.color-brand-preview .preview-assets-title {
  margin-top: var(--yj-space-8);
  margin-bottom: var(--yj-space-4);
}

.preview-assets {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--yj-space-5) var(--yj-space-4);
}

.preview-asset-stage {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 160px;
  padding: var(--yj-space-5);
  border: 1px solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-md);
  background: var(--yj-color-bg-page);
}

.preview-asset-stage img {
  display: block;
  width: 96px;
  height: 96px;
  object-fit: contain;
}

.preview-asset-stage img.preview-asset-wide {
  width: 100%;
  max-width: 280px;
  height: auto;
  max-height: 96px;
}

.preview-asset figcaption {
  display: grid;
  gap: var(--yj-space-1);
  margin-top: var(--yj-space-2);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.preview-asset figcaption a {
  color: var(--yj-color-brand-text);
  overflow-wrap: anywhere;
}

@media (max-width: 639px) {
  .preview-space {
    padding: var(--yj-space-4);
  }

  .preview-swatches {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sample-content {
    padding: var(--yj-space-4);
  }

  .sample-metrics,
  .preview-assets {
    grid-template-columns: 1fr;
  }

  .preview-icon-sizes {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 128px;
    gap: 0;
  }
}
</style>
