import { describe, expect, it } from 'vitest';
import { detectLanguages, languageOf, type LanguageDef } from '../src/index';

const table: LanguageDef[] = [
  { name: 'TypeScript', kind: 'programming', extensions: ['.ts', '.tsx'] },
  { name: 'Python', kind: 'programming', extensions: ['.py'] },
  { name: 'Docker', kind: 'config', extensions: [], filenames: ['Dockerfile'] },
  { name: 'COBOL', kind: 'programming', extensions: ['.cob'] },
];

describe('languageOf', () => {
  it('reconoce por extensión sin importar mayúsculas', () => {
    expect(languageOf('src/A.TS', table)?.name).toBe('TypeScript');
  });
  it('reconoce por nombre exacto', () => {
    expect(languageOf('app/Dockerfile', table)?.name).toBe('Docker');
  });
  it('no reconoce archivos ocultos ni sin extensión', () => {
    expect(languageOf('.env', table)).toBeUndefined();
    expect(languageOf('LICENSE', table)).toBeUndefined();
  });
});

describe('detectLanguages', () => {
  it('calcula porcentajes por bytes y ordena de mayor a menor', () => {
    const r = detectLanguages(
      [
        { path: 'a.ts', size: 300 },
        { path: 'b.py', size: 100 },
        { path: 'old/PAYROLL.COB', size: 100 },
      ],
      table,
    );
    expect(r.languages.map((l) => l.name)).toEqual(['TypeScript', 'COBOL', 'Python']);
    expect(r.languages[0]?.percent).toBe(60);
    expect(r.totalBytes).toBe(500);
  });

  it('agrupa los desconocidos como «otros» sin fallar', () => {
    const r = detectLanguages([{ path: 'x.zzz', size: 10 }, { path: 'y.ts', size: 10 }], table);
    expect(r.other).toEqual({ files: 1, bytes: 10, extensions: ['.zzz'] });
    expect(r.languages[0]?.percent).toBe(50);
  });

  it('omite carpetas de dependencias y compilación', () => {
    const r = detectLanguages(
      [{ path: 'node_modules/x/i.ts', size: 999 }, { path: 'a/dist/o.ts', size: 999 }, { path: 'a.ts', size: 1 }],
      table,
    );
    expect(r.ignoredFiles).toBe(2);
    expect(r.totalBytes).toBe(1);
  });

  it('maneja repos vacíos y archivos de 0 bytes', () => {
    expect(detectLanguages([], table)).toMatchObject({ languages: [], totalBytes: 0 });
    expect(detectLanguages([{ path: 'a.ts', size: 0 }], table).languages[0]?.percent).toBe(0);
  });
});
