import { IGNORED_DIRS, languageOf, type FileInfo, type LanguageDef } from './languages';
import { maskSecret } from './mask';
import type { Finding, Severity } from './types';

/** Regla de detección; coincide con las entradas de `@repocheck/rules`. */
export interface SecretRule {
  id: string;
  title: string;
  severity: Severity;
  pattern: string;
  flags?: string | undefined;
  group?: number | undefined;
  minEntropy?: number | undefined;
  /** `true` si el texto que coincide no es el secreto en sí (por ejemplo, el encabezado de una llave privada) y se muestra tal cual. */
  reveal?: boolean | undefined;
  /** Expresión que debe cumplir la línea siguiente para confirmar el hallazgo (por ejemplo, el cuerpo de una llave). */
  next?: string | undefined;
  fix: string;
}

/** Marca para descartar un falso positivo en el propio código: en la misma línea o en la anterior. */
export const IGNORE_MARKER = 'repocheck:ignore';

export interface IgnoreEntry {
  ruleId?: string;
  file?: string;
  line?: number;
}

export interface SecretScanOptions {
  /** Falsos positivos ya conocidos (por ejemplo, guardados por la persona en la interfaz). */
  ignore?: readonly IgnoreEntry[];
  /** Archivos más grandes que esto se omiten. Por defecto 512 KB. */
  maxFileBytes?: number;
}

export interface SecretScan {
  findings: Finding[];
  /** Archivos revisados. */
  scanned: number;
  /** Hallazgos descartados por marca o por la lista de ignorados. */
  ignored: number;
  notes: string[];
}

/** Entropía de Shannon en bits por carácter. */
export function entropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const PLACEHOLDER = [
  /^[x*.•_-]+$/i,
  /^(?:your|my|the)[_-]/i,
  /^<.*>$/,
  /^\$\{.*\}$/,
  /^\$\(.*\)$/,
  /^\{\{.*\}\}$/,
  /^%.*%$/,
  /(?:example|placeholder|changeme|change[_-]?me|replace[_-]?me|dummy|sample|redacted|insert|todo)/i,
  /^(?:password|passwd|secret|token|test|testing|null|none|undefined|true|false|string|admin|root|user|username)$/i,
];

/** `true` si el valor es claramente un marcador de posición y no una credencial real. */
export function isPlaceholder(value: string): boolean {
  if (/^(.)\1+$/.test(value)) return true;
  if (isSequential(value)) return true;
  return PLACEHOLDER.some((re) => re.test(value));
}

/** `true` si el texto es casi una secuencia consecutiva (`ABCDEF…`, `0123456…`), típica de un alfabeto y no de un secreto. */
function isSequential(value: string): boolean {
  if (value.length < 10) return false;
  let steps = 0;
  for (let i = 1; i < value.length; i++) {
    if (value.charCodeAt(i) - value.charCodeAt(i - 1) === 1) steps++;
  }
  return steps / (value.length - 1) >= 0.3;
}

/**
 * `true` si el valor parece una referencia de código (`settings.SECRET`, `process.env.KEY`).
 * Solo se aplica a reglas de asignación: los tokens de formato fijo (JWT, SendGrid…) también
 * tienen puntos y no deben descartarse.
 */
export function isCodeReference(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(value);
}

const MAX_LINE = 4000;
const MAX_PER_FILE = 200;

interface Compiled {
  rule: SecretRule;
  re: RegExp;
}

function compile(rules: readonly SecretRule[]): Compiled[] {
  return rules.map((rule) => {
    const flags = [...new Set(`${rule.flags ?? ''}g`.split(''))].join('');
    return { rule, re: new RegExp(rule.pattern, flags) };
  });
}

function looksBinary(text: string): boolean {
  return text.includes('\0');
}

function isIgnored(entries: readonly IgnoreEntry[], ruleId: string, file: string, line: number): boolean {
  return entries.some(
    (e) => (e.ruleId === undefined || e.ruleId === ruleId) && (e.file === undefined || e.file === file) && (e.line === undefined || e.line === line),
  );
}

interface Hit {
  rule: SecretRule;
  start: number;
  end: number;
  value: string;
  valueStart: number;
}

/**
 * Busca secretos en los archivos (ruta → texto). Los valores se enmascaran al detectarlos:
 * ningún hallazgo contiene un secreto completo, ni en el fragmento ni en ningún otro campo.
 */
