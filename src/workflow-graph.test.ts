import { describe, expect, it } from "vitest";
import { executionNodeGraphId, addWorkflowNode, connectWorkflowInput, connectWorkflowRoute, deleteWorkflowNode, parseWorkflowGraph, updateWorkflowNodePosition, setWorkflowNodeProperty } from "./workflow-graph";

describe("parseWorkflowGraph", () => {
  it("projects canonical nodes, entry, and on routes", () => {
    const result = parseWorkflowGraph(`entry: read
nodes:
  - id: read
    type: kakune.fs.read-text@1
    on:
      success: finish
  - id: finish
    type: kakune.flow.end@1
`);

    expect(result.diagnostics).toEqual([]);
    expect(result.graph).toEqual({
      entry: "read",
      positions: {},
      nodes: [
        { id: "read", type: "kakune.fs.read-text@1", routes: { success: ["finish"] }, inputs: {}, scope: "nodes", bindings: {}, unknown: false, provider: undefined, model: undefined },
        { id: "finish", type: "kakune.flow.end@1", routes: {}, inputs: {}, scope: "nodes", bindings: {}, unknown: false, provider: undefined, model: undefined },
      ],
    });
  });

  it("reports invalid YAML without producing a graph", () => {
    const result = parseWorkflowGraph("entry: [unterminated");

    expect(result.graph).toBeUndefined();
    expect(result.diagnostics).not.toHaveLength(0);
  });

  it("rejects routes that do not resolve to a workflow node", () => {
    const result = parseWorkflowGraph(`entry: first
nodes:
  - id: first
    type: example@1
    on: { success: missing }
`);

    expect(result.graph).toBeUndefined();
    expect(result.diagnostics).toContain("Route 'success' on node 'first' targets unknown node 'missing'.");
  });

  it("rejects aliases rather than expanding source-defined structures", () => {
    const result = parseWorkflowGraph(`entry: first
nodes: &workflowNodes
  - id: first
    type: example@1
copy: *workflowNodes
`);

    expect(result.graph).toBeUndefined();
    expect(result.diagnostics).not.toHaveLength(0);
  });

  it("writes a moved node position into the YAML layout while retaining untouched comments", () => {
    const source = `# Workflow title
entry: read
nodes:
  - id: read # source node
    type: kakune.fs.read-text@1
`;
    const result = updateWorkflowNodePosition(source, "read", { x: 120, y: 240 });

    expect(result.diagnostics).toEqual([]);
    expect("source" in result && result.source).toContain("# Workflow title");
    expect("source" in result && result.source).toContain("source node");
    expect("source" in result && parseWorkflowGraph(result.source).graph?.positions).toEqual({ read: { x: 120, y: 240 } });
  });

  it("preserves unrelated YAML while applying visual node and connection commands", () => {
    const source = `# Keep this heading
entry: read
metadata:
  note: |
    Preserve this multiline value.
nodes:
  - id: read
    type: kakune.fs.read-text@1
  - id: finish # untouched node comment
    type: kakune.flow.end@1
`;
    const added = addWorkflowNode(source, { id: "write", type: "kakune.fs.write-text@1" });
    expect("source" in added).toBe(true);
    if (!("source" in added)) throw new Error("node must be added");
    const routed = connectWorkflowRoute(added.source, "read", "success", "write");
    if (!("source" in routed)) throw new Error(routed.diagnostics.join("; "));
    const connected = connectWorkflowInput(routed.source, "write", "content", "read", "text");
    expect("source" in connected).toBe(true);
    if (!("source" in connected)) throw new Error("data must be connected");
    const result = connected.source;
    expect(result).toContain("# Keep this heading");
    expect(result).toContain("Preserve this multiline value.");
    expect(result).toContain("# untouched node comment");
    expect(parseWorkflowGraph(result).graph?.nodes.find((node) => node.id === "read")?.routes.success).toEqual(["write"]);
    expect(parseWorkflowGraph(result).graph?.nodes.find((node) => node.id === "write")?.inputs.content).toBe("read.text");
    const removed = deleteWorkflowNode(result, "write");
    expect("source" in removed && removed.source).not.toContain("id: write");
  });

  it("projects fan-out routes, data bindings, subgraphs, and unknown plugin placeholders", () => {
    const result = parseWorkflowGraph(`entry: root
nodes:
  - id: root
    type: example.unknown@1
    on: { success: [left, right] }
    body:
      entry: nested
      nodes:
        - id: nested
          type: kakune.flow.end@1
  - id: left
    type: kakune.flow.pass@1
  - id: right
    type: kakune.flow.pass@1
    inputs:
      value: { from: left.value }
`, ["kakune.flow.end@1", "kakune.flow.pass@1"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.graph?.nodes.find((node) => node.id === "root")?.unknown).toBe(true);
    expect(result.graph?.nodes.find((node) => node.id === "root")?.routes.success).toEqual(["left", "right"]);
    expect(result.graph?.nodes.find((node) => node.id === "root/body/nested")?.scope).toBe("root/body");
    expect(result.graph?.nodes.find((node) => node.id === "right")?.inputs.value).toBe("left.value");
  });
});

describe("syntax and scope regression cases", () => {
  it("preserves comments and multiline styles when changing a quoted node", () => {
    const source = `entry: start\nnodes:\n  - id: "start"\n    type: old@1 # type comment\n    # input comment\n    inputs:\n      text:\n        literal: |\n          first\n          second\n`;
    const changed = setWorkflowNodeProperty(source, "start", "type", "new@1");
    if (!("source" in changed)) throw new Error(changed.diagnostics.join("; "));
    expect(changed.source).toContain("# type comment");
    expect(changed.source).toContain("# input comment");
    expect(changed.source).toContain("literal: |");
    const moved = updateWorkflowNodePosition(changed.source, "start", { x: 10, y: 20 });
    expect(moved.diagnostics).toEqual([]);
    if ("source" in moved) expect(parseWorkflowGraph(moved.source).graph?.positions.start).toEqual({ x: 10, y: 20 });
  });

  it("resolves nested routes locally and never confuses homonymous nodes", () => {
    const source = `entry: root\nnodes:\n  - id: root\n    type: loop@1\n    body:\n      entry: a\n      nodes:\n        - id: a\n          type: pass@1\n          on: {success: b}\n        - id: b\n          type: end@1\n  - id: b\n    type: outer@1\n`;
    const parsed = parseWorkflowGraph(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.graph?.nodes.find((node) => node.id === "root/body/a")?.routes.success).toEqual(["root/body/b"]);
    const changed = setWorkflowNodeProperty(source, "root/body/b", "type", "changed@1");
    if (!("source" in changed)) throw new Error(changed.diagnostics.join("; "));
    const graph = parseWorkflowGraph(changed.source).graph!;
    expect(graph.nodes.find((node) => node.id === "b")?.type).toBe("outer@1");
    expect(graph.nodes.find((node) => node.id === "root/body/b")?.type).toBe("changed@1");
    expect(connectWorkflowRoute(source, "root/body/a", "success", "b").diagnostics).not.toHaveLength(0);
  });
});

it("maps repeated runtime IDs to the correct source subgraph", () => {
  const graph = parseWorkflowGraph("entry: each\nnodes:\n  - id: each\n    type: kakune.flow.foreach@1\n    body:\n      entry: same\n      nodes: [{id: same, type: kakune.flow.pass@1}]\n  - id: same\n    type: kakune.flow.pass@1\n").graph!;
  expect(executionNodeGraphId(graph,"each/items/12/same")).toBe("each/body/same");
  expect(executionNodeGraphId(graph,"same")).toBe("same");
  expect(executionNodeGraphId(graph,"another/items/12/same")).toBeUndefined();
});
