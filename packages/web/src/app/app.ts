import { Component, computed, signal } from '@angular/core';
import {
  CATEGORIES,
  SEVERITIES,
  badgeSvg,
  scanRepoUrl,
  scanZip,
  type Category,
  type FetchLike,
  type Finding,
  type RuleSets,
  type ScanResult,
  type Severity,
  toHtml,
  toJson,
  toMarkdown,
} from '@repocheck/core';
import { codeRules, languages, secretRules } from '@repocheck/rules';

function readTheme(): 'auto' | 'dark' | 'light' {
  try {
    const t = localStorage.getItem('repocheck-theme');
    if (t === 'dark' || t === 'light') {
      document.documentElement.dataset['theme'] = t;
      return t;
    }
  } catch {
    /* sin almacenamiento: se usa el tema del sistema */
  }
  return 'auto';
}

const LANG_COLORS = ['#6ee7f9', '#7c9cff', '#b79cff', '#f0abfc', '#fda4af', '#fdba74', '#fde68a', '#86efac'];

const RULES: RuleSets = { languageTable: languages, secretRules, codeRules };
const browserFetch: FetchLike = (url, init) => fetch(url, init as RequestInit);

const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo' };
const CATEGORY_LABEL: Record<Category, string> = {
  dependencies: 'Dependencias',
  secrets: 'Secretos',
  hygiene: 'Higiene',
  config: 'Configuración',
  code: 'Código',
  licenses: 'Licencia',
};
const GRADE_TEXT: Record<string, string> = {
  A: 'Muy bien: no se encontró nada importante.',
  B: 'Bien: hay detalles menores por mejorar.',
  C: 'Regular: conviene corregir los hallazgos más graves.',
  D: 'Débil: hay varios problemas que corregir pronto.',
  F: 'Crítico: hay problemas serios; empieza por los de mayor gravedad.',
};

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  protected readonly severities = SEVERITIES;
  protected readonly categories = CATEGORIES;
  protected readonly severityLabel = SEVERITY_LABEL;
  protected readonly categoryLabel = CATEGORY_LABEL;

  protected readonly url = signal('');
  protected readonly running = signal(false);
  protected readonly progress = signal('');
  protected readonly error = signal('');
  protected readonly result = signal<ScanResult | undefined>(undefined);
  protected readonly dragging = signal(false);
  protected readonly mode = signal<'url' | 'zip'>('url');
  protected readonly theme = signal<'auto' | 'dark' | 'light'>(readTheme());
  protected readonly circumference = 2 * Math.PI * 52;

  protected readonly severityFilter = signal<Severity | ''>('');
  protected readonly categoryFilter = signal<Category | ''>('');
  protected readonly query = signal('');
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());

  protected readonly report = computed(() => this.result()?.report);
  protected readonly gradeText = computed(() => GRADE_TEXT[this.report()?.score.grade ?? 'A'] ?? '');
  protected readonly visible = computed<Finding[]>(() => {
    const r = this.report();
    if (!r) return [];
    const sev = this.severityFilter();
    const cat = this.categoryFilter();
    const q = this.query().trim().toLowerCase();
    return r.findings.filter(
      (f) =>
        (!sev || f.severity === sev) &&
        (!cat || f.category === cat) &&
        (!q || `${f.title} ${f.file} ${f.ruleId}`.toLowerCase().includes(q)),
    );
  });
  protected readonly languageSegments = computed(() => {
    const list = this.report()?.languages.languages ?? [];
    const top = list.slice(0, 7).map((l, i) => ({ name: l.name, percent: l.percent, color: LANG_COLORS[i % LANG_COLORS.length] ?? '#999' }));
    const rest = Math.round((list.slice(7).reduce((a, l) => a + l.percent, 0)) * 10) / 10;
    if (rest > 0) top.push({ name: 'Otros', percent: rest, color: '#64748b' });
    return top;
  });
  protected readonly severityShare = computed(() => {
    const r = this.report();
    const total = r ? SEVERITIES.reduce((a, s) => a + r.score.bySeverity[s], 0) : 0;
    return SEVERITIES.map((s) => ({ sev: s, count: r?.score.bySeverity[s] ?? 0, percent: total ? ((r?.score.bySeverity[s] ?? 0) / total) * 100 : 0 }));
  });
  protected readonly categoryRows = computed(() => {
    const r = this.report();
    return CATEGORIES.map((c) => ({ id: c, count: r?.score.byCategory[c].count ?? 0, deduction: r?.score.byCategory[c].deduction ?? 0 }));
  });

  protected setTheme(t: 'auto' | 'dark' | 'light'): void {
    this.theme.set(t);
    if (t === 'auto') delete document.documentElement.dataset['theme'];
    else document.documentElement.dataset['theme'] = t;
    try {
      if (t === 'auto') localStorage.removeItem('repocheck-theme');
      else localStorage.setItem('repocheck-theme', t);
    } catch {
      /* sin almacenamiento: el cambio vale solo para esta visita */
    }
  }

  protected countFor(sev: Severity): number {
    return this.report()?.score.bySeverity[sev] ?? 0;
  }

  protected toggleSeverity(sev: Severity): void {
    this.severityFilter.set(this.severityFilter() === sev ? '' : sev);
  }

  protected readonly badgeCopied = signal(false);

  private meta(): { name: string; date: string } {
    return { name: this.result()?.source.name ?? 'repo', date: new Date().toISOString().slice(0, 10) };
  }

  private fileBase(): string {
    return `repocheck-${this.meta().name.replace(/[^\w.-]+/g, '-')}`;
  }

  private save(content: string, ext: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.fileBase()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  protected download(kind: 'json' | 'md' | 'html' | 'svg'): void {
    const r = this.report();
    if (!r) return;
    const m = this.meta();
    if (kind === 'json') this.save(toJson(r, m), 'json', 'application/json');
    else if (kind === 'md') this.save(toMarkdown(r, m), 'md', 'text/markdown');
    else if (kind === 'html') this.save(toHtml(r, m), 'html', 'text/html');
    else this.save(badgeSvg(r.score.grade, r.score.score), 'svg', 'image/svg+xml');
  }

  /** PDF: se abre el reporte en un marco oculto y se usa «Guardar como PDF» del navegador. */
  protected printPdf(): void {
    const r = this.report();
    if (!r) return;
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
    frame.srcdoc = toHtml(r, this.meta());
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 60000);
    };
    document.body.appendChild(frame);
  }

  protected async copyBadge(): Promise<void> {
    const r = this.report();
    if (!r) return;
    const color = { A: 'brightgreen', B: 'green', C: 'yellow', D: 'orange', F: 'red' }[r.score.grade] ?? 'lightgrey';
    const md = `![RepoCheck](https://img.shields.io/badge/RepoCheck-${r.score.grade}%20${r.score.score}-${color})`;
    try {
      await navigator.clipboard.writeText(md);
      this.badgeCopied.set(true);
      setTimeout(() => this.badgeCopied.set(false), 3000);
    } catch {
      this.error.set('No se pudo copiar. Descarga la insignia en SVG.');
    }
  }

  protected async analyzeUrl(event: Event): Promise<void> {
    event.preventDefault();
    await this.run(() => scanRepoUrl(this.url(), browserFetch, RULES, (m) => this.progress.set(m)));
  }

  protected async onFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.analyzeFile(file);
  }

  protected async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) await this.analyzeFile(file);
  }

  protected over(event: DragEvent, on: boolean): void {
    event.preventDefault();
    this.dragging.set(on);
  }

  private async analyzeFile(file: File): Promise<void> {
    if (!/\.zip$/i.test(file.name)) {
      this.error.set('El archivo debe ser un .zip.');
      return;
    }
    await this.run(async () => scanZip(file.name, new Uint8Array(await file.arrayBuffer()), browserFetch, RULES, {}, (m) => this.progress.set(m)));
  }

  private async run(job: () => Promise<ScanResult>): Promise<void> {
    this.running.set(true);
    this.error.set('');
    this.result.set(undefined);
    this.progress.set('Empezando…');
    this.resetFilters();
    try {
      this.result.set(await job());
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Ocurrió un error inesperado.');
    } finally {
      this.running.set(false);
      this.progress.set('');
    }
  }

  protected resetFilters(): void {
    this.severityFilter.set('');
    this.categoryFilter.set('');
    this.query.set('');
    this.expanded.set(new Set());
  }

  protected toggle(index: number): void {
    const next = new Set(this.expanded());
    if (!next.delete(index)) next.add(index);
    this.expanded.set(next);
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
