# FEAT-125 S5A 原生认证与传输安全矩阵

## 1. 范围与状态

本切片只实现 `yijie-desktop/src-tauri` 原生安全边界：

- 系统默认浏览器 OIDC Authorization Code Flow；
- 精确 `http://127.0.0.1:<ephemeral-port>/oauth/callback`；
- PKCE S256、随机 `state`、随机 `nonce`、ID Token RS256 校验；
- access token 仅驻留 Rust 内存，refresh token 仅存 macOS Protected Data Keychain；
- `listMyTenants` 与 `getMyCapabilities` 两个 operation-scoped transport；
- 统一、脱敏的 Tauri command 错误。

不包含 S5B/UI、Tasks 变更、生产 IdP/API 值、生产 CSP/签名配置或生产激活。功能开关
`YIJIE_DESKTOP_NATIVE_AUTH_ENABLED` 默认关闭。

## 2. 配置边界

只有功能开关精确为 `true` 时才读取以下变量；缺失、部分配置、非 HTTPS、userinfo、query、
fragment、OIDC 跨 origin 或带 path 的 API origin 均导致 fail-closed：

- `YIJIE_DESKTOP_OIDC_ISSUER`
- `YIJIE_DESKTOP_OIDC_AUTHORIZATION_ENDPOINT`
- `YIJIE_DESKTOP_OIDC_TOKEN_ENDPOINT`
- `YIJIE_DESKTOP_OIDC_JWKS_URI`
- `YIJIE_DESKTOP_OIDC_REVOCATION_ENDPOINT`
- `YIJIE_DESKTOP_OIDC_CLIENT_ID`
- `YIJIE_DESKTOP_API_ORIGIN`

仓库不提供变量值、client secret、生产样例或启用默认值。

G3-NP-LOCAL 额外定义 `YIJIE_DESKTOP_AUTH_ENVIRONMENT`、
`YIJIE_DESKTOP_LOCAL_CA_PEM_PATH` 与 `YIJIE_DESKTOP_LOCAL_CA_SHA256`。自定义 CA 只允许在显式
`local-integration` 下使用，且 issuer/API host 必须精确为 `localhost`；完整边界见
[`FEAT-125-G3-NP-LOCAL.md`](FEAT-125-G3-NP-LOCAL.md)。

## 3. 安全不变量

| ID | 不变量 | 实现与验证证据 |
| --- | --- | --- |
| S5A-01 | 只使用系统浏览器；拒绝非 HTTPS authorization URL | `runtime::open_system_browser` + hardened `webbrowser`；单元测试 |
| S5A-02 | callback 只绑定 IPv4 loopback 临时端口和精确 path | `LoopbackCallback::bind` / `parse_request`；loopback 测试 |
| S5A-03 | callback 拒绝错误 Host、method、path、重复/未知参数、body、transfer encoding | parser 负向矩阵；单元测试 |
| S5A-04 | state 常量时间比对；可选 `iss` 必须与配置 issuer 精确相等 | SHA-256 + constant-time equality；单元测试 |
| S5A-05 | PKCE 固定 S256；每次生成随机 state/nonce；无 client secret | `openidconnect` authorization builder；查询参数测试 |
| S5A-06 | ID Token 只接受 RS256，并验证签名、issuer、audience、时效与 nonce | allowed algorithm + `IdToken::claims`；编译路径及库验证器 |
| S5A-07 | `at_hash` 存在时必须与 access token 匹配 | `AccessTokenHash::from_token` |
| S5A-08 | access token 不持久化，寿命大于 2 分钟且不超过 10 分钟 | `AccessSession` Rust 内存态 + token response 负向测试 |
| S5A-09 | 小于 2 分钟或 401 时 single-flight refresh；并发等待者复用已轮换 token | `refresh_lock` + rejected-token recheck |
| S5A-10 | refresh token 强制轮换；`invalid_grant`、未轮换或非法响应清除本地 token family | refresh response 校验、常量时间 token 比对、fail-closed 分支 |
| S5A-11 | refresh token 30 天闲置、90 天绝对过期 | Keychain envelope 校验负向矩阵 |
| S5A-12 | refresh token 仅写 `ai.yijie.desktop.auth` Protected Data、本机且解锁可用 | `apple-native-keyring-store::protected` + `when-unlocked-this-device-only` |
| S5A-13 | Keychain 调用不阻塞 async executor；写失败不发布内存会话 | `spawn_blocking` + save-before-publish |
| S5A-14 | WebView 只能调用两个固定 GET operation，无通用代理参数 | Tauri command 签名 + operation/path/status allowlist 测试 |
| S5A-15 | capabilities tenant header 只接受非 nil、小写 canonical UUID | UUID 负向矩阵 |
| S5A-16 | HTTP 禁止 redirect，限制 10 秒与 256 KiB，响应必须 `application/json` / `no-store` | hardened reqwest client + header/status/body 检查 |
| S5A-17 | Rust/Tauri 输出不包含 token、内部错误、任意响应 header | `SecretValue` redaction + 固定 `CommandError` / `OperationResponse` |
| S5A-18 | 功能默认关闭，部分或非法配置不降级 | 配置矩阵单元测试 |
| G3L-01 | 本地 CA 只在显式 local-integration 使用；production 出现 CA 变量即拒绝 | environment/CA 配置负向矩阵 |
| G3L-02 | local-integration issuer/API 只允许精确 `localhost`；仍强制 HTTPS、hostname/SAN 与 no redirect | config + 两个 hardened reqwest builder |
| G3L-03 | CA 必须为绝对 regular/non-symlink、0400/0600、≤64 KiB、单 certificate、无 private key 且 SHA-256 pin 匹配 | CA 文件负向矩阵 |
| G3L-04 | Keychain v2 绑定 environment/issuer/client；旧、双版本、非法或不匹配记录删除后要求重登 | v2 account/envelope + purge 测试 |
| G3L-05 | v2 使用独立 account，旧 reader 回滚只看到 signed-out，不解析 v2 | `refresh-token-family-v2` 与 legacy detection |

