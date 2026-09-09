import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionResult,
  ContextInput,
  CoreContext,
  Workflow,
} from "./types";

// This is the entire renderer-to-native boundary. Core is contacted only by Rust.
export const coreClient = {
  listContexts: () => invoke<CoreContext[]>("list_contexts"),
  saveContext: (context: ContextInput) =>
    invoke<CoreContext>("save_context", { context }),
  deleteContext: (id: string) => invoke<void>("delete_context", { id }),
  testConnection: (context: ContextInput) =>
    invoke<ConnectionResult>("test_connection", { context }),
  listWorkflows: (contextId: string) =>
    invoke<Workflow[]>("list_workflows", { contextId }),
};
