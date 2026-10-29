# 2026-10-29 对话立即失败：根因与修复

本文保留首轮根因、修复和验证记录。2026-10-29 用户随后明确授权生成物对齐、仅本地提交、正规构建和日常切换，限定零模型调用验证。新来源切换的逐项结果保存在本仓 `.local/conversation-warning-fix-20261029/`，最终以该目录 `delivery.json` 为运行证据；未产生该文件前不声称实机交付完成。不得重发用户消息或恢复 FEAT-162 收费验收。

## 已证实的故障链

1. 目标会话在北京时间 23:27:01 开始，Runtime 记录 `duration_ms=23`，没有 assistant 输出。Native 保存 `status=failed`、`submission_status=submitted`、`terminalErrorCode=other`、`diagnostic=runtime_notice`。截图的“0秒”是显示精度，不能解释为消息没有提交。
2. Runtime 日志明确记录请求目标为 `http://127.0.0.1:18083/v1/responses`，结果为 HTTP 502。该地址是验收计量器，并非 Kimi 官方接口。日志不足以定位 502 的具体返回者，不能据此宣称 Kimi 服务端故障。
3. 实际运行的是 primary generation `20261029-08`。其原始 `environment.json`、App、Host、Runtime 的已选环境均包含 `feat162-soft-budget-v3` 和上述 loopback override；正常受管 Kimi 模板仍为 `https://api.moonshot.cn/v1`。Host 的 `verificationProviderConfig()` 按显式配置同时覆盖 Kimi 和 MiniMax。
4. 该批次计量账本在 22:44:49 已正常停止，`meter_state=stopped_normally`、`armed=false`、`halted=true`。新的 App 却在 23:24:29 被打开。排查时 18083 无监听，新只读健康检查同样失败。
5. 原 `open_daily()` 直接继承构建时冻结的验收环境，既不要求当次明确选择验收模式，也不检查其临时依赖是否仍存在。验收 App 因此被当作日常 App 重开，用户提交后才失败。
6. Host 将原生 error/warning 投影为已有安全代码 `runtime_notice`；Native 原样保存，但前端显示白名单缺少此值，因此变成 `unknown` 并显示“会话存在未分类提示”。这是诊断展示缺口，不能通过修改提示文案解决失效的请求目标。

此故障不提供“Kimi 是否支持文生图”的能力证据。目标会话正文仅用于定位，没有作为新的模型任务执行。

## 实现与边界

- 原生 Runtime、Host、数据库、既有 App 和账本均不改；只在 Desktop 修复启动入口与中文诊断映射。
- 验收 generation 的 `daily:open` / `daily:verify` 必须显式带 `--feat162-observe`。普通 generation 不能通过该参数临时切换到验收地址。`--pause-kimi` 也不能绕过，因为 MiniMax 同样受该 override 影响。
- 启动前向固定 loopback 直接执行 `GET /health`，超时两秒、最多读取 4097 字节并拒绝超过 4096 字节的正文，拒绝重定向、错误响应、不匹配服务和 halted 状态。健康但尚未 armed 的计量器可供零派发启动；检查不创建预算、不开启计量器、不发送模型请求，也不作为后续收费授权。
- 缺少临时依赖时显示明确的启动错误；不自动切换真实供应商，不自动重试或补发失败会话。启动后的计量器故障仍可能使当前轮失败；启动检查并非持续健康保证。
- `runtime_notice` 显示“运行时返回了提示，但未提供可显示的详细原因。已保留现有内容。”未知值仍使用安全兜底，不展示上游任意错误正文、不编造具体网络原因。

`contract-impact=breaking`，仅针对本仓私有验收 CLI：原来隐式继承验收模式的 open/verify 现在要求额外显式参数。权威源为 `scripts/feat164_primary.py`；consumer 为调用该入口的本机操作流程。正常日常 CLI、跨仓 wire、Native 保存格式、Runtime 固定版本和权限/计量语义均保持。文案变更为纯显示，不回写历史。新源码尚未提交，不声称具有发布资格。

整仓生成检查另发现已有来源漂移：`market-catalog.candidate.json` 仍引用 Connectors `ff436bb9…`，当前干净 checkout 为 `ab1f8328…`。两个 commit 的目录文件逐字相同，SHA-256 均为 `55ec42e1965a7ecdfd17771af299afea786bc74a175ab4f021afdf8d538ab70d`。用原 `sync-market-catalog.mjs` 同步后继续检查，发现 `chat/connectors/host_generated.rs` 还缺少当前 Contracts 的审批截止时间字段/约束，属于已有 FEAT-162 生成物漂移。为避免把已暂停的另一项实现混入本修复，已撤回本次目录引用同步，生成物和 pin 保持进入本次任务时的原始状态。此独立阻塞必须在新 App 正规构建前处理，不能刷新摘要掩盖。

