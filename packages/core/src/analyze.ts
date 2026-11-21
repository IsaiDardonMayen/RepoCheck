import { checkCode, type CodeRule, type CodeScan } from './code';
import { checkConfigFiles } from './config-files';
import { extractDependencies } from './dependencies';
import { checkHygiene } from './hygiene';
import { detectLanguages, type FileInfo, type LanguageDef, type LanguageReport } from './languages';
import { checkVulnerabilities } from './osv';
import { computeScore } from './scoring';
import { detectSecrets, redactSecrets, type SecretRule } from './secrets';
import { SEVERITIES, type Finding, type ScoreResult } from './types';
import type { FetchLike } from './github';

export interface AnalyzeInput {
  /** Todos los archivos del repo (ruta y tamaño), aunque no se hayan descargado. */
  tree: readonly FileInfo[];
  /** Contenido de los archivos descargados (ruta → texto). */
  contents: ReadonlyMap<string, string>;
  languageTable: readonly LanguageDef[];
  secretRules: readonly SecretRule[];
  codeRules: readonly CodeRule[];
  /** Si se omite, no se consultan vulnerabilidades y el reporte lo indica. */
  fetchFn?: FetchLike;
  onProgress?: (stage: string) => void;
}

export interface AnalysisReport {
  score: ScoreResult;
  /** Hallazgos ordenados por gravedad, categoría, archivo y línea. */
  findings: Finding[];
  languages: LanguageReport;
  code: Pick<CodeScan, 'analyzed' | 'withoutRules'>;
  coverage: {
    filesInRepo: number;
    filesRead: number;
    dependenciesChecked: number;
    vulnerabilitiesChecked: boolean;
  };
  /** Hallazgos repetidos que se unieron en uno solo. */
  duplicatesRemoved: number;
  /** Límites y avisos que la persona debe conocer para interpretar la nota. */
  notes: string[];
}

const severityRank = (f: Finding): number => SEVERITIES.indexOf(f.severity);

/**
 * Une hallazgos repetidos. Si un secreto y otra regla señalan la misma línea del mismo archivo,
 * queda el del secreto; si son idénticos (misma regla, archivo, línea), queda uno.
 */
export function dedupeFindings(findings: readonly Finding[]): { findings: Finding[]; removed: number } {
  const secretLines = new Set<string>();
  for (const f of findings) {
    if (f.category === 'secrets' && f.line !== undefined) secretLines.add(`${f.file}:${f.line}`);
  }
  const seen = new Set<string>();
  const kept: Finding[] = [];
  for (const f of findings) {
    const lineKey = f.line === undefined ? undefined : `${f.file}:${f.line}`;
    if (f.category !== 'secrets' && lineKey !== undefined && secretLines.has(lineKey)) continue;
    const key = `${f.ruleId}|${f.file}|${f.line ?? ''}|${f.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(f);
  }
  return { findings: kept, removed: findings.length - kept.length };
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      severityRank(a) - severityRank(b) ||
      a.category.localeCompare(b.category) ||
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

/**
 * Ejecuta todas las revisiones y arma el reporte. Si una revisión de red falla, el resto
 * sigue y el reporte lo avisa: nunca se pierde el análisis completo por un servicio caído.
 */
export async function analyze(input: AnalyzeInput): Promise<AnalysisReport> {
  const { tree, contents, languageTable, secretRules, codeRules } = input;
  const progress = input.onProgress ?? ((): void => undefined);
  const notes: string[] = [];
  const all: Finding[] = [];

  progress('lenguajes');
  const languages = detectLanguages(tree, languageTable);

  progress('higiene');
  const hygiene = checkHygiene(tree);
  all.push(...hygiene.findings);
  notes.push(...hygiene.notes);

  progress('secretos');
  const secrets = detectSecrets(contents, secretRules);
  all.push(...secrets.findings);
  notes.push(...secrets.notes);

  progress('configuración');
  all.push(...checkConfigFiles(contents, { secretRules }).findings);

  progress('código');
  const code = checkCode(contents, languageTable, codeRules, { secretRules });
  all.push(...code.findings);
  notes.push(...code.notes);

  progress('dependencias');
  const deps = extractDependencies(contents);
  notes.push(...deps.notes);
  let vulnerabilitiesChecked = false;
  if (!input.fetchFn) {
    notes.push('No se consultaron vulnerabilidades de dependencias (sin conexión a OSV.dev).');
  } else if (deps.dependencies.length > 0) {
    try {
      const vulns = await checkVulnerabilities(input.fetchFn, deps.dependencies);
      all.push(...vulns.findings);
      notes.push(...vulns.notes);
      vulnerabilitiesChecked = true;
    } catch {
      notes.push('No se pudo consultar OSV.dev: la nota no incluye vulnerabilidades de dependencias.');
    }
  } else {
    vulnerabilitiesChecked = true;
  }

  // Última barrera de privacidad: ningún fragmento sale con un secreto completo.
  const safe = all.map((f) => (f.snippet === undefined ? f : { ...f, snippet: redactSecrets(f.snippet, secretRules) }));
  const deduped = dedupeFindings(safe);
  const findings = sortFindings(deduped.findings);

  return {
    score: computeScore(findings),
    findings,
    languages,
    code: { analyzed: code.analyzed, withoutRules: code.withoutRules },
    coverage: {
      filesInRepo: tree.length,
      filesRead: contents.size,
      dependenciesChecked: deps.dependencies.length,
      vulnerabilitiesChecked,
    },
    duplicatesRemoved: deduped.removed,
    notes: [...new Set(notes)],
  };
}
