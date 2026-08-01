# FEAT-125 S6 UI Policy Matrix

Date: 2026-08-01

Owner / reviewer / technical lead: 段成威

Baseline: `f94ac343881b0f7df59c0f5f4169372e612fd019`

Contracts candidate: `9ec34abd6e7dfb5a23b0154d467694167224ebbb`
Status: implementation and local gates PASS; commit/remote SHA pending explicit commit approval

## 1. Approved scope

S6 only wires the existing S5B memory-only authoritative permission store into Desktop navigation,
router, AppShell and Settings recovery. It does not change Contracts, API, Tasks, Rust refresh or
Keychain lifecycle, production IdP values, signing, notarization, deployment or production
activation.

The build flag is fixed as `VITE_YIJIE_AUTHORITATIVE_PERMISSION_UI_ENABLED`. Only the exact string
`true` enables permission discovery and protected UI. Missing, malformed or false values keep all
protected entries closed while preserving Settings core login/logout recovery. The kill switch never
falls back to a static allow-list or the former optional `{}` visibility projection. Per-user/cohort
runtime control is not implemented in S6 and remains a G5 release-control concern.

## 2. Policy matrix

| State | Navigation | Root/direct route | Settings recovery |
| --- | --- | --- | --- |
| UI flag off | Settings only | `/` and protected deep links → `/settings` | login/logout; no tenant or capability request |
| discovering/loading | Settings only | protected page is not rendered; route → `/settings` | progress copy, retry/logout |
| zero tenants | Settings only | `/settings` | retry, login/change account, logout |
| one tenant | capability projection is loaded automatically | root priority applied after ready | current tenant, revision and expiry |
| multiple tenants | Settings only until explicit choice | `/settings` | accessible tenant chooser; no last-tenant persistence |
| ready + published capability | matching entry visible and enabled | route reachable | current context remains visible |
| ready + unpublished capability | matching entry visible, disabled, “即将开放”, no route | no unpublished route exists | unchanged |
| ready without capability | entry absent from DOM/AX tree | deep link → `/access-denied`; business loader not called | Settings remains reachable |
| unauthorized/denied/invalid/unavailable | Settings only | protected page not rendered | stable recovery copy; retry/login/logout as applicable |
| expiry/foreground | current protected view is unmounted/left before refresh | recovery first, then fresh projection | no stale projection or tenant persistence |

Root routing is exact: `task.create → /chat`, otherwise `task.read → /tasks`, otherwise
`/settings`. Settings core has no capability. Capability details and native/provider error details are
not rendered.

## 3. Security and accessibility assertions

- Protected pages are lazy route components. The global guard runs before their loader, and a denied
  deep-link test asserts that the business loader call count remains zero.
- App-level render protection independently unmounts an already-open protected view as soon as the
  projection leaves ready state.
- Navigation visibility is a total capability map. Denied entries are removed before `YjSidebar`
  renders, rather than hidden with CSS.
- Allowed unpublished entries are non-link `div[aria-disabled=true]` controls with the accessible
  label “模块，即将开放”.
- Settings recovery uses headings, `role=status`, `role=alert`, `fieldset/legend`, `aria-busy`,
  `aria-pressed` and keyboard focus styles.
- Native login/logout use only the existing fixed `native_auth_login` and `native_auth_logout`
  commands. The adapter validates the exact status enum and normalizes failures without reflecting
  provider data.

## 4. Structured review

| Finding | Severity | Resolution |
| --- | --- | --- |
| S6-REV-001 | P1 / resolved | Removed the optional AppShell visibility input and default `{}` fail-open behavior; production derives a total projection from the authoritative store. |
| S6-REV-002 | P1 / resolved | Replaced eager business page imports with guarded lazy loaders; denied deep-link tests prove the protected loader is never invoked. |
| S6-REV-003 | P1 / resolved | Startup discovery is single-flight and logout invalidates the tracked initialization by identity, so a stale request cannot block or overwrite a new login context. |
| S6-REV-004 | P1 / resolved | Request phase changes to non-ready before projection clearing; expiry/refresh therefore unmounts protected UI before any stale capability can be reused. |
| S6-REV-005 | P2 / resolved | Logout now clears the store even when the native request fails and retains a visible re-auth recovery action. |

Final open P0/P1/P2 findings in S6 scope: **0**.

## 5. Verification evidence

| Gate | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS; lockfile stable after exact test dependency update |
| `pnpm generate:check` | PASS; exact candidate `9ec34abd...`, openapi-typescript 7.13.0, TypeScript 5.9.3 |
| `make lint` | PASS; ESLint, Vue TSC, Rust fmt and Clippy `-D warnings` |
| `make test` | PASS; frontend 18 files / 113 tests; Rust 36 tests plus doc-tests |
| `make build` | PASS; Vue TSC and Vite production chunks, including lazy protected pages |
| `pnpm docs:build` | PASS; VitePress client/server build and rendering |
| `pnpm tauri:build --debug` | PASS; local unsigned `.app` and aarch64 `.dmg` |
| `pnpm audit --audit-level high` | PASS; no known vulnerabilities |
| `cargo audit --file src-tauri/Cargo.lock` | PASS; 0 vulnerabilities and the same 17 allowed unmaintained/unsound warnings |
| JS license scan | PASS; 11 license groups, no AGPL/GPL/SSPL/BUSL/Commons-Clause group |
| `git diff --check` | PASS |

Current evidence digests before commit:

- `pnpm-lock.yaml`: `649b6c2c81c5d89f83a22ee2b524f18bc6ab9098e6cd94fc467b3dfed472b9e2`
- unsigned debug DMG: `207757adaecc172ac182e916445e0ebc903a4e8c3bab1c2477040c4e72f735cb`

Browser verification used the real Vite application at 1280×720:

- flag off: `/` and `/chat` resolved to `/settings`; Settings was the only navigation item;
  protected link count and chat input count were both zero;
- expanded and 72 px collapsed sidebar states had no horizontal overflow; collapsed preference
  survived reload;
- flag on without a Tauri provider: protected deep-link failed closed to Settings with “权限服务暂不可用”,
  no protected links/input and no browser warning/error logs;
- component tests cover ready allowed/denied/unpublished DOM/AX behavior and 0/1/multiple tenant states.

## 6. Residual boundaries

The following remain deliberately `NOT RUN` and belong to S7/G5: signed App and complete Keychain
E2E, browser OIDC with bearer transport, 2 roles × 2 tenants live cross-repo E2E, production IdP/API
configuration, signing/notarization, release and production activation. The S6 candidate remains
default-off and is not a release approval.
