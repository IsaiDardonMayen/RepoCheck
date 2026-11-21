# Retrospectiva · Sprint 3: secretos e higiene

**Objetivo:** detectar secretos con enmascarado y revisar la higiene del repo.
**Resultado:** cumplido. US-05 y US-06 quedaron terminadas.

## Métricas

| Dato | Valor |
| --- | --- |
| Puntos comprometidos | 8 (5 + 3) |
| Puntos terminados | 8 |
| Historias arrastradas | 0 |
| Pruebas al cierre | 162 (de 96 al inicio) |

## Qué salió bien

- Probar los detectores con repos reales (el propio y tres de la cuenta del autor) encontró errores que las pruebas con datos inventados no vieron: una regla de AWS que no detectaba el nombre de variable más común, y una excepción para «referencias de código» que descartaba JWT reales.
- Comparar el resultado antes y después de cada cambio sobre el mismo repo real (5 hallazgos → 2 → 5) fue una prueba de regresión muy eficaz.
- Armar las credenciales falsas de las pruebas por partes evitó que la protección de secretos de GitHub bloqueara los commits.
- Las reglas viven como datos (ADR 0003): agregar o corregir una regla es editar un JSON, no el motor.

## Qué se puede mejorar

- Los falsos positivos se descubrieron a mano. Conviene un conjunto fijo de «repos de referencia» (limpio y con problemas conocidos) con resultados esperados, ejecutado en cada cambio de reglas.
- La entropía y los marcadores de posición son heurísticas: habrá falsos negativos. Hay que decirlo con claridad en el reporte.
- El detector escanea archivos de uno en uno por línea; una llave dividida en varias líneas solo se confirma por el cuerpo (`next`).
- La higiene aún no distingue repos especiales (por ejemplo, el repo de perfil de GitHub no necesita licencia).

## Acción para el Sprint 4

- Crear `fixtures/` con un repo limpio y uno «vulnerable-demo» de secretos y malos hábitos falsos, y una prueba que fije el resultado esperado.
