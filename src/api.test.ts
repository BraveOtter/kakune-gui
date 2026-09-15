import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { coreClient } from "./api";

describe("coreClient workflow commands", () => {
  beforeEach(() => invoke.mockReset());

  it("uses the workflow source commands with the selected context", () => {
    void coreClient.getWorkflowSource("context-1", "workflow-1");
    expect(invoke).toHaveBeenLastCalledWith("get_workflow_source", { contextId: "context-1", workflowId: "workflow-1" });

    void coreClient.saveWorkflowSource("context-1", "workflow-1", "name: daily", "\"revision-1\"");
    expect(invoke).toHaveBeenLastCalledWith("save_workflow_source", { contextId: "context-1", workflowId: "workflow-1", source: "name: daily", etag: "\"revision-1\"" });

    void coreClient.createWorkflow("context-1", "name: daily");
    expect(invoke).toHaveBeenLastCalledWith("create_workflow", { contextId: "context-1", source: "name: daily" });
  });

  it("uses the workflow state and execution commands", () => {
    void coreClient.setWorkflowEnabled("context-1", "workflow-1", true);
    expect(invoke).toHaveBeenLastCalledWith("set_workflow_enabled", { contextId: "context-1", workflowId: "workflow-1", enabled: true });

    void coreClient.executeWorkflow("context-1", "workflow-1");
    expect(invoke).toHaveBeenLastCalledWith("execute_workflow", { contextId: "context-1", workflowId: "workflow-1" });
  });

  it("uses context-scoped execution inspection commands", () => {
    void coreClient.listExecutions("context-1");
    expect(invoke).toHaveBeenLastCalledWith("list_executions", { contextId: "context-1" });

    void coreClient.getExecution("context-1", "execution-1");
    expect(invoke).toHaveBeenLastCalledWith("get_execution", { contextId: "context-1", executionId: "execution-1" });
  });

  it("scopes administrative operations to a context", () => {
    void coreClient.listSecrets("context-1");
    expect(invoke).toHaveBeenLastCalledWith("list_secrets", { contextId: "context-1" });

    void coreClient.saveProvider("context-1", { id: "minimax", displayName: "MiniMax", providerType: "minimax", defaultModel: "MiniMax-M3", allowedModels: ["MiniMax-M3"], capabilities: ["text-generation"], auth: { type: "apiKey", secret_ref: "minimax-key" }, config: {} });
    expect(invoke).toHaveBeenLastCalledWith("save_provider", { contextId: "context-1", profile: expect.objectContaining({ id: "minimax" }) });

    void coreClient.callMcp("context-1", { toolName: "echo" });
    expect(invoke).toHaveBeenLastCalledWith("call_mcp", { contextId: "context-1", request: { toolName: "echo" } });
  });
});
