#!/bin/bash
set -euo pipefail

desktop_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
host_root="$(cd "$desktop_root/../yijie-agent-host" && pwd -P)"
contracts_root="$(cd "$desktop_root/../yijie-contracts" && pwd -P)"
runtime_root="$(cd "$desktop_root/../yijie-codex/.yijie/build/macos/aarch64-apple-darwin" && pwd -P)"
runtime_binary="$runtime_root/codex"
runtime_manifest="$runtime_root/runtime-manifest.json"
run_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
driver_nonce="$(uuidgen | tr '[:upper:]' '[:lower:]')"
outer_root=""
run_root=""
fake_pid=""
desktop_pid=""
watchdog_pid=""
completed=false
diagnostic_json=""
result_passed=false
residue_classification=""
wal_state=""
cleanup_desktop=true
cleanup_web_content=true
cleanup_host=true
cleanup_fake=true
cleanup_listeners=true
cleanup_wal=true
cleanup_spool=true
cleanup_temp=true
cleanup_run_root=false

content_free_failure() {
  printf '{"schemaVersion":1,"status":"failed","failureCode":"%s"}\n' "$1" >&2
  exit 1
}

port_is_free() {
  ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

process_alive() {
  local pid="$1"
  local state
  kill -0 "$pid" 2>/dev/null || return 1
  state="$(ps -p "$pid" -o stat= 2>/dev/null | tr -d '[:space:]')"
  [[ -n "$state" && "$state" != Z* ]]
}

stop_pid() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  process_alive "$pid" || return 0
  kill -TERM "$pid" 2>/dev/null || true
  for _ in {1..100}; do
    process_alive "$pid" || return 0
    sleep 0.1
  done
  kill -KILL "$pid" 2>/dev/null || true
  return 1
}

safe_remove_root() {
  [[ -n "$outer_root" && -d "$outer_root" ]] || return 0
  case "$outer_root" in
    /tmp/yijie-feat128-s10d.*|/private/tmp/yijie-feat128-s10d.*|/var/folders/*/yijie-feat128-s10d.*|/private/var/folders/*/yijie-feat128-s10d.*)
      rm -rf -- "$outer_root"
      ;;
    *)
      return 1
      ;;
  esac
}

classify_s10d_residue() {
  local desktop_chat="$run_root/desktop-app-data/chat"
  if [[ -f "$desktop_chat/conversations.db-wal" ]]; then
    if [[ -s "$desktop_chat/conversations.db-wal" ]]; then
      printf '%s' desktop_sqlcipher_wal:nonempty
    else
      printf '%s' desktop_sqlcipher_wal:empty
    fi
  elif [[ -f "$desktop_chat/conversations.db-shm" ]]; then
    printf '%s' desktop_sqlcipher_shm
  elif find "$run_root" -path "$run_root/host-home" -prune -o -type f -name '*.tmp' -print -quit 2>/dev/null | grep -q .; then
    printf '%s' desktop_atomic_tmp
  elif find "$run_root/host-home/artifact-spool" -type f -print -quit 2>/dev/null | grep -q . ||
      find "$run_root/host-home" -type f -name '*.tmp' -print -quit 2>/dev/null | grep -q .; then
    printf '%s' host_spool_or_tmp
  elif find "$run_root" -type f \( -name '*-wal' -o -name '*-shm' -o -name '*.tmp' \) -print -quit 2>/dev/null | grep -q .; then
    printf '%s' unknown_storage_residue
  fi
}

cleanup() {
  local ok=true
  [[ -z "$desktop_pid" ]] || { stop_pid "$desktop_pid" || ok=false; wait "$desktop_pid" 2>/dev/null || true; }
  [[ -z "$fake_pid" ]] || { stop_pid "$fake_pid" || ok=false; wait "$fake_pid" 2>/dev/null || true; }
  [[ -z "$watchdog_pid" ]] || { kill "$watchdog_pid" 2>/dev/null || true; wait "$watchdog_pid" 2>/dev/null || true; }
  port_is_free 18080 || ok=false
  port_is_free 18082 || ok=false
  safe_remove_root || ok=false
  [[ "$completed" == true && "$ok" == true ]]
}

trap 'cleanup || true' EXIT
trap 'content_free_failure runtime_global_timeout' TERM

[[ "$(uname -s)" == Darwin ]] || content_free_failure runtime_platform_invalid
for required in "$runtime_binary" "$runtime_manifest" /usr/sbin/screencapture; do
  [[ -f "$required" && ! -L "$required" ]] || content_free_failure runtime_prerequisite_invalid
