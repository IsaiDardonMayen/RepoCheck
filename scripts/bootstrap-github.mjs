#!/usr/bin/env node
// Crea etiquetas, milestones e issues en GitHub a partir de docs/backlog.json.
// Requiere la CLI `gh` autenticada. Uso:
//   node scripts/bootstrap-github.mjs --dry-run   (solo muestra lo que haría)
//   node scripts/bootstrap-github.mjs             (lo ejecuta)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const dry = process.argv.includes('--dry-run');
const backlog = JSON.parse(readFileSync(new URL('../docs/backlog.json', import.meta.url), 'utf8'));

const labels = [
  ['type:story', '1d76db', 'Historia de usuario'],
  ['type:bug', 'd73a4a', 'Error'],
  ['type:spike', 'fbca04', 'Investigación acotada'],
  ['type:chore', 'cfd3d7', 'Mantenimiento'],
  ['priority:high', 'b60205', 'Prioridad alta'],
  ['priority:medium', 'e99695', 'Prioridad media'],
  ['priority:low', 'c2e0c6', 'Prioridad baja'],
  ...[1, 2, 3, 5, 8].map((n) => [`size:${n}`, 'ededed', `${n} puntos`]),
];

function gh(args) {
  if (dry) {
    console.log('[dry-run] gh ' + args.join(' '));
    return '';
  }
  return execFileSync('gh', args, { encoding: 'utf8' });
}

for (const [name, color, description] of labels) {
  gh(['label', 'create', name, '--color', color, '--description', description, '--force']);
}

for (const s of backlog.sprints) {
  gh(['api', 'repos/{owner}/{repo}/milestones', '-f', `title=${s.title}`, '-f', `description=${s.goal}`]);
}

for (const i of backlog.issues) {
  const milestone = i.sprint === null ? [] : ['--milestone', backlog.sprints.find((s) => s.number === i.sprint).title];
  const lbls = [`type:${i.type}`, `priority:${i.priority}`, `size:${i.size}`].join(',');
  const title = i.id.startsWith('US-') ? `[${i.id}] ${i.title}` : i.title;
  gh(['issue', 'create', '--title', title, '--body', i.body, '--label', lbls, ...milestone]);
}

console.log(dry ? 'Simulación terminada.' : 'Listo.');
