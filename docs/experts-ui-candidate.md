# FEAT-158 专家 UI：本地候选

> 2026-10-13最新状态：本功能已通过工程D4，并经Owner授权接入canonical日常客户端，保留原数据和历史；启动/兼容回退方式见 [本地开发](local-development.md)，日常实际证据见相邻元仓FEAT-158的15记录。下文默认关闭、未完成等措辞保留当时阶段语义；AC-007已移除、外观验收按用户指令跳过。

状态：**2026-10-11，第二阶段候选默认关闭。隔离 packaged App 第三次运行已验证资源重开 ready、草稿召唤/保留/移除、确认默认焦点及 1180×760 亮暗布局；实际模型 turn 为 0。附件流程因 Mac 锁定暂停，本轮 App 仍运行；真实模型相关 Must、D4 与发布资格未完成。**

## 开关与当前范围

只有 `VITE_YIJIE_ENV=local`、`VITE_YIJIE_LOCAL_PROFILE=demo_fast`、`VITE_YIJIE_EXPERTS_ENABLED=true` 同时满足时展示专家候选入口。权威判断在 `src/authorization/experts-ui-config.ts`；缺省及 public/production 不启用。关闭时侧栏仍为“技能”，`/plugins` 使用原技能页；无专家上下文时原发送参数和路径不变。

开关只展示 UI。召唤还必须取得 Native `CatalogSnapshot.executionAvailable=true`，准备后的 `CatalogEntry.state=ready` 不单独代表执行资格。没有 Native 命令时显示服务不可用，不填模拟目录、不降级普通发送。

`contract-impact=breaking`：完整专家 wrapper 参与发送幂等与冻结身份；使用 `yijie-contracts/compatibility/experts` 同源生成的独立 Native family、严格验证器。首次 packaged 为 8 个 Native 命令；显式恢复扩展后的源码为 10 个。精确当前工作树候选见 `contracts/experts.candidate.json`，未改既有发布 pin，也不宣称不可变发布 provenance 已完成。

Host 私有 family 首次为 9 个方法：`expert_apply_binding`、`expert_operation_read`、`expert_grant_register`、`expert_submit`、`expert_submission_read`、`expert_status`、`expert_resources_prepare`、`expert_resources_remove`、`expert_resources_operation_read`；本轮源契约增加 `expert_binding_recover`、`expert_resources_recover` 后为 11 个。继续复用 Native owned JSONL pipe/hello；没有新 HTTP 入口、第二套 grant 或安装器。Host apply/submit/资源写入预算分别为 20/25/25 秒；两个显式恢复方法分别 20/25 秒；其他方法 5 秒，Native 响应预算 30 秒。超时保留原未知操作，不授权新 ID 重试。

本轮独立候选配置为 `com.yijie.ai.feat158-local` / “易界 AI FEAT-158”、`.local/feat158-candidate` homes 与端口 18158，并隔离候选 single-instance 锁。canonical Host 构建已新增独立 FEAT-158 candidate pin，旧 FEAT-156 pin 不变。该隔离入口已完成 canonical 构建和真实启动；具体观察与边界见下方 run 记录，不以先前脚本检查代替实测。

## 阶段 2 首次来源 pin（历史快照）

以下为 2026-10-11 阶段 2 首次 packaged 验证时的实读 SHA-256，早于后续显式恢复命令扩展，不能作为扩展后的当前 pin。当前源码精确来源由 canonical 生成的 `contracts/experts.candidate.json` 及主任务最后冻结记录确定。Contracts base `35e0949c95d7a59ca5480715c225766dcc822056`；Skills base `488714a8d96f40806a257aae097683815b1dd458`，bundle `0.4.0`。全部为 `release=false` 的 working-tree/local-development 候选，原发布 pin 保留。