done
port_is_free 18080 || content_free_failure runtime_host_port_occupied
port_is_free 18082 || content_free_failure runtime_fake_port_occupied

outer_root="$(mktemp -d "${TMPDIR:-/tmp}/yijie-feat128-s10d.XXXXXXXX")"
chmod 0700 "$outer_root"
outer_root="$(cd "$outer_root" && pwd -P)"
run_root="$outer_root/$run_id"
mkdir -m 0700 "$run_root"
for directory in bin host-home codex-home project target; do
  mkdir -m 0700 "$run_root/$directory"
done
result_path="$run_root/s10d-h-result.json"
control_path="$run_root/s10d-h-window.json"
screenshot_path="$run_root/s10d-h-window.png"
screenshot_ack_path="$run_root/s10d-h-screenshot.ack"
[[ "$(stat -f '%Lp' "$outer_root")" == 700 && "$(stat -f '%Lp' "$run_root")" == 700 ]] ||
  content_free_failure runtime_authority_invalid

(
  sleep 300
  kill -TERM $$ 2>/dev/null || true
) &
watchdog_pid=$!

desktop_source_commit="$(git -C "$desktop_root" rev-parse HEAD)"
host_source_commit="$(git -C "$host_root" rev-parse HEAD)"
contracts_source_commit="$(git -C "$contracts_root" rev-parse HEAD)"

(
  cd "$host_root"
  go build -trimpath -o "$run_root/bin/yijie-agent-host" ./cmd/desktop-host
  go build -trimpath -o "$run_root/bin/feat126-fake-responses" ./cmd/feat126-fake-responses
) >"$run_root/host-build.log" 2>&1 || content_free_failure runtime_fresh_host_build_failed

(
  cd "$desktop_root"
  VITE_YIJIE_AUTHORITATIVE_PERMISSION_UI_ENABLED=true \
  VITE_YIJIE_CHAT_LOCAL_UI_ENABLED=true \
  VITE_FEAT128_S10D_RUNTIME=true \
  pnpm build
  cd src-tauri
  CARGO_TARGET_DIR="$run_root/target" \
  VITE_FEAT128_S10D_RUNTIME=true \
  cargo build --locked --release \
    --features feat128-s10-runtime,tauri/custom-protocol
) >"$run_root/desktop-build.log" 2>&1 || content_free_failure runtime_fresh_desktop_build_failed

desktop_binary="$run_root/target/release/yijie-desktop"
[[ -x "$desktop_binary" && ! -L "$desktop_binary" ]] || content_free_failure runtime_desktop_binary_invalid
host_binary_sha256="$(shasum -a 256 "$run_root/bin/yijie-agent-host" | awk '{print $1}')"
fake_binary_sha256="$(shasum -a 256 "$run_root/bin/feat126-fake-responses" | awk '{print $1}')"
desktop_binary_sha256="$(shasum -a 256 "$desktop_binary" | awk '{print $1}')"

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
  process_alive "$fake_pid" || content_free_failure runtime_fake_exited_early
  sleep 0.1
done
[[ "$fake_ready" == true ]] || content_free_failure runtime_fake_ready_timeout

env \
  -u MINIMAX_API_KEY \
  -u YIJIE_MINIMAX_API_KEY \
  -u YIJIE_MINIMAX_API_KEY_FILE \
  -u YIJIE_MODEL_PROVIDER \
  -u YIJIE_PROVIDER \
  -u YIJIE_API_KEY \
  -u YIJIE_API_KEY_FILE \
  VITE_FEAT128_S10D_RUNTIME=true \
  YIJIE_ENV=local \
  YIJIE_CHAT_LOCAL_ENABLED=true \
  YIJIE_CHAT_LOCAL_HOST_ENABLED=true \
  YIJIE_CHAT_LOCAL_OWNER_USER_ID=12800000-0000-4000-8000-000000000001 \
  YIJIE_CHAT_LOCAL_TENANT_ID=12800000-0000-4000-8000-100000000001 \
  YIJIE_CHAT_ARTIFACTS_V3_ENABLED=true \
  YIJIE_FEAT128_S10_TEST_PROFILE_ENABLED=true \
  YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED=true \
  YIJIE_FEAT126_S10_SECURE_STORAGE_ENABLED=false \
  YIJIE_FEAT126_S10_EPHEMERAL_SECRET_BACKEND_ENABLED=true \
  YIJIE_FEAT126_S10_RUN_ID="$run_id" \
  YIJIE_FEAT126_S10_DRIVER_NONCE="$driver_nonce" \
  YIJIE_FEAT126_S10_RUN_ROOT="$run_root" \
  YIJIE_FEAT126_FAKE_RESPONSES_BASE_URL=http://127.0.0.1:18082/v1 \
  YIJIE_AGENT_HOST_BINARY="$run_root/bin/yijie-agent-host" \
  YIJIE_AGENT_HOST_HOME="$run_root/host-home" \
  YIJIE_AGENT_HOST_PORT=18080 \
  YIJIE_CODEX_BINARY="$runtime_binary" \
  YIJIE_CODEX_MANIFEST="$runtime_manifest" \
  YIJIE_CODEX_HOME="$run_root/codex-home" \
  YIJIE_FEAT128_S10D_RESULT_PATH="$result_path" \
  YIJIE_FEAT128_S10D_CONTROL_PATH="$control_path" \
  YIJIE_FEAT128_S10D_SCREENSHOT_ACK_PATH="$screenshot_ack_path" \
  "$desktop_binary" >"$run_root/desktop.stdout.log" 2>"$run_root/desktop.stderr.log" &
