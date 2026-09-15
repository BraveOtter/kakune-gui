use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::Duration,
};

use reqwest::{header, Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, State};
use url::Url;
use uuid::Uuid;

const KEYRING_SERVICE: &str = "io.github.braveotter.kakune";

// Windows Credential Manager can delay visibility of a newly written
// credential. This native-only cache bridges that window without ever exposing
// a token to the renderer or writing it to the context file.
static SESSION_TOKENS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

#[derive(Default)]
struct AppState {
    store: Mutex<ContextStore>,
    config_path: PathBuf,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContextStore {
    contexts: Vec<CoreContext>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoreContext {
    id: String,
    name: String,
    kind: ContextKind,
    endpoint: String,
    has_token: bool,
    #[serde(default)]
    custom_ca_pem: Option<String>,
    #[serde(default)]
    expected_core_id: Option<String>,
    created_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ContextKind {
    Local,
    Remote,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContextInput {
    id: Option<String>,
    name: String,
    kind: ContextKind,
    endpoint: String,
    token: Option<String>,
    custom_ca_pem: Option<String>,
    expected_core_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionResult {
    info: Value,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Workflow {
    id: String,
    name: String,
    description: Option<String>,
    status: Option<String>,
    enabled: Option<bool>,
    #[serde(alias = "updated_at")]
    updated_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowSource {
    id: String,
    source: String,
    revision: String,
    etag: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowSaveResult {
    revision: String,
    etag: String,
}

struct CoreResponse {
    body: String,
    etag: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Execution {
    id: String,
    workflow_id: Option<String>,
    status: Option<String>,
    created_at: Option<String>,
    started_at: Option<String>,
    completed_at: Option<String>,
    updated_at: Option<String>,
    error: Option<String>,
    node_runs: Vec<NodeRun>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeRun {
    id: Option<String>,
    node_id: Option<String>,
    name: Option<String>,
    status: Option<String>,
    started_at: Option<String>,
    completed_at: Option<String>,
    error: Option<String>,
    messages: Vec<ExecutionMessage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionMessage {
    id: Option<String>,
    level: Option<String>,
    message: String,
    timestamp: Option<String>,
}

#[tauri::command]
fn list_contexts(state: State<'_, AppState>) -> Result<Vec<CoreContext>, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Context storage is unavailable".to_string())?;
    Ok(store.contexts.clone())
}

#[tauri::command]
fn save_context(context: ContextInput, state: State<'_, AppState>) -> Result<CoreContext, String> {
    let name = context.name.trim();
    if name.is_empty() {
        return Err("Context name is required".to_string());
    }
    let endpoint = normalize_endpoint(&context.endpoint)?;
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Context storage is unavailable".to_string())?;
    let existing = context
        .id
        .as_ref()
        .and_then(|id| store.contexts.iter().find(|item| item.id == *id));
    let id = existing
        .map(|item| item.id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let created_at = existing
        .map(|item| item.created_at.clone())
        .unwrap_or_else(|| chrono_timestamp());
    let mut has_token = existing.map(|item| item.has_token).unwrap_or(false);

    if let Some(token) = context.token.filter(|token| !token.is_empty()) {
        keyring_entry(&id)?
            .set_password(&token)
            .map_err(keyring_error)?;
        cache_token(&id, token);
        has_token = true;
    }

    let saved = CoreContext {
        id: id.clone(),
        name: name.to_string(),
        kind: context.kind,
        endpoint,
        has_token,
        custom_ca_pem: context.custom_ca_pem.filter(|pem| !pem.trim().is_empty()),
        expected_core_id: context.expected_core_id.filter(|id| !id.trim().is_empty()),
        created_at,
    };
    if let Some(position) = store.contexts.iter().position(|item| item.id == id) {
        store.contexts[position] = saved.clone();
    } else {
        store.contexts.push(saved.clone());
    }
    persist_store(&state.config_path, &store)?;
    Ok(saved)
}

#[tauri::command]
fn delete_context(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Context storage is unavailable".to_string())?;
    if !store.contexts.iter().any(|context| context.id == id) {
        return Ok(());
    }

    // A missing credential is harmless; the context file remains the source of truth.
    if let Ok(entry) = keyring_entry(&id) {
        let _ = entry.delete_credential();
    }
    if let Ok(mut tokens) = session_tokens().lock() {
        tokens.remove(&id);
    }
    store.contexts.retain(|context| context.id != id);
    persist_store(&state.config_path, &store)
}

#[tauri::command]
async fn test_connection(
    context: ContextInput,
    state: State<'_, AppState>,
) -> Result<ConnectionResult, String> {
    let endpoint = normalize_endpoint(&context.endpoint)?;
    let token = token_for_input(&context, &state)?;
    let info = core_get_with_ca(
        &endpoint,
        "/api/v1/info",
        token.as_deref(),
        context.custom_ca_pem.as_deref(),
    )
    .await?;
    Ok(ConnectionResult { info })
}

#[tauri::command]
async fn test_saved_context(
    context_id: String,
    state: State<'_, AppState>,
) -> Result<ConnectionResult, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    let info = context_get(&context, "/api/v1/info", token.as_deref()).await?;
    if let Some(expected) = context.expected_core_id.as_deref() {
        let actual = info.get("coreId").and_then(Value::as_str);
        if actual != Some(expected) {
            return Err("Connected Core identity does not match this context".to_string());
        }
    } else if let Some(actual) = info.get("coreId").and_then(Value::as_str) {
        let mut store = state
            .store
            .lock()
            .map_err(|_| "Context storage is unavailable".to_string())?;
        if let Some(saved) = store.contexts.iter_mut().find(|item| item.id == context_id) {
            saved.expected_core_id = Some(actual.to_string());
            persist_store(&state.config_path, &store)?;
        }
    }
    Ok(ConnectionResult { info })
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContextExport {
    version: u8,
    contexts: Vec<ExportedContext>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedContext {
    name: String,
    kind: ContextKind,
    endpoint: String,
    custom_ca_pem: Option<String>,
    expected_core_id: Option<String>,
}

#[tauri::command]
fn export_contexts(state: State<'_, AppState>) -> Result<String, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Context storage is unavailable".to_string())?;
    let export = ContextExport {
        version: 1,
        contexts: store
            .contexts
            .iter()
            .map(|context| ExportedContext {
                name: context.name.clone(),
                kind: context.kind.clone(),
                endpoint: context.endpoint.clone(),
                custom_ca_pem: context.custom_ca_pem.clone(),
                expected_core_id: context.expected_core_id.clone(),
            })
            .collect(),
    };
    serde_json::to_string_pretty(&export)
        .map_err(|error| format!("Cannot export contexts: {error}"))
}

#[tauri::command]
fn import_contexts(source: String, state: State<'_, AppState>) -> Result<Vec<CoreContext>, String> {
    let export: ContextExport = serde_json::from_str(&source)
        .map_err(|error| format!("Invalid context export: {error}"))?;
    if export.version != 1 {
        return Err("Unsupported context export version".to_string());
    }
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Context storage is unavailable".to_string())?;
    let mut imported = Vec::with_capacity(export.contexts.len());
    for context in export.contexts {
        let name = context.name.trim();
        if name.is_empty() {
            return Err("Imported context name is required".to_string());
        }
        let saved = CoreContext {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            kind: context.kind,
            endpoint: normalize_endpoint(&context.endpoint)?,
            has_token: false,
            custom_ca_pem: context.custom_ca_pem.filter(|pem| !pem.trim().is_empty()),
            expected_core_id: context.expected_core_id.filter(|id| !id.trim().is_empty()),
            created_at: chrono_timestamp(),
        };
        store.contexts.push(saved.clone());
        imported.push(saved);
    }
    persist_store(&state.config_path, &store)?;
    Ok(imported)
}

#[tauri::command]
async fn list_workflows(
    context_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Workflow>, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    let response = context_get(&context, "/api/v1/workflows", token.as_deref()).await?;
    parse_workflows(response)
}

#[tauri::command]
async fn get_workflow_source(
    context_id: String,
    workflow_id: String,
    state: State<'_, AppState>,
) -> Result<WorkflowSource, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    let response = context_request_response(
        &context,
        Method::GET,
        &workflow_path(&workflow_id, "source"),
        token.as_deref(),
        None,
        None,
    )
    .await?;
    parse_workflow_source(&response.body, response.etag)
}

#[tauri::command]
async fn save_workflow_source(
    context_id: String,
    workflow_id: String,
    source: String,
    etag: String,
    state: State<'_, AppState>,
) -> Result<WorkflowSaveResult, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    let response = context_request_response(
        &context,
        Method::PUT,
        &workflow_path(&workflow_id, "source"),
        token.as_deref(),
        Some(serde_json::json!({ "source": source })),
        Some(&etag),
    )
    .await?;
    let value = response_json(&response.body)?;
    let revision = field_text(&value, &["revision"])
        .ok_or_else(|| "Core returned no workflow revision".to_string())?;
    Ok(WorkflowSaveResult {
        etag: response.etag.unwrap_or_else(|| format!("\"{revision}\"")),
        revision,
    })
}

#[tauri::command]
async fn analyze_workflow(
    context_id: String,
    source: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    response_json(
        &context_request(
            &context,
            Method::POST,
            "/api/v1/workflows/analyze",
            token.as_deref(),
            Some(serde_json::json!({ "source": source })),
        )
        .await?,
    )
}

#[tauri::command]
async fn get_workflow_catalog(
    context_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    context_get(&context, "/api/v1/workflows/catalog", token.as_deref()).await
}

#[tauri::command]
async fn create_workflow(
    context_id: String,
    source: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    context_request(
        &context,
        Method::POST,
        "/api/v1/workflows",
        token.as_deref(),
        Some(serde_json::json!({ "source": source })),
    )
    .await?;
    Ok(())
}

#[tauri::command]
async fn set_workflow_enabled(
    context_id: String,
    workflow_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    let action = if enabled { "enable" } else { "disable" };
    context_request(
        &context,
        Method::POST,
        &workflow_path(&workflow_id, action),
        token.as_deref(),
        None,
    )
    .await?;
    Ok(())
}

#[tauri::command]
async fn execute_workflow(
    context_id: String,
    workflow_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    let response = context_request(
        &context,
        Method::POST,
        "/api/v1/executions",
        token.as_deref(),
        Some(serde_json::json!({ "workflowId": workflow_id })),
    )
    .await?;
    response_json(&response)
}

#[tauri::command]
async fn list_executions(
    context_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Execution>, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    let response = context_get(&context, "/api/v1/executions", token.as_deref()).await?;
    parse_executions(response)
}

#[tauri::command]
async fn get_execution(
    context_id: String,
    execution_id: String,
    state: State<'_, AppState>,
) -> Result<Execution, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    let response = context_get(&context, &execution_path(&execution_id), token.as_deref()).await?;
    parse_execution_response(response)
}

#[tauri::command]
async fn get_execution_trace(
    context_id: String,
    execution_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    context_get(&context, &format!("{}/trace", execution_path(&execution_id)), token.as_deref()).await
}

#[tauri::command]
async fn list_workflow_revisions(
    context_id: String,
    workflow_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    context_get(&context, &workflow_path(&workflow_id, "revisions"), token.as_deref()).await
}

#[tauri::command]
async fn compare_workflow_revisions(
    context_id: String,
    workflow_id: String,
    base_revision: String,
    head_revision: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    let path = format!("{}?base={}&head={}", workflow_path(&workflow_id, "revisions/compare"), encode_id(&base_revision), encode_id(&head_revision));
    context_get(&context, &path, token.as_deref()).await
}

#[tauri::command]
async fn read_artifact(
    context_id: String,
    artifact_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    context_request(&context, Method::GET, &resource_path("/api/v1/artifacts", &artifact_id), token.as_deref(), None).await
}

#[tauri::command]
async fn cancel_execution(
    context_id: String,
    execution_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    context_request(
        &context,
        Method::POST,
        &format!("{}/cancel", execution_path(&execution_id)),
        token.as_deref(),
        None,
    )
    .await?;
    Ok(())
}

#[tauri::command]
async fn list_secrets(context_id: String, state: State<'_, AppState>) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    list_response(context_get(&context, "/api/v1/secrets", token.as_deref()).await?)
}

#[tauri::command]
async fn set_secret(
    context_id: String,
    name: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    response_json(
        &context_request(
            &context,
            Method::POST,
            "/api/v1/secrets",
            token.as_deref(),
            Some(serde_json::json!({ "name": name, "value": value })),
        )
        .await?,
    )
}

#[tauri::command]
async fn delete_secret(
    context_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    context_request(
        &context,
        Method::DELETE,
        &resource_path("/api/v1/secrets", &name),
        token.as_deref(),
        None,
    )
    .await?;
    Ok(())
}

#[tauri::command]
async fn list_providers(context_id: String, state: State<'_, AppState>) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    list_response(context_get(&context, "/api/v1/providers", token.as_deref()).await?)
}

#[tauri::command]
async fn save_provider(
    context_id: String,
    profile: Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    response_json(
        &context_request(
            &context,
            Method::POST,
            "/api/v1/providers",
            token.as_deref(),
            Some(profile),
        )
        .await?,
    )
}

#[tauri::command]
async fn delete_provider(
    context_id: String,
    provider_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    context_request(
        &context,
        Method::DELETE,
        &resource_path("/api/v1/providers", &provider_id),
        token.as_deref(),
        None,
    )
    .await?;
    Ok(())
}

#[tauri::command]
async fn diagnose_provider(
    context_id: String,
    provider_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    response_json(
        &context_request(
            &context,
            Method::POST,
            &format!(
                "{}/diagnose",
                resource_path("/api/v1/providers", &provider_id)
            ),
            token.as_deref(),
            None,
        )
        .await?,
    )
}

#[tauri::command]
async fn minimax_capabilities(
    context_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    context_get(
        &context,
        "/api/v1/providers/minimax/capabilities",
        token.as_deref(),
    )
    .await
}

#[tauri::command]
async fn list_plugins(context_id: String, state: State<'_, AppState>) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    list_response(context_get(&context, "/api/v1/plugins", token.as_deref()).await?)
}

#[tauri::command]
async fn get_plugin_manifest(
    context_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    context_get(
        &context,
        &format!("{}/manifest", resource_path("/api/v1/plugins", &name)),
        token.as_deref(),
    )
    .await
}

#[tauri::command]
async fn prepare_plugin(
    context_id: String,
    source: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    response_json(
        &context_request(
            &context,
            Method::POST,
            "/api/v1/plugins/prepare",
            token.as_deref(),
            Some(serde_json::json!({ "source": source })),
        )
        .await?,
    )
}

#[tauri::command]
async fn commit_plugin(
    context_id: String,
    installation_id: String,
    digest: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    response_json(
        &context_request(
            &context,
            Method::POST,
            &format!(
                "/api/v1/plugin-installations/{}/commit",
                encode_id(&installation_id)
            ),
            token.as_deref(),
            Some(serde_json::json!({ "digest": digest })),
        )
        .await?,
    )
}

#[tauri::command]
async fn set_plugin_enabled(
    context_id: String,
    plugin_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    let action = if enabled { "enable" } else { "disable" };
    response_json(
        &context_request(
            &context,
            Method::POST,
            &format!(
                "{}/{}",
                resource_path("/api/v1/plugins", &plugin_id),
                action
            ),
            token.as_deref(),
            None,
        )
        .await?,
    )
}

#[tauri::command]
async fn delete_plugin(
    context_id: String,
    plugin_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    context_request(
        &context,
        Method::DELETE,
        &resource_path("/api/v1/plugins", &plugin_id),
        token.as_deref(),
        None,
    )
    .await?;
    Ok(())
}

#[tauri::command]
async fn call_mcp(
    context_id: String,
    request: Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let context = context_for_id(&context_id, &state)?;
    let token = get_token(&context.id)?;
    response_json(
        &context_request(
            &context,
            Method::POST,
            "/api/v1/mcp/call",
            token.as_deref(),
            Some(request),
        )
        .await?,
    )
}

fn context_for_id(context_id: &str, state: &AppState) -> Result<CoreContext, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Context storage is unavailable".to_string())?;
    store
        .contexts
        .iter()
        .find(|item| item.id == context_id)
        .cloned()
        .ok_or_else(|| "The selected context no longer exists".to_string())
}

fn token_for_input(context: &ContextInput, state: &AppState) -> Result<Option<String>, String> {
    if let Some(token) = context.token.as_ref().filter(|token| !token.is_empty()) {
        return Ok(Some(token.clone()));
    }
    if let Some(id) = &context.id {
        let store = state
            .store
            .lock()
            .map_err(|_| "Context storage is unavailable".to_string())?;
        if store.contexts.iter().any(|item| item.id == *id) {
            return get_token(id);
        }
    }
    Ok(None)
}

async fn core_get_with_ca(
    endpoint: &str,
    path: &str,
    token: Option<&str>,
    custom_ca_pem: Option<&str>,
) -> Result<Value, String> {
    response_json(
        &core_request_with_options(
            endpoint,
            Method::GET,
            path,
            token,
            None,
            custom_ca_pem,
            true,
            None,
        )
        .await?
        .body,
    )
}

async fn context_get(
    context: &CoreContext,
    path: &str,
    token: Option<&str>,
) -> Result<Value, String> {
    core_get_with_ca(
        &context.endpoint,
        path,
        token,
        context.custom_ca_pem.as_deref(),
    )
    .await
}

async fn context_request(
    context: &CoreContext,
    method: Method,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> Result<String, String> {
    Ok(
        context_request_response(context, method, path, token, body, None)
            .await?
            .body,
    )
}

async fn context_request_response(
    context: &CoreContext,
    method: Method,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
    if_match: Option<&str>,
) -> Result<CoreResponse, String> {
    // Mutations are never retried: the caller can decide whether to repeat them.
    core_request_with_options(
        &context.endpoint,
        method,
        path,
        token,
        body,
        context.custom_ca_pem.as_deref(),
        false,
        if_match,
    )
    .await
}

async fn core_request_with_options(
    endpoint: &str,
    method: Method,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
    custom_ca_pem: Option<&str>,
    retry_read: bool,
    if_match: Option<&str>,
) -> Result<CoreResponse, String> {
    let url = api_url(endpoint, path)?;
    let mut builder = Client::builder().timeout(Duration::from_secs(10));
    if let Some(pem) = custom_ca_pem.filter(|pem| !pem.trim().is_empty()) {
        let certificate = reqwest::Certificate::from_pem(pem.as_bytes())
            .map_err(|_| "Custom CA certificate is not valid PEM".to_string())?;
        builder = builder.add_root_certificate(certificate);
    }
    let client = builder
        .build()
        .map_err(|error| format!("Cannot create HTTP client: {error}"))?;
    let attempts = if retry_read { 2 } else { 1 };
    let mut last_error = None;
    for attempt in 0..attempts {
        let mut request = client
            .request(method.clone(), url.clone())
            .header(header::ACCEPT, "application/json");
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        if let Some(etag) = if_match {
            request = request.header(header::IF_MATCH, etag);
        }
        if let Some(body) = body.as_ref() {
            request = request.json(body);
        }
        match request.send().await {
            Ok(response) => {
                let status = response.status();
                let etag = response
                    .headers()
                    .get(header::ETAG)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_owned);
                let response_body = response
                    .text()
                    .await
                    .map_err(|error| format!("Cannot read Core response: {error}"))?;
                if !status.is_success() {
                    // Core errors can contain user input. Do not surface or persist their body.
                    return Err(format!("Core returned an error: {status}"));
                }
                return Ok(CoreResponse {
                    body: response_body,
                    etag,
                });
            }
            Err(error) => {
                last_error = Some(error);
                if attempt + 1 < attempts {
                    tokio::time::sleep(Duration::from_millis(300)).await;
                }
            }
        }
    }
    Err(format!(
        "Core request failed: {}",
        last_error.expect("a request attempt failed")
    ))
}

fn list_response(value: Value) -> Result<Value, String> {
    value
        .get("items")
        .cloned()
        .ok_or_else(|| "Core returned an unexpected list response".to_string())
}

fn response_json(response: &str) -> Result<Value, String> {
    if response.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(response).map_err(|error| format!("Core returned invalid JSON: {error}"))
}

fn parse_workflows(response: Value) -> Result<Vec<Workflow>, String> {
    let workflows = if response.is_array() {
        response
    } else {
        response
            .get("items")
            .or_else(|| response.get("workflows"))
            .cloned()
            .ok_or_else(|| "Core returned an unexpected workflows response".to_string())?
    };
    serde_json::from_value(workflows)
        .map_err(|error| format!("Core returned invalid workflows: {error}"))
}

fn parse_executions(response: Value) -> Result<Vec<Execution>, String> {
    let executions = if response.is_array() {
        response
    } else {
        response
            .get("items")
            .or_else(|| response.get("executions"))
            .cloned()
            .ok_or_else(|| "Core returned an unexpected executions response".to_string())?
    };
    let items = executions
        .as_array()
        .ok_or_else(|| "Core returned an invalid executions response".to_string())?;
    items.iter().map(parse_execution).collect()
}

fn parse_execution_response(response: Value) -> Result<Execution, String> {
    parse_execution(response.get("execution").unwrap_or(&response))
}

fn parse_execution(value: &Value) -> Result<Execution, String> {
    let id = field_text(value, &["id", "executionId", "execution_id"])
        .ok_or_else(|| "Core returned an execution without an id".to_string())?;
    let node_runs = field(value, &["nodeRuns", "node_runs", "nodes"])
        .and_then(Value::as_array)
        .map(|items| items.iter().map(parse_node_run).collect())
        .unwrap_or_default();
    Ok(Execution {
        id,
        workflow_id: field_text(value, &["workflowId", "workflow_id", "workflowName", "workflow_name"]),
        status: field_text(value, &["status"]),
        created_at: field_text(value, &["createdAt", "created_at"]),
        started_at: field_text(value, &["startedAt", "started_at"]),
        completed_at: field_text(
            value,
            &[
                "completedAt",
                "completed_at",
                "finishedAt",
                "finished_at",
                "endedAt",
                "ended_at",
            ],
        ),
        updated_at: field_text(value, &["updatedAt", "updated_at"]),
        error: field_text(
            value,
            &["error", "failure", "errorMessage", "error_message"],
        ),
        node_runs,
    })
}

fn parse_node_run(value: &Value) -> NodeRun {
    let messages = field(value, &["messages", "logs", "events"])
        .and_then(Value::as_array)
        .map(|items| items.iter().map(parse_execution_message).collect())
        .unwrap_or_default();
    NodeRun {
        id: field_text(value, &["id", "runId", "run_id"]),
        node_id: field_text(value, &["nodeId", "node_id"]),
        name: field_text(value, &["name", "nodeName", "node_name"]),
        status: field_text(value, &["status"]),
        started_at: field_text(value, &["startedAt", "started_at"]),
        completed_at: field_text(
            value,
            &[
                "completedAt",
                "completed_at",
                "finishedAt",
                "finished_at",
                "endedAt",
                "ended_at",
            ],
        ),
        error: field_text(
            value,
            &["error", "failure", "errorMessage", "error_message"],
        ),
        messages,
    }
}

fn parse_execution_message(value: &Value) -> ExecutionMessage {
    let message = if value.is_object() {
        field_text(value, &["message", "text", "content"]).unwrap_or_else(|| value_text(value))
    } else {
        value_text(value)
    };
    ExecutionMessage {
        id: field_text(value, &["id"]),
        level: field_text(value, &["level", "severity"]),
        message,
        timestamp: field_text(value, &["timestamp", "createdAt", "created_at", "time"]),
    }
}

fn field<'a>(value: &'a Value, names: &[&str]) -> Option<&'a Value> {
    names.iter().find_map(|name| value.get(*name))
}

fn field_text(value: &Value, names: &[&str]) -> Option<String> {
    field(value, names).and_then(|item| {
        if item.is_null() {
            None
        } else {
            Some(value_text(item))
        }
    })
}

fn value_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(boolean) => boolean.to_string(),
        Value::Null => String::new(),
        Value::Object(object) => object
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| value.to_string()),
        Value::Array(_) => value.to_string(),
    }
}

fn parse_workflow_source(response: &str, etag: Option<String>) -> Result<WorkflowSource, String> {
    let value = serde_json::from_str::<Value>(response)
        .map_err(|_| "Core returned an unexpected workflow source response".to_string())?;
    let source = value
        .get("source")
        .and_then(Value::as_str)
        .ok_or_else(|| "Core returned an unexpected workflow source response".to_string())?;
    let revision = value
        .get("revision")
        .and_then(Value::as_str)
        .ok_or_else(|| "Core returned no workflow revision".to_string())?;
    let id = value.get("id").and_then(Value::as_str).unwrap_or_default();
    Ok(WorkflowSource {
        id: id.to_owned(),
        source: source.to_owned(),
        revision: revision.to_owned(),
        etag: etag.unwrap_or_else(|| format!("\"{revision}\"")),
    })
}

fn workflow_path(workflow_id: &str, action: &str) -> String {
    let encoded_id = encode_id(workflow_id);
    format!("/api/v1/workflows/{encoded_id}/{action}")
}

fn execution_path(execution_id: &str) -> String {
    let encoded_id = encode_id(execution_id);
    format!("/api/v1/executions/{encoded_id}")
}

fn encode_id(id: &str) -> String {
    url::form_urlencoded::byte_serialize(id.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

fn resource_path(prefix: &str, id: &str) -> String {
    format!("{prefix}/{}", encode_id(id))
}

fn normalize_endpoint(input: &str) -> Result<String, String> {
    let mut url = Url::parse(input.trim())
        .map_err(|_| "Endpoint must be a valid absolute HTTP URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Endpoint must be an absolute HTTP or HTTPS URL".to_string());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("Endpoint cannot contain a query string or fragment".to_string());
    }
    let normalized_path = url.path().trim_end_matches('/').to_string();
    url.set_path(&normalized_path);
    Ok(url.to_string().trim_end_matches('/').to_string())
}

fn api_url(endpoint: &str, path: &str) -> Result<Url, String> {
    Url::parse(&format!("{}{}", endpoint.trim_end_matches('/'), path))
        .map_err(|_| "Could not construct Core API URL".to_string())
}

fn keyring_entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, id).map_err(keyring_error)
}

fn get_token(id: &str) -> Result<Option<String>, String> {
    let entry = keyring_entry(id)?;
    match entry.get_password() {
        Ok(token) => {
            cache_token(id, token.clone());
            Ok(Some(token))
        }
        Err(keyring::Error::NoEntry) => session_tokens()
            .lock()
            .map_err(|_| "Session credentials are unavailable".to_string())
            .map(|tokens| tokens.get(id).cloned()),
        Err(error) => Err(keyring_error(error)),
    }
}

fn session_tokens() -> &'static Mutex<HashMap<String, String>> {
    SESSION_TOKENS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_token(id: &str, token: String) {
    if let Ok(mut tokens) = session_tokens().lock() {
        tokens.insert(id.to_owned(), token);
    }
}

fn keyring_error(error: keyring::Error) -> String {
    format!("Operating system keyring error: {error}")
}

fn load_store(path: &PathBuf) -> Result<ContextStore, String> {
    if !path.exists() {
        return Ok(ContextStore::default());
    }
    let source = fs::read_to_string(path)
        .map_err(|error| format!("Cannot read context storage: {error}"))?;
    serde_json::from_str(&source).map_err(|error| format!("Cannot read context storage: {error}"))
}

fn persist_store(path: &PathBuf, store: &ContextStore) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create context storage: {error}"))?;
    }
    let temporary = path.with_extension("tmp");
    let contents = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("Cannot serialize context storage: {error}"))?;
    fs::write(&temporary, contents)
        .map_err(|error| format!("Cannot write context storage: {error}"))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("Cannot finalize context storage: {error}"))
}

