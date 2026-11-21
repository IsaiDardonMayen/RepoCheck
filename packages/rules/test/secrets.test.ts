import { describe, expect, it } from 'vitest';
import { detectSecrets } from '../../core/src/index';
import { secretRules } from '../src/index';

function rnd(length: number, alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', seed = 11): string {
  let a = seed >>> 0;
  let out = '';
  for (let i = 0; i < length; i++) {
    a = (a + 0x6d2b79f5) >>> 0; // mulberry32
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out += alphabet[((t ^ (t >>> 14)) >>> 0) % alphabet.length];
  }
  return out;
}
const HEX = '0123456789abcdef';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URLSAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const UP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Los valores se arman por partes para que ningún archivo del repo contenga una credencial completa.
const fixtures: Record<string, string> = {
  'SECRET-AWS-ACCESS-KEY': `id = "${'AK' + 'IA'}${rnd(16, UP)}"`,
  'SECRET-AWS-SECRET-KEY': `aws_secret_access_key = "${rnd(40, B64)}"`,
  'SECRET-GITHUB-PAT': `t = "${'gh' + 'p_'}${rnd(36)}"`,
  'SECRET-GITHUB-FINE-PAT': `t = "${'github' + '_pat_'}${rnd(22)}_${rnd(59, undefined, 8)}"`,
  'SECRET-GITHUB-OAUTH': `t = "${'gh' + 'o_'}${rnd(36)}"`,
  'SECRET-GITLAB-PAT': `t = "${'gl' + 'pat-'}${rnd(20, URLSAFE)}"`,
  'SECRET-SLACK-TOKEN': `t = "${'xo' + 'xb-'}1234567890-${rnd(24)}"`,
  'SECRET-SLACK-WEBHOOK': `u = "https://hooks.${'slack'}.com/services/T${rnd(9, UP)}/B${rnd(9, UP, 3)}/${rnd(24)}"`,
  'SECRET-GOOGLE-API-KEY': `k = "${'AI' + 'za'}${rnd(35, URLSAFE)}"`,
  'SECRET-STRIPE-LIVE': `k = "${'sk_' + 'live_'}${rnd(24)}"`,
  'SECRET-TWILIO-KEY': `k = "${'S' + 'K'}${rnd(32, HEX)}"`,
  'SECRET-SENDGRID': `k = "${'S' + 'G.'}${rnd(22, URLSAFE)}.${rnd(43, URLSAFE, 5)}"`,
  'SECRET-MAILGUN': `k = "${'key' + '-'}${rnd(32)}"`,
  'SECRET-NPM-TOKEN': `k = "${'npm' + '_'}${rnd(36)}"`,
  'SECRET-PYPI-TOKEN': `k = "${'pypi-' + 'AgEIcHlwaS5vcmc'}${rnd(60, URLSAFE)}"`,
  'SECRET-SHOPIFY': `k = "${'shp' + 'at_'}${rnd(32, HEX)}"`,
  'SECRET-DIGITALOCEAN': `k = "${'dop' + '_v1_'}${rnd(64, HEX)}"`,
  'SECRET-DISCORD-BOT': `k = "M${rnd(23)}.${rnd(6)}.${rnd(27, URLSAFE)}"`,
  'SECRET-TELEGRAM-BOT': `k = "123456789:${'AA'}${rnd(33, URLSAFE)}"`,
  'SECRET-ANTHROPIC': `k = "${'sk-' + 'ant-'}${rnd(40, URLSAFE)}"`,
  'SECRET-OPENAI': `k = "${'sk' + '-'}${rnd(48)}"`,
  'SECRET-AZURE-STORAGE': `c = "DefaultEndpointsProtocol=https;AccountName=demo;AccountKey=${rnd(86, B64)}=="`,
  'SECRET-PRIVATE-KEY': `${'-----BEGIN '}${'RSA PRIVATE KEY-----'}\n${rnd(64, B64)}`,
  'SECRET-JWT': `t = "${'ey' + 'J'}${rnd(20, URLSAFE)}.${'ey' + 'J'}${rnd(20, URLSAFE, 2)}.${rnd(20, URLSAFE, 4)}"`,
  'SECRET-URL-CREDENTIALS': `db = "postgres://app_user:${rnd(14)}@db.internal:5432/app"`,
  'SECRET-GENERIC-ASSIGNMENT': `const password = "${rnd(16)}";`,
  'SECRET-ENV-ASSIGNMENT': `DB_PASSWORD=${rnd(16)}`,
  'SECRET-HIGH-ENTROPY': `const x = "${rnd(44)}";`,
};

