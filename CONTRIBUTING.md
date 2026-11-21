# Cómo se trabaja en RepoCheck

Este proyecto se desarrolla con Scrum ligero, adaptado a una sola persona. Que el proceso sea visible es parte del objetivo del proyecto.

## Roles

Una persona cumple los tres roles, y se declara para ser explícito sobre el trabajo de cada uno:

- **Product Owner:** decide qué se hace y en qué orden (el backlog).
- **Desarrollo:** construye, prueba y documenta.
- **Scrum Master:** cuida el proceso, las ceremonias y la mejora continua.

## Ritmo

- Sprint 0 de 1 semana y sprints de 2 semanas, con unas 10 horas por semana de dedicación.
- Un **milestone** de GitHub por sprint, con su objetivo en la descripción.
- Sin tablero: el estado se ve en los issues y en el milestone del sprint.
- Máximo **2 historias** abiertas a la vez.
- Estimación en puntos: 1, 2, 3, 5, 8. Una historia de más de 8 se divide.

| Ceremonia | Cuándo | Dónde queda registrada |
| --- | --- | --- |
| Planificación | Inicio del sprint | Descripción del milestone |
| Daily asíncrono | Cada día de trabajo | Mensaje de commit o comentario en el issue |
| Refinamiento | A mitad del sprint | Comentarios en los issues |
| Revisión | Fin del sprint | GIF o captura en el milestone y notas del release |
| Retrospectiva | Fin del sprint | `docs/retros/sprint-N.md` |

## Ramas (Git Flow ligero)

- `main`: siempre desplegable. Cada commit aquí es una versión.
- `develop`: integración del sprint en curso.
- `feature/US-12-insignia`: una rama por historia, creada desde `develop`.
- `release/1.0.0`: estabilización antes de publicar.
- `hotfix/...`: correcciones urgentes sobre `main`.

Se trabaja en solitario, así que no hay protecciones ni CI: la disciplina está en `npm run check` antes de cada merge a `develop`.

## Commits

Se usa [Conventional Commits](https://www.conventionalcommits.org/es/):

```text
feat(secrets): detectar llaves de AWS (#14)
fix(core): no descontar dos veces en el tope por categoría
docs(adr): agregar ADR 004
test(rules): validar extensiones duplicadas
chore(ci): fijar versiones de las acciones
```

## Issues y commits

- Cada commit de una historia enlaza su issue (`Closes #N` al terminar).

## Definición de listo (DoR)

- Historia con formato «Como… quiero… para…».
- Criterio de aceptación escrito y comprobable.
- Estimada y de 8 puntos o menos.

## Definición de terminado (DoD)

- [ ] Código fusionado a `develop` desde su rama de historia.
- [ ] Pruebas nuevas o actualizadas, todas en verde.
- [ ] `npm run check` sin errores (lint, tipos y pruebas).
- [ ] Documentación actualizada (README, docs o ADR si aplica).
- [ ] Criterio de aceptación verificado y comentado en el issue.
- [ ] Revisión de accesibilidad hecha si cambió la interfaz.

## Cómo agregar un lenguaje o una regla

Ver [docs/rules-guide.md](docs/rules-guide.md).
