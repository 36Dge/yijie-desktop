# FEAT-164 retained delivery verification

This opt-in check exercises normal repository acceptance, claim, cancellation
before any sender starts, receipt replay and reopening. It uses a new isolated
directory and ordinary synthetic text. It does not launch an App, Host, Runtime
or provider, inject a fault, modify an existing database, or delete its evidence.

Run the exact ignored Rust test with the existing local K31 candidate flags and
`YIJIE_FEAT164_DELIVERY_EVIDENCE_ROOT` pointing to a new absolute directory whose
name starts with `feat164-retained-delivery-`. The test rejects existing paths
and any path containing a `Library` component. It retains the encrypted test
database, workspace and `result.json`. Test keys are fixed synthetic bytes used
by the test code; they are not credentials or an App key store.

The selector is
`chat::delivery::tests::feat164_delivery_retained_normal_queue_cancel`; run it
with `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --lib
--features kimi-k31-pro-candidate <selector> -- --exact --ignored --nocapture`.
Set `YIJIE_ENV=local`, `YIJIE_LOCAL_PROFILE=demo_fast`,
`YIJIE_CHAT_MODELS_ENABLED=true` and `YIJIE_KIMI_K31_PRO_CANDIDATE=true`.
An exact run must report one passed test and zero ignored tests.

Then set `YIJIE_FEAT164_DELIVERY_EVIDENCE_FILE` to that `result.json` and run
`pnpm exec vitest run src/components/chat/ChatDeliveryControl.retained.test.ts`.
This consumes the actual Native output through the production IPC parser,
composable and mounted control, with only the transport replayed. Without the
explicit file it is skipped; a skip is not qualification. This is safe layered
Native/consumer evidence, not a complete App/WebView cancellation run.

An old queued row without a delivery proof is not this positive case. A Native
model intent whose phase is `unknown` with a missing Host receipt is also not
proof of no dispatch. Preserve both; do not backfill facts or clear the operation
to make these checks pass. See meta FEAT-164 report57 for the actual natural
unknown observation and the independently retained positive cancellation data.
