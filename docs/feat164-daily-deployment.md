# FEAT-164 日常 K3.1 部署候选

2026-10-26，Owner已批准第50号限定8文件实现及离线验证，**不批准本阶段启动、打开或迁移真实日常库**。本实现位于独立开发目录；原日常入口、其它需求改动、旧App及全部账本保留。Runtime仍为既有r5，未修改核心/补丁。

增量contract-impact=semantic，权威为Desktop私有部署与既有存储迁移；公共wire/schema N/A。整项FEAT-164保持breaking，固定Contracts、Host、Runtime和资源来源不变。本文描述可供后续明确授权使用的入口，不宣称已经部署或真实日常验收。

## 显式入口

在独立源码目录构建，不启动App、workflow服务或模型：

```sh
bash scripts/run-local-demo-fast.sh --packaged --kimi-k31-daily --prepare-only
```

日常选择使用完整media组合，保留market、expert及媒体功能；workflow默认启用，尊重明确的false选择。`--prepare-only`保留workflow编译overlay和前端配置，但不读取workflow凭据、不调用Infra workflow-up。模型provider文件只按既有构建装配规则处理，不发送请求。

日常候选使用普通编译identity `com.yijie.ai`，显式`YIJIE_FEAT164_DAILY=true`、K31候选编译特性和精确local/demo_fast/model、scheduled_daily=true/candidate=false；Native在启动之前重新验证。其它identity、混合隔离flag、缺少日常选择的K31 daily二进制拒绝。普通旧入口及两个隔离identity的规则保持。

Host/adapter构建输出与回执位于独立源码`.local/feat164-daily`；App位于该源码自己的标准Tauri target。不会覆盖其他源码目录的App或已签名产物。回执绑定daily identity、编译输入、workflow配置、runtime/host/worker/resources；`--reopen`要求同一回执，不能复用隔离候选回执。

## 维护与正常运行是不同动作

仅在后续批准真实日常备份/预检/写入范围后，才可使用：

```sh
bash scripts/run-local-demo-fast.sh --packaged --kimi-k31-daily --migrate-daily-k3 --reopen
```

维护命令的最小env不含模型或workflow凭据；同一canonical二进制在auth、DatabaseWorker、Host、Runtime、worker和WebView之前返回。固定路径仅为`com.yijie.ai/demo-fast-v1`，无自选数据路径。保持原全局单实例锁、无打开句柄、owner及canonical路径校验；日常父目录既有0700/0755可用，chat和secrets仍要求0700，不通过chmod改变旧权限。

复用原加密DB/WAL/SHM及本地密钥的完整备份、只读副本预检、正式migration和计划退役事务。只接受已资格化的SQL29/37或38—41当前版本；unknown、pending/inflight、reservation、占用grant、非终态/不可读native事实继续拒绝。旧grant消耗不清零，unknown不重发，失败不自动回写备份、不手工checkpoint、不清WAL。

日常原生装配允许把既有受审predecessor许可传给Host，Host仍精确验证冻结旧配置对；该许可不创建turn、不选择旧线程、不授权计划。迁移后必须显式重审旧K3计划并取得新授权。正常运行的workflow凭据和服务ready要求不因prepare-only例外而降低。

## 离线验证边界

测试用既有正常旧producer在新保留目录自然创建SQL29/37和合成计划，然后分别验证隔离/日常维护：正常锁竞争拒绝、保留occupied状态、原备份逐字相同、旧事实/授权保持、重复维护及兼容reader正常重开。测试中的Application Support根位于独立audit目录，由私有测试函数消费；产品CLI不能选择路径，不重定向HOME、不接触真实日常数据。有效0755父目录从创建时设置，不制造权限故障。

同构建准备、纯入口配对、feature-off拒绝与原隔离回归分别留证。没有强杀、攻击/故障注入、可执行替身或真实模型调用。完整App日常启动、workflow实际服务、日常数据迁移和FEAT-164完整S4/final仍需后续适用验收。

