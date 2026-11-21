import type { Finding, Severity } from './types';

type Rule = { id: string; severity: Severity; title: string; fix: string };

const R = {
  unpinnedBranch: { id: 'WF-ACTION-BRANCH', severity: 'high', title: 'Acción de terceros fijada a una rama', fix: 'Fija la acción al SHA completo de un commit (`uses: owner/repo@<sha>  # v1.2.3`). Una rama cambia sin aviso y puede traer código malicioso.' },
  unpinnedTag: { id: 'WF-ACTION-NOT-PINNED', severity: 'medium', title: 'Acción de terceros sin fijar por commit', fix: 'Fija la acción al SHA completo de un commit y deja la versión en un comentario. Una etiqueta puede moverse si la cuenta del autor se compromete.' },
  officialTag: { id: 'WF-ACTION-OFFICIAL-TAG', severity: 'low', title: 'Acción oficial fijada solo por etiqueta', fix: 'Para máxima seguridad fija el SHA del commit; Dependabot puede mantenerlo al día.' },
  writeAll: { id: 'WF-PERMISSIONS-WRITE-ALL', severity: 'high', title: 'El workflow da permisos de escritura sobre todo', fix: 'Declara solo lo necesario, por ejemplo `permissions: contents: read`.' },
  noPermissions: { id: 'WF-NO-PERMISSIONS', severity: 'medium', title: 'El workflow no declara permisos', fix: 'Agrega `permissions: contents: read` a nivel del workflow y amplía solo en el trabajo que lo necesite.' },
  injection: { id: 'WF-SCRIPT-INJECTION', severity: 'high', title: 'Texto controlado por terceros dentro de un script', fix: 'No interpoles `${{ ... }}` con título, cuerpo o nombre de rama en `run:`. Pásalo por una variable de entorno (`env:`) y úsala como `"$VAR"`.' },
  prTarget: { id: 'WF-PULL-REQUEST-TARGET', severity: 'medium', title: 'Usa pull_request_target', fix: 'Este evento corre con permisos y secretos del repo base. No ejecutes código del PR en él; usa `pull_request` salvo que sea imprescindible.' },
  prTargetCheckout: { id: 'WF-PWN-REQUEST', severity: 'critical', title: 'pull_request_target ejecuta código del pull request', fix: 'No hagas checkout del código del PR en un workflow con pull_request_target: cualquiera podría robar tus secretos con un PR. Separa el análisis (sin permisos) de la acción con permisos.' },
  curlSh: { id: 'WF-CURL-PIPE-SH', severity: 'high', title: 'Se ejecuta un script descargado sin verificarlo', fix: 'Descarga el script, verifica su checksum y luego ejecútalo, o usa una acción fijada por commit.' },
  selfHosted: { id: 'WF-SELF-HOSTED', severity: 'low', title: 'Usa un runner propio (self-hosted)', fix: 'En repos públicos, los PR de terceros pueden ejecutar código en tu máquina. Usa runners efímeros o exige aprobación para colaboradores nuevos.' },
} satisfies Record<string, Rule>;

const UNTRUSTED =
  /\$\{\{\s*(?:github\.event\.(?:issue|pull_request|comment|review|review_comment|discussion)\.(?:title|body)|github\.event\.(?:head_commit|commits\[[^\]]*\])\.(?:message|author\.(?:name|email))|github\.event\.pages\[[^\]]*\]\.page_name|github\.head_ref|github\.event\.pull_request\.head\.(?:ref|label|repo\.default_branch)|github\.event\.workflow_run\.(?:head_branch|head_commit\.message))\s*\}\}/;

const finding = (rule: Rule, file: string, line: number, snippet: string, extra = ''): Finding => ({
  ruleId: rule.id, category: 'config', severity: rule.severity, file, line,
  snippet: snippet.trim().slice(0, 200), title: rule.title + extra, fix: rule.fix,
});

/** Revisa un workflow de GitHub Actions: acciones sin fijar, permisos, inyección de scripts y pull_request_target. */
export function checkWorkflow(text: string, file: string): Finding[] {
  const out: Finding[] = [];
  const lines = text.split(/\r?\n/);

  if (!lines.some((l) => /^\s*permissions\s*:/.test(l))) out.push(finding(R.noPermissions, file, 1, lines[0] ?? ''));

  let prTargetLine = 0;
  let checkoutHeadLine = 0;
  let blockIndent = -1; // sangría de la clave `run:` o `script:` cuyo bloque estamos leyendo

  lines.forEach((raw, idx) => {
    const n = idx + 1;
    const line = raw.replace(/\s+#.*$/, '');
    const indent = raw.search(/\S/);

    if (blockIndent >= 0 && raw.trim() !== '' && indent <= blockIndent) blockIndent = -1;
    const inBlock = blockIndent >= 0;

    const key = /^(\s*)(?:-\s+)?(run|script)\s*:\s*(.*)$/.exec(line);
    const content = key ? (key[3] ?? '') : inBlock ? line : '';
    if (key) {
      const col = line.indexOf(key[2] as string);
      blockIndent = /^[|>][+-]?\s*$/.test(content) || content === '' ? col : -1;
    }

    if (key || inBlock) {
      if (UNTRUSTED.test(content)) out.push(finding(R.injection, file, n, raw));
      if (/\b(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/.test(content)) out.push(finding(R.curlSh, file, n, raw));
      return;
    }

    const uses = /^\s*-?\s*uses:\s*["']?([^\s"'#]+)/.exec(line)?.[1];
    if (uses && !uses.startsWith('./') && !uses.startsWith('docker://')) {
      const [name = '', ref] = uses.split('@');
      const official = /^(?:actions|github)\//.test(name);
      if (ref === undefined) out.push(finding(R.unpinnedBranch, file, n, raw, ` (${name})`));
      else if (!/^[0-9a-f]{40}$/i.test(ref)) {
        if (!/^v?\d/.test(ref)) out.push(finding(R.unpinnedBranch, file, n, raw, ` (${name}@${ref})`));
        else out.push(finding(official ? R.officialTag : R.unpinnedTag, file, n, raw, ` (${name}@${ref})`));
      }
    }

    if (/^\s*permissions\s*:\s*write-all\b/.test(line)) out.push(finding(R.writeAll, file, n, raw));
    if (/runs-on\s*:.*\bself-hosted\b/.test(line)) out.push(finding(R.selfHosted, file, n, raw));
    if (/(?:^\s*pull_request_target\b|\bon\s*:.*\bpull_request_target\b|^\s*-\s*pull_request_target\b)/.test(line) && prTargetLine === 0) prTargetLine = n;
    if (/\bref\s*:.*(?:github\.event\.pull_request\.head\.(?:sha|ref)|github\.head_ref|refs\/pull\/)/.test(line)) checkoutHeadLine = n;
  });

  if (prTargetLine > 0) {
    if (checkoutHeadLine > 0) out.push(finding(R.prTargetCheckout, file, checkoutHeadLine, lines[checkoutHeadLine - 1] ?? ''));
    else out.push(finding(R.prTarget, file, prTargetLine, lines[prTargetLine - 1] ?? ''));
  }
  return out.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}
