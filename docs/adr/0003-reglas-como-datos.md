# ADR 0003: Lenguajes y reglas como datos en JSON

- **Estado:** Aceptada
- **Fecha:** 2026-11-21

## Contexto

RepoCheck debe funcionar con cualquier lenguaje, nuevo o antiguo, y crecer sin reescribir el motor cada vez que se agrega uno. Además, queremos que otras personas puedan contribuir con lenguajes y reglas sin conocer el código del motor.

## Decisión

- La **tabla de lenguajes** vive en `packages/rules/languages.json`: nombre, tipo, extensiones y nombres de archivo exactos.
- Las **reglas de código inseguro** serán objetos JSON por lenguaje (identificador, patrón, severidad, explicación y cómo arreglarlo). Se agregan en el Sprint 4.
- El motor **no contiene lógica específica de un lenguaje** para estas dos cosas: solo aplica los datos.
- Las pruebas validan los archivos de datos: estructura correcta y que una extensión o nombre de archivo no apunte a dos lenguajes.

## Consecuencias

- Agregar un lenguaje es agregar una entrada y ejecutar las pruebas.
- Un lenguaje sin reglas de nivel 3 sigue recibiendo las revisiones universales, y el reporte lo dice.
- Las reglas basadas en expresiones regulares pueden dar falsos positivos y abrir la puerta a expresiones lentas (ReDoS). Se mitiga con revisión de reglas, límite de tiempo por archivo y ejecución en un Web Worker.
- Extensiones ambiguas (por ejemplo `.m` o `.pl` en el pasado) se resuelven asignándolas a un único lenguaje y documentando la decisión; una detección por contenido queda como mejora futura.
