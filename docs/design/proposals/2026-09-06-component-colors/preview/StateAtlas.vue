<script setup lang="ts">
import { computed, h, ref } from 'vue'
import {
  NAlert, NButton, NCard, NCheckbox, NDataTable, NDropdown, NInput,
  NMenu, NModal, NPagination, NPopover, NRadio, NRadioGroup, NSelect,
  NSkeleton, NSpace, NSpin, NSwitch, NTag, type DataTableColumns,
} from 'naive-ui'
import YjIcon from '../../../../../src/components/yijie/YjIcon.vue'
import YjNavItem from '../../../../../src/components/yijie/YjNavItem.vue'
import YjTabs from '../../../../../src/components/yijie/YjTabs.vue'
import YjMetricCard from '../../../../../src/components/yijie/YjMetricCard.vue'
import YjEmpty from '../../../../../src/components/yijie/YjEmpty.vue'
import type { AppNavItem } from '../../../../../src/navigation/app-nav'
import './atlas.css'

const inputValue = ref('每周一汇总店铺经营表现')
const readValue = ref('店铺编号 YJ-DEMO-01')
const errorValue = ref('尚未选择店铺')
const selectedMenu = ref('store')
const selectedFilter = ref('all')
const checkboxValue = ref(true)
const radioValue = ref('weekly')
const switchValue = ref(true)
const selectedStore = ref('store-a')
const selectedStores = ref(['store-a'])
const page = ref(1)
const showModal = ref(false)
const showPopover = ref(false)
const loadingAction = ref(false)
const lastAction = ref('尚未触发操作')
const checkedRows = ref<Array<string | number>>(['YJ-DEMO-01'])
const liveState = ref('可用鼠标或 Tab 键检查真实状态')
const filters = [{ key: 'all', label: '全部' }, { key: 'listing', label: '商品优化' }, { key: 'ads', label: '广告分析' }]
const stores = [{ label: '演示店铺 A · 美国站', value: 'store-a' }, { label: '演示店铺 B · 英国站', value: 'store-b' }, { label: '演示店铺 C · 只读', value: 'store-c', disabled: true }]
const navItems: AppNavItem[] = [
  { kind: 'item', key: 'newTask', label: '新建任务', icon: 'newTask', placement: 'main', disabled: false, to: '/chat' },
  { kind: 'item', key: 'store', label: '我的店铺', icon: 'store', placement: 'main', disabled: false, to: '/store' },
  { kind: 'item', key: 'scheduledTask', label: '定时任务', icon: 'scheduledTask', placement: 'main', disabled: true },
]
const menuOptions = [
  { label: '新建任务', key: 'new', icon: () => h(YjIcon, { name: 'newTask' }) },
  { label: '我的店铺', key: 'store', icon: () => h(YjIcon, { name: 'store' }) },
  { label: '工作流', key: 'workflow', icon: () => h(YjIcon, { name: 'workflow' }) },
  { label: '即将开放', key: 'later', disabled: true, icon: () => h(YjIcon, { name: 'scheduledTask' }) },
]
const dropdownOptions = [{ label: '复制结果', key: 'copy' }, { label: '导出报告', key: 'export' }, { label: '归档（无权限）', key: 'archive', disabled: true }]
const rows = [
  { id: 'YJ-DEMO-01', name: '夏季运动水壶', status: '已完成', tone: 'success' as const, amount: '¥12,840' },
  { id: 'YJ-DEMO-02', name: '轻便旅行收纳袋', status: '等待审批', tone: 'warning' as const, amount: '¥8,260' },
  { id: 'YJ-DEMO-03', name: '桌面整理套装', status: '同步失败', tone: 'error' as const, amount: '—' },
]
const columns: DataTableColumns<(typeof rows)[number]> = [
  {
    key: 'selection',
    width: 54,
    title: () => h(NCheckbox, {
      checked: checkedRows.value.length === rows.length,
      indeterminate: checkedRows.value.length > 0 && checkedRows.value.length < rows.length,
      'onUpdate:checked': (checked: boolean) => { checkedRows.value = checked ? rows.map(row => row.id) : [] },
    }, { default: () => h('span', { class: 'atlas-sr-only' }, '选择全部演示商品') }),
    render: row => h(NCheckbox, {
      checked: checkedRows.value.includes(row.id),
      'onUpdate:checked': (checked: boolean) => {
        checkedRows.value = checked
          ? [...new Set([...checkedRows.value, row.id])]
          : checkedRows.value.filter(key => key !== row.id)
      },
    }, { default: () => h('span', { class: 'atlas-sr-only' }, `选择商品：${row.name}`) }),
  },
  { title: '商品', key: 'name', minWidth: 180 },
  { title: '编号', key: 'id', minWidth: 135 },
  { title: '任务状态', key: 'status', minWidth: 120, render: row => h(NTag, { type: row.tone, size: 'small' }, { default: () => row.status }) },
  { title: '销售额', key: 'amount', align: 'right', minWidth: 95 },
]
const miniColumns = computed(() => columns.filter(column => !('key' in column) || column.key !== 'selection'))
function runAction() {
  if (loadingAction.value) return
  loadingAction.value = true
  lastAction.value = '本地演示分析中，可点击“结束演示加载”恢复。'
}
function observeState(event: Event, state: string) {
  const target = event.target as HTMLElement
  const control = target.closest('button,input,[role="checkbox"],[role="switch"]')
  if (control) liveState.value = `${state} · ${control.getAttribute('aria-label') || control.id || control.textContent?.trim() || '当前控件'}`
}
</script>

