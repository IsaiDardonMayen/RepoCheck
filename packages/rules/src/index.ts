import languagesData from '../languages.json';
import secretsData from '../secrets.json';

export type LanguageKind = 'programming' | 'markup' | 'data' | 'config' | 'query';

export interface LanguageEntry {
  name: string;
  kind: LanguageKind;
  /** Extensiones en minúscula, con el punto inicial. */
  extensions: string[];
  /** Nombres de archivo exactos (sin ruta), por ejemplo `Dockerfile`. */
  filenames?: string[];
}

export interface LanguagesFile {
  version: number;
  description: string;
  languages: LanguageEntry[];
}

export const languagesFile = languagesData as LanguagesFile;
export const languages: readonly LanguageEntry[] = languagesFile.languages;


export interface SecretRuleEntry {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Expresión regular de JavaScript (sin barras ni banderas). */
  pattern: string;
  /** Banderas extra; siempre se agrega `g`. */
  flags?: string;
  /** Grupo de captura que contiene el valor secreto; 0 si se omite. */
  group?: number;
  /** Entropía mínima (Shannon, bits por carácter) que debe tener el valor. */
  minEntropy?: number;
  /** `true` si lo que coincide no es el secreto en sí y se muestra tal cual. */
  reveal?: boolean;
  /** Expresión que debe cumplir la línea siguiente para confirmar el hallazgo. */
  next?: string;
  fix: string;
}

export interface SecretsFile {
  version: number;
  description: string;
  rules: SecretRuleEntry[];
}

export const secretsFile = secretsData as SecretsFile;
export const secretRules: readonly SecretRuleEntry[] = secretsFile.rules;
