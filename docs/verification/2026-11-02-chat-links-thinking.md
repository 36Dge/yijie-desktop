# 对话文本超链与实时深度思考扫光

用户于 2026-11-02 要求：回答中的 Markdown 链接只显示主题色标签，悬停显示完整地址；模型当前正在深度思考时，标题复用“正在思考”的明显扫光。

`contract-impact = additive`：Desktop 私有 `chat_web_source_v1` 增加 `open_message_link` 操作。权威源是 `src-tauri/schemas/chat-web-source-v1.schema.json`，由原生成器派生前端类型。Producer/consumer 均为当前 Desktop Native/Vue；用户本次文本超链要求授权该链接操作。公共 Contracts PR/pin 为 N/A：不改变 Host/Runtime、原生记录、数据库、旧版历史、公开接口或持久权限。

新操作复用既有授权上下文、会话/轮次/Item 归属检查、HTTP(S) 公共地址限制与系统浏览器打开库；只接受对应模型正文或思考内容中精确存在的 Markdown destination。不会把任意 renderer URL 当作执行授权，不自动打开或预抓取链接，不给新链接取图标。原 `open`/`icon` 仍仅接纳原生网页搜索来源，语义不变。UI 只在明确点击/键盘激活时调用；失败显示再次点击重试。

兼容方向：先生成并构建 Native 新操作，再在固定开发客户端正常退出/重启后验收 Vue 调用。旧 Native 对新 action 正常拒绝，前端显示可重试失败，不回退成未校验的打开。旧 renderer 的两个 action 保持可用；无数据库迁移，回滚不需要改写数据。没有新增 command、plugin、capability、CSP 或依赖。

扫光单独属于 `contract-impact = none`：由已有原生进度和最后一条实际活动推导展示状态，不制造执行状态；回答、工具、等待审批、历史、异常与完成时不继续宣称深度思考。隐藏窗口/过程暂停，减少动态效果及强制颜色模式使用静态标签。正文与展开选择保持。

## 验证结果

- 实机正常退出旧 PID 85700，原 CLI 返回 0、无终止信号；通过固定“易界.app”入口增量构建并启动 PID 66859。Runtime、权限与原有历史保持；没有新安装包或全量备份。
- Kimi K3.1 Pro 真实问答生成“路线来源”“相关说明”两个 Markdown 链接。正文只显示标签；真实鼠标悬停显示 `https://example.org/`，点击经 Native 校验后在系统 Chrome 打开对应网页。目标 URL/页面标题已核对，临时页随后关闭。
- 用户截图中的旧杭州对话同样生效：保留原答案，“路线来源：杭州公交出行攻略”显示为深青柠文本，悬停提示精确原地址 `https://tidenews.com.cn/news.html?id=3304002`；“相关说明”也只显示标签。
- 原生录屏在 4.8–7.8s 捕捉到深度思考标题的左到右扫光。GIF 仅裁取并采样这段真实画面，没有模拟/重定时。浏览器使用生产组件确认共用 1800ms 动画，回答或工具开始后 `animationName=none`；展开行为保持。
- 1180×760 原生窗口无控件重叠，验证后恢复本轮开始前的 1268×845。浏览器检查亮/暗主题、hover/focus/Esc、嵌套列表/引用/表格、长地址提示及无横向溢出。临时预览关闭，尺寸覆盖已复位。
- 定向前端 40 项、原生正常 5 项通过；原生定向网络图标检查 1 项保持 ignored，本次未新增图标抓取。
- 全量前端：251 文件、2027 通过、16 跳过；Node 26 项通过。普通 Native：622 通过、14 ignored、27 safety filtered；Kimi Native：657 通过、16 ignored、27 safety filtered。
- `make lint`（含两套 Clippy、格式与生成检查）、最后的前端 lint/类型检查、`make test`、应用构建及文档构建通过。较大分包提示为既有构建警告。

首次全量前端检查有 5 条旧断言仍要求地址直接显示在正文，或把所有 `.chat-thinking` 当作唯一等待提示。断言已按新交互细化：URL 仍绑定到正确标签/消息，原文不改，等待提示与深度思考分别校验，来源与展开状态保护仍保留；复跑全部通过。

用户禁止的强杀、二进制替换、权限破坏和攻击 fixture 沿原安全排除清单不执行，ignored 项也未计为通过；相关异常场景不在此次结论内。没有强杀或替换受审 Runtime，仅由标准 Cargo 和固定入口更新可复现开发产物。

[详细证据](evidence/2026-11-02-chat-links-thinking/verification.json) 记录源码摘要、窗口与真实点击结果。截图、录屏及本轮独立差异位于 `.local/development/text-links-thinking-20261102/`。既有工作区改动保留，本轮以 `before/` 为起点；未提交或推送。