desktop_pid=$!

result_ready=false
for _ in {1..1800}; do
  if [[ -f "$control_path" && ! -f "$screenshot_ack_path" ]]; then
    window_number="$(node -e '
      const fs = require("node:fs");
      const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const keys = Object.keys(v).sort().join("\0");
      if (keys !== ["schemaVersion", "status", "windowNumber"].sort().join("\0") ||
          v.schemaVersion !== 1 || v.status !== "screenshot_requested" ||
          !Number.isInteger(v.windowNumber) || v.windowNumber < 1) process.exit(1);
      process.stdout.write(String(v.windowNumber));
    ' "$control_path")" || content_free_failure runtime_window_control_invalid
    /usr/sbin/screencapture -x -l "$window_number" "$screenshot_path" >/dev/null 2>&1 ||
      content_free_failure runtime_screenshot_failed
    chmod 0600 "$screenshot_path"
    screenshot_sha256="$(shasum -a 256 "$screenshot_path" | awk '{print $1}')"
    (umask 077; printf '%s\n' "$screenshot_sha256" >"$screenshot_ack_path")
  fi
  if [[ -f "$result_path" ]]; then
    result_ready=true
    break
  fi
  if ! process_alive "$desktop_pid"; then
    if [[ -f "$screenshot_ack_path" ]]; then
      content_free_failure runtime_finish_handshake_failed
    fi
    content_free_failure runtime_desktop_exited_early
  fi
  sleep 0.1
done
if [[ "$result_ready" != true ]]; then
  if [[ -f "$screenshot_ack_path" ]]; then
    content_free_failure runtime_finish_handshake_failed
  fi
  content_free_failure runtime_walking_skeleton_timeout
fi

result_kind="$(node -e '
  const fs = require("node:fs");
  const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const exact = ["failureCode", "lifecycle", "productionPath", "schemaVersion", "status", "ui"];
  const lifecycleKeys = ["dom", "hostNative"];
  const nativeKeys = ["announced", "kinds", "progress", "ready"];
  const domKeys = ["domKinds", "domReadyShells"];
  const uiKeys = ["axeSeriousCritical", "axeStages", "focusOrder", "screenshotSha256"];
  const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
  const bounded = (value) => Number.isInteger(value) && value >= 0 && value <= 4;
  const validAxeStages = (value) => Array.isArray(value) && value.length <= 5 && new Set([
    "",
    "axe_script_error",
    "axe_script_loaded",
    "axe_script_loaded\0axe_nonce_consumed",
    "axe_script_loaded\0axe_nonce_consumed\0axe_bootstrap_started",
    "axe_script_loaded\0axe_nonce_consumed\0axe_bootstrap_started\0axe_import_rejected",
    "axe_script_loaded\0axe_nonce_consumed\0axe_bootstrap_started\0axe_import_resolved",
    "axe_script_loaded\0axe_nonce_consumed\0axe_bootstrap_started\0axe_import_resolved\0axe_run_rejected",
    "axe_script_loaded\0axe_nonce_consumed\0axe_bootstrap_started\0axe_import_resolved\0axe_run_resolved",
  ]).has(value.join("\0"));
  if (!exactKeys(v, exact) || v.schemaVersion !== 1 ||
      !exactKeys(v.lifecycle, lifecycleKeys) ||
      !exactKeys(v.lifecycle.hostNative, nativeKeys) ||
      !exactKeys(v.lifecycle.dom, domKeys) ||
      !exactKeys(v.ui, uiKeys) || !validAxeStages(v.ui.axeStages) ||
      !Object.values(v.lifecycle.hostNative).every(bounded) ||
      !Object.values(v.lifecycle.dom).every(bounded)) process.exit(1);
  const classifications = new Set([
    "native_lifecycle_incomplete",
    "native_complete_dom_ready_incomplete",
    "native_complete_dom_kind_incomplete",
    "lifecycle_complete_finish_failed",
  ]);
  const evidence = () => JSON.stringify({
    classification: v.status === "passed" ? "lifecycle_complete" : v.failureCode,
    hostNative: v.lifecycle.hostNative,
    dom: {
      readyShells: v.lifecycle.dom.domReadyShells,
      kinds: v.lifecycle.dom.domKinds,
    },
    axeStages: v.ui.axeStages,
  });
  if (v.status === "failed" && classifications.has(v.failureCode)) {
    process.stdout.write(`diagnostic:${JSON.stringify({
      classification: v.failureCode,
      hostNative: v.lifecycle.hostNative,
      dom: {
        readyShells: v.lifecycle.dom.domReadyShells,
        kinds: v.lifecycle.dom.domKinds,
      },
      axeStages: v.ui.axeStages,
    })}`);
  } else if (v.status === "failed" && typeof v.failureCode === "string" &&
      /^runtime_[a-z0-9_]{1,55}$/.test(v.failureCode)) {
    process.stdout.write(`diagnostic:${evidence()}`);
  } else if (v.status === "passed" && v.failureCode === null) {
    process.stdout.write(`passed:${evidence()}`);
  } else {
    process.exit(1);
  }
