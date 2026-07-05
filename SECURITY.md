# Security Policy

## 桌面端安全要求

- 不持久化平台 access token；
- 高风险操作必须展示审批卡片；
- 本地 sidecar 状态和日志必须脱敏；
- 不绕过 `yijie-api` 权限和审批策略；
- 不在 fixtures 中保存真实商家数据。
