/** Gravedad de un hallazgo, de mayor a menor. */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** Categoría a la que pertenece un hallazgo. */
export type Category =
  | 'dependencies'
  | 'secrets'
  | 'hygiene'
  | 'config'
  | 'code'
  | 'licenses';

/** Nota global, de la mejor (A) a la peor (F). */
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'];

export const CATEGORIES: readonly Category[] = [
  'dependencies',
  'secrets',
  'hygiene',
  'config',
  'code',
  'licenses',
];

/**
 * Resultado de cualquier revisión. Todos los módulos devuelven esta misma
 * estructura, lo que permite filtrar, exportar y probar de forma uniforme.
 */
export interface Finding {
  /** Identificador estable de la regla, por ejemplo `SECRET-AWS-001`. */
  ruleId: string;
  category: Category;
  severity: Severity;
  /** Ruta del archivo dentro del repo o del zip. */
  file: string;
  /** Línea (empezando en 1), si aplica. */
  line?: number;
  /** Fragmento ya enmascarado. Nunca debe contener un secreto completo. */
  snippet?: string;
  title: string;
  /** Cómo arreglarlo. */
  fix: string;
}

export interface CategorySummary {
  count: number;
  /** Puntos descontados por la categoría, ya con el tope aplicado. */
  deduction: number;
}

export interface ScoreResult {
  /** De 0 a 100. */
  score: number;
  grade: Grade;
  bySeverity: Record<Severity, number>;
  byCategory: Record<Category, CategorySummary>;
}
