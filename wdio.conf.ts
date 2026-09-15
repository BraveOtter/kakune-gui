import { resolve } from "node:path";

const binary = process.platform === "win32"
  ? resolve("src-tauri/target/release/kakune-gui.exe")
  : resolve("src-tauri/target/release/kakune-gui");

export const config = {
  runner: "local",
  specs: ["./e2e/desktop.e2e.js"],
  maxInstances: 1,
  capabilities: [{ browserName: "tauri", "tauri:options": { application: binary } }],
  logLevel: "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 60000 },
  baseUrl: "http://localhost:4445",
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,
  services: [["@wdio/tauri-service", { appBinaryPath: binary, driverProvider: "embedded", embeddedPort: 4445 }]],
};
