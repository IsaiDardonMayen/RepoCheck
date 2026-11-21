# Retro · Versión 1.1 · Rediseño del panel

**Entregado:** panel minimalista oscuro/claro, reporte HTML/PDF con la misma identidad, documentación al día (ADR 0005, arquitectura, README con capturas).

**Salió bien**
- Cambiar solo la capa de presentación: el núcleo y sus 244 pruebas no se tocaron.
- Probado en Chrome real en ambos temas: axe sin errores, descargas sin secretos completos, PDF revisado página por página.

**A mejorar**
- Mover el análisis a un Web Worker para repos muy grandes.
- Más pruebas automáticas de interfaz (hoy la prueba de punta a punta es manual).
