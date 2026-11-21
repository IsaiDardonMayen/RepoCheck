import type { FileInfo } from './languages';

export interface RepoRef {
  owner: string;
  repo: string;
  /** Rama o etiqueta si la URL la trae; si no, se usa la rama por defecto. */
  ref?: string;
}

export type ParseResult = { ok: true; value: RepoRef } | { ok: false; error: string };

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Acepta `github.com/owner/repo`, con o sin protocolo, `www.`, `.git`
 * y `/tree/<rama>`. Todo lo que no sea github.com se rechaza.
 * Si la rama contiene `/`, se toma todo lo que sigue a `/tree/` como rama.
 */
export function parseRepoUrl(input: string): ParseResult {
  const raw = input.trim();
  if (raw === '') return { ok: false, error: 'Pega la URL de un repositorio público de GitHub.' };

  if (/(^|[/\\])\.\.([/\\?#]|$)/.test(raw)) {
    return { ok: false, error: 'La URL contiene segmentos «..» que no son válidos.' };
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return { ok: false, error: 'La URL no es válida.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'Solo se aceptan URL http o https.' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, error: 'La URL no debe incluir usuario ni contraseña.' };
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    return { ok: false, error: 'Solo se aceptan repositorios de github.com.' };
  }

  const parts = url.pathname.split('/').filter((p) => p !== '');
  const [owner, rawRepo, kind, ...rest] = parts;
  if (!owner || !rawRepo) {
    return { ok: false, error: 'Falta el repositorio: usa github.com/usuario/repositorio.' };
  }
  const repo = rawRepo.replace(/\.git$/i, '');
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === '.' || repo === '..') {
    return { ok: false, error: 'El nombre del usuario o del repositorio no es válido.' };
  }

  if (kind === 'tree' && rest.length > 0) {
    let ref: string;
    try {
      ref = decodeURIComponent(rest.join('/'));
    } catch {
      return { ok: false, error: 'La rama de la URL no es válida.' };
    }
    if (ref.includes('..') || ref.startsWith('/')) {
      return { ok: false, error: 'La rama de la URL no es válida.' };
    }
    return { ok: true, value: { owner, repo, ref } };
  }
  return { ok: true, value: { owner, repo } };
}

/** Lo mínimo que se necesita de `fetch`, para no depender del DOM ni de Node. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}
export interface FetchInit {
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
}
export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>;

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly kind: 'not-found' | 'rate-limit' | 'network' | 'unexpected',
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export interface RepoTree {
  ref: RepoRef & { ref: string };
  files: FileInfo[];
  /** `true` si GitHub recortó el árbol (repos muy grandes): el análisis será parcial. */
  truncated: boolean;
}

const API = 'https://api.github.com';

async function getJson(fetchFn: FetchLike, url: string): Promise<unknown> {
  let res: FetchResponse;
  try {
    res = await fetchFn(url);
  } catch {
    throw new GitHubError('No se pudo conectar con GitHub. Revisa tu conexión.', 'network');
  }
  if (res.ok) return res.json();
  if (res.status === 404) {
    throw new GitHubError('No se encontró el repositorio. Debe existir y ser público.', 'not-found');
  }
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const when = Number.isFinite(reset) && reset > 0 ? ` Se restablece a las ${new Date(reset * 1000).toLocaleTimeString()}.` : '';
    throw new GitHubError(`GitHub limitó las consultas (60 por hora sin cuenta).${when}`, 'rate-limit');
  }
  throw new GitHubError(`GitHub respondió con el error ${res.status}.`, 'unexpected');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Pide el árbol completo del repo en una consulta (más una para la rama por defecto). */
export async function fetchRepoTree(fetchFn: FetchLike, target: RepoRef): Promise<RepoTree> {
  const base = `${API}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
  let ref = target.ref;
  if (!ref) {
    const info = await getJson(fetchFn, base);
    if (!isRecord(info) || typeof info['default_branch'] !== 'string') {
      throw new GitHubError('Respuesta inesperada de GitHub.', 'unexpected');
    }
    ref = info['default_branch'];
  }
  const data = await getJson(fetchFn, `${base}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  if (!isRecord(data) || !Array.isArray(data['tree'])) {
    throw new GitHubError('Respuesta inesperada de GitHub.', 'unexpected');
  }
  const files: FileInfo[] = [];
  for (const node of data['tree'] as unknown[]) {
    if (isRecord(node) && node['type'] === 'blob' && typeof node['path'] === 'string') {
      files.push({ path: node['path'], size: typeof node['size'] === 'number' ? node['size'] : 0 });
    }
  }
  return { ref: { ...target, ref }, files, truncated: data['truncated'] === true };
}

const KEY_NAMES = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'requirements.txt', 'pyproject.toml', 'Pipfile.lock', 'poetry.lock',
  'go.mod', 'go.sum', 'pom.xml', 'build.gradle', 'Cargo.lock', 'Cargo.toml',
  'composer.lock', 'Gemfile.lock', 'packages.lock.json',
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  '.gitignore', 'LICENSE', 'LICENSE.md', 'README.md',
]);

/**
 * Elige qué archivos bajar de `raw.githubusercontent.com`: manifiestos de dependencias,
 * Docker, workflows y archivos de entorno. Respeta un máximo de archivos y de tamaño.
 */
export function selectKeyFiles(
  files: readonly FileInfo[],
  options: { maxFiles?: number; maxFileBytes?: number } = {},
): string[] {
  const maxFiles = options.maxFiles ?? 60;
  const maxBytes = options.maxFileBytes ?? 1_000_000;
  const picked: string[] = [];
  for (const f of files) {
    if (picked.length >= maxFiles) break;
    if (f.size > maxBytes) continue;
    const name = f.path.split('/').pop() ?? f.path;
    const isWorkflow = /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path);
    const isEnv = name === '.env' || (name.startsWith('.env.') && !name.endsWith('.example'));
    if (KEY_NAMES.has(name) || isWorkflow || isEnv) picked.push(f.path);
  }
  return picked;
}

/** URL de un archivo en raw.githubusercontent.com, con cada segmento codificado. */
export function rawUrl(target: RepoRef & { ref: string }, path: string): string {
  const enc = (s: string): string => s.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/${enc(target.ref)}/${enc(path)}`;
}