<template>
  <main class="atlas-root" @pointerover="observeState($event, 'Hover')" @pointerdown="observeState($event, 'Pressed')" @focusin="observeState($event, 'Focus')">
    <header class="atlas-header">
      <p class="atlas-kicker">YIJIE / COMPONENT COLOR REVIEW</p>
      <h1>真实组件状态图谱</h1>
      <p class="atlas-intro">在同一组件结构中比较正式用色与候选用色。所有控件来自当前 Naive UI 或 Yj 共享组件；填写、选择、切换与键盘操作均可用。</p>
      <div class="atlas-legend"><span>固定样本：选中 / 只读 / 禁用 / 加载 / 错误</span><span>真实交互：Hover / Pressed / 键盘 Focus</span></div>
      <p class="atlas-live" aria-live="polite">{{ liveState }}</p>
    </header>

    <section class="atlas-section" data-atlas-section="text">
      <div class="atlas-section-title"><span>01</span><h2>文字与图标</h2></div>
      <div class="atlas-grid atlas-grid--three">
        <article class="atlas-sample"><h3>正文层级</h3><p class="atlas-primary">标题与关键数值 · 128,640 元</p><p class="atlas-body">完整说明应像正文一样清楚。请检查商品、店铺与时间范围，再开始任务。</p><p class="atlas-secondary">次要说明：结果保存在当前工作区。</p><p class="atlas-metadata">元信息：更新于今天 14:30</p><p class="atlas-disabled">禁用文字：仅用于不可用控件</p></article>
        <article class="atlas-sample"><h3>普通图标承载区</h3><div class="atlas-icon-row"><span class="atlas-icon-plate"><YjIcon name="workflow" size="xl" /></span><span class="atlas-icon-plate"><YjIcon name="store" size="xl" /></span><span class="atlas-icon-plate"><YjIcon name="shield" size="xl" /></span></div><p class="atlas-body">图标用于识别操作。候选使用中性图标与白色承载区。</p><p class="atlas-metadata">不把每个普通图标套进绿色小卡片。</p></article>
        <article class="atlas-sample"><h3>保留独立语义</h3><div class="atlas-icon-row"><YjIcon name="check" tone="success" label="成功" /><YjIcon name="warning" tone="warning" label="警告" /><YjIcon name="warning" tone="error" label="错误" /></div><p class="atlas-body">成功、警告、错误保持各自颜色，并同时提供图标与文字。</p><div class="atlas-series" aria-label="图表八个系列色保留"><span v-for="index in 8" :key="index" :style="{ backgroundColor: `var(--yj-color-chart-series-${index})` }">{{ index }}</span></div><p class="atlas-metadata">图表首色独立保留，不跟随中性图标变成石墨。</p></article>
      </div>
    </section>

    <section class="atlas-section" data-atlas-section="buttons">
      <div class="atlas-section-title"><span>02</span><h2>按钮与真实指针状态</h2></div>
      <div class="atlas-sample">
        <div class="atlas-control-row">
          <div class="atlas-control"><NButton id="atlas-primary" type="primary" @click="lastAction = '已触发主操作（仅本地演示）'">开始分析</NButton><small>Default · 主操作</small></div>
          <div class="atlas-control"><NButton id="atlas-primary-hover" type="primary" data-force-state="hover">开始分析</NButton><small>真实 Hover 捕获目标</small></div>
          <div class="atlas-control"><NButton id="atlas-primary-pressed" type="primary" data-force-state="active">开始分析</NButton><small>真实 Pressed 捕获目标</small></div>
          <div class="atlas-control"><NButton id="atlas-primary-focus" type="primary" data-force-state="focus">开始分析</NButton><small>键盘 Focus 捕获目标</small></div>
          <div class="atlas-control"><NButton disabled type="primary">开始分析</NButton><small>Disabled</small></div>
          <div class="atlas-control"><NButton loading type="primary">分析中</NButton><small>Loading · 保持操作身份</small></div>
        </div>
        <div class="atlas-control-row">
          <div class="atlas-control"><NButton id="atlas-secondary">查看详情</NButton><small>普通次操作</small></div>
          <div class="atlas-control"><NButton secondary>查看示例</NButton><small>中性弱按钮</small></div>
          <div class="atlas-control"><NButton text type="primary">了解分析范围</NButton><small>文本操作</small></div>
          <div class="atlas-control"><NButton ghost type="primary">复制链接</NButton><small>Ghost</small></div>
          <div class="atlas-control"><NButton id="atlas-icon-button" quaternary circle aria-label="刷新列表"><template #icon><YjIcon name="refresh" /></template></NButton><small>仅图标 · 有名称</small></div>
          <div class="atlas-control"><NButton type="error">删除演示项</NButton><small>危险操作保留语义</small></div>
        </div>
      </div>
      <div class="atlas-grid atlas-grid--two atlas-followup">
        <article class="atlas-sample atlas-caveat"><h3>库继承问题的真实回显</h3><NButton id="atlas-raw-secondary-primary" type="primary" secondary>原生 primary + secondary</NButton><p class="atlas-body">该组合把填充色直接用作文字色。此处保留真实原生样本，便于确认问题；不作为候选推荐。</p></article>
        <article class="atlas-sample"><h3>推荐的实际映射</h3><NButton id="atlas-safe-secondary" secondary>中性次要操作</NButton><p class="atlas-body">弱操作映射为中性 secondary。主操作才使用实心 primary，避免通过同一填充色推导弱按钮文字。</p></article>
      </div>
    </section>

    <section class="atlas-section" data-atlas-section="inputs">
      <div class="atlas-section-title"><span>03</span><h2>输入框与状态组合</h2></div>
      <div class="atlas-grid atlas-grid--three">
        <label class="atlas-sample"><span class="atlas-field-label">Default / Hover / Focus</span><NInput id="atlas-input" v-model:value="inputValue" placeholder="描述你希望完成的任务" /><span class="atlas-help">可编辑；切换方案或主题后内容保留。</span></label>
        <label class="atlas-sample"><span class="atlas-field-label">Readonly · 只读，可复制</span><NInput id="atlas-readonly-input" :value="readValue" readonly /><span class="atlas-help">保留输入结构与正常文字；可以选择文本。</span></label>
        <label class="atlas-sample"><span class="atlas-field-label">Disabled · 当前不可用</span><NInput value="尚未连接店铺" disabled /><span class="atlas-help">限制原因仍使用可读说明色。</span></label>
        <label class="atlas-sample"><span class="atlas-field-label">Error + 可聚焦</span><NInput id="atlas-error-input" v-model:value="errorValue" status="error" :input-props="{ 'aria-invalid': 'true', 'aria-describedby': 'atlas-field-error' }" /><span id="atlas-field-error" class="atlas-error-copy"><YjIcon name="warning" tone="error" size="sm" />请选择至少一个店铺。</span></label>
        <label class="atlas-sample"><span class="atlas-field-label">Loading · 正在读取</span><NInput value="正在读取店铺信息" loading readonly /><span class="atlas-help">显示加载图标，同时保留字段身份。</span></label>
        <label class="atlas-sample"><span class="atlas-field-label">Disabled + Error</span><NInput value="历史校验未通过" disabled status="error" /><span class="atlas-error-copy">历史错误保留为说明；禁用状态优先关闭操作。</span></label>
      </div>
    </section>

    <section class="atlas-section" data-atlas-section="navigation">
      <div class="atlas-section-title"><span>04</span><h2>导航与筛选</h2></div>
      <div class="atlas-grid atlas-grid--three">
        <article class="atlas-sample"><h3>真实 NMenu</h3><NMenu id="atlas-menu" v-model:value="selectedMenu" :options="menuOptions" /><p class="atlas-metadata">可点击更改选中项；用真实 hover 检查 selected + hover。</p></article>
        <article class="atlas-sample"><h3>真实 YjNavItem</h3><div class="atlas-yj-nav"><YjNavItem v-for="item in navItems" :key="item.key" :item="item" :collapsed="false" :selected="item.key === 'store'" /></div><p class="atlas-metadata">候选在原导航上增加局部青柠线。点击链接可查看对应页面。</p></article>
        <article class="atlas-sample"><h3>真实 YjTabs 筛选</h3><YjTabs v-model="selectedFilter" :items="filters" aria-label="场景分类" /><p class="atlas-body">当前筛选：{{ filters.find(item => item.key === selectedFilter)?.label }}</p><p class="atlas-metadata">方向键可切换。Selected + focus 保留青柠填充和独立中性焦点。</p></article>
      </div>
    </section>

    <section class="atlas-section" data-atlas-section="selection">
      <div class="atlas-section-title"><span>05</span><h2>选择控件</h2></div>
      <div class="atlas-grid atlas-grid--three">
        <article class="atlas-sample"><h3>Checkbox</h3><NSpace vertical><NCheckbox id="atlas-checkbox" v-model:checked="checkboxValue">包含广告数据</NCheckbox><NCheckbox :checked="false">未选中</NCheckbox><NCheckbox indeterminate>部分已选中</NCheckbox><NCheckbox :checked="true" disabled aria-disabled="true">Selected + disabled</NCheckbox><NCheckbox disabled aria-disabled="true">未选中 + disabled</NCheckbox></NSpace></article>
        <article class="atlas-sample"><h3>Radio</h3><NRadioGroup v-model:value="radioValue" name="atlas-period"><NSpace vertical><NRadio id="atlas-radio" value="weekly">每周汇总</NRadio><NRadio value="daily">每日汇总</NRadio><NRadio value="later" disabled aria-disabled="true">即将开放</NRadio></NSpace></NRadioGroup><div class="atlas-followup"><NRadio checked disabled aria-disabled="true">Selected + disabled</NRadio></div></article>
        <article class="atlas-sample"><h3>Switch</h3><div class="atlas-switch-row"><NSwitch id="atlas-switch" v-model:value="switchValue" aria-label="启用自动分析" /><span>自动分析</span></div><div class="atlas-switch-row"><NSwitch :value="false" aria-label="关闭状态" /><span>关闭</span></div><div class="atlas-switch-row"><NSwitch :value="true" disabled aria-label="已开启但不可编辑" /><span>Selected + disabled</span></div><div class="atlas-switch-row"><NSwitch :value="true" loading aria-label="正在保存" /><span>Loading</span></div></article>
        <article class="atlas-sample"><h3>Select · 单选</h3><NSelect id="atlas-select" v-model:value="selectedStore" :options="stores" /><p class="atlas-help">打开真实菜单查看 selected / hover / disabled 选项。</p></article>
        <article class="atlas-sample"><h3>Select · 多选</h3><NSelect id="atlas-multiselect" v-model:value="selectedStores" multiple :options="stores" /><p class="atlas-help">选中行保持中性底，保留可见勾选。</p></article>
        <article class="atlas-sample"><h3>Select · 组合状态</h3><NSpace vertical><NSelect value="store-a" disabled :options="stores" /><NSelect :options="[]" loading placeholder="正在读取店铺" /><NSelect :options="stores" status="error" placeholder="请至少选择一个店铺" /></NSpace></article>
      </div>
    </section>

    <section class="atlas-section" data-atlas-section="cards">
      <div class="atlas-section-title"><span>06</span><h2>卡片、空态与加载</h2></div>
      <div class="atlas-grid atlas-grid--three">
        <YjMetricCard label="销售额" value="128,640" unit="元" supporting-text="更新于今天 14:30" :trend="{ direction: 'up', value: '+12.8%', tone: 'success' }" />
        <NCard size="small"><h3 class="atlas-card-title">商品表现分析</h3><p class="atlas-body">整理商品表现、广告花费与库存信号，明确下一项值得处理的工作。</p><template #action><NButton type="primary" size="small">开始分析</NButton></template></NCard>
        <NCard size="small"><h3 class="atlas-card-title">读取报告中</h3><NSpin :show="true"><div class="atlas-loading-card"><NSkeleton text :repeat="3" /><NSkeleton text style="width: 70%" /></div></NSpin><p class="atlas-help">Loading · 骨架与转圈保留容器结构。</p></NCard>
      </div>
      <div class="atlas-grid atlas-grid--two atlas-followup"><YjEmpty title="还没有任务" description="新建一个任务，开始查看分析结果。" icon="taskHistory"><template #actions><NButton type="primary">新建任务</NButton></template></YjEmpty><NCard size="small"><h3 class="atlas-card-title">暂时无法读取报告</h3><NAlert type="error" :show-icon="true">同步失败，请稍后重试。错误语义不会被青柠替换。</NAlert><div class="atlas-followup"><NButton>重试读取</NButton></div></NCard></div>
    </section>

    <section class="atlas-section" data-atlas-section="tags">
      <div class="atlas-section-title"><span>07</span><h2>标签与状态</h2></div>
      <div class="atlas-sample"><div class="atlas-control-row"><NTag>普通分类</NTag><NTag type="primary">品牌标签</NTag><NTag checkable :checked="true">已选筛选</NTag><NTag checkable :checked="false">未选筛选</NTag><NTag type="success">成功</NTag><NTag type="warning">等待审批</NTag><NTag type="error">失败</NTag><NTag type="info">运行中</NTag><NTag checkable checked disabled aria-disabled="true">Selected + disabled</NTag></div><p class="atlas-help">分类标签保持中性，实心青柠用于可选标签的已选状态；状态文字与色彩同时保留。</p></div>
    </section>

    <section class="atlas-section" data-atlas-section="table">
      <div class="atlas-section-title"><span>08</span><h2>表格与分页</h2></div>
      <div class="atlas-sample atlas-table-sample"><NDataTable id="atlas-table" :columns="columns" :data="rows" :row-key="row => row.id" :bordered="true" /><div class="atlas-table-footer"><span class="atlas-metadata">只读数据 · 已选 {{ checkedRows.length }} 行 · 全部为演示数据</span><NPagination v-model:page="page" :page-count="5" /></div></div>
      <details class="atlas-details"><summary>展开 Loading 与 Empty 的真实表格样本</summary><div class="atlas-grid atlas-grid--two"><NDataTable :columns="miniColumns" :data="rows.slice(0, 1)" loading size="small" /><NDataTable :columns="miniColumns" :data="[]" size="small" /></div></details>
    </section>

    <section class="atlas-section" data-atlas-section="overlays">
      <div class="atlas-section-title"><span>09</span><h2>真实弹层与操作反馈</h2></div>
      <div class="atlas-grid atlas-grid--two">
        <article class="atlas-sample"><h3>Popover / Dropdown / Modal</h3><div class="atlas-control-row"><NPopover v-model:show="showPopover" trigger="click"><template #trigger><NButton id="atlas-popover-open">查看说明</NButton></template><div class="atlas-popover-copy"><strong>数据范围</strong><p>只读取已授权店铺的演示数据。</p><NButton text @click="showPopover = false">知道了</NButton></div></NPopover><NDropdown :options="dropdownOptions" trigger="click" @select="key => lastAction = `已选择：${key}（仅本地演示）`"><NButton id="atlas-dropdown-open">更多操作</NButton></NDropdown><NButton id="atlas-modal-open" @click="showModal = true">打开确认弹窗</NButton></div><p class="atlas-body">普通卡片不使用扩散阴影，只有真实弹层使用轻阴影表达上下关系。</p></article>
        <article class="atlas-sample"><h3>Loading → Ready</h3><div class="atlas-control-row"><NButton type="primary" :loading="loadingAction" @click="runAction">{{ loadingAction ? '分析中' : '运行本地演示' }}</NButton><NButton :disabled="!loadingAction" @click="loadingAction = false; lastAction = '本地演示加载已结束'">结束演示加载</NButton></div><p class="atlas-body" aria-live="polite">{{ lastAction }}</p><p class="atlas-metadata">不会访问店铺或执行实际业务操作。</p></article>
      </div>
      <NModal v-model:show="showModal"><NCard class="atlas-modal" role="dialog" aria-modal="true" aria-labelledby="atlas-modal-title" :bordered="true"><h2 id="atlas-modal-title" class="atlas-card-title">确认分析范围</h2><p class="atlas-body">本次仅查看演示数据。关闭后焦点返回触发按钮。</p><NInput value="演示店铺 A · 美国站" readonly aria-label="只读店铺范围" /><template #footer><NSpace justify="end"><NButton @click="showModal = false">取消</NButton><NButton type="primary" @click="showModal = false; lastAction = '已确认演示分析范围'">确认范围</NButton></NSpace></template></NCard></NModal>
    </section>

    <footer class="atlas-footnote"><strong>组合优先级</strong><p>Disabled 优先阻止交互；Loading 保留动作身份并抑制重复提交；Readonly 保留正常文字和字段结构；Error 保留红色边界与说明；Focus 在 Error / Selected 之上增加独立中性边界；Hover / Pressed 仅在仍可交互时生效。</p><p>Hover / Pressed / Focus 的静态捕获由浏览器真实伪类完成。图谱没有用替代色块伪装控件状态。</p></footer>
  </main>
</template>
