# Roadmap

El Sprint 0 dura una semana y los seis siguientes, dos semanas cada uno: unas 13 semanas con cerca de 10 horas semanales.

| Sprint | Objetivo | Historias | Qué se muestra en la revisión |
| --- | --- | --- | --- |
| 0 · Fundamentos | Repo, plantillas, ADR 001 a 003 y spike de acceso a GitHub y OSV.dev | | Repo público con plantillas y backlog en issues; spike documentado |
| 1 · Núcleo y entrada | URL y zip con límites seguros y detección de lenguajes | US-01, US-02, US-03 | Pegar una URL o soltar un zip y ver los lenguajes con su porcentaje; zips maliciosos de prueba rechazados |
| 2 · Dependencias | Lectura de manifiestos y consulta a OSV.dev; primero npm, PyPI y Go | US-04 | Reporte en JSON con dependencias vulnerables de repos de ejemplo |
| 3 · Secretos e higiene | Detector de secretos con enmascarado y chequeo de higiene del repo | US-05, US-06 | `vulnerable-demo` muestra sus secretos enmascarados; el repo limpio no da falsos positivos |
| 4 · Reglas y nota | Docker, workflows, motor de reglas y nota global calibrada | US-07, US-08, US-09 | Nota global sobre repos reales, con la fórmula calibrada y documentada en el ADR 007 |
| 5 · Interfaz y reporte | Angular, gráficas y tabla de hallazgos con filtros | US-10, US-13, US-14 | Interfaz completa con filtros y gráfica de lenguajes; axe sin errores graves |
| 6 · Descargas y publicación | HTML, PDF, JSON, Markdown, insignia, GitHub Pages y README con GIF | US-11, US-12 | Descargas en los cuatro formatos, insignia, demo pública y release 1.0 |
| Después · 1.1 | CLI, GitHub Action, SARIF, historial de git y más lenguajes | US-15 | |

## Reglas de planificación

- La fecha de la 1.0 no se mueve sumando historias: si falta tiempo, se recorta alcance.
- Lo que no cabe en un sprint vuelve al backlog y se vuelve a priorizar.
- Nada se agrega a mitad de sprint salvo un bug crítico.

El backlog completo, con criterios de aceptación, está en [backlog.json](backlog.json).
