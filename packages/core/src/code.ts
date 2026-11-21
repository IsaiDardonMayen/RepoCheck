import { languageOf, type LanguageDef } from './languages';
import { redactSecrets, type SecretRule } from './secrets';
import type { Finding, Severity } from './types';

/** Regla de código inseguro; coincide con las entradas de `@repocheck/rules`. */
export interface CodeRule {
  id: string;
  languages: readonly string[];
  severity: Severity;
  title: string;
  pattern: string;
  flags?: string | undefined;
  fix: string;
}

export interface CodeScanOptions {
  /** Revisar también archivos de pruebas. Por defecto no. */
  includeTests?: boolean;
  /** Archivos más grandes que esto se omiten. Por defecto 512 KB. */
  maxFileBytes?: number;
  /** Con estas reglas, cualquier secreto que aparezca en un fragmento se enmascara. */
  secretRules?: readonly SecretRule[];
}

export interface LanguageCoverage {
  language: string;
  files: number;
  /** Cantidad de reglas que se aplicaron a este lenguaje. */
  rules: number;
}

export interface CodeScan {
  findings: Finding[];
  /** Lenguajes con reglas, y cuántos archivos se revisaron de cada uno. */
  analyzed: LanguageCoverage[];
  /** Lenguajes de programación presentes pero sin reglas: solo recibieron las revisiones universales. */
  withoutRules: LanguageCoverage[];
  notes: string[];
}

const MAX_LINE = 2000;
const MAX_PER_FILE = 100;
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|specs?|fixtures?|__mocks__|e2e)\/|\.(?:test|spec)\.[a-z]+$|(?:^|\/)test_[^/]+$|_test\.[a-z]+$/i;
const COMMENT_START = /^\s*(?:\/\/|\/\*|\*|#(?!include|define|if|endif|pragma|region)|--)/;

/** `true` si la ruta parece de pruebas o de datos de ejemplo. */
export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path);
}

/**
 * Busca patrones de código inseguro. Cada archivo recibe solo las reglas de su lenguaje.
 * Son heurísticas por línea: pueden dar falsos positivos y no reemplazan una revisión.
 */
export function checkCode(
  files: ReadonlyMap<string, string>,
  table: readonly LanguageDef[],
  rules: readonly CodeRule[],
  options: CodeScanOptions = {},
): CodeScan {
  const byLanguage = new Map<string, { rule: CodeRule; re: RegExp }[]>();
  for (const rule of rules) {
    const flags = [...new Set(`${rule.flags ?? ''}`.split(''))].filter((f) => f !== 'g').join('');
    const re = new RegExp(rule.pattern, flags);
    for (const lang of rule.languages) byLanguage.set(lang, [...(byLanguage.get(lang) ?? []), { rule, re }]);
  }

  const maxBytes = options.maxFileBytes ?? 512 * 1024;
  const findings: Finding[] = [];
  const seen = new Map<string, number>();
  let skippedTests = 0;
  let skippedBig = 0;

  for (const [path, text] of files) {
    const lang = languageOf(path, table);
    if (!lang || lang.kind !== 'programming') continue;
    seen.set(lang.name, (seen.get(lang.name) ?? 0) + 1);
    const applicable = byLanguage.get(lang.name);
    if (!applicable) continue;
    if (!options.includeTests && isTestPath(path)) {
      skippedTests++;
      continue;
    }
    if (text.length > maxBytes) {
      skippedBig++;
      continue;
    }

    let inFile = 0;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && inFile < MAX_PER_FILE; i++) {
      const line = lines[i] as string;
      if (line.length < 4 || line.length > MAX_LINE || COMMENT_START.test(line)) continue;
      for (const { rule, re } of applicable) {
        if (!re.test(line)) continue;
        let snippet = line.trim().slice(0, 200);
        if (options.secretRules) snippet = redactSecrets(snippet, options.secretRules);
        findings.push({ ruleId: rule.id, category: 'code', severity: rule.severity, file: path, line: i + 1, snippet, title: rule.title, fix: rule.fix });
        inFile++;
      }
    }
  }

  const analyzed: LanguageCoverage[] = [];
  const withoutRules: LanguageCoverage[] = [];
  for (const [language, count] of [...seen].sort((a, b) => b[1] - a[1])) {
    const n = byLanguage.get(language)?.length ?? 0;
    (n > 0 ? analyzed : withoutRules).push({ language, files: count, rules: n });
  }

  const notes: string[] = [];
  if (skippedTests > 0) notes.push(`${skippedTests} archivos de pruebas no se revisaron en busca de código inseguro.`);
  if (skippedBig > 0) notes.push(`${skippedBig} archivos de código se omitieron por ser muy grandes.`);
  if (withoutRules.length > 0) {
    notes.push(`Sin reglas de código inseguro para: ${withoutRules.map((l) => l.language).join(', ')}. Solo recibieron las revisiones universales.`);
  }
  return { findings, analyzed, withoutRules, notes };
}
