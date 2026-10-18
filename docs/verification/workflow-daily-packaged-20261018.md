# 日常打包入口的工作流创建修复

`contract-impact = breaking`（仅本地部署默认值）：普通 local/demo_fast 入口默认从工作流展示模式切换为已有真实工作流能力，同时保留日常专家资源。默认启动新增已准备的本地工作流栈前置条件；缺少该条件的旧调用需显式 `YIJIE_WORKFLOW_ENABLED=false` 保持原展示模式，因此按最高风险登记。固定 API/bridge、native command、身份与凭据校验、存储格式均不变。不新增公共 wire，Contracts 变更为 N/A。继续消费原 `contracts/workflow-local.lock.json`；不代表生产激活或发布。

## 原因与范围

当前包填写有效名称和描述后，确认仍被 `!available` 禁用。启动器原本缺省 `YIJIE_WORKFLOW_ENABLED=false`，Vite 编译期与 Native 都未启用工作流。10 月 9 日仅通过显式启动参数恢复，后续普通重新打包再次退回展示模式。FEAT-158 的日常专家还沿用了隔离候选时期的工作流互斥条件。

## 修复

- 普通日常入口（开发与 packaged）默认启用工作流，显式 `YIJIE_WORKFLOW_ENABLED=false` 保留关闭；stable、隔离定时任务和隔离专家默认仍关闭。
- 缺省采用 Infra 已有 `environments/local/generated/feat-153/private/k-na.json` 路径，显式路径优先；原 owner-only、regular-file、大小、Native 校验全部保留。密钥不进入 Vite、Host、参数或日志。
- 复用原工作流与日常专家 Tauri overlays；日常应用身份、18081、Host/Home、专家资源与 Runtime 均保持。隔离专家不能连接日常工作流。
- 开发辅助入口同步组合日常专家资源，避免 dev 与 packaged 功能不一致。
- 启动器调用既有 Infra `workflow-up` 完成现有数据集的正常启动及带认证的 readiness；不自动 init、build、恢复异常退出或重建数据。Docker/既有资源/来源有问题时由原门禁报告，不能静默构建成灰色确认按钮。
- 表单校验、创建去重、未知回执查询与成功后进入原生画布继续复用原实现。

## 验证

执行无服务副作用的真实 Shell 配置选择回归、工作流边界、创建与回执定向测试、构建和实际 App 创建/进入画布检查。结果保存在 ignored `.local/workflow-create-packaged-20261018/`；构建不替代原生验收。既有全量测试中的攻击注入、权限破坏和强杀测试遵循用户长期禁止规则，不执行，不声称全量通过。

## 启动与回滚

首次准备仍由 Infra 原 canonical init/editor/build 流程负责；日常先正常启动 Docker Desktop，再运行 `pnpm tauri:demo-fast:app`。无需额外工作流开关。若需原展示模式，正常退出后使用 `YIJIE_WORKFLOW_ENABLED=false pnpm tauri:demo-fast:app`；不删本地工作流或任何数据卷。