' "$result_path")" || content_free_failure runtime_result_invalid

case "$result_kind" in
  diagnostic:*) diagnostic_json="${result_kind#diagnostic:}" ;;
  passed:*) result_passed=true; diagnostic_json="${result_kind#passed:}" ;;
  *) content_free_failure runtime_result_invalid ;;
esac

if [[ "$result_passed" == true ]]; then
  node -e '
    const fs = require("node:fs");
    const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (v.status !== "passed" || v.failureCode !== null ||
        Object.values(v.productionPath).some((x) => x !== true) ||
        v.lifecycle.hostNative.announced !== 4 || v.lifecycle.hostNative.progress !== 4 ||
        v.lifecycle.hostNative.ready !== 4 || v.lifecycle.hostNative.kinds !== 4 ||
        v.lifecycle.dom.domReadyShells !== 4 || v.lifecycle.dom.domKinds !== 4 ||
        v.ui.axeSeriousCritical !== 0 || v.ui.focusOrder !== true ||
        v.ui.axeStages.join("\0") !==
          "axe_script_loaded\0axe_nonce_consumed\0axe_bootstrap_started\0axe_import_resolved\0axe_run_resolved" ||
        typeof v.ui.screenshotSha256 !== "string" || !/^[0-9a-f]{64}$/.test(v.ui.screenshotSha256)) {
      process.exit(1);
    }
  ' "$result_path" || content_free_failure runtime_result_invalid
fi

for _ in {1..100}; do
  process_alive "$desktop_pid" || break
  sleep 0.1
done
if process_alive "$desktop_pid"; then
  stop_pid "$desktop_pid" || cleanup_desktop=false
fi
if process_alive "$desktop_pid"; then
  cleanup_desktop=false
  cleanup_web_content=false
else
  wait "$desktop_pid" 2>/dev/null || true
  desktop_pid=""
  cleanup_desktop=true
  cleanup_web_content=true
fi

for _ in {1..100}; do
  port_is_free 18080 && break
  sleep 0.1
done
port_is_free 18080 || cleanup_host=false
stop_pid "$fake_pid" || cleanup_fake=false
if process_alive "$fake_pid"; then
  cleanup_fake=false
else
  wait "$fake_pid" 2>/dev/null || true
  fake_pid=""
  cleanup_fake=true
fi
port_is_free 18082 || cleanup_fake=false
if [[ "$cleanup_host" != true || "$cleanup_fake" != true ]]; then
  cleanup_listeners=false
fi

residue_observation="$(classify_s10d_residue)"
case "$residue_observation" in
  desktop_sqlcipher_wal:empty)
    residue_classification=desktop_sqlcipher_wal
    wal_state=empty
    ;;
  desktop_sqlcipher_wal:nonempty)
    residue_classification=desktop_sqlcipher_wal
    wal_state=nonempty
    ;;
  *) residue_classification="$residue_observation" ;;
