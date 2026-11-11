# 日常入口文档定位、PDF 连续滚动与窗口焦点修复

contract-impact = semantic。范围为 Desktop 私有预览 v1 的 PDF 阅读语义及固定 macOS 开发入口 v3；无公共 API/Host/Runtime 协议、数据格式、CSP 或权限范围变化，Contracts PR/pin 为 N/A。沿用已授权工作区 bookmark 校验，不通过降级权限校验解决定位。

## 原因与修复

- 前一轮只在 `start-ui` 验收包核实路径，然后恢复裸可执行文件的日常入口，未在恢复后再验到位。本轮同一 PDF 在验收包可定位，在原 `client:dev` 中内容无关诊断反复显示 `stage=workspace unavailable=true`。原文件均存在，故不是 PDF 特有问题，也不是缺少生成文件。
- 深入诊断确认 `resolve_bookmark` 返回 macOS 错误 259，工作区菜单中旧目录均不可用。仅将 dev 程序放入 `.app` 后仍失败，故上一条入口差异不能等同于完整根因。通过产品原生选择器重新选择原 FEAT-171 目录后，同一 PDF 立即返回正确路径，没有查询或修改书签密钥，没有降级解析选项。
- 固定入口继续 Tauri dev/HMR，Cargo target runner 用标准 Tauri bundler 运行同一开发二进制的 `.app`。编译器输出与 bundle 主程序 SHA-256 必须相同。固定目录、完整配方和 bundle 摘要支持复用；原数据 Homes 与正常退出流程保持。桌面小启动器同步识别固定 bundle，已通过 canonical 安装脚本更新。`start-ui` 与日常入口也统一 dev 配置，不再在两种构建程序身份之间切换；并验证原生更新后原目录授权是否保留。
- 原生 Wry 0.55.1 的 macOS child 创建会调用 NSApplication activate，即使 with_focused(false)。前端原来仅依据 visibilitychange 就可能重建失焦阅读器。现在原生窗口 focus 为恢复必要条件；可见性、主题或授权续期不能在后台重建；原生创建前再次检查 parent.is_focused，覆盖异步读取期间切走的情况。
- PDF 使用连续页面占位与附近页面按需图片。Native 独立资源处理在后台渲染，4 页/16 MiB 缓存；文档失效后停止提供资源。保留 256 页/每页 400 万像素预算，Office 布局和文档 CLI 单页接口不变。

## 已执行检查

- 定向 Vitest：41 个用例通过，覆盖原侧栏、路径、保存、背景可见性/主题/上下文更新、进行中读取晚到、PDF 无选页控件及开发入口配方。
- 定向 ESLint 通过。
- Native：普通多页连续阅读/缓存边界 1 项、PDF 方向与图像 1 项、已有文件匹配 3 项均通过。
- 首轮 Clippy 未通过：3 个 HEAD 已有问题（document_preview_native XLSX collapsible_if；document_runtime 类型复杂度及 collapsible_if）。后续按用户要求修复并通过严格定向检查，见下方收尾记录。
- vue-tsc 类型检查、PDF 阅读脚本语法检查、Bash 语法和受影响 Rust 文件格式检查通过。
- git diff --check 通过。原生测试只运行上述安全筛选用例。

## 实机结果

首次新日常入口：PDF 连续显示原页与追加说明页，没有页码下拉。恢复原目录授权后 PDF 路径正确。

用户已实际操作并明确确认抢焦点问题解决。CUA 直接操作 Codex 被工具安全限制拒绝，未绕过此限制；不将访达观察冒称 Codex 自动化验收。

移除临时细分诊断后，通过 `pnpm client:dev` 正常完成原生增量更新与重开。主程序 SHA-256 从诊断构建 `1e6aed8a8f422ea93be492ed0cf988f2813656b2450126a82f9e499340f75459` 变为最终构建 `6910305a7ecec8f1ff4ccf229a63a53ce6d737e74e70e8957bf25139eb57d9b3`，临时 linker identity 均为 `yijie_desktop-d93c9bb8659f1b61`；恢复的工作区授权跨本次原生更新保持有效。

同一日常客户端逐一点击验证以下真实文件，路径浮层均返回 `/Users/jack/Documents/FEAT-171验收-20261109/` 下相应现存文件：

| 子目录 | 已核验文件 |
| --- | --- |
| kimi-update | 杭州样本-第二版.docx、.pptx、.xlsx、.pdf |
| kimi-create | 杭州文化简介.txt、.md、.html、.docx；杭州参观时长.csv、.json |

覆盖九种格式，额外复查用户截图中的初版 Word。PDF 从第一页连续向下滚到第二页“修订说明：这是第二版。”，没有页码选择控件；再向上滚动可返回第一页。

实际拖动到 1180×760，路径浮层保持在正文上方，正文仍显示，没有空白或重叠；随后恢复 1339×843。设置页与 View 菜单无主题切换入口，本轮未执行原生暗色视觉检查，不以单元测试替代。没有改动用户系统外观设置。

最终保留日常客户端和同一 PDF 预览，清理本次打开的其他文档标签；新任务工作区选择恢复原来的未选择状态。只通过系统正常目录选择刷新已存在的项目授权，未新建任务、发送消息、调用模型、覆盖文档或写保存副本。

日志：`.local/preview-pdf-fix-20261110/diagnose-ui.log`、`diagnose-development.log`；本轮 `.local/preview-pdf-fix-20261111/development.log`、`location-diagnostic.log`、`final-development.log`。最终日志未出现定位失败诊断。

## 未执行范围

不执行全量回归、攻击 fixture、权限破坏、强杀进程或二进制替换式测试。无模型调用、任务重放、数据迁移或生产发布。验收只读已有合成文档任务。

## 2026-11-11 Clippy 定向收尾

用户要求修复余下 3 项 Clippy 问题，只执行相关定向检查。本次 `contract-impact = none`：
两处嵌套条件合并为保持原短路顺序的条件表达式；验证缓存增加局部类型别名，实际类型与
缓存内容不变。Desktop 可观察行为、Native IPC、API/Agent Host、文件权限及本地持久化
和重放语义均无变化。

变更仅涉及 `document_preview_native.rs` 和 `document_runtime.rs`，未增加 lint 抑制。

已通过：

- 两个受影响 Rust 文件的 `rustfmt --check --edition 2021 --config skip_children=true`。
- `cargo clippy --offline --locked --manifest-path src-tauri/Cargo.toml --lib --no-deps --features kimi-k31-pro-candidate -- -D warnings`。Clippy 不支持按源文件筛选，故限定本项目库目标，不扩大到其他 targets 或依赖 lint。
- 精确用例 `chat::document_runtime::tests::normal_document_input_json_and_empty_container_keep_original_bytes`，验证正常文档输入与已有文件复用。
- 精确用例 `chat::document_preview_content::tests::normal_xlsx_renders_cells_merges_shared_strings_and_cached_formulas`，验证正常表格预览。
- 受影响文件的 `git diff --check`。

两项测试各自使用 `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --lib --features kimi-k31-pro-candidate <完整用例名> -- --exact`，均为 1 项通过、738 项过滤。
已核对安全排除清单与用例内容，没有运行攻击或故障 fixture。Cargo 检查输出固定到
`src-tauri/target`，未触碰正在运行的 `.local/development/target` 客户端构建。未运行全量回归、
前端测试或 UI 验收；这次是保持行为不变的 lint 整理。
