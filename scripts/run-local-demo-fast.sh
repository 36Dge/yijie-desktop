#!/bin/bash
set -euo pipefail
# Secrets are collected only after builds and are never traced.
set +x
unset YIJIE_FEAT144_SORFTIME_ACCOUNT_SK YIJIE_FEAT144_SORFTIME_ENABLED YIJIE_FEAT144_HTTPS_PROXY

desktop_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
workspace_root="$(cd "$desktop_root/.." && pwd -P)"
host_root="$workspace_root/yijie-agent-host"
codex_runtime_root="${YIJIE_DEMO_FAST_RUNTIME_ROOT:-$host_root/.local/runtime-artifacts/feat-136-b2b20e2fc4a0}"
host_binary="$host_root/.local/bin/yijie-agent-host"
codex_binary="$codex_runtime_root/codex"
codex_manifest="$codex_runtime_root/runtime-manifest.json"
runtime_binary_sha256="4efe16d2848680752cf9aacf4c17741ab2eeb7415894a66c2bb03652b00a322d"
runtime_manifest_sha256="1cfa2e0a139b2213f4d29b1efeed71d4810110ac865f0bcbd931ff33b0062c1b"
provider_key_file="${YIJIE_DEMO_FAST_PROVIDER_KEY_FILE:-$host_root/.local/secrets/minimax-api-key}"
runtime_root="$desktop_root/.local/demo-fast"
host_home="$runtime_root/host-home"
codex_home="$runtime_root/codex-home"
host_port="${YIJIE_DEMO_FAST_HOST_PORT:-18081}"

fail() {
  printf 'local demo startup failed: %s\n' "$1" >&2
  exit 1
}

sha256_file() {
  shasum -a 256 "$1" | awk '{ print $1 }'
}

image_generation_enabled="true"
stable_api_only="false"
packaged_app="false"
feat134_environment=()
sorftime_requested="${YIJIE_DEMO_FAST_SORFTIME_ENABLED:-false}"
[[ "$sorftime_requested" == "true" || "$sorftime_requested" == "false" ]] || fail "invalid Sorftime opt-in"
# The ordinary packaged entry keeps the existing stable-only branch intact.
if [[ "$#" == "1" && "$1" == "--packaged" ]]; then
  packaged_app="true"
  shift
fi
case "$#" in
  0) ;;
  1)
    [[ "$1" == "--stable-api-only" ]] || fail "unsupported arguments; expected no arguments or --stable-api-only"
    image_generation_enabled="false"
    stable_api_only="true"
    runtime_root="$desktop_root/.local/feat131-stable"
    host_home="$runtime_root/host-home"
    codex_home="$runtime_root/codex-home"
    feat134_environment=(
      YIJIE_FEAT134_STREAMING_ENABLED=true
      VITE_YIJIE_FEAT134_STREAMING_ENABLED=true
      YIJIE_FEAT136_COMMAND_TOOL_ITEMS_ENABLED=true
      VITE_YIJIE_FEAT136_EXECUTION_ENABLED=true
    )
    ;;
  *) fail "unsupported arguments; expected no arguments or --stable-api-only" ;;
esac

if [[ "$sorftime_requested" == "true" && "$packaged_app" != "true" && "$stable_api_only" != "true" ]]; then
  fail "Sorftime hidden input requires a packaged canonical build"
fi

# FEAT-152 is part of the completed local Demo. Keep renderer/native admission
# together, including the preflight source checks and the stable bundle build.
export YIJIE_ENV=local
export YIJIE_LOCAL_PROFILE=demo_fast
export YIJIE_RUNTIME_PERMISSIONS_ENABLED=true
export VITE_YIJIE_RUNTIME_PERMISSIONS_ENABLED=true

