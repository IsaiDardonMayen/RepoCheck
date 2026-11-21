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

Las reglas viven en `packages/rules/code-rules.json`. Agrega una entrada:

```json
{
  "id": "JS-EVAL",
  "languages": ["JavaScript", "TypeScript"],
  "severity": "high",
  "title": "Uso de eval",
  "pattern": "\\beval\\s*\\(",
  "fix": "Evita eval: usa JSON.parse para datos o funciones explícitas.",
  "bad": "const r = eval(input);",
  "good": "const r = JSON.parse(input);"
}
```

- `languages` usa los nombres exactos de `languages.json`.
- `pattern` es una expresión regular de JavaScript que se evalúa **línea por línea**. Agrega `"flags": "i"` si no distingue mayúsculas.
- `bad` debe ser detectado y `good` no: las pruebas lo verifican solas con `npm test`.

Criterios para aceptar una regla:

- El patrón debe ser eficiente: sin cuantificadores anidados que puedan causar expresiones lentas, y sin `lookbehind` (algunos navegadores antiguos no lo soportan).
- Debe preferir pocos falsos positivos: es mejor no detectar un caso raro que marcar código correcto.
- Debe explicar cómo arreglarlo.
- Las líneas de comentario y los archivos de pruebas se omiten automáticamente.

Un lenguaje sin reglas no falla: sigue recibiendo las revisiones universales y el reporte lo indica.
