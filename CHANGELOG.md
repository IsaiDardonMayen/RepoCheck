# Changelog

Todos los cambios notables de este proyecto se registran aquí.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Agregado

- Estructura de monorepo con `@repocheck/core` y `@repocheck/rules`.
- Núcleo: tipos de hallazgos, cálculo de la nota (A a F) con tope por categoría y enmascarado de secretos.
- Tabla de lenguajes (`languages.json`) con más de 60 lenguajes, incluidos los antiguos.
- Detector de lenguajes por extensión o nombre de archivo, con porcentaje por bytes y agrupación de desconocidos (US-03).
- ADR 0001 a 0003 y spike de acceso desde el navegador.
- Plantillas de issues.
- Documentos de proceso: README, CONTRIBUTING, SECURITY y CODE_OF_CONDUCT.
