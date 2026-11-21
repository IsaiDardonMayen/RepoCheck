import { describe, expect, it } from 'vitest';
import { badgeSvg, escapeHtml, toHtml, toJson, toMarkdown, computeScore, type AnalysisReport, type Finding } from '../src/index';

const findings: Finding[] = [
  { ruleId: 'SECRET-AWS', category: 'secrets', severity: 'critical', file: 'src/<x>.ts', line: 3, snippet: 'k="AKIA************"', title: 'Llave <b>AWS</b> | x', fix: 'Rota la llave.' },
];
const report: AnalysisReport = {
  score: computeScore(findings),
  findings,
  languages: { languages: [], other: { files: 0, bytes: 0, extensions: [] }, ignoredFiles: 0, totalBytes: 0 },
  code: { analyzed: [], withoutRules: [{ language: 'COBOL', files: 2, rules: 0 }] },
  coverage: { filesInRepo: 10, filesRead: 4, dependenciesChecked: 0, vulnerabilitiesChecked: true },
  duplicatesRemoved: 0,
  notes: ['nota <script>'],
};
const meta = { name: 'o/r', date: '2026-11-21' };

describe('exportadores', () => {
  it('JSON válido con la nota', () => {
    const j = JSON.parse(toJson(report, meta)) as { score: { grade: string }; source: string };
    expect(j.source).toBe('o/r');
    expect(j.score.grade).toBe('C');
  });
  it('Markdown con tabla y hallazgos, sin romper celdas', () => {
    const md = toMarkdown(report, meta);
    expect(md).toContain('**Nota: C (75/100)**');
    expect(md).toContain('Llave <b>AWS</b> \\| x');
    expect(md).toContain('Sin reglas de código para: COBOL');
  });
  it('HTML escapa todo y no trae scripts', () => {
    const h = toHtml(report, meta);
    expect(h).not.toContain('<script');
    expect(h).not.toContain('<b>AWS</b>');
    expect(h).toContain('&lt;b&gt;AWS&lt;/b&gt;');
    expect(h).toContain('src/&lt;x&gt;.ts:3');
  });
  it('insignia SVG con la nota', () => {
    const s = badgeSvg('A', 97);
    expect(s).toContain('A · 97');
    expect(s.startsWith('<svg')).toBe(true);
  });
  it('escapeHtml cubre comillas', () => expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'));
});