| 当时文件/身份 | SHA-256 |
|---|---|
| Contracts source.lock.json | `762fa86dedad71afef0c2a0e37d7945202ca961cdddb6e7c188aaa6c7d657259` |
| Desktop contracts/experts.candidate.json | `5bb2bca0ffcb07d0d24bb9f930ce8006fb443e51282179c32e8a9d4200984ee9` |
| Desktop contracts/experts-assets.candidate.json | `3c0ce0e0f45deffd0669e78fc76d2f7c3359ae15aabfb78719c562878c174fcc` |
| Desktop contracts/experts-host-build.candidate.json | `4b121a5fe13e2b584760e2f578b72ace5a19d427977782f2492561fff0473832` |
| Skills authority.json | `8cefd1e0fc0c80739018b37293e44550dd2b0c6a0fdb96f7ea08b28e7e356d3b` |
| Skills bundle manifest | `156fa3da100f82985087637ea3e94138d1f6ff813fedc8a4275b0dcad591e355` |
| Skills bundle source tree | `2fae182bcdbf41e2a6f7418fa1e64d94282a851c5cc0550feb213dac8ad4fef6` |

Native/Host 各自核对可信目录与 receipt/资源摘要，renderer 不能提供路径或 manifest 自证。首期仍为“资深电商运营操盘手 · 京东专向” `jd-ops-expert@0.1.0`；本地使用授权不是公开分发授权。

## 已实现交互

- 扩展默认技能 Tab；专家目录、搜索、详情和资源准备继续复用原页面。三个快捷问题是可点击的预填操作，不创建会话或发送消息。
- 侧栏召唤返回 `/chat` 新草稿；“+ → 选择专家”携带原对话路径，成功后返回原位置并聚焦输入框。文本、模型、工作空间、连接器选择和附件沿用现有草稿机制；没有新增未发送草稿跨进程持久化承诺。
- 快捷问题遇到已有正文或附件时默认“保留当前草稿”，可明确选择“替换文字”；不清除附件。更换不同专家明确说明从下一条消息生效、原历史保留。
- 店铺右侧仅一个专家胶囊，正文看详情，独立 × 移除。hover 与键盘焦点显示 ×；可访问名称和完整版本 tooltip 保留。输入区沿用 token 并允许窄容器换行；只有专家而无正文/附件不能发送。
- 新草稿选择存于既有 `chat-composer-drafts.store`，不调用绑定命令。已存在会话读取 Native `BindingView`，set/query 使用原 operation；应用中保留旧有效标签，成功回执后更新 revision 或移除标签。× 不卸载、不删历史、不清输入。已有会话切换、草稿变化或 context 变化后到达的过时召唤结果不会再导航或覆盖新目标。
- 忙碌、待批准、绑定 pending/unknown、未确认提交阻止变更。绑定/资源不可用时保留原因和重新读取入口；已知资源 unavailable 的绑定仍可请求 Native 移除，未确定结果不冒充移除成功。

## 数据与发送边界

`chat-experts.store` 保存 Native 安全投影和当前进程内原操作意图；按现有 local tenant scope 隔离，丢弃旧作用域异步响应。同 scope context 续期保留原绑定 operation 和未知提交；所有请求仍由 Native 校验完整 owner scope。资源目录中的持久 `operation` 会恢复到资源 store，重开页面后查询原 pending/unknown operation，不自动生成替代 ID。

Native `BindingView.managed` 是已存在会话发送 family 的权威标识。`managed=true` 的 expert=null/revision=0 也保持专家 wrapper，例如 explicit-none 首次提交或首次 Apply 被拒绝；没有绑定行时才返回 managed=false。胶囊只表达当前专家显示状态，不决定 family。schema 35 只给 prior expert journal 中合法、缺该字段的绑定回执补 managed=true，普通消息/回执不变。

`chat.store` 继续使用既有文本/附件校验、发送互斥、`pendingSubmission`、本地 queued 投影和 Coordinator 同步。专家相关 API 不拼进旧闭合 payload：

1. `expertIntent` 的 expert ID/version 与 expectedBindingRevision 加入完整发送去重键；新会话 revision=0，已有会话使用 Native 当前绑定。
2. 专家请求通过 `chat_expert_submit_v1`。所有 managed=true 会话在解除后或 explicit null/revision=0 时仍走这个 family；已知专家绑定或未知专家请求不能走普通 submit。
3. API 验证 envelope、原 operation、会话、专家与 revision；只取 source 定义的安全 receipt 字段。`local_durable_accepted` 仅代表本地持久接受，后续实际执行状态仍来自原 Coordinator/Runtime 投影。
4. 未知提交保留完整原 wrapper、正文/附件引用和操作编号，锁住编辑和切换，提供“确认原提交”。原请求重放使用同 operation；没有独立 submit-read 命令。Native 必须先匹配原持久 receipt，不能再次 dispatch。后续查询权限失败也不能把原 unknown 当作拒绝并删除。已受理但晚到的 receipt 也与原 wrapper 一起保留，直到原草稿调用方确认消费并 acknowledge，不能在 UI 尚未接受结果时丢失原操作。
5. 同一原请求的恢复不受后续 ordinary canSend/模型读取暂不可用阻挡；Native 仍检查当前读取权限，UI 不改变原内容、目标或授权意图。当前未发送附件和正文必须仍匹配原冻结请求。