fn chrono_timestamp() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(feature = "wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .setup(|app| {
            let config_path = app
                .path()
                .app_config_dir()
                .map_err(|error| format!("Cannot locate app config directory: {error}"))?
                .join("contexts.json");
            let store = load_store(&config_path)?;
            app.manage(AppState {
                store: Mutex::new(store),
                config_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_contexts,
            save_context,
            delete_context,
            test_connection,
            test_saved_context,
            export_contexts,
            import_contexts,
            list_workflows,
            get_workflow_source,
            save_workflow_source,
            analyze_workflow,
            get_workflow_catalog,
            create_workflow,
            set_workflow_enabled,
            execute_workflow,
            list_executions,
            get_execution,
            get_execution_trace,
            list_workflow_revisions,
            compare_workflow_revisions,
            read_artifact,
            cancel_execution,
            list_secrets,
            set_secret,
            delete_secret,
            list_providers,
            save_provider,
            delete_provider,
            diagnose_provider,
            minimax_capabilities,
            list_plugins,
            get_plugin_manifest,
            prepare_plugin,
            commit_plugin,
            set_plugin_enabled,
            delete_plugin,
            call_mcp
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kakune GUI");
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    use super::{
        api_url, core_get_with_ca, execution_path, normalize_endpoint, parse_execution_response,
        parse_executions, parse_workflow_source, workflow_path, ContextExport, ContextKind,
        ExportedContext,
    };
    use serde_json::json;

    #[test]
    fn normalizes_a_core_endpoint() {
        assert_eq!(
            normalize_endpoint("http://localhost:8080/").unwrap(),
            "http://localhost:8080"
        );
    }

    #[test]
    fn appends_the_info_path() {
        assert_eq!(
            api_url("https://core.example", "/api/v1/info")
                .unwrap()
                .as_str(),
            "https://core.example/api/v1/info"
        );
    }

    #[test]
    fn accepts_json_wrapped_workflow_source() {
        let source = parse_workflow_source(
            r#"{"id":"daily","source":"name: daily","revision":"r1"}"#,
            Some("\"r1\"".to_string()),
        )
        .unwrap();
        assert_eq!(source.source, "name: daily");
        assert_eq!(source.etag, "\"r1\"");
    }

    #[test]
    fn encodes_workflow_ids_in_api_paths() {
        assert_eq!(
            workflow_path("daily run", "enable"),
            "/api/v1/workflows/daily%20run/enable"
        );
    }

    #[test]
    fn exported_contexts_contain_references_but_no_tokens() {
        let export = ContextExport {
            version: 1,
            contexts: vec![ExportedContext {
                name: "Remote".to_string(),
                kind: ContextKind::Remote,
                endpoint: "https://core.example".to_string(),
                custom_ca_pem: Some("public certificate".to_string()),
                expected_core_id: Some("core-1".to_string()),
            }],
        };
        let value = serde_json::to_value(export).unwrap();
        assert_eq!(value["contexts"][0]["expectedCoreId"], "core-1");
        assert!(value["contexts"][0].get("token").is_none());
        assert!(value["contexts"][0].get("hasToken").is_none());
    }

    #[test]
    fn parses_execution_status_errors_and_node_messages() {
        let executions = parse_executions(json!({ "items": [{
            "id": "run-1", "workflowId": "daily", "status": "failed", "startedAt": "2026-09-09T10:00:00Z",
            "error": { "message": "step failed" }, "nodeRuns": [{
                "nodeId": "fetch", "status": "failed", "messages": [{ "level": "error", "message": "Timeout" }]
            }]
        }]})).unwrap();
        assert_eq!(executions[0].error.as_deref(), Some("step failed"));
        assert_eq!(executions[0].node_runs[0].messages[0].message, "Timeout");
    }

    #[test]
    fn parses_wrapped_execution_details_and_encodes_paths() {
        let execution = parse_execution_response(
            json!({ "execution": { "id": "run 1", "completed_at": "2026-09-09T10:01:00Z" }}),
        )
        .unwrap();
        assert_eq!(
            execution.completed_at.as_deref(),
            Some("2026-09-09T10:01:00Z")
        );
        assert_eq!(execution_path("run 1"), "/api/v1/executions/run%201");
    }

    #[test]
    fn windows_native_facade_smoke_connects_to_an_ephemeral_core() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("mock Core should bind");
        let address = listener
            .local_addr()
            .expect("mock Core should have an address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("GUI should connect to mock Core");
            let mut request = [0_u8; 1024];
            let read = stream
                .read(&mut request)
                .expect("request should be readable");
            assert!(std::str::from_utf8(&request[..read])
                .expect("request should be UTF-8")
                .starts_with("GET /api/v1/info HTTP/1.1"));
            stream.write_all(b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 41\r\nconnection: close\r\n\r\n{\"apiVersion\":\"1.0\",\"coreId\":\"gui-smoke\"}").expect("response should be writable");
        });

        let result = tauri::async_runtime::block_on(core_get_with_ca(
            &format!("http://{address}"),
            "/api/v1/info",
            None,
            None,
        ))
        .expect("GUI facade should read Core info");
        assert_eq!(result["coreId"], "gui-smoke");
        server.join().expect("mock Core should exit cleanly");
    }
}
