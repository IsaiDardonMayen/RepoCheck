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

const SEV_COLOR: Record<Severity, string> = { critical: '#e11d48', high: '#ea580c', medium: '#ca8a04', low: '#2563eb' };
const RING_COLOR: Record<string, string> = { A: '#4ade80', B: '#a3e635', C: '#facc15', D: '#fb923c', F: '#fb7185' };

/** Reporte en un solo archivo HTML moderno, sin scripts ni recursos externos, listo para imprimir como PDF. */
export function toHtml(report: AnalysisReport, meta: ExportMeta): string {
  const r = report;
  const e = escapeHtml;
  const ring = RING_COLOR[r.score.grade] ?? '#94a3b8';
  const circ = 2 * Math.PI * 52;
  const offset = (circ * (1 - r.score.score / 100)).toFixed(1);
  const total = SEVERITIES.reduce((a, s) => a + r.score.bySeverity[s], 0);
  const tiles = SEVERITIES.map(
    (s) => `<div class="tile" style="--c:${SEV_COLOR[s]}"><b>${r.score.bySeverity[s]}</b><span>${SEVERITY_LABEL[s]}</span></div>`,
  ).join('');
  const stack = SEVERITIES.map((s) => `<i style="width:${total ? (r.score.bySeverity[s] / total) * 100 : 0}%;background:${SEV_COLOR[s]}"></i>`).join('');
  const cats = CATEGORIES.map((c) => {
    const x = r.score.byCategory[c];
    return `<li><span>${CATEGORY_LABEL[c]}</span><div class="bar"><i style="width:${(x.deduction / 40) * 100}%"></i></div><em>${x.deduction} <small>(${x.count})</small></em></li>`;
  }).join('');
  const findings = r.findings
    .map(
      (f) =>
        `<article class="f" style="--c:${SEV_COLOR[f.severity]}"><header><span class="b">${SEVERITY_LABEL[f.severity]}</span><h3>${e(f.title)}</h3></header>` +
        `<p class="w">${e(f.file)}${f.line ? ':' + f.line : ''}<span> · ${CATEGORY_LABEL[f.category]} · ${e(f.ruleId)}</span></p>` +
        (f.snippet ? `<pre>${e(f.snippet)}</pre>` : '') +
        `<p><strong>Cómo arreglarlo.</strong> ${e(f.fix)}</p></article>`,
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
<style>
*{box-sizing:border-box}@page{margin:12mm}
body{margin:0;font:14px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;background:#f4f6fa;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.wrap{max-width:52rem;margin:0 auto;padding:0 1rem 2rem}
.cover{background:radial-gradient(600px 300px at 90% -20%,#7c9cff44,transparent 60%),radial-gradient(500px 300px at 0 0,#6ee7f933,transparent 60%),#080b12;color:#e7ecf5;padding:1.6rem 1.4rem;border-radius:16px;max-width:52rem;margin:1rem auto 1.2rem}
@media print{body{background:#fff}.cover{margin-top:0}}
.cover .in{display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap}
.brand{font-weight:700;color:#6ee7f9;letter-spacing:.02em;font-size:.85rem;text-transform:uppercase}
.cover h1{margin:.2rem 0;font-size:1.6rem;letter-spacing:-.02em;word-break:break-all}.cover p{margin:0;color:#93a0b5}
.ring{position:relative;width:132px;height:132px;flex:none}.ring svg{width:100%;height:100%}.ring circle{fill:none;stroke-width:8}
.ring .t{stroke:#1e2838}.ring .a{stroke:${ring};stroke-linecap:round}
.ring div{position:absolute;inset:0;display:grid;place-content:center;text-align:center}.ring b{font-size:2.8rem;line-height:1;color:${ring}}.ring span{color:#93a0b5;font-size:.85rem}
.card{background:#fff;border:1px solid #e1e6ef;border-radius:14px;padding:1rem 1.2rem;margin:.9rem 0;break-inside:avoid}.card.list{break-inside:auto}
h2{margin:0 0 .7rem;font-size:.75rem;text-transform:uppercase;letter-spacing:.1em;color:#4b5a70}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:.6rem}.tile{border:1px solid color-mix(in srgb,var(--c) 40%,#fff);background:color-mix(in srgb,var(--c) 8%,#fff);border-radius:10px;text-align:center;padding:.5rem}
.tile b{display:block;font-size:1.6rem;color:var(--c);line-height:1.1}.tile span{font-size:.78rem;color:#4b5a70}
.stack{display:flex;height:8px;border-radius:99px;overflow:hidden;background:#e1e6ef;margin-top:.8rem;gap:2px}.stack i{display:block}
ul{margin:0;padding:0;list-style:none}.cats li{display:grid;grid-template-columns:8rem 1fr 4rem;gap:.7rem;align-items:center;margin:.35rem 0}
.bar{height:8px;border-radius:99px;background:#e1e6ef;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,#0e7490,#4338ca);border-radius:99px}
.cats em{text-align:right;font-style:normal;font-weight:600}.cats small{color:#4b5a70;font-weight:400}
.f{border:1px solid #e1e6ef;border-left:4px solid var(--c);border-radius:10px;padding:.6rem .9rem;margin:.55rem 0;break-inside:avoid;background:#fbfcfe}
.f header{display:flex;gap:.6rem;align-items:center}.f h3{margin:0;font-size:.98rem}
.b{font-size:.7rem;font-weight:700;color:var(--c);background:color-mix(in srgb,var(--c) 12%,#fff);border-radius:99px;padding:.1rem .55rem}
.w{margin:.25rem 0;font:12px ui-monospace,Menlo,Consolas,monospace;color:#2b3a52;word-break:break-all}.w span{font-family:inherit;color:#64748b}
pre{margin:.4rem 0;background:#0f172a;color:#e2e8f0;padding:.5rem .7rem;border-radius:8px;white-space:pre-wrap;word-break:break-all;font:12px ui-monospace,Menlo,Consolas,monospace}
.cov li{margin:.25rem 0;padding-left:1rem;position:relative}.cov li:before{content:"";position:absolute;left:0;top:.6em;width:5px;height:5px;border-radius:50%;background:#4338ca}
.foot{color:#64748b;font-size:.8rem;text-align:center;margin-top:1.2rem}
</style></head><body>
<div class="cover"><div class="in">
<div class="ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="t" cx="60" cy="60" r="52"/><circle class="a" cx="60" cy="60" r="52" transform="rotate(-90 60 60)" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset}"/></svg><div><b>${r.score.grade}</b><span>${r.score.score}/100</span></div></div>
<div><div class="brand">RepoCheck · Reporte de seguridad e higiene</div><h1>${e(meta.name)}</h1><p>${e(meta.date)}</p></div>
</div></div>
<div class="wrap">
<section class="card"><h2>Gravedad</h2><div class="tiles">${tiles}</div><div class="stack">${stack}</div></section>
<section class="card"><h2>Por categoría · puntos descontados</h2><ul class="cats">${cats}</ul></section>
<section class="card list"><h2>Hallazgos (${r.findings.length})</h2>${findings || '<p>No se encontraron hallazgos con las reglas actuales.</p>'}</section>
<section class="card"><h2>Qué se revisó y qué no</h2><ul class="cov">${notes}</ul></section>
<p class="foot">Reglas heurísticas: pueden pasar por alto problemas y marcar falsos positivos. No reemplazan una auditoría. Generado con RepoCheck.</p>
</div></body></html>`;
}
