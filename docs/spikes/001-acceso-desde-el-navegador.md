# Spike 001: acceso desde el navegador a GitHub y OSV.dev

- **Fecha:** 2026-11-21
- **Tiempo máximo:** 1 día
- **Pregunta:** ¿puede una página web estática, sin servidor, consultar GitHub y OSV.dev directamente desde el navegador?

## Método

Se ejecutó `fetch` desde una página de otro origen (`https://example.com`) en un navegador real, para que aplicaran las reglas de CORS tal como se aplicarían desde GitHub Pages. La misma prueba está en [`spikes/cors-check/index.html`](../../spikes/cors-check/index.html) para repetirla desde cualquier origen.

## Resultados

| Prueba | Resultado | Observación |
| --- | --- | --- |
| `GET api.github.com/repos/{o}/{r}/git/trees/{rama}?recursive=1` | Funciona | Límite sin autenticar: 60 consultas por hora |
| `POST api.osv.dev/v1/query` (una dependencia) | Funciona | Devolvió vulnerabilidades para `lodash@4.17.15` |
| `POST api.osv.dev/v1/querybatch` (varias dependencias) | Funciona | Una sola petición para muchas dependencias |
| `GET raw.githubusercontent.com/{o}/{r}/{rama}/{ruta}` | Funciona | Responde con `access-control-allow-origin: *` |
| `GET api.github.com/repos/{o}/{r}/zipball/{rama}` | **Falla** | `Failed to fetch`: la redirección de descarga no permite CORS |

## Conclusiones

1. La idea de una web 100 % en el navegador **es viable**.
2. Para un enlace de repo **no se puede descargar el zip completo**. Se usa el árbol de archivos (una consulta) y se bajan solo los archivos necesarios desde `raw.githubusercontent.com`.
3. Para dependencias se usa `querybatch` de OSV.dev, una petición por análisis.
4. El límite de 60 consultas por hora de la API de GitHub aplica al árbol y a otras llamadas a `api.github.com`. Hay que mostrarlo con claridad y permitir un token opcional del propio usuario.

## Preguntas abiertas

- ¿Cuántos archivos puede bajar de `raw` en un análisis antes de que GitHub limite las peticiones? No se midió.
- ¿Qué hacer cuando el árbol viene marcado como `truncated` (repos muy grandes)? Hay que definir un aviso y analizar solo lo que llegó.
- Los resultados dependen de que GitHub y OSV.dev mantengan su política de CORS. Se cubrirá con pruebas de contrato en el adaptador.

## Decisión derivada

Ver [ADR 0001](../adr/0001-app-en-el-navegador.md).
