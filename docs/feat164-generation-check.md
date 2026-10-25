# FEAT-164 只读生成检查入口

2026-10-25。contract-impact=none：仅增加本地验证编排，不改变Desktop/Host/Runtime的产品接口、默认启动、数据/重放、授权或部署配置。整个FEAT-164仍breaking；无需新的公共schema/tag。本轮用户“执行后续方案”授权继续RCA后的离线验证和本地提交，真实模型HTTP仍0。

通用`pnpm generate:check`保留原行为和旧锁，原三次FAIL保留，不因本入口通过改写历史。新增显式`pnpm generate:check:feat164 /absolute/new-output-directory`：必须从已提交干净资格树运行，预检所有来源、版本和真实目录，再顺序执行已审计只读leaf。失败即停，无自动重试、fetch、安装、构建、App/Runtime启动或模型请求；只新增诊断目录。

与通用检查一一对应：public API、Host v2/v3/Skills/v4、Native timing/purpose/conversation、scheduled IPC v1、market connectors/selection/provider/host原reader均保留。唯一替换是目录provenance：通用`sync-market-catalog`的旧e279 working-tree锁改由既有`feat164-market-catalog --check`检查精确1f15726锁；同一catalog源数据仍必须等于commit，结构和60项限制不变。额外检查Kimi r4/runtime、chat-models-v2、scheduled IPC v2和既有kimi build candidate（含计划v2与market/host/experts v2的双consumer）补足本Feature写端。检查器不能据此声明专家/媒体资源、App、G2V或发布资格。

来源：Contracts1b357cce0575c492f3715b316ee5f254051acf80、Host090c2dbeeeceb0fc87e576d8e13f5c339bf106f0、Connectors7ea3df41818fd69f4736722d01f0686d584d1a71、Runtime a28130abb13d0f99a00107cd513a653bae878b77、Skills595c927ae101d3d31c234f60565041eee0864680。历史Host1b7bfd1/96b1fa1和Skills10c45be还须有既有resolver认可的固定checkout。本入口不改变任何lock或在失败时重生成快照。

新增发现：Node从符号链接脚本取得真实路径，部分generator按脚本所在仓库推导sibling consumer。若Contracts链接到上一批资格树，可能验证上一批Desktop。为避免错误资格，本入口要求Desktop/Contracts/Host/Connectors位于同一个真实父目录且各自不是指向别的资格树的仓库链接；Runtime/Skills只读producer可引用已核实干净精确来源。旧批次没有相关生成物变化，但不能据此继续放任错误指向。

实施/验证顺序：配置与执行计划的普通结构化单元检查 → 本地固定脚本源 → 一次完整新入口验证并保留每项日志/精确源 → S3原5项领域/重开回归及计划UI重新选择/单独授权。当前App数据中自然保留的计划为K3.1，不伪造其曾是K3；旧K3迁移只按安全Native测试的实际范围判定，未自然存在的旧K3 App路径继续单列未验。

回退只移除新增alias/检查文件，产品及旧检查行为不变；新检查PASS不替代通用默认入口、不替代剩余S4/完整G3。不得通过此入口执行历史攻击/故障fixture，相关完整测试仍单独报告未运行。

S4I：Connectors pin更新至7ea3df41818fd69f4736722d01f0686d584d1a71，仅新增r4 wrapper允许项，codex-rs树755f32c45a4c30e805e3c7fe1db89dcb4dcc6e41和catalog字节不变。全目标media构建发现并修复该来源缺口；原S4h仅ordinary生成资格，不曾验证Worker构建。
