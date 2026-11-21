import { analyze, type AnalysisReport } from './analyze';
import type { CodeRule } from './code';
import { fetchRepoTree, GitHubError, parseRepoUrl, rawUrl, selectKeyFiles, type FetchLike, type RepoRef } from './github';
import type { FileInfo, LanguageDef } from './languages';
import { selectScanFiles, type SecretRule } from './secrets';
import { readZip, type ZipLimits } from './zip';

export interface RuleSets {
  languageTable: readonly LanguageDef[];
  secretRules: readonly SecretRule[];
  codeRules: readonly CodeRule[];
}

export interface RepoSource {
  name: string;
  /** `url` o `zip`. */
  kind: 'url' | 'zip';
  ref?: string;
}

export interface ScanResult {
  source: RepoSource;
  report: AnalysisReport;
}

export type ScanProgress = (message: string, done?: number, total?: number) => void;

/** Elige los archivos a leer: los de código/configuración sensibles y los clave (manifiestos, Docker, workflows). */
export function chooseFiles(files: readonly FileInfo[], table: readonly LanguageDef[]): string[] {
  const scan = selectScanFiles(files, table).paths;
  const key = selectKeyFiles(files);
  return [...new Set([...scan, ...key])];
}

async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Analiza un repositorio público de GitHub desde su URL. Solo se usan GET públicos desde el navegador. */
export async function scanRepoUrl(
  input: string,
  fetchFn: FetchLike,
  rules: RuleSets,
  onProgress: ScanProgress = () => undefined,
): Promise<ScanResult> {
  const parsed = parseRepoUrl(input);
  if (!parsed.ok) throw new GitHubError(parsed.error, 'unexpected');
  const target: RepoRef = parsed.value;

  onProgress('Leyendo la lista de archivos de GitHub…');
  const tree = await fetchRepoTree(fetchFn, target);
  const paths = chooseFiles(tree.files, rules.languageTable);

  const contents = new Map<string, string>();
  let failed = 0;
  let done = 0;
  await mapLimit(paths, 8, async (path) => {
    try {
      const res = await fetchFn(rawUrl(tree.ref, path));
      if (res.ok) contents.set(path, await res.text());
      else failed++;
    } catch {
      failed++;
    }
    onProgress('Descargando archivos…', ++done, paths.length);
  });

  onProgress('Analizando…');
  const report = await analyze({ ...rules, tree: tree.files, contents, fetchFn, onProgress: (s) => onProgress(`Revisando ${s}…`) });
  if (tree.truncated) report.notes.push('GitHub recortó la lista de archivos (repo muy grande): el análisis es parcial.');
  if (failed > 0) report.notes.push(`No se pudieron descargar ${failed} archivos; no se revisaron.`);
  return { source: { name: `${target.owner}/${target.repo}`, kind: 'url', ref: tree.ref.ref }, report };
}

/** Analiza un zip que la persona eligió. Todo ocurre en memoria; el archivo no sale del navegador. */
export async function scanZip(
  name: string,
  data: Uint8Array,
  fetchFn: FetchLike | undefined,
  rules: RuleSets,
  options: { limits?: Partial<ZipLimits> } = {},
  onProgress: ScanProgress = () => undefined,
): Promise<ScanResult> {
  onProgress('Leyendo el zip…');
  const zip = readZip(data, {
    ...(options.limits ? { limits: options.limits } : {}),
    select: (files) => chooseFiles(files, rules.languageTable),
    onProgress: (stage, done, total) => onProgress(stage === 'listing' ? 'Listando el zip…' : 'Descomprimiendo…', done, total),
  });
  onProgress('Analizando…');
  const report = await analyze({
    ...rules,
    tree: zip.files,
    contents: zip.contents,
    ...(fetchFn ? { fetchFn } : {}),
    onProgress: (s) => onProgress(`Revisando ${s}…`),
  });
  for (const s of zip.skipped) report.notes.push(`No se leyó ${s.path}: ${s.reason}.`);
  return { source: { name, kind: 'zip' }, report };
}
