import { describe, expect, it } from 'vitest';
import { checkHygiene, type FileInfo } from '../src/index';

const f = (path: string, size = 100): FileInfo => ({ path, size });
const MB = 1024 * 1024;
const base = [f('README.md'), f('LICENSE'), f('.gitignore'), f('src/app.ts')];
const ids = (files: FileInfo[], opts = {}): string[] => checkHygiene(files, opts).findings.map((x) => x.ruleId);

describe('checkHygiene', () => {
  it('un repo ordenado no tiene hallazgos', () => {
    expect(checkHygiene(base).findings).toEqual([]);
  });

  it('avisa si faltan .gitignore, README o licencia, con la categoría correcta', () => {
    const r = checkHygiene([f('src/app.ts')]).findings;
    expect(r.map((x) => x.ruleId).sort()).toEqual(['HYG-NO-GITIGNORE', 'HYG-NO-LICENSE', 'HYG-NO-README']);
    expect(r.find((x) => x.ruleId === 'HYG-NO-LICENSE')?.category).toBe('licenses');
    expect(r.find((x) => x.ruleId === 'HYG-NO-README')?.severity).toBe('medium');
  });

  it('reconoce README y licencia con otros nombres y extensiones', () => {
    for (const files of [[f('readme.rst'), f('LICENSE.md'), f('.gitignore')], [f('README'), f('COPYING'), f('.gitignore')], [f('Readme.txt'), f('UNLICENSE'), f('.gitignore')], [f('README.md'), f('LICENCE'), f('.gitignore')]]) {
      expect(checkHygiene(files).findings, files.map((x) => x.path).join()).toEqual([]);
    }
  });

  it('no pide README ni licencia en subcarpetas ni en un repo vacío', () => {
    expect(ids([f('docs/README.md'), f('docs/LICENSE')])).toContain('HYG-NO-README');
    expect(checkHygiene([]).findings).toEqual([]);
  });

  it('marca archivos .env pero no las plantillas', () => {
    const r = checkHygiene([...base, f('.env'), f('api/.env.production'), f('.env.example'), f('.env.sample'), f('.env.template')]).findings;
    expect(r.map((x) => x.file)).toEqual(['.env', 'api/.env.production']);
    expect(r.every((x) => x.ruleId === 'HYG-ENV-FILE' && x.severity === 'high')).toBe(true);
  });

  it('marca llaves, certificados, bases de datos, registros y binarios', () => {
    const files = [...base, f('certs/server.pem'), f('id_rsa'), f('data/app.sqlite'), f('dump.sql', 2 * MB), f('small.sql', 10), f('app.log'), f('lib/native.dll'), f('backup.zip'), f('.DS_Store')];
    const got = Object.fromEntries(checkHygiene(files).findings.map((x) => [x.file, x.ruleId]));
    expect(got).toEqual({
      'certs/server.pem': 'HYG-KEY-FILE', id_rsa: 'HYG-KEY-FILE', 'data/app.sqlite': 'HYG-DATABASE-FILE', 'dump.sql': 'HYG-DATABASE-FILE',
      'app.log': 'HYG-LOG-FILE', 'lib/native.dll': 'HYG-BINARY-FILE', 'backup.zip': 'HYG-ARCHIVE-FILE', '.DS_Store': 'HYG-OS-FILE',
    });
  });

  it('agrupa node_modules en un solo hallazgo y no lista sus archivos uno por uno', () => {
    const nm = Array.from({ length: 500 }, (_, i) => f(`node_modules/p${i}/index.js`));
    nm.push(f('node_modules/x/bin/tool.exe'), f('node_modules/x/big.bin', 30 * MB));
    const r = checkHygiene([...base, ...nm]).findings;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ ruleId: 'HYG-GENERATED-DIR', file: 'node_modules/', severity: 'medium' });
    expect(r[0]?.title).toContain('502 archivos');
  });

  it('detecta carpetas generadas anidadas por proyecto', () => {
    const r = checkHygiene([...base, ...Array.from({ length: 3 }, (_, i) => f(`web/dist/a${i}.js`)), f('api/__pycache__/m.cpython-311.pyc')]).findings;
    expect(r.map((x) => x.file).sort()).toEqual(['api/__pycache__/', 'web/dist/']);
  });

  it('no se queja de carpetas bin, build o env legítimas', () => {
    const legit = [...base, f('bin/run.sh'), f('bin/cli.js'), f('build/notes.md'), f('env/dev.yml'), f('env/prod.yml'), f('dist/a.js'), f('dist/b.js')];
    expect(checkHygiene(legit).findings).toEqual([]);
  });

  it('marca bin, obj y target solo si tienen compilados', () => {
    const r = checkHygiene([...base, f('bin/Debug/app.dll'), f('bin/Debug/app.pdb'), f('target/classes/A.class'), f('obj/x.txt')]).findings;
    expect(r.map((x) => x.file).sort()).toEqual(['bin/', 'target/']);
  });

  it('avisa de archivos grandes con dos niveles', () => {
    const r = checkHygiene([...base, f('assets/video.mp4', 8 * MB), f('assets/modelo.bin', 40 * MB)]).findings.filter((x) => x.ruleId === 'HYG-LARGE-FILE');
    expect(r.map((x) => `${x.file}:${x.severity}`)).toEqual(['assets/video.mp4:low', 'assets/modelo.bin:medium']);
    expect(r[0]?.title).toContain('8 MB');
  });

  it('avisa de una carpeta .git dentro del zip y no revisa sus archivos', () => {
    const r = checkHygiene([...base, f('.git/config'), f('.git/objects/pack/p.pack', 60 * MB), f('.git/id_rsa')]).findings;
    expect(r.map((x) => x.ruleId)).toEqual(['HYG-GIT-DIR']);
  });

  it('limita los hallazgos por regla y lo informa', () => {
    const logs = Array.from({ length: 40 }, (_, i) => f(`logs/${i}.log`));
    const r = checkHygiene([...base, ...logs], { maxFindingsPerRule: 10 });
    expect(r.findings.filter((x) => x.ruleId === 'HYG-LOG-FILE')).toHaveLength(10);
    expect(r.notes.join(' ')).toMatch(/HYG-LOG-FILE: 40 coincidencias/);
  });

  it('todos los hallazgos traen título, archivo y cómo arreglarlo', () => {
    const r = checkHygiene([f('.env'), f('a.log'), f('x/y.pem')]).findings;
    for (const x of r) {
      expect(x.title.length).toBeGreaterThan(5);
      expect(x.file.length).toBeGreaterThan(0);
      expect(x.fix.length).toBeGreaterThan(20);
      expect(['hygiene', 'licenses']).toContain(x.category);
    }
  });
});
