# 点击启动与日常服务生命周期验收

2026-10-31。`contract-impact = semantic`，用户授权点击易界后自动准备原本机服务，普通重开不执行全量备份。部署权威源见 [开发客户端 v2](../development-client.md) 和 Infra 的 `docs/workflow-desktop-session.md`。

## 已实现及实测

- Canonical Swift/AppKit 构建已成功，固定启动器在 `.local/development/launcher/易界.app`，本体约 200 KB。桌面及 `~/Applications/易界.app` 均指向它；没有替换历史已签名/已发布的客户端。
- 编译缓存固定在 launcher/module-cache，当前约 201 MB；不逐次创建版本或全量副本。
- 通过桌面入口实际启动了启动器，并识别原开发客户端 PID 61405。没有再启动第二个客户端；现有服务的原始身份、配置摘要与当前 macOS boot session 已登记。
- 当前服务就绪时复用原实例，不执行数据复制。日常控制器明确不调用旧恢复 backup、migration、任务重放或容器重建。
- 新服务入口的 7 项纯生命周期状态/配置表示测试通过；Desktop Python 环境/固定目录 2 项通过；开发参数与工作流兼容 Vitest 12 项通过；Swift 编译及 typecheck、diff whitespace、文档构建通过。

## 实机退出及自动重开

1. 界面工具对裸 Tauri 开发进程不可用，用户在原客户端按 ⌘Q 正常退出并回复“已退出”。旧开发启动器退出码 0；App、Host、Runtime、媒体和 worker 均退出。新入口自动完成专用服务正常停止，6 个主容器均退出码 0，状态为 stopped，无 pending_stop。
2. 启动器正常退出后，用 canonical installer 把最终 Swift 源码增量编译到同一固定位置；菜单含“查看启动日志”。当前源码与配置的 SHA、实际二进制 SHA 均与构建回执相符。
3. 确认 Docker 无运行容器后，经 Docker Desktop 自身菜单正常退出；观察 socket 不存在。打开桌面“易界.app”后，原 Docker 自动启动，启动窗口显示“正在启动服务并加载易界…”。没有强杀或中断运行中的容器。
4. 首次真实重开揭示 Docker 将 Dns/DnsOptions/DnsSearch 三项空设置从 null 恢复为 []。原校验正确保留现场并阻断。逐个核对 8 个原容器，只有这三项表示差异，使用旧空表示的完整摘要与原记录精确相同。补充窄范围兼容归一化及 2 项回归；其余配置仍严格校验。会话记录 v1→v2 保留原元数据，未复制卷或数据库、未修改容器配置。
5. 再次通过桌面入口启动成功。依赖按顺序启动，原 API/Coze 只读存储检查通过，原任务/工作流事实与启动前一致（仅允许已有规则规定的 principal 审计）。工作流状态 ready；8 个容器 ID 与正常退出前相同。
6. 当前开发客户端 PID 1596，窗口 1268×780，Host/媒体/worker/固定 Runtime 随客户端启动。Host `/readyz` HTTP 200，status/runtime_state 均 ready；模型目录 HTTP 200，两项模型均 available。工作流原 authenticated readiness 检查通过。
7. 当前客户端保持运行。恢复目录数量从本轮开始到结束均为 36，零新增数据备份；新增的只有启动日志、少量会话元数据及校验结果。未生成新的完整客户端安装包。

## 未执行与边界

没有重启用户电脑、强杀进程、中断运行中的 Docker 容器、篡改退出码或注入权限/二进制故障。电脑真实重启后的全链路未现场验证；退出码 255 仅以纯内存状态决策验证，不冒充断电恢复实测。发生真实数据异常、未完成操作或不一致时仍保留现场并报告。

本机小型记录：Desktop `.local/development/entry.log`、`entry-build.log`、`entry-tests.log`、`entry-docs.log`、`click-start-verification.json`；Infra `environments/local/generated/feat-153/desktop-session.json`、`desktop-session-v1.json`、`desktop-session-events.jsonl`。不提交真实数据或凭据。
