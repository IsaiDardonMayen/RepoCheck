import type { AnalysisReport } from './analyze';
import { CATEGORIES, SEVERITIES, type Category, type Severity } from './types';

export interface ExportMeta {
  /** Nombre del repo o zip analizado. */
  name: string;
  /** Fecha del análisis (ISO); se pasa desde afuera para que el núcleo sea determinista. */
  date: string;
}

export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo' };
export const CATEGORY_LABEL: Readonly<Record<Category, string>> = {
  dependencies: 'Dependencias',
  secrets: 'Secretos',
  hygiene: 'Higiene',
  config: 'Configuración',
  code: 'Código',
  licenses: 'Licencia',
};

/** Escapa texto para usarlo dentro de HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Reporte completo en JSON (los fragmentos ya vienen enmascarados). */
export function toJson(report: AnalysisReport, meta: ExportMeta): string {
  return JSON.stringify({ tool: 'RepoCheck', source: meta.name, date: meta.date, ...report }, null, 2);
}

const mdCell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function toMarkdown(report: AnalysisReport, meta: ExportMeta): string {
  const r = report;
  const out: string[] = [
    `# Reporte RepoCheck: ${mdCell(meta.name)}`,
    '',
    `Fecha: ${meta.date}`,
    '',
    `**Nota: ${r.score.grade} (${r.score.score}/100)**`,
    '',
    SEVERITIES.map((s) => `${r.score.bySeverity[s]} ${SEVERITY_LABEL[s].toLowerCase()}`).join(' · '),
    '',
    '## Por categoría',
    '',
    '| Categoría | Hallazgos | Puntos descontados |',
    '|---|---:|---:|',
    ...CATEGORIES.map((c) => `| ${CATEGORY_LABEL[c]} | ${r.score.byCategory[c].count} | ${r.score.byCategory[c].deduction} |`),
    '',
    '## Hallazgos',
    '',
  ];
  if (r.findings.length === 0) out.push('No se encontraron hallazgos con las reglas actuales.', '');
  for (const f of r.findings) {
    out.push(`### [${SEVERITY_LABEL[f.severity]}] ${mdCell(f.title)}`, '', `- Archivo: \`${f.file}${f.line ? `:${f.line}` : ''}\``, `- Categoría: ${CATEGORY_LABEL[f.category]} · Regla: ${f.ruleId}`);
    if (f.snippet) out.push('- Fragmento:', '', '  ```', `  ${f.snippet.replace(/\r?\n/g, ' ')}`, '  ```');
    out.push(`- Cómo arreglarlo: ${f.fix}`, '');
  }
  out.push('## Qué se revisó y qué no', '', `- ${r.coverage.filesInRepo} archivos en el repositorio; se leyeron ${r.coverage.filesRead}.`);
  out.push(`- ${r.coverage.dependenciesChecked} dependencias ${r.coverage.vulnerabilitiesChecked ? 'consultadas en OSV.dev' : 'sin consultar'}.`);
  if (r.code.withoutRules.length) out.push(`- Sin reglas de código para: ${r.code.withoutRules.map((l) => l.language).join(', ')}.`);
  for (const n of r.notes) out.push(`- ${n}`);
  out.push('', '_RepoCheck usa reglas heurísticas: puede pasar por alto problemas y marcar falsos positivos. No reemplaza una auditoría._', '');
  return out.join('\n');
}

const GRADE_COLOR: Record<string, string> = { A: '#2ea44f', B: '#7cb518', C: '#d4a017', D: '#e07b00', F: '#d1242f' };

/** Insignia en SVG (estilo plano) con la nota. Sin dependencias ni red. */
export function badgeSvg(grade: string, score: number): string {
  const label = 'RepoCheck';
  const value = `${grade} · ${score}`;
  const lw = 78;
  const vw = 14 + value.length * 7;
  const color = GRADE_COLOR[grade] ?? '#6e7781';
  const w = lw + vw;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${escapeHtml(label)}: ${escapeHtml(value)}">` +
    `<rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/>` +
    `<g fill="#fff" font-family="Verdana,Geneva,sans-serif" font-size="11" text-anchor="middle">` +
    `<text x="${lw / 2}" y="14">${label}</text><text x="${lw + vw / 2}" y="14" font-weight="bold">${escapeHtml(value)}</text></g></svg>`
  );
}

