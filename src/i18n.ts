export type Locale = "en" | "es";

const messages = {
  en: {
    appName: "Kakune",
    contexts: "Contexts",
    workflows: "Workflows",
    settings: "Settings",
    contextsTitle: "Core contexts",
    contextsDescription: "Choose where this client connects. Credentials stay in your operating system keyring.",
    addContext: "Add context",
    editContext: "Edit context",
    emptyContexts: "No contexts yet.",
    contextName: "Name",
    contextKind: "Type",
    endpoint: "Core endpoint",
    bearerToken: "Bearer token",
    tokenHint: "Leave blank to keep the existing token.",
    local: "Local",
    remote: "Remote",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    test: "Test connection",
    testing: "Testing...",
    connected: "Connected",
    selectContext: "Select a context to view workflows.",
    workflowsTitle: "Workflows",
    refresh: "Refresh",
    loading: "Loading...",
    emptyWorkflows: "No workflows found.",
    theme: "Theme",
    language: "Language",
    system: "System",
    light: "Light",
    dark: "Dark",
    error: "Something went wrong",
    deleteContext: "Delete context",
  },
  es: {
    appName: "Kakune",
    contexts: "Contextos",
    workflows: "Flujos",
    settings: "Configuración",
    contextsTitle: "Contextos de Core",
    contextsDescription: "Elige dónde se conecta este cliente. Las credenciales se guardan en el llavero del sistema operativo.",
    addContext: "Añadir contexto",
    editContext: "Editar contexto",
    emptyContexts: "Aún no hay contextos.",
    contextName: "Nombre",
    contextKind: "Tipo",
    endpoint: "Endpoint de Core",
    bearerToken: "Token bearer",
    tokenHint: "Déjalo vacío para conservar el token actual.",
    local: "Local",
    remote: "Remoto",
    save: "Guardar",
    cancel: "Cancelar",
    delete: "Eliminar",
    test: "Probar conexión",
    testing: "Probando...",
    connected: "Conectado",
    selectContext: "Selecciona un contexto para ver sus flujos.",
    workflowsTitle: "Flujos",
    refresh: "Actualizar",
    loading: "Cargando...",
    emptyWorkflows: "No se encontraron flujos.",
    theme: "Tema",
    language: "Idioma",
    system: "Sistema",
    light: "Claro",
    dark: "Oscuro",
    error: "Algo salió mal",
    deleteContext: "Eliminar contexto",
  },
} as const;

export type MessageKey = keyof (typeof messages)["en"];

export function translate(locale: Locale, key: MessageKey): string {
  return messages[locale][key];
}

export function initialLocale(): Locale {
  const stored = localStorage.getItem("kakune.locale");
  if (stored === "en" || stored === "es") return stored;
  return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}
