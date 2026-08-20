#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_path="${repository_root}/../yijie-agent-host/internal/session/fixtures/synthetic-video-16x16.mp4.base64"
run_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
driver_nonce="$(uuidgen | tr '[:upper:]' '[:lower:]')"
run_root="$(mktemp -d "${TMPDIR:-/tmp}/yijie-feat128-s7b.XXXXXX")"
chmod 700 "${run_root}"
run_root="$(cd "${run_root}" && pwd -P)"
result_path="${run_root}/s7b-runtime-result.json"

cleanup() {
  if [[ -d "${run_root}" && "${run_root}" == "${TMPDIR:-/tmp}"/yijie-feat128-s7b.* ]]; then
    rm -rf "${run_root}"
  fi
}
trap cleanup EXIT

export VITE_FEAT128_S7B_RUNTIME=true
export YIJIE_CHAT_LOCAL_ENABLED=true
export YIJIE_CHAT_LOCAL_HOST_ENABLED=true
export YIJIE_ENV=local
export YIJIE_CHAT_LOCAL_OWNER_USER_ID=12800000-0000-4000-8000-000000000001
export YIJIE_CHAT_LOCAL_TENANT_ID=12800000-0000-4000-8000-100000000001
export YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED=true
export YIJIE_FEAT126_S10_SECURE_STORAGE_ENABLED=false
export YIJIE_FEAT126_S10_EPHEMERAL_SECRET_BACKEND_ENABLED=true
export YIJIE_FEAT126_S10_RUN_ID="${run_id}"
export YIJIE_FEAT126_S10_DRIVER_NONCE="${driver_nonce}"
export YIJIE_FEAT126_S10_RUN_ROOT="${run_root}"
export YIJIE_FEAT126_FAKE_RESPONSES_BASE_URL=http://127.0.0.1:18082/v1
export YIJIE_AGENT_HOST_HOME="${run_root}/host-home"
export YIJIE_AGENT_HOST_BINARY="${repository_root}/../yijie-agent-host/.local/bin/yijie-agent-host"
export YIJIE_AGENT_HOST_PORT=18080
export YIJIE_CODEX_HOME="${run_root}/codex-home"
export YIJIE_CODEX_BINARY="${repository_root}/../yijie-codex/codex-rs/target/aarch64-apple-darwin/release/codex"
export YIJIE_CODEX_MANIFEST="${repository_root}/../yijie-codex/codex-rs/Cargo.toml"
export YIJIE_FEAT128_S7B_FIXTURE_PATH="${fixture_path}"
export YIJIE_FEAT128_S7B_RESULT_PATH="${result_path}"

cd "${repository_root}"
tauri_status=0
pnpm tauri dev --features feat128-s7b-runtime --no-watch || tauri_status=$?

if [[ ! -f "${result_path}" ]]; then
  echo "S7B runtime evidence missing (Tauri exit ${tauri_status})" >&2
  exit 1
fi
node -e '
  const fs = require("node:fs");
  const evidence = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(JSON.stringify(evidence) + "\n");
  const exact = ["failureCode", "fixtureBytes", "fixtureSha256", "metadataReady", "playbackStarted", "protocolDiagnostics", "schemaVersion", "seeked", "status"];
  if (Object.keys(evidence).sort().join("\0") !== exact.sort().join("\0") ||
      evidence.schemaVersion !== 1 || evidence.status !== "passed" ||
      evidence.metadataReady !== true || evidence.playbackStarted !== true || evidence.seeked !== true ||
      evidence.failureCode !== null || evidence.fixtureBytes !== 1642 ||
      evidence.fixtureSha256 !== "96ea070cac612d17927939c22f3c0c593fb26b171f62c4e9cee43fb596177dd5" ||
      !evidence.protocolDiagnostics || evidence.protocolDiagnostics.requestsTotal < 1) {
    process.exit(1);
  }
' "${result_path}"
