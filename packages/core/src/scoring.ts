import {
  CATEGORIES,
  SEVERITIES,
  type Category,
  type CategorySummary,
  type Finding,
  type Grade,
  type ScoreResult,
  type Severity,
} from './types';

/** Puntos que descuenta cada hallazgo según su gravedad (propuesta inicial, ver ADR 007). */
export const DEDUCTIONS: Readonly<Record<Severity, number>> = {
  critical: 25,
  high: 10,
  medium: 4,
  low: 1,
};

/** Máximo que una sola categoría puede descontar, para que no hunda sola la nota. */
export const DEFAULT_CATEGORY_CAP = 40;

export interface ScoreOptions {
  categoryCap?: number;
}

/** Convierte un puntaje de 0 a 100 en una nota de A a F. */
export function gradeFor(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function emptyBySeverity(): Record<Severity, number> {
  return Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
}

function emptyByCategory(): Record<Category, CategorySummary> {
  return Object.fromEntries(
    CATEGORIES.map((c) => [c, { count: 0, deduction: 0 }]),
  ) as Record<Category, CategorySummary>;
}

/**
 * Calcula la nota global. Se parte de 100, se descuenta por cada hallazgo y
 * cada categoría tiene un tope de descuento.
 */
export function computeScore(findings: readonly Finding[], options: ScoreOptions = {}): ScoreResult {
  const cap = options.categoryCap ?? DEFAULT_CATEGORY_CAP;
  const bySeverity = emptyBySeverity();
  const byCategory = emptyByCategory();

  for (const f of findings) {
    bySeverity[f.severity] += 1;
    const entry = byCategory[f.category];
    entry.count += 1;
    entry.deduction += DEDUCTIONS[f.severity];
  }

  let total = 0;
  for (const category of CATEGORIES) {
    const entry = byCategory[category];
    entry.deduction = Math.min(entry.deduction, cap);
    total += entry.deduction;
  }

  const score = Math.max(0, 100 - total);
  return { score, grade: gradeFor(score), bySeverity, byCategory };
}
