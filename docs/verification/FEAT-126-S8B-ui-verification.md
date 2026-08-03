# FEAT-126 S8B Vue UI verification

Status: `Closure Review candidate`

Scope: LIA-126-006 / S8B only

Data: fixed synthetic fixtures only
Feature activation: disabled

## Fixed inputs

- Desktop implementation baseline: `5dab02a1ad5f03fead236aa7060fa6a75a234d85`
- Contracts identity: `29317b6426578749dc698fc2ad32b986ee5c8e9f`
- Production gate remains exact `VITE_YIJIE_CHAT_LOCAL_UI_ENABLED === "true"`; no environment, CI, default development, or build configuration enables it.
- The visual harness under `tests/visual/feat-126-s8b/` mounts production Vue components and the real Pinia reducer with fixed synthetic projections. It is not reachable from the production Vite entry and is absent from `dist/`.

## Automated evidence

| Gate | Result |
|---|---|
| `pnpm lint` | Pass |
| `pnpm test` | Pass: 29 files, 164 tests |
| axe component audit | Pass: 0 serious/critical violations; color contrast stays in the real-browser matrix because happy-dom has no layout engine |
| `pnpm build` | Pass |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Pass: 95 passed, 0 failed, 1 pre-existing isolated Keychain integration test ignored |
| `pnpm audit --audit-level high` | Pass: no known vulnerabilities |
| `git diff --check` | Pass |
| production bundle dependency scan | Pass: no `axe-core`, visual harness, synthetic fixture, or test global in `dist/` |
| UI boundary scan | Pass: no `chatClient`, raw `invoke`, or `v-html` in the S8B page/components |
| secret/path/flag scan | Pass: no key, bearer, private path, raw ID marker, or enabled chat flag in the S8B projection/harness |

The first sandboxed Rust run was rejected by operating-system restrictions on loopback sockets, SQLCipher temporary file permissions, and macOS security-scoped bookmarks. The unchanged suite was rerun outside that sandbox and passed; no Rust source was modified.

## Real-browser visual and interaction matrix

| Scenario | Result |
|---|---|
| New task, light, 1180×760 | Pass; project selector, read-only permission entry, readiness, pure-text composer, and disabled empty send are visible |
| Active stream, light, 1180×760 | Pass; session tree, user/assistant text, historical/live reasoning, stream status, interrupt, history paging, and bottom control are present |
| Active stream, dark, 1180×760 | Pass; no horizontal overflow; plain-text message/reasoning containers have no HTML descendants |
| 200% zoom equivalent, 590×380 CSS viewport | Pass; document and main content have no horizontal overflow; primary controls remain reachable by vertical scrolling |
| Permission dialog | Pass; stable read-only/deny copy, modal semantics, focus trap sentinel, and focus restoration to the permission trigger |
| Session delete dialog | Pass; only closed destructive copy/actions; cancel restores focus to the exact session menu trigger |
| Reduced motion | Pass by composable/unit contract: bottom scrolling uses `auto`, and caret/loader/transition animations are disabled |
| Scroll thresholds | Pass by exact unit contract: follow at `<=48px`, bottom button at `>160px`, exact accessible label `滚动到对话底部` |

## Scope assertions

- No Vue component calls the Tauri client, a raw command, Host, or Runtime directly.
- Assistant output and raw reasoning use Vue text interpolation only; Markdown and HTML execution are intentionally absent.
- No attachment, image, file, model, reasoning-strength, voice, copy, edit, like, dislike, fork, window-pin, or chat-sidebar-toggle control is exposed.
- Delete navigation remains controlled by the authoritative store's closed `DeleteDisposition` projection observed by the existing App orchestration.
- No private IPC, Rust domain, central contracts, Host wire, Public Tasks wire, or Runtime pin changed.
- No MiniMax call, real user data, feature activation, S9–S11 work, push, merge, tag, publish, or deploy occurred.

## Manual handoff

The VoiceOver checklist is maintained in `docs/verification/FEAT-126-S8B-voiceover-checklist.md`. Execution by the Owner is an explicit S8B Closure Review acceptance activity; this evidence does not claim that a human VoiceOver pass has already occurred.
