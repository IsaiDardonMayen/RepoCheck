import type { Dependency } from './dependencies';
import type { FetchLike, FetchResponse } from './github';
import type { Finding, Severity } from './types';

const OSV = 'https://api.osv.dev/v1';

export class OsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OsvError';
  }
}

// ---------- CVSS v3 ----------

const AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const AC: Record<string, number> = { L: 0.77, H: 0.44 };
const UI: Record<string, number> = { N: 0.85, R: 0.62 };
const CIA: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };

function roundUp(x: number): number {
  const i = Math.round(x * 100000);
  return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10;
}

/** Puntaje base CVSS v3.x a partir del vector, o `undefined` si el vector no es v3 o está incompleto. */
export function cvss3Score(vector: string): number | undefined {
  if (!/^CVSS:3\.[01]\//.test(vector)) return undefined;
  const m = new Map<string, string>();
  for (const part of vector.split('/').slice(1)) {
    const [k, v] = part.split(':');
    if (k && v) m.set(k, v);
  }
  const scopeChanged = m.get('S') === 'C';
  if (m.get('S') !== 'U' && !scopeChanged) return undefined;
  const pr = m.get('PR');
  const prValue = pr === 'N' ? 0.85 : pr === 'L' ? (scopeChanged ? 0.68 : 0.62) : pr === 'H' ? (scopeChanged ? 0.5 : 0.27) : undefined;
  const av = AV[m.get('AV') ?? ''];
  const ac = AC[m.get('AC') ?? ''];
  const ui = UI[m.get('UI') ?? ''];
  const c = CIA[m.get('C') ?? ''];
  const i = CIA[m.get('I') ?? ''];
  const a = CIA[m.get('A') ?? ''];
  if ([av, ac, ui, c, i, a, prValue].some((x) => x === undefined)) return undefined;
  const iss = 1 - (1 - (c as number)) * (1 - (i as number)) * (1 - (a as number));
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  const exploit = 8.22 * (av as number) * (ac as number) * (prValue as number) * (ui as number);
  if (impact <= 0) return 0;
  return roundUp(Math.min((scopeChanged ? 1.08 : 1) * (impact + exploit), 10));
}

export function severityFromScore(score: number): Severity | undefined {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  if (score > 0) return 'low';
  return undefined;
}

// ---------- Detalle de una vulnerabilidad ----------

export interface OsvVuln {
  id: string;
  summary?: string;
  aliases?: string[];
  severity?: { type: string; score: string }[];
  database_specific?: { severity?: string };
  affected?: {
    package?: { name?: string; ecosystem?: string };
    ranges?: { type?: string; events?: Record<string, string>[] }[];
  }[];
}

/** Severidad: la etiqueta de la base de datos si existe; si no, CVSS v3; si no, «medium» (se avisa). */
export function severityOf(v: OsvVuln): { severity: Severity; known: boolean } {
  const label = v.database_specific?.severity?.toUpperCase();
  if (label === 'CRITICAL') return { severity: 'critical', known: true };
  if (label === 'HIGH') return { severity: 'high', known: true };
  if (label === 'MODERATE' || label === 'MEDIUM') return { severity: 'medium', known: true };
  if (label === 'LOW') return { severity: 'low', known: true };
  for (const s of v.severity ?? []) {
    const score = cvss3Score(s.score);
    const sev = score === undefined ? undefined : severityFromScore(score);
    if (sev) return { severity: sev, known: true };
  }
  return { severity: 'medium', known: false };
}

/**
 * Compara versiones numéricas con punto (`1.2.10` > `1.2.9`).
 * Una pre-versión (`1.0.0-beta`, `1.0.0rc1`) es menor que la versión final.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (s: string): { nums: number[]; pre: boolean } => {
    const m = /^([0-9]+(?:\.[0-9]+)*)(.*)$/.exec(s.trim().replace(/^v/, ''));
    const nums = (m?.[1] ?? '0').split('.').map((x) => parseInt(x, 10));
    const rest = m?.[2] ?? '';
    return { nums, pre: /^(-|\.?(a|b|rc|alpha|beta|dev|pre))/i.test(rest) };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (pa.pre !== pb.pre) return pa.pre ? -1 : 1;
  return 0;
}

const normName = (eco: string, name: string): string => (eco === 'PyPI' ? name.toLowerCase().replace(/[_.]/g, '-') : name);

/** La versión corregida más cercana por encima de la instalada, o la lista de las que existen. */
export function fixedVersionFor(v: OsvVuln, dep: Dependency): string | undefined {
  const fixed: string[] = [];
  for (const aff of v.affected ?? []) {
    if (!aff.package || aff.package.ecosystem !== dep.ecosystem) continue;
    if (normName(dep.ecosystem, aff.package.name ?? '') !== normName(dep.ecosystem, dep.name)) continue;
    for (const range of aff.ranges ?? []) {
      for (const ev of range.events ?? []) if (ev['fixed']) fixed.push(ev['fixed']);
    }
  }
  if (fixed.length === 0) return undefined;
  const above = fixed.filter((f) => compareVersions(f, dep.version) > 0).sort(compareVersions);
  return above[0] ?? [...new Set(fixed)].join(' o ');
}

// ---------- Cliente ----------

export interface VulnerabilityCheck {
  findings: Finding[];
  /** Dependencias consultadas. */
  checked: number;
  notes: string[];
}

export type OsvProgress = (stage: 'querying' | 'details', done: number, total: number) => void;

async function post(fetchFn: FetchLike, path: string, body: unknown): Promise<unknown> {
  let res: FetchResponse;
  try {
    res = await fetchFn(`${OSV}${path}`, { method: 'POST', body: JSON.stringify(body) });
  } catch {
    throw new OsvError('No se pudo conectar con OSV.dev. Revisa tu conexión.');
  }
  if (!res.ok) throw new OsvError(`OSV.dev respondió con el error ${res.status}.`);
  return res.json();
}

async function getVuln(fetchFn: FetchLike, id: string): Promise<OsvVuln | undefined> {
  let res: FetchResponse;
  try {
    res = await fetchFn(`${OSV}/vulns/${encodeURIComponent(id)}`);
  } catch {
    return undefined;
  }
  if (!res.ok) return undefined;
  const data = await res.json();
  return typeof data === 'object' && data !== null && typeof (data as OsvVuln).id === 'string' ? (data as OsvVuln) : undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * Consulta OSV.dev: una petición `querybatch` por cada 1000 dependencias y luego el detalle
 * de cada vulnerabilidad distinta (máximo `maxDetails`). Solo se envían nombre y versión.
 */
export async function checkVulnerabilities(
  fetchFn: FetchLike,
  dependencies: readonly Dependency[],
  options: { maxDetails?: number; concurrency?: number; onProgress?: OsvProgress } = {},
): Promise<VulnerabilityCheck> {
  const maxDetails = options.maxDetails ?? 300;
  const concurrency = options.concurrency ?? 6;
  const progress = options.onProgress ?? ((): void => undefined);
  const notes: string[] = [];

  const idsByDep: string[][] = [];
  const BATCH = 1000;
  for (let start = 0; start < dependencies.length; start += BATCH) {
    progress('querying', start, dependencies.length);
    const chunk = dependencies.slice(start, start + BATCH);
    const data = await post(fetchFn, '/querybatch', {
      queries: chunk.map((d) => ({ package: { name: d.name, ecosystem: d.ecosystem }, version: d.version })),
    });
    const results = isRecord(data) && Array.isArray(data['results']) ? (data['results'] as unknown[]) : undefined;
    if (!results || results.length !== chunk.length) throw new OsvError('Respuesta inesperada de OSV.dev.');
    for (const r of results) {
      const vulns = isRecord(r) && Array.isArray(r['vulns']) ? (r['vulns'] as unknown[]) : [];
      idsByDep.push(vulns.filter(isRecord).map((x) => String(x['id'])));
      if (isRecord(r) && r['next_page_token']) {
        notes.push('Una dependencia tiene más de 1000 vulnerabilidades; solo se revisó la primera página.');
      }
    }
  }
  progress('querying', dependencies.length, dependencies.length);

  const unique = [...new Set(idsByDep.flat())];
  const toFetch = unique.slice(0, maxDetails);
  if (unique.length > maxDetails) {
    notes.push(`Se encontraron ${unique.length} vulnerabilidades distintas; solo se detallaron ${maxDetails}.`);
  }
  const details = new Map<string, OsvVuln>();
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < toFetch.length) {
      const id = toFetch[next++] as string;
      const v = await getVuln(fetchFn, id);
      if (v) details.set(id, v);
      progress('details', ++done, toFetch.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, toFetch.length) }, worker));
  const missing = toFetch.filter((id) => !details.has(id)).length;
  if (missing > 0) notes.push(`No se pudo obtener el detalle de ${missing} vulnerabilidades; se omitieron.`);

  const findings: Finding[] = [];
  let unknownSeverity = 0;
  dependencies.forEach((dep, i) => {
    const emitted = new Set<string>();
    for (const id of idsByDep[i] ?? []) {
      const v = details.get(id);
      if (!v) continue;
      const names = [v.id, ...(v.aliases ?? [])];
      if (names.some((n) => emitted.has(n))) continue; // la misma falla con otro identificador
      names.forEach((n) => emitted.add(n));
      const { severity, known } = severityOf(v);
      if (!known) unknownSeverity++;
      const fixed = fixedVersionFor(v, dep);
      const approx = dep.approximate ? ' (versión deducida de un rango)' : '';
      findings.push({
        ruleId: v.id,
        category: 'dependencies',
        severity,
        file: dep.file,
        title: `${dep.name}@${dep.version}${approx}: ${v.summary ?? 'vulnerabilidad conocida'}`,
        fix: fixed
          ? `Actualiza ${dep.name} a la versión ${fixed} o superior.`
          : `No hay una versión corregida publicada; evalúa reemplazar ${dep.name} o mitigar el riesgo.`,
      });
    }
  });
  if (unknownSeverity > 0) notes.push(`${unknownSeverity} vulnerabilidades no traen severidad; se marcaron como medias.`);

  return { findings, checked: dependencies.length, notes };
}
