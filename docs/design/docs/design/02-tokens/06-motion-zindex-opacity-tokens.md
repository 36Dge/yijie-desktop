# 动效、层级与透明度 Tokens


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义易界界面动效速度、缓动、z-index 层级和透明度规则。

## 适用范围

适用于弹层、抽屉、Toast、Agent 进度、按钮反馈、列表过渡和加载状态。

## 规范正文

## 动效原则

动效用于解释状态变化，不用于炫技。桌面端动画必须短、轻、可预测。

## 时长

2026-09-10 用户确认的首页品牌开场为局部例外：`--yj-motion-home-opening` 2200ms，每次进入空白的“新建任务”首页播放一次，同页重复点击菜单不重播；打断收尾 `--yj-motion-home-opening-settle` 160ms。常规控件仍遵循下表，不把品牌时长扩展到弹窗或普通交互。详见 [Chat 工作区「开界」规范](../05-patterns/02-chat-workspace.md)。

| Token | 值 | 用途 |
|---|---|---|
| `motion-fast` | 120ms | hover、focus、小反馈 |
| `motion-base` | 180ms | 弹层、按钮、状态切换 |
| `motion-slow` | 240ms | 抽屉、页面局部切换 |

## 缓动

- 标准：`cubic-bezier(0.2, 0, 0, 1)`。
- 退出：`cubic-bezier(0.4, 0, 1, 1)`。

## z-index

| Token | 值 | 用途 |
|---|---|---|
| `z-base` | 1 | 普通内容 |
| `z-sticky` | 100 | 固定头部/侧栏 |
| `z-dropdown` | 1000 | 下拉 |
| `z-popover` | 1100 | Popover |
| `z-drawer` | 1200 | 抽屉 |
| `z-modal` | 1300 | 模态框 |
| `z-toast` | 1400 | 消息提示 |

## 透明度

禁用态 opacity 0.45；遮罩亮色 `rgba(15, 23, 42, 0.32)`，暗色 `rgba(0, 0, 0, 0.48)`。

## AI / Codex 必须遵守

- 不允许使用超过 300ms 的常规 UI 动效。
- 不允许无限循环大动画。
- 不允许页面级 z-index 随意写 9999。
- 不允许用透明度降低文本可读性。

## 实现要求

动效变量写入 CSS variables。组件 transitions 使用 token。所有弹层优先使用 Naive UI 的层级，不自行创造 z-index 系统。

## 验收清单

- [ ] 动效不影响阅读和操作。
- [ ] 弹层层级正确。
- [ ] 没有 9999 z-index。
- [ ] 禁用态可识别且可读。

## 关联文件

`exports/src/styles/variables.css`、`exports/src/design/theme/naive-theme.ts`
