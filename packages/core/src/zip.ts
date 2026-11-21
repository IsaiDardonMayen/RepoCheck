import { strFromU8, unzipSync } from 'fflate';
import type { FileInfo } from './languages';
import { selectKeyFiles } from './github';

export interface ZipLimits {
  /** Tamaño máximo del zip comprimido. */
  maxZipBytes: number;
  /** Suma máxima de los tamaños descomprimidos declarados. */
  maxTotalBytes: number;
  /** Tamaño máximo de un archivo descomprimido. */
  maxFileBytes: number;
  /** Cantidad máxima de entradas. */
  maxEntries: number;
  /** Razón máxima de compresión (descomprimido / comprimido) en archivos grandes. */
  maxRatio: number;
  /** Longitud máxima de una ruta. */
  maxPathLength: number;
  /** Profundidad máxima de carpetas. */
  maxDepth: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxZipBytes: 100 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxFileBytes: 20 * 1024 * 1024,
  maxEntries: 20_000,
  maxRatio: 200,
  maxPathLength: 260,
  maxDepth: 30,
};

export type ZipProgress = (stage: 'listing' | 'extracting', done: number, total: number) => void;

export type ZipErrorKind =
  | 'too-large' | 'too-many-files' | 'unsafe-path' | 'bomb' | 'invalid' | 'empty';

export class ZipError extends Error {
  constructor(message: string, readonly kind: ZipErrorKind) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipContents {
  /** Todos los archivos del zip (sin carpetas), con la carpeta raíz común ya quitada. */
  files: FileInfo[];
  /** Texto de los archivos clave (manifiestos, Docker, workflows, .env…), por ruta. */
  contents: Map<string, string>;
  /** Archivos clave que no se leyeron y por qué. */
  skipped: { path: string; reason: string }[];
  /** Carpeta raíz que se quitó (típico de los zips de GitHub), si había. */
  strippedRoot?: string;
}

/** Devuelve un motivo si la ruta de una entrada es peligrosa, o `undefined` si es segura. */
export function unsafePathReason(path: string, limits: Pick<ZipLimits, 'maxPathLength' | 'maxDepth'>): string | undefined {
  if (path.includes('\0')) return 'contiene un carácter nulo';
  if (path.includes('\\')) return 'usa barras invertidas';
  if (path.startsWith('/')) return 'es una ruta absoluta';
  if (/^[A-Za-z]:/.test(path)) return 'incluye una letra de unidad';
  const segments = path.split('/');
  if (segments.some((s) => s === '..')) return 'sale de la carpeta con «..»';
  if (path.length > limits.maxPathLength) return 'es demasiado larga';
  if (segments.length > limits.maxDepth) return 'es demasiado profunda';
  return undefined;
}

interface Entry {
  name: string;
  /** Tamaño comprimido. */
  size: number;
  /** Tamaño descomprimido declarado. */
  originalSize: number;
}

function listEntries(data: Uint8Array): Entry[] {
  const entries: Entry[] = [];
  try {
    // El filtro devuelve false: solo lee las cabeceras, no descomprime nada.
    unzipSync(data, {
      filter: (f) => {
        entries.push({ name: f.name, size: f.size, originalSize: f.originalSize });
        return false;
      },
    });
  } catch {
    throw new ZipError('El archivo no es un zip válido o está dañado.', 'invalid');
  }
  return entries;
}

function commonRoot(paths: readonly string[]): string | undefined {
  const first = paths[0]?.split('/')[0];
  if (!first || paths.length === 0) return undefined;
  const allShare = paths.every((p) => p.startsWith(`${first}/`));
  return allShare ? first : undefined;
}

/**
 * Lee un zip en memoria con límites de seguridad. Nunca escribe a disco ni ejecuta nada.
 * Rechaza el zip completo si alguna ruta es peligrosa o si parece una bomba de compresión.
 */
export function readZip(
  data: Uint8Array,
  options: {
    limits?: Partial<ZipLimits>;
    onProgress?: ZipProgress;
    /** Qué archivos descomprimir (por ruta ya sin raíz común). Por defecto, los archivos clave. */
    select?: (files: readonly FileInfo[]) => string[];
  } = {},
): ZipContents {
  const limits: ZipLimits = { ...DEFAULT_ZIP_LIMITS, ...options.limits };
  const progress = options.onProgress ?? ((): void => undefined);

  if (data.length > limits.maxZipBytes) {
    throw new ZipError(`El zip pesa más de ${Math.round(limits.maxZipBytes / 1048576)} MB.`, 'too-large');
  }

  progress('listing', 0, 1);
  const all = listEntries(data);
  if (all.length > limits.maxEntries) {
    throw new ZipError(`El zip tiene más de ${limits.maxEntries} entradas.`, 'too-many-files');
  }

  const entries = all.filter((e) => !e.name.endsWith('/'));
  let total = 0;
  for (const e of all) {
    const reason = unsafePathReason(e.name, limits);
    if (reason) throw new ZipError(`Ruta insegura en el zip («${e.name.slice(0, 80)}»): ${reason}.`, 'unsafe-path');
  }
  for (const e of entries) {
    if (e.originalSize > limits.maxFileBytes) {
      throw new ZipError(`Un archivo del zip supera ${Math.round(limits.maxFileBytes / 1048576)} MB descomprimido.`, 'too-large');
    }
    if (e.originalSize > 1_000_000 && e.originalSize / Math.max(1, e.size) > limits.maxRatio) {
      throw new ZipError('El zip tiene una razón de compresión sospechosa (posible bomba de compresión).', 'bomb');
    }
    total += e.originalSize;
    if (total > limits.maxTotalBytes) {
      throw new ZipError(`El contenido descomprimido supera ${Math.round(limits.maxTotalBytes / 1048576)} MB.`, 'too-large');
    }
  }
  if (entries.length === 0) throw new ZipError('El zip no contiene archivos.', 'empty');

  const root = commonRoot(entries.map((e) => e.name));
  const strip = (p: string): string => (root ? p.slice(root.length + 1) : p);
  const files: FileInfo[] = entries.map((e) => ({ path: strip(e.name), size: e.originalSize }));

  const keyPaths = new Set((options.select ?? selectKeyFiles)(files));
  const wanted = new Set(entries.filter((e) => keyPaths.has(strip(e.name))).map((e) => e.name));
  const contents = new Map<string, string>();
  const skipped: { path: string; reason: string }[] = [];

  if (wanted.size > 0) {
    let done = 0;
    const extracted = unzipSync(data, {
      // Solo se descomprimen los archivos clave. La salida queda limitada al
      // tamaño declarado, que ya validamos arriba.
      filter: (f) => {
        const take = wanted.has(f.name);
        if (take) progress('extracting', ++done, wanted.size);
        return take;
      },
    });
    for (const [name, bytes] of Object.entries(extracted)) {
      if (bytes.includes(0)) {
        skipped.push({ path: strip(name), reason: 'parece un archivo binario' });
        continue;
      }
      contents.set(strip(name), strFromU8(bytes));
    }
  }

  const result: ZipContents = { files, contents, skipped };
  if (root) result.strippedRoot = root;
  return result;
}
