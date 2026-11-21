# ADR 0002: TypeScript en todo el proyecto y núcleo sin dependencias del DOM

- **Estado:** Aceptada
- **Fecha:** 2026-11-21

## Contexto

El motor de análisis debe correr en tres lugares: dentro de un Web Worker en el navegador, en Node (CLI y GitHub Action) y en las pruebas. Escribirlo en lenguajes distintos duplicaría el trabajo y los errores.

## Decisión

- Todo el proyecto está en **TypeScript** con modo estricto (`strict` y `noUncheckedIndexedAccess`).
- El motor vive en `packages/core` y **no usa ninguna API del DOM** (`lib` de TypeScript limitada a `ES2022`).
- El repo es un **monorepo con npm workspaces**: `core`, `rules` y, más adelante, `web` y `cli`.
- Herramientas: **Vitest** para pruebas, **ESLint** (flat config con `typescript-eslint`) para lint y **tsc** para revisar tipos.

## Alternativas consideradas

- **Go compilado a WebAssembly:** buen rendimiento, pero un puente más y un cambio de lenguaje respecto de la interfaz.
- **Un solo paquete sin monorepo:** más simple al inicio, pero mezcla la interfaz con el motor y dificulta reutilizarlo.

## Consecuencias

- Una sola base de código para web, CLI y Action.
- Prohibir el DOM en `core` obliga a pasar el contenido de los archivos como datos, lo que también facilita las pruebas.
- Hay que cuidar que ninguna dependencia de `core` asuma un navegador o Node en particular.
