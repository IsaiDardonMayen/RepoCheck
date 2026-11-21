import { describe, expect, it } from 'vitest';
import { computeScore, DEFAULT_CATEGORY_CAP, DEDUCTIONS, gradeFor } from '../src/scoring';
import type { Category, Finding, Severity } from '../src/types';

function finding(severity: Severity, category: Category = 'hygiene'): Finding {
  return {
    ruleId: 'TEST-001',
    category,
    severity,
    file: 'a.txt',
    title: 'Hallazgo de prueba',
    fix: 'Arreglarlo',
  };
}

describe('gradeFor', () => {
  it.each([
    [100, 'A'],
    [90, 'A'],
    [89, 'B'],
    [80, 'B'],
    [79, 'C'],
    [70, 'C'],
    [69, 'D'],
    [60, 'D'],
    [59, 'F'],
    [0, 'F'],
  ] as const)('puntaje %i da nota %s', (score, grade) => {
    expect(gradeFor(score)).toBe(grade);
  });
});

describe('computeScore', () => {
  it('sin hallazgos da 100 y nota A', () => {
    const r = computeScore([]);
    expect(r.score).toBe(100);
    expect(r.grade).toBe('A');
    expect(r.bySeverity).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });

  it('descuenta según la gravedad', () => {
    const r = computeScore([finding('critical', 'secrets'), finding('low', 'hygiene')]);
    expect(r.score).toBe(100 - DEDUCTIONS.critical - DEDUCTIONS.low);
    expect(r.bySeverity.critical).toBe(1);
    expect(r.bySeverity.low).toBe(1);
    expect(r.byCategory.secrets.count).toBe(1);
  });

  it('aplica el tope por categoría', () => {
    const many = Array.from({ length: 10 }, () => finding('critical', 'secrets'));
    const r = computeScore(many);
    expect(r.byCategory.secrets.count).toBe(10);
    expect(r.byCategory.secrets.deduction).toBe(DEFAULT_CATEGORY_CAP);
    expect(r.score).toBe(100 - DEFAULT_CATEGORY_CAP);
  });

  it('suma varias categorías y nunca baja de 0', () => {
    const cats: Category[] = ['dependencies', 'secrets', 'hygiene', 'config', 'code', 'licenses'];
    const all = cats.flatMap((c) => Array.from({ length: 5 }, () => finding('critical', c)));
    const r = computeScore(all);
    expect(r.score).toBe(0);
    expect(r.grade).toBe('F');
  });

  it('permite cambiar el tope', () => {
    const r = computeScore([finding('critical'), finding('critical')], { categoryCap: 30 });
    expect(r.byCategory.hygiene.deduction).toBe(30);
  });
});