知识正文、角色 prompt、安装路径、私有摘要不进入 UI 发送正文；没有全量 KB 注入。历史逐条消息的专家装饰标签未实现：当前闭合 history response 无该字段，不从当前 binding 猜历史。Native 持久的当轮 snapshot 是恢复/派送身份依据，本轮前端不改写既有历史。

## Native 持久化与资源边界

schema 34 保存绑定、原 Apply payload/receipt 和提交 snapshot；schema 35 新增资源操作 journal。每次 prepare/remove 在同 SQLCipher worker 事务内重新核对授权并先保存完整原私有请求、owner/tenant、action、selection、operation 和 catalog identity，再调用原 Host 方法。稳定意图摘要不含易变 UI context/request ID 或当前 Host nonce；原请求中的这些身份仍完整保留用于回执一致性判断。重放只能读原 receipt，不重新 mutation。

同一专家受管安装根的 pending/unknown 会跨版本与本地 scope 阻止新操作；Host status 为空、正常重开未找到原操作，均不推断原请求失败或成功。只合并身份及目录匹配的原正向回执。移除检查所有保留 binding/submission；覆盖升级还检查其他版本的保留历史及未决请求，同版本准备可继续原 core 的正常 no-op。Host 再检查 live references，不拿该检查替代 Native 历史保护。记录原已授权结果可先于 UI context 续期完成，但返回前仍重查当前授权。

原完成 submit 的完整 wrapper 先参与既有 HMAC/receipt 重放，再进入当前资源或 Provider 准备；dispatch 只消费冻结 snapshot 并核对原 Host 身份。原始 grant 生命周期、事务 outbox 与 Coordinator 沿用。专家绑定 begin 在同事务复用既有 schedule foreground reservation 判定，调度准入也读取专家未决操作，形成双向互锁；schema 33 无专家表保持兼容，关闭 feature 仍读取既有专家状态。关闭 feature 不得把已持久专家 outbox 交给旧 ordinary family；数据库和未知操作不得通过清空、降级或强退恢复。

## 已执行的正常验证：阶段记录

以下只使用普通合成领域数据、内存 store 与函数替身，没有模型、外部服务、攻击资源、权限破坏、强杀或运行时替换。

- 阶段 2 初次前端接线：10 个源码测试文件 **58/58 PASS**，覆盖专家开关、Native client、会话专家 store、资源 store、目录、胶囊、召唤导航、ChatComposer、ChatAddControl、原草稿 store。
- 同次 ChatPage 与 chat.store 名称筛选 **14 PASS / 195 未执行**：新草稿专家 wrapper、已有会话移除后 null family、未知原 operation、店铺旁胶囊、无正文不可发、普通创建/草稿隔离/重复提交与既有市场路径。
- 随后 Native client 与会话 store 的恢复补充复跑 **8/8 PASS**，覆盖未知后权限拒绝仍保留原提交；显式输入框焦点补充的 Composer/Page 筛选 **28 PASS / 57 未执行**。
- 所改前端文件 ESLint、`pnpm exec vue-tsc --noEmit`、`git diff --check` PASS。
- `node ../yijie-contracts/scripts/sync-experts.mjs --consumer=desktop --check` PASS；本任务没有手改生成物。
- 该次默认关闭与显式专家开关的 Vite build 都 PASS，随后重建默认关闭产物；大于 500 kB 的既有分块提示仍存在，未宣称包体优化通过。此记录早于最后的 managed/晚回执/导航修正，不冒充最终隔离 App 构建资格。

最后的 managed/晚回执/过时导航修正后：

