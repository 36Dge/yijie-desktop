# Security Policy

## 桌面端安全要求

- 不持久化平台 access token；
- 高风险操作必须展示审批卡片；
- 本地 sidecar 状态和日志必须脱敏；
- 不绕过 `yijie-api` 权限和审批策略；
- 不在 fixtures 中保存真实商家数据。

FEAT-125 S5A 的原生 OIDC、Keychain 生命周期、loopback 回调和固定权限投影传输边界见
[`docs/security/FEAT-125-S5A-security-matrix.md`](docs/security/FEAT-125-S5A-security-matrix.md)。

FEAT-125 G3-NP-LOCAL 的本地 CA 信任、`localhost` 限制、Keychain envelope 迁移和本地签名门禁见
[`docs/security/FEAT-125-G3-NP-LOCAL.md`](docs/security/FEAT-125-G3-NP-LOCAL.md)。