## 验证

- Python observation tests：5 项通过，覆盖普通入口零探测、显式选择、依赖缺失、正常 loopback HTTP 健康响应、停止态/无效响应/大小上限/重定向拒绝；服务均通过自身 shutdown 正常关闭。
- Primary parser/composition tests：16 项通过，包含既有 D4/D5/来源绑定，以及 implicit observation 和 unavailable meter 均不能调用 App launcher、原 activation 记录不变。
- 前端定向测试：4 个文件、25 项通过，覆盖真实形状的失败 Native view、历史重读、原始输入不变、中文消息、未知值兜底及实际 ChatTimeline 渲染。
- `pnpm lint`、`vue-tsc --noEmit`、Vite 构建通过。前端构建输出到独立 `.local/conversation-warning-fix-20261029/web-build`，未覆盖旧 App。
- `pnpm docs:build` 通过。`pnpm generate:check` 未通过：先发现目录 commit 漂移，临时正规同步后又发现上述 Host Native 生成物漂移；本次修改前相关文件即为该状态。完整命令失败结果保留，未宣称全仓检查通过。
- 直接使用实际第08代环境验证新检查：普通打开被拒绝；显式验收选择因本机依赖不可用被拒绝。只发本机健康 GET，无凭据、无模型 POST。

第一次定向 Vitest 命令未排除 `.local`，误包含历史源码副本并出现 16 个历史失败；随后使用仓库标准排除项，实际活跃源码 25 项通过。没有修改这些历史副本；首轮失败保留于本次命令记录。

未执行：整仓 Rust/故障注入/攻击 fixture、实机新包启动、亮暗及窗口专项、真实模型成功响应。原因：本次不改 Rust；避免无关的大规模构建和用户禁止的破坏性验证；实机切换需要新的正规来源绑定及激活。影响：当前证据证明代码和正常本机健康路径，不证明正在运行的旧 App 已修复，不宣称完整 D4 或新真实会话成功。

## 待批准的日常恢复步骤

以下步骤现已获本轮用户明确授权。生成物已通过原脚本从干净的 Contracts `d191ad6ed08f0e8cc89dfea1346b5ecdf010e776` 同步，目录来源引用对齐干净的 Connectors `ab1f8328ff50dab256b23f51d49157278421fd35`，完整 `pnpm generate:check` 和 lint 通过。新增字段是已有 0.4.0 生成定义中的可选审批截止时间对及其一致性约束，不改权威源，也不新增审批权限；旧记录省略两字段仍兼容。K3.1 正常运行原本选择独立 `host_v2_generated.rs`，本轮对齐旧默认 consumer 不改变该日常 profile 的协议。

实际开始时旧 App 已自行退出；无本项目活动进程或数据库句柄。已用正常实例锁完成 17,423 文件/526,581,505 字节完整冷备及独立检查副本。Native SQL41、Host11/18会话 idle，全部模型待发送/恢复计数为0，原6份已占用历史授权保持。没有强杀、权限故障、二进制替换或攻击测试。

1. 在不恢复 FEAT-162 收费验收的前提下，先处理上述已有生成物漂移并补相应编译/契约验证；然后仅本地提交审阅后的 Desktop 修复，保留现有第08代、失败会话、计量账本与所有备份。
2. 按应用自身正常退出流程关闭当前 App，检查退出完成及所属进程/数据库状态；若正常退出失败则停止，不强杀。
3. 使用 canonical `daily:prepare --generation <新编号>`，明确不加 `--feat162-observe`，生成新输出；不改旧 environment、digest、activation 或 Runtime 二进制。
4. 完成精确来源/制品检查、原数据正常备份、零派发预检，以及该新 generation 的 D4/D5；以 Kimi 暂停的正常启动核对原失败历史，再正常退出。此步骤只验证可启动、读取、停止，不请求模型。
5. 经此次新来源激活后保留普通日常入口，由用户主动重试原问题；不把原失败记录改成成功。不恢复 FEAT-162 已暂停的搜索验收。

回退保留旧源码与制品，不修改或降级数据库。旧验收构建只能在明确恢复原验收流程及临时依赖后使用；不能作为无计量器的日常回退。
