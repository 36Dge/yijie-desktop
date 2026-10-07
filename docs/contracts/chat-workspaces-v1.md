# 本地工作空间选择与创建 v1

`contract-impact = additive`。Owner/producer：Desktop Rust；consumer：同一应用的
Desktop WebView。权威源为本文件与 `src-tauri/src/chat/ipc/workspaces.rs` 的 v1 DTO。
公共 API/Agent Host/contracts pin：N/A，仅同应用本地 IPC，不改变任何现有命令或响应。
用户已明确要求创建目录并授权定义默认位置，沿用 `workspace.use` 和既有项目登记。

## 边界与数据

命令均接受既有 `{schemaVersion:1,requestId,contextId,payload}`，返回既有 v1 响应封装；
拒绝未知字段、未知版本、过期上下文与缺失权限。错误使用既有无内容的 ChatIpcError。

- `chat_workspace_catalog_v1`，payload `{}`；需 `read_projects` 和 `use_project`。
  data：`{rootPath:string,workspaces:Array<{project:ProjectDto,path:string|null}>}`。
  仅当前租户/用户的普通、未移除项目；自动任务目录仍排除。书签不可解析时 path=null、
  project.available=false；其他项目正常返回。目录根位置由 native 提供，不接受前端路径。
- `chat_create_workspace_v1`，payload `{name:string}`；需 `use_project`。
  data：`{status:'created'|'name_conflict'|'invalid_name'|'unavailable',workspace:Workspace|null}`。
  仅 created 携带 workspace，其余为 null；未知 status 在前端呈现可恢复错误。

路径只在本地 UI 内存中用于 tooltip/命名弹窗；不进入日志、错误、模型提示词或前端持久化。
ProjectDto 复用既有字段，旧项目列表响应不增加完整路径，旧前端继续兼容。

## 目录与持久化

固定根为当前用户 home 下 `Yijie/Workspaces`；叶目录为 NFC 规范化、去首尾空白后的名字。
名字 1–80 Unicode 字符、最多 240 UTF-8 字节；禁止隐藏目录、尾随点、路径分隔符、冒号及控制字符。
native 只接受单级名称，验证各目录为真实目录且不经过符号链接。独立安全测试 profile 的
既有目录限制不放宽，该 profile 下创建返回不可用。

原子 create_dir 拒绝任何同名现有文件/目录，绝不覆盖、合并或删除已有内容。成功目录使用
现有安全书签与项目登记，复用原有 SQLite schema（无 migration），按普通项目持久化并支持
既有置顶/移除；移除入口不删除物理文件。

创建不是自动重试操作；重复确认由 UI busy 阻止。同名重试返回 name_conflict，不创建副本。
若 mkdir 后登记失败，保留新目录，提示通过“打开本地文件夹”重新登记；不递归回滚目录。
响应丢失后，重新加载列表可找回已登记空间；未登记目录可经系统选择器恢复。
降级旧前端仍可读/使用/移除新登记的项目，用户目录保留，不要求数据回滚。

## UI 与验收

工作空间入口显示可搜索的已保存目录、选中标记、“新建工作空间”、“打开本地文件夹”与
“不使用工作空间”；列表项/选中入口悬浮显示真实路径。已有会话保留只读目录。
创建对话框输入名字并确认后，目录登记成功才关闭弹窗并成为当前新任务工作空间；失败
保留名字、显示可重试提示。权限/账号/路由切换后丢弃旧异步结果。

验证使用普通名称、空名称、重名、成功目录与书签往返、刷新后重读、上下文切换和 UI 测试。
不执行权限破坏、强杀、攻击载荷或故障注入测试。
