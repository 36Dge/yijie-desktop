#!/bin/bash
set -euo pipefail

desktop_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
host_root="$(cd "$desktop_root/../yijie-agent-host" && pwd -P)"
runtime_root="$(cd "$desktop_root/../yijie-codex/.yijie/build/macos/aarch64-apple-darwin" && pwd -P)"
runtime_binary="$runtime_root/codex"
runtime_manifest="$runtime_root/runtime-manifest.json"
run_id="12800000-0000-4000-8000-000000000010"
driver_nonce="12800000-0000-4000-8000-000000000011"
outer_root=""
run_root=""
fake_pid=""
watchdog_pid=""
started_at="$(date +%s)"
completed=false

content_free_failure() {
  printf '{"schemaVersion":1,"status":"failed","code":"%s"}\n' "$1" >&2
  exit 1
}

port_is_free() {
  ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

cleanup() {
  local cleanup_ok=true
  if [[ -n "$fake_pid" ]] && kill -0 "$fake_pid" 2>/dev/null; then
    kill -TERM "$fake_pid" 2>/dev/null || true
    for _ in {1..100}; do
      kill -0 "$fake_pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$fake_pid" 2>/dev/null; then
      kill -KILL "$fake_pid" 2>/dev/null || true
      cleanup_ok=false
    fi
    wait "$fake_pid" 2>/dev/null || true
  fi
  if [[ -n "$watchdog_pid" ]]; then
    kill "$watchdog_pid" 2>/dev/null || true
    wait "$watchdog_pid" 2>/dev/null || true
  fi
  port_is_free 18080 || cleanup_ok=false
  port_is_free 18082 || cleanup_ok=false
  if [[ -n "$outer_root" && -d "$outer_root" ]]; then
    case "$outer_root" in
      /tmp/yijie-feat128-s10.*|/private/tmp/yijie-feat128-s10.*|/var/folders/*/yijie-feat128-s10.*|/private/var/folders/*/yijie-feat128-s10.*)
        rm -rf -- "$outer_root"
        ;;
      *)
        cleanup_ok=false
        ;;
    esac
  fi
  if [[ "$completed" != true || "$cleanup_ok" != true ]]; then
    return 1
  fi
}

trap 'cleanup || true' EXIT
trap 'content_free_failure whole_timeout' TERM

for required in "$runtime_binary" "$runtime_manifest"; do
  [[ -f "$required" && ! -L "$required" ]] || content_free_failure runtime_unavailable
done
port_is_free 18080 || content_free_failure host_port_occupied
port_is_free 18082 || content_free_failure fake_port_occupied

outer_root="$(mktemp -d "${TMPDIR:-/tmp}/yijie-feat128-s10.XXXXXXXX")"
chmod 0700 "$outer_root"
outer_root="$(cd "$outer_root" && pwd -P)"
run_root="$outer_root/$run_id"
mkdir -m 0700 "$run_root"
for directory in bin host-home codex-home project; do
  mkdir -m 0700 "$run_root/$directory"
done
[[ "$(stat -f '%Lp' "$outer_root")" == 700 && "$(stat -f '%Lp' "$run_root")" == 700 ]] ||
  content_free_failure run_authority_invalid

(
  sleep 180
  kill -TERM $$ 2>/dev/null || true
) &
watchdog_pid=$!

host_source_commit="$(git -C "$host_root" rev-parse HEAD)"
(
  cd "$host_root"
  go build -trimpath -o "$run_root/bin/yijie-agent-host" ./cmd/desktop-host
  go build -trimpath -o "$run_root/bin/feat126-fake-responses" ./cmd/feat126-fake-responses
) >"$run_root/build.log" 2>&1 || content_free_failure fresh_build_failed
host_binary_sha256="$(shasum -a 256 "$run_root/bin/yijie-agent-host" | awk '{print $1}')"
fake_binary_sha256="$(shasum -a 256 "$run_root/bin/feat126-fake-responses" | awk '{print $1}')"

env -i \
  PATH=/usr/bin:/bin \
  YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED=true \
  YIJIE_FEAT126_S10_RUN_ID="$run_id" \
  YIJIE_FEAT126_FAKE_RESPONSES_MODE=complete \
  YIJIE_FEAT126_FAKE_RESPONSES_MAX_CALLS=1 \
  "$run_root/bin/feat126-fake-responses" \
  >"$run_root/fake.stdout.log" 2>"$run_root/fake.stderr.log" &
fake_pid=$!

