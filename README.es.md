# Kakune GUI

Cliente de escritorio independiente en Tauri 2 para la API HTTP de Kakune Core. No importa código de Core ni lee archivos o bases de datos de Core.

## Requisitos

- Node.js 22 o posterior
- pnpm 10
- Rust estable y los prerrequisitos de plataforma de [Tauri 2](https://v2.tauri.app/start/prerequisites/)
- Un servidor HTTP de Kakune Core en ejecución

## Ejecutar

```sh
pnpm install
pnpm tauri dev
```

Usa `pnpm build` para generar el frontend de producción, `pnpm tauri build` para un instalador, `pnpm test` para las pruebas unitarias del frontend, `pnpm test:e2e` para E2E de navegador, `pnpm test:e2e:desktop` para E2E nativo y `cargo test --manifest-path src-tauri/Cargo.toml --locked` para las pruebas de Rust.

## Instalar una release

Descarga el instalador nativo de una plataforma probada desde GitHub Releases, verificalo con `SHA256SUMS` e instalalo normalmente. Las releases incluyen SBOM SPDX, atestaciones de provenance y una captura E2E real. Verifica un artefacto con `gh attestation verify <artefacto> --repo BraveOtter/kakune-gui`. La GUI no instala Core; añade en **Contextos** la URL de un Core ya instalado. Consulta [RELEASE.md](RELEASE.md) para firma y plataformas.

## Contrato de Core

El endpoint es la URL base del servidor Core, por ejemplo `http://127.0.0.1:8080`. La fachada nativa llama únicamente a:

- `GET {endpoint}/api/v1/info` para probar la conexión
- `GET {endpoint}/api/v1/workflows` para mostrar flujos
- `GET {endpoint}/api/v1/workflows/{id}/source`, además de `PUT` para guardar código y `POST /api/v1/workflows` para crearlo
- `POST {endpoint}/api/v1/workflows/{id}/enable` y `/disable` para cambiar el estado del flujo
- `POST {endpoint}/api/v1/executions` con `{ "workflowId": "..." }` para ejecutar un flujo
- `GET {endpoint}/api/v1/executions` para listar las ejecuciones del contexto seleccionado
- `GET {endpoint}/api/v1/executions/{id}` para inspeccionar una ejecución, incluidos los mensajes de ejecuciones de nodos
- `GET`/`POST`/`DELETE {endpoint}/api/v1/secrets` para administrar nombres y valores sin volver a leer los valores
- `GET`/`POST`/`DELETE {endpoint}/api/v1/providers` y `/diagnose` para perfiles Codex y MiniMax con referencias de secreto
- `GET {endpoint}/api/v1/providers/minimax/capabilities` para el selector de modelos MiniMax
- `GET`/`POST`/`DELETE {endpoint}/api/v1/plugins` para revisar, preparar, confirmar e instalar plugins
- `POST {endpoint}/api/v1/mcp/call` para invocaciones MCP HTTP o stdio mediante el Core

Las credenciales bearer sólo se envían como cabecera HTTP `Authorization: Bearer`. La fachada usa exclusivamente la API HTTP pública del Core; sus comandos siempre requieren el identificador del contexto seleccionado.

## Privacidad y almacenamiento

Los metadatos de contexto (nombre, tipo, endpoint, CA PEM opcional, identidad esperada del Core, fecha de creación y una marca de token presente) se almacenan como `contexts.json` en el directorio de configuración de la aplicación. Los tokens se guardan bajo el servicio `io.github.braveotter.kakune` en el almacén de credenciales del sistema operativo mediante la crate Rust `keyring`. No se persisten en el renderer, local storage ni el JSON de contextos. La exportación e importación usa texto JSON de referencias y excluye siempre tokens y su marca de presencia.

El renderer web no tiene API de sistema de archivos. Toda su superficie nativa está en `src/api.ts`: un conjunto pequeño de comandos Tauri para gestionar contextos y realizar operaciones de API de Core.

## Alcance

La GUI incluye gestión de contextos, CA personalizada, comprobación periódica de conexión y reintento de lecturas, lista y edición de código de flujos, ejecución e historial, y administración por contexto de secretos, plugins, perfiles Codex/MiniMax y MCP. Los perfiles sólo almacenan referencias de secretos y se diagnostican sin exponer credenciales. Los formularios de MiniMax se alimentan de sus capacidades públicas. No gestiona el proceso de Core ni accede directamente a su persistencia.

Los bundles de release usan el icono de Kakune versionado y generado desde `src-tauri/icons/icon.svg`; el E2E de Playwright crea la captura de release desde el renderer real, no desde una maqueta.
