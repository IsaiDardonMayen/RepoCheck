# Retrospectiva · Sprint 1: núcleo y entrada

**Objetivo:** aceptar un repo por URL o un zip con límites seguros y detectar sus lenguajes.
**Resultado:** cumplido. Las 3 historias (US-01, US-02 y US-03) quedaron terminadas.

## Métricas

| Dato | Valor |
| --- | --- |
| Puntos comprometidos | 11 (3 + 5 + 3) |
| Puntos terminados | 11 |
| Historias arrastradas | 0 |
| Pruebas al cierre | 67 (de 26 al inicio) |

## Qué salió bien

- La decisión del ADR 0001 se sostuvo: leer el árbol y los archivos clave desde `raw` evitó la descarga del zip bloqueada por CORS.
- Inyectar `fetch` y la tabla de lenguajes como parámetros dejó el núcleo sin DOM y probable sin red.
- Probar el caso peligroso antes de diseñar (un zip que miente en el tamaño declarado) cambió el diseño: la validación de tamaños va primero porque es el tope real de memoria.

## Qué se puede mejorar

- Las pruebas de GitHub usan respuestas simuladas; todavía no hay una prueba contra la API real.
- `URL` no está en las librerías sin DOM y hubo que declararla a mano (`env.d.ts`). Conviene revisar si más APIs necesitan lo mismo.
- Algunas extensiones de `languages.json` son ambiguas (por ejemplo `.h`, `.r`) y se resolvieron por convención.

## Acción para el Sprint 2

- Escribir una prueba de contrato opcional contra OSV.dev y GitHub reales (marcada para no correr por defecto), para detectar si cambia su política de CORS o su formato.
