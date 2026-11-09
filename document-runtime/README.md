# FEAT-171 应用内置文档环境

九格式：TXT、Markdown、HTML、CSV、JSON、DOCX、PPTX、XLSX、PDF。`helper/document_cli.py` 与 `guides/` 是应用资源，不注册技能，不依赖专家/连接器，也不使用 Codex 应用缓存。生成入口仍是 yijie-codex 原生执行；看页图仍用原生 `view_image`。

依赖源锁见 `dependencies.lock.json`，对应源码归档锁见 `sources.lock.json`。源锁中的 NOT RUN 等字段保留 D0 当时的来源调查状态，实际结果以每次 `.local/document-bundles/current.json` 指向的构建回执和 manifest 为准，不能反向把源码调查记录当制品资格。

规范入口：

```sh
python3 -B scripts/build-document-runtime.py assemble
python3 -B scripts/build-document-runtime.py sources
python3 -B scripts/check-document-runtime.py
python3 -B scripts/build-document-application.py
```

这些是构建机命令。安装产物不需要 Python、Node、编译器、系统 Office、源码仓库或 Docker。完整应用候选由 Tauri 构建，内含 Host、原生 Runtime、artifact MCP、文档包；入口 `src-tauri/src/document_application.rs` 在创建线程前绑定经编译摘要固定的包。普通文档启动不调用 workflow ensure/ready；已有开发入口保留，可用 `YIJIE_FEAT171_DOCUMENT_RUNTIME=true pnpm client:dev` 选择同一包与已冻结的文档候选来源。没有自动安装、替换日常应用或发布。

包内唯一对外文档解释器是源构建的 CPython 3.12.16。固定十二个 Python runtime packages；构建字体的 fonttools 不进入运行包。移除自有 Python 的 ensurepip、venv、Tk/IDLE 和辅助命令入口；无 pip/bootstrap 或用户 site 回退。LibreOffice 官方 26.8.2 arm64 发行件的可执行字节保留；仅在新的应用资源装配中加入私有字体，不覆盖上游已安装/签名应用。LibreOffice 自身内部包含的 Python/Java 等组件保留其来源与许可证，不作为文档生成环境暴露，也不启用宏/Java功能。资源重装配后不能声称继承上游完整签名；当前产物是未签名本地候选。

受管临时状态位于应用创建的 `/private/tmp/yijie-documents-<uid>-<scope digest>`，使用平台已有临时目录权限，不为文档额外加入工作区外可写根。源码开发入口与安装入口使用同一计算方法。Native 原件仍保存在原 SQLCipher 存储；临时输入仅在原有 outbox/会话校验后复制，最长24小时。缓存过期或正常重开后，提交新一轮时可从同会话已提交且未过期的最近10个原件恢复原路径；不恢复未提交/取消的草稿，不延长7天主存储期限。JSON 原件和 `.receipt.json` 元数据分名，避免冲突；Host 在原请求幂等判断之后核验 operation/attachment/size/SHA/expiry，不改旧摘要，也不重发已接受请求。

LibreOffice 的平台 IPC 不在默认原生 workspace sandbox 内。helper 在这种上下文启动 Office 前返回 `native_platform_approval_required`；指南要求走原生单次命令审批。拒绝/取消保留原件；不自行改变权限模式、永久规则、网络配置或转交 Host 执行。已经具有对应原生权限时直接按该权限执行。转换子进程用独立 profile，等待正常退出；取消、软截止停止后续阶段，不杀进程。Native 退出所有者也等待预览工作结束。

文档文件10MiB、文本1MiB、50页、10sheet/12000矩形单元格/32可视区域；单任务QA128MiB、共享QA512MiB，临时状态全局2GiB准入；重任务并发1、队列8。原生预览与模型QA共用转换锁和有界QA索引，过期只清理能够核对拥有权的派生目录。未知/更改的目录保持原样并停止准入。索引/回执是临时证据，不能作为业务状态或权限来源。

DOCX/PPTX 默认版式，正文可切换；XLSX 默认数据表，支持版式/图表；有界文本和CSV可继续阅读。版式暂不可用时展示明确标记的正文投影。复用现有v12文件事件/资源/ACK、Native持久保存和7天保留，不新建数据库表、版本树或执行ledger。每次编辑写新路径，新旧原件独立。`get_artifact_status` 的 committed 只来源于同代际 Native ACK，unknown 不触发重做。

旧源码开发客户端的 Native 历史不能自动配给新的空 Host/Runtime Homes。完整包入口会拒绝这种不匹配，日常开发仍用原入口及原Homes；已安装候选正常更新继续沿用自己的应用目录。签名、公证、发布、干净macOS14/8GiB现场、真实模型与实际GUI全链验收分别记录，未通过不得标成D4完成。

2026-11-09 复审：创建/重算先校验同目录暂存文件，再以不覆盖的原子操作发布最终路径；失败不留下占用目标名的半成品。文本模板保留表格；XLSX 允许 Calc 等价的跨表引号规范化，并区分显式空文本公式缓存与缺少缓存。快速模板按各格式指南说明字段；复杂对象仍使用同包库。

Native 版式缓存按 bundle、原件摘要和唯一 attempt 隔离，schema 2 标记是否已结束。已确认结束但未生成有效预览的任务保留诊断、允许新尝试；未知拥有权（包括旧 schema 1 的不完整缓存）不清理、不猜测退出，需先核实原所有者。TTL 仅清理已确认结束且内容符合拥有权的派生文件。XLSX 专用字体不可用时保留已解析的只读表格并显示降级提示，不回退到系统生成环境。输入副本重用只计新增字节，收据原子续期至主存储期限与当前24小时的较早值。
