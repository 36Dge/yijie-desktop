# 插件市场 Pattern


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义易界 Skill/Plugin 展示、安装、配置和权限说明页面。

## 适用范围

适用于对应页面 pattern 的路由页面、业务组件、状态管理、接口接入和文案。

## 规范正文

插件市场必须展示插件名称、能力范围、适用平台、需要权限、数据访问范围、版本、发布者和安装状态。插件安装前必须说明权限和影响范围。

插件详情页要区分“能力说明”“所需权限”“使用示例”“版本记录”。

## AI / Codex 必须遵守

- 新页面必须先匹配既有 pattern；没有匹配项时先补 pattern 文档。
- 不允许在页面中重新创造布局、状态和交互流程。
- 必须包含 loading、empty、error、permission denied 状态。
- 涉及 Agent 的页面必须展示过程和结果。

## 实现要求

页面文件放在 `src/pages/` 对应业务目录，复杂逻辑进入 `src/domain/` 或 composables。页面只负责组合组件和绑定状态，不承载复杂业务规则。

## 验收清单

- [ ] 页面结构符合 pattern。
- [ ] 主操作明确。
- [ ] 数据和状态完整。
- [ ] 风险/权限/错误已覆盖。
- [ ] 组件复用而非页面堆叠。

## 关联文件

`docs/design/docs/design/04-components/`、`src/pages/`、`src/domain/`
