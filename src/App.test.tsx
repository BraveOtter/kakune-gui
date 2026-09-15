import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@xyflow/react", () => ({
  Background: () => null,
  ReactFlow: ({ children }: { children: ReactNode }) => <div data-testid="react-flow">{children}</div>,
}));

import { App } from "./App";

describe("Executions view", () => {
  beforeEach(() => {
    localStorage.clear();
    invoke.mockReset();
    invoke.mockImplementation((command: string) => {
      if (command === "list_contexts") return Promise.resolve([{
        id: "context-1", name: "Local Core", kind: "local", endpoint: "http://127.0.0.1:8080", hasToken: true, createdAt: "2026-09-09T10:00:00Z",
      }]);
      if (command === "list_executions") return Promise.resolve([{
        id: "execution-1", workflowId: "daily", status: "failed", startedAt: "2026-09-09T10:00:00Z", error: "Step failed", nodeRuns: [],
      }]);
      if (command === "get_execution") return Promise.resolve({
        id: "execution-1", workflowId: "daily", status: "failed", error: "Step failed", nodeRuns: [{ nodeId: "fetch", status: "failed", messages: [{ level: "error", message: "Timeout" }] }],
      });
      return Promise.resolve();
    });
  });

  it("lists and inspects executions in the selected context", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Executions" }));

    expect(await screen.findByText("execution-1")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("list_executions", { contextId: "context-1" });

    fireEvent.click(screen.getByRole("button", { name: /execution-1/i }));
    expect(await screen.findByRole("complementary", { name: "Execution details" })).toBeInTheDocument();
    expect(screen.getByText("Timeout")).toBeInTheDocument();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_execution", { contextId: "context-1", executionId: "execution-1" }));
  });
});

