import { describe, expect, it } from 'vitest';
import {
  detectSecrets, entropy, isPlaceholder, readZip, selectScanFiles, type LanguageDef, type SecretRule,
} from '../src/index';
import { strToU8, zipSync } from 'fflate';

/** Valor pseudoaleatorio pero determinista, para no escribir credenciales completas en el repo. */
function rnd(length: number, alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', seed = 7): string {
  let a = seed >>> 0;
  let out = '';
  for (let i = 0; i < length; i++) {
    a = (a + 0x6d2b79f5) >>> 0; // mulberry32
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out += alphabet[((t ^ (t >>> 14)) >>> 0) % alphabet.length];
  }
  return out;
}

const rules: SecretRule[] = [
  { id: 'R-TOKEN', title: 'Token', severity: 'critical', pattern: '\\btk_[A-Za-z0-9]{20}\\b', fix: 'rota' },
  { id: 'R-ASSIGN', title: 'Asignación', severity: 'medium', pattern: 'password\\s*=\\s*"([^"]{8,})"', group: 1, flags: 'i', minEntropy: 2.5, fix: 'mueve' },
  { id: 'R-KEY', title: 'Llave privada', severity: 'critical', pattern: '-----BEGIN PRIVATE KEY-----', reveal: true, next: '^[A-Za-z0-9+/=]{10,}', fix: 'genera otra' },
];
const token = (): string => 'tk' + '_' + rnd(20);
const scan = (text: string, file = 'a.ts', opts = {}) => detectSecrets(new Map([[file, text]]), rules, opts);

