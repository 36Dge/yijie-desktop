# FEAT-125 S5B Contracts Consumer 与 Permission Store 矩阵

## 1. 状态与边界

- Owner / Reviewer：段成威。
- 批准日期：2026-08-01。
- contract-impact：`semantic`。本切片消费已批准的 Public API 身份、租户、权限与失败语义，
  不修改公共 wire；权威源仍为 `yijie-contracts`。
- Contracts candidate：`9ec34abd6e7dfb5a23b0154d467694167224ebbb`，版本
  `0.3.0-candidate`，未 tag、未发布。
- 范围：Desktop exact pin、生成 TypeScript 类型、固定两个 operation adapter、0/1/多租户领域状态、
  request epoch/abort、revision/context/expiry 校验及进程内 fail-closed permission store。
- 非目标：S6 UI/nav/router/AppShell/Settings、Tasks、Rust refresh/Keychain 生命周期、生产 IdP/API
  配置、签名/公证、发布或生产激活。现有 feature flag 保持关闭。

## 2. 不可变契约与生成链

| 证据 | 固定值 |
| --- | --- |
| repository | `https://github.com/36Dge/yijie-contracts.git` |
| full commit | `9ec34abd6e7dfb5a23b0154d467694167224ebbb` |
| source | `openapi/public/public.yaml` |
| source SHA-256 | `7bd40dd1c5a53cc1dcd317e3a64bf7189170fd7f575b25bb07f0eb243d0319ed` |
| generator | `openapi-typescript 7.13.0` + `TypeScript 5.9.3` 独立工具 workspace |
| generated output | `src/api/generated/public.gen.ts` |
| generated SHA-256 | `77babb215608c6ace4468d37b72fc8e43f5758231c7807a4301063cb156ae8e0` |
| lock | `contracts/public-api.lock.json` |
| lock SHA-256 | `9ce0a7de31af815f0bc803cc9ab96568e2f2b88db51cbb31e1550d001d2932d5` |
| pnpm lock SHA-256 | `d80424b870ec45ea2be064189a5aa6708370d235401f173649ad9c9075f58340` |

`pnpm generate` 与 `pnpm generate:check` 在写入或比对前强制验证：Contracts checkout 的完整
HEAD、origin、tracked-clean 状态、source digest、12 份 canonical fixture digest、generator 与
TypeScript 版本以及最终 generated digest。CI 以固定 action SHA checkout 同一 Contracts commit；
不接受浮动分支、dirty source、缩写 SHA、目录穿越或手改 generated 文件。

## 3. Consumer 与领域映射

| 层 | 输入 | 输出 | Fail-closed 规则 |
| --- | --- | --- | --- |
| Tauri operation adapter | `listMyTenants` 或 `getMyCapabilities(tenant UUID)` intent | S5A 固定 envelope | 只调用 `list_my_tenants` / `get_my_capabilities`；不接受 URL、method、header、body 或 token |
| Contract decoder | generated `TenantSelectionList` / `CapabilityProjection` / `ErrorResponse` | `TenantOption` / `PermissionProjection` | no-store、status/code、UUID、schema v1、tenant context、safe revision、RFC3339 future expiry≤5m、sorted unique≤256 keys 任一不符即丢弃全部 |
| Capability mapper | open namespaced keys | 7-key `KnownCapability` allowlist | 未知但合法 key 忽略；非法、重复或乱序 key 拒绝整个投影；不会由未知 key 创建入口 |
| Permission store | tenant list + projection + error | memory-only phase/context/capabilities | 任意非 ready/过期状态 deny；切租户/刷新/logout 先 clear；旧 epoch/tenant 的迟到响应不可提交 |

额外 response 字段按 AC-006 容忍并忽略；credential-like key 无论位于 envelope/body 哪一层都
触发拒绝。前端只获得无 token 的 operation response，错误仅映射为稳定的本地域状态，不透传原生或
服务端内部细节。

## 4. 0 / 1 / 多租户状态机

1. 每次 `discoverTenants` 清空 tenant、projection、revision 与 expiry，并创建新 epoch。
2. 0 个 membership：`recovery`，protected capability 恒为 0。
3. 1 个 membership：自动选择并原子获取投影；加载期间 protected capability 恒为 0。
4. 多个 membership：`tenant-selection-required`，在 S6 Settings chooser 接线前不自动选择。
5. 显式选择必须命中本次 discovery 列表；未知 tenant 不调用原生 transport。
6. 切换、刷新、logout 会 abort 当前等待并使旧 epoch 失效；即使底层 native promise 迟到，
   也不能覆盖新 tenant/context。
