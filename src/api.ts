import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionResult,
  ContextInput,
  CoreContext,
  Execution,
  ExecutionTrace,
  PluginRecord,
  PreparedPlugin,
  ProviderCapabilities,
  ProviderProfile,
  SecretRecord,
  Workflow,
  WorkflowAnalysis,
  WorkflowCatalog,
  WorkflowSaveResult,
  WorkflowRevision,
  WorkflowRevisionComparison,
  WorkflowSource,
} from "./types";

const e2eContexts: CoreContext[] = [];

// Browser E2E uses a compile-time-only adapter; production always invokes Tauri.
async function e2eInvoke<T>(command: string, arguments_: Record<string, unknown> = {}): Promise<T> {
  if (command === "list_contexts") return e2eContexts as T;
  if (command === "save_context") {
    const input = arguments_.context as ContextInput;
    const context: CoreContext = {
      id: input.id ?? "e2e-context",
      name: input.name,
      kind: input.kind,
      endpoint: input.endpoint,
      hasToken: Boolean(input.token),
      customCaPem: input.customCaPem,
      expectedCoreId: input.expectedCoreId,
      createdAt: new Date().toISOString(),
    };
    const index = e2eContexts.findIndex((item) => item.id === context.id);
    if (index >= 0) e2eContexts[index] = context;
    else e2eContexts.push(context);
    return context as T;
  }
  if (command === "test_connection" || command === "test_saved_context") return { info: { name: "Kakune E2E" } } as T;
  throw new Error(`Unsupported browser E2E command: ${command}`);
}

const invokeCommand = import.meta.env.VITE_E2E === "1" ? e2eInvoke : invoke;

// This is the entire renderer-to-native boundary. Core is contacted only by Rust.
export const coreClient = {
  listContexts: () => invokeCommand<CoreContext[]>("list_contexts"),
  saveContext: (context: ContextInput) =>
    invokeCommand<CoreContext>("save_context", { context }),
  deleteContext: (id: string) => invokeCommand<void>("delete_context", { id }),
  testConnection: (context: ContextInput) =>
    invokeCommand<ConnectionResult>("test_connection", { context }),
  testSavedContext: (contextId: string) =>
    invokeCommand<ConnectionResult>("test_saved_context", { contextId }),
  exportContexts: () => invokeCommand<string>("export_contexts"),
  importContexts: (source: string) => invokeCommand<CoreContext[]>("import_contexts", { source }),
  listWorkflows: (contextId: string) =>
    invokeCommand<Workflow[]>("list_workflows", { contextId }),
  getWorkflowSource: (contextId: string, workflowId: string) =>
    invokeCommand<WorkflowSource>("get_workflow_source", { contextId, workflowId }),
  saveWorkflowSource: (contextId: string, workflowId: string, source: string, etag: string) =>
    invokeCommand<WorkflowSaveResult>("save_workflow_source", { contextId, workflowId, source, etag }),
  analyzeWorkflow: (contextId: string, source: string) =>
    invokeCommand<WorkflowAnalysis>("analyze_workflow", { contextId, source }),
  getWorkflowCatalog: (contextId: string) =>
    invokeCommand<WorkflowCatalog>("get_workflow_catalog", { contextId }),
  createWorkflow: (contextId: string, source: string) =>
    invokeCommand<void>("create_workflow", { contextId, source }),
  setWorkflowEnabled: (contextId: string, workflowId: string, enabled: boolean) =>
    invokeCommand<void>("set_workflow_enabled", { contextId, workflowId, enabled }),
  executeWorkflow: (contextId: string, workflowId: string) =>
    invokeCommand<unknown>("execute_workflow", { contextId, workflowId }),
  listExecutions: (contextId: string) =>
    invokeCommand<Execution[]>("list_executions", { contextId }),
  getExecution: (contextId: string, executionId: string) =>
    invokeCommand<Execution>("get_execution", { contextId, executionId }),
  getExecutionTrace: (contextId: string, executionId: string) =>
    invokeCommand<ExecutionTrace>("get_execution_trace", { contextId, executionId }),
  listWorkflowRevisions: (contextId: string, workflowId: string) =>
    invokeCommand<{ items: WorkflowRevision[] }>("list_workflow_revisions", { contextId, workflowId }),
  compareWorkflowRevisions: (contextId: string, workflowId: string, baseRevision: string, headRevision: string) =>
    invokeCommand<WorkflowRevisionComparison>("compare_workflow_revisions", { contextId, workflowId, baseRevision, headRevision }),
  readArtifact: (contextId: string, artifactId: string) =>
    invokeCommand<string>("read_artifact", { contextId, artifactId }),
  cancelExecution: (contextId: string, executionId: string) =>
    invokeCommand<void>("cancel_execution", { contextId, executionId }),
  listSecrets: (contextId: string) => invokeCommand<SecretRecord[]>("list_secrets", { contextId }),
  setSecret: (contextId: string, name: string, value: string) =>
    invokeCommand<SecretRecord>("set_secret", { contextId, name, value }),
  deleteSecret: (contextId: string, name: string) =>
    invokeCommand<void>("delete_secret", { contextId, name }),
  listProviders: (contextId: string) =>
    invokeCommand<ProviderProfile[]>("list_providers", { contextId }),
  saveProvider: (contextId: string, profile: ProviderProfile) =>
    invokeCommand<ProviderProfile>("save_provider", { contextId, profile }),
  deleteProvider: (contextId: string, providerId: string) =>
    invokeCommand<void>("delete_provider", { contextId, providerId }),
  diagnoseProvider: (contextId: string, providerId: string) =>
    invokeCommand<ProviderProfile>("diagnose_provider", { contextId, providerId }),
  minimaxCapabilities: (contextId: string) =>
    invokeCommand<ProviderCapabilities>("minimax_capabilities", { contextId }),
  listPlugins: (contextId: string) => invokeCommand<PluginRecord[]>("list_plugins", { contextId }),
  getPluginManifest: (contextId: string, name: string) =>
    invokeCommand<unknown>("get_plugin_manifest", { contextId, name }),
  preparePlugin: (contextId: string, source: string) =>
    invokeCommand<PreparedPlugin>("prepare_plugin", { contextId, source }),
  commitPlugin: (contextId: string, installationId: string, digest: string) =>
    invokeCommand<PluginRecord>("commit_plugin", { contextId, installationId, digest }),
  setPluginEnabled: (contextId: string, pluginId: string, enabled: boolean) =>
    invokeCommand<PluginRecord>("set_plugin_enabled", { contextId, pluginId, enabled }),
  deletePlugin: (contextId: string, pluginId: string) =>
    invokeCommand<void>("delete_plugin", { contextId, pluginId }),
  callMcp: (contextId: string, request: unknown) =>
    invokeCommand<unknown>("call_mcp", { contextId, request }),
};