## 4. Operation-scoped transport

| command | method | path | WebView 可提供的输入 | Rust 固定 header |
| --- | --- | --- | --- | --- |
| `list_my_tenants` | `GET` | `/v1/me/tenants` | 无 | `Accept`, `Authorization` |
| `get_my_capabilities` | `GET` | `/v1/me/capabilities` | `tenant_id` canonical UUID | `Accept`, `Authorization`, `X-Yijie-Tenant-ID` |

返回 IPC envelope 只有 `status`、`cacheControl`、条件性的 `wwwAuthenticate` / `retryAfter`
和 JSON `body`。Authorization、Set-Cookie 及其他响应 header 不跨 Rust 边界。

## 5. 门禁记录

`cargo audit` 当前唯一漏洞项为 `RUSTSEC-2023-0071`：`openidconnect 4.0.1` 传递依赖的
`rsa 0.9.10` 尚无修复版本。该 advisory 针对 RSA 私钥运算的计时侧信道，而 Desktop 只执行
RS256 公钥验签，不包含 RSA 私钥、签名或解密路径。因此在 `.cargo/audit.toml` 作带原因、可移除的
临时例外；依赖树固定为 `yijie-desktop -> openidconnect -> rsa`，上游发布修复后必须删除例外。

最终门禁结果、结构化代码审查结论和未执行项在本切片完成验证后登记；生产 Keychain、真实 IdP、
签名/公证 App 与生产 API 的联调保留为 G3/G5，不在 S5A 中伪造通过。

### 5.1 2026-08-01 最终结果

基线为 `yijie-desktop/develop` 的
`be01cc2d0a1c9c4b057de616be201a4843d0a035`，与 `origin/develop` 相等。HTTP wire contract
未修改；contract impact 为 `semantic`，权威 candidate 仍为
`9ec34abd6e7dfb5a23b0154d467694167224ebbb`。

| 门禁 | 结果 | 证据摘要 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | PASS | 2 个 workspace，冻结 lockfile 安装成功 |
| `make lint` | PASS | ESLint、Vue TSC、Rust fmt、Clippy `-D warnings` |
| `make test` | PASS | 前端 9 files / 37 tests；Rust 27 tests；doc-tests |
| `make build` | PASS | Vue TSC + Vite production build |
| `pnpm docs:build` | PASS | VitePress client/server build 与页面渲染 |
| `pnpm tauri:build --debug` | PASS | 生成 debug `.app` 与 aarch64 `.dmg`；DMG 需在 sandbox 外调用 macOS 系统 bundler |
| `pnpm audit --audit-level high` | PASS | `brace-expansion` 固定到 `5.0.8` 后为 `No known vulnerabilities found` |
| `cargo audit --file src-tauri/Cargo.lock` | PASS | 1 个有理由的临时 ignore；17 个 allowed informational warnings（12 个不在 macOS target graph，5 个为 Tauri `urlpattern` 链上的 unmaintained Unicode crates） |
| Cargo license metadata audit | PASS | 505 packages；504 个第三方包均有 license metadata；33 种 SPDX 表达式，无强制 AGPL/GPL/SSPL/BUSL/Commons-Clause |
| `git diff --check` | PASS | 无 whitespace error |
| secret / scope scan | PASS | 无真实密钥、生产配置或启用值；无 Tasks 变更；无 generic proxy |

