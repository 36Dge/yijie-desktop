# 候选配色验证记录

日期：2026-09-06。范围：第 1—3 项的隔离候选；不是正式迁移、发布或 Tauri 验收结论。

## 交付物与来源

- [离线评审页](./review.html)：62 张真实捕获，含三页前后 / 明暗 / 两种窗口对照，以及组件和瞬时交互状态。全部图片内嵌，文件可离线打开。
- [完整状态矩阵](./02-component-color-matrix.md)：文字、图标、按钮、输入、导航、筛选、选择控件、卡片、标签、表格、弹层及状态组合。
- 真实页面来自现有 `ChatPage`、`StorePage`、`SkillMarketplacePage`；实际共享 `YjAppShell`、`YjNavItem`、`YjTabs`、`YjIcon`、`YjLogo`、`YjMetricCard` 与 Naive UI 同时参与渲染。
- 预览入口独立，采用合成数据和内存路由。没有重新画一套 HTML 来代替实际页面，也没有把候选覆盖加入正式应用入口。
- 三页的“当前实现”指本轮工作区中已经完成视觉迁移的现有 `src/`，不是回滚到更早的绿色基线。

## 已执行检查

| 检查 | 结果 | 证据与范围 |
|---|---|---|
| 正式文档构建 | 通过 | `pnpm docs:build`；现有规范仍保持原版本，本目录候选不加入正式文档导航 |
| 前端 lint / 类型检查 | 通过 | `pnpm lint`；另对候选执行独立 `vue-tsc` 与 ESLint |
| 现有应用构建 | 通过 | `make build`；保留已有大 chunk 提示，没有为消除提示改动业务打包结构 |
| 候选独立构建 | 通过 | `preview-server.mjs --build`；构建输出仅在被忽略的 `.local/component-color-review/build/` |
| 三页前后对照 | 通过 | Chat / 店铺 / Skill × current/candidate × light/dark × 1440×900、1180×760，共 24 张 |
| 内容与尺寸保持 | 通过 | 每组当前 / 候选文本一致；AppShell、侧栏、Logo、页面标题区、Composer、指标 / 场景 / Skill 卡片的几何、字号、间距、圆角一致；文档无水平溢出 |
| 常态结构底色 | 通过 | 亮色结构计算值为 `rgb(255,255,255)`；普通卡片和输入区没有扩散阴影 |
| 完整组件样张 | 通过 | 9 个分区 × 明暗，真实组件 props 覆盖选中、只读、禁用、加载、错误；表格 loading/empty 样本展开捕获 |
| Hover / Pressed / Focus | 通过 | 主按钮在真实 Chrome CSS 伪类下固定捕获，其余通过鼠标和键盘执行；未以假控件或替换贴图冒充状态 |
| 输入与状态组合 | 通过 | 中性 2px focus、错误边框与 focus 并存、只读属性、选中文字为青柠底石墨字；主题切换保留输入内容 |
| 选择与弹层交互 | 通过 | Switch 启停、Select 更改、Popover、Dropdown、Modal；Modal 关闭后焦点回到原按钮 |
| 真实 Chat 交互 | 通过 | 输入后发送按钮可用且青柠底石墨前景；权限说明打开 / 关闭保留草稿，正常输入无品牌 glow |
| 页面已有状态分支 | 通过 | 独立检查 12 个正常组合、16 个 Chat/Skill 状态投影、4 个 Chat/Skill 控件交互；见下方独立记录 |
| 组件可访问性检查 | 通过（限定范围） | 明暗图谱 axe 违规均为 0；仅排除明确标注的库原生 `primary+secondary` 反例和孤立禁用文字色块示例，不排除正常业务内容 |
| 角色对比值 | 通过 | 35 组不透明前景/背景配对，正文目标 ≥4.5:1、必要轮廓 ≥3:1；不能以此代替所有复杂透明叠加状态的最终原生验收 |
| 隔离与已有工作保护 | 通过 | 原生命令调用、外部请求、浏览器异常均为 0；11 仓 HEAD 与 44 个预存修改文件内容未变；无暂存或提交 |

本轮修正了候选样张自身的两类语义问题：Naive NCard 默认标题输出缺少层级的 heading，改用真实 NCard 内容槽的原生标题；默认表格选择列没有可访问名称，改用真实 NCheckbox 的具名渲染列。未改供应商源码或正式业务组件，也未在检查后用 DOM 改写伪造结果。

## 关键视觉数值

- 主文字 `#25282B` / 纯白约 14.82:1；石墨 / 青柠约 11.50:1。
- 明暗普通焦点均为 2px 无模糊轮廓；它可能由零模糊 `box-shadow` 实现，不是投影阴影。
- 普通卡片、Composer 常态阴影为 `none`；浮层为 `0 6px 20px`，亮色石墨透明度 0.10，暗色黑色透明度 0.28。
- 暗色必要控件轮廓采用 `#6A727C`，对卡片 `#25282B` 约 3.04:1；浮层背景更亮，其内部默认输入 / 选择边界提升为 `#969EA8`。
- 文本选择使用独立 `text-selection-bg / text-selection-ink` 映射到青柠 / 石墨；不改变原生选择、复制或输入法行为。输入框外圈继续采用中性焦点角色。

## 未通过与未执行项

| 项目 | 原因 | 影响 / 后续 |
|---|---|---|
| 完整 `make lint` | `generate:check` 在既有 Agent Host checkout 不干净处停止，日志为 `Agent Host checkout is not clean` | 不能声明全仓门禁绿色。已单独执行并通过前端 lint；没有清理、提交或替换独立 Skills 修复来绕过门禁 |
| 全量 `make test` / `cargo test` | 既有验证记录已明确其历史套件包含攻击性内容、权限异常、可执行 fixture 等；与用户长期禁止条款冲突 | 未执行相关套件，采用正常浏览器交互、类型和构建检查；不声称 native、存储或异常恢复测试通过 |
| 实际 Tauri / WebKit | 用户要求先完成第 1—3 项并确认后再执行第 4—5 项 | 本轮只有 Chrome 真实组件检查；`1180×760` 仍需在后续实际应用中复核 |
| 工作流、设置、已有对话、全部相关弹窗 | 属于确认后扩展范围 | 本轮不将这些页面算作已迁移；原有色彩继承风险在后续实施阶段继续清理 |
| Store 全页 loading/error/denied | 当前实际 StorePage 没有这些全页分支 | 不伪造重复正常页充当状态覆盖；现有分支边界见独立记录 |
| 原生登录、权限、模型、经营工具、Skills 持久化 | 隔离预览刻意不接这些真实能力 | 内存动作只验证视觉和组件响应，不验证真实权限或业务数据正确性 |

未使用强杀进程、故障注入、权限破坏、危险归档或可执行文件替换。测试浏览器通过自身关闭流程退出；预览服务只用于本地评审。

## 证据索引

- [当前 / 候选截图与交互记录](./validation/component-and-page-captures.json)
- [独立页面状态检查](./validation/page-state-audit.md) / [计算样式与结果](./validation/page-state-audit.json)
- [颜色角色对比值](./validation/contrast-roles.json)
- [已有工作区保护结果](./validation/worktree-preservation.json)
- [候选组件源码校验值](./validation/candidate-source-hashes.json)
- 初始快照：[worktree-before.json](./worktree-before.json)

本轮新增内容均位于当前 proposal 目录。正式 `docs/design/docs/`、参考 `exports/`、运行时 `src/` 和独立 Skills 修复均未被覆盖；本轮没有执行 git add、commit 或 push。
