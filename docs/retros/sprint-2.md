# Retrospectiva · Sprint 2: dependencias

**Objetivo:** leer los manifiestos de dependencias y consultar OSV.dev.
**Resultado:** cumplido. US-04 quedó completa, con los 8 ecosistemas del criterio de aceptación.

## Métricas

| Dato | Valor |
| --- | --- |
| Puntos comprometidos | 8 |
| Puntos terminados | 8 |
| Historias arrastradas | 0 |
| Pruebas al cierre | 96 (de 67 al inicio) |

## Qué salió bien

- Probar OSV.dev real antes de diseñar mostró que `querybatch` solo trae identificadores y que el detalle (severidad, versión corregida) sale de otro endpoint. Eso evitó un rediseño tardío.
- Compilar el código de `core` y ejecutarlo en un navegador contra el servicio real fue una validación mucho más fuerte que las pruebas con respuestas simuladas.
- La historia se entregó en dos partes (3 ecosistemas y luego 5), con el sistema funcionando en cada paso.

## Qué se puede mejorar

- La prueba contra el servicio real fue manual. Sigue pendiente una prueba de contrato automática.
- La severidad con CVSS v4 no se calcula todavía; esas vulnerabilidades quedan como «media» con un aviso.
- Las dependencias «desactualizadas» (no vulnerables) quedaron fuera: OSV no las da y requeriría consultar cada registro.
- Un lote de 1000 dependencias con muchas vulnerabilidades puede generar cientos de consultas de detalle; hoy hay un tope de 300.

## Acción para el Sprint 3

- Cada detector nuevo (secretos, higiene) trae un caso con falsos positivos conocidos en sus pruebas, para medir el ruido desde el principio.
