# 对话首段输出前预加载修复

日期：2026-10-31。参考用户提供的《正在思考.mov》《易界输出.mov》，仅用作交互参考。

`contract-impact = none`：仅修改 Desktop 进程内呈现、秒数文案与样式，不改变 Desktop/API/Agent Host/Native IPC 的跨进程交互、原生计时、权限、持久化或重放格式。

## 行为

- 当前原生实时轮次开始、尚无实际输出时，在用户消息下方显示带明显亮带扫光的“正在思考”，不提前显示计时或空推理详情入口。
- 空白模型消息、空 reasoning started 元数据不触发切换。思考正文、摘要、模型正文、工具/搜索记录或计划均可触发切换。
- 首段内容到达后，同一行淡出/淡入为“已处理 N s”；沿用原生开始时间，包含前面的等待时间，每秒更新，不逐秒播报。
- 只在整轮成功完成后显示固定“已完成 N s”，最终秒数取原生 duration_ms。Item completed 不代表 Turn completed；缺失、失败、中断仍按既有真实状态展示。
- 同轮已经观察到输出后，投影短暂刷新不会重新进入首段预加载。切换轮次时重置展示记忆。
- 已有真实工具进度、过程折叠、正文、审批和失败恢复保持。扫光隐藏窗口暂停，减少动态效果/强制颜色模式使用静态文字。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 6 个相关组件/计时测试文件 | 78 项通过 |
| `pnpm lint`（ESLint + vue-tsc） | 通过 |
| `make build` | 通过；保留已有大 chunk 提示 |
| `pnpm docs:build` | 通过 |
| `git diff --check` | 通过 |
| 浏览器：亮/暗、1180×760 | 已实际检查，无横向溢出 |
| 等待→首段思考→回答→完成 | 已通过真实组件预览检查；原生计时读取由单元集成测试覆盖 |
| 同一时间行的位置与高度 | 预览测量：等待、处理、完成均为 y=306.20、height=37.94 CSS px（预览缩放后）；内部画布 1180×760 |
| 扫光 | 浏览器计算样式确认为运行中的 1.8s CSS 动画，亮带背景位置随时间变化；已检查亮暗截图 |
| Enter/Space 展开收起 | 浏览器检查通过，完成秒数不变 |
| 隐藏窗口与减少动态效果 | 监听清理/暂停单测通过，CSS 静态回退检查通过；未更改系统辅助功能设置 |

定向回归使用：

```bash
pnpm exec vitest run \
  src/components/chat/ChatTurnPreloading.test.ts \
  src/components/chat/ChatThinkingIndicator.test.ts \
  src/components/chat/ChatNativeStreaming.test.ts \
  src/components/chat/ChatProcessPresentation.test.ts \
  src/components/chat/ChatTurnGroup.test.ts \
  src/composables/useChatTurnTiming.test.ts \
  --maxWorkers=4 \
  --exclude '**/.local/**' --exclude '**/.contracts-source/**' \
  --exclude '**/.agent-host-source/**' --exclude '**/.skills-source/**'
```

首次定向命令误包含 `.local` 中同名历史测试；不将其数量用于最终结论，以上排除后的当前源码结果为准。

## 限制与未执行项目

- `make lint` 在契约生成校验 `contracts/market-catalog.candidate.json` 处失败；该文件及来源均未在本次修改。未刷新锁文件或摘要来绕过校验。后续 Rust fmt/clippy 未由该命令执行，已独立完成前端 lint。
- 扩展 `ChatPage.test.ts`：70 项通过、3 项失败、3 项原有跳过。失败是两项 animation-frame 数量断言（期望 1、实际 2）及旧附件节点数量断言（期望 1、实际 0）。使用 Git HEAD 的原 `ChatTurnGroup.vue`、仅将导入解析至原文件的本地隔离配置，三项同样失败；未修改这些断言以掩盖问题。
- **未执行全量 `make test` / Rust 全量测试**：其中包含刻意修改安全文件权限和注入链接路径的故障测试，例如 `feat126_secure_storage.rs` 的 mode/symlink/hardlink 分支及 `single_instance.rs` 的 `unsafe_existing_lock_file_is_rejected`。按用户长期硬性安全条款跳过，采用上述正常前端回归；影响是不能宣称全仓/原生安全验证通过。
- 未强杀进程、替换运行时程序、制造权限故障或执行攻击注入测试。
- 未重新打包或更新用户正在运行的易界 App；浏览器检查使用真实生产组件与普通演示数据，不是打包客户端或真实模型端到端验收。

## 可复现交互预览

```bash
pnpm exec vite --host 127.0.0.1 --port 1428
```

访问 `http://127.0.0.1:1428/tests/visual/chat-preloading/`，选择“播放完整流程”或各阶段按钮，可切换亮暗主题。
演示不调用原生 API、模型或第三方服务，不写会话和卖家数据。

截图保存在 `evidence/2026-10-31-chat-preloading/`；原始参考视频未改动。
