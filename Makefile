.PHONY: dev tauri-dev build lint test generate

dev:
	pnpm dev

tauri-dev:
	pnpm tauri:dev

build:
	pnpm build

lint:
	pnpm lint

test:
	pnpm test

generate:
	pnpm generate
