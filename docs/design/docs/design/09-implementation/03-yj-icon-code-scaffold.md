# YjIcon 代码骨架


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

提供统一图标注册和渲染组件的代码规范。

## 适用范围

适用于 `yijie-desktop` 仓库的实际代码落地。

## 规范正文

核心文件：

```text
exports/src/icons/registry.ts
exports/src/components/yijie/YjIcon.vue
```

业务页面只能使用：

```vue
<YjIcon name="store" />
<YjIcon name="agent" tone="primary" />
```

新增图标流程：

1. 从 Lucide 选择图标。
2. 加入 `registry.ts`。
3. 使用语义名称，不使用图标原始名称作为业务名。
4. 在 PR 中说明用途。

2.1.0 的 `primary` 图标 tone 表示重要普通操作，映射中性 `text-primary`，不直接映射浅青柠。success/warning/error 图标使用对应可读 semantic ink；Logo 与图表保持独立资产/系列颜色。

## AI / Codex 必须遵守

- 代码必须与文档一致。
- 不允许只更新文档不提供可落地结构。
- 不允许只复制代码片段而不接入现有工程。
- 不允许绕过类型检查。

## 实现要求

实现文件应逐步从 `exports/` 迁移到 `yijie-desktop/src/`，并在 PR 中说明迁移范围。

## 验收清单

- [ ] 文件放置位置正确。
- [ ] 命名符合规范。
- [ ] 可通过 typecheck。
- [ ] 与 token 和主题一致。
- [ ] 有使用示例。

## 关联文件

`docs/design/docs/design/03-ui-system/02-iconography.md`
