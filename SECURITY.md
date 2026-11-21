# Política de seguridad

RepoCheck lee contenido de terceros (repos y archivos zip), así que su propia seguridad es parte del producto.

## Cómo reportar una vulnerabilidad

Usa los avisos de seguridad privados de GitHub: pestaña **Security → Report a vulnerability** de este repositorio. No abras un issue público con los detalles.

Voy a confirmar la recepción lo antes posible y a coordinar contigo la corrección antes de divulgar el problema.

## Modelo de amenazas (resumen)

| Amenaza | Mitigación prevista |
| --- | --- |
| Inyección de código en el reporte (XSS) | Escapar todo texto del repo; no usar `innerHTML` con datos externos; CSP estricta |
| Bomba de compresión en un zip | Límites de tamaño comprimido y descomprimido, de número de archivos y de profundidad |
| Rutas con `../` en un zip | Normalizar y rechazar rutas peligrosas; nunca se escribe a disco |
| Expresiones regulares lentas (ReDoS) | Reglas revisadas, límite de tiempo por archivo, análisis en un Web Worker |
| Enlaces a otros hosts | Solo `github.com` con formato válido; consultas solo a GitHub y OSV.dev |
| Dependencias propias vulnerables | `package-lock.json` fijo, pocas dependencias y `npm audit` antes de cada release |
| Cadena de despliegue comprometida | Workflow de Pages con permisos mínimos y acciones fijadas por commit (Sprint 6) |
| Fuga de secretos hallados | Enmascarar al detectar; no persistir nada; no registrar contenido en consola |
| Uso indebido | Aviso de uso responsable; solo repos públicos; sin cuentas ni repos privados |

Estas medidas se implementan a lo largo de los sprints; este documento se actualiza conforme se completan.

## Principios

- RepoCheck **nunca ejecuta** el código que analiza: solo lo lee como texto.
- Los secretos que encuentra se enmascaran desde que se detectan, antes de llegar al reporte.
- Nada se sube ni se guarda: sin cuentas, sin base de datos y sin analítica de terceros.
- Se debe usar solo sobre repositorios propios o públicos.

## Alcance

Esta política cubre el código de este repositorio y el sitio publicado desde él. No cubre las vulnerabilidades de los repos que se analicen con la herramienta.
