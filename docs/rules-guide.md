# Cómo agregar un lenguaje o una regla

## Agregar un lenguaje

1. Abre `packages/rules/languages.json`.
2. Agrega una entrada en `languages`:

   ```json
   { "name": "Racket", "kind": "programming", "extensions": [".rkt"] }
   ```

   - `kind`: `programming`, `markup`, `data`, `config` o `query`.
   - `extensions`: en minúscula y con el punto inicial.
   - `filenames` (opcional): nombres exactos, como `Dockerfile`.
3. Ejecuta `npm test`. Las pruebas fallan si una extensión o un nombre de archivo ya pertenece a otro lenguaje.
4. Haz el commit. Si la extensión es ambigua, explica en el mensaje por qué se asigna a ese lenguaje.

## Agregar una regla de código inseguro

Las reglas por lenguaje se incorporan en el Sprint 4. El formato previsto es:

```json
{
  "id": "JS-EVAL-001",
  "language": "JavaScript",
  "category": "code",
  "severity": "medium",
  "pattern": "\\beval\\s*\\(",
  "title": "Uso de eval",
  "why": "Ejecuta texto como código y abre la puerta a inyecciones.",
  "fix": "Evita eval; usa JSON.parse o funciones explícitas."
}
```

Criterios para aceptar una regla:

- El patrón debe ser eficiente: sin cuantificadores anidados que puedan causar expresiones lentas.
- Debe explicar por qué importa y cómo arreglarlo.
- Debe tener al menos una prueba con un caso positivo y uno negativo.
- Cualquier secreto de ejemplo en las pruebas debe ser falso y estar claramente marcado.
