# ADR 0004 · Cómo se calcula la nota global

Estado: aceptada · Sprint 4

## Contexto
El reporte necesita una nota de A a F que una persona no técnica entienda y que no se mueva por ruido.

## Decisión
- Se parte de 100 y cada hallazgo descuenta según su gravedad: crítico 25, alto 10, medio 4, bajo 1.
- Cada categoría descuenta como máximo 40, para que una sola (por ejemplo, muchos avisos de higiene) no hunda el repo.
- Notas: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F por debajo.
- Antes de puntuar se unen los duplicados: si un secreto y otra regla señalan la misma línea, queda el secreto.
- Si falla una consulta de red (OSV), el análisis sigue y el reporte avisa que la nota no incluye esa parte.

## Calibración
Con tres repos reales: dos repos sanos dieron 97 y 98 (A); uno con credenciales de AWS y Supabase expuestas dio 42 (F). Un único hallazgo crítico deja el repo en 75 (C) como máximo.

## Consecuencias
La nota es una guía, no una certificación: las reglas son heurísticas y el reporte lo dice. Los pesos viven en `scoring.ts` y se pueden ajustar con una prueba que lo documente.