- 会话 store 与召唤 composable 两文件 **14/14 PASS**；ChatPage/chat.store 使用 `--testNamePattern FEAT158` **6 PASS / 205 未执行**。定向调用之间有重叠，不累加成全套覆盖率。
- `pnpm exec vue-tsc --noEmit`、所改 8 个 UI 文件 bounded ESLint 与 `git diff --check` PASS。
- Native 正常资源内存 DB **8/8 PASS**；此前 `feat158_` 筛选 **9 PASS**、`native_market_` **9 PASS**、既有 FEAT-157 snapshot 与普通 control EOF 各 **1 PASS**。这些是定向证据，不是全仓 Rust 测试通过。
- 最后精确 dispatch 私有 snapshot、原 Host 回执与正常 close/reopen 测试 **1 PASS / 592 未执行**；`cargo clippy --all-targets -- -D warnings` PASS。schema 35 测试只做正常内存迁移及事务回滚，不注入文件或权限故障。
- canonical 专家资源 copy/check 按本表 Contracts `762fa86d…`、authority `8cefd1e0…` PASS。早先 launcher 的 shell/Node 静态检查与 10 项正常测试发生在独立候选隔离配置修改前，不用于宣称最终 launcher 通过。
- 独立 FEAT-158 Host build candidate 冻结后，三个新检查加四个旧检查 **7/7 PASS**：`YIJIE_EXPERT_CANDIDATE_CHECK=true pnpm exec vitest run --exclude '.local/**' scripts/chat-model-build-candidate.test.mjs scripts/local-permission-candidate.test.mjs scripts/scheduled-host-build-candidate.test.mjs`；既有 `verifyLocalPermissionCandidate` 完整校验链及两个改动脚本 ESLint PASS。尚不表示 packaged App 已构建或启动。
- 本次文档收口：`pnpm docs:build` PASS（16 个品牌 SVG 源检查、reference TypeScript 检查与 VitePress 构建）；仍有大于 500 kB 分块提示。三仓 consumer candidate 的 sources/generated 与当前 Contracts lock 及各自实际生成文件逐项 SHA 核对一致。此项只验证来源与文档构建。
- 主任务后续 `pnpm lint && pnpm build && pnpm docs:build` 全部 PASS；Native store **12 PASS**、资源 **8 PASS**、独立 single-instance 锁 **1 PASS**、launcher **20 PASS**，fmt/clippy PASS；Contracts 三消费者 `--check` 与 assets `--check` PASS。
- 随后 schedule/expert binding 双向互锁修正：复用真实 reservation helper 的 **3/3 正常测试 PASS / 593 未执行**；`expert_store_` **12/12 PASS / 584 未执行**，Clippy `-D warnings` 与 diff check PASS。该检查覆盖数据库准入互斥，未启动 App 或发送 turn。

阶段 1 历史：Native 绑定 store 最初 10 项正常内存事务测试通过；Host 进行了固定 Runtime、localhost synthetic Responses 与自建普通 reference 的正常同 ID 重开资格观察。该观察未调用真实模型，不是当前 UI→Native→Host→实际专家安装资源的整链验收。本轮当前 Host 精确 18 项 FEAT-158 正常测试和 2 项旧普通回归通过，另有 build/vet；细节见 Host 候选文档。

核心命令（均限制 `--dir src` 避免载入 `.local` 历史备份）：

```sh
pnpm exec vitest run --dir src src/authorization/experts-ui-config.test.ts src/api/expert-native-client.test.ts src/stores/chat-experts.store.test.ts src/stores/experts.store.test.ts src/components/experts/ExpertMarketPanel.test.ts src/components/experts/ChatExpertChip.test.ts src/composables/useExpertSummon.test.ts src/components/chat/ChatComposer.test.ts src/components/chat/ChatAddControl.test.ts src/stores/chat-composer-drafts.store.test.ts --maxWorkers=2
pnpm exec vitest run --dir src src/pages/chat/ChatPage.test.ts src/stores/chat.store.test.ts --testNamePattern 'FEAT158|creates exactly one session|creates a projectless task|isolates text drafts|keeps a draft through the first context|coalesces duplicate submit|FEAT-155 confirms|market selection uses|market managed continuation' --maxWorkers=2
```

