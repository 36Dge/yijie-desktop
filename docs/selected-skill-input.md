# 显式技能输入与提示词收敛

2026-11-04，Owner 选择“只在明确选择或点名时加载技能”。本轮最高
`contract-impact = breaking`，来自私有数据库 SQL 43 前向 reader guard；
新增 HTTP text.skills 是 additive，不改变旧请求或历史 ChatMessage schema。

技能选择通过既有文本输入携带 Contracts 生成的 `{id, version}`，不携带文件路径、
正文或新的提示词模板。Native 在原提交事务中写入独立
`chat_message_skill_selections` 元数据表，并把身份加入有选择输入的摘要。
没有选择的历史摘要、正文和展示仍保持原值；重开、重试与 operation replay 保留
原身份。当前模型、市场及专家路径共用这一输入，不增加第二套执行或重试机制。

Host 校验当前版本、有效安装回执及原生已启用列表后，转交既有
`UserInput::Skill`；原生加载器负责正文、同名处理和去重。受管线程使用原生
`skills.include_instructions=false` 省去常驻目录。手动输入 `$skill-name` 仍走原生
点名加载；存在同名技能时优先使用界面选择以保存准确身份。旧历史中已有目录
不会被删除，也不能保证重开后立刻从上下文消失。

来源与 Owner：Agent Host OpenAPI 为唯一身份权威；Contracts
`633aa9eee300a3123c1574306234682059f557ec` 提供生成输入和原生 schema 投影；
原生 `yijie-codex@55b4e51049d6f4fc0af4b35f12832357f5e4ea06` 保持不变。
Host/Native 为 provider，renderer 为 consumer；本次跨仓实施依据 Owner 的复审
实施指令和显式技能选择确认。没有新增 command、capability、权限或网络目标。

入口只有当前 Kimi candidate 来源校验通过后才设置
`VITE_YIJIE_NATIVE_SKILL_INPUT_ENABLED=true`。旧入口保持 false，不能向旧 Host
发送新字段。激活按 Contracts→Host→Native→renderer 顺序；固定开发入口与原日常
Homes 不变。SQL 43 只增加元数据表，不改写或清理历史，不自动重放未完成任务。

回退时可关闭 renderer 开关，但已升级数据库必须由支持 SQL 43 的 reader 读取；
不能降低 user_version 或用旧客户端覆盖新格式。候选 reader 正常重开验证保留旧
文本、旧摘要和新技能选择；非候选 reader 的原有前向版本拒绝保持，不放宽门禁。

已验证选择到 wire、普通/模型/市场/专家输入投影、接受操作重放、版本冲突、迁移
及正常重开。Runtime 回环验证同名消歧和配置热重载后预算不重置。测试未使用真实
供应商请求；未运行强杀、权限破坏、恶意归档或攻击注入验收。现有 UI 改动单独
保留，不纳入本次修复提交。完整日志位于工作区 `.local/diagnostics/2026-11-04-prompt-chain-implementation`。
