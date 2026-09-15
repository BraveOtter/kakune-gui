import { isAlias, isMap, isScalar, isSeq, parseDocument, visit, type Document, type YAMLMap } from "yaml";

export interface WorkflowNodePosition { x: number; y: number; }
export interface WorkflowGraphNode {
  id: string; type: string; routes: Record<string, string[]>; inputs: Record<string, string>;
  bindings: Record<string, unknown>; scope: string; unknown: boolean; provider?: string; model?: string;
}
export interface WorkflowGraph { entry: string; nodes: WorkflowGraphNode[]; positions: Record<string, WorkflowNodePosition>; }
export interface WorkflowGraphParseResult { graph?: WorkflowGraph; diagnostics: string[]; }

/** Map an activation (including loop indices) to its exact source graph node. */
export function executionNodeGraphId(graph: WorkflowGraph, activation: string): string | undefined {
  const patterns = new Map<string, string>();
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const node of graph.nodes) {
    let prefix = "";
    if (node.scope.endsWith("/body")) {
      const owner = node.scope.slice(0, -5);
      const type = graph.nodes.find((candidate) => candidate.id === owner)?.type;
      const parent = patterns.get(owner);
      if (!parent) continue;
      prefix = `${parent}/${type === "kakune.flow.foreach@1" ? "items" : "iterations"}/[0-9]+/`;
    } else if (node.scope !== "nodes") {
      const split = node.scope.lastIndexOf("/branches/");
      const parent = patterns.get(node.scope.slice(0, split));
      if (split < 0 || !parent) continue;
      prefix = `${parent}/${escape(node.scope.slice(split + 10))}/`;
    }
    const pattern = prefix + escape(node.id.split("/").pop()!);
    patterns.set(node.id, pattern);
    if (new RegExp(`^${pattern}$`).test(activation.replace(/^\/+/, ""))) return node.id;
  }
  return undefined;
}
export type WorkflowEditResult = { source: string; diagnostics: [] } | { diagnostics: string[] };
type RecordValue = Record<string, unknown>;
type YamlPath = (string | number)[];
const isRecord = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
const qualify = (scope: string, id: string) => scope === "nodes" ? id : `${scope}/${id}`;

function readDocument(source: string) {
  if (!source.trim()) throw new Error("Workflow source is empty.");
  const document = parseDocument(source, { prettyErrors: false, schema: "core", strict: true, uniqueKeys: true, keepSourceTokens: true });
  if (document.errors.length) throw new Error(document.errors.map((error) => error.message).join("; "));
  visit(document, (_, node) => {
    if (isAlias(node) || (isRecord(node) && (node.anchor || node.tag))) throw new Error("Workflow aliases, anchors and tags are not supported.");
  });
  if (!isMap(document.contents)) throw new Error("Workflow source must contain a mapping.");
  return document;
}

/** Node identities are scoped; their source bindings remain local to the subgraph. */
export function parseWorkflowGraph(source: string, knownTypes: readonly string[] = []): WorkflowGraphParseResult {
  try {
    const value = readDocument(source).toJS({ maxAliasCount: 0 }) as RecordValue;
    const diagnostics: string[] = [], nodes: WorkflowGraphNode[] = [];
    function collect(graph: RecordValue, scope: string) {
      if (!Array.isArray(graph.nodes)) { diagnostics.push("Workflow nodes must be a sequence."); return; }
      const ids = new Set<string>();
      for (const raw of graph.nodes) {
        if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id || typeof raw.type !== "string" || !raw.type) { diagnostics.push(`Invalid node in scope '${scope}'.`); continue; }
        if (ids.has(raw.id)) diagnostics.push(`Node id '${raw.id}' is duplicated.`);
        ids.add(raw.id);
      }
      if (typeof graph.entry !== "string" || !ids.has(graph.entry)) diagnostics.push(`Workflow entry '${String(graph.entry)}' does not identify a node.`);
      for (const raw of graph.nodes) {
        if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.type !== "string") continue;
        const routes: Record<string, string[]> = {};
        if (raw.on !== undefined && !isRecord(raw.on)) diagnostics.push(`Node '${raw.id}' routes must be a mapping.`);
        else for (const [route, target] of Object.entries(raw.on ?? {})) {
          const targets = typeof target === "string" ? [target] : Array.isArray(target) && target.every((item) => typeof item === "string") ? target as string[] : [];
          if (!targets.length) diagnostics.push(`Route '${route}' on node '${raw.id}' must target node ids.`);
          for (const id of targets) if (!ids.has(id)) diagnostics.push(`Route '${route}' on node '${raw.id}' targets unknown node '${id}'.`);
          routes[route] = targets.map((id) => qualify(scope, id));
        }
        const inputs: Record<string, string> = {};
        if (isRecord(raw.inputs)) for (const [name, binding] of Object.entries(raw.inputs)) {
          if (isRecord(binding) && typeof binding.from === "string") inputs[name] = binding.from.startsWith("$") ? binding.from : qualify(scope, binding.from);
        }
        const config = isRecord(raw.with) ? raw.with : {}, id = qualify(scope, raw.id);
        nodes.push({ id, type: raw.type, routes, inputs, bindings: isRecord(raw.inputs) ? raw.inputs : {}, scope, unknown: knownTypes.length > 0 && !knownTypes.includes(raw.type), provider: typeof config.provider === "string" ? config.provider : undefined, model: typeof config.model === "string" ? config.model : undefined });
        if (isRecord(raw.body)) collect(raw.body, `${id}/body`);
        if (isRecord(raw.branches)) for (const [branch, child] of Object.entries(raw.branches)) if (isRecord(child)) collect(child, `${id}/branches/${branch}`);
      }
    }
    collect(value, "nodes");
    const positions: Record<string, WorkflowNodePosition> = {};
    if (isRecord(value.layout) && isRecord(value.layout.nodes)) for (const [id, position] of Object.entries(value.layout.nodes)) {
      if (!nodes.some((node) => node.id === id) || !isRecord(position) || typeof position.x !== "number" || typeof position.y !== "number" || !Number.isFinite(position.x) || !Number.isFinite(position.y)) diagnostics.push(`Layout position '${id}' must identify a node and contain finite numeric x and y values.`);
      else positions[id] = { x: position.x, y: position.y };
    }
    return diagnostics.length ? { diagnostics } : { graph: { entry: value.entry as string, nodes, positions }, diagnostics: [] };
  } catch (error) { return { diagnostics: [error instanceof Error ? error.message : String(error)] }; }
}