## D1：已批准的部署绑定与只读 ready 修正（2026-10-27）

Owner已批准第59号D1限定范围；D2—D5、实际日常数据及真实模型调用仍未授权。增量semantic，权威为本仓私有部署策略`feat164-daily-existing-homes-v1`；公共wire、Native command、SQL、Runtime/patch和Infra实现不改。旧c29f7e0及所有原制品保留，新的prepare-only资格另记。

制品仍在新源码`.local/feat164-daily`，但prepare-only不读取部署记录、不创建Host/Runtime Home，不读取真实日常数据库或workflow凭据、不启动服务。非prepare daily入口必须`--reopen`，并在任何凭据/构建/服务操作前验证独立部署记录；原Home缺失不创建、不修改权限、不复制到候选目录。普通/隔离入口保持原行为。

D2以后才可产生真实绑定文件；本轮只有正常合成目录测试。部署记录是本机Owner批准范围的审计绑定，不是密码学签名，也不代替D2实际备份/只读预检、静止/单实例及数据freshness检查。原启动路径若不同于已审`.local/demo-fast`布局，停止另报，不扩成任意路径迁移器。

私有JSON记录schema_version=1、feature=FEAT-164、policy=feat164-daily-existing-homes-v1、identifier=com.yijie.ai；其余必需字段：

- `receipt_sha256`：当前独立canonical daily构建回执SHA；回执含同策略及helper的构建输入hash。
- `native_data_directory`：真实用户HOME下固定`Library/Application Support/com.yijie.ai/demo-fast-v1`，不作为自选DB路径传入Native。
- `original_desktop_root`、`host_home`、`runtime_home`：已确认旧Desktop规范路径及其`.local/demo-fast/host-home`、`codex-home`；候选与原目录不得重叠，Home须既有0700/当前owner。
- `providers`：`minimax_key_file`和`kimi_key_file`仅引用原兄弟Host `.local/secrets`中的原文件，不含Key。
- `workflow`：`infra_root`为原兄弟Infra；`source_sha256`固定已审workflow-local.py；`credential_file`仅原`environments/local/generated/feat-153/private/k-na.json`。
- `approval`：`stage`精确D3/D4/D5，短`reference`，带时区`expires_at`（剩余有效期最多24小时），`preflight_sha256`，`model_http_limit=0`、`no_dispatchable_work=true`。这些字段记录已取得的授权/实际预检结论，不能用合成值授权真实数据。

真实操作还须显式给出`YIJIE_FEAT164_DAILY_BINDING_FILE`、该文件精确`YIJIE_FEAT164_DAILY_BINDING_SHA256`及`YIJIE_FEAT164_DAILY_STAGE`。文件必须既有私有常规文件、不可带符号/硬链接；解析不接受重复/未知顶层字段。D3只准维护，D4/D5只准正常启动；D4要求`YIJIE_KIMI_K31_EXECUTION_PAUSED=true`，D5也必须明确true/false。Kimi暂停不能替代全模型无可派发工作检查。

维护仍不读取workflow状态或启动服务；正常daily在exact receipt检查后才执行只读ready helper。helper读取固定SHA的真实Infra源码，在内存执行该已审模块，限`read_state/all_containers/validate_owned/observed_ready`链；不调用`record/status/up/init/build/render/credentials/verify_editor`。`observed_ready`会由Infra自身验证K_NA/K_AC配对和epoch，再进行原鉴权GET及editor观察；凭据不返回Desktop/Host/renderer，不导出环境/日志。模块以`-B`运行、不写pycache；不读取数据库、不启动/停止/重建容器、不做migration。只有明确ready=true才退出0；任何错误只返回无敏感详情的固定失败信息。

D1测试中的SQLite历史是普通合成记录，只验证绑定后读取原Home及字节保持，不冒称已验证真实Host Store或日常数据库。workflow测试是进程内正常状态输入，未调用Docker/HTTP，不能标记真实日常服务ready。新的实际daily backup/迁移/启动始终需D2—D5各自授权。
