# FEAT-164 primary deployment v3

2026-10-28. Private deployment interface, `contract-impact=semantic`. Owner requested direct build/run from the original `yijie-desktop` main checkout after plan and audit. Existing schema 1/2 and their separated-source restrictions remain unchanged. Public DTOs, Native SQL41, Host11, writer4/reader5 and Runtime r5 do not change.

## Source and outputs

`primary_source.kind=original-main-checkout`; source root is this script's actual Desktop root and must have its own real `.git` directory. Linked worktrees, path aliases and another Desktop root are rejected. Host, Contracts, Connectors, Skills and Runtime remain the existing sibling sources. All must be committed and clean for preparation. Their complete commits, real paths and the build environment digest are recorded in the generation descriptor and bound by the packaged receipt. Runtime libraries/artifacts retain their existing immutable pins.

A generation ID is `YYYYMMDD-NN`. `.local/builds/primary/<id>/` contains only `generation.json`, `environment.json`, `target/`, `worker-target/`, `worker/`, `bin/`, the canonical receipt and explicit activation records. It contains no source copy. Preparation creates a fresh generation exclusively; it never reuses or overwrites a prior generation. Cargo and Tauri use that generation's `target`, while the canonical worker gets both `worker-target` and `worker` manifest output. Existing `src-tauri/target` Apps and the Connectors default manifest stay untouched. Existing ordinary `dist` and Skills output slots are retained in the verified pre-operation backup before normal canonical regeneration; their actual packaged bytes are still checked.

The worker build interface adds one optional `--output-root <absolute-directory>` argument. It accepts only an existing real owner-owned directory without group/other write access and refuses an already present `current.json`. It keeps content-addressed binaries and manifest v2 semantics. The canonical Desktop caller supplies only this generation's `worker` directory; worker target is separately explicit. The legacy argument-free build retains its prior output behavior. There is no new tool permission or provider behavior.

## Binding and authority

Schema 3 uses `feat164-primary-existing-homes-v3`; it requires the original Desktop root equal to the actual source root. `primary_source` contains exact kind/root/generation/descriptor digest. Native remains `~/Library/Application Support/com.yijie.ai/demo-fast-v1`; Host and Runtime stay in the original `.local/demo-fast` Homes. No D3 migration is accepted. A v1/v2 record cannot become primary by editing a path.

D4 requires a fresh zero-dispatch preflight, short expiry, `model_http_limit=0` and Kimi paused. D5 requires explicit new-source approval, real D4 evidence, activation preflight, ADR-0022 single-owner-local scope and all existing permissions. Old fixed-source D4/D5 cannot be reused. Approval records are created only by the reviewed operation after the relevant evidence exists; the product commands never manufacture, renew or upgrade approval.

`pnpm daily:prepare --generation <id>` builds only. `pnpm daily:verify --generation <id>` uses the separately approved D4 record. `pnpm daily:open --generation <id> [--pause-kimi]` uses the D5 record. These invoke this checkout's canonical launcher with a clean allowlisted environment recorded at preparation. Ambient Tauri, source, model URL, Home, feature or credential overrides are not forwarded. Each open verifies the descriptor, environment, explicit binding digest, full current source/artifact receipt and existing authenticated workflow readiness. No implicit service recovery, database migration or model send occurs. The default historical development command is not silently redirected.

The current operation keeps all original WIP in separately labelled local recovery commits and verified private archives. They are not automatically qualified or activated. Existing fixed-source artifacts remain for controlled rollback; reverting source does not replace or downgrade daily databases. No directory cleanup or shortcut installation is part of this interface.

## Validation

### Observation builds require an explicit launch selection (2026-10-29)

`--feat162-observe` freezes a temporary loopback model transport at preparation. Such a generation is an acceptance build, even though it shares the primary layout and the original daily data. It is not a normal daily build. `daily:open` and `daily:verify` now require the same explicit flag to open it; the flag cannot convert an ordinary generation into an observation generation. Even `--pause-kimi` does not waive this check, because the observation endpoint also overrides MiniMax.

Before the launcher starts any service or App, an explicit observation open checks the existing meter's `GET /health` directly at `127.0.0.1:18083`, with a two-second timeout and a 4 KiB body limit. A missing, halted, non-FEAT-162 or invalid responder stops launch with an actionable message. Redirects are not followed. An unarmed healthy meter is allowed for zero-dispatch startup; this check neither arms it nor grants a model allowance. Availability after the check is not guaranteed. A later transport failure remains a failed turn, with no direct-provider fallback or automatic resubmission.

Returning to daily use requires preparing a fresh generation **without** `--feat162-observe`, followed by its existing source, receipt, D4 and D5 checks. Do not edit an existing generation's environment, digest or approval. Existing observation artifacts and ledgers remain intact. This is a breaking change to the private observation launch CLI (an additional explicit flag is now mandatory); ordinary daily invocation and all public wire/storage contracts stay unchanged. No model or tool execution is authorized by selecting either launch profile.

Use ordinary synthetic directories and parser values to verify schema 1/2 parity, schema3 D4/D5, exact primary root/generation matching, changed digest rejection, D3 rejection, no automatic activation and new-output preservation. No replacement executables, broken permissions, malicious archives or forced process exits. Actual preparation and zero-model normal App start/history/quit are separate qualification steps. Preserve the owner's existing exclusions and accepted layered evidence.

## System Quit lifecycle

The first primary build revealed that macOS Quit AppleEvents reached NSApplication termination outside the custom menu action. An exit code alone did not prove cleanup: the stopped-generation record was absent and Native WAL remained. Desktop now registers only its standard `aevt/quit` event with Foundation and routes it to the existing ExitOwner. Menu, window and system Quit share the same idempotent stop/wait/checkpoint chain; no process kill, external command, Runtime patch, new IPC permission or database migration is added. Main-thread registration is retained until cleanup finishes. Failure retains STOP_PENDING and ownership. Each new build still requires actual normal shutdown/post-state qualification; the first failed candidate remains failed.

## Daily media versus the unqualified file candidate

FEAT-162's actual App check exposed that FEAT-165 file support inherited the K3.1 media flag, while the independent database guard correctly refused its daily SQL42 migration. `files_enabled()` now excludes `YIJIE_FEAT164_DAILY=true`. Daily media stays enabled, consumes the existing v9 artifact stream and retains SQL41. Non-daily candidates retain their prior file behavior; the database migration guard stays intact. This is a semantic private-profile availability repair, not FEAT-165 daily activation. An explicitly invoked ordinary SQL41 open/reopen regression reproduces the old failure and verifies retained data without migration.