一次新增 ChatPage 测试首跑 2 项未通过：测试直接赋权限字段未设置原权限 store 的有效期，导致 `hasCapability` 合法返回 false；测试随后以明确普通权限投影替身补足，复跑通过。未放宽产品权限判定。第一阶段曾有未排除 `.local` 历史备份的失败测试调用，该结果不计入当前源码验收。

## 隔离 App 首次观察与修复

主任务在 fresh candidate scope 正常启动 packaged App，观察到默认技能页 38 项、专家页 1 项、详情和三个快捷问题。点击详情“准备资源”后很快显示通用未完成提示，安装目录没有出现资源，**该次准备失败，不计为完整链路 PASS**。随后通过应用菜单 Quit 正常退出，launcher exit 0；没有强杀或第二实例。

只读源码排查与当前 generated validator 的普通数据验证确认：页面将 `ExpertDisplay` 传给资源 store，原实现通过展开对象保留了 displayName/subtitle/iconKey；client 的严格 `ExpertSelection` schema 在 invoke 前拒绝这些额外字段，映射为 invalid_request 的通用提示。修复提取同源 `ExpertSelection` 的 expertId/version，store 在保存 intent 和调用 client 前使用同一投影，client 资源边界复用；没有放宽 validator 或复制 DTO。已有 binding selection 复用该函数，submit 原路径已有两字段投影且保持完整 wrapper 冻结。

修复后资源 store、Native client、召唤 composable、会话专家 store **4 文件 27/27 PASS**；新增正常 Display prepare/remove、冻结 intent、available 专家召唤到新/已有会话均经过实际 generated request/response validators，只替换 Native transport，不调用模型。`vue-tsc`、7 个改动文件 ESLint、diff check PASS。新测试首跑有一项 response fixture 将 requestedExpert 错写为 Selection，另有测试 Array.at 超出当前 TS lib；仅修正 fixture 后复跑全部通过。此时的真实 App 重测尚待执行，后续补证如下；原失败记录保留。

## 真实隔离 App 第二、三次运行

第二次运行已在真实 App 完成资源 prepare，召唤回到原合成草稿，文字、模型选择保留且焦点回到输入框，全程 0 模型 turn。视觉与键盘检查又发现两个真实问题：胶囊原生 button 继承 macOS WebView 灰底/立体边框；Naive 默认先渲染 negative 按钮，已有草稿确认框因此初始聚焦“替换文字”。两项均未冒称通过。

修复仅为胶囊复用现有 composer/shop 颜色和交互 token、重置 appearance/border，以及确认框复用 Naive Dialog action 插槽，将主操作“保留当前草稿”先渲染，让组件库现有 focus trap 聚焦该按钮。“替换文字”仍为明确的次操作；无新增焦点引擎。原召唤 9 项与真实 Naive Dialog 焦点/分支 2 项共 **11/11 PASS**，TypeScript、3 个改动文件 ESLint、diff check PASS。happy-dom 不合成 Enter 默认 click，测试对此有明确说明；真实 WebView 键盘验证由第三次运行补足。

第三次运行实际结果：

- canonical packaged 构建和隔离启动成功；重开后的专家资源仍为 ready。
- 真实 WebView 确认框初始焦点在“保留当前草稿”，按 Return 保留原合成草稿且不发送。
- 胶囊原生样式问题已修复；1180×760 的亮色、暗色详情与输入区未观察到重叠。暗色通过分离 Web Inspector 的 Color scheme 局部覆盖验证（页面 `data-theme=dark`），没有更改系统主题。
- 搜索空结果与清空搜索后的目录恢复通过；Tab 到“移除专家”后按 Return 移除草稿专家，文字和模型选择保留。
- 实际模型 turn 为 **0**。以上是资源与未发送草稿流程，不证明已有 Runtime thread 切换、实际模型角色效果或完整 D4。

继续普通附件选择时 Mac 锁定，已请求用户解锁；该附件流程尚未完成。本轮 App 仍在运行，不能声明最终清理完成。前两次均通过应用 Quit 正常退出、launcher exit 0，此历史退出证据不替代第三次运行的后续清理。

## 无屏幕审计与显式恢复（源码候选）

