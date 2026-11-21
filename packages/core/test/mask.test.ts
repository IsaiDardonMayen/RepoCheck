import { describe, expect, it } from 'vitest';
import { maskInLine, maskSecret } from '../src/mask';

describe('maskSecret', () => {
  it('conserva 4 caracteres de un secreto largo y mantiene la longitud', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    const masked = maskSecret(secret);
    expect(masked).toBe('AKIA' + '*'.repeat(16));
    expect(masked).toHaveLength(secret.length);
  });

  it('muestra menos caracteres en secretos cortos', () => {
    expect(maskSecret('abc123')).toBe('a*****');
    expect(maskSecret('abc')).toBe('***');
  });

  it('nunca muestra más de un cuarto del valor', () => {
    for (const len of [1, 3, 4, 7, 8, 12, 40]) {
      const masked = maskSecret('x'.repeat(len));
      const visible = masked.replace(/\*/g, '').length;
      expect(visible).toBeLessThanOrEqual(Math.floor(len / 4));
    }
  });

  it('maneja la cadena vacía', () => {
    expect(maskSecret('')).toBe('');
  });
});

describe('maskInLine', () => {
  it('reemplaza todas las apariciones', () => {
    const secret = 'ghp_abcdefghijklmnop';
    const line = `token=${secret}; backup=${secret}`;
    const out = maskInLine(line, secret);
    expect(out).not.toContain(secret);
    expect(out.startsWith('token=ghp_')).toBe(true);
  });

  it('ignora secretos vacíos', () => {
    expect(maskInLine('hola', '')).toBe('hola');
  });
});
