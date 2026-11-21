# ADR 0001: Aplicación 100 % en el navegador, sin servidor

- **Estado:** Aceptada
- **Fecha:** 2026-11-21

## Contexto

RepoCheck debe estar siempre disponible sin que su autor pague ni mantenga un servidor. Además, procesa código de terceros, y no recibirlo en un servidor propio elimina una clase entera de riesgos (zips maliciosos en el servidor, almacenamiento de secretos, abuso del servicio).

El [spike 001](../spikes/001-acceso-desde-el-navegador.md) comprobó que GitHub (árbol de archivos y archivos `raw`) y OSV.dev aceptan consultas desde el navegador, y que la descarga del zip completo de GitHub no.

## Decisión

La aplicación es una web estática publicada en GitHub Pages. Todo el análisis corre en el navegador, dentro de un Web Worker.

- **Zip:** se lee en memoria en el equipo de la persona y nunca se sube.
- **Repo por URL:** se pide el árbol de archivos a GitHub y se bajan solo los archivos necesarios desde `raw.githubusercontent.com`. No se descarga el zip del repo.
- **Vulnerabilidades:** se consulta `querybatch` de OSV.dev, enviando solo nombre y versión de cada dependencia.

## Consecuencias

- **Bueno:** costo cero, siempre disponible, privacidad por diseño y menos superficie de ataque.
- **Bueno:** el mismo núcleo se reutiliza para una CLI y una GitHub Action.
- **Malo:** no se puede revisar el historial de git en el navegador; eso queda para la CLI y la Action.
- **Malo:** el límite de 60 consultas por hora de la API de GitHub condiciona el análisis por URL.
- **Malo:** los zips muy grandes pueden agotar la memoria del navegador, por lo que hay límites de tamaño.
- **Riesgo:** depende de la política de CORS de terceros. Se aísla en un adaptador con pruebas de contrato.
