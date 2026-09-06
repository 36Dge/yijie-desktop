# 插件页启动不可用 — 根因与修复

日期：2026-09-06。范围：本地 demo_fast；用户明确要求分析并修复。

## 根因证据

- Agent Host `/readyz` 为 ready，带当前本机凭据的 `GET /v1/skills` 为 200，返回 38 项。
- `POST /v1/skills/scan-operations` 返回 409 `skill_busy`。
- 默认 App Data 的 v1 journal 有 4096 条，全部成功完成：4091 scan、2 install、2 enabled、1 uninstall；大小 48,819,651 bytes。
- 记录时间从 2026-08-25T02:37:07.599401Z 到 2026-08-25T14:28:32.77739Z。
- `reserveOperation` 以历史记录总数限制新操作；不会随重启清空。此前目录 watcher 回环已在历史修复中停止，但已满的 journal 一直保留。
- Desktop 每次启动、页面打开、窗口恢复和目录变化都生成新的 POST scan ID，进一步累积永久记录。首次读取收到 busy 时，store 进入 unavailable，错误文案被解释成“正在执行其他操作”。

## 改动

1. 自动刷新使用已有 GET 的真实目录与 Runtime 对账；明确点击重新扫描仍执行可重放 POST。原有 reason 校验、升级检查和权限边界保持。
2. 页面扫描收到 busy 时读取实时目录；成功即展示目录。授权和兼容失败不走此恢复路径，也不使用假数据。
3. Host 满 v1 journal 无损迁移到现有依赖 bbolt；所有 ID、输入指纹、结果、事务阶段保留，已完成记录按需读取。缓存移除不删除持久重放记录。
4. 数据库写入只在内容变化时提交。正常 GET 不写无变化的事务；清理暂存目录时即使相关记录已离开缓存，也从持久历史读取提交决定。

契约影响：公共 HTTP/native 请求响应形状、权限、错误码、幂等语义不变；私有存储降级为 breaking。权威及迁移/回滚规则位于相邻 Host `docs/skills-journal-v2.md`。v1 marker 切换为 v2 后，旧 Host 必须拒绝读取，不能丢掉新 ID 后继续运行；回滚代码需保留 v2 reader。没有清空或截断历史记录，没有修改 Runtime、Contracts 或 Skill 版本锁。

## 验证

- Go race 定向回归：6 tests PASS，覆盖满 4096 条迁移、旧记录精确重放、新安装/停用/卸载、正常关闭后恢复、同 ID 冲突、并发等待、历史不淘汰、Runtime 通知不自循环、无变化 GET 不写库、缓存淘汰后提交清理。
- Vue store + 实际插件页面组件：20 tests PASS；包含 busy 首屏恢复和恢复读取仍遵守权限。
- Rust Skills host tests：3 PASS；真实 loopback HostBridge 五类 Skill API 路径/请求体测试：1 PASS。
- `pnpm lint`、`pnpm build`、`pnpm docs:build`、`cargo fmt --check`、Host `make lint`（含全仓 go vet）、两仓 `git diff --check` PASS。
- `pnpm generate:check` 使用独立干净来源 worktree 校验已锁定 Git 对象，PASS；不把它作为验证时本地候选实现的运行证明。候选实现由上述测试和下面的真实窗口验证覆盖。
- 全量 `cargo clippy --all-targets -- -D warnings` 被已有 `src-tauri/src/chat/database.rs:3195` 的 `type_complexity` 告警阻止；未放宽 lint 或修改该无关代码。与本次改动产生的扫描方法 unused 告警已通过保留显式 POST 扫描消除。

## 本机真实验证

- 通过项目 Tauri 标准构建生成本地未签名 debug app，复用默认 App Data、现存 FEAT-136 Runtime 和本机 Host 凭据；没有发送模型请求。
- 原 journal SHA-256：`bb1fce1d3fcde68c6c837c47990dbb993778b7aacdf987b5dc75362c2f48bbe4`。启动及页面打开后仍为 4096 条，哈希未变；38 个卡片可见，页面不再显示服务不可用。
- 从实际插件页面点击一次重新扫描，迁移成功。备份文件与原文件哈希相同。正常 Cmd+Q 退出，确认 Host/Runtime 进程结束、18081 释放后，以只读方式核对数据库：4097 条记录，原 4096 条逐条 JSON 内容完全相同。
- 再次正常启动，打开插件页面，38 个卡片可见，无不可用错误。
- 加载最终 Host 修复后，再次正常启动并进入插件页，38 个卡片可见，Runtime ready。页面打开前后数据库 SHA-256 均为 `cdca93baa1e03da148e96052189232d3651e58e464a79fdc9bd08ab4695766ca`，mtime 也未变化，证明自动刷新没有追加记录或无意义改写账本。最终服务和客户端保持运行。

本机复现入口位于 ignored `.local/skill-journal-fix/run.sh`。它保留现有标准启动器的 Runtime digest、协议、退役和 Skill 资源检查及全部环境配置，使用独立干净的来源 worktree 校验锁定依赖；Host 仍由当前修复源码通过标准 Go build 构建。`YIJIE_LOCAL_FIX_ACTION=build` 构建 debug app，`run` 运行该 app，默认 `dev` 运行 Tauri dev。没有切换或清理用户分支。

## 结构化复审与未执行项

- 复审范围：迁移提交顺序、旧记录不丢失、同 ID 重放、活动请求共享结果、缓存与提交清理、只读查询的真实状态、现有设计工作区保护。
- 导入先提交并同步数据库，再原子发布 v2 marker；marker rename 后即使目录同步失败也不退回旧权威，下次接收操作先同步该目录。
- 本地数据只发生应用正常迁移和一次明确重新扫描；安装/停用/卸载回归在临时测试目录完成，没有改变用户已安装 Skill。
- 未运行含强杀、权限破坏、危险归档或攻击性 fixture 的综合/故障测试，也未执行付费模型门禁。相应异常恢复不声称通过；采用正常关闭/重开、有效历史数据及正常文件事务布局验证。
- 已有品牌和设计迁移改动保留。上述修复验证完成时尚未提交；后续提交状态以 Git 记录为准，推送和发布未执行。