可复现性摘要：

- `src-tauri/Cargo.lock` SHA-256：`94b1ee21ed1bd9e4e97528622971da9241c43c4e497181ec83f77f2da6a5b973`
- `pnpm-lock.yaml` SHA-256：`aaa0a300afb760c0a768aebefcf338bdbbb66dd6a62a3a907d456d0246fedc0c`

## 6. 结构化代码审查

审查覆盖 scope、认证协议、token 生命周期、并发、Keychain、IPC、HTTP、依赖与失败语义。修复项：

1. 401 并发等待者原本可能在前一个请求完成轮换后再次轮换；加入 rejected-token 重检，保证 single-flight 复用。
2. Keychain 删除失败后，内存态原本可能再次读取旧 token；加入 `storage_blocked` 熔断，只有新登录成功落盘才解除。
3. 初次登录取得的新 OIDC token 在 Keychain load/save 失败时会先 best-effort 撤销新 refresh token；但
   refresh rotation 已取得新 token 后若 Keychain save 失败，当前只熔断并清理本地状态，尚未撤销该新
   token。这是开放 P2，必须在 S7/G5/生产激活前修复并做故障注入验证。
4. refresh 返回同 token 时会 best-effort 撤销；但缺失 refresh token 或非法 token response 当前只映射
   `InvalidGrant` 并清理本地状态，尚未 best-effort 撤销当前 refresh token。该分支与第 3 项合并登记为
   `S5A-REV-OPEN-001`，不得写成服务端 refresh family 已统一撤销。
5. callback parser 增加精确可选 issuer、request-body/transfer-encoding 拒绝与安全响应 header。
6. npm high advisory `GHSA-mh99-v99m-4gvg` 通过 workspace override `brace-expansion=5.0.8` 关闭。

最终审查结论：S5A/G3 当前无未关闭的 P0/P1；存在一个不阻断 G3 环境兼容性或 S5B/UI 实现、但阻断
S7/G5 与生产激活的 P2 `S5A-REV-OPEN-001`。本轮没有 Desktop access-JWT verifier、通用原生 HTTP
代理、token IPC、深链/嵌入式登录、Tasks/UI 修改或生产激活。

## 7. 后续门禁分层

G3-NP-LOCAL 只验证本地环境兼容性：localhost IdP/DNS/TLS/API bootstrap、offline ready、online preflight
及 fail-closed 负向检查。该层通过即可批准 S5B，不要求签名身份或完整 Desktop native E2E。

以下项目本轮为 **NOT RUN（保留给 S7/G5）**，不能解释为已通过生产验证，也不阻断 S5B：

- 修复并故障注入验证 `S5A-REV-OPEN-001`：refresh rotation 新 token 的 Keychain save 失败时撤销
  新 token；缺失/非法 refresh-token response 时撤销当前 token，并验证 Keychain delete 同时失败时
  重启也不会恢复 outcome-ambiguous session；
- signed local `.app` 的系统浏览器登录、callback、refresh rotation/reuse-family 与
  tenants/capabilities consumer 端到端联调；
- 带本地 Apple Development provisioning、签名和 entitlements 的 App 对 Protected Data Keychain 的
  读写/删除；
- 真实生产 IdP/API origin 的 producer-consumer 联调；
- 正式 provisioning、签名、公证和 entitlements 的生产 App 验证；
- 生产 CSP、发布配置、灰度、回滚和生产激活。

S5A 本轮没有包含 S5B/UI 与 generated DTO consumer。G3-NP-LOCAL 后续已经 PASS，段成威于
2026-08-01 单独批准 S5B；S5B 的 exact pin、generated adapter 与 permission store 证据独立记录在
`FEAT-125-S5B-consumer-matrix.md`，仍不包含 S6 UI。

## 8. G3-NP-LOCAL Desktop 候选

本切片的 contract impact 为 `semantic`：权威源是本仓 deployment config 与 Keychain schema v2；公共
HTTP wire 未改变，因此 contracts PR/tag/generator 为 `N/A`。production 默认、OIDC/API 路径、状态码及
权威 contracts candidate `9ec34abd6e7dfb5a23b0154d467694167224ebbb` 均未改变。

