import { describe, expect, it } from 'vitest';
import { checkCode } from '../../core/src/index';
import { codeRules, languages } from '../src/index';

const ext = (lang: string): string => languages.find((l) => l.name === lang)?.extensions[0] ?? '.txt';
const run = (lang: string, line: string, path = `src/app${ext(lang)}`) => checkCode(new Map([[path, line]]), languages, codeRules);

describe('reglas de código inseguro', () => {
  it('hay 30 o más, con identificadores únicos y expresiones válidas', () => {
    expect(codeRules.length).toBeGreaterThanOrEqual(30);
    expect(new Set(codeRules.map((r) => r.id)).size).toBe(codeRules.length);
    for (const r of codeRules) {
      expect(() => new RegExp(r.pattern, r.flags ?? ''), r.id).not.toThrow();
      expect(['critical', 'high', 'medium', 'low']).toContain(r.severity);
      expect(r.fix.length, r.id).toBeGreaterThan(15);
    }
  });

  it('cada regla aplica a lenguajes que existen en la tabla', () => {
    const names = new Set(languages.map((l) => l.name));
    for (const r of codeRules) for (const l of r.languages) expect(names.has(l), `${r.id}: ${l}`).toBe(true);
  });

  it.each(codeRules.map((r) => [r.id, r] as const))('%s detecta su ejemplo malo y no el bueno', (id, rule) => {
    for (const lang of rule.languages) {
      expect(run(lang, rule.bad).findings.map((f) => f.ruleId), `${id} en ${lang}`).toContain(id);
      expect(run(lang, rule.good).findings.map((f) => f.ruleId), `${id} (bueno) en ${lang}`).not.toContain(id);
    }
  });

  it('cada lenguaje solo recibe sus reglas', () => {
    expect(run('Python', 'x = eval(a)').findings.map((f) => f.ruleId)).toEqual(['PY-EVAL-EXEC']);
    expect(run('Java', 'x = eval(a);').findings).toEqual([]);
    expect(run('Python', 'model.eval()').findings).toEqual([]);
  });

  it('ignora comentarios y archivos de pruebas, y lo informa', () => {
    expect(run('JavaScript', '// eval(x) está prohibido').findings).toEqual([]);
    expect(run('C', ' * no uses gets(buf)').findings).toEqual([]);
    const r = run('JavaScript', 'eval(x);', 'src/app.test.js');
    expect(r.findings).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/pruebas/);
    expect(checkCode(new Map([['a.test.js', 'eval(x);']]), languages, codeRules, { includeTests: true }).findings).toHaveLength(1);
  });

  it('informa los lenguajes sin reglas y los que sí se revisaron', () => {
    const files = new Map([['a.js', 'let a = 1;'], ['b.js', 'let b = 2;'], ['m.cob', 'DISPLAY "HOLA".'], ['x.hs', 'main = pure ()'], ['README.md', '# hola']]);
    const r = checkCode(files, languages, codeRules);
    expect(r.analyzed).toEqual([{ language: 'JavaScript', files: 2, rules: 10 }]);
    expect(r.withoutRules.map((l) => l.language).sort()).toEqual(['COBOL', 'Haskell']);
    expect(r.notes.join(' ')).toMatch(/Sin reglas de código inseguro para: .*COBOL/);
  });

  it('muestra el fragmento, el archivo y la línea', () => {
    const r = checkCode(new Map([['src/a.py', 'import os\nos.system("ls " + d)\n']]), languages, codeRules);
    expect(r.findings[0]).toMatchObject({ ruleId: 'PY-OS-SYSTEM', category: 'code', severity: 'medium', file: 'src/a.py', line: 2, snippet: 'os.system("ls " + d)' });
  });

  it('enmascara secretos que aparezcan en el fragmento', () => {
    const token = 'tk' + '_' + 'aB3dE5gH7jK9mN1pQ3sT';
    const secretRules = [{ id: 'T', title: 't', severity: 'high' as const, pattern: '\\btk_[A-Za-z0-9]{20}\\b', fix: 'x' }];
    const r = checkCode(new Map([['a.py', `os.system("curl -H ${token}")`]]), languages, codeRules, { secretRules });
    expect(r.findings[0]?.snippet).not.toContain(token);
  });

  it('resiste líneas enormes y entradas patológicas', () => {
    const t0 = Date.now();
    const bad = ['eval(' + 'a'.repeat(100_000), 'x.query("' + 'select '.repeat(5000), 'subprocess.run(' + '('.repeat(50_000), 'a'.repeat(1900) + 'eval(x)'].join('\n');
    for (const lang of ['JavaScript', 'Python', 'Java']) run(lang, bad);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
