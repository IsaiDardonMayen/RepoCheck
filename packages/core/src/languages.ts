/** Definición mínima de un lenguaje; coincide con las entradas de `@repocheck/rules`. */
export interface LanguageDef {
  name: string;
  kind: string;
  extensions: readonly string[];
  filenames?: readonly string[] | undefined;
}

export interface FileInfo {
  path: string;
  size: number;
}

export interface LanguageShare {
  name: string;
  kind: string;
  files: number;
  bytes: number;
  /** Porcentaje (0-100) sobre los bytes de los archivos contados, con un decimal. */
  percent: number;
}

export interface LanguageReport {
  languages: LanguageShare[];
  /** Archivos sin lenguaje conocido, agrupados como «Otros». */
  other: { files: number; bytes: number; extensions: string[] };
  /** Archivos omitidos por estar en carpetas de dependencias o compilación. */
  ignoredFiles: number;
  totalBytes: number;
}

export const IGNORED_DIRS: readonly string[] = [
  '.git', 'node_modules', 'vendor', 'dist', 'build', 'target', 'bin', 'obj',
  '.venv', 'venv', '__pycache__', '.gradle', '.idea', 'coverage',
];

interface Index {
  byFilename: Map<string, LanguageDef>;
  byExtension: Map<string, LanguageDef>;
}

function buildIndex(table: readonly LanguageDef[]): Index {
  const byFilename = new Map<string, LanguageDef>();
  const byExtension = new Map<string, LanguageDef>();
  for (const lang of table) {
    for (const f of lang.filenames ?? []) byFilename.set(f, lang);
    for (const e of lang.extensions) byExtension.set(e.toLowerCase(), lang);
  }
  return { byFilename, byExtension };
}

function isIgnored(path: string, ignored: ReadonlySet<string>): boolean {
  const parts = path.split('/');
  return parts.slice(0, -1).some((p) => ignored.has(p));
}

/** Devuelve el lenguaje de un archivo por nombre exacto o por extensión, o `undefined`. */
export function languageOf(path: string, table: readonly LanguageDef[]): LanguageDef | undefined {
  return lookup(path, buildIndex(table));
}

function lookup(path: string, index: Index): LanguageDef | undefined {
  const name = path.split('/').pop() ?? path;
  const exact = index.byFilename.get(name);
  if (exact) return exact;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined; // sin extensión o archivo oculto como `.env`
  return index.byExtension.get(name.slice(dot).toLowerCase());
}

/**
 * Calcula qué lenguajes hay y en qué proporción (por bytes).
 * Los archivos desconocidos se agrupan en «other» sin fallar.
 */
export function detectLanguages(
  files: readonly FileInfo[],
  table: readonly LanguageDef[],
  options: { ignoredDirs?: readonly string[] } = {},
): LanguageReport {
  const index = buildIndex(table);
  const ignored = new Set(options.ignoredDirs ?? IGNORED_DIRS);
  const acc = new Map<string, { def: LanguageDef; files: number; bytes: number }>();
  const other = { files: 0, bytes: 0, extensions: new Set<string>() };
  let ignoredFiles = 0;
  let totalBytes = 0;

  for (const file of files) {
    if (isIgnored(file.path, ignored)) {
      ignoredFiles++;
      continue;
    }
    const size = Math.max(0, file.size);
    totalBytes += size;
    const def = lookup(file.path, index);
    if (def) {
      const entry = acc.get(def.name) ?? { def, files: 0, bytes: 0 };
      entry.files++;
      entry.bytes += size;
      acc.set(def.name, entry);
    } else {
      other.files++;
      other.bytes += size;
      const name = file.path.split('/').pop() ?? file.path;
      const dot = name.lastIndexOf('.');
      if (dot > 0) other.extensions.add(name.slice(dot).toLowerCase());
    }
  }

  const pct = (bytes: number): number => (totalBytes === 0 ? 0 : Math.round((bytes / totalBytes) * 1000) / 10);
  const languages = [...acc.values()]
    .map(({ def, files: n, bytes }) => ({ name: def.name, kind: def.kind, files: n, bytes, percent: pct(bytes) }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));

  return {
    languages,
    other: { files: other.files, bytes: other.bytes, extensions: [...other.extensions].sort() },
    ignoredFiles,
    totalBytes,
  };
}