# Detached source verification may reuse the same existing audited Runtime and
# provider key by absolute path. All original hash/type/protection checks remain.
[[ "$codex_runtime_root" == /* && "$provider_key_file" == /* ]] || fail "Runtime and provider key sources must be absolute paths"
[[ -f "$codex_binary" && -x "$codex_binary" && ! -L "$codex_binary" ]] || fail "Codex Runtime binary is missing"
[[ -f "$codex_manifest" && ! -L "$codex_manifest" ]] || fail "Codex Runtime manifest is missing"
[[ "$(sha256_file "$codex_binary")" == "$runtime_binary_sha256" ]] ||
  fail "Codex Runtime binary differs from the retained FEAT-136 artifact"
[[ "$(sha256_file "$codex_manifest")" == "$runtime_manifest_sha256" ]] ||
  fail "Codex Runtime manifest differs from the retained FEAT-136 artifact"
[[ -f "$provider_key_file" && ! -L "$provider_key_file" ]] || fail "MiniMax provider key file is missing"

# FEAT-134 first verifies its exact Contracts/Host v4 authority. The Skill
# resource chain then retains its independent legacy immutable pins.
cd "$desktop_root"
node scripts/check-native-conversation.mjs --require-committed
node scripts/check-native-mcp.mjs --require-committed
YIJIE_DESKTOP_CONTRACTS_DIR="$workspace_root/yijie-contracts" \
YIJIE_DESKTOP_AGENT_HOST_DIR="$host_root" \
  node scripts/check-agent-host-v4-contract.mjs
YIJIE_DESKTOP_CONTRACTS_DIR="$workspace_root/yijie-contracts" \
  node scripts/check-approval-retirement.mjs
YIJIE_DESKTOP_CONTRACTS_DIR="$workspace_root/yijie-contracts" \
YIJIE_DESKTOP_AGENT_HOST_DIR="$host_root" \
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

if [[ "$stable_api_only" == "true" ]]; then
  pnpm tauri:build:demo-fast:stable
  bundle_binary="$desktop_root/src-tauri/target/debug/bundle/macos/易界 AI FEAT-131.app/Contents/MacOS/yijie-desktop"
  [[ -x "$bundle_binary" && ! -L "$bundle_binary" ]] || fail "stable Desktop app bundle is missing"
  launch_command=("$bundle_binary")
elif [[ "$packaged_app" == "true" ]]; then
  pnpm tauri:build:demo-fast
  bundle_binary="$desktop_root/src-tauri/target/debug/bundle/macos/易界 AI.app/Contents/MacOS/yijie-desktop"
  [[ -x "$bundle_binary" && ! -L "$bundle_binary" ]] || fail "Desktop app bundle is missing"
  launch_command=("$bundle_binary")
else
  launch_command=(pnpm exec tauri dev --config src-tauri/tauri.demo-fast.conf.json)
fi

if lsof -nP -iTCP:"$host_port" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "loopback port $host_port became busy while preparing the local Demo"
fi

# Public opt-in only; the credential never appears in shell arguments, files,
# build/Vite processes, or WebView. A cancelled prompt leaves Sorftime disabled.
if [[ "$sorftime_requested" == "true" ]]; then
  # Reuse the current system HTTPS proxy, without PAC/auth URL forwarding or
  # changing OS networking. No local proxy address is a product default.
  sorftime_proxy_config="$(/usr/sbin/scutil --proxy)" || fail "system HTTPS proxy configuration is unavailable"
  sorftime_proxy_enabled="$(printf '%s\n' "$sorftime_proxy_config" | awk '$1 == "HTTPSEnable" {print $3}')"
  sorftime_proxy_url=""
  if [[ "$sorftime_proxy_enabled" == "1" ]]; then
    sorftime_proxy_host="$(printf '%s\n' "$sorftime_proxy_config" | awk '$1 == "HTTPSProxy" {print $3}')"
    sorftime_proxy_port="$(printf '%s\n' "$sorftime_proxy_config" | awk '$1 == "HTTPSPort" {print $3}')"
    [[ "$sorftime_proxy_host" =~ ^[A-Za-z0-9.-]+$ && "$sorftime_proxy_port" =~ ^[0-9]+$ ]] || fail "unsupported system HTTPS proxy configuration"
    [[ "$sorftime_proxy_port" -ge 1 && "$sorftime_proxy_port" -le 65535 ]] || fail "invalid system HTTPS proxy port"
    sorftime_proxy_url="http://$sorftime_proxy_host:$sorftime_proxy_port"
  elif [[ "$(printf '%s\n' "$sorftime_proxy_config" | awk '$1 == "ProxyAutoConfigEnable" || $1 == "SOCKSEnable" {if ($3 == "1") print "unsupported"}')" == *unsupported* ]]; then
    fail "current PAC or SOCKS proxy has not been verified for this native entry"
  fi
  unset sorftime_proxy_config sorftime_proxy_host sorftime_proxy_port sorftime_proxy_enabled
  sorftime_input=""
  if sorftime_input="$(/usr/bin/osascript 2>/dev/null <<'APPLESCRIPT'
try
  set result to display dialog "输入本次启动使用的 Sorftime MCP Account-SK（仅保存在内存，退出后需重新输入）" default answer "" with hidden answer with title "易界 AI · Sorftime" buttons {"暂不启用", "启用本次"} default button "启用本次" cancel button "暂不启用"
  return text returned of result
on error number -128
  return ""
end try
APPLESCRIPT
)"; then
    if [[ -n "$sorftime_input" ]]; then
      [[ "${#sorftime_input}" -le 4096 && ! "$sorftime_input" =~ [[:space:]] ]] || fail "invalid Sorftime credential input"
      export YIJIE_FEAT144_SORFTIME_ACCOUNT_SK="$sorftime_input"
      export YIJIE_FEAT144_SORFTIME_ENABLED=true
      if [[ -n "$sorftime_proxy_url" ]]; then export YIJIE_FEAT144_HTTPS_PROXY="$sorftime_proxy_url"; fi
    fi
  fi
  unset sorftime_input sorftime_proxy_url
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
  -u YIJIE_MODEL_PROVIDER \
  -u YIJIE_MINIMAX_API_KEY \
  -u YIJIE_MINIMAX_API_KEY_FILE \
  -u YIJIE_FEAT128_IMAGE_GENERATION_ENABLED \
  -u YIJIE_FEAT131_STABLE_ENTRY \
  -u YIJIE_AGENT_HOST_V3_ARTIFACTS_ENABLED \
  -u YIJIE_FEAT134_STREAMING_ENABLED \
  -u VITE_YIJIE_FEAT134_STREAMING_ENABLED \
  -u YIJIE_FEAT136_COMMAND_TOOL_ITEMS_ENABLED \
  -u VITE_YIJIE_FEAT136_EXECUTION_ENABLED \
  -u YIJIE_FEAT137_COMMAND_APPROVAL_ENABLED \
  -u YIJIE_FEAT137_D4_DETERMINISTIC_PRODUCER_ENABLED \
  -u YIJIE_FEAT137_DETERMINISTIC_APPROVAL_PRODUCER \
  -u VITE_YIJIE_FEAT137_APPROVAL_ENABLED \
  "${feat134_environment[@]+"${feat134_environment[@]}"}" \
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
  YIJIE_MODEL_PROVIDER=minimax \
  YIJIE_MINIMAX_API_KEY_FILE="$provider_key_file" \
  YIJIE_FEAT128_IMAGE_GENERATION_ENABLED="$image_generation_enabled" \
  YIJIE_FEAT131_STABLE_ENTRY="$stable_api_only" \
  YIJIE_AGENT_HOST_BINARY="$host_binary" \
  YIJIE_AGENT_HOST_HOME="$host_home" \
  YIJIE_AGENT_HOST_PORT="$host_port" \
  YIJIE_CODEX_BINARY="$codex_binary" \
  YIJIE_CODEX_MANIFEST="$codex_manifest" \
  YIJIE_CODEX_HOME="$codex_home" \
  "${launch_command[@]}"
