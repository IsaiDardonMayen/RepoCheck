// Publica la app en la rama gh-pages (GitHub Pages gratis, sin CI).
// Uso: npm run build && npm run deploy
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'inherit' });
const out = (cwd, ...args) => execFileSync('git', args, { cwd }).toString().trim();

const dist = 'packages/web/dist/web/browser';
const remote = out('.', 'remote', 'get-url', 'origin');
const tmp = mkdtempSync(join(tmpdir(), 'repocheck-pages-'));
try {
  run(tmp, 'init', '-q', '-b', 'gh-pages');
  cpSync(dist, tmp, { recursive: true });
  writeFileSync(join(tmp, '.nojekyll'), '');
  run(tmp, 'add', '-A');
  run(tmp, 'commit', '-q', '-m', `deploy: ${out('.', 'rev-parse', '--short', 'HEAD')}`);
  run(tmp, 'push', '-f', remote, 'gh-pages');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
