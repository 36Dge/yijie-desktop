# 公开消息 r2 阅读与来源接入

2026-11-05，限定本地候选；复用原生消息和续行，不包含 diff。整体跨仓改动为
`contract-impact = semantic`，此 Desktop 增量不增加 IPC、字段或数据库版本。
Runtime 来源 `bab24532581249880a5c656f8f2a2ddb50d35836`，Contracts 来源
`486bce5f653bdc67a19a6698e87ad4cca0a21105`，Host 来源
`d0bf442f11853f9ca46248379d7094aca2d529cc`。来源校验仍由 canonical 脚本执行。

## 读取边界

真实 MiniMax C-N01 在一条原生 commentary 中写入两个阶段声明和完整答案。
r1 记录保持原样；`readablePublicCommentary` 仅在前端阅读投影中隐藏未引用的
独立内部控制行，所有可读正文保留。final、unknown、用户输入和 reasoning
不走这份历史修复；原始 Native 对象、保存正文、phase、Item ID 均不修改。
行内、引用、缩进和 fenced code 的字面示例保持可读。

r2 Runtime 负责新消息的流式和完成态校验。无可靠声明及无 Provider phase
时，完成态仍是 unknown。Native 已有的完整快照替换会清除 started 的暂定
commentary 阶段；新增回归验证该行为，不增加另一个状态机或伪造 final。

## 验证范围

- 63 项受影响前端回归及 5 项目录来源测试通过；lint/build 通过。
- 新 Native 阶段替换测试通过，Host 原生事件 → Native SSE/SQLCipher →
  正常重开 → Vue 阅读投影的既有跨仓闭环通过；零真实模型调用。
- 原 6 个会话、9 轮的所有记录摘要保持；加入两家 C-N01 后为 8 会话、11 轮，
  SQL 仍为 45。使用只读查询比对，没有清库、迁移、回填或重放生成。
- 实际界面历史清理、正常重开和外观核验需沿 `start-ui` 入口完成；具体状态
  见任务验收记录，不能用组件测试代替真实界面结论。

普通消息分组、开场先于过程摘要、折叠后独立正文及工具连续分组继续使用当前
阅读投影。源码和正常样本验证不代表两家模型已经生成合格开场/中途；真实候选
失败样本保留，生成覆盖率未资格化，不发布或声称任务全部交付。

原始 r1/r2 Runtime 制品均保留。回退需成套恢复匹配的 Runtime/Contracts/Host
来源，现有新格式数据不回退、不改写。其它工作区改动不属于这份来源提交。
