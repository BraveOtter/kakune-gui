export type ContextKind = "local" | "remote";

export interface CoreContext {
  id: string;
  name: string;
  kind: ContextKind;
  endpoint: string;
  hasToken: boolean;
  customCaPem?: string;
  expectedCoreId?: string;
  createdAt: string;
}

export interface ContextInput {
  id?: string;
  name: string;
  kind: ContextKind;
  endpoint: string;
  token?: string;
  customCaPem?: string;
  expectedCoreId?: string;
}

export interface CoreInfo {
  name?: string;
  version?: string;
  [key: string]: unknown;
}

export interface ConnectionResult {
  info: CoreInfo;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  enabled?: boolean | null;
  updatedAt?: string | null;
}

export interface WorkflowSource {
  id: string;
  source: string;
  revision: string;
  etag: string;
}

export interface WorkflowSaveResult {
  revision: string;
  etag: string;
}

export interface WorkflowPort {
  name: string;
  type: string;
  required: boolean;
}

export interface WorkflowNodeDefinition {
  type: string;
  inputs: WorkflowPort[];
  outputs: WorkflowPort[];
  routes: string[];
  dynamicInputs: boolean;
  dynamicOutputs: boolean;
  dynamicRoutes: boolean;
}

export interface WorkflowProviderCatalog {
  id: string;
  providerType: string;
  displayName: string;
  allowedModels: string[];
  defaultModel?: string;
  capabilities: string[];
}

export interface WorkflowCatalog {
  nodes: WorkflowNodeDefinition[];
  providers: WorkflowProviderCatalog[];
}

export interface WorkflowAnalysis {
  workflow?: unknown;
  diagnostics: Array<{ code?: string; message: string }>;
}

export interface ExecutionMessage {
  id?: string | null;
  level?: string | null;
  message: string;
  timestamp?: string | null;
}

export interface NodeRun {
  id?: string | null;
  nodeId?: string | null;
  name?: string | null;
  status?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  messages: ExecutionMessage[];
}

export interface Execution {
  id: string;
  workflowId?: string | null;
  workflowName?: string | null;
  status?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
  error?: string | null;
  nodeRuns: NodeRun[];
}

export interface TraceSpan {
  id: string;
  parentSpanId?: string | null;
  kind: "node" | "provider" | "tool";
  nodeId?: string | null;
  name: string;
  attempt?: number | null;
  status: "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  startedAt: string;
  completedAt?: string | null;
  error?: string | null;
  attributes: Record<string, unknown>;
}

export interface ProviderUsageSummary {
  provider: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  usageCertainty: "reported" | "notReported";
  costCertainty: "providerReported" | "unknown";
}

export interface ExecutionTrace {
  execution: Execution;
  workflowRevision: string;
  workflowSource: string;
  planHash: string;
  spans: TraceSpan[];
  providerUsage: ProviderUsageSummary[];
  artifacts: Array<{ nodeId: string; artifactId: string }>;
}

export interface WorkflowRevision { id: string; createdAt: string; }
export interface WorkflowRevisionComparison {
  base: WorkflowRevision & { source: string };
  head: WorkflowRevision & { source: string };
}

/** Mirrors the public Core API; the GUI deliberately has no build-time SDK dependency. */
export interface SecretRecord {
  name: string;
  updatedAt: string;
}

type ProviderCapability = "text-generation" | "embeddings" | "streaming" | "tools" | "structured-output" | "vision" | "usage-reporting";
type ModelCapability = "text-generation" | "embeddings" | "streaming" | "tools" | "structured-output" | "vision" | "json-schema-output";

export interface ProviderModelCapabilities {
  apiVersion: "kakune.dev/v1";
  kind: "ProviderModelCapabilities";
  provider: { id: string; displayName?: string; capabilities: ProviderCapability[] };
  models: Array<{
    id: string;
    displayName?: string;
    capabilities: ModelCapability[];
    contextWindowTokens?: number;
    maxOutputTokens?: number;
  }>;
}

interface SdkProviderProfile {
  id: string;
  displayName: string;
  providerType: "codex" | "minimax";
  defaultModel: string;
  allowedModels: string[];
  capabilities: ProviderCapability[];
  auth: { type: "apiKey" | "oauthSecret"; secret_ref: string };
  config: Record<string, unknown>;
  diagnostic: { status: "unknown" | "available" | "unavailable"; checkedAt?: string; message?: string; details?: unknown };
  createdAt: string;
  updatedAt: string;
}

export type ProviderProfile = Omit<SdkProviderProfile, "capabilities" | "diagnostic" | "createdAt" | "updatedAt"> & {
  capabilities: string[];
  diagnostic?: SdkProviderProfile["diagnostic"];
};

export type ProviderCapabilities = ProviderModelCapabilities;

export interface PluginRecord {
  id: string;
  name: string;
  version?: string;
  enabled?: boolean;
  status?: string;
  digest?: string;
}

export interface PreparedPlugin {
  id: string;
  pluginName: string;
  version?: string;
  digest: string;
}
