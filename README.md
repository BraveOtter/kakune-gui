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

Use `pnpm build` for a frontend production build, `pnpm tauri build` for an installer, `pnpm test` for frontend unit tests, `pnpm test:e2e` for the browser E2E, `pnpm test:e2e:desktop` for native desktop E2E, and `cargo test --manifest-path src-tauri/Cargo.toml --locked` for Rust tests.

## Install a release

Download the native installer for a tested platform from GitHub Releases, verify it with `SHA256SUMS`, then install it normally. Releases include SPDX SBOMs, provenance attestations, and a real E2E screenshot. Verify an asset with `gh attestation verify <asset> --repo BraveOtter/kakune-gui`. The GUI does not install Core; add the URL of an already installed Core in **Contexts**. See [RELEASE.md](RELEASE.md) for signing and platform details.

## Core contract

The endpoint is the Core server base URL, for example `http://127.0.0.1:8080`. The native facade calls only:

- `GET {endpoint}/api/v1/info` to test a connection
- `GET {endpoint}/api/v1/workflows` to show workflows
- `GET {endpoint}/api/v1/workflows/{id}/source`, plus `PUT` to save source and `POST /api/v1/workflows` to create it
- `POST {endpoint}/api/v1/workflows/{id}/enable` and `/disable` to change workflow state
- `POST {endpoint}/api/v1/executions` with `{ "workflowId": "..." }` to execute a workflow
- `GET {endpoint}/api/v1/executions` to list executions in the selected context
- `GET {endpoint}/api/v1/executions/{id}` to inspect an execution, including node-run messages
- the public secrets, provider profiles, MiniMax capabilities, plugin administration, and MCP call endpoints

Bearer credentials are sent only as an `Authorization: Bearer` HTTP header. Every operation is scoped by the selected context identifier.

## Privacy and storage

Context metadata (name, type, endpoint, optional custom CA PEM, expected Core identity, creation time, and a token-present flag) is stored in the app configuration directory as `contexts.json`. Tokens are stored under the `io.github.braveotter.kakune` service in the operating system credential store through the Rust `keyring` crate. They are never persisted in the renderer, local storage, context JSON, or context exports.

The web renderer has no filesystem API. Its complete native surface is `src/api.ts`, a small set of Tauri commands for context management and Core API operations.

## Scope

The GUI includes context management with custom CA and connection recovery, workflow administration and history, context-scoped management of secrets, plugins, Codex/MiniMax profiles, and MCP calls, Spanish/English text, and light/dark/system appearance. It does not manage the Core process or access its persistence directly.

Release bundles use the tracked Kakune icon generated from `src-tauri/icons/icon.svg`; the Playwright E2E produces the release screenshot from the real renderer rather than a mockup.
