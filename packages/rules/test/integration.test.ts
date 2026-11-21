import { describe, expect, it } from 'vitest';
import { detectLanguages } from '../../core/src/index';
import { languages } from '../src/index';

describe('tabla real + detector', () => {
  it('detecta lenguajes modernos y antiguos con la tabla de rules', () => {
    const r = detectLanguages(
      [
        { path: 'src/app.ts', size: 100 },
        { path: 'legacy/NOMINA.CBL', size: 50 },
        { path: 'Dockerfile', size: 10 },
        { path: 'datos.xyz123', size: 5 },
      ],
      languages,
    );
    const names = r.languages.map((l) => l.name);
    expect(names).toContain('TypeScript');
    expect(names).toContain('COBOL');
    expect(r.other.files).toBe(1);
  });
});
