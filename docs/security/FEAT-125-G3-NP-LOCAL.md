# FEAT-125 G3-NP-LOCAL：Desktop 本地信任与 Keychain 隔离

## 1. 范围与状态

本切片只为完全本地、仅合成数据的类生产集成环境补齐 Desktop 原生边界：

- 为 OIDC 和 permission operation transport 注入同一个、显式固定的本地 CA；
- 将 local-integration origin 限制为精确 `localhost`，IdP 与 API 可使用不同 HTTPS port；
- 将 refresh token Keychain envelope 升级为 v2，并绑定 environment、issuer 和 client ID；
- 清理旧格式、双版本或绑定不匹配的记录，要求重新登录；
- 保留 S5A 的 HTTPS-only、证书 hostname/SAN 校验、禁止 redirect、loopback callback 和 token 生命周期约束。

不包含 S5B/UI、Tasks、公共 HTTP contract、生产 IdP/API 值、生产签名或生产激活。仓库不提供真实 CA、
CA 私钥、provisioning profile、签名身份或 token。当前 contract impact 为 `semantic`：变化只涉及 Desktop
部署配置接口与本地持久化 schema；公共 contracts 字段为 `N/A`，因为没有修改公共 wire。

## 2. 启用条件与配置

原生认证仍由 `YIJIE_DESKTOP_NATIVE_AUTH_ENABLED=true` 显式启用。缺少
`YIJIE_DESKTOP_AUTH_ENVIRONMENT` 时按 `production` 解析；production 模式只使用编译时固定的 WebPKI
roots，只要出现任一本地 CA 变量就 fail-closed。

只有同时满足以下条件才进入 local-integration：

| 变量 | 约束 |
| --- | --- |
| `YIJIE_DESKTOP_AUTH_ENVIRONMENT` | 必须精确为 `local-integration` |
| `YIJIE_DESKTOP_OIDC_ISSUER` | HTTPS，host 必须精确为 `localhost` |
| 四个 OIDC endpoint | HTTPS，必须与 issuer 同 origin |
| `YIJIE_DESKTOP_API_ORIGIN` | `https://localhost:<port>/` 根路径 |
| `YIJIE_DESKTOP_LOCAL_CA_PEM_PATH` | 绝对路径；最终节点必须是 regular file，不能是 symlink |
| `YIJIE_DESKTOP_LOCAL_CA_SHA256` | CA PEM 文件字节的 64 位、小写十六进制 SHA-256 |

CA 文件还必须满足：

- 大小为 1 至 64 KiB；
- Unix mode 只能为 `0400` 或 `0600`；
- 只含一个 PEM certificate，不能是 bundle，不能含任何 private-key block；
- PEM 解析成功且文件内容与 SHA-256 pin 常量时间匹配。

local-integration 不接受 `.test`、公网 hostname、`127.0.0.1` 作为 issuer/API host，也不接受 HTTP。
这避免修改 `/etc/hosts`，并阻止本地 CA 模式被扩展为任意外部网络目标。OIDC callback 不变，仍精确为
`http://127.0.0.1:<ephemeral-port>/oauth/callback`。

本地 CA 模式下，两个 Rust `reqwest` client 都关闭内置 roots，只信任该 pinned CA；TLS hostname/SAN
验证仍由 rustls 执行。代码中没有 `danger_accept_invalid_certs`、HTTP fallback 或 redirect fallback。
系统浏览器不使用 Rust trust store，因此还必须由操作者将同一个公开 CA certificate 加入当前 macOS
测试用户的信任存储。CA 私钥必须保留在仓库外的本机受限目录，绝不能导入应用或提交 Git。

pin 可在配置前离线计算：

```bash
shasum -a 256 /absolute/path/to/feat-125.local-ca.pem
chmod 0600 /absolute/path/to/feat-125.local-ca.pem
```

所有变量必须在 Tauri 进程启动前注入；Runtime 启动后不会重新读取环境。

## 3. Keychain v2 与兼容策略

Protected Data Keychain service 保持 `ai.yijie.desktop.auth`，v2 使用独立 account
`refresh-token-family-v2`。旧实现的 `refresh-token-family` 只作为迁移检测项，不再写入。

v2 envelope 使用严格 schema，包含：

- `schema_version = 2`；
- `environment`；
- canonical `issuer`；
- public `client_id`；
- refresh token 与原有 issued/last-used/absolute-expiry 时间。

读取行为固定如下：

1. v2 记录严格解码并与当前 environment、issuer、client ID 精确匹配时才可 refresh/revoke；
2. 旧 account 存在、v2 解码失败、schema version 不匹配或任一 binding 不匹配时，删除新旧两个 account，
   清空内存 access token，并返回 signed-out；
