import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { scanRepoUrl, scanZip, type FetchLike, type FetchResponse, type RuleSets } from '../src/index';

const rules: RuleSets = {
  languageTable: [{ name: 'TypeScript', kind: 'programming', extensions: ['.ts'] } as never],
  secretRules: [],
  codeRules: [],
};
const res = (ok: boolean, status: number, body: unknown): FetchResponse => ({
  ok, status, headers: { get: () => null }, json: async () => body, text: async () => String(body),
});

describe('scanRepoUrl', () => {
  it('descarga lo elegido y devuelve el reporte', async () => {
    const urls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      urls.push(url);
      if (url.endsWith('/repos/o/r')) return res(true, 200, { default_branch: 'main' });
      if (url.includes('/git/trees/')) return res(true, 200, { tree: [{ type: 'blob', path: 'src/a.ts', size: 10 }, { type: 'blob', path: 'README.md', size: 5 }], truncated: false });
      return res(true, 200, 'export const a = 1;');
    };
    const r = await scanRepoUrl('github.com/o/r', fetchFn, rules);
    expect(r.source).toEqual({ name: 'o/r', kind: 'url', ref: 'main' });
    expect(r.report.coverage.filesInRepo).toBe(2);
    expect(urls.some((u) => u.startsWith('https://raw.githubusercontent.com/o/r/main/'))).toBe(true);
  });

  it('rechaza URLs que no son de GitHub', async () => {
    await expect(scanRepoUrl('https://evil.com/o/r', async () => res(true, 200, {}), rules)).rejects.toThrow();
  });

  it('avisa de los archivos que no se pudieron bajar', async () => {
    const fetchFn: FetchLike = async (url) => {
      if (url.endsWith('/repos/o/r')) return res(true, 200, { default_branch: 'main' });
      if (url.includes('/git/trees/')) return res(true, 200, { tree: [{ type: 'blob', path: 'src/a.ts', size: 10 }] });
      return res(false, 404, '');
    };
    const r = await scanRepoUrl('github.com/o/r', fetchFn, rules);
    expect(r.report.notes.join(' ')).toContain('No se pudieron descargar 1');
  });
});

describe('scanZip', () => {
  it('analiza un zip en memoria sin red', async () => {
    const zip = zipSync({ 'proj/src/a.ts': strToU8('export const a = 1;'), 'proj/README.md': strToU8('# x') });
    const r = await scanZip('proj.zip', zip, undefined, rules);
    expect(r.source.kind).toBe('zip');
    expect(r.report.coverage.filesInRepo).toBe(2);
  });
});