esac
case "$residue_classification" in
  desktop_sqlcipher_wal|desktop_sqlcipher_shm) cleanup_wal=false ;;
  desktop_atomic_tmp) cleanup_temp=false ;;
  host_spool_or_tmp) cleanup_spool=false; cleanup_temp=false ;;
  unknown_storage_residue) cleanup_wal=false; cleanup_spool=false; cleanup_temp=false ;;
  "") ;;
  *) residue_classification=unknown_storage_residue; cleanup_wal=false; cleanup_spool=false; cleanup_temp=false ;;
esac

final_json=""
if [[ "$result_passed" == true && -z "$residue_classification" &&
      "$cleanup_desktop" == true && "$cleanup_web_content" == true &&
      "$cleanup_host" == true && "$cleanup_fake" == true && "$cleanup_listeners" == true ]]; then
  final_json="$(node -e '
  const [desktopCommit, hostCommit, contractsCommit, hostSha, fakeSha, desktopSha, resultPath] = process.argv.slice(1);
  const result = JSON.parse(require("node:fs").readFileSync(resultPath, "utf8"));
  process.stdout.write(JSON.stringify({
    schemaVersion: 1,
    status: "passed",
    failureCode: null,
    sourceCommits: { desktop: desktopCommit, host: hostCommit, contracts: contractsCommit },
    binarySha256: { host: hostSha, fake: fakeSha, desktop: desktopSha },
    profile: { zeroProvider: true, zeroNonLoopback: true },
    productionPath: { realTauri: true, ...result.productionPath },
    lifecycle: result.lifecycle,
    ui: result.ui,
    cleanup: { desktop: true, webContent: true, host: true, fake: true, listeners: true, wal: true, spool: true, temp: true, runRoot: true }
  }));
' "$desktop_source_commit" "$host_source_commit" "$contracts_source_commit" "$host_binary_sha256" "$fake_binary_sha256" "$desktop_binary_sha256" "$result_path")"
fi

kill "$watchdog_pid" 2>/dev/null || true
wait "$watchdog_pid" 2>/dev/null || true
watchdog_pid=""
if safe_remove_root && [[ ! -e "$outer_root" ]]; then
  cleanup_run_root=true
  outer_root=""
fi
completed=true

# Run the same final cleanup handler before emitting evidence so the verdict
# reflects the state that the EXIT trap would otherwise establish afterwards.
cleanup || true
if [[ -n "$desktop_pid" ]] && ! process_alive "$desktop_pid"; then
  wait "$desktop_pid" 2>/dev/null || true
  desktop_pid=""
  cleanup_desktop=true
  cleanup_web_content=true
fi
if [[ -n "$fake_pid" ]] && ! process_alive "$fake_pid"; then
  wait "$fake_pid" 2>/dev/null || true
  fake_pid=""
  cleanup_fake=true
fi
if port_is_free 18080; then cleanup_host=true; fi
if port_is_free 18082; then cleanup_fake=true; fi
if [[ "$cleanup_host" == true && "$cleanup_fake" == true ]]; then cleanup_listeners=true; fi
if [[ -z "$outer_root" || ! -e "$outer_root" ]]; then
  cleanup_run_root=true
  outer_root=""
fi
trap - EXIT TERM

if [[ "$result_passed" != true || -n "$residue_classification" ||
      "$cleanup_desktop" != true || "$cleanup_web_content" != true ||
      "$cleanup_host" != true || "$cleanup_fake" != true || "$cleanup_listeners" != true ||
      "$cleanup_run_root" != true ]]; then
  failure_json="$(node -e '
    const [evidenceJson, residue, walState, desktop, webContent, host, fake, listeners, wal, spool, temp, runRoot] = process.argv.slice(1);
    const evidence = JSON.parse(evidenceJson);
    const bool = (value) => value === "true";
    process.stdout.write(JSON.stringify({
      schemaVersion: 1,
      status: "failed",
      classification: evidence.classification,
      hostNative: evidence.hostNative,
      dom: evidence.dom,
      axeStages: evidence.axeStages,
      residueClassification: residue || null,
      walState: walState || null,
      cleanup: {
        desktop: bool(desktop), webContent: bool(webContent), host: bool(host),
        fake: bool(fake), listeners: bool(listeners), wal: bool(wal),
        spool: bool(spool), temp: bool(temp), runRoot: bool(runRoot),
      },
    }));
  ' "$diagnostic_json" "$residue_classification" "$wal_state" "$cleanup_desktop" "$cleanup_web_content" \
    "$cleanup_host" "$cleanup_fake" "$cleanup_listeners" "$cleanup_wal" "$cleanup_spool" \
    "$cleanup_temp" "$cleanup_run_root")"
  printf '%s\n' "$failure_json" >&2
  exit 1
fi
printf '%s\n' "$final_json"