用户要求跳过依赖屏幕解锁的工作后，继续以源码和普通内存状态审计。确认并修复两项 P2：召唤/更换及资源移除确认弹窗现在绑定打开时的 route、scope、context，导航、context 续期或组件销毁会关闭并作废原确认，在任何准备、绑定或草稿写入前再次核对；资源 catalog 正向确认同一原 operation 成功时清理旧“结果待确认”提示，不让别的 operation 回执消除当前未决提示。仍沿用 Naive Dialog 的焦点和销毁机制。

同源契约新增的两个 Native 命令已接入 UI：`chat_expert_binding_recover_v1` 使用原 sessionId/operationId，`experts_operation_recover_v1` 仅使用原 operationId。源码 family 因此为 10 个 Native 命令；Host 私有恢复扩展由主任务独立验证，不能把本段前端测试当作 Host 验收。普通“重新读取/查询状态”继续只读，只有明确点击“恢复原操作/处理未完成操作”才发送恢复请求。绑定恢复旁说明“重新应用原选择，不发送消息”；资源收口确认说明只核对原操作，不重复安装或移除。按钮遵循当前权限与忙碌状态，资源确认也受上述生命周期保护。

API 使用 generated request/response validators，并核对原 ID、会话及 revision；store 在恢复 guard/transport 错误后保留原 pending/unknown，不替换 ID、不删除原意图。资源原回执 `rejected/request_conflict` 显示“原操作已结束，可重新准备或移除资源”，不宣称安装或移除成功，也不把所有 rejected 都解释成未执行。

本次精确定向测试：6 个文件 **44/44 PASS**（API、资源 store、绑定 store、召唤、真实 Naive Dialog、资源 panel），覆盖原确认失效、原 pending→completed catalog、忙碌恢复保留状态、原 ID terminal 更新、显式资源按钮仅发 recovery + catalog read；ChatPage/chat.store 的 `FEAT158` 筛选 **7 PASS / 205 未执行**，包括绑定恢复按钮只调用新恢复命令且保留草稿、不发消息。`vue-tsc --noEmit` 与 13 个改动文件 ESLint PASS。测试首轮的 panel 查找位置和 Naive leave-transition 断言，以及一处 fixture literal 类型已更正，未放宽产品校验。

随后复核补上正常并发读取的代际保护：prepare/query/recover 开始和收到回执或错误时使旧 catalog read 失效；同一原 ID 的 terminal 回执不会被后来返回的 pending/unknown 或旧错误降级。两种正常 deferred 顺序均验证：旧 snapshot 晚于 prepare/recover 完成返回，以及 catalog 已确认完成而原 recovery reply 更晚返回。资源 store + panel 最后精确复跑 **19/19 PASS**；按钮文案统一为“处理未完成操作”，不重复大型测试。此次补充的 TypeScript、4 个文件 ESLint 与 diff check 通过。前述 `pnpm build`、`pnpm docs:build` 已通过；最后文案和代际补充后的全局构建由主任务统一收口，不将早先构建冒充最新产物。

```sh
pnpm exec vitest run --dir src src/composables/useExpertSummon.test.ts src/composables/useExpertSummon.dialog.test.ts src/components/experts/ExpertMarketPanel.test.ts src/stores/experts.store.test.ts src/stores/chat-experts.store.test.ts src/api/expert-native-client.test.ts --maxWorkers=2
pnpm exec vitest run --dir src src/pages/chat/ChatPage.test.ts src/stores/chat.store.test.ts --testNamePattern FEAT158 --maxWorkers=2
```

本轮没有操作屏幕、启动或停止 App、调用模型；上述补充尚未在真实 WebView 验证。真实模型预算仍为 0。

## Run 6 后的键盘焦点窄修（2026-10-11）

真实 App 观察到 Tab 方向键切换成功后焦点被移到页面标题；原页面测试替换了 Vue Router，未覆盖全局 `afterEach`。现在仅在专家 gate 开启、同 `/plugins` 页面只切换合法 `tab` 且其余 query/hash 不变时保留 `YjTabs` 已管理的焦点。首次进入、返回其他页面、原对话上下文变化及 feature-off 技能页仍执行原标题聚焦。没有改变确认弹窗的路由失效规则。

详情关闭时 `selectedKey` 清空同时移除 `NCard`，Naive 的空 slot 不保证触发原 `after-leave`；macOS 鼠标打开也不保证触发器先获得焦点。关闭按钮、Esc 和返回目录现在在既有 focus trap 卸载后的 `nextTick` 显式归还实际卡片触发器，并要求节点仍连接、页面仍 active、route/scope/context 未变且详情未重开。没有复活旧确认或在离开页面后抢焦点。

