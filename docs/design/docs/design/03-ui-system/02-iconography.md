# 图标系统


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义易界图标来源、风格、尺寸、封装和 AI 使用约束。

## 适用范围

适用于导航、按钮、状态、平台标识、空态、Agent、业务卡片和图表辅助图标。

## 规范正文

## 主图标库

易界主图标库为 **Lucide**。Lucide 风格清爽、线性、统一，适合 TOB 工具型桌面端。

## 使用方式

业务页面不得直接 import Lucide 图标，必须通过：

```vue
<YjIcon name="store" />
<YjIcon name="agent" tone="primary" />
```

图标注册在：

```text
src/icons/registry.ts
```

## 尺寸

| Token | 值 | 用途 |
|---|---|---|
| xs | 14px | 小标签、辅助信息 |
| sm | 16px | 表格、列表 |
| md | 18px | 默认 |
| lg | 20px | 按钮、导航 |
| xl | 24px | 空态、重点卡片 |

默认线宽为 2。单页不得混用明显不同线宽。

2026-10-03 关联店铺入口使用既有 `store`（Lucide Store）门面轮廓，遵从用户要求不使用链条。
演示店铺改为名称意象图标：拾光家居 `shopHome`（House）、山海户外 `shopOutdoors`（Mountain）、
晴日生活 `shopSunny`（Sun）、Northstar Home `shopNorthstar`（Sparkle 四芒星）、
Luma Living `shopLighting`（Lamp）。全部来自既有 Lucide 依赖，经 registry / YjIcon 使用。
列表与成功卡片使用 20px 图标、40px 中性圆角容器，已关联入口使用同款 16px 图标；
统一圆端点、单色描线，平台仅使用次级文字，不冒充官方 Logo。
`search`、`loading` 分别使用 Lucide Search 与 LoaderCircle。
此组入口与浮层图标均采用 1.5 线宽；加载旋转遵从减少动态效果设置。

2026-10-03 用户指定的 Chat Composer 底栏例外：工作空间文件夹与权限入口的主图标
统一使用 `sm`（16px）、1.5 线宽。权限菜单内三个选项的主图标及选中勾号同步使用
1.5 线宽，尺寸保持原规格。仍通过 `YjIcon` 的 `strokeWidth` 属性消费既有 registry，
不改变全局默认线宽；其他页面沿用原规格。

2026-10-08：对话输入区关联店铺、模型、工作空间和权限入口的下拉箭头统一使用
`yj-control__chevron`，尺寸为 `--yj-space-3`（12px），覆盖紧凑控件默认的 16px 图标规则。
主图标、按钮命中区、线宽及打开菜单的行为不变；Composer 的备用入口使用相同规则。
侧栏“技能”使用现有 `skillOperations`（Lucide Wrench），与加号菜单一致。

`contract-impact = none`：本次仅改变图标尺寸、导航显示名称及图标。Desktop 跨进程接口、
API / Agent Host、路由与权限语义、本地持久状态均无变化。

## Skill 广场分类图标（2026-09-07 用户确认）

五个分类标题使用 `skillCategory*` registry 条目：在原有 Lucide 轮廓上，以品牌青柠 token 绘制局部笔画，与中性主体共同构成图标；背景透明，不添加青柠底板。包裹封口、趋势线、扩音器分隔线、点击射线、扳手柄分别作为强调细节。沿用 `lg` 20px、2 单位线宽、圆端点。

主体继承 `YjIcon` 的中性前景，暗色主题自动使用高对比浅色；青柠固定使用 `--yj-color-brand-primary`。分类文字同时提供完整含义，青柠细节不单独承担识别、操作或状态信息。所有 Skill 卡片继续使用各自独立的单色 Lucide 图标；不将分类双色外观用于卡片或其他普通图标。

来源为项目已固定的 `@lucide/vue` 1.27.0（ISC），局部描线在 `src/icons/skill-category-icons.ts`，保留许可声明，不增加图标依赖。

## 品牌图标

Amazon、Temu、Shopee、TikTok Shop、LinkedIn、飞书、钉钉等品牌图标必须优先使用官方素材。官方素材进入：

```text
src/icons/custom/brands/
```

每个品牌图标必须在 `docs/design/docs/design/03-ui-system/06-brand-assets.md` 或对应资产清单记录来源、获取日期、授权说明。

## 备用来源

Iconify / Simple Icons 只能作为经过审核的备用来源，不是默认来源。使用前必须确认授权、风格和是否允许在商业产品中展示。

## AI / Codex 必须遵守

- 不允许页面直接 `import { Search } from '@lucide/vue'`。
- 不允许引入新的 icon 库。
- 不允许复制未知来源 SVG。
- 不允许用 emoji 替代业务图标。
- 不允许同一页面混用实心、线性、彩色三种风格。
- 品牌图标不允许自行绘制成疑似官方 logo。

## 实现要求

先实现 `YjIcon.vue` 和 `src/icons/registry.ts`。新图标必须先进入 registry，并在 PR 中说明用途。品牌图标必须放本地 SVG，且来源记录完整。

## 验收清单

- [ ] 页面只使用 `YjIcon`。
- [ ] 新图标进入 registry。
- [ ] 品牌图标来源可追溯。
- [ ] 图标尺寸、线宽一致。
- [ ] 图标颜色来自 token。

## 关联文件

`exports/src/icons/registry.ts`、`exports/src/components/yijie/YjIcon.vue`、`docs/design/docs/design/09-implementation/03-yj-icon-code-scaffold.md`

## 定时任务记录操作（2026-09-25）

记录卡片操作使用 registry 中 `rerun`（Lucide RotateCcw）和 `arrowUpRight`
（Lucide ArrowUpRight），分别表示重新执行和查看关联对话。沿用 16px、2px 线宽、
中性前景及禁用态，不添加装饰背景，不引入新的图标依赖。

## 对话发送操作（2026-09-30）

对话输入框的 `send` 使用既有 Lucide 库的 `SendHorizontal`，在发送按钮内逆时针
旋转 90°，使纸飞机竖直朝上；停止图标不旋转。
图标为 `md`（18px）。右侧圆形操作按钮使用 `--yj-control-height-md`（36px），
发送与停止状态保持相同占位；停止图标沿用原有形状和尺寸。可发送态、禁用态、
hover、pressed 及键盘焦点继续使用既有 token 和交互规则。

`contract-impact = none`：仅调整 Desktop 图标与按钮尺寸，Desktop/API/Agent Host
跨进程接口、权限、发送与停止流程及本地持久状态均无变化。
