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
3. 新 OIDC token 在 Keychain load/save 失败时可能成为服务器端孤儿会话；失败分支现在先撤销新 refresh token。
4. refresh 返回同 token、缺失 refresh token 或非法 token response 时原本可能保留旧 family；现在统一 fail-closed、撤销并清理。
5. callback parser 增加精确可选 issuer、request-body/transfer-encoding 拒绝与安全响应 header。
6. npm high advisory `GHSA-mh99-v99m-4gvg` 通过 workspace override `brace-expansion=5.0.8` 关闭。

最终审查结论：S5A 范围内无未关闭的 P0/P1/P2 finding；没有 Desktop access-JWT verifier、通用原生
HTTP 代理、token IPC、深链/嵌入式登录、Tasks/UI 修改或生产激活。

## 7. 明确保留给 G3/G5 的验证

以下项目本轮为 **NOT RUN（按范围保留）**，不能解释为已通过生产验证：

- 真实 IdP issuer/client/JWKS/revocation endpoint 的端到端登录、refresh rotation/reuse-family 行为；
- 真实生产 API origin 上的 tenants/capabilities producer-consumer 联调；
- 带正式 provisioning、签名、公证和 entitlements 的 App 对 Protected Data Keychain 的读写/删除；
- 生产 CSP、发布配置、灰度、回滚和生产激活；
- S5B/UI 与 generated DTO consumer。
