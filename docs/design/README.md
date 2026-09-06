# 易界 yijie Design System / UX 规范文档包

这是 `yijie-desktop` 的 Design System / UX 规范，面向人类研发、设计、产品与 AI/Codex 协作开发。当前组件配色与状态基线为 `2.1.0`，已接受 A「清爽青柠」＋01「纯白通透」。

## 已确认的关键决策

- 亮色背景、导航、卡片：纯白 `#FFFFFF`；主要文字：石墨 `#25282B`。
- 主操作与选中强调：青柠 `#C3F35B`，实色青柠上的文字、图标使用石墨。
- 空间层级：留白、间距和细中性边框；不再使用大面积灰底或浅绿底区分版块。
- Hover / pressed：仅小控件使用中性反馈；普通 UI 不再消费浅绿/深绿 soft。导航原底 + 3px 青柠标记，小筛选实色青柠。
- 焦点：2px 中性、无 glow；普通卡片/输入无阴影，真实浮层使用轻投影。
- 暗色：石墨背景 `#191C20`、卡片 `#25282B`、弹层 `#2E3237`；主文字 `#F5F7FA`，青柠保持 `#C3F35B`。
- Logo 与 App Icon：采用用户确认的“商品包裹折面 + YJ 负形”，使用真实矢量 SVG。
- 产品显示名称：中文 `易界`，英文/技术命名 `yijie`，品牌缩写 `YJ` / `YIJIE`。
- 默认主题：跟随系统。
- 主图标库：Lucide。
- 页面密度：标准。
- 最小窗口尺寸：1180 × 760；推荐默认窗口 1280 × 820。
- 图表库：ECharts。
- 插画风格：线性。
- 文案语气：专业。
- 国际化范围：中文。
- 品牌图标来源：官方素材优先。
- 操作审批策略、Agent 风险等级：后期由业务策略定义；本规范只定义 UI 承接方式。

## 本次更新边界

2.1.0 依据用户于 2026-09-06 批准的组件配色方案，覆盖颜色角色、状态组合、主题映射及参考实现。已批准的 SVG Logo 保持不变。字体、间距尺度、圆角尺度、布局结构、组件 API、交互、权限和内容规则继续有效。新需求与现有页面后续改造均使用新基线；规范与 `exports/` 是文档和迁移参考，活跃 `src/` 使用同一角色与主题入口；具体运行验证范围单独记录，不能由规范生效推断全部页面已验收。

完整状态见 [组件配色与状态矩阵](docs/design/04-components/09-component-color-state-matrix.md)；决策与迁移说明见 [2.1.0 组件配色收敛](docs/design/08-governance/08-component-color-convergence.md)。

## 使用方式

```bash
pnpm install
pnpm docs:dev
```

从 `yijie-desktop` 根目录执行 `pnpm docs:build` 会依次校验 SVG 与母版一致性、规范站和参考导出的 TypeScript / Vue 类型，再构建文档。单独校验参考代码可执行 `pnpm --dir docs/design typecheck:reference`；此命令使用设计目录内独立 `tsconfig.json`，不代表活跃应用已完成视觉迁移。

打开本地 VitePress 站点后，从首页进入 `Design System`。

## 推荐落地位置

```text
yijie-desktop/
  docs/design/       # 设计系统文档站与可迁移代码骨架
  src/design/        # 根据 exports/src/design 落地 token 与主题
  src/styles/        # 根据 exports/src/styles 落地 CSS variables
  src/icons/         # 根据 exports/src/icons 落地图标注册表
  src/components/yijie/
```

## 给 Codex 的最重要规则

所有 UI 代码必须遵守 `docs/design/docs/design/07-ai-codex/01-ai-development-rules.md`，尤其是：

- 不允许硬编码品牌色、状态色、字号、圆角、阴影。
- 图标必须通过 `YjIcon` 与 `src/icons/registry.ts` 使用。
- 新页面必须优先复用 `YjPage`、`YjPageHeader`、`YjCard`、`YjMetricCard`、`YjDataTable`、`YjAgentTimeline` 等业务组件。
- 涉及店铺、广告、Listing、库存、价格、买家消息等高影响操作时，UI 必须接入审批/确认能力，即便审批策略后期才由业务定义。
