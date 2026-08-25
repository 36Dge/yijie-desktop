#!/bin/bash
set -euo pipefail

desktop_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
workspace_root="$(cd "$desktop_root/.." && pwd -P)"
host_root="$workspace_root/yijie-agent-host"
codex_runtime_root="$workspace_root/yijie-codex/.yijie/build/macos/aarch64-apple-darwin"
host_binary="$host_root/.local/bin/yijie-agent-host"
codex_binary="$codex_runtime_root/codex"
codex_manifest="$codex_runtime_root/runtime-manifest.json"
provider_key_file="$host_root/.local/secrets/minimax-api-key"
runtime_root="$desktop_root/.local/demo-fast"
host_home="$runtime_root/host-home"
codex_home="$runtime_root/codex-home"
host_port="${YIJIE_DEMO_FAST_HOST_PORT:-18081}"

fail() {
  printf 'local demo startup failed: %s\n' "$1" >&2
  exit 1
}

[[ -x "$codex_binary" ]] || fail "Codex Runtime binary is missing"
[[ -f "$codex_manifest" && ! -L "$codex_manifest" ]] || fail "Codex Runtime manifest is missing"
[[ -f "$provider_key_file" && ! -L "$provider_key_file" ]] || fail "MiniMax provider key file is missing"

# This is the immutable preflight for Contracts 0.5.1, Agent Host 1b7bfd1 and
# Skills 0.3.0. It must run before executing the Host producer checkout.
cd "$desktop_root"
YIJIE_DESKTOP_CONTRACTS_DIR="$workspace_root/yijie-contracts" \
YIJIE_DESKTOP_AGENT_HOST_DIR="$host_root" \
YIJIE_DESKTOP_SKILLS_DIR="$workspace_root/yijie-skills" \
  pnpm skills:sync:local

mkdir -p "$host_root/.local/bin" "$host_home" "$codex_home"
chmod 0700 "$runtime_root" "$host_home" "$codex_home"

if lsof -nP -iTCP:"$host_port" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "loopback port $host_port is already in use; close the existing local Demo first"
fi

(
  cd "$host_root"
  go build -trimpath -o "$host_binary" ./cmd/desktop-host
)

if lsof -nP -iTCP:"$host_port" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "loopback port $host_port became busy while preparing the local Demo"
fi

exec env \
  -u YIJIE_DESKTOP_NATIVE_AUTH_ENABLED \
  -u YIJIE_DESKTOP_AUTH_ENVIRONMENT \
  -u YIJIE_DESKTOP_OIDC_ISSUER \
  -u YIJIE_DESKTOP_OIDC_AUTHORIZATION_ENDPOINT \
  -u YIJIE_DESKTOP_OIDC_TOKEN_ENDPOINT \
  -u YIJIE_DESKTOP_OIDC_JWKS_URI \
  -u YIJIE_DESKTOP_OIDC_REVOCATION_ENDPOINT \
  -u YIJIE_DESKTOP_OIDC_CLIENT_ID \
  -u YIJIE_DESKTOP_API_ORIGIN \
  -u YIJIE_DESKTOP_LOCAL_CA_PEM_PATH \
  -u YIJIE_DESKTOP_LOCAL_CA_SHA256 \
  -u YIJIE_DESKTOP_LOCAL_WHITELIST_LOGIN_ENABLED \
  -u YIJIE_DESKTOP_LOCAL_WHITELIST_IDP_SECRETS_PATH \
  -u YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED \
  -u YIJIE_FEAT126_S10_RUN_ID \
  -u YIJIE_FEAT126_FAKE_RESPONSES_BASE_URL \
  -u YIJIE_FEAT126_S10_RUN_ROOT \
  -u YIJIE_FEAT126_S10_DRIVER_NONCE \
  -u YIJIE_FEAT126_S10_SECURE_STORAGE_ENABLED \
  -u YIJIE_FEAT126_S10_EPHEMERAL_SECRET_BACKEND_ENABLED \
  -u YIJIE_FEAT128_S10_TEST_PROFILE_ENABLED \
  -u YIJIE_FEAT128_SYNTHETIC_ENABLED \
  -u YIJIE_FEAT128_SYNTHETIC_MANIFEST \
  -u YIJIE_MINIMAX_API_KEY \
  -u YIJIE_AGENT_HOST_V3_ARTIFACTS_ENABLED \
  VITE_FEAT126_S10_DRIVER=false \
  VITE_FEAT128_S7B_RUNTIME=false \
  VITE_FEAT128_S10D_RUNTIME=false \
  VITE_FEAT128_R8_ENABLED=false \
  VITE_YIJIE_ENV=local \
  VITE_YIJIE_LOCAL_PROFILE=demo_fast \
  VITE_YIJIE_CHAT_LOCAL_UI_ENABLED=true \
  VITE_YIJIE_AUTHORITATIVE_PERMISSION_UI_ENABLED=true \
  VITE_YIJIE_LOCAL_WHITELIST_LOGIN_ENABLED=false \
  YIJIE_ENV=local \
  YIJIE_LOCAL_PROFILE=demo_fast \
  YIJIE_CHAT_LOCAL_ENABLED=true \
  YIJIE_CHAT_LOCAL_HOST_ENABLED=true \
  YIJIE_CHAT_LOCAL_OWNER_USER_ID=12500000-0000-4000-8000-000000000001 \
  YIJIE_CHAT_LOCAL_TENANT_ID=12500000-0000-4000-8000-100000000001 \
  YIJIE_CHAT_ARTIFACTS_V3_ENABLED=true \
  YIJIE_FEAT128_IMAGE_GENERATION_ENABLED=true \
  YIJIE_MINIMAX_API_KEY_FILE="$provider_key_file" \
  YIJIE_AGENT_HOST_BINARY="$host_binary" \
  YIJIE_AGENT_HOST_HOME="$host_home" \
  YIJIE_AGENT_HOST_PORT="$host_port" \
  YIJIE_CODEX_BINARY="$codex_binary" \
  YIJIE_CODEX_MANIFEST="$codex_manifest" \
  YIJIE_CODEX_HOME="$codex_home" \
  pnpm exec tauri dev --config src-tauri/tauri.demo-fast.conf.json
