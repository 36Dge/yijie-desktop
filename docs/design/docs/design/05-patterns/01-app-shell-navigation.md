# App Shell 与导航 Pattern


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义易界桌面端全局应用壳、主导航和工作区结构。

## 适用范围

适用于对应页面 pattern 的路由页面、业务组件、状态管理、接口接入和文案。

## 规范正文

App Shell 由左侧导航、顶部状态区、主工作区和可选右侧上下文面板组成。左侧导航承载 Chat、任务、店铺、Listing、广告、合规、物流、分析、插件、设置等入口。顶部状态区展示当前租户、店铺、同步状态、运行时状态和用户入口。

主工作区根据页面类型切换：Chat 使用三栏，数据页使用 PageHeader + MetricCards + Table/Chart，任务页使用 Timeline + Result + Trace。右侧面板用于上下文、审批、详情，不作为主导航替代。

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