/** Reporte en un solo archivo HTML, sin scripts ni recursos externos, listo para imprimir como PDF. */
export function toHtml(report: AnalysisReport, meta: ExportMeta): string {
  const r = report;
  const e = escapeHtml;
  const rows = CATEGORIES.map((c) => `<tr><th scope="row">${CATEGORY_LABEL[c]}</th><td>${r.score.byCategory[c].count}</td><td>${r.score.byCategory[c].deduction}</td></tr>`).join('');
  const findings = r.findings
    .map(
      (f) =>
        `<article class="f ${f.severity}"><h3><span class="b">${SEVERITY_LABEL[f.severity]}</span> ${e(f.title)}</h3>` +
        `<p class="w">${e(f.file)}${f.line ? ':' + f.line : ''} · ${CATEGORY_LABEL[f.category]} · ${e(f.ruleId)}</p>` +
        (f.snippet ? `<pre>${e(f.snippet)}</pre>` : '') +
        `<p><strong>Cómo arreglarlo:</strong> ${e(f.fix)}</p></article>`,
    )
    .join('');
  const notes = [
    `${r.coverage.filesInRepo} archivos en el repositorio; se leyeron ${r.coverage.filesRead}.`,
    `${r.coverage.dependenciesChecked} dependencias ${r.coverage.vulnerabilitiesChecked ? 'consultadas en OSV.dev' : 'sin consultar'}.`,
    ...(r.code.withoutRules.length ? [`Sin reglas de código para: ${r.code.withoutRules.map((l) => l.language).join(', ')}.`] : []),
    ...r.notes,
  ]
    .map((n) => `<li>${e(n)}</li>`)
    .join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reporte RepoCheck: ${e(meta.name)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:50rem;margin:2rem auto;padding:0 1rem;color:#14181f}
.grade{display:inline-block;font-size:2.5rem;font-weight:800;padding:.2rem 1rem;border-radius:12px;background:${GRADE_COLOR[r.score.grade] ?? '#999'};color:#fff}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.3rem .5rem;border-bottom:1px solid #d5dae2}
.f{border:1px solid #d5dae2;border-left:6px solid #1d4ed8;border-radius:8px;padding:.5rem 1rem;margin:.6rem 0;break-inside:avoid}
.critical{border-left-color:#d1242f}.high{border-left-color:#e07b00}.medium{border-left-color:#d4a017}
.b{font-size:.8rem;background:#eef1f5;border-radius:99px;padding:0 .5rem}.w{color:#4a5565;font-size:.9rem;margin:.2rem 0;word-break:break-all}
pre{background:#f3f4f6;padding:.5rem;overflow:auto;white-space:pre-wrap;word-break:break-all}</style></head><body>
<h1>Reporte RepoCheck: ${e(meta.name)}</h1><p>Fecha: ${e(meta.date)}</p>
<p><span class="grade">${r.score.grade}</span> ${r.score.score}/100</p>
<p>${SEVERITIES.map((s) => `${r.score.bySeverity[s]} ${SEVERITY_LABEL[s].toLowerCase()}`).join(' · ')}</p>
<h2>Por categoría</h2><table><thead><tr><th>Categoría</th><th>Hallazgos</th><th>Puntos descontados</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Hallazgos</h2>${findings || '<p>No se encontraron hallazgos con las reglas actuales.</p>'}
<h2>Qué se revisó y qué no</h2><ul>${notes}</ul>
<p><em>RepoCheck usa reglas heurísticas: puede pasar por alto problemas y marcar falsos positivos. No reemplaza una auditoría.</em></p>
</body></html>`;
}