7. 到期先清空，再对当前 tenant 发起一次安全 GET 刷新；失败保持 deny。last tenant、projection、
   revision 和 capability 均不写 LocalStorage、SessionStorage、IndexedDB 或文件。

## 5. Conformance、异常、并发与安全覆盖

- 12 份 canonical Contracts fixture 均从 exact sibling checkout 读取，Desktop 不复制第二份权威
  fixture。
- 覆盖 tenant empty/single/multiple、projection ready/empty/unknown、400/401/403/500/503 的
  status/header/error-code 映射。
- 覆盖额外字段、未知 capability、unsupported schema、tenant mismatch、revision 0/超
  `MAX_SAFE_INTEGER`、过期/非 RFC3339/超过五分钟、duplicate/unsorted/非法 capability、重复 tenant、
  missing no-store、错误 status-code pair 与 credential-like response key。
- 覆盖 A→B late response、abort、logout、expiry clear-before-refresh、revision rollback、0/1/multiple
  选择与异常恢复；Store 仅接受当前 epoch/context 的最后完整快照。
- 测试 fixture 只含合成 UUID/名称，无 bearer、subject、密码、真实租户或经营数据。

## 6. 当前验证与残余门

最终仓内门禁结果：

| 门禁 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS；3 个 workspace，lockfile 不变 |
| `pnpm generate && pnpm generate:check` | PASS；source/12 fixtures/generator/generated digest 全部精确一致 |
| `make lint` | PASS；generator drift、ESLint、Vue TSC、Rust fmt、Clippy `-D warnings` |
| `make test` | PASS；前端 12 files / 80 tests，Rust 36 tests + doc-tests |
| `make build` | PASS；Vue TSC + Vite production build |
| `pnpm docs:build` | PASS；VitePress client/server build 与页面渲染 |
| `pnpm tauri:build --debug` | PASS；debug `.app` 与 aarch64 `.dmg`，仅本地未签名测试制品 |
| `pnpm audit --audit-level high` | PASS；`No known vulnerabilities found` |
| `cargo audit --file src-tauri/Cargo.lock` | PASS；0 个未豁免漏洞，17 个既有 allowed warnings |
| peer/license scan | PASS；0 peer issue，11 license groups，0 个禁止许可证组 |
| `git diff --check` + secret/scope scan | PASS；无 token/secret/真实数据；无 Rust、Tasks、S6 UI/router/nav 或生产配置改动 |

提交后的远端完整 SHA 由 FEAT-125 元需求包登记。

结构化审查覆盖 scope、contract provenance、generator toolchain、wire decoder、operation intent、
tenant/context、revision/expiry、并发、持久化、依赖与 CI：

| Finding | Severity | 处置 |
| --- | --- | --- |
| S5B-REV-001 | P1 / resolved | generator 原会绑定超出 peer 范围的 TypeScript 6；隔离到独立 workspace，并精确固定 `openapi-typescript 7.13.0` + TypeScript 5.9.3，peer check PASS |
| S5B-REV-002 | P2 / resolved | 已取消 signal 原可能在拒绝前仍启动 native invoke；现在调用前检查 abort，负测证明调用数为 0 |
| S5B-REV-003 | P2 / resolved | 同一 revision 若返回不同已知 capability，原状态机仍可能接受；现在记录 revision+capability key，同 revision 漂移与 revision rollback 均拒绝 |
| S5B-REV-004 | P2 / resolved | `Date.parse` 会规范化 2 月 30 日或 24:00；现在先做日历有效性、RFC3339、future 与≤5m 校验，边界负测 PASS |

S5B 当前开放 P0/P1/P2 为 0；没有以本审查冒充段成威最终人工批准，也没有把本地单元/conformance
测试写成 S7 跨仓 E2E。

`S5A-REV-OPEN-001` 仍为开放 P2：它不阻断 S5B，但在 S7 前必须通过独立安全修复切片关闭。
signed browser/Rust bearer/Keychain/provider-family E2E 仍是 S7/G5 `NOT RUN`；本文件不得作为
G4/G5/G6、发布或生产激活证据。
