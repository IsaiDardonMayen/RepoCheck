# Changelog

Todos los cambios notables de este proyecto se registran aquí.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

## [Sin publicar]

## [0.2.0] - 2026-11-21

### Agregado

- Estructura de monorepo con `@repocheck/core` y `@repocheck/rules`.
- Núcleo: tipos de hallazgos, cálculo de la nota (A a F) con tope por categoría y enmascarado de secretos.
- Tabla de lenguajes (`languages.json`) con más de 60 lenguajes, incluidos los antiguos.
- Detector de lenguajes por extensión o nombre de archivo, con porcentaje por bytes y agrupación de desconocidos (US-03).
- Análisis por URL: validación de enlaces de GitHub, árbol del repo en una consulta, manejo de límite de consultas y selección de archivos clave desde raw (US-01).
- Lectura de zips en memoria con límites de seguridad: rutas peligrosas, bombas de compresión, tamaño y número de archivos, con progreso (US-02).
- Dependencias (US-04, parte 1): lectura de `package-lock.json`, `package.json`, `requirements.txt` y `go.mod`; consulta a OSV.dev con una petición por lote; severidad por etiqueta o CVSS v3; versión corregida más cercana; unión de alias duplicados.
- ADR 0001 a 0003 y spike de acceso desde el navegador.
- Plantillas de issues.
- Documentos de proceso: README, CONTRIBUTING, SECURITY y CODE_OF_CONDUCT.
