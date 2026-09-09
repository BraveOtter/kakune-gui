import { FormEvent, useEffect, useState } from "react";
import { coreClient } from "./api";
import { initialLocale, type Locale, translate } from "./i18n";
import { initialTheme, resolveTheme, type Theme } from "./theme";
import type { ContextInput, CoreContext, Workflow } from "./types";

type View = "contexts" | "workflows" | "settings";

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
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const selected = contexts.find((context) => context.id === selectedId);

  useEffect(() => {
    void loadContexts();
  }, []);

  useEffect(() => {
    if (view === "workflows" && selectedId) {
      void loadWorkflows();
    }
  }, [view, selectedId]);

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
      setNotice(`${t("connected")}${version}`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setTesting(false);
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
    setLoading(true);
    setError(undefined);
    try {
      setWorkflows(await coreClient.listWorkflows(selectedId));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  function openWorkflows(id: string) {
    setSelectedId(id);
    setView("workflows");
    setWorkflows([]);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">{t("appName")}</div>
        <nav aria-label="Main navigation">
          <button className={view === "contexts" ? "active" : ""} onClick={() => setView("contexts")}>{t("contexts")}</button>
          <button className={view === "workflows" ? "active" : ""} onClick={() => setView("workflows")}>{t("workflows")}</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>{t("settings")}</button>
        </nav>
      </aside>
      <main>
        {error && <p className="message error" role="alert">{t("error")}: {error}</p>}
        {notice && <p className="message success">{notice}</p>}
        {view === "contexts" && (
          <section>
            <header className="section-header">
              <div><h1>{t("contextsTitle")}</h1><p>{t("contextsDescription")}</p></div>
              <button onClick={() => { setDraft(emptyContext()); setNotice(undefined); }}>{t("addContext")}</button>
            </header>
            {draft && <ContextForm draft={draft} setDraft={setDraft} onSave={saveContext} onCancel={() => setDraft(null)} onTest={testConnection} testing={testing} t={t} />}
            {loading ? <p>{t("loading")}</p> : contexts.length === 0 ? <p>{t("emptyContexts")}</p> : (
              <ul className="context-list">
                {contexts.map((context) => <li key={context.id}>
                  <div><strong>{context.name}</strong><span>{context.kind === "local" ? t("local") : t("remote")} · {context.endpoint}</span></div>
                  <div className="actions">
                    <button className="quiet" onClick={() => openWorkflows(context.id)}>{t("workflows")}</button>
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
            <header className="section-header"><div><h1>{t("workflowsTitle")}</h1><p>{selected?.name ?? t("selectContext")}</p></div>{selected && <button onClick={() => void loadWorkflows()}>{t("refresh")}</button>}</header>
            {!selected ? <p>{t("selectContext")}</p> : loading ? <p>{t("loading")}</p> : workflows.length === 0 ? <p>{t("emptyWorkflows")}</p> : <WorkflowList workflows={workflows} />}
          </section>
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
    <div className="actions"><button type="submit">{t("save")}</button><button type="button" className="quiet" onClick={onTest} disabled={testing}>{testing ? t("testing") : t("test")}</button><button type="button" className="quiet" onClick={onCancel}>{t("cancel")}</button></div>
  </form>;
}

function WorkflowList({ workflows }: { workflows: Workflow[] }) {
  return <ul className="workflow-list">{workflows.map((workflow) => <li key={workflow.id}><strong>{workflow.name}</strong>{workflow.description && <span>{workflow.description}</span>}{workflow.status && <small>{workflow.status}</small>}</li>)}</ul>;
}
