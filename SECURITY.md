# Security Policy

## 桌面端安全要求

- 不持久化平台 access token；
- 高风险操作必须展示审批卡片；
- 本地 sidecar 状态和日志必须脱敏；
- 公开或生产模式不绕过 `yijie-api` 权限和审批策略；
- 不在 fixtures 中保存真实商家数据。

本地 `demo_fast` 是明确的快速验证例外：它不做用户登录，也不依赖 `yijie-api`/Keycloak 启动，
而由 Rust 绑定固定的 local owner/tenant/capability 并继续执行 context、session、Artifact scope 校验。
该例外只能由 `YIJIE_ENV=local + YIJIE_LOCAL_PROFILE=demo_fast` 的精确组合通过 canonical launcher
启用；Agent Host loopback token 与 MiniMax Key 仍必须使用 owner-only 存储，不能暴露给 WebView。

FEAT-125 S5A 的原生 OIDC、Keychain 生命周期、loopback 回调和固定权限投影传输边界见
[`docs/security/FEAT-125-S5A-security-matrix.md`](docs/security/FEAT-125-S5A-security-matrix.md)。

FEAT-125 G3-NP-LOCAL 的本地 CA 信任、`localhost` 限制、Keychain envelope 迁移和本地签名门禁见
[`docs/security/FEAT-125-G3-NP-LOCAL.md`](docs/security/FEAT-125-G3-NP-LOCAL.md)。