当前候选已证明仓内实现、local stack、live Keycloak、专用 API PostgreSQL bootstrap、offline ready
与最终 core online preflight。历史首次 `/healthz` `502` 已由 API local-only 显式 CA PEM/SHA-256 pin
修复关闭；API `faeb78019d95aaf9dcfbd8493f8bc2ecf7e4bf34`、Desktop
`446b4d608546fca8f53f4582201d6b43ef6f762d` 与 Infra
`298192e386a7f7b81e8f0f8fe733c1f79f096ab4` 的最终门禁、readiness、两个未认证 `401` 和 Tasks
edge/direct `404` 均 PASS。因此 G3-NP-LOCAL 为 **PASS**，S5B 已获单独批准。带 provisioning 的
signed `.app` Keychain 矩阵与完整 Desktop native login/refresh E2E 属于 S7/G5，保持 `NOT RUN`。

### 8.1 2026-08-01 仓内验证结果

验证基线为 `yijie-desktop/develop` 的
`3798c67d260237928730758c7ec4c1fbe6fcf7d2`，执行前与 `origin/develop` 相等。本轮尚未提交，因而
没有伪造 candidate commit SHA。

| 门禁 | 结果 | 证据摘要 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | PASS | 2 个 workspace，lockfile 无修改 |
| `make lint` | PASS | ESLint、Vue TSC、Rust fmt、Clippy `-D warnings` |
| `make test` | PASS | 前端 9 files / 37 tests；Rust 36 tests；loopback bind 在允许本机回环的上下文通过 |
| `make build` | PASS | Vue TSC + Vite production build |
| `pnpm docs:build` | PASS | VitePress client/server build 与页面渲染 |
| `pnpm tauri:build --debug` | PASS | 生成 debug `.app` 与 aarch64 `.dmg`；macOS DMG bundler 在沙箱外完成 |
| RustSec advisory scan | PASS（离线） | 既有本地 database 1177 advisories；0 个未豁免漏洞，17 个既有 allowed warnings；未进行在线 freshness/yanked 查询 |
| `pnpm audit --audit-level high` | PASS | 经明确批准访问 npm 官方 advisory 服务；`No known vulnerabilities found`，且本轮没有依赖或 lockfile 变化 |
| `git diff --check` | PASS | 无 whitespace error |
| secret / scope scan | PASS | 只有 synthetic public test CA；无 private key、token、client secret、生产值、S5B/UI、Tasks、contracts 或 `tauri.conf.json` 改动 |

结构化复审发现第二次 `401` 清理与并发 refresh 之间可能竞态；当前实现已在同一 `refresh_lock` 下按
被拒 access token 执行 compare-and-clear。若另一请求已经发布不同的新 token，则旧请求不得删除新
Keychain session；若被拒 token 仍是当前 token，才清理并转为 signed-out。两条定向并发测试已纳入
上述 Rust 36 tests。

可复现性摘要：

- `src-tauri/Cargo.lock` SHA-256：`94b1ee21ed1bd9e4e97528622971da9241c43c4e497181ec83f77f2da6a5b973`（与 S5A 相同）；
- `pnpm-lock.yaml` SHA-256：`aaa0a300afb760c0a768aebefcf338bdbbb66dd6a62a3a907d456d0246fedc0c`（与 S5A 相同）；
- synthetic public test CA PEM SHA-256：`2c95fe33d6b3fc5d54cc8abcd26d8da92d84bf389468013cbd9cf0ade55384b6`；仓库不含对应 private key。

debug `.app` 的 `codesign -dvv` 结果是 `Signature=adhoc`、`TeamIdentifier=not set`，且没有
provisioning entitlements；`codesign --verify --deep --strict` 也因 bundle 没有可验证的 sealed
resources 而失败。因此 debug bundle 只证明编译和打包，不能作为 Protected Data Keychain 原生 PASS。
真实 localhost IdP/DNS/TLS、live provision、专用数据库 bootstrap、offline ready 与最终 online
preflight 均已 PASS。历史 API JWKS CA `502` 已由 API
`faeb78019d95aaf9dcfbd8493f8bc2ecf7e4bf34` 的 local-profile-only 显式 CA pin 关闭；最终
discovery/JWKS/callback、API health/ready、两个未认证 `401` 与 Tasks edge/direct `404` 全部 PASS。
所以 G3-NP-LOCAL 为 **PASS**，S5B 已获单独批准。signed local bundle、Protected Data Keychain 与
完整 Desktop login/refresh E2E 仍为 S7/G5 的 **NOT RUN**，并继续阻断 S7/G5/生产激活。