export function detectSecrets(
  files: ReadonlyMap<string, string>,
  rules: readonly SecretRule[],
  options: SecretScanOptions = {},
): SecretScan {
  const compiled = compile(rules);
  const maxBytes = options.maxFileBytes ?? 512 * 1024;
  const ignoreList = options.ignore ?? [];
  const findings: Finding[] = [];
  const notes: string[] = [];
  let scanned = 0;
  let ignored = 0;
  let skippedBig = 0;
  let skippedBinary = 0;
  let capped = 0;

  for (const [file, text] of files) {
    if (text.length > maxBytes) {
      skippedBig++;
      continue;
    }
    if (looksBinary(text)) {
      skippedBinary++;
      continue;
    }
    scanned++;
    const lines = text.split(/\r?\n/);
    let inFile = 0;

    for (let i = 0; i < lines.length; i++) {
      const full = lines[i] as string;
      if (full.length < 8) continue;
      const line = full.length > MAX_LINE ? full.slice(0, MAX_LINE) : full;
      const hits: Hit[] = [];

      for (const { rule, re } of compiled) {
        re.lastIndex = 0;
        for (let m = re.exec(line); m !== null; m = re.exec(line)) {
          if (m[0].length === 0) {
            re.lastIndex++;
            continue;
          }
          const group = rule.group ?? 0;
          const value = m[group] ?? m[0];
          const valueStart = group === 0 ? m.index : m.index + m[0].indexOf(value);
          if (isPlaceholder(value)) continue;
          if (rule.group !== undefined && isCodeReference(value)) continue;
          if (rule.minEntropy !== undefined && entropy(value) < rule.minEntropy) continue;
          const start = m.index;
          const end = m.index + m[0].length;
          // Si otra regla anterior ya cubrió este texto, esa gana.
          if (hits.some((h) => start < h.end && end > h.start)) continue;
          if (rule.next !== undefined && !new RegExp(rule.next).test(lines[i + 1] ?? '')) continue;
          hits.push({ rule, start, end, value, valueStart });
        }
      }
      if (hits.length === 0) continue;

      const marked = line.includes(IGNORE_MARKER) || (i > 0 && (lines[i - 1] as string).includes(IGNORE_MARKER));
      // Se enmascaran todos los valores de la línea antes de armar el fragmento.
      let masked = line;
      for (const h of [...hits].sort((a, b) => b.valueStart - a.valueStart)) {
        if (h.rule.reveal) continue;
        masked = masked.slice(0, h.valueStart) + maskSecret(h.value) + masked.slice(h.valueStart + h.value.length);
      }

      for (const h of hits) {
        if (marked || isIgnored(ignoreList, h.rule.id, file, i + 1)) {
          ignored++;
          continue;
        }
        if (inFile >= MAX_PER_FILE) {
          capped++;
          continue;
        }
        inFile++;
        const from = Math.max(0, h.start - 40);
        const snippet = masked.slice(from, Math.min(masked.length, from + 160)).trim();
        findings.push({
          ruleId: h.rule.id,
          category: 'secrets',
          severity: h.rule.severity,
          file,
          line: i + 1,
          snippet,
          title: h.rule.title,
          fix: h.rule.fix,
        });
      }
    }
  }

  if (skippedBig > 0) notes.push(`${skippedBig} archivos se omitieron en la búsqueda de secretos por ser muy grandes.`);
  if (skippedBinary > 0) notes.push(`${skippedBinary} archivos binarios no se revisaron en busca de secretos.`);
  if (capped > 0) notes.push(`Se encontraron más de ${MAX_PER_FILE} posibles secretos en un mismo archivo; se muestran los primeros.`);
  return { findings, scanned, ignored, notes };
}

// ---------- Selección de archivos para escanear ----------

const CONFIG_NAME = /^(?:\.env.*|.*\.(?:properties|ini|cfg|conf|config|toml|ya?ml|json|xml|pem|key|tfvars|gradle)|.*(?:secret|credential|password|token).*|id_rsa|id_ed25519)$/i;
const SKIP_NAME = /(?:^package-lock\.json$|\.lock$|\.min\.(?:js|css)$|\.map$|^yarn\.lock$|^pnpm-lock\.yaml$|^go\.sum$|\.svg$)/i;
const SCAN_KINDS = new Set(['programming', 'config', 'data', 'query']);

/**
 * Elige qué archivos leer para buscar secretos: primero configuración y archivos con
 * nombres delicados, luego código. Respeta un máximo de archivos y de tamaño por archivo.
 */
export function selectScanFiles(
  files: readonly FileInfo[],
  table: readonly LanguageDef[],
  options: { maxFiles?: number; maxFileBytes?: number } = {},
): { paths: string[]; omitted: number } {
  const maxFiles = options.maxFiles ?? 400;
  const maxBytes = options.maxFileBytes ?? 256 * 1024;
  const ignored = new Set(IGNORED_DIRS);
  const first: FileInfo[] = [];
  const second: FileInfo[] = [];
  for (const f of files) {
    const parts = f.path.split('/');
    const name = parts[parts.length - 1] ?? f.path;
    if (parts.slice(0, -1).some((p) => ignored.has(p))) continue;
    if (SKIP_NAME.test(name) || f.size > maxBytes || f.size === 0) continue;
    if (CONFIG_NAME.test(name)) first.push(f);
    else if (SCAN_KINDS.has(languageOf(f.path, table)?.kind ?? '')) second.push(f);
  }
  const bySize = (a: FileInfo, b: FileInfo): number => a.size - b.size || a.path.localeCompare(b.path);
  const ordered = [...first.sort(bySize), ...second.sort(bySize)];
  return { paths: ordered.slice(0, maxFiles).map((f) => f.path), omitted: Math.max(0, ordered.length - maxFiles) };
}
