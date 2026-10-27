# FEAT-164 D5 日常启用接口

2026-10-27。Owner 本轮明确要求执行并完成 D5、解决阻塞。增量 contract-impact=semantic，权威为 Desktop 私有部署接口；公共 wire、Native command/数据库/权限策略、Host 与 Runtime N/A（均不改变）。Producer 是已授权的本机部署操作，consumer 是同源 canonical launcher/helper；Owner 为当前需求负责人。本记录先于实现定义范围，不代表已启用成功。

D3/D4 的 schema1 短期绑定完整保持：24小时内、零模型调用、无派发工作、D4必须暂停。schema2 仅用于 D5，采用独立 `feat164-daily-activated-homes-v2` policy，固定 identity、原Native/Host/Runtime Home、provider文件引用、workflow原来源以及精确制品回执。批准记录包含 Owner reference/时点、active、ADR-0022与single-owner-local-only范围、D4证据和本次激活预检摘要、允许K3.1 Pro、现有Native用户/计划授权策略、workflow existing-ready-only及本次验收0调用。

D5日常记录无每日过期，不冒称日常使用永久零派发。新的聊天和计划仍须产品原有用户意图/授权/grant；旧计划、unknown和旧K3不恢复、不重发。无登录项/后台常驻/自动恢复/自动迁移。它是本机Owner部署记录，不是替代Native授权的安全令牌。

新record只有编译回执明确支持activation policy、helper源码匹配时可用。旧候选无法读schema2；schema2不能进入D3/D4。source、receipt、Home、policy、摘要变化均拒绝，不能从最新目录自动挑选或自行刷新批准。`paused=true`允许用同一兼容reader暂停Kimi回退，普通入口明确false。停止未来日常入口可正常退出App后移走新授权文件/入口；不改数据，不回退到reader4或SQL37。

canonical installer 只创建本用户Desktop的新`.command`入口，不覆盖既有文件、App或签名产物。入口固定候选路径、绑定摘要与获核验的构建环境白名单，使用干净env调用原canonical `--packaged --kimi-k31-daily --reopen`；不含secret值。每次启动照常核验源码/包内文件/实例锁/真实workflow ready，依赖不就绪明确拒绝并交由既有依赖恢复流程，不隐式up或轮换凭据。

本次启用前新完整备份/inspection、原数据一致性/无派发检查及D4证据复核；使用已批准正常工具检查和新候选受限UI验收，0模型HTTP、无商家业务工具。正常退出和同入口重开观察绑定持久性，原数据、账本/预占及工作区保留。外观专项与搜索答案正确性仍排除。正式公开/签名发布不包含在D5本地启用中。