describe("Workflow editor", () => {
  beforeEach(() => {
    localStorage.clear();
    invoke.mockReset();
    invoke.mockImplementation((command: string) => {
      if (command === "list_contexts") return Promise.resolve([{
        id: "context-1", name: "Local Core", kind: "local", endpoint: "http://127.0.0.1:8080", hasToken: true, createdAt: "2026-09-09T10:00:00Z",
      }]);
      if (command === "list_workflows") return Promise.resolve([{
        id: "daily", name: "Daily workflow", enabled: true,
      }]);
      if (command === "get_workflow_source") return Promise.resolve(`entry: read
nodes:
  - id: read
    type: example.read@1
    on:
      success: finish
  - id: finish
    type: example.finish@1
`);
      return Promise.resolve();
    });
  });

  it("keeps the selected workflow when an older source request finishes late", async () => {
    let resolveOld!: (source: string) => void;
    const old = new Promise<string>((resolve) => { resolveOld = resolve; });
    const fallback = invoke.getMockImplementation()!;
    invoke.mockImplementation((command: string, args?: { workflowId?: string }) => {
      if (command === "list_workflows") return Promise.resolve([
        { id: "old", name: "Old workflow", enabled: true },
        { id: "new", name: "Latest workflow", enabled: true },
      ]);
      if (command === "get_workflow_source") return args?.workflowId === "old" ? old : Promise.resolve("entry: newer\nnodes: [{id: newer, type: kakune.flow.pass@1}]\n");
      return fallback(command, args);
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Workflows" }));
    fireEvent.click(await screen.findByRole("button", { name: /Old workflow/ }));
    fireEvent.click(screen.getByRole("button", { name: /Latest workflow/ }));
    await screen.findByDisplayValue(/entry: newer/);
    resolveOld("entry: older\nnodes: [{id: older, type: kakune.flow.pass@1}]\n");
    await waitFor(() => expect(screen.getByLabelText("Workflow source")).toHaveValue("entry: newer\nnodes: [{id: newer, type: kakune.flow.pass@1}]\n"));
  });

  it("switches to the graph projection and keeps its last valid source on parse errors", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Workflows" }));
    fireEvent.click(await screen.findByRole("button", { name: /Daily workflow/ }));
    await screen.findByDisplayValue(/entry: read/);

    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    expect(await screen.findByLabelText("Workflow routes")).toHaveTextContent("Entry: read");
    expect(screen.getByLabelText("Workflow routes")).toHaveTextContent("Route: success; Target: finish");

    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    fireEvent.change(screen.getByLabelText("Workflow source"), { target: { value: "entry: [broken" } });
    expect(await screen.findByText("The graph shows the last valid source while the current YAML has errors.")).toBeInTheDocument();
    expect(screen.getByLabelText("Workflow routes")).toHaveTextContent("Entry: read");
  });
});

describe("Context isolation", () => {
  it("does not render a late workflow response from a previously selected context", async () => {
    let resolveFirst: (value: { id: string; name: string; enabled: boolean }[]) => void;
    let resolveSecond: (value: { id: string; name: string; enabled: boolean }[]) => void;
    const first = new Promise<{ id: string; name: string; enabled: boolean }[]>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<{ id: string; name: string; enabled: boolean }[]>((resolve) => { resolveSecond = resolve; });
    let workflowCalls = 0;
    invoke.mockReset();
    invoke.mockImplementation((command: string) => {
      if (command === "list_contexts") return Promise.resolve([
        { id: "first", name: "First Core", kind: "local", endpoint: "http://127.0.0.1:8080", hasToken: true, createdAt: "2026-09-09T10:00:00Z" },
        { id: "second", name: "Second Core", kind: "remote", endpoint: "https://core.example", hasToken: true, createdAt: "2026-09-09T10:00:00Z" },
      ]);
      if (command === "test_saved_context") return Promise.resolve({ info: { coreId: "test" } });
      if (command === "list_workflows") return workflowCalls++ === 0 ? first : second;
      return Promise.resolve();
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Workflows" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_workflows", { contextId: "first" }));

    fireEvent.click(screen.getByRole("button", { name: "Contexts" }));
    const secondContext = screen.getByText("Second Core").closest("li");
    expect(secondContext).not.toBeNull();
    fireEvent.click(within(secondContext!).getByRole("button", { name: "Workflows" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_workflows", { contextId: "second" }));

    resolveSecond!([{ id: "second-workflow", name: "Second workflow", enabled: true }]);
    expect(await screen.findByText("Second workflow")).toBeInTheDocument();
    resolveFirst!([{ id: "first-workflow", name: "First workflow", enabled: true }]);
    await waitFor(() => expect(screen.queryByText("First workflow")).not.toBeInTheDocument());
  });
});

describe("Execution observability", () => {
  it("renders a trace timeline, workflow overlay and unknown provider cost", async () => {
    invoke.mockReset();
    invoke.mockImplementation((command: string) => {
      if (command === "list_contexts") return Promise.resolve([{ id: "context-1", name: "Local Core", kind: "local", endpoint: "http://127.0.0.1:8080", hasToken: true, createdAt: "2026-09-09T10:00:00Z" }]);
      if (command === "list_executions") return Promise.resolve([{ id: "execution-1", workflowId: "daily", status: "succeeded", nodeRuns: [] }]);
      if (command === "get_execution_trace") return Promise.resolve({
        execution: { id: "execution-1", workflowId: "daily", status: "succeeded", nodeRuns: [] },
        workflowRevision: "revision-1", planHash: "plan-hash", workflowSource: "entry: call\nnodes:\n  - id: call\n    type: kakune.ai.prompt@1\n",
        spans: [
          { id: "node-1", kind: "node", nodeId: "call", name: "kakune.ai.prompt@1", attempt: 1, status: "succeeded", startedAt: "2026-09-09T10:00:00Z", attributes: {} },
          { id: "provider-1", parentSpanId: "node-1", kind: "provider", nodeId: "call", name: "minimax", status: "succeeded", startedAt: "2026-09-09T10:00:01Z", attributes: {} },
        ],
        providerUsage: [{ provider: "minimax", model: "MiniMax-M3", totalTokens: 12, usageCertainty: "reported", costCertainty: "unknown" }],
        artifacts: [],
      });
      return Promise.resolve();
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Executions" }));
    fireEvent.click(await screen.findByRole("button", { name: /execution-1/i }));
    expect(await screen.findByLabelText("Execution observability")).toBeInTheDocument();
    expect(screen.getByText("Cost unknown")).toBeInTheDocument();
    expect(screen.getByText("Workflow overlay")).toBeInTheDocument();
    expect(screen.getByText(/provider: minimax/i)).toBeInTheDocument();
  });
});

