# Design System 2.0.0 视觉迁移记录

- 日期：2026-09-06
- 代码基线：`4fdd28a79a3aac51172c43c7fefd8b87217c1afb`
- 范围：活跃 Desktop `src/` 的颜色、主题映射和页面内 Logo。
- `contract-impact = none`：Desktop 的跨进程、跨仓、跨版本交互，API / Agent Host 协议、本地持久状态及审批语义均无变化；本次仅改变进程内视觉呈现。

## 实现

- 结构背景采用纯白 / 中性石墨；文字、边框、局部选中、焦点和阴影颜色按 2.0.0 更新。
- 保留全部既有字号、字体、间距、布局、圆角、动效和阴影几何参数，以及 Chat 专用扩展 token。
- `text-on-accent` 兼容映射到石墨 `on-brand`；Naive UI 显式区分实色主操作和文本/ghost 操作，并覆盖选择、开关、分页、标签和焦点颜色。
- Naive UI 的既有浅色 focus ring 与暗色 glow 几何分别保留，仅更新颜色；未将参考实现的统一环形阴影直接覆盖暗色控件。
- ECharts 保留现有 token reader、图表配置与七个非品牌系列；首序列通过 token 在亮色用深品牌色、暗色用青柠，坐标与 tooltip 自动继承中性主题。
- 页面内图形标志直接复制批准的亮暗 SVG；旧兼容文件与批准 mark 保持字节一致。沿用根 `data-theme` 选择变体，没有新增系统主题监听器、偏好或状态存储。
- 按用户要求保留原有 Logo 占位、对齐、中文“易界”标签和字体。因此未替换为宽高比及中英文字形不同的整幅横版 SVG；此处是本次“布局和字体不变”的明确范围约束。
- 清除 Chat 首页和店铺快报的绿色结构渐变；修正细线图标、键盘焦点、发送图标以及已有确认按钮的品牌前景色。
- Chat 一处未定义的 `text-muted` 颜色引用映射到既有 `text-secondary`，未改变文案或显示条件。
- API、store、路由、权限、Tauri、打包图标和发布配置未修改。

## 视觉证据

[前后截图与验收报告](../../.local/design-v2-review/report.html) 是可离线打开的独立 HTML，内嵌截图；原图、检查结果、局部测试夹具与采集脚本保存在 `.local/design-v2-review/`（不参与打包）。

- 环境：本机 Chrome 浏览器，1180 × 760，DPR 1；实际页面组件 / App Shell，固定合成数据，测试专用内存路由与权限状态。
- 六个页面分别覆盖 light / dark：Chat 新建任务、我的店铺、工作流、插件、设置、无权限页。
- 相同数据、状态和窗口的 12 组前后截图；记录的关键元素 x/y/width/height 对比无差异，无页面横向溢出，无浏览器页面错误，记录到的可见文案相同。
- 25 个变更 Vue 文件的代码对比：除 Logo 的主题图片节点外，脚本和模板不变；原有非颜色 token 保留。
- 补充插件 loading / empty / error / permission denied，以及 ready、Chat 已有对话、输入焦点、权限说明弹窗和共享控件截图。
- 实测 Naive primary 默认、hover、pressed 填充及石墨前景；Chat 发送按钮及图标前景为石墨；文本/ghost 品牌操作可读。
- 共享控件夹具切换主题后，输入保留，图表 Canvas 按现有生命周期重建，24 / 32 / 40 px Logo 切换为正确资产。Chat 权限说明弹窗关闭后草稿保留。
- 插件四种状态和共享控件在亮暗主题中经 axe 检查，无 serious / critical 违规；此结果仅覆盖这些检查场景，不代表全应用或原生可访问性认证。

## 自动检查

- `pnpm lint`：通过（ESLint、Vue / TypeScript）。
- `make build`：通过；存在现有图表 chunk 超过 500 kB 的提示，本次未改动分包。
- 定向安全前端回归：19 个文件，202 项通过，1 项按安全约束跳过。覆盖 App、Router、主题、共享布局、图表生命周期、店铺、工作流、插件、设置、Chat、Composer、审批组件及可访问性。
- 新增/更新主题验证读取实际 CSS token，检查亮暗主按钮/文本/焦点/图表对比度、状态色独立性及缺失 token 行为。
- `git diff --check`：通过。
- `pnpm docs:build`：见本次执行日志 `.local/design-v2-review/docs-build.log`。

定向回归命令：

```sh
pnpm exec vitest run src/design/theme src/App.test.ts src/router/index.test.ts \
  src/components/yijie src/components/skills src/components/store \
  src/pages/store src/pages/workflows src/pages/plugins src/pages/settings \
  src/pages/chat/ChatAccessibility.test.ts src/pages/chat/ChatPage.test.ts \
  src/components/chat/ChatComposer.test.ts src/components/chat/ChatApprovalCard.test.ts \
  --testNamePattern '^(?!.*uses the legacy renderer only through the explicit rollback boundary).*' \
  --maxWorkers=4
```

## 未通过、未执行及影响

- **全仓 `make lint` 未通过**：默认环境先因兄弟 Skills HEAD 与锁定 commit 不同而停止。使用本地隔离 clone、固定到锁定的 `10c45bec29603b002e861e1499d5b4e684251af5` 后，保留已核实的 canonical origin，契约检查、前端 lint 与 `cargo fmt --check` 通过；最终在未修改的 `src-tauri/src/chat/database.rs:3195` 被 Clippy `type_complexity` 阻断。没有更改 lock、digest、兄弟仓工作区或 Rust 代码来消除门禁。本次不能声明全仓门禁通过。
- **全量 `make test` / `cargo test` 未执行**：历史套件含攻击性内容 fixture、权限异常和可执行 fixture 等测试，与用户长期安全条款冲突。改用上述正常组件/状态/路由回归；不覆盖 native、存储、进程故障和攻击注入验收。
- **单项跳过**：`ChatPage.test.ts` 中 `uses the legacy renderer only through the explicit rollback boundary` 包含 script 注入式内容，未执行；未声称旧渲染器的该安全用例通过。
- **一次回归波动**：图表主题重建测试曾在批量运行中失败。未修改原始图表测试的断言或生命周期；原始测试单独运行 3 项通过，最终整组回归 202 项通过。另以浏览器验证主题变化会替换 Canvas。
- **原生验收未执行**：未运行签名/打包应用、VoiceOver、真实登录、平台访问或本地高影响操作。截图及视觉验收来自浏览器组件环境，不等同 Tauri/WebKit 原生验收。
- **保留的既有规范差异**：`AGENTS.md` 的部分“当前实现状态”描述已过时；本次以实际源码核对，未顺带改写治理说明。原有页面的信息架构、布局和交互差异不在本次迁移范围。
