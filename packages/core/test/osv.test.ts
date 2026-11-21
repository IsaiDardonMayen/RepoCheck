import { describe, expect, it } from 'vitest';
import {
  checkVulnerabilities, compareVersions, cvss3Score, fixedVersionFor, OsvError, severityOf,
  type Dependency, type FetchLike, type FetchResponse, type OsvVuln,
} from '../src/index';

const ok = (v: unknown): FetchResponse => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => v });
const bad = (status: number): FetchResponse => ({ ok: false, status, headers: { get: () => null }, json: async () => ({}) });

describe('cvss3Score', () => {
  it('coincide con los puntajes publicados', () => {
    expect(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L')).toBe(5.3);
    expect(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
    expect(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H')).toBe(10);
    expect(cvss3Score('CVSS:3.0/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N')).toBe(1.8);
    expect(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N')).toBe(0);
  });
  it('devuelve undefined para v4 o vectores incompletos', () => {
    expect(cvss3Score('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N')).toBeUndefined();
    expect(cvss3Score('CVSS:3.1/AV:N')).toBeUndefined();
  });
});

describe('severityOf', () => {
  it('usa la etiqueta de la base de datos primero', () => {
    expect(severityOf({ id: 'x', database_specific: { severity: 'MODERATE' } })).toEqual({ severity: 'medium', known: true });
    expect(severityOf({ id: 'x', database_specific: { severity: 'CRITICAL' } }).severity).toBe('critical');
  });
  it('calcula con CVSS v3 si no hay etiqueta, y marca desconocida si no hay nada', () => {
    expect(severityOf({ id: 'x', severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] })).toEqual({ severity: 'critical', known: true });
    expect(severityOf({ id: 'x' })).toEqual({ severity: 'medium', known: false });
  });
});

describe('compareVersions', () => {
  it('compara numéricamente y trata las pre-versiones como menores', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1);
    expect(compareVersions('2.2', '2.2.0')).toBe(0);
    expect(compareVersions('3.0rc1', '3.0')).toBe(-1);
  });
});

describe('fixedVersionFor', () => {
  const dep: Dependency = { ecosystem: 'npm', name: 'lodash', version: '4.17.15', file: 'package-lock.json' };
  const vuln = (fixed: string[]): OsvVuln => ({
    id: 'V', affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ events: [{ introduced: '0' }, ...fixed.map((f) => ({ fixed: f }))] }] }],
  });
  it('elige la corrección más cercana por encima de la versión instalada', () => {
    expect(fixedVersionFor(vuln(['4.17.21', '4.17.19', '3.0.0']), dep)).toBe('4.17.19');
  });
  it('ignora paquetes de otro nombre o ecosistema y avisa si no hay corrección', () => {
    expect(fixedVersionFor({ id: 'V', affected: [{ package: { name: 'otro', ecosystem: 'npm' }, ranges: [{ events: [{ fixed: '9.9.9' }] }] }] }, dep)).toBeUndefined();
    expect(fixedVersionFor(vuln([]), dep)).toBeUndefined();
  });
});

describe('checkVulnerabilities', () => {
  const deps: Dependency[] = [
    { ecosystem: 'npm', name: 'lodash', version: '4.17.15', file: 'package-lock.json' },
    { ecosystem: 'npm', name: 'limpio', version: '1.0.0', file: 'package-lock.json', approximate: true },
  ];
  const detail = (id: string, extra: Partial<OsvVuln> = {}): OsvVuln => ({
    id, summary: `resumen ${id}`, database_specific: { severity: 'HIGH' },
    affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ events: [{ fixed: '4.17.21' }] }] }], ...extra,
  });

  it('hace una consulta por lote, consulta cada detalle una vez y arma los hallazgos', async () => {
    const calls: string[] = [];
    const f: FetchLike = async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.osv.dev/v1', '')}`);
      if (url.endsWith('/querybatch')) return ok({ results: [{ vulns: [{ id: 'GHSA-1' }, { id: 'GHSA-2' }] }, {}] });
      return ok(detail(url.split('/').pop() as string));
    };
    const r = await checkVulnerabilities(f, deps);
    expect(calls.filter((c) => c.includes('querybatch'))).toHaveLength(1);
    expect(calls).toContain('GET /vulns/GHSA-1');
    expect(r.checked).toBe(2);
    expect(r.findings).toHaveLength(2);
    expect(r.findings[0]).toMatchObject({ ruleId: 'GHSA-1', category: 'dependencies', severity: 'high', file: 'package-lock.json' });
    expect(r.findings[0]?.fix).toBe('Actualiza lodash a la versión 4.17.21 o superior.');
    expect(r.findings[0]?.title).toContain('lodash@4.17.15');
  });

  it('une los identificadores de la misma falla (alias)', async () => {
    const f: FetchLike = async (url) => {
      if (url.endsWith('/querybatch')) return ok({ results: [{ vulns: [{ id: 'GHSA-1' }, { id: 'CVE-1' }] }, {}] });
      const id = url.split('/').pop() as string;
      return ok(detail(id, { aliases: id === 'GHSA-1' ? ['CVE-1'] : ['GHSA-1'] }));
    };
    expect((await checkVulnerabilities(f, deps)).findings).toHaveLength(1);
  });

  it('marca las versiones deducidas de un rango y avisa si falta severidad', async () => {
    const f: FetchLike = async (url) => {
      if (url.endsWith('/querybatch')) return ok({ results: [{}, { vulns: [{ id: 'X-1' }] }] });
      return ok({ id: 'X-1' });
    };
    const r = await checkVulnerabilities(f, deps);
    expect(r.findings[0]?.title).toContain('versión deducida de un rango');
    expect(r.findings[0]?.fix).toMatch(/No hay una versión corregida/);
    expect(r.notes.join(' ')).toMatch(/no traen severidad/);
  });

  it('divide en lotes de 1000 y respeta el máximo de detalles', async () => {
    const many: Dependency[] = Array.from({ length: 1500 }, (_, i) => ({ ecosystem: 'npm', name: `p${i}`, version: '1.0.0', file: 'l' }));
    let batches = 0;
    const f: FetchLike = async (url, init) => {
      if (url.endsWith('/querybatch')) {
        batches++;
        const n = (JSON.parse(init?.body ?? '{}') as { queries: unknown[] }).queries.length;
        return ok({ results: Array.from({ length: n }, (_, i) => ({ vulns: [{ id: `V-${batches}-${i}` }] })) });
      }
      return ok(detail(url.split('/').pop() as string));
    };
    const r = await checkVulnerabilities(f, many, { maxDetails: 10 });
    expect(batches).toBe(2);
    expect(r.notes.join(' ')).toMatch(/solo se detallaron 10/);
  });

  it('falla con un error claro si OSV no responde, y no se cae si falta un detalle', async () => {
    await expect(checkVulnerabilities(async () => bad(500), deps)).rejects.toBeInstanceOf(OsvError);
    await expect(checkVulnerabilities(async () => { throw new Error('x'); }, deps)).rejects.toThrow(/conectar/);
    const f: FetchLike = async (url) => (url.endsWith('/querybatch') ? ok({ results: [{ vulns: [{ id: 'A' }] }, {}] }) : bad(404));
    const r = await checkVulnerabilities(f, deps);
    expect(r.findings).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/No se pudo obtener el detalle de 1/);
  });

  it('rechaza una respuesta con la cantidad de resultados equivocada', async () => {
    await expect(checkVulnerabilities(async () => ok({ results: [] }), deps)).rejects.toThrow(/inesperada/);
  });
});
