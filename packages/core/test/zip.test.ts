import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readZip, unsafePathReason, ZipError, type ZipProgress } from '../src/index';

const zip = (files: Record<string, string | Uint8Array>): Uint8Array =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));

const kindOf = (fn: () => unknown): string | undefined => {
  try { fn(); } catch (e) { return e instanceof ZipError ? e.kind : 'otro'; }
  return undefined;
};

describe('readZip', () => {
  it('lista archivos, lee los clave y quita la carpeta raíz de GitHub', () => {
    const r = readZip(zip({
      'repo-main/package.json': '{"name":"x"}',
      'repo-main/src/app.ts': 'let a = 1',
      'repo-main/.env': 'TOKEN=abc',
    }));
    expect(r.strippedRoot).toBe('repo-main');
    expect(r.files.map((f) => f.path).sort()).toEqual(['.env', 'package.json', 'src/app.ts']);
    expect([...r.contents.keys()].sort()).toEqual(['.env', 'package.json']);
    expect(r.contents.get('package.json')).toBe('{"name":"x"}');
  });

  it('no quita nada si no hay raíz común', () => {
    const r = readZip(zip({ 'a.ts': 'x', 'b/c.py': 'y' }));
    expect(r.strippedRoot).toBeUndefined();
    expect(r.files).toHaveLength(2);
  });

  it('reporta progreso', () => {
    const calls: string[] = [];
    const cb: ZipProgress = (s, d, t) => calls.push(`${s}:${d}/${t}`);
    readZip(zip({ 'package.json': '{}', 'Dockerfile': 'FROM x', 'a.ts': 'x' }), { onProgress: cb });
    expect(calls[0]).toBe('listing:0/1');
    expect(calls).toContain('extracting:2/2');
  });

  it('omite archivos clave binarios', () => {
    const r = readZip(zip({ 'package.json': new Uint8Array([123, 0, 125]) }));
    expect(r.skipped).toEqual([{ path: 'package.json', reason: 'parece un archivo binario' }]);
    expect(r.contents.size).toBe(0);
  });

  it('rechaza rutas con ../ y otras rutas peligrosas', () => {
    expect(kindOf(() => readZip(zip({ '../evil.txt': 'x', 'ok.txt': 'y' })))).toBe('unsafe-path');
    expect(kindOf(() => readZip(zip({ 'a/../../evil.txt': 'x' })))).toBe('unsafe-path');
    expect(kindOf(() => readZip(zip({ '/etc/passwd': 'x' })))).toBe('unsafe-path');
    expect(kindOf(() => readZip(zip({ 'C:/x.txt': 'x' })))).toBe('unsafe-path');
  });

  it('rechaza zips demasiado grandes, con demasiados archivos o inválidos', () => {
    expect(kindOf(() => readZip(zip({ 'a.txt': 'hola' }), { limits: { maxZipBytes: 10 } }))).toBe('too-large');
    expect(kindOf(() => readZip(zip({ 'a.txt': 'x', 'b.txt': 'y', 'c.txt': 'z' }), { limits: { maxEntries: 2 } }))).toBe('too-many-files');
    expect(kindOf(() => readZip(new Uint8Array([1, 2, 3, 4])))).toBe('invalid');
    expect(kindOf(() => readZip(zip({ 'a.txt': 'x'.repeat(100) }), { limits: { maxTotalBytes: 50 } }))).toBe('too-large');
    expect(kindOf(() => readZip(zip({ 'a.txt': 'x'.repeat(100) }), { limits: { maxFileBytes: 50 } }))).toBe('too-large');
  });

  it('detecta una bomba de compresión por la razón de compresión', () => {
    const bomb = zip({ 'zeros.bin': new Uint8Array(5_000_000) });
    expect(kindOf(() => readZip(bomb))).toBe('bomb');
  });

  it('un zip que miente en el tamaño declarado no puede pasarse del tope', () => {
    const z = zip({ 'package.json': '{"a":"' + 'x'.repeat(5000) + '"}' });
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    for (let i = 0; i < z.length - 4; i++) {
      if (dv.getUint32(i, true) === 0x02014b50) dv.setUint32(i + 24, 10, true); // declara 10 bytes
    }
    const r = readZip(z);
    expect(r.files[0]?.size).toBe(10);
    expect((r.contents.get('package.json') ?? '').length).toBeLessThanOrEqual(10);
  });

  it('rechaza un zip vacío', () => {
    expect(kindOf(() => readZip(zip({ 'carpeta/': new Uint8Array(0) })))).toBe('empty');
  });
});

describe('unsafePathReason', () => {
  const l = { maxPathLength: 20, maxDepth: 3 };
  it('acepta rutas normales y rechaza largas o profundas', () => {
    expect(unsafePathReason('src/app.ts', l)).toBeUndefined();
    expect(unsafePathReason('a/b/c/d.ts', l)).toMatch(/profunda/);
    expect(unsafePathReason('x'.repeat(30), l)).toMatch(/larga/);
    expect(unsafePathReason('a\\b', l)).toMatch(/invertidas/);
    expect(unsafePathReason('a\0b', l)).toMatch(/nulo/);
  });
});
