import { describe, expect, it } from 'vitest';
import { extractDependencies, parseGoMod, parsePackageLock, parseRequirements } from '../src/index';

describe('parsePackageLock', () => {
  it('lee el formato v3 (packages) con paquetes anidados y omite la raíz y los links', () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'app', version: '1.0.0' },
        'node_modules/lodash': { version: '4.17.15' },
        'node_modules/a/node_modules/@scope/b': { version: '2.0.0' },
        'packages/core': { version: '0.0.1' },
        'node_modules/@app/core': { resolved: 'packages/core', link: true },
        'node_modules/git-dep': { version: 'git+https://x/y.git' },
      },
    });
    expect(parsePackageLock(lock, 'package-lock.json')?.map((d) => `${d.name}@${d.version}`)).toEqual(['lodash@4.17.15', '@scope/b@2.0.0']);
  });

  it('lee el formato v1 (dependencies anidadas)', () => {
    const lock = JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: '1.0.0', dependencies: { b: { version: '2.1.0' } } } } });
    expect(parsePackageLock(lock, 'l')?.map((d) => d.name)).toEqual(['a', 'b']);
  });

  it('devuelve undefined si no es JSON', () => {
    expect(parsePackageLock('{no', 'l')).toBeUndefined();
  });
});

describe('parseRequirements', () => {
  it('lee versiones fijas, normaliza nombres y cuenta las que no se pueden revisar', () => {
    const r = parseRequirements(
      ['# comentario', 'Django==2.2.0', 'My_Pkg[extra]==1.0 ; python_version<"3.9"', 'requests>=2.0', 'flask', '-r base.txt', 'git+https://x/y.git', 'pyyaml==5.1  # fija'].join('\n'),
      'requirements.txt',
    );
    expect(r.dependencies.map((d) => `${d.name}@${d.version}`)).toEqual(['django@2.2.0', 'my-pkg@1.0', 'pyyaml@5.1']);
    expect(r.unresolved).toBe(2);
  });
});

describe('parseGoMod', () => {
  it('lee bloques y líneas sueltas, e ignora lo demás', () => {
    const mod = ['module x', 'go 1.21', 'require github.com/a/b v1.2.3', 'require (', '\tgolang.org/x/text v0.3.0 // indirect', '\t// comentario', ')', 'replace github.com/a/b => ../b', 'exclude github.com/c/d v1.0.0'].join('\n');
    expect(parseGoMod(mod, 'go.mod').map((d) => `${d.name}@${d.version}`)).toEqual(['github.com/a/b@v1.2.3', 'golang.org/x/text@v0.3.0']);
  });
});

describe('extractDependencies', () => {
  it('prefiere el lockfile de la misma carpeta y usa package.json donde no hay', () => {
    const files = new Map([
      ['package.json', JSON.stringify({ dependencies: { lodash: '^4.0.0' } })],
      ['package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/lodash': { version: '4.17.15' } } })],
      ['web/package.json', JSON.stringify({ dependencies: { react: '^18.2.0', vue: 'latest', x: 'workspace:*' } })],
    ]);
    const r = extractDependencies(files);
    expect(r.dependencies.map((d) => `${d.name}@${d.version}`)).toEqual(['lodash@4.17.15', 'react@18.2.0']);
    expect(r.dependencies[1]?.approximate).toBe(true);
    expect(r.notes.join(' ')).toMatch(/web\/package\.json: sin package-lock/);
    expect(r.notes.join(' ')).toMatch(/2 dependencias con rangos complejos/);
  });

  it('quita duplicados y avisa de lockfiles no soportados', () => {
    const files = new Map([
      ['package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/a': { version: '1.0.0' }, 'node_modules/x/node_modules/a': { version: '1.0.0' } } })],
      ['yarn.lock', '# yarn'],
    ]);
    const r = extractDependencies(files);
    expect(r.dependencies).toHaveLength(1);
    expect(r.notes.join(' ')).toMatch(/yarn\.lock/);
  });
});

describe('monorepo con workspaces', () => {
  it('no avisa por los package.json internos si la raíz tiene package-lock.json', () => {
    const lock = JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/x': { version: '1.0.0' } } });
    const pkg = JSON.stringify({ dependencies: { x: '^1.0.0' } });
    const r = extractDependencies(new Map([['package-lock.json', lock], ['packages/web/package.json', pkg]]));
    expect(r.notes.join(' ')).not.toContain('sin package-lock');
    expect(r.dependencies).toHaveLength(1);
  });
});
