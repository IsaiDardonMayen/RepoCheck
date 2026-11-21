import { describe, expect, it } from 'vitest';
import { analyze, dedupeFindings, type Finding, type FetchLike } from '../../core/src/index';
import { codeRules, languages, secretRules } from '../src/index';

const base = { languageTable: languages, secretRules, codeRules };
const tree = (m: Map<string, string>) => [...m].map(([path, t]) => ({ path, size: t.length }));
const AWS = 'AKIA' + 'IOSFODNN7' + 'EXAMPLQ';

const clean = (): Map<string, string> =>
  new Map([
    ['README.md', '# demo'],
    ['LICENSE', 'MIT'],
    ['.gitignore', 'node_modules'],
    ['src/app.ts', 'export const a = 1;\n'],
  ]);

describe('analyze', () => {
  it('repo limpio: nota A y sin hallazgos', async () => {
    const c = clean();
    const r = await analyze({ ...base, tree: tree(c), contents: c });
    expect(r.findings).toEqual([]);
    expect(r.score.grade).toBe('A');
    expect(r.notes.join(' ')).toContain('OSV');
  });

  it('credenciales expuestas bajan la nota y nunca salen completas', async () => {
    const c = clean();
    c.set('src/config.ts', `const key = "${AWS}";\neval(userInput);\n`);
    const r = await analyze({ ...base, tree: tree(c), contents: c });
    expect(r.findings.some((f) => f.category === 'secrets')).toBe(true);
    expect(r.score.score).toBeLessThan(100);
    expect(JSON.stringify(r)).not.toContain(AWS);
    expect(r.findings[0]?.severity).toBe('critical');
  });

  it('un servicio de vulnerabilidades caído no pierde el análisis', async () => {
    const c = clean();
    c.set('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/x': { version: '1.0.0' } } }));
    const down: FetchLike = () => Promise.reject(new Error('sin red'));
    const r = await analyze({ ...base, tree: tree(c), contents: c, fetchFn: down });
    expect(r.coverage.vulnerabilitiesChecked).toBe(false);
    expect(r.notes.join(' ')).toContain('OSV');
  });

  it('el orden es estable: gravedad primero', async () => {
    const c = clean();
    c.set('a.env', 'x=1');
    c.set('src/z.ts', `const k = "${AWS}";\n`);
    const r = await analyze({ ...base, tree: tree(c), contents: c });
    const ranks = r.findings.map((f) => ['critical', 'high', 'medium', 'low'].indexOf(f.severity));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('dedupeFindings', () => {
  const f = (over: Partial<Finding>): Finding => ({
    ruleId: 'X', category: 'config', severity: 'high', file: 'Dockerfile', line: 3, title: 't', fix: 'f', ...over,
  });
  it('prefiere el secreto cuando comparte archivo y línea con otra regla', () => {
    const r = dedupeFindings([f({ ruleId: 'DOCKER-SECRET-ENV' }), f({ ruleId: 'SECRET-AWS', category: 'secrets', severity: 'critical' })]);
    expect(r.findings.map((x) => x.ruleId)).toEqual(['SECRET-AWS']);
    expect(r.removed).toBe(1);
  });
  it('une los idénticos y respeta líneas distintas', () => {
    const r = dedupeFindings([f({}), f({}), f({ line: 4 })]);
    expect(r.findings).toHaveLength(2);
  });
});
