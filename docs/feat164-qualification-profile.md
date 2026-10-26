# FEAT-164 固定离线 App 验收身份

2026-10-26。Owner已批准复审后执行独立旧数据验收方案。增量contract-impact=semantic：权威源为Desktop私有部署/存储入口；公共Contracts N/A（无wire/schema变化），整项breaking不变。Owner及唯一consumer为段成威。

canonical新增 `--packaged --feat164-qualification`，可随后选 `--kimi-k31-pro`。旧模式为原非candidate功能构建/旧Runtime，新模式为现有candidate/r5；二者以同一固定 `com.yijie.ai.feat164-qualification-v1` / `易界 AI FEAT-164 验收` 身份读写各自正常Application Support下的 `demo-fast-model-candidate-v1`。没有路径参数、HOME重定向或日常数据复制。沿用原全局单实例锁，不新增并发权限。旧/新必须在不同干净构建目录生成、保留独立回执，不能覆盖已有候选binary。

qualification仅接受原已支持的 `http://127.0.0.1:18083/v1` 本机模型地址。验收由无外部客户端的有限合成fixture提供响应，不使用真实凭据。普通/日常入口不变；旧模式关闭市场/专家/媒体/工作流，先自然生成SQL29聊天/计划。新模式可按既有四组合装配，均保留完整来源检查。旧模式仅新增独立Host输入锁，经原freeze/check验证，默认锁不改。

`--prepare-only`只构建，`--reopen`要求同构建回执；新模式的 `--migrate-isolated-k3 --reopen`复用维护入口，精确编译身份选择固定根，凭据清空，在auth/worker/Host/Runtime/UI之前退出。保留完整备份、静止准入、旧schema guard、授权保护与正常close。没有新IPC/capability/plugin/依赖/Runtime修改。

顺序：旧App正常生成并正常退出 → 完整保留快照 → 新App显式维护 → 新App正常启动，以UI明确选择/恢复/取消及计划重新审阅授权 → 正常退出/重开。升级后不启动旧writer；回退是保留兼容candidate reader且暂停新执行。日常迁移、发布、真实供应商调用不在授权内。

资格只能覆盖实跑来源和场景；锁屏时UI记NOT RUN，合成结果不代表供应商真实质量。原候选unknown选择、已消耗grant、旧账本和预占均不处理。

来源复审补充：旧Runtime投影历史base_commit缺少后来加入的被审计源文件，已由原Contracts generator唯一刷新至完整11fd450；旧artifact/patch/schema/Go保持。来源ca06d0999c9a08afe80ab3f34a537d492b830ac7 → Host8cd6bccbdc1ac3906aea53d95441299f7cfefcce（仅consumer元数据），Desktop经原sync更新consumer并冻结独立legacy Host锁与K3.1 Host锁。r5投影仍5b5dad，旧默认Host锁未重写；不能将独立入口资格扩成日常资格。

正常自然旧App实跑后发现Native未传递既有Host前身许可。仅固定qualification identity的编译candidate显式 `YIJIE_KIMI_K31_ALLOW_MANAGED_PREDECESSOR=true` 可传递；其它编译identity不接受qualification flag，原普通候选不默认允许。Host仍校验冻结旧配置对，未决配置拒绝不覆盖；该许可不选择thread、不发送turn、不授予计划权限。此为本轮固定旧→新资格接线，Runtime/Host实现不改。

自然旧数据还揭示启动恢复将已退役K3终态历史当活动模型resume，导致全局context失败。复用原只读历史谓词：仅candidate编译、v2目录、精确旧K3身份且无活动local/runtime/operation三ID时跳过 eager resume；活动/未知记录检查保持，不能自动选新模型或发turn。后续必须经显式模型选择回执。