describe('reglas de secretos', () => {
  it('hay 20 o más, con identificadores únicos y expresiones válidas', () => {
    expect(secretRules.length).toBeGreaterThanOrEqual(20);
    expect(new Set(secretRules.map((r) => r.id)).size).toBe(secretRules.length);
    for (const r of secretRules) {
      expect(() => new RegExp(r.pattern, `${r.flags ?? ''}g`), r.id).not.toThrow();
      expect(['critical', 'high', 'medium', 'low']).toContain(r.severity);
      expect(r.fix.length).toBeGreaterThan(10);
    }
  });

  it('cada regla tiene su caso de prueba', () => {
    expect(Object.keys(fixtures).sort()).toEqual(secretRules.map((r) => r.id).sort());
  });

  it.each(Object.entries(fixtures))('%s se detecta y se enmascara', (id, line) => {
    const r = detectSecrets(new Map([['app.ts', line]]), secretRules);
    expect(r.findings.map((f) => f.ruleId), line).toContain(id);
    expect(r.findings[0]?.ruleId).toBe(id);
    expect(r.findings.every((f) => f.category === 'secrets')).toBe(true);
    // El valor completo no puede aparecer en el fragmento.
    const secret = /[A-Za-z0-9_+/=.-]{20,}/.exec(line.replace(/^.*?[=:]\s*/, ''))?.[0];
    if (id !== 'SECRET-PRIVATE-KEY' && secret) expect(r.findings[0]?.snippet).not.toContain(secret);
  });

  it('detecta la llave secreta de AWS en sus variantes de nombre habituales', () => {
    const v = rnd(40, B64);
    for (const linea of [`AWS_SECRET_ACCESS_KEY=${v}`, `aws_secret_access_key = "${v}"`, `"AWSSecretKey": "${v}"`, `aws_secret_key: ${v}`]) {
      const r = detectSecrets(new Map([['c.txt', linea]]), secretRules);
      expect(r.findings.map((f) => f.ruleId), linea).toContain('SECRET-AWS-SECRET-KEY');
    }
  });

  it('la regla de Anthropic gana sobre la de OpenAI para la misma llave', () => {
    const r = detectSecrets(new Map([['a.ts', fixtures['SECRET-ANTHROPIC'] as string]]), secretRules);
    expect(r.findings.map((f) => f.ruleId)).toEqual(['SECRET-ANTHROPIC']);
  });

  it('no da falsos positivos en código común', () => {
    const limpio = [
      'const password = process.env.DB_PASSWORD;',
      'const apiKey = "<tu-llave-aqui>";',
      'password: "${DB_PASSWORD}"',
      'API_KEY=your_api_key_here',
      'const commit = "3f786850e387550fdab836ed7e6dc881de23001b";',
      'const url = "https://github.com/octocat/Hello-World";',
      'import { useState } from "react";',
      'integrity: "sha512-' + rnd(20) + '"',
      '// ' + 'a'.repeat(60),
    ].join('\n');
    expect(detectSecrets(new Map([['app.ts', limpio]]), secretRules).findings).toEqual([]);
  });

  it('un encabezado de llave privada sin cuerpo (documentación, pruebas) no es un hallazgo', () => {
    const solo = `const re = /${'-----BEGIN '}PRIVATE KEY-----/;\nconsole.log(re);`;
    expect(detectSecrets(new Map([['a.ts', solo]]), secretRules).findings).toEqual([]);
    const sinCuerpo = `${'-----BEGIN '}PRIVATE KEY-----\nimport x from 'y';`;
    expect(detectSecrets(new Map([['a.ts', sinCuerpo]]), secretRules).findings).toEqual([]);
  });

  it('código que lee una variable de entorno o referencia una configuración no es un secreto', () => {
    const codigo = [
      "ACCESS_KEY = os.environ.get('AWS_ACCESS_KEY')",
      'SECRET_KEY = os.getenv("SECRET_KEY_DE_LA_APP")',
      'SECRET_KEY = settings.SECRET_KEY_VALUE',
      'API_TOKEN = process.env.API_TOKEN_VALUE',
      'DB_PASSWORD = config.get("db_password_value")',
    ].join('\n');
    expect(detectSecrets(new Map([['app.py', codigo]]), secretRules).findings).toEqual([]);
  });

  it('los tokens con puntos (JWT, SendGrid) siguen detectándose y no se confunden con referencias de código', () => {
    for (const id of ['SECRET-JWT', 'SECRET-SENDGRID']) {
      const r = detectSecrets(new Map([['a.ts', fixtures[id] as string]]), secretRules);
      expect(r.findings.map((f) => f.ruleId), id).toEqual([id]);
    }
  });

  it('un alfabeto no es un secreto', () => {
    expect(detectSecrets(new Map([['a.ts', "const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';"]]), secretRules).findings).toEqual([]);
  });

  it('resiste entradas patológicas', () => {
    const t0 = Date.now();
    const bad = ['"' + 'A'.repeat(200_000), 'password=' + '"'.repeat(50_000), '://' + 'a:'.repeat(50_000), 'eyJ' + 'a'.repeat(100_000)].join('\n');
    detectSecrets(new Map([['x.txt', bad]]), secretRules);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
