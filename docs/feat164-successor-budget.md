# FEAT-164 schema3 后继验收账本

2026-10-26 Owner已批准新增1次并额外新增2次；本轮最多3次、累计5次模型HTTP，累计30元、输出8192、失败即停，不使用搜索/图片。每个模型HTTP（含辅助/标题/工具后续）都计数，不自动重试。contract-impact=semantic限于私有验收文件；不改变产品wire、SQL、权限或Runtime，旧schema1/2解释不变。

`feat164-budget-meter.py --create-successor-from <old> --successor-authorization <approved.json> --ledger <same-parent>/g2v-real-budget-ledger-r3.json`是无凭据/无HTTP的离线操作。授权为闭集字段与本次精确ID/日期/次数/金额，绑定旧文件SHA；源与目标分别加锁，固定同目录唯一后继名。必须为停止且已耗尽的schema2，两行保留且第二行为真实成功终态。旧文件不改；完整旧JSON、解析状态与两行摘要随新回执保存并在重开核验。已有后继只幂等读取，不覆盖、不补额度；新unknown/inflight、失败/不完整或计量拒绝均停止。

预算在发HTTP前串行预占14.188544元；只有明确usage才按13/68保守费率释放差额。金额不足即使次数有余也拒绝；缓存按全价输入。schema3失败即停与旧单次续验语义分别保持。HTTP/SSE仍透传原响应字节，原8192与移除未定价原生搜索的验收覆盖写入账本；此路径不证明原始默认参数或真实搜索能力。

新只读判定器`feat164-successor-verdict.mjs`同时核对旧schema2解释、原始JSON摘要、完整旧前缀、新增1至3个成功请求、逐行费用/总上限和封闭App观察。旧PASS不能替代新HTTP；真实UI/保存/重开/无补发/正常清理仍必需。Python写入与JS读取有普通临时账本互操作测试，包含中文Owner。无故障注入/强杀/权限破坏或真实请求。实际执行记录见元仓FEAT164的37号报告；单元PASS不等于App或真实G2V通过。