describe('detectSecrets', () => {
  it('encuentra el secreto con su archivo y línea, y lo enmascara', () => {
    const t = token();
    const r = scan(`línea uno\nconst k = "${t}";\n`);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ ruleId: 'R-TOKEN', category: 'secrets', severity: 'critical', file: 'a.ts', line: 2, fix: 'rota' });
    expect(r.findings[0]?.snippet).not.toContain(t);
    expect(r.findings[0]?.snippet).toContain(t.slice(0, 4));
    expect(r.findings[0]?.snippet).toContain('****');
  });

  it('nunca deja un valor completo, ni siquiera con varios secretos en la misma línea', () => {
    const a = token();
    const b = 'tk' + '_' + rnd(20, undefined, 99);
    const r = scan(`x("${a}", "${b}")`);
    expect(r.findings).toHaveLength(2);
    for (const f of r.findings) {
      expect(f.snippet).not.toContain(a);
      expect(f.snippet).not.toContain(b);
    }
  });

  it('no muestra más de un cuarto del valor en secretos cortos', () => {
    const pw = rnd(8);
    const r = scan(`password = "${pw}"`);
    const snip = r.findings[0]?.snippet ?? '';
    expect(snip).not.toContain(pw);
    expect(snip).toContain(pw.slice(0, 2) + '******');
    expect(snip).not.toContain(pw.slice(0, 3));
  });

  it('no enmascara el encabezado de una llave privada, que no es el secreto', () => {
    const r = scan('-----BEGIN PRIVATE KEY-----\n' + rnd(40) + '\n');
    expect(r.findings[0]).toMatchObject({ ruleId: 'R-KEY', line: 1 });
    expect(r.findings[0]?.snippet).toBe('-----BEGIN PRIVATE KEY-----');
  });

  it('descarta marcadores de posición y valores poco aleatorios', () => {
    expect(scan('password = "your_password_here"').findings).toEqual([]);
    expect(scan('password = "changeme123"').findings).toEqual([]);
    expect(scan('password = "${DB_PASSWORD}"').findings).toEqual([]);
    expect(scan('password = "aaaaaaaaaa"').findings).toEqual([]);
    expect(scan('password = "abababab"').findings).toEqual([]); // entropía baja
  });

  it('permite marcar un falso positivo en la misma línea o en la anterior', () => {
    const t = token();
    expect(scan(`const k = "${t}"; // repocheck:ignore`).findings).toEqual([]);
    const r = scan(`// repocheck:ignore\nconst k = "${t}";`);
    expect(r.findings).toEqual([]);
    expect(r.ignored).toBe(1);
    expect(scan(`// repocheck:ignore\n\nconst k = "${t}";`).findings).toHaveLength(1);
  });

  it('respeta la lista de falsos positivos conocidos', () => {
    const t = token();
    const text = `a\nconst k = "${t}";`;
    expect(scan(text, 'a.ts', { ignore: [{ ruleId: 'R-TOKEN', file: 'a.ts', line: 2 }] }).findings).toEqual([]);
    expect(scan(text, 'a.ts', { ignore: [{ file: 'otro.ts' }] }).findings).toHaveLength(1);
  });

  it('omite binarios y archivos enormes, y lo informa', () => {
    const t = token();
    const files = new Map([['b.bin', `${t}\0`], ['big.txt', `${t} `.repeat(100)], ['ok.txt', t]]);
    const r = detectSecrets(files, rules, { maxFileBytes: 100 });
    expect(r.findings.map((f) => f.file)).toEqual(['ok.txt']);
    expect(r.scanned).toBe(1);
    expect(r.notes.join(' ')).toMatch(/binarios/);
    expect(r.notes.join(' ')).toMatch(/muy grandes/);
  });

  it('limita los hallazgos por archivo', () => {
    const text = Array.from({ length: 250 }, (_, i) => `k${i} = "${'tk' + '_' + rnd(20, undefined, i + 1)}"`).join('\n');
    const r = scan(text);
    expect(r.findings).toHaveLength(200);
    expect(r.notes.join(' ')).toMatch(/más de 200/);
  });

  it('procesa líneas enormes sin colgarse', () => {
    const t0 = Date.now();
    scan('a'.repeat(200_000) + ' password = "' + 'b'.repeat(100_000));
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('entropy e isPlaceholder', () => {
  it('mide la aleatoriedad', () => {
    expect(entropy('aaaa')).toBe(0);
    expect(entropy('abcd')).toBe(2);
    expect(entropy(rnd(40))).toBeGreaterThan(4.5);
  });
  it('reconoce marcadores comunes', () => {
    for (const v of ['xxxxxxxx', '<token>', '{{ secret }}', 'YOUR_API_KEY', 'example-key-123', '********']) expect(isPlaceholder(v)).toBe(true);
    expect(isPlaceholder('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123')).toBe(true);
    expect(isPlaceholder(rnd(24))).toBe(false);
  });
});

describe('selectScanFiles', () => {
  const table: LanguageDef[] = [
    { name: 'TypeScript', kind: 'programming', extensions: ['.ts'] },
    { name: 'Markdown', kind: 'markup', extensions: ['.md'] },
  ];
  it('pone primero la configuración, omite lo irrelevante y respeta el máximo', () => {
    const files = [
      { path: 'src/app.ts', size: 100 }, { path: '.env', size: 50 }, { path: 'README.md', size: 10 },
      { path: 'node_modules/x/i.ts', size: 10 }, { path: 'package-lock.json', size: 10 }, { path: 'app.min.js', size: 10 },
      { path: 'config/settings.yml', size: 20 }, { path: 'vacio.ts', size: 0 }, { path: 'enorme.ts', size: 9_999_999 },
    ];
    const r = selectScanFiles(files, table);
    expect(r.paths).toEqual(['config/settings.yml', '.env', 'src/app.ts']);
    expect(selectScanFiles(files, table, { maxFiles: 2 })).toEqual({ paths: ['config/settings.yml', '.env'], omitted: 1 });
  });
});

describe('readZip con selección propia', () => {
  it('permite leer archivos de código para buscar secretos', () => {
    const z = zipSync({ 'r/src/app.ts': strToU8('const a = 1;'), 'r/README.md': strToU8('# x') });
    const r = readZip(z, { select: (files) => files.filter((f) => f.path.endsWith('.ts')).map((f) => f.path) });
    expect([...r.contents.keys()]).toEqual(['src/app.ts']);
  });
});

describe('archivos de bloqueo', () => {
  it('no se revisan: los hashes de integridad no son secretos', async () => {
    const { detectSecrets: scan, isLockfile } = await import('../src/index');
    const hash = 'sha512-' + 'Zk3pQ9vL2mXw8RtYb4NcHd7JfGsAe1UoPiVq6KyMnBxCzTlWjOrDh5EuSgIa0F+/8t3Qx9LmP2vNcRw7Yb4Hd';
    const files = new Map([['package-lock.json', `"integrity": "${hash}"`]]);
    expect(scan(files, [{ id: 'ENTROPY', title: 't', severity: 'low', pattern: '[A-Za-z0-9+/]{40,}', fix: 'f' } as never]).findings).toEqual([]);
    expect(isLockfile('a/b/yarn.lock')).toBe(true);
    expect(isLockfile('src/lock.ts')).toBe(false);
  });
});