fake_ready=false
for _ in {1..200}; do
  if curl --noproxy '*' --fail --silent --show-error \
    -H "X-Yijie-Feat126-Run-Id: $run_id" \
    -H 'X-Yijie-Feat126-Fixture-Id: normal-000' \
    -H 'Accept: application/json' \
    http://127.0.0.1:18082/healthz >"$run_root/fake-ready.json" 2>/dev/null; then
    fake_ready=true
    break
  fi
  kill -0 "$fake_pid" 2>/dev/null || content_free_failure fake_exited_early
  sleep 0.1
done
[[ "$fake_ready" == true ]] || content_free_failure fake_ready_timeout

(
  cd "$desktop_root"
  env \
    -u YIJIE_MODEL_PROVIDER \
    -u YIJIE_MINIMAX_API_KEY \
    -u YIJIE_MINIMAX_API_KEY_FILE \
    -u YIJIE_AGENT_HOST_V3_ARTIFACTS_ENABLED \
    -u YIJIE_FEAT128_SYNTHETIC_ENABLED \
    -u YIJIE_FEAT128_SYNTHETIC_MANIFEST \
    YIJIE_RUN_FEAT128_S10_DESKTOP_INTEGRATION=1 \
    YIJIE_CHAT_LOCAL_HOST_ENABLED=true \
    YIJIE_ENV=local \
    YIJIE_AGENT_HOST_BINARY="$run_root/bin/yijie-agent-host" \
    YIJIE_AGENT_HOST_HOME="$run_root/host-home" \
    YIJIE_AGENT_HOST_PORT=18080 \
    YIJIE_CODEX_BINARY="$runtime_binary" \
    YIJIE_CODEX_MANIFEST="$runtime_manifest" \
    YIJIE_CODEX_HOME="$run_root/codex-home" \
    YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED=true \
    YIJIE_FEAT126_S10_RUN_ID="$run_id" \
    YIJIE_FEAT126_FAKE_RESPONSES_BASE_URL=http://127.0.0.1:18082/v1 \
    YIJIE_FEAT126_S10_RUN_ROOT="$run_root" \
    YIJIE_FEAT126_S10_DRIVER_NONCE="$driver_nonce" \
    YIJIE_CHAT_ARTIFACTS_V3_ENABLED=true \
    YIJIE_FEAT128_S10_TEST_PROFILE_ENABLED=true \
    YIJIE_FEAT128_S10_PROJECT_DIR="$run_root/project" \
    cargo test --manifest-path src-tauri/Cargo.toml --features feat128-s10-runtime \
      chat::sidecar::tests::feat128_s10_local_profile_integration -- --exact
) >"$run_root/desktop-integration.log" 2>&1 || content_free_failure desktop_integration_failed

if find "$run_root/host-home/artifact-spool" -type f -print -quit 2>/dev/null | grep -q .; then
  content_free_failure spool_residue
fi
if find "$run_root/host-home" -type f -name '*-wal' -print -quit | grep -q .; then
  content_free_failure host_wal_residue
fi
if find "$run_root/host-home" -type f -name '*-shm' -print -quit | grep -q .; then
  content_free_failure host_shm_residue
fi
if find "$run_root/host-home" -type f -name '*.tmp' -print -quit | grep -q .; then
  content_free_failure host_temp_residue
fi
port_is_free 18080 || content_free_failure host_listener_residue

kill -TERM "$fake_pid" 2>/dev/null || true
for _ in {1..100}; do
  kill -0 "$fake_pid" 2>/dev/null || break
  sleep 0.1
done
kill -0 "$fake_pid" 2>/dev/null && content_free_failure fake_cleanup_timeout
wait "$fake_pid" 2>/dev/null || true
fake_pid=""
port_is_free 18082 || content_free_failure fake_listener_residue

duration_seconds="$(( $(date +%s) - started_at ))"
kill "$watchdog_pid" 2>/dev/null || true
wait "$watchdog_pid" 2>/dev/null || true
watchdog_pid=""
case "$outer_root" in
  /tmp/yijie-feat128-s10.*|/private/tmp/yijie-feat128-s10.*|/var/folders/*/yijie-feat128-s10.*|/private/var/folders/*/yijie-feat128-s10.*)
    rm -rf -- "$outer_root"
    ;;
  *)
    content_free_failure run_authority_invalid
    ;;
esac
[[ ! -e "$outer_root" ]] || content_free_failure cleanup_incomplete
outer_root=""
completed=true
printf '{"schemaVersion":1,"status":"passed","started":4,"progress":4,"completed":4,"get":4,"acked":4,"zeroProvider":true,"zeroNonLoopback":true,"cleanup":true,"durationSeconds":%s,"hostSourceCommit":"%s","hostBinarySha256":"%s","fakeBinarySha256":"%s"}\n' \
  "$duration_seconds" "$host_source_commit" "$host_binary_sha256" "$fake_binary_sha256"
