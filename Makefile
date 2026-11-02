CONTRACTS_DIR ?= ../yijie-contracts

.PHONY: dev tauri-dev tauri-dev-raw demo-fast build lint test test-production-hardened generate generate-check

dev:
	pnpm dev

tauri-dev:
	pnpm tauri:dev

tauri-dev-raw:
	pnpm tauri:dev:raw

demo-fast:
	./scripts/run-local-demo-fast.sh

build:
	pnpm build

lint:
	YIJIE_DESKTOP_CONTRACTS_DIR="$(CONTRACTS_DIR)" pnpm generate:check
	pnpm lint
	cargo fmt --manifest-path src-tauri/Cargo.toml --check
	cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
	cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --features kimi-k31-pro-candidate -- -D warnings

test:
	YIJIE_DESKTOP_CONTRACTS_DIR="$(CONTRACTS_DIR)" pnpm test
	node scripts/run-tests.mjs --native

test-production-hardened:
	YIJIE_DESKTOP_CONTRACTS_DIR="$(CONTRACTS_DIR)" pnpm test:production-hardened
	node scripts/run-tests.mjs --native

generate:
	YIJIE_DESKTOP_CONTRACTS_DIR="$(CONTRACTS_DIR)" pnpm generate

generate-check:
	YIJIE_DESKTOP_CONTRACTS_DIR="$(CONTRACTS_DIR)" pnpm generate:check
