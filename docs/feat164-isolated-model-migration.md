# FEAT-164 isolated legacy storage migration

Contract impact: semantic, Desktop private deployment/bootstrap and existing SQLCipher migration authority. No public wire, Native IPC, schema definition, Runtime or patch change. Whole FEAT-164 remains breaking. Owner authorized review and implementation of the controlled isolated entrance on 2026-10-26; daily migration remains excluded.

Use the canonical packaged candidate only:

```sh
bash scripts/run-local-demo-fast.sh --packaged --kimi-k31-pro --migrate-isolated-k3
```

`--reopen` may be appended only when the existing packaged receipt matches all current inputs. `--prepare-only` cannot be combined with migration. The launcher retains source, Runtime, build and artifact validation, then invokes the same candidate executable with the single maintenance argument in a minimal environment without model credentials. It exits after migration and does not launch the ordinary application. This is not a new Tauri command, permission, sidecar or executable replacement.

The executable recognizes only its compiled FEAT-164 identity, macOS, the candidate build feature and exact local/demo_fast/model/isolated flags with daily=false. There is no caller-selected database path. The root is the normal macOS application-data location for `com.yijie.ai.feat164-kimi-k31-r1/demo-fast-model-candidate-v1`. It acquires the same existing App instance lock, requires canonical private directories and regular single-link owner-only files, and refuses open handles. Daily identity and ordinary startup remain rejected for this transition; the original SQL<38 open guard is unchanged.

Before source writes, it retains DB/WAL/SHM and both existing local keys under an owner-only UUID backup folder with file hashes. A second complete database copy is used for read-only integrity, foreign-key, migration ledger and scope checks so inspection cannot alter the original backup SHM. Existing keys must load successfully; none are generated. Current sources are rehashed and handle absence is checked again immediately before migration.

Supported predecessors are SQL29/37. Other old schema versions remain refused until separately qualified. The entry refuses pending/inflight outbox, unknown model selections, active/uncertain turns, reservations, occupied grants and native bindings without supported terminal history. It does not cancel, refund, clear or reinterpret these facts. Resolve them through the old normal workflow first; unknown work cannot be erased to pass preflight. Active future K3 plans are retired by the existing domain transaction before any worker can run.

The entry uses the existing migration chain to SQL38, then the normal candidate Repository open to SQL41/plan retirement, followed by normal connection close. No DatabaseWorker, auth bootstrap, Host, Runtime, model request or WebView starts. Repeating the entry on supported current storage uses the same reader and idempotent retirement. Backups and closed diagnostic results are retained; no automatic restoration, downgrade, WAL deletion or manual checkpoint exists. If a later step fails, stop and inspect the retained snapshot/result; never start an old writer against partially or fully upgraded data. A compatible candidate reader with execution paused is the rollback direction.

The opt-in integration test `chat::database::isolated_model_migration::tests::feat164_controlled_isolated_migration` consumes freshly generated output from the normal non-candidate `feat164_natural_plan_upgrade` produce phase. `YIJIE_FEAT164_NATURAL_SOURCE` selects only that test input and `YIJIE_FEAT164_MIGRATION_TEST_ROOT` a new retained output; neither is accepted by the product entrance. It verifies normal lock contention, root/identity refusal, occupied-state preservation, actual private migration, sealed backup equality, old facts, idempotence and normal reader reopen. A separate feature-off test rejects before database access. No fault/attack injection or real provider calls.

These checks do not qualify full App S2/S3 workflows, real-provider G2V, daily cutover or release. Evidence and final build/entry results belong to meta FEAT-164 report45.
