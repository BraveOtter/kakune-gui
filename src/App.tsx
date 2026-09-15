import { FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Background, ReactFlow, type Edge, type Node, type OnNodeDrag } from "@xyflow/react";
import { coreClient } from "./api";
import { initialLocale, type Locale, translate } from "./i18n";
import { initialTheme, resolveTheme, type Theme } from "./theme";
import type { ContextInput, CoreContext, Execution, ExecutionTrace, NodeRun, PluginRecord, PreparedPlugin, ProviderCapabilities, ProviderProfile, SecretRecord, Workflow, WorkflowAnalysis, WorkflowCatalog, WorkflowRevisionComparison } from "./types";
import { executionNodeGraphId, setWorkflowNodeValue, autoLayoutWorkflow, copyWorkflowNode, disconnectWorkflowRoute, addWorkflowNode, connectWorkflowInput, connectWorkflowRoute, deleteWorkflowNode, parseWorkflowGraph, setWorkflowNodeProperty, updateWorkflowNodePosition, type WorkflowGraph, type WorkflowNodePosition } from "./workflow-graph";

type View = "contexts" | "workflows" | "executions" | "administration" | "settings";
type ConnectionState = "checking" | "online" | "offline" | "authentication" | "tls";

const emptyContext = (): ContextInput => ({
  name: "",
  kind: "local",
  endpoint: "http://127.0.0.1:8080",
  token: "",
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  const [view, setView] = useState<View>("contexts");
  const [contexts, setContexts] = useState<CoreContext[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<ContextInput | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>();
  const [workflowSource, setWorkflowSource] = useState("");
  const [workflowEtag, setWorkflowEtag] = useState("");
  const [workflowCatalog, setWorkflowCatalog] = useState<WorkflowCatalog>({ nodes: [], providers: [] });
  const [workflowConflict, setWorkflowConflict] = useState(false);
  const [creatingWorkflow, setCreatingWorkflow] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [savingSource, setSavingSource] = useState(false);
  const [updatingWorkflow, setUpdatingWorkflow] = useState(false);
  const [executingWorkflow, setExecutingWorkflow] = useState(false);
  const [executionResult, setExecutionResult] = useState<string>();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string>();
  const [selectedExecution, setSelectedExecution] = useState<Execution>();
  const [selectedTrace, setSelectedTrace] = useState<ExecutionTrace>();
  const [artifactPreview, setArtifactPreview] = useState<string>();
  const [executionLoading, setExecutionLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [connection, setConnection] = useState<ConnectionState>();
  const [exportedContexts, setExportedContexts] = useState("");
  const [importSource, setImportSource] = useState("");
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const selectedIdRef = useRef<string | undefined>(undefined);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const selected = contexts.find((context) => context.id === selectedId);
  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId);

  useEffect(() => {
    void loadContexts();
  }, []);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (view === "workflows" && selectedId) {
      void loadWorkflows();
    }
  }, [view, selectedId]);

  useEffect(() => {
    if (view === "executions" && selectedId) {
      void loadExecutions();
    }
  }, [view, selectedId]);

  useEffect(() => {
    workflowRequest.current++;
    executionRequest.current++;
    setWorkflowCatalog({ nodes: [], providers: [] });
    setSavingSource(false);
    setUpdatingWorkflow(false);
    setExecutingWorkflow(false);
    setSelectedWorkflowId(undefined);
    setWorkflowSource("");
    setWorkflowEtag("");
    setWorkflowConflict(false);
    setCreatingWorkflow(false);
    setSourceLoading(false);
    setExecutionResult(undefined);
    setExecutions([]);
    setSelectedExecutionId(undefined);
    setSelectedExecution(undefined);
    setSelectedTrace(undefined);
    setArtifactPreview(undefined);
    setExecutionLoading(false);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setConnection(undefined);
      return;
    }
    void refreshConnection(selectedId);
    const interval = window.setInterval(() => void refreshConnection(selectedId), 10_000);
    return () => window.clearInterval(interval);
  }, [selectedId]);

  useEffect(() => {
    localStorage.setItem("kakune.locale", locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      document.documentElement.dataset.theme = resolveTheme(theme, media.matches);
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    localStorage.setItem("kakune.theme", theme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  async function loadContexts() {
    setLoading(true);
    setError(undefined);
    try {
      const nextContexts = await coreClient.listContexts();
      setContexts(nextContexts);
      setSelectedId((current) =>
        current && nextContexts.some((context) => context.id === current)
          ? current
          : nextContexts[0]?.id,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  async function saveContext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setError(undefined);
    setNotice(undefined);
    try {
      const saved = await coreClient.saveContext(draft);
      setDraft(null);
      await loadContexts();
      setSelectedId(saved.id);
      setNotice(t("connected"));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function testConnection() {
    if (!draft) return;
    setTesting(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await coreClient.testConnection(draft);
      const version = typeof result.info.version === "string" ? ` (${result.info.version})` : "";
      const coreId = typeof result.info.coreId === "string" ? result.info.coreId : undefined;
      setDraft((current) => current ? { ...current, expectedCoreId: coreId ?? current.expectedCoreId } : current);
      setNotice(`${t("connected")}${version}`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setTesting(false);
    }
  }

  function connectionState(error: unknown): ConnectionState {
    const message = errorMessage(error).toLowerCase();
    if (message.includes("401") || message.includes("403") || message.includes("auth")) return "authentication";
    if (message.includes("certificate") || message.includes("tls") || message.includes("pem")) return "tls";
    return "offline";
  }

  async function refreshConnection(contextId: string) {
    if (selectedIdRef.current === contextId) setConnection("checking");
    try {
      await coreClient.testSavedContext(contextId);
      if (selectedIdRef.current === contextId) setConnection("online");
    } catch (cause) {
      if (selectedIdRef.current === contextId) setConnection(connectionState(cause));
    }
  }

  async function exportContextReferences() {
    setError(undefined);
    try {
      setExportedContexts(await coreClient.exportContexts());
      setNotice(t("contextsExported"));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function importContextReferences() {
    setError(undefined);
    try {
      const imported = await coreClient.importContexts(importSource);
      setImportSource("");
      await loadContexts();
      setSelectedId(imported[0]?.id ?? selectedIdRef.current);
      setNotice(t("contextsImported"));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function removeContext(id: string) {
    setError(undefined);
    try {
      await coreClient.deleteContext(id);
      await loadContexts();
      setWorkflows([]);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function loadWorkflows() {
    if (!selectedId) return;
    const contextId = selectedId;
    setLoading(true);
    setError(undefined);
    try {
      const nextWorkflows = await coreClient.listWorkflows(contextId);
      if (selectedIdRef.current === contextId) setWorkflows(nextWorkflows);
    } catch (cause) {
      if (selectedIdRef.current === contextId) setError(errorMessage(cause));
    } finally {
      if (selectedIdRef.current === contextId) setLoading(false);
    }
  }

  async function loadExecutions() {
    if (!selectedId) return;
    const contextId = selectedId;
    setLoading(true);
    setError(undefined);
    try {
      const nextExecutions = await coreClient.listExecutions(contextId);
      if (selectedIdRef.current === contextId) {
        setExecutions(nextExecutions);
        setSelectedExecutionId((current) =>
          current && nextExecutions.some((execution) => execution.id === current) ? current : undefined,
        );
      }
    } catch (cause) {
      if (selectedIdRef.current === contextId) setError(errorMessage(cause));
    } finally {
      if (selectedIdRef.current === contextId) setLoading(false);
    }
  }

  const workflowRequest = useRef(0);
  const executionRequest = useRef(0);

  async function selectExecution(executionId: string) {
    if (!selectedId) return;
    const contextId = selectedId;
    const request = ++executionRequest.current;
    const isCurrent = () => selectedIdRef.current === contextId && request === executionRequest.current;
    setSelectedExecutionId(executionId);
    setSelectedExecution(undefined);
    setSelectedTrace(undefined);
    setArtifactPreview(undefined);
    setExecutionLoading(true);
    setError(undefined);
    try {
      const trace = await coreClient.getExecutionTrace(contextId, executionId);
      if (trace?.execution && isCurrent()) {
        setSelectedTrace(trace);
        setSelectedExecution(trace.execution);
      } else {
        const execution = await coreClient.getExecution(contextId, executionId);
        if (isCurrent()) setSelectedExecution(execution);
      }
    } catch (cause) {
      if (isCurrent()) setError(errorMessage(cause));
    } finally {
      if (isCurrent()) setExecutionLoading(false);
    }
  }

  async function selectWorkflow(workflowId: string) {
    if (!selectedId) return;
    const contextId = selectedId;
    const request = ++workflowRequest.current;
    const isCurrent = () => selectedIdRef.current === contextId && request === workflowRequest.current;
    setSelectedWorkflowId(workflowId);
    setCreatingWorkflow(false);
    setWorkflowConflict(false);
    setSourceLoading(true);
    setWorkflowSource("");
    setExecutionResult(undefined);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await coreClient.getWorkflowSource(contextId, workflowId);
      if (isCurrent()) {
        const source = typeof response === "string" ? response : response.source;
        const etag = typeof response === "string" ? "" : response.etag;
        const draftKey = `kakune.workflow-draft.${contextId}.${workflowId}`;
        const draft = localStorage.getItem(draftKey);
        setWorkflowSource(draft ?? source);
        setWorkflowEtag(etag);
        void coreClient.getWorkflowCatalog(contextId).then((catalog) => {
          const nextCatalog = catalog?.nodes ? catalog : { nodes: [], providers: [] };
          localStorage.setItem(`kakune.workflow-catalog.${contextId}`, JSON.stringify(nextCatalog));
          if (isCurrent()) setWorkflowCatalog(nextCatalog);
        }).catch(() => {
          if (!isCurrent()) return;
          try {
            const cached = localStorage.getItem(`kakune.workflow-catalog.${contextId}`);
            setWorkflowCatalog(cached ? JSON.parse(cached) : { nodes: [], providers: [] });
          } catch { setWorkflowCatalog({ nodes: [], providers: [] }); }
        });
      }
    } catch (cause) {
      if (isCurrent()) setError(errorMessage(cause));
    } finally {
      if (isCurrent()) setSourceLoading(false);
    }
  }

  function startCreatingWorkflow() {
    workflowRequest.current++;
    setSelectedWorkflowId(undefined);
    setCreatingWorkflow(true);
    setWorkflowSource("");
    setWorkflowEtag("");
    setWorkflowConflict(false);
    setExecutionResult(undefined);
    setError(undefined);
    setNotice(undefined);
  }

  async function saveWorkflowSource() {
    if (!selectedId || (!selectedWorkflowId && !creatingWorkflow)) return;
    const contextId = selectedId;
    const request = workflowRequest.current;
    const isCurrent = () => selectedIdRef.current === contextId && request === workflowRequest.current;
    setSavingSource(true);
    setError(undefined);
    setNotice(undefined);
    try {
      if (creatingWorkflow) {
        await coreClient.createWorkflow(selectedId, workflowSource);
        if (!isCurrent()) return;
        setCreatingWorkflow(false);
        setWorkflowSource("");
        setNotice(t("workflowCreated"));
        await loadWorkflows();
      } else if (selectedWorkflowId) {
        if (!workflowEtag) throw new Error("The workflow revision is unavailable. Reload before saving.");
        const result = await coreClient.saveWorkflowSource(selectedId, selectedWorkflowId, workflowSource, workflowEtag);
        if (!isCurrent()) return;
        setWorkflowEtag(result.etag);
        setWorkflowConflict(false);
        localStorage.removeItem(`kakune.workflow-draft.${selectedId}.${selectedWorkflowId}`);
        setNotice(t("sourceSaved"));
        await loadWorkflows();
      }
    } catch (cause) {
      if (!isCurrent()) return;
      if (selectedId && selectedWorkflowId) localStorage.setItem(`kakune.workflow-draft.${selectedId}.${selectedWorkflowId}`, workflowSource);
      if (errorMessage(cause).includes("409")) setWorkflowConflict(true);
      setError(errorMessage(cause));
    } finally {
      if (isCurrent())
      setSavingSource(false);
    }
  }

  async function setWorkflowEnabled(enabled: boolean) {
    if (!selectedId || !selectedWorkflowId) return;
    const contextId = selectedId;
    const request = workflowRequest.current;
    const isCurrent = () => selectedIdRef.current === contextId && request === workflowRequest.current;
    setUpdatingWorkflow(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await coreClient.setWorkflowEnabled(selectedId, selectedWorkflowId, enabled);
        if (!isCurrent()) return;
      setWorkflows((current) => current.map((workflow) => workflow.id === selectedWorkflowId ? { ...workflow, enabled, status: enabled ? "enabled" : "disabled" } : workflow));
      setNotice(t(enabled ? "workflowEnabled" : "workflowDisabled"));
    } catch (cause) {
      if (!isCurrent()) return;
      setError(errorMessage(cause));
    } finally {
      if (isCurrent())
      setUpdatingWorkflow(false);
    }
  }

  async function reloadWorkflowAfterConflict() {
    if (!selectedId || !selectedWorkflowId) return;
    const contextId = selectedId;
    const request = workflowRequest.current;
    const isCurrent = () => selectedIdRef.current === contextId && request === workflowRequest.current;
    try {
      const response = await coreClient.getWorkflowSource(selectedId, selectedWorkflowId);
        if (!isCurrent()) return;
      setWorkflowSource(response.source);
      setWorkflowEtag(response.etag);
      setWorkflowConflict(false);
    } catch (cause) {
      if (!isCurrent()) return; setError(errorMessage(cause)); }
  }

  function reapplyWorkflowDraft() {
    if (!selectedId || !selectedWorkflowId) return;
    const draft = localStorage.getItem(`kakune.workflow-draft.${selectedId}.${selectedWorkflowId}`);
    if (draft) setWorkflowSource(draft);
    setWorkflowConflict(false);
  }

  async function executeWorkflow() {
    if (!selectedId || !selectedWorkflowId) return;
    const contextId = selectedId;
    const request = workflowRequest.current;
    const isCurrent = () => selectedIdRef.current === contextId && request === workflowRequest.current;
    setExecutingWorkflow(true);
    setError(undefined);
    setNotice(undefined);
    setExecutionResult(undefined);
    try {
      const result = await coreClient.executeWorkflow(selectedId, selectedWorkflowId);
        if (!isCurrent()) return;
      setExecutionResult(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    } catch (cause) {
      if (!isCurrent()) return;
      setError(errorMessage(cause));
    } finally {
      if (isCurrent())
      setExecutingWorkflow(false);
    }
  }

  function openWorkflows(id: string) {
    setSelectedId(id);
    setView("workflows");
    setWorkflows([]);
  }

  function openExecutions(id: string) {
    setSelectedId(id);
    setView("executions");
    setExecutions([]);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">{t("appName")}</div>
        <nav aria-label={t("mainNavigation")}>
          <button className={view === "contexts" ? "active" : ""} onClick={() => setView("contexts")}>{t("contexts")}</button>
          <button className={view === "workflows" ? "active" : ""} onClick={() => setView("workflows")}>{t("workflows")}</button>
          <button className={view === "executions" ? "active" : ""} onClick={() => setView("executions")}>{t("executions")}</button>
          <button className={view === "administration" ? "active" : ""} onClick={() => setView("administration")}>{t("administration")}</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>{t("settings")}</button>
        </nav>
      </aside>
      <main>
        {selected && <div className={`connection-status ${connection ?? "checking"}`} role="status">
          <span>{selected.name}: {t((connection ? `connection${connection[0].toUpperCase()}${connection.slice(1)}` : "connectionChecking") as "connectionChecking")}</span>
          <button className="quiet" onClick={() => void refreshConnection(selected.id)}>{t("retry")}</button>
        </div>}
        {error && <p className="message error" role="alert">{t("error")}: {error}</p>}
        {notice && <p className="message success">{notice}</p>}
        {view === "contexts" && (
          <section>
            <header className="section-header">
              <div><h1>{t("contextsTitle")}</h1><p>{t("contextsDescription")}</p></div>
              <button onClick={() => { setDraft(emptyContext()); setNotice(undefined); }}>{t("addContext")}</button>
            </header>
             {draft && <ContextForm draft={draft} setDraft={setDraft} onSave={saveContext} onCancel={() => setDraft(null)} onTest={testConnection} testing={testing} t={t} />}
             <section className="context-transfer" aria-label={t("contextTransfer")}>
               <div className="actions"><button className="quiet" onClick={() => void exportContextReferences()}>{t("exportContexts")}</button><button className="quiet" onClick={() => void importContextReferences()} disabled={!importSource.trim()}>{t("importContexts")}</button></div>
               <label>{t("exportedReferences")}<textarea readOnly value={exportedContexts} placeholder={t("exportHint")} /></label>
               <label>{t("importReferences")}<textarea value={importSource} onChange={(event) => setImportSource(event.target.value)} placeholder={t("importHint")} /></label>
             </section>
             {loading && contexts.length === 0 ? <p>{t("loading")}</p> : contexts.length === 0 ? <p>{t("emptyContexts")}</p> : (
              <ul className="context-list">
                {contexts.map((context) => <li key={context.id}>
                  <div><strong>{context.name}</strong><span>{context.kind === "local" ? t("local") : t("remote")} · {context.endpoint}</span></div>
                  <div className="actions">
                    <button className="quiet" onClick={() => openWorkflows(context.id)}>{t("workflows")}</button>
                    <button className="quiet" onClick={() => openExecutions(context.id)}>{t("executions")}</button>
                    <button className="quiet" onClick={() => setDraft({ ...context, token: "" })}>{t("editContext")}</button>
                    <button className="quiet danger" onClick={() => void removeContext(context.id)}>{t("delete")}</button>
                  </div>
                </li>)}
              </ul>
            )}
          </section>
        )}
        {view === "workflows" && (
          <section>
            <header className="section-header"><div><h1>{t("workflowsTitle")}</h1><p>{selected?.name ?? t("selectContext")}</p></div>{selected && <div className="actions"><button className="quiet" onClick={() => void loadWorkflows()}>{t("refresh")}</button><button onClick={startCreatingWorkflow}>{t("newWorkflow")}</button></div>}</header>
            {!selected ? <p>{t("selectContext")}</p> : loading ? <p>{t("loading")}</p> : <div className="workflow-workspace"><WorkflowList workflows={workflows} selectedId={selectedWorkflowId} onSelect={selectWorkflow} t={t} /><WorkflowEditor key={`${selected.id}:${selectedWorkflowId ?? "new"}`} workflow={selectedWorkflow} creating={creatingWorkflow} source={workflowSource} catalog={workflowCatalog} contextId={selected.id} conflict={workflowConflict} onReloadRemote={() => void reloadWorkflowAfterConflict()} onReapplyDraft={reapplyWorkflowDraft} loading={sourceLoading} saving={savingSource} updating={updatingWorkflow} executing={executingWorkflow} executionResult={executionResult} onSourceChange={setWorkflowSource} onSave={() => void saveWorkflowSource()} onEnableChange={(enabled) => void setWorkflowEnabled(enabled)} onExecute={() => void executeWorkflow()} t={t} /></div>}
          </section>
        )}
        {view === "executions" && (
          <section>
            <header className="section-header"><div><h1>{t("executionsTitle")}</h1><p>{selected ? `${t("executionsDescription")} ${selected.name}.` : t("selectContext")}</p></div>{selected && <button className="quiet" onClick={() => void loadExecutions()}>{t("refresh")}</button>}</header>
            {!selected ? <p>{t("selectContext")}</p> : loading ? <p role="status">{t("loading")}</p> : <div className="execution-workspace"><ExecutionList executions={executions} selectedId={selectedExecutionId} locale={locale} onSelect={selectExecution} t={t} /><ExecutionInspector execution={selectedExecution} trace={selectedTrace} artifactPreview={artifactPreview} onReadArtifact={async (artifactId) => { if (!selectedId) return; const contextId = selectedId; const request = executionRequest.current; const preview = await coreClient.readArtifact(contextId, artifactId); if (selectedIdRef.current === contextId && request === executionRequest.current) setArtifactPreview(preview); }} loading={executionLoading} locale={locale} t={t} /></div>}
          </section>
        )}
        {view === "administration" && (
          <Administration key={selectedId ?? "none"} contextId={selectedId} t={t} reportError={setError} reportNotice={setNotice} />
        )}
        {view === "settings" && (
          <section className="settings"><h1>{t("settings")}</h1>
            <label>{t("theme")}<select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}><option value="system">{t("system")}</option><option value="light">{t("light")}</option><option value="dark">{t("dark")}</option></select></label>
            <label>{t("language")}<select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}><option value="en">English</option><option value="es">Español</option></select></label>
          </section>
        )}
      </main>
    </div>
  );
}

function ContextForm({ draft, setDraft, onSave, onCancel, onTest, testing, t }: {
  draft: ContextInput; setDraft: (value: ContextInput) => void; onSave: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void; onTest: () => void; testing: boolean; t: (key: Parameters<typeof translate>[1]) => string;
}) {
  const set = (key: keyof ContextInput, value: string) => setDraft({ ...draft, [key]: value });
  return <form className="context-form" onSubmit={onSave}>
    <h2>{draft.id ? t("editContext") : t("addContext")}</h2>
    <label>{t("contextName")}<input required value={draft.name} onChange={(event) => set("name", event.target.value)} /></label>
    <label>{t("contextKind")}<select value={draft.kind} onChange={(event) => set("kind", event.target.value)}><option value="local">{t("local")}</option><option value="remote">{t("remote")}</option></select></label>
    <label>{t("endpoint")}<input required type="url" value={draft.endpoint} onChange={(event) => set("endpoint", event.target.value)} placeholder="http://127.0.0.1:8080" /></label>
    <label>{t("bearerToken")}<input type="password" value={draft.token ?? ""} onChange={(event) => set("token", event.target.value)} autoComplete="off" /><small>{t("tokenHint")}</small></label>
    <label>{t("customCa")}<textarea value={draft.customCaPem ?? ""} onChange={(event) => set("customCaPem", event.target.value)} spellCheck={false} placeholder={t("customCaHint")} /><small>{t("customCaHint")}</small></label>
    <div className="actions"><button type="submit">{t("save")}</button><button type="button" className="quiet" onClick={onTest} disabled={testing}>{testing ? t("testing") : t("test")}</button><button type="button" className="quiet" onClick={onCancel}>{t("cancel")}</button></div>
  </form>;
}

function WorkflowList({ workflows, selectedId, onSelect, t }: { workflows: Workflow[]; selectedId?: string; onSelect: (id: string) => void; t: (key: Parameters<typeof translate>[1]) => string }) {
  return <div className="workflow-browser">
    {workflows.length === 0 ? <p>{t("emptyWorkflows")}</p> : <ul className="workflow-list">{workflows.map((workflow) => <li key={workflow.id}><button className={`workflow-item ${workflow.id === selectedId ? "active" : ""}`} onClick={() => void onSelect(workflow.id)}><strong>{workflow.name}</strong>{workflow.description && <span>{workflow.description}</span>}<small>{workflow.enabled ?? workflow.status === "enabled" ? t("enabled") : t("disabled")}</small></button></li>)}</ul>}
  </div>;
}

function WorkflowEditor({ workflow, creating, source, catalog, contextId, conflict, onReloadRemote, onReapplyDraft, loading, saving, updating, executing, executionResult, onSourceChange, onSave, onEnableChange, onExecute, t }: {
  workflow?: Workflow; creating: boolean; source: string; catalog: WorkflowCatalog; contextId: string; conflict: boolean; onReloadRemote: () => void; onReapplyDraft: () => void; loading: boolean; saving: boolean; updating: boolean; executing: boolean; executionResult?: string; onSourceChange: (source: string) => void; onSave: () => void; onEnableChange: (enabled: boolean) => void; onExecute: () => void; t: (key: Parameters<typeof translate>[1]) => string;
}) {
  const [editorView, setEditorView] = useState<"yaml" | "graph" | "split">("split");
  const [graph, setGraph] = useState<WorkflowGraph>();
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [newNodeId, setNewNodeId] = useState("");
  const [newNodeType, setNewNodeType] = useState("");
  const [connectionTarget, setConnectionTarget] = useState("");
  const [connectionRoute, setConnectionRoute] = useState("success");
  const [inputName, setInputName] = useState("");
  const [outputName, setOutputName] = useState("");
  const undo = useRef<string[]>([]);
  const redo = useRef<string[]>([]);
  const knownTypes = catalog.nodes.map((node) => node.type);
  const selectedNode = graph?.nodes.find((node) => node.id === selectedNodeId);
  const selectedDefinition = catalog.nodes.find((node) => node.type === selectedNode?.type);
  const producerDefinition = catalog.nodes.find((node) => node.type === graph?.nodes.find((node) => node.id === connectionTarget)?.type);
  const connectionInput = selectedDefinition?.inputs.find((port) => port.name === inputName);
  const connectionOutput = producerDefinition?.outputs.find((port) => port.name === outputName);
  const connectionCompatible = !connectionInput || !connectionOutput || connectionInput.type === "any" || connectionOutput.type === "any" || connectionInput.type === connectionOutput.type || (connectionOutput.type === "integer" && connectionInput.type === "number");
  const draftKey = workflow ? `kakune.workflow-draft.${contextId}.${workflow.id}` : undefined;

  useEffect(() => {
    const result = parseWorkflowGraph(source, knownTypes);
    setDiagnostics(result.diagnostics);
    if (result.graph) setGraph(result.graph);
    if (!result.diagnostics.length && source.trim()) {
      let active = true;
      void coreClient.analyzeWorkflow(contextId, source).then((analysis: WorkflowAnalysis) => {
        if (active) setDiagnostics(analysis.diagnostics.map((diagnostic) => diagnostic.message));
      }).catch(() => { /* Offline drafts retain their locally parsed graph. */ });
      return () => { active = false; };
    }
  }, [source, contextId, catalog]);

  useEffect(() => {
    if (draftKey && source) localStorage.setItem(draftKey, source);
  }, [draftKey, source]);

  const applySource = (next: string) => {
    if (next === source) return;
    undo.current.push(source);
    redo.current = [];
    onSourceChange(next);
  };
  const applyEdit = (result: ReturnType<typeof updateWorkflowNodePosition>) => {
    if ("source" in result) applySource(result.source);
    else setDiagnostics(result.diagnostics);
  };
  const moveNode = (id: string, position: WorkflowNodePosition) => applyEdit(updateWorkflowNodePosition(source, id, position));
  const undoEdit = () => {
    const previous = undo.current.pop();
    if (previous === undefined) return;
    redo.current.push(source);
    onSourceChange(previous);
  };
  const redoEdit = () => {
    const next = redo.current.pop();
    if (next === undefined) return;
    undo.current.push(source);
    onSourceChange(next);
  };
  const onEditorKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.matches("input, textarea, select")) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redoEdit(); else undoEdit();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redoEdit(); return; }
    if (selectedNode && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const position = graph?.positions[selectedNode.id] ?? { x: 80, y: 80 };
      const delta = event.key === "ArrowUp" ? [0, -20] : event.key === "ArrowDown" ? [0, 20] : event.key === "ArrowLeft" ? [-20, 0] : [20, 0];
      moveNode(selectedNode.id, { x: position.x + delta[0], y: position.y + delta[1] });
    }
    if (selectedNode && event.key === "Delete") {
      event.preventDefault();
      applyEdit(deleteWorkflowNode(source, selectedNode.id));
      setSelectedNodeId(undefined);
    }
  };

  if (!workflow && !creating) return <p className="workflow-placeholder">{t("selectWorkflow")}</p>;
  const enabled = workflow?.enabled ?? workflow?.status === "enabled";
  const compatibleProfiles = catalog.providers.filter((profile) => selectedNode?.type === "kakune.ai.codex.exec@1" ? profile.providerType === "codex" : selectedNode?.type === "kakune.ai.minimax.messages@1" ? profile.providerType === "minimax" : true);
  return <div className="workflow-editor" tabIndex={0} onKeyDown={onEditorKeyDown}>
    <header><h2>{creating ? t("newWorkflow") : workflow?.name}</h2>{workflow?.description && <p>{workflow.description}</p>}</header>
    <div className="editor-view-switcher" role="group" aria-label={t("editorView")}>
      <button type="button" className={editorView === "yaml" ? "active" : "quiet"} aria-pressed={editorView === "yaml"} onClick={() => setEditorView("yaml")}>{t("yamlView")}</button>
      <button type="button" className={editorView === "graph" ? "active" : "quiet"} aria-pressed={editorView === "graph"} onClick={() => setEditorView("graph")}>{t("graphView")}</button>
      <button type="button" className={editorView === "split" ? "active" : "quiet"} aria-pressed={editorView === "split"} onClick={() => setEditorView("split")}>{t("splitView")}</button>
    </div>
    <p className="source-authority">{t("sourceAuthority")}</p>
    <div className={`editor-canvas ${editorView}`}>
      {editorView !== "graph" && <label className="source-editor">{t("workflowSource")}<textarea value={source} onChange={(event) => applySource(event.target.value)} disabled={loading || saving} spellCheck={false} /></label>}
      {editorView !== "yaml" && <WorkflowGraphView graph={graph} stale={diagnostics.length > 0} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} onMoveNode={moveNode} t={t} />}
    </div>
    {diagnostics.length > 0 && <section className="source-diagnostics" aria-live="polite"><h3>{t("sourceDiagnostics")}</h3><ul>{diagnostics.map((diagnostic, index) => <li key={`${diagnostic}-${index}`}>{diagnostic}</li>)}</ul></section>}
    {conflict && <section className="source-diagnostics" role="alert"><h3>Remote revision changed</h3><p>Your draft is retained locally. Load the remote revision, then reapply the draft deliberately.</p><div className="actions"><button type="button" className="quiet" onClick={onReloadRemote}>Load remote revision</button><button type="button" onClick={onReapplyDraft}>Reapply draft</button></div></section>}
    <section className="visual-commands" aria-label="Visual editor commands">
      <h3>Visual editor</h3>
      <div className="actions"><button type="button" className="quiet" onClick={undoEdit} disabled={!undo.current.length}>Undo</button><button type="button" className="quiet" onClick={redoEdit} disabled={!redo.current.length}>Redo</button><button type="button" className="quiet" onClick={() => applyEdit(autoLayoutWorkflow(source))}>{t("autoLayout")}</button></div>
      <label>Node id<input value={newNodeId} onChange={(event) => setNewNodeId(event.target.value)} /></label>
      <label>Node type<input list="workflow-node-types" value={newNodeType} onChange={(event) => setNewNodeType(event.target.value)} /><datalist id="workflow-node-types">{catalog.nodes.map((node) => <option key={node.type} value={node.type} />)}</datalist></label>
      <button type="button" onClick={() => { const result = addWorkflowNode(source, { id: newNodeId, type: newNodeType }); applyEdit(result); if ("source" in result) { setSelectedNodeId(newNodeId); setNewNodeId(""); } }}>Add node</button>
      {selectedNode && <section className="node-inspector" aria-label={`Node inspector: ${selectedNode.id}`}>
        <h3>{selectedNode.unknown ? "Unknown plugin node" : selectedNode.id}</h3>
        <label>Type<input value={selectedNode.type} onChange={(event) => applyEdit(setWorkflowNodeProperty(source, selectedNode.id, "type", event.target.value))} /></label>
        {selectedNode.type.startsWith("kakune.ai.") && <>
          <label>Provider<select value={selectedNode.provider ?? ""} onChange={(event) => applyEdit(setWorkflowNodeProperty(source, selectedNode.id, "provider", event.target.value))}><option value={selectedNode.provider ?? ""}>{selectedNode.provider || "Choose provider"}</option>{compatibleProfiles.filter((profile) => profile.id !== selectedNode.provider).map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}</select></label>
          <label>Model<select value={selectedNode.model ?? ""} onChange={(event) => applyEdit(setWorkflowNodeProperty(source, selectedNode.id, "model", event.target.value))}><option value={selectedNode.model ?? ""}>{selectedNode.model || "Choose model"}</option>{catalog.providers.find((profile) => profile.id === selectedNode.provider)?.allowedModels.filter((model) => model !== selectedNode.model).map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
        </>}
        <button type="button" disabled={!newNodeId} onClick={() => applyEdit(copyWorkflowNode(source, selectedNode.id, newNodeId))}>{t("copyNode")}</button>
        <button type="button" className="danger" onClick={() => { applyEdit(deleteWorkflowNode(source, selectedNode.id)); setSelectedNodeId(undefined); }}>Delete node</button>
        {selectedDefinition?.inputs.map((port) => <NodeInputField key={selectedNode.id + ":" + port.name} port={port} binding={selectedNode.bindings[port.name]} onApply={(binding) => applyEdit(setWorkflowNodeValue(source, selectedNode.id, ["inputs", port.name], binding))} t={t} />)}
        <p>Routes: {selectedDefinition?.routes.join(", ") || "dynamic or unknown"}</p>
        <label>Route<select value={connectionRoute} onChange={(event) => setConnectionRoute(event.target.value)}>{(selectedDefinition?.routes.length ? selectedDefinition.routes : Object.keys(selectedNode.routes).length ? Object.keys(selectedNode.routes) : ["success"]).map((route) => <option key={route}>{route}</option>)}</select></label>
        <label>Target<select value={connectionTarget} onChange={(event) => setConnectionTarget(event.target.value)}><option value="">Choose target</option>{graph?.nodes.filter((node) => node.id !== selectedNode.id && node.scope === selectedNode.scope).map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label>
        <button type="button" disabled={!connectionTarget} onClick={() => applyEdit(connectWorkflowRoute(source, selectedNode.id, connectionRoute, connectionTarget))}>Connect route</button><button type="button" className="quiet" onClick={() => applyEdit(disconnectWorkflowRoute(source, selectedNode.id, connectionRoute))}>{t("disconnectRoute")}</button>
        <label>Input port<select value={inputName} onChange={(event) => setInputName(event.target.value)}><option value="">Choose input</option>{selectedDefinition?.inputs.map((port) => <option key={port.name} value={port.name}>{port.name}</option>)}</select></label>
        <label>Output port<input value={outputName} onChange={(event) => setOutputName(event.target.value)} placeholder="output" /></label>
        {!connectionCompatible && <p role="alert">Incompatible port types: {connectionOutput?.type} cannot connect to {connectionInput?.type}.</p>}
        <button type="button" disabled={!connectionTarget || !inputName || !outputName || !connectionCompatible} onClick={() => applyEdit(connectWorkflowInput(source, selectedNode.id, inputName, connectionTarget, outputName))}>Connect data</button>
      </section>}
    </section>
    {loading && <p>{t("loading")}</p>}
    <div className="actions"><button onClick={onSave} disabled={loading || saving || diagnostics.length > 0}>{saving ? t("saving") : creating ? t("create") : t("saveSource")}</button>{workflow && <><button className="quiet" onClick={() => onEnableChange(!enabled)} disabled={updating}>{enabled ? t("disable") : t("enable")}</button><button className="quiet" onClick={onExecute} disabled={executing || diagnostics.length > 0}>{executing ? t("executing") : t("execute")}</button></>}</div>
    {executionResult !== undefined && <section className="execution-result"><h2>{t("executionResult")}</h2><pre>{executionResult}</pre></section>}
  </div>;
}

function NodeInputField({ port, binding, onApply, t }: { port: {name:string;type:string;required:boolean}; binding: unknown; onApply:(binding:unknown)=>void; t:(key:Parameters<typeof translate>[1])=>string }) {
  const value = binding && typeof binding === "object" ? binding as Record<string,unknown> : {};
  const initialMode = ["literal","from","expr","secret"].find((key) => key in value) ?? "literal";
  const [mode,setMode] = useState(initialMode);
  const [text,setText] = useState(typeof value[initialMode] === "string" ? value[initialMode] as string : value[initialMode] === undefined ? "" : JSON.stringify(value[initialMode],null,2));
  const [error,setError] = useState<string>();
  useEffect(() => { setMode(initialMode); setText(typeof value[initialMode] === "string" ? value[initialMode] as string : value[initialMode] === undefined ? "" : JSON.stringify(value[initialMode],null,2)); }, [binding]);
  const apply = () => {
    try {
      let parsed: unknown = text;
      if (mode === "expr" || (mode === "literal" && ["object","array","boolean","number","integer","json"].includes(port.type))) parsed = JSON.parse(text);
      if (mode !== "literal" && !text.trim()) throw new Error(t("bindingRequired"));
      if (mode === "literal" && port.type === "number" && typeof parsed !== "number") throw new Error(t("bindingInvalid"));
      if (mode === "literal" && port.type === "boolean" && typeof parsed !== "boolean") throw new Error(t("bindingInvalid"));
      onApply({[mode]:parsed}); setError(undefined);
    } catch (error) { setError(errorMessage(error)); }
  };
  return <fieldset className="node-input-field"><legend>{port.name}{port.required ? " *" : ""}</legend>
    <label>{t("inputSource")}<select value={mode} onChange={(event)=>setMode(event.target.value)}><option value="literal">{t("literalValue")}</option><option value="from">{t("referenceValue")}</option><option value="expr">{t("expressionValue")}</option><option value="secret">{t("secretReference")}</option></select></label>
    <label>{port.name}<textarea value={text} onChange={(event)=>setText(event.target.value)} /></label>
    <button type="button" onClick={apply}>{t("applyValue")}</button>{error && <p role="alert">{error}</p>}
  </fieldset>;
}

function WorkflowGraphView({ graph, stale, selectedNodeId, onSelectNode, onMoveNode, overlay, readOnly = false, t }: { graph?: WorkflowGraph; stale: boolean; selectedNodeId?: string; onSelectNode: (id: string) => void; onMoveNode: (id: string, position: WorkflowNodePosition) => void; overlay?: Record<string, { status: string; attempts: number }>; readOnly?: boolean; t: (key: Parameters<typeof translate>[1]) => string }) {
  const positionFor = (id: string, index: number) => graph?.positions[id] ?? { x: 80 + (index % 3) * 250, y: 80 + Math.floor(index / 3) * 160 };
  const flowNodes: Node[] = graph ? [
    { id: "__entry__", data: { label: `${t("entry")}: ${graph.entry}` }, position: { x: 10, y: positionFor(graph.entry, 0).y }, draggable: false },
    ...graph.nodes.map((node, index) => {
      const state = overlay?.[node.id];
      return { id: node.id, data: { label: `${node.id}\n${node.type}${state ? `\n${state.status} · ${state.attempts} attempt${state.attempts === 1 ? "" : "s"}` : ""}${node.unknown ? "\nUnknown plugin" : ""}` }, position: positionFor(node.id, index), ariaLabel: `${node.id}, ${node.type}${state ? `, ${state.status}` : ""}`, selected: node.id === selectedNodeId, className: state ? `trace-${state.status}` : undefined };
    }),
  ] : [];
  const flowEdges: Edge[] = graph ? [
    { id: "entry", source: "__entry__", target: graph.entry, label: t("entry"), type: "smoothstep" },
    ...graph.nodes.flatMap((node) => Object.entries(node.routes).flatMap(([route, targets]) => targets.map((target) => ({ id: `${node.id}:${route}:${target}`, source: node.id, target, label: route, type: "smoothstep" })))),
    ...graph.nodes.flatMap((node) => Object.entries(node.inputs).flatMap(([input, from]) => {
      const [producer] = from.split(".");
      return graph.nodes.some((candidate) => candidate.id === producer) ? [{ id: `data:${producer}:${node.id}:${input}`, source: producer, target: node.id, label: input, type: "smoothstep", animated: true }] : [];
    })),
  ] : [];
  const onNodeDragStop: OnNodeDrag = (_, node) => { if (!readOnly) onMoveNode(node.id, node.position); };
  const moveNode = (id: string, x: number, y: number, index: number) => {
    const position = positionFor(id, index);
    onMoveNode(id, { x: position.x + x, y: position.y + y });
  };

  if (!graph) return <p className="graph-unavailable">{t("graphUnavailable")}</p>;
  return <section className="graph-projection" aria-label={t("graphView")}>
    {stale && <p className="graph-stale" role="status">{t("graphStale")}</p>}
    <div className="flow-canvas">
      <ReactFlow nodes={flowNodes} edges={flowEdges} fitView nodesDraggable={!readOnly} nodesFocusable edgesFocusable aria-label={t("graphView")} onNodeDragStop={onNodeDragStop} onNodeClick={(_, node) => onSelectNode(node.id)}>
        <Background gap={16} />
      </ReactFlow>
    </div>
    <section className="graph-outline" aria-label={t("workflowRoutes")}>
      <h3>{t("workflowRoutes")}</h3>
      <p><strong>{t("entry")}:</strong> {graph.entry}</p>
      <ul>{graph.nodes.map((node, index) => {
        const position = positionFor(node.id, index);
        return <li key={node.id}>
          <button type="button" className={node.id === selectedNodeId ? "active" : "quiet"} onClick={() => onSelectNode(node.id)}>{node.id}</button><span>{t("nodeType")}: {node.type}{node.unknown ? " (unknown plugin)" : ""}</span>
          <span>{t("nodePosition")}: {position.x}, {position.y}</span>
          <div className="position-controls" aria-label={`${t("moveNode")}: ${node.id}`}>
            <button type="button" className="quiet" onClick={() => moveNode(node.id, 0, -20, index)}>{t("moveUp")}</button>
            <button type="button" className="quiet" onClick={() => moveNode(node.id, -20, 0, index)}>{t("moveLeft")}</button>
            <button type="button" className="quiet" onClick={() => moveNode(node.id, 20, 0, index)}>{t("moveRight")}</button>
            <button type="button" className="quiet" onClick={() => moveNode(node.id, 0, 20, index)}>{t("moveDown")}</button>
          </div>
          {Object.keys(node.routes).length > 0 && <ul>{Object.entries(node.routes).map(([route, targets]) => <li key={route}>{t("route")}: {route}; {t("target")}: {targets.join(", ")}</li>)}</ul>}
        </li>;
      })}</ul>
    </section>
  </section>;
}

function statusLabel(status: string | null | undefined, t: (key: Parameters<typeof translate>[1]) => string) {
  switch (status?.toLowerCase()) {
    case "pending": case "queued": return t("statusPending");
    case "running": case "in_progress": return t("statusRunning");
    case "succeeded": case "success": case "completed": return t("statusSucceeded");
    case "failed": case "error": return t("statusFailed");
    case "cancelled": case "canceled": return t("statusCancelled");
    default: return status || t("notAvailable");
  }
}

function formatTimestamp(timestamp: string | null | undefined, locale: Locale, t: (key: Parameters<typeof translate>[1]) => string) {
  if (!timestamp) return t("notAvailable");
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-US", { dateStyle: "medium", timeStyle: "medium" }).format(date);
}

function ExecutionList({ executions, selectedId, locale, onSelect, t }: {
  executions: Execution[]; selectedId?: string; locale: Locale; onSelect: (id: string) => void; t: (key: Parameters<typeof translate>[1]) => string;
}) {
  if (executions.length === 0) return <p className="execution-placeholder">{t("emptyExecutions")}</p>;
  return <div className="execution-browser"><ul className="execution-list" aria-label={t("executionsTitle")}>
    {executions.map((execution) => <li key={execution.id}><button className={`execution-item ${execution.id === selectedId ? "active" : ""}`} aria-pressed={execution.id === selectedId} onClick={() => void onSelect(execution.id)}>
      <strong>{execution.id}</strong><span>{execution.workflowId || t("notAvailable")}</span><small>{statusLabel(execution.status, t)} · {formatTimestamp(execution.startedAt || execution.createdAt, locale, t)}</small>{execution.error && <span className="execution-item-error">{execution.error}</span>}
    </button></li>)}
  </ul></div>;
}

function ExecutionInspector({ execution, trace, revisionComparison, artifactPreview, onReadArtifact, loading, locale, t }: {
  execution?: Execution; trace?: ExecutionTrace; revisionComparison?: WorkflowRevisionComparison; artifactPreview?: string; onReadArtifact: (artifactId: string) => Promise<void>; loading: boolean; locale: Locale; t: (key: Parameters<typeof translate>[1]) => string;
}) {
  if (loading) return <p className="execution-placeholder" role="status">{t("loading")}</p>;
  if (!execution) return <p className="execution-placeholder">{t("selectExecution")}</p>;
  return <aside className="execution-inspector" aria-label={t("executionDetails")}>
    <h2>{t("executionDetails")}</h2>
    <dl className="execution-metadata">
      <div><dt>{t("executionId")}</dt><dd>{execution.id}</dd></div>
      <div><dt>{t("workflowId")}</dt><dd>{execution.workflowId || t("notAvailable")}</dd></div>
      <div><dt>{t("status")}</dt><dd>{statusLabel(execution.status, t)}</dd></div>
      <div><dt>{t("createdAt")}</dt><dd>{formatTimestamp(execution.createdAt, locale, t)}</dd></div>
      <div><dt>{t("startedAt")}</dt><dd>{formatTimestamp(execution.startedAt, locale, t)}</dd></div>
      <div><dt>{t("completedAt")}</dt><dd>{formatTimestamp(execution.completedAt, locale, t)}</dd></div>
      <div><dt>{t("updatedAt")}</dt><dd>{formatTimestamp(execution.updatedAt, locale, t)}</dd></div>
    </dl>
    {trace && <ExecutionObservability trace={trace} comparison={revisionComparison} locale={locale} onReadArtifact={onReadArtifact} artifactPreview={artifactPreview} t={t} />}
    {execution.error && <section className="execution-error-detail"><h3>{t("errorDetails")}</h3><pre>{execution.error}</pre></section>}
    <section className="node-runs"><h3>{t("nodeRuns")}</h3>{execution.nodeRuns.length === 0 ? <p>{t("noNodeRuns")}</p> : execution.nodeRuns.map((nodeRun, index) => <NodeRunInspector key={nodeRun.id || nodeRun.nodeId || index} nodeRun={nodeRun} locale={locale} t={t} />)}</section>
  </aside>;
}

function ExecutionObservability({ trace, comparison, locale, onReadArtifact, artifactPreview, t }: { trace: ExecutionTrace; comparison?: WorkflowRevisionComparison; locale: Locale; onReadArtifact: (artifactId: string) => Promise<void>; artifactPreview?: string; t: (key: Parameters<typeof translate>[1]) => string }) {
  const graph = parseWorkflowGraph(trace.workflowSource, []).graph;
  const overlay: Record<string, { status: string; attempts: number }> = {};
  for (const span of trace.spans.filter((span) => span.kind === "node" && span.nodeId)) {
    const id = graph ? executionNodeGraphId(graph, span.nodeId!) : undefined;
    if (!id) continue;
    const previous = overlay[id];
    overlay[id] = { status: span.status, attempts: (previous?.attempts ?? 0) + 1 };
  }
  const parents = new Set(trace.spans.map((span) => span.parentSpanId).filter(Boolean));
  const spanById = new Map(trace.spans.map((span) => [span.id,span]));
  const depth = (id: string) => { const seen = new Set<string>(); let span = spanById.get(id); while (span?.parentSpanId && !seen.has(span.parentSpanId)) { seen.add(span.parentSpanId); span = spanById.get(span.parentSpanId); } return seen.size; };
  const times = trace.spans.flatMap((span) => [Date.parse(span.startedAt), Date.parse(span.completedAt ?? span.startedAt)]).filter(Number.isFinite);
  const start = times.length ? Math.min(...times) : 0, duration = Math.max(1, (times.length ? Math.max(...times) : 0) - start);
  const timing = (span: ExecutionTrace["spans"][number]) => { const from = Date.parse(span.startedAt), end = Date.parse(span.completedAt ?? span.startedAt); return { left: Math.max(0,(from-start)/duration*100), width:Math.max(0.5,(end-from)/duration*100), elapsed:Math.max(0,end-from) }; };
  return <section className="execution-observability" aria-label="Execution observability">
    <h3>Observability</h3>
    <dl className="execution-metadata"><div><dt>Executed revision</dt><dd>{trace.workflowRevision}</dd></div><div><dt>Plan hash</dt><dd>{trace.planHash}</dd></div></dl>
    <section className="trace-usage"><h4>Provider usage and cost</h4>{trace.providerUsage.length === 0 ? <p>No provider usage reported.</p> : <ul>{trace.providerUsage.map((usage) => <li key={`${usage.provider}:${usage.model}`}><strong>{usage.provider} · {usage.model}</strong><span>{usage.usageCertainty === "reported" ? `Tokens: ${usage.totalTokens ?? "partially reported"}` : "Usage not reported"}</span><span>{usage.costCertainty === "providerReported" ? "Cost reported by provider" : "Cost unknown"}</span></li>)}</ul>}</section>
    <section className="trace-timeline"><h4>Timeline</h4><ol>{trace.spans.map((span) => <li key={span.id} className={`trace-item ${span.status} ${parents.has(span.id) ? "parent" : ""}`}><strong style={{ marginInlineStart: `${depth(span.id) * 16}px` }}>{span.kind}: {span.name}</strong><div className="span-duration" aria-label={`${timing(span).elapsed} ms`}><span style={{ marginInlineStart:`${timing(span).left}%`, width:`${timing(span).width}%` }} /></div><span>{timing(span).elapsed} ms · {span.status}{span.attempt ? ` · attempt ${span.attempt}` : ""} · {formatTimestamp(span.startedAt, locale, t)}</span>{span.error && <pre>{span.error}</pre>}</li>)}</ol></section>
    {graph && <section className="trace-overlay"><h4>Workflow overlay</h4><WorkflowGraphView graph={graph} stale={false} selectedNodeId={undefined} onSelectNode={() => {}} onMoveNode={() => {}} overlay={overlay} readOnly t={t} /></section>}
    {comparison && <section className="trace-comparison"><h4>Revision comparison</h4><p>Executed: {comparison.base.id} · Current: {comparison.head.id}</p><pre className="json-result">{comparison.base.source}{"\n\n--- current revision ---\n\n"}{comparison.head.source}</pre></section>}
    <section className="trace-artifacts"><h4>Artifacts</h4>{trace.artifacts.length === 0 ? <p>No artifacts.</p> : <ul>{trace.artifacts.map((artifact) => <li key={`${artifact.nodeId}:${artifact.artifactId}`}><span>{artifact.nodeId}: {artifact.artifactId}</span><button type="button" className="quiet" onClick={() => void onReadArtifact(artifact.artifactId)}>View artifact</button></li>)}</ul>}{artifactPreview !== undefined && <pre className="json-result">{artifactPreview}</pre>}</section>
  </section>;
}

function NodeRunInspector({ nodeRun, locale, t }: { nodeRun: NodeRun; locale: Locale; t: (key: Parameters<typeof translate>[1]) => string }) {
  const label = nodeRun.name || nodeRun.nodeId || nodeRun.id || t("nodeRun");
  return <article className="node-run"><h4>{label}</h4><dl className="execution-metadata">
    <div><dt>{t("nodeId")}</dt><dd>{nodeRun.nodeId || t("notAvailable")}</dd></div>
    <div><dt>{t("status")}</dt><dd>{statusLabel(nodeRun.status, t)}</dd></div>
    <div><dt>{t("startedAt")}</dt><dd>{formatTimestamp(nodeRun.startedAt, locale, t)}</dd></div>
    <div><dt>{t("completedAt")}</dt><dd>{formatTimestamp(nodeRun.completedAt, locale, t)}</dd></div>
  </dl>{nodeRun.error && <section className="execution-error-detail"><h5>{t("errorDetails")}</h5><pre>{nodeRun.error}</pre></section>}<section className="node-messages"><h5>{t("messages")}</h5>{nodeRun.messages.length === 0 ? <p>{t("noMessages")}</p> : <ul>{nodeRun.messages.map((message, index) => <li key={message.id || index}><strong>{message.level || t("messages")}</strong><span>{message.message}</span>{message.timestamp && <small>{t("timestamp")}: {formatTimestamp(message.timestamp, locale, t)}</small>}</li>)}</ul>}</section>
  </article>;
}

type AdministrationSection = "secrets" | "providers" | "plugins" | "mcp";

function Administration({ contextId, t, reportError, reportNotice }: {
  contextId?: string;
  t: (key: Parameters<typeof translate>[1]) => string;
  reportError: (message?: string) => void;
  reportNotice: (message?: string) => void;
}) {
  const [section, setSection] = useState<AdministrationSection>("providers");
  const [loading, setLoading] = useState(false);
  const [secrets, setSecrets] = useState<SecretRecord[]>([]);
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [capabilities, setCapabilities] = useState<ProviderCapabilities>();
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [profile, setProfile] = useState<ProviderProfile>(() => emptyProfile());
  const [pluginSource, setPluginSource] = useState("");
  const [prepared, setPrepared] = useState<PreparedPlugin>();
  const [manifest, setManifest] = useState<unknown>();
  const [mcpEndpoint, setMcpEndpoint] = useState("");
  const [mcpTransport, setMcpTransport] = useState<"http" | "stdio">("http");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpCommandArgs, setMcpCommandArgs] = useState("[]");
  const [mcpCurrentDir, setMcpCurrentDir] = useState("");
  const [mcpTool, setMcpTool] = useState("");
  const [mcpSecretRef, setMcpSecretRef] = useState("");
  const [mcpArguments, setMcpArguments] = useState("{}");
  const [mcpResult, setMcpResult] = useState<unknown>();

  useEffect(() => { void reload(); }, [contextId]);

  async function reload() {
    if (!contextId) return;
    setLoading(true);
    reportError(undefined);
    const [nextSecrets, nextProviders, nextPlugins, nextCapabilities] = await Promise.allSettled([
      coreClient.listSecrets(contextId),
      coreClient.listProviders(contextId),
      coreClient.listPlugins(contextId),
      coreClient.minimaxCapabilities(contextId),
    ]);
    if (nextSecrets.status === "fulfilled") setSecrets(nextSecrets.value);
    if (nextProviders.status === "fulfilled") setProviders(nextProviders.value);
    if (nextPlugins.status === "fulfilled") setPlugins(nextPlugins.value);
    if (nextCapabilities.status === "fulfilled") setCapabilities(nextCapabilities.value);
    const failed = [nextSecrets, nextProviders, nextPlugins, nextCapabilities].find((result) => result.status === "rejected");
    if (failed?.status === "rejected") reportError(errorMessage(failed.reason));
    setLoading(false);
  }

  async function setSecret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contextId) return;
    try {
      await coreClient.setSecret(contextId, secretName, secretValue);
      setSecretName("");
      setSecretValue("");
      await reload();
      reportNotice(t("secretSaved"));
    } catch (cause) { reportError(errorMessage(cause)); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contextId) return;
    try {
      await coreClient.saveProvider(contextId, profile);
      setProfile(emptyProfile());
      await reload();
      reportNotice(t("profileSaved"));
    } catch (cause) { reportError(errorMessage(cause)); }
  }

  async function preparePlugin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contextId) return;
    try {
      setPrepared(await coreClient.preparePlugin(contextId, pluginSource));
      reportNotice(t("pluginPrepared"));
    } catch (cause) { reportError(errorMessage(cause)); }
  }

  async function callMcp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contextId) return;
    try {
      const argumentsValue: unknown = JSON.parse(mcpArguments);
      if (!argumentsValue || Array.isArray(argumentsValue) || typeof argumentsValue !== "object") throw new Error(t("mcpArgumentsObject"));
      const transport = mcpTransport === "http"
        ? { transport: "http", endpoint: mcpEndpoint, bearer_secret_ref: mcpSecretRef || undefined }
        : { transport: "stdio", command: mcpCommand, args: JSON.parse(mcpCommandArgs), current_dir: mcpCurrentDir || undefined, environment_secret_refs: {} };
      setMcpResult(await coreClient.callMcp(contextId, {
        transport,
        toolName: mcpTool,
        arguments: argumentsValue,
      }));
    } catch (cause) { reportError(errorMessage(cause)); }
  }

  const minimaxModels = capabilities?.models ?? [];
  const changeProviderType = (providerType: "codex" | "minimax") => {
    const firstModel = providerType === "minimax" ? minimaxModels[0]?.id ?? "MiniMax-M3" : "";
    setProfile({ ...emptyProfile(providerType), defaultModel: firstModel, allowedModels: firstModel ? [firstModel] : [] });
  };

  if (!contextId) return <section><h1>{t("administration")}</h1><p>{t("selectContext")}</p></section>;
  return <section className="administration">
    <header className="section-header"><div><h1>{t("administration")}</h1><p>{t("administrationDescription")}</p></div><button className="quiet" onClick={() => void reload()} disabled={loading}>{t("refresh")}</button></header>
    <div className="admin-tabs" role="tablist" aria-label={t("administration")}>
      {(["providers", "secrets", "plugins", "mcp"] as const).map((item) => <button key={item} role="tab" aria-selected={section === item} className={section === item ? "active" : "quiet"} onClick={() => setSection(item)}>{t(item)}</button>)}
    </div>
    {section === "secrets" && <div className="admin-panel">
      <p>{t("secretsDescription")}</p>
      <form className="context-form" onSubmit={setSecret}><h2>{t("newSecret")}</h2><label>{t("secretName")}<input required value={secretName} onChange={(event) => setSecretName(event.target.value)} /></label><label>{t("secretValue")}<input required type="password" autoComplete="off" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} /></label><button>{t("save")}</button></form>
      <ResourceList items={secrets} empty={t("emptySecrets")} label={(secret) => secret.name} actions={(secret) => <button className="quiet danger" onClick={() => void coreClient.deleteSecret(contextId, secret.name).then(reload).catch((cause) => reportError(errorMessage(cause)))}>{t("delete")}</button>} />
    </div>}
    {section === "providers" && <div className="admin-panel">
      <form className="context-form" onSubmit={saveProfile}><h2>{t("providerProfile")}</h2><label>{t("providerType")}<select value={profile.providerType} onChange={(event) => changeProviderType(event.target.value as "codex" | "minimax")}><option value="minimax">MiniMax</option><option value="codex">Codex</option></select></label><label>{t("profileId")}<input required value={profile.id} onChange={(event) => setProfile({ ...profile, id: event.target.value })} /></label><label>{t("displayName")}<input required value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></label><label>{t("model")}<input required list={profile.providerType === "minimax" ? "minimax-models" : undefined} value={profile.defaultModel} onChange={(event) => setProfile({ ...profile, defaultModel: event.target.value, allowedModels: [event.target.value] })} /></label><datalist id="minimax-models">{minimaxModels.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</datalist><label>{t("secretReference")}<input required value={profile.auth.secret_ref} onChange={(event) => setProfile({ ...profile, auth: { ...profile.auth, secret_ref: event.target.value } })} /><small>{t("secretReferenceHint")}</small></label><label>{t("capabilities")}<input value={profile.capabilities.join(", ")} onChange={(event) => setProfile({ ...profile, capabilities: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label><div className="actions"><button>{t("save")}</button><button type="button" className="quiet" onClick={() => setProfile(emptyProfile())}>{t("cancel")}</button></div></form>
      <ResourceList items={providers} empty={t("emptyProviders")} label={(item) => `${item.displayName} (${item.providerType}, ${item.defaultModel})`} detail={(item) => `${item.diagnostic?.status ?? "unknown"}: ${item.auth.secret_ref}`} actions={(item) => <div className="actions"><button className="quiet" onClick={() => setProfile(item)}>{t("editContext")}</button><button className="quiet" onClick={() => void coreClient.diagnoseProvider(contextId, item.id).then(reload).catch((cause) => reportError(errorMessage(cause)))}>{t("diagnose")}</button><button className="quiet danger" onClick={() => void coreClient.deleteProvider(contextId, item.id).then(reload).catch((cause) => reportError(errorMessage(cause)))}>{t("delete")}</button></div>} />
    </div>}
    {section === "plugins" && <div className="admin-panel">
      <form className="context-form" onSubmit={preparePlugin}><h2>{t("installPlugin")}</h2><label>{t("pluginSource")}<input required value={pluginSource} onChange={(event) => setPluginSource(event.target.value)} placeholder="npm:example-plugin" /></label><button>{t("prepare")}</button></form>
      {prepared && <section className="prepared-plugin"><h2>{prepared.pluginName}</h2><p>{t("pluginDigest")}: <code>{prepared.digest}</code></p><button onClick={() => void coreClient.commitPlugin(contextId, prepared.id, prepared.digest).then(async () => { setPrepared(undefined); await reload(); reportNotice(t("pluginInstalled")); }).catch((cause) => reportError(errorMessage(cause)))}>{t("confirmInstall")}</button></section>}
      <ResourceList items={plugins} empty={t("emptyPlugins")} label={(item) => `${item.name} ${item.version ?? ""}`} detail={(item) => item.enabled ? t("enabled") : t("disabled")} actions={(item) => <div className="actions"><button className="quiet" onClick={() => void coreClient.getPluginManifest(contextId, item.id).then(setManifest).catch((cause) => reportError(errorMessage(cause)))}>{t("manifest")}</button><button className="quiet" onClick={() => void coreClient.setPluginEnabled(contextId, item.id, !item.enabled).then(reload).catch((cause) => reportError(errorMessage(cause)))}>{item.enabled ? t("disable") : t("enable")}</button><button className="quiet danger" onClick={() => void coreClient.deletePlugin(contextId, item.id).then(reload).catch((cause) => reportError(errorMessage(cause)))}>{t("delete")}</button></div>} />
      {manifest !== undefined && <pre className="json-result">{JSON.stringify(manifest, null, 2)}</pre>}
    </div>}
    {section === "mcp" && <div className="admin-panel">
      <p>{t("mcpDescription")}</p><form className="context-form" onSubmit={callMcp}><label>{t("mcpTransport")}<select value={mcpTransport} onChange={(event) => setMcpTransport(event.target.value as "http" | "stdio")}><option value="http">HTTP</option><option value="stdio">stdio</option></select></label>{mcpTransport === "http" ? <><label>{t("mcpEndpoint")}<input required type="url" value={mcpEndpoint} onChange={(event) => setMcpEndpoint(event.target.value)} /></label><label>{t("secretReference")}<input value={mcpSecretRef} onChange={(event) => setMcpSecretRef(event.target.value)} /></label></> : <><label>{t("mcpCommand")}<input required value={mcpCommand} onChange={(event) => setMcpCommand(event.target.value)} /></label><label>{t("mcpCommandArgs")}<input value={mcpCommandArgs} onChange={(event) => setMcpCommandArgs(event.target.value)} /></label><label>{t("mcpCurrentDir")}<input value={mcpCurrentDir} onChange={(event) => setMcpCurrentDir(event.target.value)} /></label></>}<label>{t("mcpTool")}<input required value={mcpTool} onChange={(event) => setMcpTool(event.target.value)} /></label><label>{t("mcpArguments")}<textarea value={mcpArguments} onChange={(event) => setMcpArguments(event.target.value)} spellCheck={false} /></label><button>{t("callMcp")}</button></form>{mcpResult !== undefined && <pre className="json-result">{JSON.stringify(mcpResult, null, 2)}</pre>}</div>}
  </section>;
}

function emptyProfile(providerType: "codex" | "minimax" = "minimax"): ProviderProfile {
  return { id: "", displayName: "", providerType, defaultModel: "MiniMax-M3", allowedModels: ["MiniMax-M3"], capabilities: ["text-generation"], auth: { type: providerType === "codex" ? "oauthSecret" : "apiKey", secret_ref: "" }, config: {} };
}

function ResourceList<T extends { id?: string; name?: string }>({ items, empty, label, detail, actions }: { items: T[]; empty: string; label: (item: T) => string; detail?: (item: T) => string; actions: (item: T) => ReactNode }) {
  if (items.length === 0) return <p>{empty}</p>;
  return <ul className="resource-list">{items.map((item, index) => <li key={item.id ?? item.name ?? index}><div><strong>{label(item)}</strong>{detail && <span>{detail(item)}</span>}</div>{actions(item)}</li>)}</ul>;
}
