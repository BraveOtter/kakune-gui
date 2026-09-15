# Repository guidance

## Setup and commands
- Run commands from the repository root. This is one pnpm package plus the Rust crate in `src-tauri`; `pnpm-workspace.yaml` only permits the esbuild install script.
- Use pnpm **10.8.0** (`packageManager`), Node **22** (CI: 22.14.0), and Rust **1.98.1** with rustfmt/clippy (`rust-toolchain.toml`, despite the README saying stable). Install JS dependencies with `pnpm install --frozen-lockfile`; native builds also need the platform Tauri 2 prerequisites listed in CI/README.
- `pnpm tauri dev` starts both the native app and Vite on strict port **1420**. `pnpm dev` alone is the renderer server and normally still requires Tauri IPC.
- `pnpm build` typechecks and builds only the frontend. `pnpm tauri build` runs that automatically and produces native bundles under `src-tauri/target/release/bundle/`.

## Focused verification
- `pnpm check` and `pnpm lint` both run exactly `tsc --noEmit`; there is no separate JS linter. Their scope is `src` and `vite.config.ts`, not the E2E configs/specs.
- Frontend tests: `pnpm test`; one file: `pnpm exec vitest run src/workflow-graph.test.ts`; add `-t "test name"` to filter. Vitest uses jsdom and `src/test/setup.ts`, and excludes `e2e/`.
- Rust checks: `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, then `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`, then `cargo test --manifest-path src-tauri/Cargo.toml --locked`. Append a test-name filter for a focused Rust test.
- Browser E2E: first `pnpm exec playwright install --with-deps chromium`, then `pnpm test:e2e`. Playwright starts Vite on **4173** with `VITE_E2E=1`; the limited in-memory adapter in `src/api.ts` replaces native calls, so no Core server is needed. If reusing a local server on 4173, it must have that flag.
- Native E2E: `pnpm test:e2e:desktop` builds a release binary with both `VITE_WDIO=1` and Rust feature `wdio`, then runs WebdriverIO with the embedded driver on **4445**. Headless Linux uses `xvfb-run -a pnpm test:e2e:desktop`. Keep these test flags out of normal production builds.
- The full cross-platform check sequence lives in `.github/workflows/ci.yml`; browser E2E and desktop E2E are separate suites, not included in `pnpm test`.

## Architecture and invariants
- Runtime flow: `src/main.tsx` → `src/App.tsx` → `src/api.ts` (`coreClient`) → Tauri commands in `src-tauri/src/lib.rs` → Core HTTP API. `src-tauri/src/main.rs` delegates to the library's `run()`; that function registers commands and loads app state.
- New native operations need coordinated changes to `src/api.ts`, the Rust command and `generate_handler!` registration, and applicable contracts in `src/types.ts`. Renderer invoke arguments are camelCase; Rust parameters are snake_case.
- Core is an independently running service: do not import its code, access its files/database, or manage its process. Core HTTP calls belong in Rust and are scoped by the selected context ID.
- Context metadata is stored in the app config directory's `contexts.json`; bearer tokens belong in the OS keyring (with native session caching), never context JSON/exports or renderer persistence. Credentials travel to Core through the Authorization header.
- Workflow graph edits in `src/workflow-graph.ts` mutate YAML syntax documents to retain comments, styles, extensions, and ordering. Preserve this rather than round-tripping through plain objects. Nested graph IDs are scope-qualified in the UI, while source bindings stay local to their subgraph; aliases, anchors, and tags are rejected.
- UI translations are paired English/Spanish dictionaries in `src/i18n.ts`; add keys to both when changing user-facing text.

## Releases
- Keep versions synchronized in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`; verify with `pnpm check:version` (optionally pass `gui-vX.Y.Z` to validate a tag). See `RELEASE.md` and `.github/workflows/release.yml` for artifact/signing details.
