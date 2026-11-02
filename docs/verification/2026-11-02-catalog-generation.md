# 连接器目录生成一致性修复

## 范围

`contract-impact = none`。本次只调整 Desktop 构建时的目录来源复核，以及相应回归测试。目录内容、两份 candidate 记录、API / Agent Host wire、Native IPC、供应商资格、连接器安装与权限、数据库及历史记录均未修改；Desktop 运行时没有行为变化。公共契约更新和迁移为 N/A。

复用两个已有入口 `scripts/sync-market-catalog.mjs` 和 `scripts/feat164-market-catalog.mjs`，由 `scripts/market-catalog-source.mjs` 共享既有 schema 验证、目录约束和来源比对。没有引入第二套目录、弱化固定开发客户端的精确来源要求或替换生成数据。

## 根因与证据

默认生成器原来在写入和 `--check` 时都用 Connectors 当前 `HEAD` 重建 `base_commit`。因此 Connectors 后续仅修改运行时来源等无关文件时，目录即使完全没变，Desktop 检查也会失败。

本次逐字比对以下四份数据：

- Connectors 工作区 `catalog/market-catalog.v1.json`。
- Desktop `contracts/market-catalog.json`。
- 旧生成基线 `ab1f8328ff50dab256b23f51d49157278421fd35` 中的目录 Git 对象。
- 当前已资格化基线 `4c650237a5e0d30ad3b95882b90869435b0f17a7` 中的目录 Git 对象。

四份均为 revision 11、61 项、31,506 字节，SHA-256 均为 `55ec42e1965a7ecdfd17771af299afea786bc74a175ab4f021afdf8d538ab70d`。旧算法重建的 candidate 仅 `base_commit` 不同。目录及两份 candidate 与本仓 `HEAD` 中的文件仍逐字相同，见 [来源比对](evidence/2026-11-02-catalog-generation/source-evidence.json)。未刷新哈希或修改 candidate 让检查通过。

## 修复规则

遵循现有本地 candidate 机制：`base_commit` 表示生成时的工作区基线，并非始终等于检查时的仓库 `HEAD`，也不把工作区文件冒充不可变发布源。

| 场景 | 行为 |
| --- | --- |
| 默认 `--check` | 复用记录中的完整基线；验证该 commit 和目录 Git 对象存在，重新计算当前源文件摘要并逐字比较生成副本及完整 candidate。只读，不修复文件。 |
| 源目录未变，显式执行 sync | 保留原基线，字节相同的输出不重写，避免时间戳及下游来源记录无意义变化。 |
| 源目录真实改变 | `--check` 失败；只有显式 sync 才更新副本、源摘要和当前生成基线，仍为 `local_worktree_candidate`、`release: false`。 |
| 固定开发客户端的 FEAT-164 入口 | 继续严格要求指定 `HEAD`，并逐字核对该提交中的 Git 对象；仍使用原有独立 candidate。 |

目录 schema、revision、61 个唯一 ID、服务名与图标 ID 对齐、未资格化服务不可被标记为 available、blockerCodes 等检查全部保留。两种入口共享校验代码，避免以后再次分叉。

## 回归与完整检查

新增 5 项正常回归，用临时 Git 仓库和现有公开目录验证：无关提交不产生漂移、无变化 sync 不重写、真实源文件变化仍失败、生成副本与记录分别校验、不可变来源要求保持，以及真实候选记录检查前后字节不变。没有使用伪造可执行文件或故障/攻击注入。

- `pnpm generate:check`：通过全部生成与下游消费检查。
- 两个目录入口的 `--check`：均通过。
- `make lint`：通过生成检查、ESLint、Vue/TypeScript、Rust fmt、Clippy all-targets。
- `make build`：通过。保留既有的大 chunk 提示，没有生成安装包。
- 完整前端测试：1,977 通过、32 失败、16 skipped；另有 7 个 Node 测试文件被 Vitest 错误识别为无测试套件，因此文件级结果为 234 通过、22 失败。
- 上述 7 个文件使用它们原本声明的 `node --test` 独立运行：26 通过、0 失败。
- 连接器相关 10 个前端文件（生成器、目录客户端、管理页、选集、聊天入口）共 91 项全部通过。
- 将其余 15 个失败文件独立运行，不加载本次目录生成测试：相同 32 项失败再次复现，另有 205 通过、4 skipped。
- Native 全量允许执行的单元测试正常结束：591 通过、29 失败、14 个原有 ignored、27 个按安全清单 filtered；连接器命名空间的 57 项全部通过。随后分别执行 bin 和 doc 目标，均正常完成，各有 0 项已注册测试。

完整检查不是全绿。已定位的其他问题包括：Node/Vitest 测试器混用；ECharts 校验器不接受锁文件里已登记的 patch 后缀；旧 AJV 测试未登记当前 schema 的扩展注解；macOS 临时目录别名与真实路径校验不一致；旧模型开关、组件文案/布局及帧调度假设与当前实现不一致。本次未通过删断言、换 pin 或改无关产品行为使这些检查通过。逐项名称及独立复现结果见 [回归结果](evidence/2026-11-02-catalog-generation/regression-summary.json)。

Native 失败输出包括旧本地 HTTP fixture 不接受当前 `/v11/agent-sessions/.../events`、OrchestrationUnavailable、Markdown 预览支持范围断言、未发送任务终结断言以及模型迁移失败。它们不经过目录生成器；本次没有修改相关 Rust 源码或目录数据。仅能确认连接器专项回归通过，不能据此宣称其他功能的全部回归通过。具体测试名、原有 ignored 和各项统计均在回归结果 JSON 中保留。

`pnpm docs:build`：通过，保留既有的大 chunk 提示。

## 未执行项目及影响

按用户级 AGENTS.md，跳过会故意放宽文件权限、创建替代可执行文件、触发强制进程清理、注入 XSS/路径穿越/跨权限样本，或构造危险 ZIP/PDF 的旧测试。精确文件、测试名称、原因见 [安全跳过清单](evidence/2026-11-02-catalog-generation/safety-skips.json)。Vitest 原有项目排除项另列，不能算成本次通过或新增安全跳过。Native 名称中某些仅在额外 feature 下注册；实际 filtered 数量以本轮 Rust 输出为准。

影响：不宣称重新验证这些故障或攻击场景。正常目录生成、消费者、数据库正常读写、组件和其他允许的测试仍运行；源码生成检查与静态检查没有被绕过。未修改测试源文件来隐藏失败。

本次没有重启或强杀客户端，没有外部模型/供应商调用，没有数据库备份、迁移或客户端安装包。使用固定开发目录的编译缓存，原始日志和命令保存在 `.local/development/catalog-generation-20261102/`。

全量验证正常结束后，按文件和目录创建时间确认，仅移除了本轮新建的 `target/debug/.fingerprint`、`deps`、`incremental`；固定 target 的磁盘占用从约 7.1 G 回落到 1.3 G。开发客户端可执行文件清理前后 SHA-256 一致，日常客户端的共享增量构建缓存未改动。见 [本轮测试缓存清理记录](evidence/2026-11-02-catalog-generation/validation-cache-cleanup.json)。
