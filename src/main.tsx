import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import { App } from "./App";
import "./styles.css";

async function start() {
  if (import.meta.env.VITE_WDIO === "1") {
    const { init } = await import("@wdio/tauri-plugin");
    await init();
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
