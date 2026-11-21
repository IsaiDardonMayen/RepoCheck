# ADR 0005 · Interfaz de panel minimalista

Estado: aceptada · Versión 1.1

## Contexto
La primera interfaz era funcional pero genérica. El proyecto es una herramienta de seguridad que se muestra a reclutadores y usuarios: debe verse actual, ser clara de un vistazo y seguir siendo gratis y sin servidor.

## Decisión
- Un **panel** de tarjetas: anillo con la nota, gravedad, puntos por categoría, lenguajes y lista de hallazgos.
- **Oscuro por defecto** (sigue al sistema) con selector Auto/Oscuro/Claro; la elección se guarda en el navegador si hay almacenamiento.
- Estética minimalista: un solo acento (cian a azul), mucho espacio, tipografía del sistema, tipografía monoespaciada solo para rutas y código. Sin librerías de componentes ni fuentes externas.
- Todo el CSS en una hoja global con variables (`--card`, `--accent`, `--critical`…); los colores de gravedad cambian de tono en el tema claro para mantener el contraste.
- El reporte HTML/PDF usa la misma identidad: portada oscura con el anillo de nota y tarjetas claras, apto para imprimir (`print-color-adjust`).
- Accesibilidad: filtros como botones con `aria-pressed`, estado anunciado con `aria-live`, foco visible, `prefers-reduced-motion`, y comprobación con axe en ambos temas.

## Consecuencias
- Cero dependencias nuevas; el paquete inicial pesa ~70 kB comprimidos.
- Los colores viven en variables: cambiar la identidad es editar un bloque.
- El HTML exportado no usa scripts ni recursos externos, así que se puede compartir como archivo único.
