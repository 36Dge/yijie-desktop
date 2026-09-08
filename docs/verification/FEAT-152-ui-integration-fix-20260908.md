# FEAT-152 入口与首页配色修复

日期：2026-09-08。范围：用户本轮三项 UI 修复；本地 Demo，不含发布。

## 原因与改动

此前向用户提供的 `.local/chat-ui-sync-20260908-target` App 使用已提交 renderer 基线，未包含尚在工作树中的、已完成本地验收的 FEAT-152。普通启动/本地构建也没有自动提供两端权限开关，因此显示只读说明入口。

- `scripts/run-local-demo-fast.sh` 在 source preflight 与启动前同时设置 exact local/demo_fast 和 renderer/native 权限开关；普通、stable 本地构建包含新的三档菜单。
- 本地源码校验不再要求临时计数代理正在参与验收。仍验证原有不可变 Git 对象、origin、digest、Runtime 和权限同源生成物；明确提供代理时仍只接受原固定 loopback 地址，release channel 仍拒绝本地候选。
- 共用 `ChatComposer` 的 hover、focus-within 和 drag-active 都使用 `text-primary` 边框：亮色为石墨黑 `#25282B`，暗色为可读浅色 `#F5F7FA`，宽度 1px、无阴影。
- `YjNavItem` 选中使用 `control-pressed` 灰底，移除青柠内侧标记；路由、文字/图标、键盘焦点与折叠语义保持。
- 新增页面集成回归覆盖新建任务/已有任务的新权限入口以及权限读取失败后的重试；原三档、首次完全访问确认与 busy 禁用逻辑沿用 FEAT-152。

整体 `contract-impact = semantic`：这是用户已要求完成的 FEAT-152 在本地启动/构建入口的激活修复，从原只读入口切换到已有权限协议的消费。权威仍为 sibling `yijie-contracts` 的 runtime-permissions 源和 Desktop 私有 schema；本轮无新 wire/SQL/IPC/Runtime 修改。CSS 部分单独为 `none`。该结论不表示 public/production 激活、不可变发布 pin 或重新完成整个 FEAT-152 的付费 D4。

## 构建与检查

最终构建使用当前完整工作树，包含已有 FEAT-152 的 renderer、Native 与 Host 实现，保留已接受聊天/插件调整。未覆盖历史隔离 App、用户提供的 Runtime 或已签名产物。

本地 App：`src-tauri/target/debug/bundle/macos/易界 AI.app`。

最终主程序 SHA-256：`59c626a5a8e6e2ceaaee9125a7f51996345cd1c702c6465faa07fee2f1804a3b`。

构建命令：`YIJIE_DESKTOP_SKILLS_DIR=.local/skills-pinned-10c45be pnpm tauri:build:demo-fast`。
Skills 继续使用既有固定 `10c45bec29603b002e861e1499d5b4e684251af5` 来源；当前 sibling Skills HEAD 已前进，不能把它当成这个固定版本。Host 通过 canonical launcher 同一条 `go build -trimpath -o .local/bin/yijie-agent-host ./cmd/desktop-host` 生成开发产物。

| 检查 | 结果 |
|---|---|
| 前端 ESLint / TypeScript | PASS |
| 7 个相关前端/启动配置测试文件 | 99 PASS，1 个含 script 注入内容的历史用例按用户规则跳过 |
| Rust fmt / 严格 Clippy | PASS |
| FEAT-152 原生状态契约、正常重开恢复与子进程配置测试 | 3 PASS |
| 权限同源及 v4 不可变对象校验 | PASS |
| 固定 Skills 资源一致性 | PASS |
| 文档站构建 | PASS |
| 完整前端与 Tauri 本地未签名 App 构建 | PASS |
| diff 空白检查与非目标 renderer 哈希保护 | PASS |

首次直接调用 Vitest 未排除 `.local`，误运行历史隔离目录，产生失败；该记录保留，不作为修复后的通过证据。随后按标准测试入口排除隔离目录，当前工作树 99 项通过。

## 界面与真实服务

- Native 实际启动免登录进入首页；能读取真实权限状态“请求批准”，菜单可展开为三项，首项勾选，Esc 收起后归还焦点。
- 实际 App 已显示灰色导航选中态。最终构建重新启动后再次读取到新权限入口；用户随后切到“我的店铺”，未继续抢占导航。
- 直接引用本次生产组件的浏览器页，在 1180×760 下检查亮/暗 × 新建/继续对话，均无横向溢出；另外检查亮色折叠侧栏。
- 亮色 hover 和 focus 都为 `1px solid rgb(37, 40, 43)`；暗色均为 `1px solid rgb(245, 247, 250)`；焦点阴影为 none。灰色选中底亮色为 `rgb(236, 238, 240)`，暗色为 `rgb(65, 72, 80)`，选中阴影为 none。
- 同源浏览器菜单亮暗均检查了文案、选中勾和宽度；首次完全访问确认取消后仍为请求批准。浏览器页仅使用内存状态，不连接 Native/Host/模型。
- 最终 App 的真实 Host `/readyz` 返回 `runtime_state=ready, status=ready`；原 Runtime SHA-256 保持 `4efe16d2848680752cf9aacf4c17741ab2eeb7415894a66c2bb03652b00a322d`。
- 未发送模型任务、未切换真实任务权限、未修改草稿，模型付费调用为 0。

## 限制与清理

完整 `make lint` 的旧契约生成检查在 `contracts checkout has tracked changes` 处阻塞；没有清理用户工作树或放宽该检查。已独立通过前端 lint、Native fmt/Clippy 和本轮权限同源检查，不声明全量门禁通过。

遵循用户长期安全条款，未运行包含强杀、权限破坏、危险 fixture/归档或攻击注入的全量原生/前端套件；仅执行上表正常定向用例。因此不声称覆盖这些故障/攻击路径。

Native 弹出菜单截图不可用；菜单通过真实可访问树确认，亮暗菜单视觉使用同源浏览器组件。最终原生黑色焦点截图因用户操作页面未继续采集；对应最终源码的浏览器计算样式与截图已检查，不能把浏览器验证表述为全部 Native/WebKit 状态验收。

中间 App 通过正常退出关闭，确认端口释放后再启动最终构建；视觉服务器正常关闭，浏览器尺寸恢复并关闭临时页面。最终 App 留给用户使用。无提交、推送、签名或发布。

机器本地记录：`.local/feat152-ui-fix-20260908/`，包含构建/测试日志、启动配置、前后 renderer 哈希、最终产物哈希、工作树保护记录和同源视觉入口。

## 同日后续：选中灰底减轻

用户反馈选中底偏重，将 YjNavItem 的 selected 从 control-pressed 改为 control-hover。亮色由 #ECEEF0 调浅至 #F7F8F9，暗色由 #414850 改为更接近导航表面的 #30363D。只修改选中项颜色，pressed、焦点、路由与权限行为不变。`contract-impact = none`：纯 CSS 呈现微调，不涉及跨进程、持久化或权限边界。

后续验证：前端 lint/类型检查、9 项侧栏回归、文档构建与 canonical 本地 App 构建均通过。原生首页截图确认浅灰选中态；深色本轮复用既有 control-hover 映射，未重新操作系统主题。App 正常退出后重建并启动，最新主程序 SHA-256 为 `64d52a21eb1189312f924e9c5355d4f69e67354aa1f0b7eb5010a7b4c273c2d6`，记录在 `.local/nav-selected-light-20260908/`。没有新增测试、发送模型任务或修改权限模式。
