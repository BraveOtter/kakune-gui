# Release

Create releases only from a protected `gui-vX.Y.Z` tag after `pnpm check:version` confirms that `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` share the same version.

The release workflow builds native Tauri bundles on Windows, Linux, Intel macOS, and Apple Silicon macOS. It runs browser and desktop E2E, attaches the E2E screenshot evidence, creates SPDX SBOMs, generates `SHA256SUMS`, attests the staged artifacts, and publishes a GitHub Release.

Windows Authenticode signing and macOS notarization require their respective certificates and are intentionally not simulated by this repository. Until those credentials and validation are configured, release assets remain explicitly unsigned.

Verify a downloaded asset with `SHA256SUMS` and `gh attestation verify <asset> --repo BraveOtter/kakune-gui`. The GUI remains independent: it connects to an existing Core HTTP endpoint and does not embed, install, or read a Core checkout.
