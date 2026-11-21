import languagesData from '../languages.json';

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
