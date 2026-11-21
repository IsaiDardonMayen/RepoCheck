import { describe, expect, it } from 'vitest';
import {
  fetchRepoTree, GitHubError, parseRepoUrl, rawUrl, selectKeyFiles,
  type FetchLike, type FetchResponse,
} from '../src/index';

const ok = (v: unknown): FetchResponse => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => v, text: async () => JSON.stringify(v) });
const fail = (status: number, headers: Record<string, string> = {}): FetchResponse => ({
  ok: false, status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, json: async () => ({}), text: async () => "",
});

describe('parseRepoUrl', () => {
  it.each([
    ['github.com/octocat/Hello-World'],
    ['https://github.com/octocat/Hello-World'],
    ['https://www.github.com/octocat/Hello-World/'],
    ['https://github.com/octocat/Hello-World.git'],
    ['  https://github.com/octocat/Hello-World  '],
  ])('acepta %s', (input) => {
    expect(parseRepoUrl(input)).toEqual({ ok: true, value: { owner: 'octocat', repo: 'Hello-World' } });
  });

  it('toma la rama de /tree/, incluso con barras', () => {
    expect(parseRepoUrl('github.com/a/b/tree/feature/x')).toEqual({ ok: true, value: { owner: 'a', repo: 'b', ref: 'feature/x' } });
  });

  it.each([
    ['', /Pega/],
    ['https://gitlab.com/a/b', /github\.com/],
    ['https://github.com.evil.com/a/b', /github\.com/],
    ['https://evil.com/github.com/a/b', /github\.com/],
    ['https://github.com/solo-usuario', /Falta/],
    ['ftp://github.com/a/b', /http/],
    ['https://user:pass@github.com/a/b', /usuario ni contraseña/],
    ['https://github.com/a/..', /\.\./],
    ['https://github.com/-a/b', /válido/],
    ['github.com/a/b/tree/../x', /\.\./],
  ])('rechaza %s', (input, msg) => {
    const r = parseRepoUrl(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });
});

describe('fetchRepoTree', () => {
  const tree = { tree: [{ type: 'blob', path: 'a.ts', size: 5 }, { type: 'tree', path: 'src' }, { type: 'blob', path: 'src/b.py', size: 7 }], truncated: false };

  it('busca la rama por defecto y devuelve solo archivos', async () => {
    const urls: string[] = [];
    const f: FetchLike = async (u) => { urls.push(u); return ok(u.includes('/git/trees/') ? tree : { default_branch: 'main' }); };
    const r = await fetchRepoTree(f, { owner: 'o', repo: 'r' });
    expect(urls).toEqual(['https://api.github.com/repos/o/r', 'https://api.github.com/repos/o/r/git/trees/main?recursive=1']);
    expect(r.files).toEqual([{ path: 'a.ts', size: 5 }, { path: 'src/b.py', size: 7 }]);
    expect(r.ref.ref).toBe('main');
    expect(r.truncated).toBe(false);
  });

  it('con rama explícita hace una sola consulta y marca árboles truncados', async () => {
    let calls = 0;
    const f: FetchLike = async () => { calls++; return ok({ ...tree, truncated: true }); };
    const r = await fetchRepoTree(f, { owner: 'o', repo: 'r', ref: 'dev' });
    expect(calls).toBe(1);
    expect(r.truncated).toBe(true);
  });

  it('traduce 404, límite de consultas y fallos de red', async () => {
    await expect(fetchRepoTree(async () => fail(404), { owner: 'o', repo: 'r' })).rejects.toMatchObject({ kind: 'not-found' });
    await expect(fetchRepoTree(async () => fail(403, { 'x-ratelimit-reset': '1800000000' }), { owner: 'o', repo: 'r' })).rejects.toMatchObject({ kind: 'rate-limit' });
    await expect(fetchRepoTree(async () => { throw new Error('x'); }, { owner: 'o', repo: 'r' })).rejects.toBeInstanceOf(GitHubError);
  });

  it('rechaza respuestas con forma inesperada', async () => {
    await expect(fetchRepoTree(async () => ok({}), { owner: 'o', repo: 'r', ref: 'm' })).rejects.toMatchObject({ kind: 'unexpected' });
  });
});

describe('selectKeyFiles y rawUrl', () => {
  it('elige manifiestos, Docker, workflows y .env, y omite lo grande', () => {
    const files = [
      { path: 'package.json', size: 10 }, { path: 'sub/requirements.txt', size: 10 },
      { path: '.github/workflows/ci.yml', size: 10 }, { path: '.env', size: 10 },
      { path: '.env.example', size: 10 }, { path: 'src/app.ts', size: 10 },
      { path: 'package-lock.json', size: 5_000_000 },
    ];
    expect(selectKeyFiles(files)).toEqual(['package.json', 'sub/requirements.txt', '.github/workflows/ci.yml', '.env']);
  });

  it('respeta el máximo de archivos', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({ path: `p${i}/package.json`, size: 1 }));
    expect(selectKeyFiles(files, { maxFiles: 3 })).toHaveLength(3);
  });

  it('codifica cada segmento de la URL raw', () => {
    expect(rawUrl({ owner: 'o', repo: 'r', ref: 'feat/x' }, 'a b/c#d.json')).toBe('https://raw.githubusercontent.com/o/r/feat/x/a%20b/c%23d.json');
  });
});