3. 被拒绝记录永远不会被发送到当前 token/revocation endpoint；
4. v2 使用独立 account，回滚到旧 Desktop 时旧 reader 看不到 v2，只会得到 signed-out，而不会因新 schema
   解析失败卡死；再次升级如发现旧版新写入的 legacy record，会清理双版本状态并要求重新登录。

## 4. S7/G5 本地 bundle 与 provisioning 模板

Protected Data Keychain 不能由普通未签名的 `tauri:dev` 进程验证。该验证属于后续 S7/G5 原生运行时
门禁，必须使用带 Apple Development provisioning profile 和 entitlements 的签名 `.app`；它不是
G3-NP-LOCAL 环境就绪或批准 S5B 的前置。仓库不生成或伪造这些材料。

操作者需要在本机准备并在证据中填写：

| 项目 | 本地集成值 |
| --- | --- |
| bundle identifier | 建议 `com.yijie.ai.local`，不得与生产 `com.yijie.ai` 共用 |
| signing identity | `NOT PROVIDED`，由本机 Apple Development 身份提供 |
| provisioning profile | `NOT PROVIDED`，必须匹配本地 bundle identifier |
| Keychain access group | `NOT PROVIDED`，必须与本地 profile/entitlements 一致 |
| synthetic IdP public client | `NOT PROVIDED`，无 client secret |

本地 bundle identifier/access group 隔离是第一层；v2 envelope binding 是第二层。禁止为了绕过 provisioning
切换到 localStorage、普通文件或降低 Keychain access policy。生产 `tauri.conf.json` 本切片不修改。

## 5. 两层验证门禁

### 5.1 G3-NP-LOCAL 环境兼容性（批准 S5B 的前置）

仓库内可执行门禁：

- 配置正负矩阵：默认 production、本地显式启用、精确 localhost、HTTP/公网拒绝；
- CA 正负矩阵：pin、大小、mode、symlink、bundle、private key 拒绝；
- OIDC/API 两个 client 共享 hardened builder，继续 HTTPS-only 和 no redirect；
- Keychain v1/v2、未知字段、binding mismatch、清理和回滚 reader 行为；
- `make lint`、`make test`、`make build`、`pnpm docs:build` 与依赖/secret/scope 检查。

只有以下本地环境兼容性验证全部完成后才能把 G3-NP-LOCAL 标为 PASS：

1. 由 preflight 进程使用显式 CA 验证 `localhost` TLS leaf 的 SAN 与 CA 链，错误 CA、错误 SAN
   或过期证书必须 fail-closed；
2. synthetic IdP、DNS/TLS 与 API origin 的 bootstrap/preflight 通过；
3. API 的 offline ready 与 online preflight 通过，包括 discovery/JWKS 可达性、TLS、健康检查以及
   tenants/capabilities producer 边界；
4. 仓内配置、CA、Keychain binding、错误语义及 fail-closed 正负矩阵通过。

这些证据证明本地环境能够承载后续 Desktop 集成，不代表 native login/refresh 或 Protected Data Keychain
端到端已经通过。满足本节即可将 G3-NP-LOCAL 标为 PASS，并批准进入 S5B。

### 5.2 S7/G5 原生运行时（不阻断 S5B）

以下验证需要签名身份/profile 或完整 Desktop 原生流程，保留到 S7/G5：

1. signed local `.app` 对 Protected Data Keychain 完成 save、restart/load、rotation、logout/delete；
2. 旧 account、错误 environment/issuer/client 的记录只触发删除和重新登录，不产生网络 refresh/revoke；
3. 系统浏览器与两个真实 Rust HTTP client 使用同一 localhost 环境完成信任正负矩阵；
4. Desktop 完成系统浏览器 login、精确 callback、refresh rotation、tenants/capabilities 与故障矩阵；
5. 证据中登记 local bundle/profile/entitlement 摘要，但不得记录 token、私钥或完整 provisioning 内容。

未获得 provisioning profile 时，上述 S7/G5 项必须保持 `NOT RUN`，不能以 unit test 或普通 debug
`.app` 替代；该状态不降低 G3-NP-LOCAL 环境兼容性结论，也不阻断 S5B。

## 6. 回滚

回滚优先关闭 `YIJIE_DESKTOP_NATIVE_AUTH_ENABLED` 并移除 local-integration 环境变量。production 模式会
拒绝本地 CA 变量，不能静默继承本地 trust。v2 独立 account 保证旧 reader 不解析新 envelope；回滚版本
将表现为 signed-out。恢复新版本后，如同时发现 legacy/v2 记录则清理并要求重新登录。

回滚不删除真实用户或生产数据；本地环境只允许 synthetic identity/tenant。CA 信任与本地签名材料的系统级
移除属于操作者控制面操作，本仓不自动执行。
