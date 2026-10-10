# 画布持续连接与节点字号回退

2026-10-09，用户明确要求：停留在工作流画布时保持连接，不再每五分钟弹出会话到期提醒；节点名称恢复原来大小并与图标垂直居中。

## 范围与兼容

`contract-impact = semantic`：改变 Desktop 对既有 native open/exchange 的调用时序和页面连接生命周期。此用户请求取代 FEAT-153/05 中“到期后手动重连”的产品策略，仅用于现有 local/demo_fast 开发候选。API、Rust command、Coze wire schema、权限、scope、300 秒原生私有凭据期限、epoch 校验与存储均不变。没有新增网络目的地或权限，也没有使用永久令牌。

权威实现为 Desktop 的 `src/api/workflow-editor-session.ts`；消费者是同页 `WorkflowEditorChannel` 和 `WorkflowEditorPane`。既有公共 wire 源保持 `contracts/workflow-local.lock.json` 中 `db4458fe94572c4df41a114005d54a049bb79b1f` / `1.4.0-local-candidate`（附完整摘要），没有新 schema，新增 contracts PR/tag 为 N/A。API/native 的请求响应意义和错误规则保持；仅 Desktop 在已授权页面生命周期内使用既有 open 操作重新核验主体和同一资源。此记录不代表发布或生产许可。

## 实现

- 页面初次连接后，在当前 native 凭据到期前 60 秒正常重开同一资源。新凭据只存在原有 native 内存中；旧凭据由既有 native open 撤销。
- 页面 MessagePort 绑定仍限定原工作流和当前页面实例；Desktop 内部映射到最新 native bridge/generation。iframe、编辑器实例、节点、面板焦点和未保存配置不重建，不把 native open 的草稿写回 iframe。
- 自动更新和 exchange 使用同一串行队列，等待已发出的操作返回后再更新。睡眠恢复后的第一条请求也先检查凭据；只有无 operation ID 的明确 preflight `session_expired` 可重开后重发一次，未知写入和已有回执不重发。
- 离开页面清除定时器、关闭旧端口和最新 native 绑定。离开时仍在创建的新绑定返回后正常关闭；不让旧页面继续发起操作。
- 删除 renderer 根据过期时间锁画布的轮询和到期文案。真正的服务、权限或协议错误仍显示恢复入口，不伪装连接成功。
- Coze 节点名字恢复 14px / 22px，图标容器用 flex 居中，消除 inline SVG 的基线留白。保留此前精简名称、次级文字色、间距与 12px tooltip。

回滚为恢复 Desktop 原显式重连策略及 Coze 原 CSS，使用标准本地构建和正常停止/启动；无数据迁移。新旧 API/native 和 Coze bundle 可独立回退。

## 验证与证据

普通内存回归覆盖多次空闲续连、写入期间等待、恢复后的读取、无回执的 preflight 重试、未知写入不重放、离页清理、真实权限拒绝停止自动重试。它们只使用虚拟正常时间和类型化普通响应，不修改真实系统时钟或注入运行环境故障。

最终测试、构建和真实原生停留结果记录在 ignored `.local/workflow-continuous-20261009/`。真实验证与单元测试分别记录，不把继承的 Coze 类型基线声明为零错误。用户禁止的强杀、权限破坏和攻击 fixture 验收不执行；未执行范围及影响保存在验证记录。