function nodePaths(document: Document): Map<string, YamlPath> {
  const result = new Map<string, YamlPath>();
  function collect(graphPath: YamlPath, scope: string) {
    const sequence = document.getIn([...graphPath, "nodes"], true);
    if (!isSeq(sequence)) return;
    sequence.items.forEach((item, index) => {
      if (!isMap(item)) return;
      const id = item.get("id");
      if (typeof id !== "string") return;
      const key = qualify(scope, id), path = [...graphPath, "nodes", index];
      result.set(key, path);
      collect([...path, "body"], `${key}/body`);
      const branches = item.get("branches", true);
      if (isMap(branches)) for (const pair of branches.items) if (isScalar(pair.key) && typeof pair.key.value === "string") collect([...path, "branches", pair.key.value], `${key}/branches/${pair.key.value}`);
    });
  }
  collect([], "nodes");
  return result;
}
function requireNode(document: Document, id: string): YamlPath {
  const path = nodePaths(document).get(id);
  if (!path) throw new Error(`Node '${id}' does not exist in the workflow source.`);
  return path;
}
function edit(source: string, mutate: (document: Document) => void): WorkflowEditResult {
  try {
    const document = readDocument(source);
    mutate(document);
    // Retain the syntax document, including comments, styles, extensions and ordering.
    return { source: document.toString({ lineWidth: 0 }), diagnostics: [] };
  } catch (error) { return { diagnostics: [error instanceof Error ? error.message : String(error)] }; }
}
function setValue(document: Document, path: YamlPath, value: unknown) {
  const previous = document.getIn(path, true);
  if (isScalar(previous) && (value === null || typeof value !== "object")) previous.value = value;
  else {
    const next = document.createNode(value);
    if (previous && typeof previous === "object" && "comment" in previous) {
      next.comment = previous.comment as string | undefined;
      next.commentBefore = (previous as { commentBefore?: string }).commentBefore;
    }
    document.setIn(path, next);
  }
}
export function updateWorkflowNodePosition(source: string, id: string, position: WorkflowNodePosition): WorkflowEditResult {
  return edit(source, (document) => {
    requireNode(document, id);
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error("Node positions must be finite numbers.");
    setValue(document, ["layout", "nodes", id, "x"], position.x);
    setValue(document, ["layout", "nodes", id, "y"], position.y);
  });
}
export function addWorkflowNode(source: string, node: { id: string; type: string }, ownerId?: string, branch?: string): WorkflowEditResult {
  return edit(source, (document) => {
    if (!node.id.trim() || !node.type.trim() || node.id.includes("/")) throw new Error("A local node id and type are required.");
    const graphPath = ownerId ? [...requireNode(document, ownerId), ...(branch === undefined ? ["body"] : ["branches", branch])] : [];
    let sequence = document.getIn([...graphPath, "nodes"], true);
    if (sequence === undefined && ownerId) { document.setIn(graphPath, document.createNode({ entry: node.id, nodes: [] })); sequence = document.getIn([...graphPath, "nodes"], true); }
    if (!isSeq(sequence)) throw new Error("Workflow nodes must be a sequence before adding a node.");
    if (sequence.items.some((item) => isMap(item) && item.get("id") === node.id)) throw new Error(`Node '${node.id}' already exists.`);
    sequence.add(document.createNode(node));
  });
}
export function deleteWorkflowNode(source: string, id: string): WorkflowEditResult {
  return edit(source, (document) => {
    const path = requireNode(document, id), graphPath = path.slice(0, -2);
    const localId = document.getIn([...path, "id"]) as string;
    if (document.getIn([...graphPath, "entry"]) === localId) throw new Error("Choose a different entry node before deleting this node.");
    document.deleteIn(path);
    const sequence = document.getIn([...graphPath, "nodes"], true);
    if (isSeq(sequence)) for (const sibling of sequence.items) {
      if (!isMap(sibling)) continue;
      const routes = sibling.get("on", true);
      if (isMap(routes)) for (const pair of [...routes.items]) {
        if (isScalar(pair.value) && pair.value.value === localId) routes.delete(pair.key);
        if (isSeq(pair.value)) { pair.value.items = pair.value.items.filter((target) => !isScalar(target) || target.value !== localId); if (!pair.value.items.length) routes.delete(pair.key); }
      }
    }
    const layout = document.getIn(["layout", "nodes"], true);
    if (isMap(layout)) for (const pair of [...layout.items]) if (isScalar(pair.key) && typeof pair.key.value === "string" && (pair.key.value === id || pair.key.value.startsWith(`${id}/`))) layout.delete(pair.key);
  });
}
export function setWorkflowNodeProperty(source: string, id: string, property: "type" | "provider" | "model", value: string): WorkflowEditResult {
  return setWorkflowNodeValue(source, id, property === "type" ? ["type"] : ["with", property], value);
}
export function setWorkflowNodeValue(source: string, id: string, path: string[], value: unknown): WorkflowEditResult {
  return edit(source, (document) => setValue(document, [...requireNode(document, id), ...path], value));
}
function connection(document: Document, from: string, to: string) {
  const source = requireNode(document, from), target = requireNode(document, to);
  if (JSON.stringify(source.slice(0, -1)) !== JSON.stringify(target.slice(0, -1))) throw new Error("Connections must remain in the same subgraph; expose a subgraph output to cross scopes.");
  return { source, target, targetId: document.getIn([...target, "id"]) as string };
}
export function connectWorkflowRoute(source: string, sourceId: string, route: string, targetId: string): WorkflowEditResult {
  return edit(source, (document) => {
    const link = connection(document, sourceId, targetId), path = [...link.source, "on", route], existing = document.getIn(path, true);
    if (isSeq(existing)) { if (!existing.items.some((item) => isScalar(item) && item.value === link.targetId)) existing.add(link.targetId); }
    else if (isScalar(existing) && existing.value !== link.targetId) setValue(document, path, [existing.value, link.targetId]);
    else setValue(document, path, link.targetId);
  });
}
export function disconnectWorkflowRoute(source: string, sourceId: string, route: string): WorkflowEditResult {
  return edit(source, (document) => { document.deleteIn([...requireNode(document, sourceId), "on", route]); });
}
export function connectWorkflowInput(source: string, consumerId: string, input: string, producerId: string, output: string): WorkflowEditResult {
  return edit(source, (document) => { const link = connection(document, consumerId, producerId); setValue(document, [...link.source, "inputs", input], { from: `${link.targetId}.${output}` }); });
}
export function copyWorkflowNode(source: string, id: string, newId: string): WorkflowEditResult {
  return edit(source, (document) => {
    if (!newId.trim() || newId.includes("/")) throw new Error("A local node id is required.");
    const path = requireNode(document, id), sequence = document.getIn(path.slice(0, -1), true);
    if (!isSeq(sequence)) throw new Error("Node sequence is unavailable.");
    if (sequence.items.some((item) => isMap(item) && item.get("id") === newId)) throw new Error(`Node '${newId}' already exists.`);
    const node = (document.getIn(path, true) as YAMLMap).clone();
    node.set("id", newId); node.delete("on"); sequence.add(node);
  });
}
export function autoLayoutWorkflow(source: string): WorkflowEditResult {
  const parsed = parseWorkflowGraph(source);
  if (!parsed.graph) return { diagnostics: parsed.diagnostics };
  return edit(source, (document) => parsed.graph!.nodes.forEach((node, index) => setValue(document, ["layout", "nodes", node.id], { x: 80 + (index % 3) * 280, y: 80 + Math.floor(index / 3) * 180 })));
}
