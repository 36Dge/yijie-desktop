# 窗口侧栏开关与首页标语

日期：2026-09-26

- 隐藏 macOS 原生窗口标题文字，保留系统三色窗口按钮；使用 Overlay 标题栏，在其右侧放置唯一侧栏开关。
- 移除侧栏品牌区边界的旧圆形按钮。新建任务、任务对话和业务页面统一使用原有 sidebar store，支持 240px / 72px 切换、键盘操作、跨路由偏好和目录展开状态保留。
- 首页标语改为“让跨境经营更高效，让全球生意更进一步。”；中心品牌标题与侧栏 Logo 保留。
- 标题栏高 32px，左侧原生控件预留 96px；应用内容缩放时反向补偿标题栏缩放，避免开关偏离原生窗口按钮。
- 启动默认窗口为 1268 × 780 逻辑像素，主配置与本地工作流配置一致；最小窗口仍为 1180 × 760。该默认尺寸调整属于本地窗口配置的 semantic 变更，不涉及 API 或持久化数据格式。

## 边界与兼容

`contract-impact = semantic`：原生窗口呈现和 Chat 对既有折叠偏好的解释发生变化。API / Agent Host / 数据库和 sidebar.v1 存储格式不变，公共 contracts 引用为 N/A。权威配置是本仓 `src-tauri/tauri.conf.json`、`tauri.workflow-local.conf.json` 和 `capabilities/default.json`，使用 Cargo.lock 固定的 Tauri 2.11.5 窗口机制。

仅增加 main 本地窗口的 `core:window:allow-start-dragging` 与 `core:window:allow-internal-toggle-maximize`，供标题栏空白区域拖动和双击使用；没有远端 origin 授权，也没有文件、网络、凭据或任务执行权限变更。按钮是普通可访问 button，不是拖动区域。实现依据已安装 Tauri 的配置 schema 和 drag.js，以及[官方窗口定制说明](https://v2.tauri.app/learn/window-customization/)。

前端与标题栏配置须随同一桌面构建更新并重启。回滚使用上一应用构建即可；既有 expanded/collapsed 偏好继续可读，无数据迁移。

## 验证范围

34 项相关前端/配置测试通过，包含全局开关跨页面切换、输入节点保留、折叠偏好、目录状态恢复、首页动画与标语、主窗口配置覆盖关系。浏览器在 1180×760 亮暗主题检查新开关和我的店铺页，原按钮数量为 0、全局开关数量为 1；200% 缩放时开关仍为 x=96、32×32px。

2026-09-26 调整默认尺寸后，6 项窗口配置与启动边界测试通过，文档构建通过。通过应用正常退出关闭旧 Desktop、Host 和 Runtime，沿用工作流与定时任务选项，经 `pnpm tauri:demo-fast:app` 完成前端、Rust 和本地调试 App 构建并重启。启动原生日志报告 inner / outer 均为 1268 × 780、scale_factor=2；实际窗口已打开，Host healthz=ok、readyz=ready。日志位于 `.local/startup/20260926-131755-window-1268-packaged.log`，没有通过手动缩放窗口代替启动尺寸验证。

窗口拖动和双击尚未在真实新构建中操作验收。完整仓库门禁仍受既有 Skills pin 不一致限制；完整 Rust 攻击/故障注入测试按用户约束不执行，仅执行正常静态检查和相关非破坏性测试。
