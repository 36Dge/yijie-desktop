# 易界组件状态用色候选

状态：**Proposed / 待用户确认**。本目录完成本轮第 1—3 项，不发布或替换已接受的 2.0.0 设计规范。

## 评审入口

- [离线评审页](./review.html)：内嵌真实截图，可切换三页、明暗主题、两种窗口尺寸以及当前 / 候选对照；无需启动服务即可查看截图。
- [完整组件状态矩阵](./02-component-color-matrix.md)：颜色角色、前景 / 背景 / 边框 / 焦点 / 阴影、适用状态、状态组合、绿色允许清单。
- [当前实现审计](./01-current-audit.md)：已经符合的部分、视觉差异与既有改动边界。
- [验证记录](./03-verification.md)：实测范围、结果与未执行项。

已确认基础保持不变：纯白 `#FFFFFF`、石墨 `#25282B`、青柠 `#C3F35B` 与现有新 SVG Logo。当前提案只细化用色角色、范围、状态及边框 / 阴影表达。

## 真实组件交互预览

在 `yijie-desktop` 仓库根目录运行：

```sh
node docs/design/proposals/2026-09-06-component-colors/preview-server.mjs
```

打开 <http://127.0.0.1:1448/review.html>，点击“真实组件交互样张”或“交互预览”。右下角评审控制栏可切换当前 / 候选和明暗主题，表单内容保留。正常按 Ctrl+C 关闭自己的预览服务。

预览参数：`page=atlas|chat|store|plugins`，`theme=light|dark`，`variant=current|candidate`，`controls=1` 显示评审工具栏。`state=loading|empty|error|denied` 只投影 Chat 与 Skill 已有的对应状态；Store 使用既有固定演示数据，不伪造不存在的全页状态。

## 实现边界

- `preview/main.ts` 使用真实 `src/` 页面和共享组件、内存路由、Pinia 与合成数据；不复制业务页面。
- `candidate-tokens.css` 与 `candidate-theme.ts` 是待评审主题增量；`page-candidate.css` 是页面与图谱共用的候选适配。均以 `data-palette="candidate"` 隔离。
- `StateAtlas.vue` 使用真实 Naive UI / Yj 控件；默认、选中、只读、禁用、加载、错误由真实 props 提供，悬停、按下、键盘焦点通过真实浏览器交互或明确标注的伪类捕获提供。
- 原生模块通过独立 Vite alias 指向 `tauri-stub.ts`；不启动 Tauri、Host、模型或经营工具。Skill 客户端和 Chat 动作只读写预览内存；不读取 / 写入卖家数据、应用偏好或业务持久状态。
- 本目录没有被正式应用入口、文档站导航或 exports 引用；不得从 `src/` 导入本目录。
- `contract-impact = none` 仅针对本次隔离候选，既有独立 Skills 修复不纳入此分类。

## 复现验证与截图

使用现有项目依赖，不新增依赖或更新锁文件：

```sh
pnpm exec vue-tsc --noEmit -p docs/design/proposals/2026-09-06-component-colors/tsconfig.preview.json
node docs/design/proposals/2026-09-06-component-colors/preview-server.mjs --build
node docs/design/proposals/2026-09-06-component-colors/capture-review.cjs
node docs/design/proposals/2026-09-06-component-colors/validation/page-state-audit.cjs
node docs/design/proposals/2026-09-06-component-colors/build-review.mjs
```

截图脚本需要本机 Chrome 与 Playwright。本环境使用已配置的 Codex 依赖路径；其他环境可设置 `PLAYWRIGHT_MODULE` 指向现有 Playwright 模块。截图和预览构建输出放在被忽略的 `.local/component-color-review/`；离线 `review.html` 嵌入截图，验证摘要保存在本目录 `validation/`。

## 确认后的任务

本轮交付用于一次整体确认。确认后再把最终规则写回正式规范、参考导出、运行时主题和共享组件，并迁移其余页面。在实际 Tauri / WebKit 中检查明暗主题、1180 × 760、交互与相关弹窗。当前不执行第 4—5 项，不提交或推送本轮候选。
