export type ContextKind = "local" | "remote";

export interface CoreContext {
  id: string;
  name: string;
  kind: ContextKind;
  endpoint: string;
  hasToken: boolean;
  createdAt: string;
}

export interface ContextInput {
  id?: string;
  name: string;
  kind: ContextKind;
  endpoint: string;
  token?: string;
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
  updatedAt?: string | null;
}