本次 `contract-impact = none`：仅修复渲染器焦点生命周期，没有 Desktop 跨进程、API/Agent Host、资源权限或本地持久状态的可观察协议变化。真实 Router 集成 3 项、详情焦点 6 项及原页面/路由回归共 **45/45 PASS**；定向 ESLint、`pnpm build`（含 TypeScript）通过。初次新增 Esc 测试漏设组件库实际读取的 `KeyboardEvent.code`，正常补齐 `code: Escape` 后复跑通过，未修改产品 Esc 语义。用户要求跳过后续外观验收，因此未再操作真实 App/屏幕，也未在本子任务调用模型；这批自动测试不替代 WebView 实测。实际模型、会话生命周期和总预算以主任务 Run 6/7 记录为准，前文阶段性零模型记录保留为历史。

```sh
pnpm exec vitest run --dir src src/pages/plugins/ExtensionsPage.navigation.test.ts src/pages/plugins/ExtensionsPage.test.ts src/components/experts/ExpertMarketPanel.test.ts src/router/index.test.ts src/router/workflow-navigation.test.ts --maxWorkers=2
pnpm exec eslint src/router/index.ts src/pages/plugins/ExtensionsPage.navigation.test.ts src/components/experts/ExpertMarketPanel.vue src/components/experts/ExpertMarketPanel.test.ts
pnpm build
```

## 前序阶段尚未执行记录（后续实际结果以主任务验收记录为准）

- 当前产品验收仍未运行真实 UI→Native→Host 首次/连续发送、同 thread 移除、原生审批/模型/市场组合或真实模型效果。已有源码接线与正常存储/控制/dispatch 测试不替代真实 App 整链。实际总集成由主任务另行记录。
- 已实测上列最小窗口亮暗与键盘路径；其他缩放范围、完整附件流程及未列出的 UI 场景仍未完成，不推广为全界面验收。
- 最多 18 条真实模型用户消息的异步授权申请尚未得到答复；当前授权预算仍为 **0**，未发起真实模型调用。真实模型相关 Must 与 D4 保持未完成，不能因草稿 UI 通过而推进。
- 未执行全仓 make/test 中未经审查的历史攻击、权限破坏、强杀或可执行文件替换 fixture；全仓/Rust/异常注入覆盖不由此文声称通过。

安全回退关闭新入口，保留 Native 已持久的绑定/outbox/历史与资源；不能把未知请求转换成普通提交，不能用删除记录或卸载被引用资源来恢复。

## 2026-10-13 最终 Git 来源审计

Contracts `experts/1@0.1.0`：`e35ae9a0711014e4774a1347413e9a343ce7ab2c`；Skills 0.1.3 / bundle 0.4.3：`d7a850c9d5c5f8e52b8ab8f631800f671acc60dc`；Host：`9acae49ee2bf1fb33ae1da8ef02fd0bd07538d63`；Shopify worker 源：`23c31e8f3cd467916956e1bbdef428a334de0ca3`。相关源均在各自提交中，Runtime 仓无改动。Skills 原 canonical 打包器从干净提交重建后，39 项归档、专家 metadata 与已验收 phase12 一致，manifest SHA-256 更新为 `4fec45edbe0995d0fa809c11c1fb37189176c6e9fc7fa7e8cce6a31cf1eea201`，authority SHA-256 `122486fe96f51a35a47c747d7d89ab70375b057fa39a87bcb22a25dfcb0a7860`。旧安装 ExpertRef、普通 Skill 和历史会话无需迁移或替换。

Host/资源固定摘要依原校验与显式 freeze 同步，兼容专家开启及关闭入口；不得只提交旧工作树 HEAD 造成启动 drift。产品仍是 local/demo_fast 候选，不新增 tag、桌面签名发行或生产部署。公开 Git 范围已获用户确认，见 Skills `docs/provenance/FEAT-158-git-publication.md`。本轮只补来源变化的必要构建/正常启动验证，无模型调用，外观跳过；完整测试与历史验收沿用元仓 phase11/phase12，最新交付收口见元仓 `16-final-audit-and-git-delivery.md`。
