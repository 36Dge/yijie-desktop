# 日常推理输出验收（2026-09-29）

contract-impact = semantic；部署接口权威：[Host 设计](../../yijie-agent-host/docs/native-daily-reasoning.md)。用户要求日常开启推理并输出至前端。此报告记录实际开发构建，不代表签名发布或远端 CI。

## 修复与来源

根因是日常 Runtime/每轮请求均使用 none，且 Host 原生 raw 投影关闭；前端没有收到可折叠的 reasoning 条目。日常 sidecar 现在明确开启 native reasoning，Host 对新派发轮次选择 high 并转发已有 reasoning Item/delta。缺省 phase 仍是普通回答，不猜成最终回答。可见“模型回答”标题/icon 隐藏，正文、原有状态、复制与异常提示保留。

固定 Host `24d1bcc4291464887908aa5ee0f789b40989b77d`，Desktop candidate 使用仓库已有 freeze 工具从该 Git 对象生成并严格核验所有编译输入。Contracts 与 input-only Runtime 来源不变，没有公共 DTO/生成协议变化、Runtime 二进制修改或数据迁移。旧请求输入摘要保持原样，accepted 重试跨推理开关返回同一 Turn，不重发。

日常图片注册、原生权限和审批不变；旧 FEAT-134 的工具互斥验证不变。新模式不能在 public/production、fake provider 或无原生权限的环境激活。通过正常应用退出及 canonical 开发构建更新，未强杀、篡改既有可执行文件或使用攻击 fixture。

## 真实结果

普通 `pnpm tauri:demo-fast:app` 沿用原日常 Home/app-data，真实 MiniMax-M3 文本请求 **1次**，图片 **0次**，工具 **0次**。不是 stable 隔离入口或合成 producer。

- 实际启动配置为 effort=high、show_raw_agent_reasoning=true；实际 turn_context 的 effort 同样为 high。
- Runtime 返回独立 reasoning.content 一段（647字符）和普通助手正文；duration_ms=5480。summary 在实际 turn_context 中为 auto，未把全局 none 误报为轮次值。
- UI 运行时自动展示过程，完成后显示“用时 5秒”；点击可展开和收起，过程末尾与最终正文完整。隐藏的只是回答标题/icon。
- 正常退出 App/Host/Runtime 后，通过相同 canonical 入口重开，同一轮仍可展开过程；没有补发请求、改写旧历史或改权限。
- 截图与本机详细证据：`.local/native-reasoning-review-20260929/`。本次新会话保留在日常应用中供查看，未删除用户记录。

## 验证与审查

Host 配置、旧模式排他、managed 配置字节及回滚、v1/v2 high 派发、accepted 幂等重试、原生 summary/raw delta、Item/Turn 独立生命周期的 race 测试通过。相关原生投影、历史读取、权限和 trust 定向回归通过。Host make lint（gofmt/go vet/shell）通过。

Desktop 40项对话组件、1项原生日常环境、2项 candidate 测试通过；pnpm lint、cargo fmt --check、cargo clippy --lib -D warnings、标准前端与未签名 App 构建、docs:build通过。回答标题调整沿用本次已执行的1180×760亮暗组件验证；实际日常请求与重开在原生亮色应用验证。

实现后分离审查：核对日常/旧入口隔离、无权限扩大、原请求摘要不变、模型无过程不补造、Item完成不等于Turn完成、旧managed模板支持回滚、固定输入来源匹配。没有独立人工评审或生产发布声明。

## 未执行或未通过

- 未运行未筛选全库测试，其中包含用户禁止的攻击/权限破坏/强杀故障 fixture；以正常定向回归及真实日常请求验证，不伪报全库通过。
- 全量 Clippy 仍在既有 `src-tauri/src/chat/database.rs:8871` 的 `cleanup_complete.into()` 测试告警失败；生产 lib Clippy通过，此无关测试未修改。
- 全局 Skills HEAD 差异仍存在；canonical 使用项目已有的固定 Skills checkout 做严格校验，未通过刷新锁绕过。
- 历史原先未产生的过程不能补出；模型若未返回 reasoning/commentary，前端仍只显示耗时。输出语言及正文来自模型，不翻译或重写为伪造过程。
