# 创建工作流确认按钮与画布验证

日期：2026-10-09。`contract-impact = none`：本次恢复和启用既有 local/demo_fast 工作流入口，未修改业务源码、协议、权限范围或本地存储格式；创建使用现有原生接口。

## 原因

确认按钮要求名称和描述有效、创建结果不处于待确认状态，并且 `workflowLocalUiEnabled` 为 true。原客户端通过默认展示模式启动，`VITE_YIJIE_WORKFLOW_ENABLED=false`，有效填写后仍因 `!available` 禁用。原生端也要求 `YIJIE_WORKFLOW_ENABLED=true` 与既有 Infra 凭据文件，单独移除按钮禁用条件无法建立真实画布。

检查时 Docker Desktop 未运行；正常启动后发现六个原工作流服务容器此前退出码为 255。没有改变退出记录或直接绕过普通启动门禁。

## 处理

1. 通过 Infra canonical `workflow-recovery-plan` 创建计划 `d36c0228-bc8e-4105-aaf7-2c0b451fb547`，核对原容器、镜像、挂载和编辑器资源。
2. `workflow-recover` 完成四份停止状态数据副本、正常启动、只读存储核验及正常停止；原数据保留。随后 `make workflow-up` 完成既有迁移核验与服务启动，六项主服务健康，宿主认证 readiness 和画布资源检查通过。
3. 记录旧开发产物 SHA-256，通过应用 Cmd+Q 正常退出，确认 Desktop/Host 进程结束、18081 端口释放。使用既有 canonical 入口重建可复现的本项目开发 App 并启动。

后续正常开发启动需保留工作流 opt-in。先确认 Docker Desktop 正常运行且 Infra `make workflow-status` 返回 ready，再在 Desktop 仓运行：

```sh
YIJIE_WORKFLOW_ENABLED=true \
YIJIE_WORKFLOW_CREDENTIAL_FILE=/Users/jack/Downloads/Personal_Info/CrossBSD/yijie-infra/environments/local/generated/feat-153/private/k-na.json \
pnpm tauri:demo-fast:app
```

该参数只传既有凭据文件路径，不读取或打印密钥。此入口沿用项目已有工作流 Tauri 配置；没有修改默认启动策略、CSP、native command 或生产配置。已有客户端须正常退出后再启动，不能并行争用 Host 端口。服务未 ready 时按 Infra 生命周期检查，不能强杀、删卷或绕过异常退出门禁。

## 验证与范围

原生客户端中还原用户输入的「这是一个测试工作流」及原描述，确认按钮从 disabled 变为 enabled。只点击一次确认，真实创建 ID `7694577846827614208`，跳转 `/workflows/7694577846827614208`；Coze 画布加载完成并显示正确标题、已保存状态、开始和结束节点。未发布、试运行或执行商家/模型调用。客户端保留在此画布。

5 项创建定向回归通过；canonical 前端类型检查、构建及开发 App 打包通过，保留既有 chunk 体积警告。没有执行全量故障/攻击测试，安全跳过项目、原因与影响沿用 `docs/store-dashboard-plan-2.md`。未新增暗色/最小窗口验收，本次为原生 1268×780、100% 缩放下的创建链路验证。

证据位于 `.local/workflow-create-enabled-20261009/`：`before.json`、`after.json`、`creation-tests.log`、`native-build-and-run.log`、`before-disabled.png`、`confirm-enabled.png`、`canvas-created.png`。受控恢复原始记录与数据副本位于 Infra ignored 的 `environments/local/generated/feat-153/recoveries/d36c0228-bc8e-4105-aaf7-2c0b451fb547/`，没有复制凭据到交付文档。
