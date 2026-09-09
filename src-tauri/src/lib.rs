use std::{fs, path::PathBuf, sync::Mutex, time::Duration};

use reqwest::{header, Client};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, State};
use url::Url;
use uuid::Uuid;

const KEYRING_SERVICE: &str = "dev.kakune.gui";

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
    #[serde(alias = "updated_at")]
    updated_at: Option<String>,
}

#[tauri::command]
fn list_contexts(state: State<'_, AppState>) -> Result<Vec<CoreContext>, String> {
    let store = state.store.lock().map_err(|_| "Context storage is unavailable".to_string())?;
    Ok(store.contexts.clone())
}

#[tauri::command]
fn save_context(context: ContextInput, state: State<'_, AppState>) -> Result<CoreContext, String> {
    let name = context.name.trim();
    if name.is_empty() {
        return Err("Context name is required".to_string());
    }
    let endpoint = normalize_endpoint(&context.endpoint)?;
    let mut store = state.store.lock().map_err(|_| "Context storage is unavailable".to_string())?;
    let existing = context.id.as_ref().and_then(|id| store.contexts.iter().find(|item| item.id == *id));
    let id = existing.map(|item| item.id.clone()).unwrap_or_else(|| Uuid::new_v4().to_string());
    let created_at = existing.map(|item| item.created_at.clone()).unwrap_or_else(|| chrono_timestamp());
    let mut has_token = existing.map(|item| item.has_token).unwrap_or(false);

    if let Some(token) = context.token.filter(|token| !token.is_empty()) {
        keyring_entry(&id)?.set_password(&token).map_err(keyring_error)?;
        has_token = true;
    }

    let saved = CoreContext {
        id: id.clone(),
        name: name.to_string(),
        kind: context.kind,
        endpoint,
        has_token,
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
    let mut store = state.store.lock().map_err(|_| "Context storage is unavailable".to_string())?;
    if !store.contexts.iter().any(|context| context.id == id) {
        return Ok(());
    }

    // A missing credential is harmless; the context file remains the source of truth.
    if let Ok(entry) = keyring_entry(&id) {
        let _ = entry.delete_credential();
    }
    store.contexts.retain(|context| context.id != id);
    persist_store(&state.config_path, &store)
}

#[tauri::command]
async fn test_connection(context: ContextInput, state: State<'_, AppState>) -> Result<ConnectionResult, String> {
    let endpoint = normalize_endpoint(&context.endpoint)?;
    let token = token_for_input(&context, &state)?;
    let info = core_get(&endpoint, "/api/v1/info", token.as_deref()).await?;
    Ok(ConnectionResult { info })
}

#[tauri::command]
async fn list_workflows(context_id: String, state: State<'_, AppState>) -> Result<Vec<Workflow>, String> {
    let context = {
        let store = state.store.lock().map_err(|_| "Context storage is unavailable".to_string())?;
        store.contexts.iter().find(|item| item.id == context_id).cloned()
    }.ok_or_else(|| "The selected context no longer exists".to_string())?;
    let token = get_token(&context.id)?;
    let response = core_get(&context.endpoint, "/api/v1/workflows", token.as_deref()).await?;
    parse_workflows(response)
}

fn token_for_input(context: &ContextInput, state: &AppState) -> Result<Option<String>, String> {
    if let Some(token) = context.token.as_ref().filter(|token| !token.is_empty()) {
        return Ok(Some(token.clone()));
    }
    if let Some(id) = &context.id {
        let store = state.store.lock().map_err(|_| "Context storage is unavailable".to_string())?;
        if store.contexts.iter().any(|item| item.id == *id) {
            return get_token(id);
        }
    }
    Ok(None)
}

async fn core_get(endpoint: &str, path: &str, token: Option<&str>) -> Result<Value, String> {
    let url = api_url(endpoint, path)?;
    let client = Client::builder().timeout(Duration::from_secs(10)).build().map_err(|error| format!("Cannot create HTTP client: {error}"))?;
    let mut request = client.get(url).header(header::ACCEPT, "application/json");
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    let response = request.send().await.map_err(|error| format!("Core request failed: {error}"))?.error_for_status().map_err(|error| format!("Core returned an error: {error}"))?;
    response.json::<Value>().await.map_err(|error| format!("Core returned invalid JSON: {error}"))
}

fn parse_workflows(response: Value) -> Result<Vec<Workflow>, String> {
    let workflows = if response.is_array() {
        response
    } else {
        response.get("items").or_else(|| response.get("workflows")).cloned().ok_or_else(|| "Core returned an unexpected workflows response".to_string())?
    };
    serde_json::from_value(workflows).map_err(|error| format!("Core returned invalid workflows: {error}"))
}

fn normalize_endpoint(input: &str) -> Result<String, String> {
    let mut url = Url::parse(input.trim()).map_err(|_| "Endpoint must be a valid absolute HTTP URL".to_string())?;
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
    Url::parse(&format!("{}{}", endpoint.trim_end_matches('/'), path)).map_err(|_| "Could not construct Core API URL".to_string())
}

fn keyring_entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, id).map_err(keyring_error)
}

fn get_token(id: &str) -> Result<Option<String>, String> {
    let entry = keyring_entry(id)?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(keyring_error(error)),
    }
}

fn keyring_error(error: keyring::Error) -> String {
    format!("Operating system keyring error: {error}")
}

fn load_store(path: &PathBuf) -> Result<ContextStore, String> {
    if !path.exists() {
        return Ok(ContextStore::default());
    }
    let source = fs::read_to_string(path).map_err(|error| format!("Cannot read context storage: {error}"))?;
    serde_json::from_str(&source).map_err(|error| format!("Cannot read context storage: {error}"))
}

fn persist_store(path: &PathBuf, store: &ContextStore) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Cannot create context storage: {error}"))?;
    }
    let temporary = path.with_extension("tmp");
    let contents = serde_json::to_vec_pretty(store).map_err(|error| format!("Cannot serialize context storage: {error}"))?;
    fs::write(&temporary, contents).map_err(|error| format!("Cannot write context storage: {error}"))?;
    fs::rename(&temporary, path).map_err(|error| format!("Cannot finalize context storage: {error}"))
}

fn chrono_timestamp() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let config_path = app.path().app_config_dir().map_err(|error| format!("Cannot locate app config directory: {error}"))?.join("contexts.json");
            let store = load_store(&config_path)?;
            app.manage(AppState { store: Mutex::new(store), config_path });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![list_contexts, save_context, delete_context, test_connection, list_workflows])
        .run(tauri::generate_context!())
        .expect("error while running Kakune GUI");
}

#[cfg(test)]
mod tests {
    use super::{api_url, normalize_endpoint};

    #[test]
    fn normalizes_a_core_endpoint() {
        assert_eq!(normalize_endpoint("http://localhost:8080/").unwrap(), "http://localhost:8080");
    }

    #[test]
    fn appends_the_info_path() {
        assert_eq!(api_url("https://core.example", "/api/v1/info").unwrap().as_str(), "https://core.example/api/v1/info");
    }
}
