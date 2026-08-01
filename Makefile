CONTRACTS_DIR ?= ../yijie-contracts

.PHONY: dev tauri-dev build lint test generate generate-check

dev:
	pnpm dev

tauri-dev:
	pnpm tauri:dev

build:
	pnpm build

lint:
	YIJIE_DESKTOP_CONTRACTS_DIR="$(CONTRACTS_DIR)" pnpm generate:check
	pnpm lint
	cargo fmt --manifest-path src-tauri/Cargo.toml --check
	cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

test:
	YIJIE_DESKTOP_CONTRACTS_DIR="$(CONTRACTS_DIR)" pnpm test
	cargo test --manifest-path src-tauri/Cargo.toml

generate:
	YIJIE_DESKTOP_CONTRACTS_DIR="$(CONTRACTS_DIR)" pnpm generate

generate-check:
	YIJIE_DESKTOP_CONTRACTS_DIR="$(CONTRACTS_DIR)" pnpm generate:check
