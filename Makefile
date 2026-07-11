.PHONY: dev tauri-dev build lint test generate

dev:
	pnpm dev

tauri-dev:
	pnpm tauri:dev

build:
	pnpm build

lint:
	pnpm lint
	cargo fmt --manifest-path src-tauri/Cargo.toml --check
	cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

test:
	pnpm test
	cargo test --manifest-path src-tauri/Cargo.toml

generate:
	pnpm generate
