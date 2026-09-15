import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const packageVersion = JSON.parse(await readFile(new URL("../package.json", import.meta.url))).version;
const tauri = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url))).version;
const cargo = await readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];

if (!cargoVersion || new Set([packageVersion, tauri, cargoVersion]).size !== 1) {
  throw new Error(`Version mismatch: package=${packageVersion}, tauri=${tauri}, cargo=${cargoVersion ?? "missing"}`);
}

const tag = process.argv[2];
if (tag && tag !== `gui-v${packageVersion}`) {
  throw new Error(`Tag ${tag} must equal gui-v${packageVersion}`);
}

console.log(packageVersion);
