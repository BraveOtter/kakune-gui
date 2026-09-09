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

Usa `pnpm build` para generar el frontend de producción, `pnpm tauri build` para un instalador, `pnpm test` para las pruebas unitarias del frontend y `cargo test --manifest-path src-tauri/Cargo.toml` para las pruebas de Rust.

## Contrato de Core

El endpoint es la URL base del servidor Core, por ejemplo `http://127.0.0.1:8080`. La fachada nativa llama únicamente a:

- `GET {endpoint}/api/v1/info` para probar la conexión
- `GET {endpoint}/api/v1/workflows` para mostrar flujos

Las credenciales bearer sólo se envían como cabecera HTTP `Authorization: Bearer`. El decodificador inicial de flujos acepta un array o un objeto con `items` o `workflows`; las interfaces TypeScript locales de `src/types.ts` son independientes de Core y se deben concretar al cerrar el contrato de API.

## Privacidad y almacenamiento

Los metadatos de contexto (nombre, tipo, endpoint, fecha de creación y una marca de token presente) se almacenan como `contexts.json` en el directorio de configuración de la aplicación. Los tokens se guardan bajo el servicio `dev.kakune.gui` en el almacén de credenciales del sistema operativo mediante la crate Rust `keyring`. Nunca se escriben en el renderer, local storage ni el JSON de contextos.

El renderer web no tiene API de sistema de archivos. Toda su superficie nativa está en `src/api.ts`: un conjunto pequeño de comandos Tauri para gestionar contextos y realizar las dos operaciones de API de Core.

## Alcance

Esta base incluye gestión de contextos, pruebas de conexión, lista de flujos, textos en español/inglés y apariencia clara/oscura/del sistema. No implementa deliberadamente mutación de flujos, flujos de autenticación, gestión del proceso de Core ni acceso directo a persistencia.

El script de compilación proporciona un icono temporal mínimo de Windows para que un checkout nuevo compile. Debe sustituirse por el arte definitivo antes de distribuir instaladores.
