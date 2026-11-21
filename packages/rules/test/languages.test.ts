import { describe, expect, it } from 'vitest';
import { languages, languagesFile } from '../src/index';

describe('languages.json', () => {
  it('tiene versión y al menos 60 lenguajes', () => {
    expect(languagesFile.version).toBe(1);
    expect(languages.length).toBeGreaterThanOrEqual(60);
  });

  it('cada entrada es válida', () => {
    const kinds = new Set(['programming', 'markup', 'data', 'config', 'query']);
    for (const l of languages) {
      expect(l.name.trim().length, `nombre vacío`).toBeGreaterThan(0);
      expect(kinds.has(l.kind), `${l.name}: tipo inválido`).toBe(true);
      expect(l.extensions.length + (l.filenames?.length ?? 0), `${l.name}: sin extensiones ni nombres`).toBeGreaterThan(0);
      for (const ext of l.extensions) {
        expect(ext, `${l.name}: ${ext}`).toMatch(/^\.[a-z0-9+#_-]+$/);
      }
    }
  });

  it('los nombres de lenguaje no se repiten', () => {
    const names = languages.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('cada extensión y cada nombre de archivo apuntan a un solo lenguaje', () => {
    const seen = new Map<string, string>();
    for (const l of languages) {
      const keys = [...l.extensions, ...(l.filenames ?? [])];
      for (const key of keys) {
        const owner = seen.get(key);
        expect(owner, `${key} está en ${owner} y en ${l.name}`).toBeUndefined();
        seen.set(key, l.name);
      }
    }
  });

  it('incluye lenguajes antiguos', () => {
    const names = new Set(languages.map((l) => l.name));
    for (const old of ['COBOL', 'Fortran', 'Pascal', 'Perl', 'Visual Basic 6', 'Delphi', 'Ada']) {
      expect(names.has(old), `falta ${old}`).toBe(true);
    }
  });
});
