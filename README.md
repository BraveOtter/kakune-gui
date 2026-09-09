# Kakune GUI

An independent Tauri 2 desktop client for the Kakune Core HTTP API. It does not import Core code and never reads Core files or databases.

## Prerequisites

- Node.js 22 or newer
- pnpm 10
- Rust stable and the platform prerequisites for [Tauri 2](https://v2.tauri.app/start/prerequisites/)
- A running Kakune Core HTTP server

## Run

```sh
pnpm install
pnpm tauri dev
```

Use `pnpm build` for a frontend production build, `pnpm tauri build` for an installer, `pnpm test` for the frontend unit tests, and `cargo test --manifest-path src-tauri/Cargo.toml` for Rust unit tests.

## Core contract

The endpoint is the Core server base URL, for example `http://127.0.0.1:8080`. The native facade calls only:

- `GET {endpoint}/api/v1/info` to test a connection
- `GET {endpoint}/api/v1/workflows` to show workflows

Bearer credentials are sent only as an `Authorization: Bearer` HTTP header. The initial workflow decoder accepts either an array or an object with `items` or `workflows`; the local TypeScript interfaces in `src/types.ts` are deliberately independent from Core and should be refined when the API contract is finalized.

## Privacy and storage

Context metadata (name, type, endpoint, creation time, and a token-present flag) is stored in the app configuration directory as `contexts.json`. Tokens are stored under the `dev.kakune.gui` service in the operating system credential store through the Rust `keyring` crate. They are never written into the renderer, local storage, or context JSON.

The web renderer has no filesystem API. Its complete native surface is `src/api.ts`, a small set of Tauri commands for context management and the two Core API operations.

## Scope

This foundation includes context management, connection tests, workflow listing, Spanish/English text, and light/dark/system appearance. It intentionally does not implement workflow mutation, authentication flows, Core process management, or direct persistence access.

The build script supplies a temporary minimal Windows icon so a fresh checkout can compile. Replace it with product artwork before distributing installers.
